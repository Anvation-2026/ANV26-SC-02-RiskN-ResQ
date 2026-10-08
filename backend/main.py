import json
import logging
import math
import os
import re
import secrets
from contextlib import asynccontextmanager
from pathlib import Path
from typing import List, Literal, Optional, Tuple, Union

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request, status
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field, field_validator, model_validator

import auth
import config
import db
from engine import (
    _km,
    compute_flood_risk,
    compute_risk,
    compute_trust,
    confidence_label,
    haversine_meters,
    now_iso,
    refresh_all,
    refresh_zone,
    select_best_valid_route,
    similar_count,
)
from providers.routing.base import RoutePoint
from providers.routing.router import CompositeRoutingProvider
from providers.weather.imd import IMDProvider
from providers.weather.open_meteo import OpenMeteoProvider

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("risknresq")

DATA_NOTICE = "Prototype system: readings can include admin-simulated rainfall (marked SIMULATED). Not a real-time hazard forecast or official warning."

# Incident photos are stored on local disk (demo-safe; use object storage in production).
PHOTO_DIR = Path(os.environ.get("RISKNRESQ_UPLOADS", Path(__file__).parent / "uploads"))
MAX_PHOTO_BYTES = 5 * 1024 * 1024
PHOTO_TYPES = {"jpg": "image/jpeg", "png": "image/png", "webp": "image/webp"}


# --- Photo storage: the ONLY three places that touch the disk. The database stores just the file name.
# To move to cloud object storage later (S3, GCS...), replace these three functions; nothing else changes.
def store_photo(name: str, data: bytes) -> None:
    PHOTO_DIR.mkdir(parents=True, exist_ok=True)
    (PHOTO_DIR / name).write_bytes(data)


def photo_file(name: str):
    """Path of a stored photo, or None if it is missing."""
    path = PHOTO_DIR / name if name else None
    return path if path and path.is_file() else None


def purge_photos() -> None:
    """Delete all incident photos (used by the demo reset, which also deletes the incidents)."""
    if PHOTO_DIR.is_dir():
        for f in PHOTO_DIR.glob("incident_*"):
            f.unlink(missing_ok=True)

IncidentType = Literal["FLOOD", "BLOCKED_ROAD", "FLOODED_ROAD", "WATERLOGGING", "FALLEN_TREE", "TRAFFIC_OBSTRUCTION", "EMERGENCY", "OTHER"]
IncidentStatus = Literal["REPORTED", "VERIFIED", "REJECTED", "RESOLVED"]
Priority = Literal["LOW", "MEDIUM", "HIGH", "CRITICAL"]
HELP_TYPES = ("MEDICINE", "FOOD", "WATER", "FIRST_AID", "EVACUATION", "TRANSPORT")
HELP_ALIASES = {"EVACUATION_ASSISTANCE": "EVACUATION", "FIRSTAID": "FIRST_AID"}


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init_db(reset=False)
    auth.ensure_admin()
    logger.info("Database initialized. Ready for real telemetry.")
    yield


