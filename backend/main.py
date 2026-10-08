import json
import logging
from typing import List, Literal, Optional
from fastapi import FastAPI, HTTPException, Query, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

import config
import db
from engine import (
    compute_flood_risk,
    compute_trust,
    confidence_label,
    haversine_meters,
    now_iso,
    select_best_valid_route,
)
from providers.routing.base import RoutePoint
from providers.routing.router import CompositeRoutingProvider
from providers.weather.imd import IMDProvider
from providers.weather.open_meteo import OpenMeteoProvider

from contextlib import asynccontextmanager

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("risknresq")


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init_db(reset=False)
    logger.info("Database initialized. Ready for real telemetry.")
    yield


app = FastAPI(
    title="RiskNResQ Real-Data API",
    description="Production Disaster Early Warning & Incident-Aware Community Response API",
    version="2.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Instantiate production providers
weather_provider = (
    IMDProvider(config.IMD_API_KEY) if config.IMD_API_KEY else OpenMeteoProvider()
)
routing_provider = CompositeRoutingProvider(config.GOOGLE_ROUTES_API_KEY)


# ==========================================
# 1. Health & Provider Checks
# ==========================================

@app.get("/health")
def health():
    return {"status": "ok", "timestamp": now_iso()}


@app.get("/health/providers")
async def health_providers():
    c = db.conn()
    db_ok = bool(c.execute("SELECT 1").fetchone())
    c.close()

    weather_ok = False
    try:
        # Quick ping to weather provider
        obs = await weather_provider.get_weather(12.9716, 77.5946)
        weather_ok = bool(obs.observed_at)
    except Exception:
        weather_ok = False

    return {
        "database": "ok" if db_ok else "error",
        "weather": "ok" if weather_ok else "degraded",
        "weather_source": weather_provider.get_source_name(),
        "routing": "ok",
        "routing_source": routing_provider.get_source_name(),
        "google_routes_configured": bool(config.GOOGLE_ROUTES_API_KEY),
        "imd_configured": bool(config.IMD_API_KEY),
        "ksndmc_configured": bool(config.KSNDMC_API_KEY),
    }


# ==========================================
# 2. Real Environmental Telemetry & Risk
# ==========================================

@app.get("/risk")
async def get_risk(
    latitude: float = Query(..., ge=-90.0, le=90.0),
    longitude: float = Query(..., ge=-180.0, le=180.0),
):
    """Calculates real multi-factor flood risk from live weather and community incident density."""
    try:
        weather = await weather_provider.get_weather(latitude, longitude)
    except Exception as e:
        logger.warning(f"Weather provider error: {e}")
        raise HTTPException(
            status_code=503, detail="Weather data temporarily unavailable."
        )

    # Fetch active incidents within 5km of coordinate
    c = db.conn()
    rows = c.execute(
        "SELECT * FROM incidents WHERE status IN ('REPORTED', 'VERIFIED') ORDER BY id DESC"
    ).fetchall()
    nearby = []
    for r in rows:
        d_meters = haversine_meters(latitude, longitude, r["latitude"], r["longitude"])
        if d_meters <= 5000.0:
            item = dict(r)
            item["trust_score"] = compute_trust(c, item)
            nearby.append(item)

    risk_eval = compute_flood_risk(weather, nearby)

    # Persist risk snapshot
    c.execute(
        "INSERT INTO risk_snapshots(latitude, longitude, risk_score, risk_level, weather_source, "
        "rainfall_24h_mm, rainfall_intensity_mm_per_hour, warning_level, reason, observed_at, computed_at) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        (
            latitude,
            longitude,
            risk_eval["risk_score"],
            risk_eval["risk_level"],
            risk_eval["weather_source"],
            risk_eval["rainfall_24h_mm"],
            risk_eval["rainfall_intensity_mm_per_hour"],
            risk_eval["warning_level"],
            risk_eval["reason"],
            risk_eval["observed_at"],
            now_iso(),
        ),
    )
    c.commit()
    c.close()

    return {
        "latitude": latitude,
        "longitude": longitude,
        **risk_eval,
    }


