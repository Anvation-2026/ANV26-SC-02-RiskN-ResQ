"""Satellite flood analysis and hazard-aware destination routing.

  POST /flood-analysis/run              admin: start an analysis (background; one at a time; recent results are reused)
  GET  /flood-analysis/status/{id}      signed in: progress / final status
  GET  /flood-analysis/results/{id}     signed in: polygons (GeoJSON), areas, dates, quality, warnings
  GET  /flood-analysis/latest           signed in: the newest completed analysis (the map layer)
  GET  /flood-analysis/engine           admin: which imagery engine is configured
  POST /routes/safe-route               signed in: candidate routes checked against hazards, ranked
  POST /routes/reassess                 signed in: re-check a followed route against current hazards (no satellite request)
  POST /routes/exit                     signed in: quickest road route OUT of the flagged flood area to a lower-risk place
"""
import time
from collections import defaultdict, deque
from typing import List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Response
from pydantic import BaseModel, Field, field_validator

import audit
import auth
import db
import exit_route
import flood_analysis
import geocode
import safe_route
from providers.routing.base import RoutePoint

router = APIRouter()
routing_provider = None  # set by main

_hits = defaultdict(deque)


def _limit(key: str, per_minute: int) -> None:
    """Per-user limit for endpoints that call outside services (the public OSRM server has a fair-use policy)."""
    now = time.monotonic()
    q = _hits[key]
    while q and now - q[0] > 60:
        q.popleft()
    if len(q) >= per_minute:
        raise HTTPException(429, "Too many route requests. Please wait a minute and try again.", headers={"Retry-After": "60"})
    q.append(now)