app = FastAPI(
    title="RiskNResQ Real-Data API",
    description="Production Disaster Early Warning & Incident-Aware Community Response API with Authentication",
    version="2.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Instantiate production providers
weather_provider = (
    IMDProvider(config.IMD_API_KEY) if config.IMD_API_KEY else OpenMeteoProvider()
)
routing_provider = CompositeRoutingProvider(config.GOOGLE_ROUTES_API_KEY)


# ---------- Exception Handlers ----------

@app.exception_handler(RequestValidationError)
async def validation_error(_: Request, exc: RequestValidationError):
    errors = jsonable_encoder(exc.errors(), custom_encoder={Exception: str})
    msg = "; ".join(f"{'.'.join(str(p) for p in e['loc'] if p != 'body')}: {e['msg']}" for e in errors)
    return JSONResponse(status_code=422, content={"detail": f"Invalid request: {msg}", "errors": errors})


async def database_error(_: Request, exc: Exception):
    logger.exception("database error")
    return JSONResponse(status_code=500, content={"detail": "Database error. Nothing was saved; please retry.", "error": "database"})


for _db_error in db.DB_ERRORS:  # SQLite and PostgreSQL errors both become a clean JSON 500
    app.add_exception_handler(_db_error, database_error)


# ---------- Helpers & Serializers ----------

def norm(value):
    return value.strip().upper().replace(" ", "_").replace("-", "_") if isinstance(value, str) else value


def one(c, table: str, row_id: int, label: str):
    row = c.execute(f"SELECT * FROM {table} WHERE id=?", (row_id,)).fetchone()
    if not row:
        raise HTTPException(404, f"{label} {row_id} not found")
    return row


def require_zone(zone: Optional[str]):
    if zone is not None and zone not in db.ZONES:
        raise HTTPException(404, f"Unknown zone '{zone}'. Valid zones: {list(db.ZONES)}")


def incident_out(c, r, include_user: bool = False) -> dict:
    d = dict(r)
    d["trust_score"] = compute_trust(c, d)
    d["similar_reports"] = similar_count(c, d)
    d["confidence"] = confidence_label(d["trust_score"])
    d["user_id"] = d.get("user_id") if include_user else None
    d["has_photo"] = bool(d.pop("photo_file", None))  # the stored file name stays server-side
    return d


def road_out(r) -> dict:
    return {"id": r["id"], "name": r["name"], "coordinates": json.loads(r["coordinates"]), "status": r["status"]}


def alert_out(r) -> dict:
    d = dict(r)
    return {
        "id": d["id"],
        "severity": d["severity"],
        "message": d["message"],
        "affected_zone": d.get("affected_zone"),
        "affected_road": d.get("affected_road"),
        "reason": d.get("reason"),
        "risk_score": d.get("risk_score"),
        "source": d.get("source", "SYSTEM"),
        "active": bool(d["active"]),
        "created_at": d["created_at"],
        "updated_at": d.get("updated_at"),
    }


def volunteer_public(r) -> dict:
    d = dict(r)
    return {
        "id": d["id"],
        "name": d["name"],
        "skill": d["skill"],
        "latitude": d["latitude"],
        "longitude": d["longitude"],
        "available": bool(d["available"]) and d.get("status", "ACTIVE") == "ACTIVE",
    }


def volunteer_full(c, r) -> dict:
    d = dict(r)
    u = c.execute("SELECT email, phone, is_active FROM users WHERE id=?", (d["user_id"],)).fetchone() if d.get("user_id") else None
    return {
        **volunteer_public(d),
        "status": d.get("status", "ACTIVE"),
        "user_id": d.get("user_id"),
        "email": u["email"] if u else None,
        "phone": u["phone"] if u else d.get("phone"),
        "has_login": bool(u),
    }


def match_out(c, m) -> dict:
    d = dict(m)
    v = c.execute("SELECT name, skill FROM volunteers WHERE id=?", (d["volunteer_id"],)).fetchone()
    r = c.execute("SELECT type, priority FROM help_requests WHERE id=?", (d["help_request_id"],)).fetchone()
    return {
        **d,
        "volunteer_name": v["name"] if v else None,
        "request_type": r["type"] if r else None,
        "request_priority": r["priority"] if r else None,
    }


# ==========================================
# 1. Health & Provider Checks
# ==========================================

@app.get("/health")
def health():
    try:
        with db.session() as c:
            c.execute("SELECT 1").fetchone()
        return {"status": "ok", "database": "ok"}
    except Exception:
        return JSONResponse(status_code=503, content={"status": "degraded", "database": "unavailable"})


@app.get("/health/providers")
async def health_providers():
    c = db.conn()
    db_ok = bool(c.execute("SELECT 1").fetchone())
    c.close()

    weather_ok = False
    try:
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
# 2. Authentication & Accounts
# ==========================================

PHONE_RE = re.compile(r"^[0-9+()\- ]{7,20}$")


def clean_email(v):
    v = v.strip().lower() if isinstance(v, str) else v
    if not isinstance(v, str) or not auth.EMAIL_RE.match(v) or len(v) > 254:
        raise ValueError("must be a valid email address")
    return v


def clean_phone(v):
    if v is None or (isinstance(v, str) and not v.strip()):
        return None
    if not isinstance(v, str) or not PHONE_RE.match(v.strip()):
        raise ValueError("must be a valid phone number")
    return v.strip()


class RegisterIn(BaseModel):
    model_config = {"extra": "forbid"}
    name: str = Field(..., min_length=1, max_length=80)
    email: str
    password: str = Field(..., min_length=8, max_length=128)
    confirm_password: Optional[str] = Field(None, max_length=128)
    phone: Optional[str] = None

    _email = field_validator("email", mode="before")(clean_email)
    _phone = field_validator("phone", mode="before")(clean_phone)

    @field_validator("name")
    @classmethod
    def _name(cls, v):
        v = v.strip()
        if not v:
            raise ValueError("must not be empty")
        return v

    @model_validator(mode="after")
    def _match(self):
        if self.confirm_password is not None and self.confirm_password != self.password:
            raise ValueError("passwords do not match")
        return self


class LoginIn(BaseModel):
    email: str = Field(..., max_length=254)
    password: str = Field(..., min_length=1, max_length=128)


@app.post("/auth/register", status_code=status.HTTP_201_CREATED)
def register(body: RegisterIn):
    with db.session() as c:
        if c.execute("SELECT 1 FROM users WHERE LOWER(email)=?", (body.email.strip().lower(),)).fetchone():
            raise HTTPException(409, "An account with this email already exists.")
        cur = c.execute(
            "INSERT INTO users(name, role, email, password_hash, phone, created_at, is_active) "
            "VALUES(?,?,?,?,?,?,1)",
            (body.name, auth.ROLE_USER, body.email.strip().lower(), auth.hash_password(body.password), body.phone, db.now()),
        )
        row = one(c, "users", cur.lastrowid, "User")
        return auth.user_public(row)


@app.post("/auth/login")
def login(body: LoginIn):
    email = body.email.strip().lower()
    if auth.throttled(email):
        raise HTTPException(429, "Too many failed attempts. Please wait a few minutes and try again.")
    with db.session() as c:
        row = c.execute("SELECT * FROM users WHERE LOWER(email)=?", (email,)).fetchone()
        ok = auth.verify_password(body.password, row["password_hash"] if row else auth._DUMMY_HASH)
        if not row or not ok:
            auth.record_failure(email)
            raise HTTPException(401, "Invalid email or password.")
        if not row["is_active"]:
            raise HTTPException(403, "This account has been disabled. Contact an administrator.")
        token, expires = auth.create_session(c, row["id"])
        user = auth.user_public(row)
    auth.clear_failures(email)
    return {"token": token, "token_type": "bearer", "expires_at": expires, "user": user}


@app.get("/auth/me")
def me(user: dict = Depends(auth.current_user)):
    with db.session() as c:
        out = auth.user_public(user)
        if user["role"] == auth.ROLE_VOLUNTEER:
            v = c.execute("SELECT * FROM volunteers WHERE user_id=?", (user["id"],)).fetchone()
            out["volunteer"] = volunteer_full(c, v) if v else None
        return out


@app.post("/auth/logout")
def logout(token: str = Depends(auth.current_token), user: dict = Depends(auth.current_user)):
    with db.session() as c:
        auth.revoke_token(c, token)
    return {"status": "logged out"}


# ==========================================
# 3. Environmental Telemetry & Risk
# ==========================================

@app.get("/risk")
async def get_risk(
    latitude: Optional[float] = Query(None, ge=-90.0, le=90.0),
    longitude: Optional[float] = Query(None, ge=-180.0, le=180.0),
    zone: Optional[str] = None,
):
    """Calculates real multi-factor flood risk from live weather and community incident density.
    Supports coordinate queries (live weather) as well as zone queries (analytical model).
    """
    if latitude is not None and longitude is not None:
        try:
            weather = await weather_provider.get_weather(latitude, longitude)
        except Exception as e:
            logger.warning(f"Weather provider error: {e}")
            raise HTTPException(status_code=503, detail="Weather data temporarily unavailable.")

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
            "overall": risk_eval,
            "zones": [risk_eval],
        }

    # Zone query support
    require_zone(zone)
    with db.session() as c:
        risks = [compute_risk(c, z) for z in ([zone] if zone else list(db.ZONES))]
    if zone:
        return {**risks[0], "notice": DATA_NOTICE}
    return {"overall": max(risks, key=lambda r: r["risk_score"]), "zones": risks, "notice": DATA_NOTICE}