# ==========================================
# 3. Real Incident Reporting
# ==========================================

class IncidentCreate(BaseModel):
    type: Literal[
        "FLOODED_ROAD",
        "BLOCKED_ROAD",
        "WATERLOGGING",
        "FALLEN_TREE",
        "TRAFFIC_OBSTRUCTION",
        "OTHER",
    ]
    latitude: float = Field(..., ge=-90.0, le=90.0)
    longitude: float = Field(..., ge=-180.0, le=180.0)
    radiusMeters: float = Field(50.0, ge=10.0, le=500.0)
    description: str = ""
    severity: int = Field(3, ge=1, le=5)
    reportedBy: Optional[str] = "Citizen"
    photoUrl: Optional[str] = None


@app.post("/incidents", status_code=status.HTTP_201_CREATED)
def report_incident(body: IncidentCreate):
    c = db.conn()
    now_t = now_iso()
    cur = c.execute(
        "INSERT INTO incidents(type, latitude, longitude, radius_meters, description, severity, "
        "trust_score, status, reported_by, photo_url, timestamp, updated_at) "
        "VALUES (?,?,?,?,?,?,50,'REPORTED',?,?,?,?)",
        (
            body.type,
            body.latitude,
            body.longitude,
            body.radiusMeters,
            body.description,
            body.severity,
            body.reportedBy,
            body.photoUrl,
            now_t,
            now_t,
        ),
    )
    inc_id = cur.lastrowid
    row = c.execute("SELECT * FROM incidents WHERE id=?", (inc_id,)).fetchone()
    inc_dict = dict(row)
    trust = compute_trust(c, inc_dict)
    c.execute("UPDATE incidents SET trust_score=? WHERE id=?", (trust, inc_id))
    c.commit()
    c.close()

    return {
        "id": inc_id,
        "type": body.type,
        "latitude": body.latitude,
        "longitude": body.longitude,
        "radiusMeters": body.radiusMeters,
        "description": body.description,
        "severity": body.severity,
        "trustScore": trust,
        "confidence": confidence_label(trust),
        "status": "REPORTED",
        "createdAt": now_t,
    }


@app.get("/incidents")
def list_incidents(
    latitude: Optional[float] = None,
    longitude: Optional[float] = None,
    radius_km: float = 25.0,
    status_filter: Optional[str] = None,
):
    c = db.conn()
    q = "SELECT * FROM incidents WHERE 1=1"
    args = []
    if status_filter:
        q += " AND status=?"
        args.append(status_filter)
    else:
        q += " AND status!='RESOLVED'"

    rows = c.execute(q + " ORDER BY id DESC", args).fetchall()
    out = []
    for r in rows:
        item = dict(r)
        if latitude is not None and longitude is not None:
            dist = haversine_meters(latitude, longitude, item["latitude"], item["longitude"])
            if dist > radius_km * 1000.0:
                continue
        item["trustScore"] = compute_trust(c, item)
        item["confidence"] = confidence_label(item["trustScore"])
        out.append(item)

    c.close()
    return out


@app.post("/incidents/{incident_id}/verify")
def verify_incident(incident_id: int):
    c = db.conn()
    r = c.execute("SELECT * FROM incidents WHERE id=?", (incident_id,)).fetchone()
    if not r:
        c.close()
        raise HTTPException(404, "Incident not found")
    c.execute("UPDATE incidents SET status='VERIFIED', updated_at=? WHERE id=?", (now_iso(), incident_id))
    row = c.execute("SELECT * FROM incidents WHERE id=?", (incident_id,)).fetchone()
    item = dict(row)
    item["trustScore"] = compute_trust(c, item)
    item["confidence"] = confidence_label(item["trustScore"])
    c.commit()
    c.close()
    return item