# ------------------------------------------------------------------------------------------- satellite analysis
class AnalysisIn(BaseModel):
    model_config = {"extra": "forbid"}
    bbox: Optional[List[float]] = Field(None, min_length=4, max_length=4, description="west, south, east, north (default: monitored area)")
    after_date: Optional[str] = Field(None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    baseline_start: Optional[str] = Field(None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    baseline_end: Optional[str] = Field(None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    force: bool = False


@router.post("/flood-analysis/run", status_code=202)
async def run_analysis(body: AnalysisIn, background: BackgroundTasks, admin: dict = Depends(auth.require_admin)):
    try:
        bbox = flood_analysis.validate_bbox(body.bbox) if body.bbox else flood_analysis.default_bbox()
    except ValueError as exc:
        raise HTTPException(422, str(exc))
    if bool(body.baseline_start) != bool(body.baseline_end):
        raise HTTPException(422, "Give both baseline_start and baseline_end, or neither.")
    if body.baseline_start and body.baseline_start > body.baseline_end:
        raise HTTPException(422, "baseline_start must be before baseline_end.")
    req = flood_analysis.Request(bbox=bbox, after_date=body.after_date, baseline_start=body.baseline_start, baseline_end=body.baseline_end)
    with db.session() as c:
        if not body.force:
            same = flood_analysis.recent_same(c, req)
            if same:
                return {"analysis_id": same, "status": flood_analysis.COMPLETED, "reused": True,
                        "message": "A completed analysis of this area with the same settings is less than 6 hours old."}
        try:
            aid = flood_analysis.create(c, req, admin["id"], "admin")
        except flood_analysis.Busy as busy:
            raise HTTPException(409, f"Analysis {busy.args[0]} is still running. Check its status before starting another.")
        audit.record(c, admin, "flood_analysis.run", aid, f"bbox={list(bbox)}")
    background.add_task(flood_analysis.execute, aid)
    return {"analysis_id": aid, "status": flood_analysis.QUEUED, "reused": False, "engine": flood_analysis.pick_engine().name}


def _row(c, analysis_id: int):
    row = c.execute("SELECT * FROM flood_analyses WHERE id=?", (analysis_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Analysis not found")
    return row


@router.get("/flood-analysis/status/{analysis_id}")
def analysis_status(analysis_id: int, _: dict = Depends(auth.current_user)):
    with db.session() as c:
        return flood_analysis.status_dict(_row(c, analysis_id))


@router.get("/flood-analysis/results/{analysis_id}")
def analysis_results(analysis_id: int, _: dict = Depends(auth.current_user)):
    with db.session() as c:
        return flood_analysis.result_dict(_row(c, analysis_id))


@router.get("/flood-analysis/latest")
def analysis_latest(_: dict = Depends(auth.current_user)):
    with db.session() as c:
        row = flood_analysis.latest_completed(c)
        last = c.execute("SELECT * FROM flood_analyses ORDER BY id DESC LIMIT 1").fetchone()
        return {"available": row is not None, "result": flood_analysis.result_dict(row) if row else None,
                "last_attempt": flood_analysis.status_dict(last) if last else None,
                "message": None if row else "No satellite flood analysis has completed yet."}


@router.get("/flood-analysis/engine")
def analysis_engine(_: dict = Depends(auth.require_admin)):
    return flood_analysis.engine_status()


# ---------------------------------------------------------------------------------------------------- routing
class PlaceIn(BaseModel):
    latitude: float = Field(..., ge=-90, le=90)
    longitude: float = Field(..., ge=-180, le=180)
    label: Optional[str] = Field(None, max_length=120)


class SafeRouteIn(BaseModel):
    model_config = {"extra": "forbid"}
    origin: PlaceIn
    destination: PlaceIn


class ReassessIn(BaseModel):
    model_config = {"extra": "forbid"}
    geometry: List[List[float]] = Field(..., min_length=2, max_length=6000)
    known_hazard_ids: List[str] = Field(default_factory=list, max_length=500)
    current_position: Optional[PlaceIn] = None
    destination: Optional[PlaceIn] = None

    @field_validator("geometry")
    @classmethod
    def _pts(cls, v):
        for p in v:
            if len(p) != 2 or not (-90 <= p[0] <= 90 and -180 <= p[1] <= 180):
                raise ValueError("geometry must be [[latitude, longitude], ...]")
        return v


def _too_far(a: PlaceIn, b: PlaceIn) -> bool:
    from engine import haversine_meters
    return haversine_meters(a.latitude, a.longitude, b.latitude, b.longitude) > 150_000


async def _plan(c, origin: PlaceIn, destination: PlaceIn, response: Response):
    if _too_far(origin, destination):
        raise HTTPException(422, "The destination is more than 150 km away; this app plans local trips only.")
    try:
        return await safe_route.plan(c, routing_provider, RoutePoint(latitude=origin.latitude, longitude=origin.longitude),
                                     RoutePoint(latitude=destination.latitude, longitude=destination.longitude),
                                     {"origin": origin.label, "destination": destination.label})
    except safe_route.RoutingFailed as f:
        headers = {"Retry-After": str(f.retry_after)} if f.retry_after else None
        raise HTTPException(f.status, f.message, headers=headers)


@router.post("/routes/safe-route")
async def safe_route_plan(body: SafeRouteIn, response: Response, user: dict = Depends(auth.current_user)):
    _limit(f"route:{user['id']}", 12)
    with db.session() as c:
        return await _plan(c, body.origin, body.destination, response)


@router.post("/routes/reassess")
async def safe_route_reassess(body: ReassessIn, response: Response, user: dict = Depends(auth.current_user)):
    _limit(f"reassess:{user['id']}", 30)
    with db.session() as c:
        out = safe_route.reassess(c, body.geometry, body.known_hazard_ids)
        if out["affected"] and body.current_position and body.destination:
            try:
                out["suggestion"] = await _plan(c, body.current_position, body.destination, response)
            except HTTPException as exc:
                out["suggestion"] = None
                out["suggestion_error"] = exc.detail
        return out


class ExitIn(BaseModel):
    model_config = {"extra": "forbid"}
    origin: PlaceIn


@router.post("/routes/exit")
async def exit_plan(body: ExitIn, user: dict = Depends(auth.current_user)):
    """From where the person is, the quickest real road route out of the area RiskN ResQ currently flags for flooding
    (zone alerts including SIMULATED DRILLs, high-risk cells, satellite detections, credible flood reports)."""
    _limit(f"route:{user['id']}", 12)
    o = RoutePoint(latitude=body.origin.latitude, longitude=body.origin.longitude)
    with db.session() as c:
        try:
            return await exit_route.plan_exit(c, routing_provider, o, geocode.reverse)
        except safe_route.RoutingFailed as f:
            raise HTTPException(f.status, f.message, headers={"Retry-After": str(f.retry_after)} if f.retry_after else None)
