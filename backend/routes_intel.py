"""Flood intelligence API: explained risk, hyper-local cells, satellite/terrain/river data, hotspots, road risk, history,
evacuation points, and the admin monitoring, resource and positioning views. Read endpoints are public like /roads and /alerts."""
import json
import math
from datetime import datetime, timedelta, timezone
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

import audit
import auth
import config
import db
import flood_intel
import intel_jobs
import ml_model
import notify
import road_risk
import routing_service
import weather_monitor
from engine import ZONES, _km, compute_risk, haversine_meters

router = APIRouter()
providers = None          # intel_jobs.Providers, set by main
routing_provider = None   # set by main

INSUFFICIENT = "Insufficient data to estimate current flood risk."


def _zone_dict(c, zone: str) -> dict:
    r = compute_risk(c, zone)
    intel = r.get("intelligence")
    return {"zone": zone, "risk_score": r["risk_score"], "risk_level": r["risk_level"], "probability": r.get("probability"), "insufficient": r["insufficient"],
            "mode": r.get("mode"), "reason": INSUFFICIENT if r["insufficient"] else r["reason"], "recommended_action": r.get("recommended_action"),
            "data_source": r.get("data_source"), "model": r.get("model"), "blocked_roads": r.get("blocked_roads", []),
            "signals": (intel or {}).get("signals", []), "missing": (intel or {}).get("missing", []), "sources": (intel or {}).get("sources", []),
            "probability_basis": (intel or {}).get("probability_basis"), "computed_at": (intel or {}).get("computed_at")}


def _point_dict(c, lat: float, lng: float) -> Optional[dict]:
    a = flood_intel.assess_point(c, lat, lng)
    if a is None:
        return None
    return {"latitude": lat, "longitude": lng, "cell": a["cell"], "risk_score": a["risk_score"], "risk_level": a["risk_level"], "probability": a["probability"],
            "probability_basis": a["probability_basis"], "insufficient": a["insufficient"], "reason": INSUFFICIENT if a["insufficient"] else a["reason"],
            "explanation": a["explanation"], "signals": a["signals"], "missing": a["missing"], "sources": a["sources"], "model": a["model"],
            "recommended_action": a["recommended_action"], "computed_at": a["computed_at"], "weather_stale": a.get("weather_stale", False),
            "confidence": a.get("confidence"), "confidence_basis": a.get("confidence_basis"), "features": a.get("features") or {}}


@router.get("/flood-risk")
def flood_risk(latitude: Optional[float] = Query(None, ge=-90, le=90), longitude: Optional[float] = Query(None, ge=-180, le=180)):
    """Explained flood risk. With a position: the monitored cell it falls in. Without: every zone."""
    with db.session() as c:
        if latitude is not None and longitude is not None:
            p = _point_dict(c, latitude, longitude)
            if p is None:
                return {"latitude": latitude, "longitude": longitude, "insufficient": True, "reason": "This location is outside the monitored area. " + INSUFFICIENT}
            return p
        zones = [_zone_dict(c, z) for z in ZONES]
    return {"overall": max(zones, key=lambda z: z["risk_score"]), "zones": zones}


@router.get("/flood-risk/cells")
def flood_risk_cells():
    """The hyper-local grid: one estimate per monitored cell, for the risk map."""
    with db.session() as c:
        env = flood_intel.grid_cells(c)
        dlat, dlng = flood_intel.grid_steps(env) if env else (config.GRID_SPACING, config.GRID_SPACING)
        preds = {p["cell"]: p for p in c.execute("SELECT * FROM flood_risk_predictions").fetchall()}
        terr = {t["cell"]: t for t in c.execute("SELECT cell, elevation_m, slope_deg, susceptibility, source, fetched_at FROM terrain_data").fetchall()}
        cells = []
        for e in env:
            p = preds.get(e["zone"])
            sigs = json.loads(p["signals"] or "[]") if p else []
            cells.append({"cell": e["zone"], "latitude": e["latitude"], "longitude": e["longitude"],
                          "risk_score": p["risk_score"] if p else None, "risk_level": p["risk_level"] if p else None,
                          "probability": p["probability"] if p else None, "insufficient": bool(p["insufficient"]) if p else True,
                          "top_signals": [s["label"] for s in sorted(sigs, key=lambda s: -s["points"]) if s["points"] > 0][:3],
                          "computed_at": p["computed_at"] if p else None,
                          "susceptibility": terr[e["zone"]]["susceptibility"] if e["zone"] in terr else None,
                          "elevation_m": terr[e["zone"]]["elevation_m"] if e["zone"] in terr else None,
                          "slope_deg": terr[e["zone"]]["slope_deg"] if e["zone"] in terr else None,
                          "terrain_source": terr[e["zone"]]["source"] if e["zone"] in terr else None})
    return {"cell_size_km": {"lat": round(dlat * 111.32, 1), "lng": round(dlng * 111.32, 1)}, "half_deg": {"lat": dlat / 2, "lng": dlng / 2},
            "model": flood_intel.MODEL_NAME, "cells": cells}