# ==========================================
# 4. Incident-Aware Real Routing
# ==========================================

class RouteComputeIn(BaseModel):
    origin: RoutePoint
    destination: RoutePoint
    travelMode: str = "DRIVE"


@app.post("/routes/compute")
async def compute_route(body: RouteComputeIn):
    # 1. Fetch active blocking incidents
    c = db.conn()
    rows = c.execute(
        "SELECT * FROM incidents WHERE status IN ('REPORTED', 'VERIFIED') ORDER BY id DESC"
    ).fetchall()
    incidents = [dict(r) for r in rows]
    for inc in incidents:
        inc["trust_score"] = compute_trust(c, inc)
    c.close()

    # 2. Call routing provider
    try:
        candidates = await routing_provider.compute_routes(body.origin, body.destination)
    except Exception as e:
        logger.warning(f"Routing provider error: {e}")
        raise HTTPException(
            status_code=503, detail="Routing service temporarily unavailable."
        )

    if not candidates:
        return {
            "success": False,
            "origin": body.origin.model_dump(),
            "destination": body.destination.model_dump(),
            "message": "No traversable route found between these locations.",
            "safetyNote": "Route calculated using available data; incident information may be outdated.",
        }

    # 3. Evaluate candidate routes against active incidents
    selected, avoided = select_best_valid_route(candidates, incidents)

    if not selected:
        return {
            "success": False,
            "origin": body.origin.model_dump(),
            "destination": body.destination.model_dump(),
            "message": "No validated alternative route is currently available.",
            "safetyNote": "All known paths pass through reported hazard zones.",
        }

    avoided_summary = [
        {
            "id": inc["id"],
            "type": inc["type"],
            "description": inc.get("description", ""),
            "latitude": inc["latitude"],
            "longitude": inc["longitude"],
        }
        for inc in avoided
    ]

    return {
        "success": True,
        "origin": body.origin.model_dump(),
        "destination": body.destination.model_dump(),
        "distanceMeters": selected.distance_meters,
        "distanceKm": round(selected.distance_meters / 1000.0, 2),
        "durationSeconds": selected.duration_seconds,
        "etaMinutes": selected.eta_minutes,
        "polyline": selected.polyline,
        "traffic": selected.traffic,
        "summary": selected.summary,
        "avoidedIncidents": avoided_summary,
        "source": selected.source,
        "validatedAgainstIncidents": True,
        "safetyNote": "Recommended alternative route based on available route and incident data.",
        "generatedAt": now_iso(),
    }


# ==========================================
# 5. Real Volunteer Registration & Presence
# ==========================================

class VolunteerRegisterIn(BaseModel):
    name: str
    skill: str  # MEDICINE, FOOD, FIRST_AID, WATER, TRANSPORT
    resources: str
    phone: Optional[str] = None
    latitude: float = Field(..., ge=-90.0, le=90.0)
    longitude: float = Field(..., ge=-180.0, le=180.0)


@app.post("/volunteers/register", status_code=status.HTTP_201_CREATED)
def register_volunteer(body: VolunteerRegisterIn):
    c = db.conn()
    now_t = now_iso()
    cur = c.execute(
        "INSERT INTO volunteers(name, skill, resources, phone, latitude, longitude, "
        "available, responder_mode, last_location_update, status, verified, created_at, updated_at) "
        "VALUES (?,?,?,?,?,?,1,1,?, 'ACTIVE', 0, ?, ?)",
        (
            body.name,
            body.skill.upper(),
            body.resources,
            body.phone,
            body.latitude,
            body.longitude,
            now_t,
            now_t,
            now_t,
        ),
    )
    vid = cur.lastrowid
    row = dict(c.execute("SELECT * FROM volunteers WHERE id=?", (vid,)).fetchone())
    c.commit()
    c.close()
    return {"id": vid, **row}