# ==========================================
# 4. Incident Reporting & Verification
# ==========================================

class IncidentCreate(BaseModel):
    type: IncidentType
    latitude: float = Field(..., ge=-90.0, le=90.0)
    longitude: float = Field(..., ge=-180.0, le=180.0)
    radiusMeters: Optional[float] = Field(50.0, ge=10.0, le=500.0)
    description: Optional[str] = Field("", max_length=500)
    severity: int = Field(3, ge=1, le=5)
    reportedBy: Optional[str] = "Citizen"
    photoUrl: Optional[str] = None
    user_id: Optional[int] = None

    _norm_type = field_validator("type", mode="before")(norm)


@app.post("/incidents", status_code=status.HTTP_201_CREATED)
def report_incident(body: IncidentCreate, user: dict = Depends(auth.current_user)):
    zone = db.nearest_zone(body.latitude, body.longitude)
    now_t = db.now()
    with db.session() as c:
        cur = c.execute(
            "INSERT INTO incidents(type, latitude, longitude, radius_meters, description, severity, "
            "trust_score, status, reported_by, photo_url, zone, user_id, timestamp, updated_at) "
            "VALUES (?,?,?,?,?,?,50,'REPORTED',?,?,?,?,?,?)",
            (
                body.type,
                body.latitude,
                body.longitude,
                body.radiusMeters or 50.0,
                (body.description or "").strip(),
                body.severity,
                body.reportedBy or user["name"],
                body.photoUrl,
                zone,
                user["id"],
                now_t,
                now_t,
            ),
        )
        inc_id = cur.lastrowid
        row = one(c, "incidents", inc_id, "Incident")
        trust = compute_trust(c, dict(row))
        c.execute("UPDATE incidents SET trust_score=? WHERE id=?", (trust, inc_id))
        out = incident_out(c, one(c, "incidents", inc_id, "Incident"), include_user=user["role"] == auth.ROLE_ADMIN)
        risk = refresh_zone(c, zone)
    return {**out, "zone_risk": risk}


@app.get("/incidents")
def list_incidents(
    latitude: Optional[float] = None,
    longitude: Optional[float] = None,
    radius_km: float = 25.0,
    status: Optional[IncidentStatus] = None,
    type: Optional[IncidentType] = None,
    limit: int = Query(200, ge=1, le=500),
    user: dict = Depends(auth.current_user),
):
    c = db.conn()
    q = "SELECT * FROM incidents WHERE 1=1"
    args = []
    if status:
        q += " AND status=?"
        args.append(status)
    if type:
        q += " AND type=?"
        args.append(type)

    rows = c.execute(q + " ORDER BY id DESC LIMIT ?", [*args, limit]).fetchall()
    out = []
    for r in rows:
        item = dict(r)
        if latitude is not None and longitude is not None:
            dist = haversine_meters(latitude, longitude, item["latitude"], item["longitude"])
            if dist > radius_km * 1000.0:
                continue
        out.append(incident_out(c, item, include_user=user["role"] == auth.ROLE_ADMIN))

    c.close()
    return out


def sniff_image(data: bytes):
    """Decide the type from the file's own bytes (the client-sent type is never trusted)."""
    if data.startswith(b"\xff\xd8\xff"):
        return "jpg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    return None


def _own_incident(c, incident_id: int, user: dict):
    r = one(c, "incidents", incident_id, "Incident")
    if user["role"] != auth.ROLE_ADMIN and r["user_id"] != user["id"]:
        raise HTTPException(404, f"Incident {incident_id} not found")
    return r


@app.post("/incidents/{incident_id}/photo", status_code=201)
async def upload_incident_photo(incident_id: int, request: Request, user: dict = Depends(auth.current_user)):
    """Raw image bytes in the request body (JPEG, PNG or WebP, max 5 MB). Reporter or admin only; one photo per incident."""
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > MAX_PHOTO_BYTES:
        raise HTTPException(413, "Photo is too large (max 5 MB).")
    data = await request.body()
    if not data:
        raise HTTPException(422, "No image data received.")
    if len(data) > MAX_PHOTO_BYTES:
        raise HTTPException(413, "Photo is too large (max 5 MB).")
    ext = sniff_image(data)
    if not ext:
        raise HTTPException(415, "Unsupported file. Please upload a JPEG, PNG or WebP image.")
    with db.session() as c:
        r = _own_incident(c, incident_id, user)
        if r["photo_file"]:
            raise HTTPException(409, "This incident already has a photo.")
        name = f"incident_{incident_id}_{secrets.token_hex(8)}.{ext}"  # server-chosen name: no client path ever used
        store_photo(name, data)
        c.execute("UPDATE incidents SET photo_file=? WHERE id=?", (name, incident_id))
    return {"incident_id": incident_id, "stored": True, "content_type": PHOTO_TYPES[ext], "size_bytes": len(data)}


@app.get("/incidents/{incident_id}/photo")
def get_incident_photo(incident_id: int, user: dict = Depends(auth.current_user)):
    with db.session() as c:
        r = _own_incident(c, incident_id, user)
        name = r["photo_file"]
    path = photo_file(name)
    if not path:
        raise HTTPException(404, "This incident has no photo.")
    return FileResponse(path, media_type=PHOTO_TYPES.get(path.suffix.lstrip("."), "application/octet-stream"),
                        headers={"X-Content-Type-Options": "nosniff", "Cache-Control": "private, max-age=300"})