@router.get("/flood-risk/{zone}")
def flood_risk_zone(zone: str):
    if zone not in ZONES:
        raise HTTPException(404, f"Unknown zone '{zone}'. Valid zones: {list(ZONES)}")
    with db.session() as c:
        return _zone_dict(c, zone)


def _obs(r) -> dict:
    d = dict(r)
    d["abnormal"] = bool(d["abnormal"])
    d["age_days"] = round((flood_intel.age_minutes(d["observed_at"]) or 0) / 1440.0, 1)
    d["stale"] = d["age_days"] > config.SATELLITE_STALE_DAYS
    return d


@router.get("/satellite/observations")
def satellite_observations():
    with db.session() as c:
        scenes = [dict(r) for r in c.execute("SELECT * FROM satellite_scenes ORDER BY acquired_at DESC LIMIT 8").fetchall()]
        obs = [_obs(r) for r in c.execute("SELECT * FROM satellite_observations ORDER BY cell").fetchall()]
    status = next(s for s in intel_jobs.provider_statuses() if s["name"] == "satellite")
    return {"status": status, "scenes": scenes, "cells": obs, "note": "A satellite observation is water extent on the day of the pass, not a flood prediction.",
            "message": None if obs else "Satellite data unavailable"}


@router.get("/satellite/water-expansion")
def satellite_water_expansion():
    """Cells where the newest pass shows abnormally more open water than earlier passes. Normal rivers and lakes are in the baseline."""
    with db.session() as c:
        rows = [_obs(r) for r in c.execute("SELECT * FROM satellite_observations WHERE abnormal=1 ORDER BY expansion_area_km2 DESC").fetchall()]
    fresh = [r for r in rows if not r["stale"]]
    return {"abnormal_cells": fresh, "stale_abnormal_cells": len(rows) - len(fresh),
            "note": "Satellite-detected water expansion indicates possible flooding or ponding; it does not confirm a flood.",
            "message": None if intel_jobs.provider_statuses()[1]["state"] in ("OK", "DEGRADED", "STALE") else "Satellite data unavailable"}


@router.get("/terrain")
def terrain():
    with db.session() as c:
        rows = [dict(r) for r in c.execute("SELECT * FROM terrain_data ORDER BY cell").fetchall()]
    return {"cells": rows, "note": "Terrain shows susceptibility (low, flat, depressed ground), not current flooding.",
            "message": None if rows else "Terrain data unavailable"}


@router.get("/water-levels")
def water_levels():
    with db.session() as c:
        rows = [dict(r) for r in c.execute("SELECT * FROM water_level_observations ORDER BY cell").fetchall()]
    return {"cells": rows, "gauges_connected": False,
            "note": "River discharge is MODELLED (GloFAS), not a gauge reading. Thresholds are relative to the model's normal, not official warning levels.",
            "message": None if rows else "Water-level data unavailable for this area."}


@router.get("/flood-hotspots")
def flood_hotspots():
    with db.session() as c:
        return {"hotspots": [flood_intel.hotspot_out(r) for r in c.execute("SELECT * FROM flood_hotspots WHERE active=1 ORDER BY risk_score DESC").fetchall()],
                "note": "Potential hotspots where several independent signals agree; not confirmed flooding."}