class VolunteerLocationIn(BaseModel):
    latitude: float = Field(..., ge=-90.0, le=90.0)
    longitude: float = Field(..., ge=-180.0, le=180.0)


@app.post("/volunteers/{volunteer_id}/location")
def update_volunteer_location(volunteer_id: int, body: VolunteerLocationIn):
    c = db.conn()
    row = c.execute("SELECT * FROM volunteers WHERE id=?", (volunteer_id,)).fetchone()
    if not row:
        c.close()
        raise HTTPException(404, "Volunteer not found")

    # Only update location if responder has opted into sharing
    if not row["responder_mode"] or not row["available"]:
        c.close()
        return {"status": "skipped", "reason": "Location sharing is paused when inactive"}

    now_t = now_iso()
    c.execute(
        "UPDATE volunteers SET latitude=?, longitude=?, last_location_update=?, updated_at=? WHERE id=?",
        (body.latitude, body.longitude, now_t, now_t, volunteer_id),
    )
    c.commit()
    c.close()
    return {"status": "updated", "latitude": body.latitude, "longitude": body.longitude, "updatedAt": now_t}


class VolunteerAvailabilityIn(BaseModel):
    available: bool
    responderMode: bool


@app.post("/volunteers/{volunteer_id}/availability")
def set_volunteer_availability(volunteer_id: int, body: VolunteerAvailabilityIn):
    c = db.conn()
    row = c.execute("SELECT * FROM volunteers WHERE id=?", (volunteer_id,)).fetchone()
    if not row:
        c.close()
        raise HTTPException(404, "Volunteer not found")

    c.execute(
        "UPDATE volunteers SET available=?, responder_mode=?, updated_at=? WHERE id=?",
        (int(body.available), int(body.responderMode), now_iso(), volunteer_id),
    )
    c.commit()
    c.close()
    return {"status": "updated", "available": body.available, "responderMode": body.responderMode}


@app.get("/volunteers/nearby")
def get_nearby_volunteers(
    latitude: float = Query(..., ge=-90.0, le=90.0),
    longitude: float = Query(..., ge=-180.0, le=180.0),
    radius_km: float = 15.0,
    resource: Optional[str] = None,
):
    c = db.conn()
    rows = c.execute(
        "SELECT * FROM volunteers WHERE available=1 AND responder_mode=1 AND latitude IS NOT NULL"
    ).fetchall()
    results = []
    for r in rows:
        item = dict(r)
        if resource and resource.strip().lower() not in (item["skill"].lower() + " " + item["resources"].lower()):
            continue
        dist_m = haversine_meters(latitude, longitude, item["latitude"], item["longitude"])
        if dist_m <= radius_km * 1000.0:
            item["distanceKm"] = round(dist_m / 1000.0, 2)
            results.append(item)

    c.close()
    results.sort(key=lambda x: x["distanceKm"])
    return results


# ==========================================
# 6. Real Help Requests & Matching
# ==========================================

class HelpRequestIn(BaseModel):
    userId: Optional[int] = 1
    type: str  # Medicine, Food, Water, First Aid, Transport
    priority: Literal["LOW", "MEDIUM", "HIGH", "CRITICAL"] = "HIGH"
    latitude: float = Field(..., ge=-90.0, le=90.0)
    longitude: float = Field(..., ge=-180.0, le=180.0)