@app.get("/incidents/{incident_id}")
def get_incident(incident_id: int, user: dict = Depends(auth.current_user)):
    with db.session() as c:
        return incident_out(c, one(c, "incidents", incident_id, "Incident"), user["role"] == auth.ROLE_ADMIN)


class StatusIn(BaseModel):
    status: IncidentStatus
    _norm = field_validator("status", mode="before")(norm)


def _set_incident_status(incident_id: int, status_val: str):
    with db.session() as c:
        r = one(c, "incidents", incident_id, "Incident")
        c.execute("UPDATE incidents SET status=?, updated_at=? WHERE id=?", (status_val, db.now(), incident_id))
        zone = dict(r).get("zone") or db.nearest_zone(r["latitude"], r["longitude"])
        risk = refresh_zone(c, zone)
        out = incident_out(c, one(c, "incidents", incident_id, "Incident"), include_user=True)
    return {**out, "zone_risk": risk}


@app.patch("/incidents/{incident_id}")
def update_incident(incident_id: int, body: StatusIn, _: dict = Depends(auth.require_admin)):
    return _set_incident_status(incident_id, body.status)


@app.post("/incidents/{incident_id}/verify")
def verify_incident(incident_id: int, _: dict = Depends(auth.require_admin)):
    return _set_incident_status(incident_id, "VERIFIED")


@app.post("/incidents/{incident_id}/reject")
def reject_incident(incident_id: int, _: dict = Depends(auth.require_admin)):
    return _set_incident_status(incident_id, "REJECTED")


@app.post("/incidents/{incident_id}/resolve")
def resolve_incident(incident_id: int, _: dict = Depends(auth.require_admin)):
    return _set_incident_status(incident_id, "RESOLVED")


# ==========================================
# 5. Incident-Aware Real Routing
# ==========================================

class RouteComputeIn(BaseModel):
    origin: RoutePoint
    destination: RoutePoint
    travelMode: str = "DRIVE"


@app.post("/routes/compute")
async def compute_route(body: RouteComputeIn):
    c = db.conn()
    rows = c.execute(
        "SELECT * FROM incidents WHERE status IN ('REPORTED', 'VERIFIED') ORDER BY id DESC"
    ).fetchall()
    incidents = [dict(r) for r in rows]
    for inc in incidents:
        inc["trust_score"] = compute_trust(c, inc)
    c.close()

    try:
        candidates = await routing_provider.compute_routes(body.origin, body.destination)
    except Exception as e:
        logger.warning(f"Routing provider error: {e}")
        raise HTTPException(status_code=503, detail="Routing service temporarily unavailable.")

    if not candidates:
        return {
            "success": False,
            "origin": body.origin.model_dump(),
            "destination": body.destination.model_dump(),
            "message": "No traversable route found between these locations.",
            "safetyNote": "Route calculated using available data; incident information may be outdated.",
        }

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
# 6. Volunteer Management & Dispatch
# ==========================================

class VolunteerIn(BaseModel):
    model_config = {"extra": "forbid"}
    name: str = Field(..., min_length=1, max_length=80)
    email: str
    phone: Optional[str] = None
    password: str = Field(..., min_length=8, max_length=128)
    skill: str
    latitude: float = Field(..., ge=-90, le=90)
    longitude: float = Field(..., ge=-180, le=180)
    available: bool = True

    _email = field_validator("email", mode="before")(clean_email)
    _phone = field_validator("phone", mode="before")(clean_phone)

    @field_validator("skill", mode="before")
    @classmethod
    def _skill(cls, v):
        v = HELP_ALIASES.get(norm(v), norm(v))
        if v not in HELP_TYPES:
            raise ValueError(f"must be one of {list(HELP_TYPES)}")
        return v


class VolunteerUpdate(BaseModel):
    model_config = {"extra": "forbid"}
    name: Optional[str] = Field(None, min_length=1, max_length=80)
    email: Optional[str] = None
    phone: Optional[str] = None
    password: Optional[str] = Field(None, min_length=8, max_length=128)
    skill: Optional[str] = None
    latitude: Optional[float] = Field(None, ge=-90, le=90)
    longitude: Optional[float] = Field(None, ge=-180, le=180)
    available: Optional[bool] = None
    status: Optional[Literal["ACTIVE", "DISABLED"]] = None

    @field_validator("email", mode="before")
    @classmethod
    def _e(cls, v):
        return None if v is None else clean_email(v)

    _phone = field_validator("phone", mode="before")(clean_phone)

    @field_validator("skill", mode="before")
    @classmethod
    def _skill(cls, v):
        if v is None:
            return None
        v = HELP_ALIASES.get(norm(v), norm(v))
        if v not in HELP_TYPES:
            raise ValueError(f"must be one of {list(HELP_TYPES)}")
        return v


class MyVolunteerUpdate(BaseModel):
    model_config = {"extra": "forbid"}
    available: Optional[bool] = None
    latitude: Optional[float] = Field(None, ge=-90, le=90)
    longitude: Optional[float] = Field(None, ge=-180, le=180)


def _disable_volunteer(c, v):
    c.execute("UPDATE volunteers SET status='DISABLED', available=0 WHERE id=?", (v["id"],))
    if v["user_id"]:
        c.execute("UPDATE users SET is_active=0 WHERE id=?", (v["user_id"],))
        auth.revoke_user_sessions(c, v["user_id"])
    for m in c.execute("SELECT * FROM matches WHERE volunteer_id=? AND status IN ('PROPOSED','MATCHED','ACCEPTED')", (v["id"],)).fetchall():
        c.execute("UPDATE matches SET status='CANCELLED' WHERE id=?", (m["id"],))
        c.execute("UPDATE help_requests SET status='OPEN' WHERE id=? AND status='MATCHED'", (m["help_request_id"],))