@router.get("/risk-history")
def risk_history(zone: Optional[str] = None, hours: int = Query(24, ge=1, le=720)):
    since = (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat(timespec="seconds")
    q, args = "SELECT at, zone, rainfall_24h, risk_score, risk_level, probability, satellite_expansion_pct, active_alerts, source FROM risk_history WHERE at >= ?", [since]
    if zone:
        if zone not in ZONES:
            raise HTTPException(404, f"Unknown zone '{zone}'")
        q += " AND zone=?"; args.append(zone)
    with db.session() as c:
        rows = [dict(r) for r in c.execute(q + " ORDER BY id", args).fetchall()]
    return {"hours": hours, "history": rows}


@router.get("/road-risk")
def road_risk_list():
    with db.session() as c:
        return {"roads": road_risk.assess_roads(c), "states": ["OPEN", "POTENTIALLY_AFFECTED", "REPORTED_BLOCKED", "VERIFIED_BLOCKED"],
                "note": "POTENTIALLY AFFECTED is an area-level flood-risk estimate; only reported or verified incidents and admin closures mark a road blocked."}


@router.get("/intelligence/overview")
def overview(latitude: Optional[float] = Query(None, ge=-90, le=90), longitude: Optional[float] = Query(None, ge=-180, le=180)):
    """Everything the app needs in one cached read, so phones never call weather or satellite services themselves."""
    cells = flood_risk_cells()
    with db.session() as c:
        zones = [_zone_dict(c, z) for z in ZONES]
        here = _point_dict(c, latitude, longitude) if latitude is not None and longitude is not None else None
        hotspots = [flood_intel.hotspot_out(r) for r in c.execute("SELECT * FROM flood_hotspots WHERE active=1 ORDER BY risk_score DESC").fetchall()]
        sat = [_obs(r) for r in c.execute("SELECT cell, latitude, longitude, observed_at, expansion_area_km2, expansion_percentage, confidence, source, abnormal, "
                                           "water_area_km2, baseline_water_area_km2, baseline_scenes, method "
                                           "FROM satellite_observations WHERE abnormal=1").fetchall()]
        roads = [r for r in road_risk.assess_roads(c) if r["state"] != "OPEN"]
        history = None
        if latitude is not None and longitude is not None:  # the user's zone, last 12 h, one entry per change of level
            zone = db.nearest_zone(latitude, longitude)
            since = (datetime.now(timezone.utc) - timedelta(hours=12)).isoformat(timespec="seconds")
            rows = c.execute("SELECT at, risk_level, risk_score FROM risk_history WHERE zone=? AND at >= ? ORDER BY id", (zone, since)).fetchall()
            steps = []
            for r in rows:
                if not steps or steps[-1]["risk_level"] != r["risk_level"]:
                    steps.append({"at": r["at"], "risk_level": r["risk_level"], "risk_score": r["risk_score"]})
            history = {"zone": zone, "hours": 12, "steps": steps[-6:]}
    return {"risk_history": history, "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "location": here, "zones": zones, "cells": cells["cells"],
            "half_deg": cells["half_deg"], "hotspots": hotspots, "satellite_water_change": [s for s in sat if not s["stale"]],
            "road_risk": roads, "providers": intel_jobs.provider_statuses(), "model": flood_intel.MODEL_NAME}


# ---------------------------------------------------------------------------------------------------- evacuation
@router.get("/evacuation/nearest")
async def nearest_evacuation(latitude: float = Query(..., ge=-90, le=90), longitude: float = Query(..., ge=-180, le=180),
                             user: dict = Depends(auth.current_user)):
    """Nearest designated evacuation points (shelters / assembly points, then hospitals) with a risk-aware route to the closest.
    'Designated' means listed in the source data; it does not mean safe."""
    from providers.routing.base import RoutePoint
    with db.session() as c:
        places = [dict(r) for r in c.execute("SELECT * FROM places WHERE kind IN ('SHELTER','HOSPITAL')").fetchall()]
    if not places:
        return {"points": [], "route": None, "message": "No designated evacuation points are loaded yet. An administrator can import shelters and hospitals from OpenStreetMap."}
    for p in places:
        p["distance_km"] = round(_km(latitude, longitude, p["latitude"], p["longitude"]), 2)
    places.sort(key=lambda p: p["distance_km"])
    top = places[:3]                                   # nearest overall, shelters and hospitals alike
    nearest_shelter = next((p for p in places if p["kind"] == "SHELTER"), None)
    if nearest_shelter and nearest_shelter not in top:
        top.append(nearest_shelter)                    # always show the closest shelter / assembly point as well
    route = None
    try:
        with db.session() as c:
            route = await routing_service.plan_route(c, routing_provider, RoutePoint(latitude=latitude, longitude=longitude),
                                                     RoutePoint(latitude=top[0]["latitude"], longitude=top[0]["longitude"]))
    except Exception:
        route = None
    return {"label": "Designated evacuation point", "points": [{k: p[k] for k in ("id", "kind", "name", "latitude", "longitude", "phone", "address", "distance_km", "source")} for p in top],
            "route": route, "note": "Designated means listed in the data source, not verified safe. Check that a place is open before travelling.",
            "message": None if route and route.get("success") else "A route could not be calculated right now."}


# ------------------------------------------------------------------------------------------------------- admin
@router.get("/admin/providers")
def admin_providers(_: dict = Depends(auth.require_admin)):
    with db.session() as c:
        counts = {"monitored_cells": len(flood_intel.grid_cells(c)),
                  "terrain_cells": c.execute("SELECT COUNT(*) FROM terrain_data").fetchone()[0],
                  "water_level_cells": c.execute("SELECT COUNT(*) FROM water_level_observations").fetchone()[0],
                  "satellite_cells": c.execute("SELECT COUNT(*) FROM satellite_observations").fetchone()[0],
                  "abnormal_water_cells": c.execute("SELECT COUNT(*) FROM satellite_observations WHERE abnormal=1").fetchone()[0],
                  "active_hotspots": c.execute("SELECT COUNT(*) FROM flood_hotspots WHERE active=1").fetchone()[0],
                  "historical_events": c.execute("SELECT COUNT(*) FROM historical_events").fetchone()[0]}
        zones = [_zone_dict(c, z) for z in ZONES]
        ml = ml_model.status(c)
    return {"providers": intel_jobs.provider_statuses(), "counts": counts, "high_risk_zones": [z for z in zones if z["risk_level"] in ("HIGH", "CRITICAL")],
            "zones": zones, "model": flood_intel.MODEL_NAME, "ml": {"status": ml["status"], "reason": ml.get("reason")},
            "config": {"grid_bounds": config.MONITORING_BOUNDS, "grid_spacing_deg": config.GRID_SPACING, "weather_refresh_s": config.WEATHER_REFRESH_INTERVAL,
                       "satellite_refresh_s": config.SATELLITE_REFRESH_INTERVAL, "sar_water_threshold_db": config.SAR_WATER_THRESHOLD_DB}}


class RefreshIn(BaseModel):
    jobs: List[Literal["weather", "terrain", "climatology", "water", "satellite"]] = ["weather", "terrain", "climatology", "water", "satellite"]


@router.post("/admin/intelligence/refresh")
async def admin_refresh(body: RefreshIn, admin: dict = Depends(auth.require_admin)):
    """Run the ingestion jobs now (they also run on a schedule). Providers that fail are reported, not faked."""
    out = {}
    if "weather" in body.jobs:
        w = await weather_monitor.refresh(providers.weather)
        out["weather"] = {"status": w["status"], "error": w["last_error"]}
    out.update(await intel_jobs.run_all(providers, tuple(j for j in body.jobs if j != "weather")))
    with db.session() as c:
        audit.record(c, admin, "intelligence.refresh", ",".join(body.jobs))
    return {"results": out, "providers": intel_jobs.provider_statuses()}


class EventIn(BaseModel):
    latitude: float = Field(..., ge=-90, le=90)
    longitude: float = Field(..., ge=-180, le=180)
    event_date: str = Field(..., pattern=r"^\d{4}-\d{2}-\d{2}$")
    rainfall_mm: Optional[float] = Field(None, ge=0, le=2000)
    water_extent_km2: Optional[float] = Field(None, ge=0)
    severity: Optional[int] = Field(None, ge=1, le=5)
    source: str = Field(..., min_length=3, max_length=200)   # required: every record must say where it came from
    notes: Optional[str] = Field(None, max_length=300)
    external_id: Optional[str] = Field(None, max_length=100)


@router.post("/admin/historical-events", status_code=201)
def add_events(events: List[EventIn], admin: dict = Depends(auth.require_admin)):
    """Real historical flood records (for example from a municipal report or a published dataset), each with its source."""
    if len(events) > 500:
        raise HTTPException(422, "At most 500 records per request.")
    added = 0
    with db.session() as c:
        for e in events:
            if e.external_id and c.execute("SELECT 1 FROM historical_events WHERE external_id=?", (e.external_id,)).fetchone():
                continue
            c.execute("INSERT INTO historical_events(latitude,longitude,event_date,kind,rainfall_mm,water_extent_km2,severity,source,notes,external_id,created_at) "
                      "VALUES(?,?,?,'FLOOD',?,?,?,?,?,?,?)", (e.latitude, e.longitude, e.event_date, e.rainfall_mm, e.water_extent_km2, e.severity, e.source, e.notes, e.external_id, db.now()))
            added += 1
        audit.record(c, admin, "history.import", "", f"{added} record(s)")
    return {"added": added}


@router.get("/admin/historical-events")
def list_events(_: dict = Depends(auth.require_admin)):
    with db.session() as c:
        rows = [dict(r) for r in c.execute("SELECT * FROM historical_events ORDER BY event_date DESC LIMIT 500").fetchall()]
    by_source = {}
    for r in rows:
        by_source[r["source"]] = by_source.get(r["source"], 0) + 1
    return {"events": rows, "by_source": by_source,
            "note": "Only records added by an administrator or verified in this app. No external flood-ground-truth dataset is connected."}


@router.get("/admin/ml/status")
def ml_status(_: dict = Depends(auth.require_admin)):
    with db.session() as c:
        return ml_model.status(c)


@router.post("/admin/ml/train")
def ml_train(admin: dict = Depends(auth.require_admin)):
    with db.session() as c:
        out = ml_model.train(c)
        audit.record(c, admin, "ml.train", "", "trained" if out.get("trained") else "not trained: " + str(out.get("reason")))
    return out


@router.get("/admin/positioning")
def positioning(_: dict = Depends(auth.require_admin)):
    """Suggest where available volunteers could stand by: a recommendation, never an automatic dispatch."""
    out = []
    since = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat(timespec="seconds")
    with db.session() as c:
        vols = c.execute("SELECT id, name, skill, latitude, longitude FROM volunteers WHERE status='ACTIVE' AND available=1 AND latitude IS NOT NULL").fetchall()
        reqs = c.execute("SELECT type, status, latitude, longitude FROM help_requests WHERE created_at >= ? AND latitude IS NOT NULL", (since,)).fetchall()
        for z, (la, lo) in ZONES.items():
            r = compute_risk(c, z)
            if r["insufficient"] or r["risk_level"] not in ("HIGH", "CRITICAL", "MEDIUM"):
                continue
            near = lambda km: [v for v in vols if haversine_meters(la, lo, v["latitude"], v["longitude"]) <= km * 1000]  # noqa: E731
            recent = [q for q in reqs if db.nearest_zone(q["latitude"], q["longitude"]) == z]
            skills = sorted({v["skill"] for v in near(5)})
            out.append({"zone": z, "risk_level": r["risk_level"], "risk_score": r["risk_score"], "requests_last_24h": len(recent),
                        "open_requests": sum(1 for q in recent if q["status"] == "OPEN"), "volunteers_within_2km": len(near(2)), "volunteers_within_5km": len(near(5)),
                        "skills_nearby": skills,
                        "suggestion": (f"{len(near(2))} available volunteer(s) within 2 km of {r['risk_level']} risk {z}"
                                       f"{'; ' + str(len(recent)) + ' help request(s) in the last 24 h' if recent else ''}."
                                       + (" Consider asking more volunteers to stand by here." if r["risk_level"] in ("HIGH", "CRITICAL") and len(near(2)) < 3 else "")),
                        "note": "Demand is the count of recent requests, not a forecast. A suggestion only; nothing is dispatched automatically."})
    return {"zones": out}


@router.get("/admin/resources")
def resources(_: dict = Depends(auth.require_admin)):
    """Volunteer capacity and open demand per resource type."""
    types = ["MEDICINE", "FOOD", "WATER", "FIRST_AID", "EVACUATION"]
    with db.session() as c:
        vols = c.execute("SELECT skill, resources, quantities, available, status FROM volunteers").fetchall()
        reqs = c.execute("SELECT type, status, quantity FROM help_requests").fetchall()
    rows = []
    for t in types:
        key = t.lower().replace("_", " ")
        have = [v for v in vols if v["status"] == "ACTIVE" and key in f"{v['skill']} {v['resources'] or ''}".lower().replace("_", " ")]
        qty = 0
        for v in have:
            try:
                qty += int((json.loads(v["quantities"] or "{}")).get(t, 0))
            except Exception:
                pass
        open_reqs = [r for r in reqs if r["type"] == t and r["status"] == "OPEN"]
        rows.append({"type": t, "volunteers": len(have), "available_now": sum(1 for v in have if v["available"]), "quantity_on_hand": qty,
                     "open_requests": len(open_reqs), "quantity_requested": sum(r["quantity"] or 1 for r in open_reqs)})
    return {"resources": rows, "note": "Quantity on hand is only what volunteers have declared."}