@app.post("/help-requests", status_code=status.HTTP_201_CREATED)
def request_help(body: HelpRequestIn):
    c = db.conn()
    now_t = now_iso()
    cur = c.execute(
        "INSERT INTO help_requests(user_id, type, priority, latitude, longitude, status, created_at) "
        "VALUES (?,?,?,?,?,'OPEN',?)",
        (body.userId, body.type, body.priority, body.latitude, body.longitude, now_t),
    )
    req_id = cur.lastrowid

    # Find closest available matching volunteer
    rows = c.execute(
        "SELECT * FROM volunteers WHERE available=1 AND responder_mode=1 AND latitude IS NOT NULL"
    ).fetchall()

    req_lower = body.type.strip().lower()
    best_vol = None
    best_dist = float("inf")

    for r in rows:
        v = dict(r)
        skills_str = (v.get("skill", "") + " " + v.get("resources", "")).lower()
        if req_lower in skills_str or (req_lower == "medicine" and "medicine" in skills_str):
            d = haversine_meters(body.latitude, body.longitude, v["latitude"], v["longitude"])
            if d < best_dist:
                best_dist = d
                best_vol = v

    match_result = None
    if best_vol:
        dist_km = round(best_dist / 1000.0, 2)
        eta_min = max(1, round(dist_km / 25.0 * 60))
        # Deterministic match score
        score = 80
        if dist_km <= 1.0:
            score += 18
        elif dist_km <= 3.0:
            score += 12
        elif dist_km <= 5.0:
            score += 6

        c.execute(
            "INSERT INTO matches(help_request_id, volunteer_id, distance_km, eta_minutes, match_score, status, created_at) "
            "VALUES (?,?,?,?,?,'MATCHED',?)",
            (req_id, best_vol["id"], dist_km, eta_min, score, now_t),
        )
        c.execute("UPDATE help_requests SET status='MATCHED' WHERE id=?", (req_id,))

        match_result = {
            "matched": True,
            "volunteer": {
                "id": str(best_vol["id"]),
                "name": best_vol["name"],
                "skill": best_vol["skill"],
                "resource": best_vol["resources"],
                "phone": best_vol.get("phone"),
                "latitude": best_vol["latitude"],
                "longitude": best_vol["longitude"],
            },
            "distanceKm": dist_km,
            "etaMinutes": eta_min,
            "matchScore": score,
            "matchedAt": now_t,
        }
    else:
        match_result = {
            "matched": False,
            "message": "No matching volunteer currently available within your area.",
        }

    c.commit()
    c.close()

    return {
        "requestId": req_id,
        "type": body.type,
        "priority": body.priority,
        "match": match_result,
        "createdAt": now_t,
    }


# ==========================================
# 7. Real-Time Telemetry Bundle (/sync)
# ==========================================

@app.get("/sync")
async def sync_telemetry(
    latitude: float = Query(..., ge=-90.0, le=90.0),
    longitude: float = Query(..., ge=-180.0, le=180.0),
):
    """Synchronizes live risk, weather, incidents, and responder presence in a single atomic payload."""
    try:
        weather = await weather_provider.get_weather(latitude, longitude)
    except Exception:
        weather = None

    c = db.conn()
    inc_rows = c.execute(
        "SELECT * FROM incidents WHERE status IN ('REPORTED', 'VERIFIED') ORDER BY id DESC"
    ).fetchall()
    incidents = []
    for r in inc_rows:
        item = dict(r)
        item["trustScore"] = compute_trust(c, item)
        item["confidence"] = confidence_label(item["trustScore"])
        incidents.append(item)

    vol_rows = c.execute(
        "SELECT id, name, skill, resources, latitude, longitude, available, last_location_update "
        "FROM volunteers WHERE available=1 AND responder_mode=1 AND latitude IS NOT NULL"
    ).fetchall()
    volunteers = [dict(v) for v in vol_rows]

    risk_eval = compute_flood_risk(weather, incidents) if weather else {
        "risk_score": 0,
        "risk_level": "LOW",
        "weather_source": "Unavailable",
        "rainfall_24h_mm": 0.0,
        "rainfall_intensity_mm_per_hour": 0.0,
        "warning_level": "NONE",
        "reason": "Telemetry pending",
    }

    c.close()

    return {
        "timestamp": now_iso(),
        "risk": risk_eval,
        "weather": weather.model_dump() if weather else None,
        "incidents": incidents,
        "volunteers": volunteers,
    }