def _enable_volunteer(c, v):
    c.execute("UPDATE volunteers SET status='ACTIVE' WHERE id=?", (v["id"],))
    if v["user_id"]:
        c.execute("UPDATE users SET is_active=1 WHERE id=?", (v["user_id"],))


@app.get("/volunteers")
def list_volunteers(
    skill: Optional[str] = None,
    available: Optional[bool] = None,
    user: dict = Depends(auth.current_user),
):
    is_admin = user["role"] == auth.ROLE_ADMIN
    q, args = "SELECT * FROM volunteers WHERE 1=1", []
    if not is_admin:
        q += " AND status='ACTIVE'"
    if skill:
        q += " AND skill=?"; args.append(HELP_ALIASES.get(norm(skill), norm(skill)))
    if available is not None:
        q += " AND available=? AND status='ACTIVE'"; args.append(int(available))
    with db.session() as c:
        rows = c.execute(q + " ORDER BY id", args).fetchall()
        return [volunteer_full(c, r) if is_admin else volunteer_public(r) for r in rows]


@app.post("/volunteers", status_code=status.HTTP_201_CREATED)
def create_volunteer(body: VolunteerIn, _: dict = Depends(auth.require_admin)):
    with db.session() as c:
        if c.execute("SELECT 1 FROM users WHERE LOWER(email)=?", (body.email.strip().lower(),)).fetchone():
            raise HTTPException(409, "An account with this email already exists.")
        t = db.now()
        u = c.execute(
            "INSERT INTO users(name, role, email, password_hash, phone, created_at, is_active, latitude, longitude) "
            "VALUES(?,?,?,?,?,?,1,?,?)",
            (body.name.strip(), auth.ROLE_VOLUNTEER, body.email.strip().lower(), auth.hash_password(body.password), body.phone,
             t, body.latitude, body.longitude),
        )
        cur = c.execute(
            "INSERT INTO volunteers(name, skill, resources, phone, latitude, longitude, available, user_id, status, created_at, updated_at) "
            "VALUES(?,?,?,?,?,?,?,?,'ACTIVE',?,?)",
            (body.name.strip(), body.skill, body.skill, body.phone, body.latitude, body.longitude, int(body.available), u.lastrowid, t, t),
        )
        return volunteer_full(c, one(c, "volunteers", cur.lastrowid, "Volunteer"))


def _my_row(c, user: dict):
    v = c.execute("SELECT * FROM volunteers WHERE user_id=?", (user["id"],)).fetchone()
    if not v:
        raise HTTPException(404, "No volunteer profile is linked to this account.")
    return v


def _my_requests(c, v):
    assigned = []
    for m in c.execute("SELECT * FROM matches WHERE volunteer_id=? AND status IN ('PROPOSED','MATCHED','ACCEPTED') ORDER BY id DESC", (v["id"],)):
        r = c.execute("SELECT * FROM help_requests WHERE id=?", (m["help_request_id"],)).fetchone()
        who = c.execute("SELECT name, phone FROM users WHERE id=?", (r["user_id"],)).fetchone() if r and dict(r).get("user_id") else None
        dist = None
        if None not in (r["latitude"], r["longitude"], v["latitude"], v["longitude"]):
            dist = round(_km(v["latitude"], v["longitude"], r["latitude"], r["longitude"]), 2)
        assigned.append({
            "match_id": m["id"],
            "match_status": m["status"],
            "request_id": r["id"],
            "type": r["type"],
            "priority": r["priority"],
            "status": r["status"],
            "latitude": r["latitude"],
            "longitude": r["longitude"],
            "distance_km": dist,
            "created_at": r["created_at"],
            "requester_name": who["name"] if who else None,
            "requester_phone": who["phone"] if who else None,
        })
    nearby = []
    if v["status"] == "ACTIVE":
        for r in c.execute("SELECT * FROM help_requests WHERE status='OPEN' AND type=? ORDER BY id DESC", (v["skill"],)):
            if None in (r["latitude"], r["longitude"], v["latitude"], v["longitude"]):
                continue
            d = round(_km(v["latitude"], v["longitude"], r["latitude"], r["longitude"]), 2)
            if d <= 15:
                nearby.append({
                    "request_id": r["id"],
                    "type": r["type"],
                    "priority": r["priority"],
                    "distance_km": d,
                    "created_at": r["created_at"],
                })
        nearby.sort(key=lambda x: x["distance_km"])
    return assigned, nearby


@app.get("/volunteers/me")
def my_volunteer(user: dict = Depends(auth.require_volunteer)):
    with db.session() as c:
        v = _my_row(c, user)
        assigned, nearby = _my_requests(c, v)
        return {"volunteer": volunteer_full(c, v), "assigned_count": len(assigned), "nearby_open_count": len(nearby)}


@app.patch("/volunteers/me")
def update_my_volunteer(body: MyVolunteerUpdate, user: dict = Depends(auth.require_volunteer)):
    with db.session() as c:
        v = _my_row(c, user)
        if v["status"] != "ACTIVE":
            raise HTTPException(403, "This volunteer account is disabled.")
        sets = {k: val for k, val in body.model_dump().items() if val is not None}
        if "available" in sets:
            sets["available"] = int(sets["available"])
        if sets:
            c.execute("UPDATE volunteers SET " + ", ".join(f"{k}=?" for k in sets) + " WHERE id=?", [*sets.values(), v["id"]])
        return volunteer_full(c, one(c, "volunteers", v["id"], "Volunteer"))


@app.get("/volunteers/me/requests")
def my_requests(user: dict = Depends(auth.require_volunteer)):
    with db.session() as c:
        assigned, nearby = _my_requests(c, _my_row(c, user))
        return {"assigned": assigned, "nearby_open": nearby}


@app.put("/volunteers/{volunteer_id}")
def update_volunteer(volunteer_id: int, body: VolunteerUpdate, _: dict = Depends(auth.require_admin)):
    with db.session() as c:
        v = one(c, "volunteers", volunteer_id, "Volunteer")
        d = body.model_dump(exclude_unset=True)
        if "email" in d and d["email"] is not None and v["user_id"]:
            clash = c.execute("SELECT id FROM users WHERE LOWER(email)=? AND id!=?", (d["email"].strip().lower(), v["user_id"])).fetchone()
            if clash:
                raise HTTPException(409, "An account with this email already exists.")
        vol_cols = {k: d[k] for k in ("name", "skill", "latitude", "longitude") if d.get(k) is not None}
        if d.get("available") is not None:
            vol_cols["available"] = int(d["available"])
        if vol_cols:
            c.execute("UPDATE volunteers SET " + ", ".join(f"{k}=?" for k in vol_cols) + " WHERE id=?", [*vol_cols.values(), volunteer_id])
        if v["user_id"]:
            user_cols = {k: d[k] for k in ("name", "email", "phone") if k in d and (d[k] is not None or k == "phone")}
            if d.get("password"):
                user_cols["password_hash"] = auth.hash_password(d["password"])
            if user_cols:
                c.execute("UPDATE users SET " + ", ".join(f"{k}=?" for k in user_cols) + " WHERE id=?", [*user_cols.values(), v["user_id"]])
                if "password_hash" in user_cols:
                    auth.revoke_user_sessions(c, v["user_id"])
        elif any(k in d and d[k] for k in ("email", "password")):
            raise HTTPException(422, "This is a demo roster entry without a login; email and password cannot be set.")
        if d.get("status") == "DISABLED":
            _disable_volunteer(c, one(c, "volunteers", volunteer_id, "Volunteer"))
        elif d.get("status") == "ACTIVE":
            _enable_volunteer(c, one(c, "volunteers", volunteer_id, "Volunteer"))
        return volunteer_full(c, one(c, "volunteers", volunteer_id, "Volunteer"))


@app.delete("/volunteers/{volunteer_id}")
def delete_volunteer(volunteer_id: int, _: dict = Depends(auth.require_admin)):
    with db.session() as c:
        v = one(c, "volunteers", volunteer_id, "Volunteer")
        _disable_volunteer(c, v)
        return volunteer_full(c, one(c, "volunteers", volunteer_id, "Volunteer"))


# Production Public Volunteer Helpers
class VolunteerRegisterIn(BaseModel):
    name: str
    skill: str
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
        (body.name, body.skill.upper(), body.resources, body.phone, body.latitude, body.longitude, now_t, now_t, now_t),
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
        "SELECT * FROM volunteers WHERE available=1 AND (responder_mode=1 OR responder_mode IS NULL) AND latitude IS NOT NULL"
    ).fetchall()
    results = []
    for r in rows:
        item = dict(r)
        if resource and resource.strip().lower() not in (item["skill"].lower() + " " + item.get("resources", "").lower()):
            continue
        dist_m = haversine_meters(latitude, longitude, item["latitude"], item["longitude"])
        if dist_m <= radius_km * 1000.0:
            item["distanceKm"] = round(dist_m / 1000.0, 2)
            results.append(item)

    c.close()
    results.sort(key=lambda x: x["distanceKm"])
    return results


# ==========================================
# 7. Help Requests & Matching
# ==========================================

class HelpIn(BaseModel):
    type: str
    priority: Priority = "MEDIUM"
    latitude: Optional[float] = Field(None, ge=-90, le=90)
    longitude: Optional[float] = Field(None, ge=-180, le=180)

    _norm_p = field_validator("priority", mode="before")(norm)

    @field_validator("type", mode="before")
    @classmethod
    def _type(cls, v):
        v = HELP_ALIASES.get(norm(v), norm(v))
        if v not in HELP_TYPES:
            raise ValueError(f"must be one of {list(HELP_TYPES)}")
        return v

    @model_validator(mode="after")
    def _both_coords(self):
        if (self.latitude is None) != (self.longitude is None):
            raise ValueError("latitude and longitude must be given together")
        return self


def request_visible(c, user: dict, r) -> bool:
    if user["role"] == auth.ROLE_ADMIN or r["user_id"] == user["id"]:
        return True
    if user["role"] == auth.ROLE_VOLUNTEER:
        return bool(c.execute(
            "SELECT 1 FROM matches m JOIN volunteers v ON v.id=m.volunteer_id "
            "WHERE m.help_request_id=? AND v.user_id=? AND m.status!='CANCELLED'", (r["id"], user["id"])).fetchone())
    return False


@app.post("/help-request", status_code=status.HTTP_201_CREATED)
def create_help(body: HelpIn, user: dict = Depends(auth.current_user)):
    with db.session() as c:
        cur = c.execute(
            "INSERT INTO help_requests(user_id,type,priority,latitude,longitude,status,created_at) "
            "VALUES(?,?,?,?,?,'OPEN',?)",
            (user["id"], body.type, body.priority, body.latitude, body.longitude, db.now()),
        )
        row = dict(one(c, "help_requests", cur.lastrowid, "Help request"))
    return {"request_id": row["id"], **row}


class HelpRequestIn(BaseModel):
    userId: Optional[int] = 1
    type: str
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

    rows = c.execute(
        "SELECT * FROM volunteers WHERE available=1 AND latitude IS NOT NULL"
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
                "resource": best_vol.get("resources", best_vol["skill"]),
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


@app.get("/help-requests")
def list_help(status: Optional[Literal["OPEN", "MATCHED", "COMPLETED"]] = None, user: dict = Depends(auth.current_user)):
    q, args = "SELECT * FROM help_requests WHERE 1=1", []
    if status:
        q += " AND status=?"; args.append(status)
    with db.session() as c:
        rows = c.execute(q + " ORDER BY id DESC", args).fetchall()
        return [dict(r) for r in rows if request_visible(c, user, r)]


@app.get("/help-requests/{request_id}")
def get_help(request_id: int, user: dict = Depends(auth.current_user)):
    with db.session() as c:
        r = one(c, "help_requests", request_id, "Help request")
        if not request_visible(c, user, r):
            raise HTTPException(404, f"Help request {request_id} not found")
        return dict(r)


# ---------- Matches ----------

class MatchIn(BaseModel):
    help_request_id: int = Field(..., ge=1)
    volunteer_id: int = Field(..., ge=1)


@app.get("/matches")
def list_matches(help_request_id: Optional[int] = None, user: dict = Depends(auth.current_user)):
    q, args = "SELECT * FROM matches WHERE 1=1", []
    if help_request_id is not None:
        q += " AND help_request_id=?"; args.append(help_request_id)
    with db.session() as c:
        out = []
        for m in c.execute(q + " ORDER BY id DESC", args).fetchall():
            if user["role"] == auth.ROLE_ADMIN:
                ok = True
            elif user["role"] == auth.ROLE_VOLUNTEER:
                ok = bool(c.execute("SELECT 1 FROM volunteers WHERE id=? AND user_id=?", (m["volunteer_id"], user["id"])).fetchone())
            else:
                ok = bool(c.execute("SELECT 1 FROM help_requests WHERE id=? AND user_id=?", (m["help_request_id"], user["id"])).fetchone())
            if ok:
                out.append(match_out(c, m))
        return out


@app.post("/matches", status_code=status.HTTP_201_CREATED)
def create_match(body: MatchIn, user: dict = Depends(auth.current_user)):
    with db.session() as c:
        r = one(c, "help_requests", body.help_request_id, "Help request")
        if user["role"] != auth.ROLE_ADMIN and r["user_id"] != user["id"]:
            raise HTTPException(404, f"Help request {body.help_request_id} not found")
        v = one(c, "volunteers", body.volunteer_id, "Volunteer")
        if c.execute("SELECT 1 FROM matches WHERE help_request_id=? AND status!='CANCELLED'", (body.help_request_id,)).fetchone():
            raise HTTPException(409, f"Help request {body.help_request_id} already has a match")
        if v["status"] != "ACTIVE" or not v["available"]:
            raise HTTPException(409, "That volunteer is not available.")
        if v["skill"].upper() != r["type"].upper():
            raise HTTPException(422, f"Volunteer skill {v['skill']} does not match the requested {r['type']}.")
        cur = c.execute(
            "INSERT INTO matches(help_request_id,volunteer_id,status,created_at) VALUES(?,?,'PROPOSED',?)",
            (body.help_request_id, body.volunteer_id, db.now()),
        )
        c.execute("UPDATE help_requests SET status='MATCHED' WHERE id=?", (body.help_request_id,))
        return match_out(c, one(c, "matches", cur.lastrowid, "Match"))


def _match_action(match_id: int, user: dict, expect: str, new_status: str):
    with db.session() as c:
        m = one(c, "matches", match_id, "Match")
        if user["role"] != auth.ROLE_ADMIN:
            mine = c.execute("SELECT 1 FROM volunteers WHERE id=? AND user_id=?", (m["volunteer_id"], user["id"])).fetchone()
            if not mine:
                raise HTTPException(404, f"Match {match_id} not found")
        allowed = (expect,) if isinstance(expect, str) else tuple(expect)
        if m["status"] not in allowed:
            raise HTTPException(409, f"Match is {m['status']}; it must be {' or '.join(allowed)} to do this.")
        c.execute("UPDATE matches SET status=? WHERE id=?", (new_status, match_id))
        if new_status == "COMPLETED":
            c.execute("UPDATE help_requests SET status='COMPLETED' WHERE id=?", (m["help_request_id"],))
        return match_out(c, one(c, "matches", match_id, "Match"))


@app.post("/matches/{match_id}/accept")
def accept_match(match_id: int, user: dict = Depends(auth.require_roles(auth.ROLE_VOLUNTEER, auth.ROLE_ADMIN))):
    # matches saved by help-request matching start as MATCHED; manually proposed ones as PROPOSED
    return _match_action(match_id, user, ("PROPOSED", "MATCHED"), "ACCEPTED")


@app.post("/matches/{match_id}/complete")
def complete_match(match_id: int, user: dict = Depends(auth.require_roles(auth.ROLE_VOLUNTEER, auth.ROLE_ADMIN))):
    return _match_action(match_id, user, "ACCEPTED", "COMPLETED")


# ==========================================
# 8. Admin Control & Summary
# ==========================================

@app.get("/admin/summary")
def admin_summary(_: dict = Depends(auth.require_admin)):
    with db.session() as c:
        risks = [compute_risk(c, z) for z in db.ZONES]
        n = lambda q: c.execute(q).fetchone()[0]  # noqa: E731
        roads_blocked = n("SELECT COUNT(*) FROM roads WHERE status='BLOCKED'") if db.table_exists(c, 'roads') else 0
        return {
            "risk": max(risks, key=lambda r: r["risk_score"]),
            "active_alerts": n("SELECT COUNT(*) FROM alerts WHERE active=1"),
            "open_incidents": n("SELECT COUNT(*) FROM incidents WHERE status='REPORTED'"),
            "blocked_roads": roads_blocked,
            "pending_help_requests": n("SELECT COUNT(*) FROM help_requests WHERE status='OPEN'"),
            "available_volunteers": n("SELECT COUNT(*) FROM volunteers WHERE status='ACTIVE' AND available=1"),
            "open_matches": n("SELECT COUNT(*) FROM matches WHERE status IN ('PROPOSED','MATCHED','ACCEPTED')"),
            "users": {role: n(f"SELECT COUNT(*) FROM users WHERE role='{role}'") for role in (auth.ROLE_USER, auth.ROLE_VOLUNTEER, auth.ROLE_ADMIN)},
            "notice": DATA_NOTICE,
        }


@app.get("/admin/users")
def admin_users(_: dict = Depends(auth.require_admin)):
    with db.session() as c:
        return [
            {
                "id": r["id"],
                "name": r["name"],
                "email": r["email"],
                "role": r["role"],
                "phone": r["phone"],
                "is_active": bool(r["is_active"]),
                "created_at": r["created_at"],
            }
            for r in c.execute("SELECT * FROM users ORDER BY id").fetchall()
        ]


class UserActiveIn(BaseModel):
    is_active: bool


@app.patch("/admin/users/{user_id}")
def admin_set_user_active(user_id: int, body: UserActiveIn, admin: dict = Depends(auth.require_admin)):
    with db.session() as c:
        u = one(c, "users", user_id, "User")
        if u["id"] == admin["id"]:
            raise HTTPException(409, "You cannot disable your own account.")
        v = c.execute("SELECT * FROM volunteers WHERE user_id=?", (user_id,)).fetchone()
        if v and not body.is_active:
            _disable_volunteer(c, v)
        elif v:
            _enable_volunteer(c, v)
        else:
            c.execute("UPDATE users SET is_active=? WHERE id=?", (int(body.is_active), user_id))
            if not body.is_active:
                auth.revoke_user_sessions(c, user_id)
        r = one(c, "users", user_id, "User")
        return {"id": r["id"], "name": r["name"], "email": r["email"], "role": r["role"], "is_active": bool(r["is_active"])}


@app.post("/reset")
def reset(_: dict = Depends(auth.require_admin)):
    db.reset_db()
    purge_photos()  # the incidents they belonged to are gone
    with db.session() as c:
        risks = refresh_all(c)
        alerts = c.execute("SELECT COUNT(*) FROM alerts WHERE active=1").fetchone()[0]
        blocked = c.execute("SELECT COUNT(*) FROM roads WHERE status='BLOCKED'").fetchone()[0] if db.table_exists(c, 'roads') else 0
    return {
        "status": "reset",
        "risk_level": max(risks, key=lambda r: r["risk_score"])["risk_level"],
        "active_alerts": alerts,
        "blocked_roads": blocked,
    }


# ==========================================
# 9. Roads & Alerts
# ==========================================

class AlertIn(BaseModel):
    severity: Literal["LOW", "MEDIUM", "HIGH", "CRITICAL"]
    message: str = Field(..., min_length=1, max_length=500)
    affected_zone: str

    _norm_sev = field_validator("severity", mode="before")(norm)


@app.get("/alerts")
def list_alerts(active_only: bool = False):
    q = "SELECT * FROM alerts" + (" WHERE active=1" if active_only else "") + " ORDER BY id DESC"
    with db.session() as c:
        return [alert_out(r) for r in c.execute(q).fetchall()]


@app.post("/alerts", status_code=status.HTTP_201_CREATED)
def create_alert(body: AlertIn, _: dict = Depends(auth.require_admin)):
    require_zone(body.affected_zone)
    t = db.now()
    with db.session() as c:
        cur = c.execute(
            "INSERT INTO alerts(severity,message,affected_zone,active,created_at,source,updated_at) "
            "VALUES(?,?,?,1,?,'MANUAL',?)",
            (body.severity, body.message.strip(), body.affected_zone, t, t),
        )
        return alert_out(one(c, "alerts", cur.lastrowid, "Alert"))


class SimIn(BaseModel):
    hazard: Literal["FLOOD"] = "FLOOD"
    rainfall: float = Field(..., ge=0, le=500)
    zone: Optional[str] = None

    _norm_h = field_validator("hazard", mode="before")(norm)


@app.post("/simulate-hazard")
def simulate(body: SimIn, _: dict = Depends(auth.require_admin)):
    require_zone(body.zone)
    zones = [body.zone] if body.zone else list(db.ZONES)
    results = []
    with db.session() as c:
        for z in zones:
            before = compute_risk(c, z)
            c.execute("UPDATE environment_data SET rainfall=?, updated_at=?, data_source='SIMULATED' WHERE zone=?",
                      (body.rainfall, db.now(), z))
            results.append({"zone": z, "before": before, "after": refresh_zone(c, z)})
        alerts = [alert_out(r) for r in c.execute("SELECT * FROM alerts WHERE active=1 ORDER BY id DESC").fetchall()]
    first = results[0]
    return {
        "hazard": body.hazard,
        "rainfall": body.rainfall,
        "before": first["before"],
        "after": first["after"],
        "zones": results,
        "active_alerts": alerts,
        "notice": DATA_NOTICE,
    }


@app.get("/roads")
def list_roads(status: Optional[Literal["AVAILABLE", "BLOCKED"]] = None):
    q, args = "SELECT * FROM roads", []
    if status:
        q += " WHERE status=?"; args.append(status)
    with db.session() as c:
        return [road_out(r) for r in c.execute(q + " ORDER BY id", args).fetchall()]


@app.get("/roads/{road_id}")
def get_road(road_id: int):
    with db.session() as c:
        return road_out(one(c, "roads", road_id, "Road"))


def _set_road(road_id: int, status: str):
    with db.session() as c:
        one(c, "roads", road_id, "Road")
        c.execute("UPDATE roads SET status=? WHERE id=?", (status, road_id))
        refresh_all(c)
        return road_out(one(c, "roads", road_id, "Road"))


@app.post("/roads/{road_id}/block")
def block_road(road_id: int, _: dict = Depends(auth.require_admin)):
    return _set_road(road_id, "BLOCKED")


@app.post("/roads/{road_id}/unblock")
def unblock_road(road_id: int, _: dict = Depends(auth.require_admin)):
    return _set_road(road_id, "AVAILABLE")


# ==========================================
# 10. Real-Time Telemetry Bundle (/sync)
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
        "FROM volunteers WHERE available=1 AND (responder_mode=1 OR responder_mode IS NULL) AND latitude IS NOT NULL"
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
