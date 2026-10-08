import asyncio
import json
import logging
import math
import os
import re
import time
import secrets
from contextlib import asynccontextmanager
from pathlib import Path
from typing import List, Literal, Optional, Tuple, Union

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request, status
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from pydantic import BaseModel, Field, field_validator, model_validator

import auth
import config
import db
import storage
from engine import (
    _age_hours,
    _km,
    compute_flood_risk,
    compute_risk,
    compute_trust,
    confidence_label,
    does_route_intersect_incident,
    haversine_meters,
    now_iso,
    refresh_all,
    refresh_zone,
    select_best_valid_route,
    similar_count,
    trust_factors,
)
from providers.routing.base import RoutePoint
from providers.routing.router import CompositeRoutingProvider
import audit
import engine
import flood_intel
import intel_jobs
import road_risk
import routes_intel
import routing_service
import hardening
import notify
import weather_monitor
from providers.climate.era5 import ERA5Provider
from providers.satellite.planetary import PlanetaryComputerProvider
from providers.terrain.open_meteo_dem import OpenMeteoDEMProvider
from providers.waterlevel.base import GaugeWaterLevelProvider
from providers.waterlevel.glofas import GloFASProvider
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
HELP_TYPES = (
    "MEDICINE",
    "FOOD",
    "WATER",
    "FIRST_AID",
    "EVACUATION",
    "TRANSPORT",
    "MEDICAL_EMERGENCY",
    "FLOOD_RESCUE",
    "ELDERLY_ASSISTANCE",
    "CHILD_ASSISTANCE",
    "FOOD_WATER",
    "OTHER_EMERGENCY",
)
HELP_ALIASES = {
    "EVACUATION_ASSISTANCE": "EVACUATION",
    "FIRSTAID": "FIRST_AID",
    "OTHER": "OTHER_EMERGENCY",
    "FOOD_/_WATER": "FOOD_WATER",
    "FOOD/WATER": "FOOD_WATER",
    "FOOD_AND_WATER": "FOOD_WATER",
    "ELDERLY": "ELDERLY_ASSISTANCE",
    "CHILD": "CHILD_ASSISTANCE",
    "RESCUE": "FLOOD_RESCUE",
    "MEDICINE_ASSISTANCE": "MEDICINE",
}


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init_db(reset=False)
    auth.ensure_admin()
    logger.info("Database initialized. Ready for real telemetry.")
    tasks = []
    if config.WEATHER_MONITOR_ENABLED:
        tasks.append(asyncio.create_task(weather_monitor.run_forever(weather_provider)))
    if config.INTEL_ENABLED:
        tasks.append(asyncio.create_task(intel_jobs.run_forever(intel_providers)))
    try:
        yield
    finally:
        for t in tasks:
            t.cancel()


app = FastAPI(
    title="RiskNResQ Real-Data API",
    description="Production Disaster Early Warning & Incident-Aware Community Response API with Authentication",
    version="2.1.0",
    lifespan=lifespan,
)

import routes_account
import routes_admin
app.include_router(routes_account.router)
app.include_router(routes_admin.router)
app.include_router(routes_intel.router)
if config.CORS_ORIGINS == ["*"] and hardening.TRUST_PROXY:
    logger.warning("CORS is open to every origin while TRUST_PROXY is set (a deployment): set CORS_ORIGINS to your web address.")
app.add_middleware(hardening.RateLimitMiddleware)
app.add_middleware(hardening.RequestLogMiddleware)
hardening.init_sentry()
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
routes_admin.provider = weather_provider
intel_providers = intel_jobs.Providers(
    weather=weather_provider, satellite=PlanetaryComputerProvider(), terrain=OpenMeteoDEMProvider(),
    water=[GaugeWaterLevelProvider(), GloFASProvider()], climate=ERA5Provider())
routes_intel.providers = intel_providers
routes_intel.routing_provider = routing_provider


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
    if not isinstance(value, str):
        return value
    cleaned = value.strip().upper().replace("/", "_").replace("-", "_").replace(" ", "_")
    while "__" in cleaned:
        cleaned = cleaned.replace("__", "_")
    return cleaned


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
    ctx = flood_intel.env_context(c, d["latitude"], d["longitude"])
    if ctx.get("covered"):  # how the environment at that spot compares with the report
        d["environmental_context"] = [t for ok, t in (
            (ctx["heavy_rain"], "Heavy rainfall recorded in this area"), (ctx["satellite_abnormal"], "Satellite shows abnormal water expansion here"),
            (ctx["flood_prone"], "Low-lying, flood-susceptible ground")) if ok] or ["No heavy rain or satellite evidence in this area at the moment"]
    if include_user:  # admins see why a report is (not) trusted
        d["trust_factors"] = trust_factors(c, d)
    d["user_id"] = d.get("user_id") if include_user else None
    # storage details stay server-side; clients only learn whether a photo exists (fetched via /incidents/{id}/photo)
    d["has_photo"] = bool(d.pop("photo_file", None)) | bool(d.pop("photo_url", None))
    return d


def road_out(r) -> dict:
    k = r.keys()
    return {"id": r["id"], "name": r["name"], "coordinates": json.loads(r["coordinates"]), "status": r["status"],
            "source": r["source"] if "source" in k else "SEED", "low_lying": bool(r["low_lying"]) if "low_lying" in k else False,
            "elevation_m": r["elevation"] if "elevation" in k else None}


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
        "sources": json.loads(d["sources"]) if d.get("sources") else [],
        "recommended_action": d.get("action"),
        "probability": d.get("probability"),
        "simulated": (d.get("message") or "").startswith("SIMULATED DRILL"),
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
        "quantities": json.loads(d["quantities"]) if d.get("quantities") else {},
    }


def _log_event(c, request_id: int, event: str, detail: str = "") -> None:
    """One line in a help request's timeline (REQUESTED, MATCHED, ACCEPTED, COMPLETED, ...)."""
    c.execute("INSERT INTO match_events(help_request_id, event, detail, at) VALUES(?,?,?,?)", (request_id, event, detail, db.now()))


def _tell_requester(c, request_id: int, title: str, body: str) -> None:
    r = c.execute("SELECT user_id FROM help_requests WHERE id=?", (request_id,)).fetchone()
    if r and r["user_id"]:
        notify.notify_users(c, [r["user_id"]], title, body, {"type": "help", "request_id": request_id})


def _tell_volunteer(c, volunteer_id: int, title: str, body: str, request_id: int) -> None:
    v = c.execute("SELECT user_id FROM volunteers WHERE id=?", (volunteer_id,)).fetchone()
    if v and v["user_id"]:
        notify.notify_users(c, [v["user_id"]], title, body, {"type": "match", "request_id": request_id})


# Idempotency: a client may send an `Idempotency-Key` header on POST /incidents and POST /help-requests. A retry or a double tap with the
# same key returns the first response instead of creating a second record. Kept in memory for 10 minutes per signed-in user (so it
# protects one running instance; it is not a substitute for a shared store if you run several).
_IDEM: dict = {}
IDEM_TTL_S = 600


def _idem_get(user_id: int, key: Optional[str]):
    if not key:
        return None
    now = time.time()
    for k in [k for k, (t, _) in _IDEM.items() if now - t > IDEM_TTL_S]:
        _IDEM.pop(k, None)
    hit = _IDEM.get((user_id, key[:80]))
    return hit[1] if hit else None


def _idem_put(user_id: int, key: Optional[str], response):
    if key:
        _IDEM[(user_id, key[:80])] = (time.time(), response)
    return response


ALERT_RADIUS_KM = 10.0


def _on_alert(c, alert, risk) -> None:
    """A real HIGH/CRITICAL alert was raised or escalated: push (and SMS for opted-in users) to people near that zone.
    Simulated drills never notify anyone."""
    if (alert["message"] or "").startswith("SIMULATED DRILL"):
        return
    zla, zlo = db.ZONES[alert["affected_zone"]]
    ids = notify.users_near(c, zla, zlo, ALERT_RADIUS_KM)
    notify.notify_users(c, ids, f"{alert['severity'].capitalize()} flood risk: {alert['affected_zone']}",
                        (alert["message"] or "")[:180], {"type": "alert", "alert_id": alert["id"]},
                        sms=alert["severity"] in ("HIGH", "CRITICAL"), cooldown="alert")


engine.ALERT_HOOK = _on_alert


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
        routes_account.send_verification(c, row)
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
        with db.session() as c0:
            cell0 = flood_intel.nearest_cell(c0, latitude, longitude)
            a0 = flood_intel.assess_cell(c0, cell0["zone"], near=(latitude, longitude)) if cell0 else None
            if a0 and not a0["insufficient"]:
                ev = {"latitude": latitude, "longitude": longitude, **_intel_to_risk(a0, cell0)}
                return {**ev, "overall": ev, "zones": [ev]}
        try:
            weather = await weather_provider.get_weather(latitude, longitude)
        except Exception as e:
            logger.warning(f"Weather provider error: {e}")
            raise HTTPException(status_code=503, detail="Weather data temporarily unavailable.")

        c = db.conn()
        rows = c.execute(
            "SELECT * FROM incidents WHERE duplicate_of IS NULL AND status IN ('REPORTED', 'VERIFIED') ORDER BY id DESC"
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
def report_incident(body: IncidentCreate, user: dict = Depends(auth.current_user), idempotency_key: Optional[str] = Header(None)):
    again = _idem_get(user["id"], idempotency_key)
    if again is not None:
        return again
    zone = db.nearest_zone(body.latitude, body.longitude)
    now_t = db.now()
    with db.session() as c:
        primary = None  # an existing live report of the same thing within 100 m in the last 3 h: merge instead of double-counting
        for cand in c.execute("SELECT * FROM incidents WHERE type=? AND duplicate_of IS NULL AND status IN ('REPORTED','VERIFIED') "
                              "ORDER BY id", (body.type,)).fetchall():
            if haversine_meters(body.latitude, body.longitude, cand["latitude"], cand["longitude"]) <= 100.0 \
                    and _age_hours(cand["timestamp"]) <= 3.0:
                primary = cand
                break
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
                None,  # photo_url is set only by the server after a real upload
                zone,
                user["id"],
                now_t,
                now_t,
            ),
        )
        inc_id = cur.lastrowid
        if primary:
            c.execute("UPDATE incidents SET duplicate_of=? WHERE id=?", (primary["id"], inc_id))
            c.execute("UPDATE incidents SET confirmations=confirmations+1, updated_at=? WHERE id=?", (now_t, primary["id"]))
            c.execute("UPDATE incidents SET trust_score=? WHERE id=?", (compute_trust(c, one(c, "incidents", primary["id"], "Incident")), primary["id"]))
        row = one(c, "incidents", inc_id, "Incident")
        trust = compute_trust(c, dict(row))
        c.execute("UPDATE incidents SET trust_score=? WHERE id=?", (trust, inc_id))
        out = incident_out(c, one(c, "incidents", inc_id, "Incident"), include_user=user["role"] == auth.ROLE_ADMIN)
        risk = refresh_zone(c, zone)
    return _idem_put(user["id"], idempotency_key, {**out, "zone_risk": risk, "merged_into": primary["id"] if primary else None})


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
    q = "SELECT * FROM incidents WHERE 1=1"  # duplicates stay listed (flagged duplicate_of) so owners and admins still see them
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
        if r["photo_file"] or r["photo_url"]:
            raise HTTPException(409, "This incident already has a photo.")
    name = f"incident_{incident_id}_{secrets.token_hex(8)}"  # server-chosen name: no client path ever used
    if storage.cloud_configured():
        try:
            url = await storage.upload_image(data, name, PHOTO_TYPES[ext])
        except RuntimeError:
            logger.exception("photo upload to Cloudinary failed")
            raise HTTPException(502, "Photo storage is unavailable right now. The report itself is saved; please try the photo again.")
        with db.session() as c:
            c.execute("UPDATE incidents SET photo_url=? WHERE id=?", (url, incident_id))
        where = "cloudinary"
    else:
        store_photo(f"{name}.{ext}", data)
        with db.session() as c:
            c.execute("UPDATE incidents SET photo_file=? WHERE id=?", (f"{name}.{ext}", incident_id))
        where = "local"
    return {"incident_id": incident_id, "stored": True, "storage": where, "content_type": PHOTO_TYPES[ext], "size_bytes": len(data)}


@app.get("/incidents/{incident_id}/photo")
def get_incident_photo(incident_id: int, user: dict = Depends(auth.current_user)):
    with db.session() as c:
        r = _own_incident(c, incident_id, user)
        name, cloud_url = r["photo_file"], r["photo_url"]
    if cloud_url:  # access was checked above; the image itself is served by Cloudinary's CDN (resized, not full-size)
        return RedirectResponse(storage.thumbnail_url(cloud_url), status_code=307)
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


def _set_incident_status(incident_id: int, status_val: str, actor: dict = None):
    with db.session() as c:
        r = one(c, "incidents", incident_id, "Incident")
        c.execute("UPDATE incidents SET status=?, updated_at=? WHERE id=?", (status_val, db.now(), incident_id))
        zone = dict(r).get("zone") or db.nearest_zone(r["latitude"], r["longitude"])
        risk = refresh_zone(c, zone)
        audit.record(c, actor, f"incident.{status_val.lower()}", incident_id, dict(r)["type"])
        if status_val == "VERIFIED" and dict(r)["type"] in ("FLOOD", "FLOODED_ROAD"):  # a verified report becomes local flood history
            ext = f"incident:{incident_id}"
            if not c.execute("SELECT 1 FROM historical_events WHERE external_id=?", (ext,)).fetchone():
                c.execute("INSERT INTO historical_events(latitude,longitude,event_date,kind,severity,source,notes,external_id,created_at) VALUES(?,?,?,'FLOOD',?,?,?,?,?)",
                          (r["latitude"], r["longitude"], dict(r)["timestamp"][:10], r["severity"], "RiskN ResQ verified community report",
                           "Verified by an administrator; a local report, not an official flood record", ext, db.now()))
        out = incident_out(c, one(c, "incidents", incident_id, "Incident"), include_user=True)
    return {**out, "zone_risk": risk}


@app.patch("/incidents/{incident_id}")
def update_incident(incident_id: int, body: StatusIn, admin: dict = Depends(auth.require_admin)):
    return _set_incident_status(incident_id, body.status, admin)


@app.post("/incidents/{incident_id}/verify")
def verify_incident(incident_id: int, admin: dict = Depends(auth.require_admin)):
    return _set_incident_status(incident_id, "VERIFIED", admin)


@app.post("/incidents/{incident_id}/reject")
def reject_incident(incident_id: int, admin: dict = Depends(auth.require_admin)):
    return _set_incident_status(incident_id, "REJECTED", admin)


@app.post("/incidents/{incident_id}/resolve")
def resolve_incident(incident_id: int, admin: dict = Depends(auth.require_admin)):
    return _set_incident_status(incident_id, "RESOLVED", admin)


@app.delete("/incidents/{incident_id}")
def delete_incident(incident_id: int, _: dict = Depends(auth.require_admin)):
    with db.session() as c:
        inc = dict(one(c, "incidents", incident_id, "Incident"))
        if inc.get("photo_file"):
            f = photo_file(inc["photo_file"])
            if f and f.is_file():
                f.unlink(missing_ok=True)
        c.execute("DELETE FROM incidents WHERE id=?", (incident_id,))
        if inc.get("zone"):
            refresh_zone(c, inc["zone"])
        return {"success": True, "deleted_id": incident_id}


# ==========================================
# 5. Incident-Aware Real Routing
# ==========================================

class RouteComputeIn(BaseModel):
    origin: RoutePoint
    destination: RoutePoint
    travelMode: str = "DRIVE"


@app.post("/routes/compute")
async def compute_route(body: RouteComputeIn, user: dict = Depends(auth.current_user)):
    """Recommended route from the real street network: excludes blocked roads and blocking incidents, then prefers the
    lower flood-risk exposure (see routing_service). Never described as 'safe'."""
    try:
        with db.session() as c:
            return await routing_service.plan_route(c, routing_provider, body.origin, body.destination)
    except HTTPException:
        raise
    except Exception as e:
        logger.warning(f"Routing provider error: {e}")
        raise HTTPException(status_code=503, detail="Routing service temporarily unavailable.")



# ==========================================
# 6. Volunteer Management & Dispatch
# ==========================================

def clean_quantities(v):
    if v is None:
        return None
    out = {}
    for k, n in v.items():
        key = HELP_ALIASES.get(norm(k), norm(k))
        if key not in HELP_TYPES or not isinstance(n, int) or isinstance(n, bool) or not 0 <= n <= 100000:
            raise ValueError(f"quantities must map {list(HELP_TYPES)} to whole numbers from 0 to 100000")
        out[key] = n
    return out


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
    quantities: Optional[dict] = None  # resources on hand, e.g. {"MEDICINE": 12, "WATER": 40}

    @field_validator("quantities")
    @classmethod
    def _q(cls, v):
        return clean_quantities(v)

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
    quantities: Optional[dict] = None

    @field_validator("quantities")
    @classmethod
    def _q(cls, v):
        return clean_quantities(v)

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
    for m in c.execute("SELECT * FROM matches WHERE volunteer_id=? AND status IN ('PROPOSED','MATCHED','ACCEPTED','EN_ROUTE','ARRIVED')", (v["id"],)).fetchall():
        c.execute("UPDATE matches SET status='CANCELLED' WHERE id=?", (m["id"],))
        c.execute("UPDATE help_requests SET status='OPEN', assigned_volunteer_id=NULL WHERE id=? AND status IN ('MATCHED','ACCEPTED','EN_ROUTE','ARRIVED')", (m["help_request_id"],))


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
def create_volunteer(body: VolunteerIn, admin: dict = Depends(auth.require_admin)):
    with db.session() as c:
        if c.execute("SELECT 1 FROM users WHERE LOWER(email)=?", (body.email.strip().lower(),)).fetchone():
            raise HTTPException(409, "An account with this email already exists.")
        t = db.now()
        u = c.execute(
            "INSERT INTO users(name, role, email, password_hash, phone, created_at, is_active, latitude, longitude, email_verified) "
            "VALUES(?,?,?,?,?,?,1,?,?,1)",
            (body.name.strip(), auth.ROLE_VOLUNTEER, body.email.strip().lower(), auth.hash_password(body.password), body.phone,
             t, body.latitude, body.longitude),
        )
        cur = c.execute(
            "INSERT INTO volunteers(name, skill, resources, phone, latitude, longitude, available, responder_mode, user_id, status, created_at, updated_at, quantities) "
            "VALUES(?,?,?,?,?,?,?,1,?,'ACTIVE',?,?,?)",  # a volunteer with a login is a responder: visible on maps and nearby lists
            (body.name.strip(), body.skill, body.skill, body.phone, body.latitude, body.longitude, int(body.available), u.lastrowid, t, t,
             json.dumps(body.quantities) if body.quantities else None),
        )
        audit.record(c, admin, "volunteer.create", cur.lastrowid, f"{body.name} ({body.skill})")
        return volunteer_full(c, one(c, "volunteers", cur.lastrowid, "Volunteer"))


def _my_row(c, user: dict):
    v = c.execute("SELECT * FROM volunteers WHERE user_id=?", (user["id"],)).fetchone()
    if not v:
        raise HTTPException(404, "No volunteer profile is linked to this account.")
    return v


PRIORITY_RANK = {"CRITICAL": 4, "HIGH": 3, "MEDIUM": 2, "LOW": 1}


def _suitable(v, request_type: str) -> bool:
    """Does this volunteer's skill or listed resources cover the requested help type? (same rule the matcher uses)"""
    if not request_type:
        return False
    want = (request_type or "").strip().lower().replace("_", " ")
    have = f"{v['skill'] or ''} {dict(v).get('resources') or ''}".lower().replace("_", " ")
    if want in have:
        return True
    if want == "food water" and ("food" in have or "water" in have):
        return True
    if want == "medical emergency" and ("medicine" in have or "medical" in have):
        return True
    return False


def _request_dict(c, v, r, **extra):
    d = dict(r)
    dist = None
    if None not in (d["latitude"], d["longitude"], v["latitude"], v["longitude"]):
        dist = round(_km(v["latitude"], v["longitude"], d["latitude"], d["longitude"]), 2)  # existing distance helper
    return {
        "request_id": d["id"], "type": d["type"], "priority": d["priority"], "status": d["status"], "quantity": d.get("quantity") or 1,
        "latitude": d["latitude"], "longitude": d["longitude"], "distance_km": dist, "created_at": d["created_at"],
        "zone": db.nearest_zone(d["latitude"], d["longitude"]) if d["latitude"] is not None and d["longitude"] is not None else None,
        **extra,
    }


def _my_requests(c, v):
    """assigned = my active matches (with the requester's name/phone, needed to help them);
    nearby_open = unassigned open requests I could fulfil, highest priority first then nearest (no requester details);
    completed = my finished requests."""
    assigned = []
    for m in c.execute("SELECT * FROM matches WHERE volunteer_id=? AND status IN ('PROPOSED','MATCHED','ACCEPTED','EN_ROUTE','ARRIVED') ORDER BY id DESC", (v["id"],)):
        r = c.execute("SELECT * FROM help_requests WHERE id=?", (m["help_request_id"],)).fetchone()
        if not r:
            continue
        who = c.execute("SELECT name, phone FROM users WHERE id=?", (r["user_id"],)).fetchone() if r["user_id"] else None
        assigned.append(_request_dict(c, v, r, match_id=m["id"], match_status=m["status"],
                                      requester_name=who["name"] if who else None,
                                      requester_phone=who["phone"] if who else None))
    nearby = []
    if v["status"] == "ACTIVE":
        for r in c.execute("SELECT * FROM help_requests WHERE status='OPEN' ORDER BY id DESC"):
            if not _suitable(v, r["type"]) or None in (r["latitude"], r["longitude"], v["latitude"], v["longitude"]):
                continue
            item = _request_dict(c, v, r)
            if item["distance_km"] is not None and item["distance_km"] <= 15:
                nearby.append(item)
        nearby.sort(key=lambda x: (-PRIORITY_RANK.get(x["priority"], 0), x["distance_km"]))
    completed = []
    for m in c.execute("SELECT * FROM matches WHERE volunteer_id=? AND status='COMPLETED' ORDER BY id DESC LIMIT 25", (v["id"],)):
        r = c.execute("SELECT * FROM help_requests WHERE id=?", (m["help_request_id"],)).fetchone()
        if r:
            completed.append(_request_dict(c, v, r, match_id=m["id"], match_status="COMPLETED"))
    return assigned, nearby, completed


def _completed_total(c, v) -> int:
    return c.execute("SELECT COUNT(*) FROM matches WHERE volunteer_id=? AND status='COMPLETED'", (v["id"],)).fetchone()[0]


@app.get("/volunteers/me")
def my_volunteer(user: dict = Depends(auth.require_volunteer)):
    with db.session() as c:
        v = _my_row(c, user)
        assigned, nearby, _ = _my_requests(c, v)
        return {"volunteer": volunteer_full(c, v), "assigned_count": len(assigned), "nearby_open_count": len(nearby),
                "completed_count": _completed_total(c, v)}


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
        v = _my_row(c, user)
        assigned, nearby, completed = _my_requests(c, v)
        return {"assigned": assigned, "nearby_open": nearby, "completed": completed,
                "stats": {"assigned": len(assigned), "nearby": len(nearby), "completed": _completed_total(c, v)}}


@app.post("/help-requests/{request_id}/claim", status_code=201)
def claim_request(request_id: int, user: dict = Depends(auth.require_volunteer)):
    """A volunteer accepts an open, unassigned request they are suited for. Creates the match as ACCEPTED."""
    with db.session() as c:
        v = _my_row(c, user)
        if v["status"] != "ACTIVE" or not v["available"]:
            raise HTTPException(409, "Set yourself as available before accepting requests.")
        r = one(c, "help_requests", request_id, "Help request")
        if r["status"] != "OPEN" or c.execute("SELECT 1 FROM matches WHERE help_request_id=? AND status IN ('PROPOSED','MATCHED','ACCEPTED','EN_ROUTE','ARRIVED','COMPLETED')", (request_id,)).fetchone():
            raise HTTPException(409, "This request is no longer open.")
        if not _suitable(v, r["type"]):
            raise HTTPException(422, "This request does not match your skills or resources.")
        dist = None
        if None not in (r["latitude"], r["longitude"], v["latitude"], v["longitude"]):
            dist = round(_km(v["latitude"], v["longitude"], r["latitude"], r["longitude"]), 2)
        cur = c.execute(
            "INSERT INTO matches(help_request_id, volunteer_id, distance_km, eta_minutes, status, created_at) VALUES (?,?,?,?,'ACCEPTED',?)",
            (request_id, v["id"], dist or 0.0, max(1, round((dist or 0) / 25.0 * 60)), db.now()),
        )
        c.execute("UPDATE help_requests SET status='MATCHED' WHERE id=?", (request_id,))
        _log_event(c, request_id, "ACCEPTED", f"{v['name']} accepted the request")
        _tell_requester(c, request_id, "A volunteer is on the way", f"{v['name']} accepted your request.")
        return match_out(c, one(c, "matches", cur.lastrowid, "Match"))


@app.put("/volunteers/{volunteer_id}")
def update_volunteer(volunteer_id: int, body: VolunteerUpdate, admin: dict = Depends(auth.require_admin)):
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
        if d.get("quantities") is not None:
            vol_cols["quantities"] = json.dumps(d["quantities"])
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
        audit.record(c, admin, "volunteer.update", volunteer_id, ", ".join(k for k in d if k != "password") + (" +password" if d.get("password") else ""))
        return volunteer_full(c, one(c, "volunteers", volunteer_id, "Volunteer"))


@app.delete("/volunteers/{volunteer_id}")
def delete_volunteer(volunteer_id: int, admin: dict = Depends(auth.require_admin)):
    with db.session() as c:
        v = one(c, "volunteers", volunteer_id, "Volunteer")
        _disable_volunteer(c, v)
        audit.record(c, admin, "volunteer.disable", volunteer_id, v["name"])
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
def register_volunteer(body: VolunteerRegisterIn, _: dict = Depends(auth.require_admin)):
    """Admin only: creates a roster entry without a login. Volunteers with logins come from POST /volunteers."""
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
def update_volunteer_location(volunteer_id: int, body: VolunteerLocationIn,
                              user: dict = Depends(auth.require_roles(auth.ROLE_VOLUNTEER, auth.ROLE_ADMIN))):
    c = db.conn()
    row = c.execute("SELECT * FROM volunteers WHERE id=?", (volunteer_id,)).fetchone()
    if not row or (user["role"] != auth.ROLE_ADMIN and row["user_id"] != user["id"]):  # a volunteer may only move themselves
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
def set_volunteer_availability(volunteer_id: int, body: VolunteerAvailabilityIn,
                               user: dict = Depends(auth.require_roles(auth.ROLE_VOLUNTEER, auth.ROLE_ADMIN))):
    c = db.conn()
    row = c.execute("SELECT * FROM volunteers WHERE id=?", (volunteer_id,)).fetchone()
    if not row or (user["role"] != auth.ROLE_ADMIN and row["user_id"] != user["id"]):  # a volunteer may only change their own status
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
    user: dict = Depends(auth.current_user),
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
            if user["role"] != auth.ROLE_ADMIN:  # no contact details or account ids for non-admins
                item = {k: item.get(k) for k in ("id", "name", "skill", "resources", "latitude", "longitude", "available")}
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
    quantity: int = Field(1, ge=1, le=1000)
    latitude: Optional[float] = Field(None, ge=-90, le=90)
    longitude: Optional[float] = Field(None, ge=-180, le=180)
    destination_lat: Optional[float] = Field(None, ge=-90, le=90)
    destination_lng: Optional[float] = Field(None, ge=-180, le=180)
    phone: Optional[str] = None
    notes: Optional[str] = None
    description: Optional[str] = None
    photo_url: Optional[str] = None
    is_manual_location: bool = False

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
        t = db.now()
        cur = c.execute(
            "INSERT INTO help_requests(user_id,type,priority,latitude,longitude,destination_lat,destination_lng,phone,notes,description,photo_url,is_manual_location,status,created_at,updated_at,quantity) "
            "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'OPEN',?,?,?)",
            (
                user["id"],
                body.type,
                body.priority,
                body.latitude,
                body.longitude,
                body.destination_lat,
                body.destination_lng,
                body.phone or user.get("phone"),
                body.notes,
                body.description,
                body.photo_url,
                1 if body.is_manual_location else 0,
                t,
                t,
                body.quantity,
            ),
        )
        row = dict(one(c, "help_requests", cur.lastrowid, "Help request"))
        _log_event(c, row["id"], "REQUESTED", f"{body.type} ({body.priority})")
    return {"request_id": row["id"], **row}


class HelpRequestIn(BaseModel):
    userId: Optional[int] = 1
    quantity: int = Field(1, ge=1, le=1000)
    type: str
    priority: Literal["LOW", "MEDIUM", "HIGH", "CRITICAL"] = "HIGH"
    latitude: float = Field(..., ge=-90.0, le=90.0)
    longitude: float = Field(..., ge=-180.0, le=180.0)
    destination_lat: Optional[float] = Field(None, ge=-90.0, le=90.0)
    destination_lng: Optional[float] = Field(None, ge=-180.0, le=180.0)
    phone: Optional[str] = None
    notes: Optional[str] = None
    description: Optional[str] = None
    photo_url: Optional[str] = None
    is_manual_location: bool = False


@app.post("/help-requests", status_code=status.HTTP_201_CREATED)
def request_help(body: HelpRequestIn, user: dict = Depends(auth.current_user), idempotency_key: Optional[str] = Header(None)):
    again = _idem_get(user["id"], idempotency_key)
    if again is not None:
        return again
    c = db.conn()
    now_t = now_iso()
    cur = c.execute(
        "INSERT INTO help_requests(user_id, type, priority, latitude, longitude, destination_lat, destination_lng, phone, notes, description, photo_url, is_manual_location, status, created_at, updated_at, quantity) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'OPEN',?,?,?)",
        (
            user["id"],
            body.type,
            body.priority,
            body.latitude,
            body.longitude,
            body.destination_lat,
            body.destination_lng,
            body.phone or user.get("phone"),
            body.notes,
            body.description,
            body.photo_url,
            1 if body.is_manual_location else 0,
            now_t,
            now_t,
            body.quantity,
        ),
    )
    req_id = cur.lastrowid
    _log_event(c, req_id, "REQUESTED", f"{body.type} ({body.priority})")

    rows = c.execute(
        "SELECT * FROM volunteers WHERE available=1 AND latitude IS NOT NULL"
    ).fetchall()

    req_lower = body.type.strip().lower()
    best_vol = None
    best_dist = float("inf")

    for r in rows:
        v = dict(r)
        skills_str = (v.get("skill", "") + " " + v.get("resources", "")).lower()
        if _suitable(v, body.type) or req_lower in skills_str or (req_lower == "medicine" and "medicine" in skills_str):
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
        c.execute("UPDATE help_requests SET status='MATCHED', assigned_volunteer_id=?, updated_at=? WHERE id=?", (best_vol["id"], now_t, req_id))
        _log_event(c, req_id, "MATCHED", f"{best_vol['name']}, {dist_km} km away, about {eta_min} min")
        _tell_volunteer(c, best_vol["id"], "New help request near you",
                        f"{body.type.replace('_', ' ').title()} needed ({body.priority.lower()} priority), {dist_km} km away.", req_id)

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

    return _idem_put(user["id"], idempotency_key, {
        "requestId": req_id,
        "type": body.type,
        "priority": body.priority,
        "quantity": body.quantity,
        "match": match_result,
        "createdAt": now_t,
    })


@app.get("/help-requests")
def list_help(status: Optional[str] = None, user: dict = Depends(auth.current_user)):
    q, args = "SELECT * FROM help_requests WHERE 1=1", []
    if status:
        q += " AND status=?"; args.append(status)
    with db.session() as c:
        rows = c.execute(q + " ORDER BY id DESC", args).fetchall()
        out = []
        for r in rows:
            if not request_visible(c, user, r):
                continue
            item = dict(r)
            if user["role"] == auth.ROLE_ADMIN:  # admins see who asked and who is helping, not bare ids
                u = c.execute("SELECT name, phone FROM users WHERE id=?", (r["user_id"],)).fetchone() if r["user_id"] else None
                m = c.execute("SELECT v.name, m.status FROM matches m JOIN volunteers v ON v.id=m.volunteer_id "
                              "WHERE m.help_request_id=? AND m.status!='CANCELLED' ORDER BY m.id DESC", (r["id"],)).fetchone()
                item.update(requester_name=u["name"] if u else None, requester_phone=u["phone"] if u else None,
                            volunteer_name=m["name"] if m else None, match_status=m["status"] if m else None)
            out.append(item)
        return out


@app.get("/help-requests/{request_id}")
def get_help(request_id: int, user: dict = Depends(auth.current_user)):
    with db.session() as c:
        r = one(c, "help_requests", request_id, "Help request")
        if not request_visible(c, user, r):
            raise HTTPException(404, f"Help request {request_id} not found")
        return dict(r)


@app.delete("/help-requests/{request_id}")
def delete_help_request(request_id: int, user: dict = Depends(auth.current_user)):
    with db.session() as c:
        r = dict(one(c, "help_requests", request_id, "Help request"))
        if user["role"] != auth.ROLE_ADMIN and r["user_id"] != user["id"]:
            raise HTTPException(403, "Not authorized to delete this help request.")
        m = c.execute("SELECT volunteer_id FROM matches WHERE help_request_id=? AND status!='CANCELLED'", (request_id,)).fetchone()
        if m and m["volunteer_id"]:
            c.execute("UPDATE volunteers SET available=1 WHERE id=?", (m["volunteer_id"],))
        c.execute("DELETE FROM matches WHERE help_request_id=?", (request_id,))
        c.execute("DELETE FROM help_requests WHERE id=?", (request_id,))
        return {"success": True, "deleted_id": request_id}


class CancelIn(BaseModel):
    reason: Optional[str] = None


@app.post("/help-requests/{request_id}/accept")
def accept_help_request(request_id: int, user: dict = Depends(auth.require_roles(auth.ROLE_VOLUNTEER, auth.ROLE_ADMIN))):
    with db.session() as c:
        r = dict(one(c, "help_requests", request_id, "Help request"))
        now_t = db.now()
        if r["status"] in ("COMPLETED", "CANCELLED"):
            raise HTTPException(409, f"Request is already {r['status'].lower()}.")
        if user["role"] == auth.ROLE_VOLUNTEER:
            v = _my_row(c, user)
            if v["status"] != "ACTIVE":
                raise HTTPException(403, "This volunteer account is disabled.")
            vol_id = v["id"]
        else:
            vol_id = r.get("assigned_volunteer_id")
            if not vol_id:
                first_v = c.execute("SELECT id FROM volunteers WHERE status='ACTIVE' ORDER BY id LIMIT 1").fetchone()
                vol_id = first_v["id"] if first_v else None
            if not vol_id:
                raise HTTPException(404, "No active volunteer available to assign to this request.")
            v = one(c, "volunteers", vol_id, "Volunteer")

        m = c.execute("SELECT * FROM matches WHERE help_request_id=? AND status NOT IN ('CANCELLED','REJECTED') ORDER BY id DESC", (request_id,)).fetchone()
        if m:
            if m["volunteer_id"] != vol_id and user["role"] != auth.ROLE_ADMIN:
                raise HTTPException(409, "This request is assigned to another volunteer.")
            c.execute("UPDATE matches SET status='ACCEPTED' WHERE id=?", (m["id"],))
            match_id = m["id"]
        else:
            dist = None
            if None not in (r["latitude"], r["longitude"], v["latitude"], v["longitude"]):
                dist = round(_km(v["latitude"], v["longitude"], r["latitude"], r["longitude"]), 2)
            cur = c.execute(
                "INSERT INTO matches(help_request_id, volunteer_id, distance_km, eta_minutes, status, created_at) "
                "VALUES (?,?,?,?,'ACCEPTED',?)",
                (request_id, vol_id, dist or 0.0, max(1, round((dist or 0) / 25.0 * 60)), now_t),
            )
            match_id = cur.lastrowid

        c.execute("UPDATE help_requests SET status='ACCEPTED', assigned_volunteer_id=?, updated_at=? WHERE id=?", (vol_id, now_t, request_id))
        c.execute("UPDATE volunteers SET available=0 WHERE id=?", (vol_id,))
        _log_event(c, request_id, "ACCEPTED", f"{v['name']} accepted the request")
        _tell_requester(c, request_id, "A volunteer accepted your request", f"{v['name']} is on the way to help.")
        return {
            "status": "ACCEPTED",
            "request": dict(one(c, "help_requests", request_id, "Help request")),
            "match": match_out(c, one(c, "matches", match_id, "Match")),
        }


@app.post("/help-requests/{request_id}/en-route")
def en_route_help_request(request_id: int, user: dict = Depends(auth.require_roles(auth.ROLE_VOLUNTEER, auth.ROLE_ADMIN))):
    with db.session() as c:
        r = dict(one(c, "help_requests", request_id, "Help request"))
        if user["role"] == auth.ROLE_VOLUNTEER:
            v = _my_row(c, user)
            if r.get("assigned_volunteer_id") != v["id"]:
                raise HTTPException(403, "You are not assigned to this request.")
        now_t = db.now()
        c.execute("UPDATE help_requests SET status='EN_ROUTE', updated_at=? WHERE id=?", (now_t, request_id))
        c.execute("UPDATE matches SET status='EN_ROUTE' WHERE help_request_id=? AND status IN ('MATCHED', 'ACCEPTED')", (request_id,))
        _log_event(c, request_id, "EN_ROUTE", "Volunteer is on the way")
        return {
            "status": "EN_ROUTE",
            "request": dict(one(c, "help_requests", request_id, "Help request")),
        }


@app.post("/help-requests/{request_id}/arrived")
def arrived_help_request(request_id: int, user: dict = Depends(auth.require_roles(auth.ROLE_VOLUNTEER, auth.ROLE_ADMIN))):
    with db.session() as c:
        r = dict(one(c, "help_requests", request_id, "Help request"))
        if user["role"] == auth.ROLE_VOLUNTEER:
            v = _my_row(c, user)
            if r.get("assigned_volunteer_id") != v["id"]:
                raise HTTPException(403, "You are not assigned to this request.")
        now_t = db.now()
        c.execute("UPDATE help_requests SET status='ARRIVED', updated_at=? WHERE id=?", (now_t, request_id))
        c.execute("UPDATE matches SET status='ARRIVED' WHERE help_request_id=? AND status IN ('MATCHED', 'ACCEPTED', 'EN_ROUTE')", (request_id,))
        _log_event(c, request_id, "ARRIVED", "Volunteer has arrived")
        return {
            "status": "ARRIVED",
            "request": dict(one(c, "help_requests", request_id, "Help request")),
        }


@app.post("/help-requests/{request_id}/complete")
def complete_help_request(request_id: int, user: dict = Depends(auth.current_user)):
    with db.session() as c:
        r = dict(one(c, "help_requests", request_id, "Help request"))
        if user["role"] not in (auth.ROLE_ADMIN, auth.ROLE_VOLUNTEER) and r["user_id"] != user["id"]:
            raise HTTPException(403, "Not authorized to complete this request.")
        now_t = db.now()
        c.execute("UPDATE help_requests SET status='COMPLETED', updated_at=? WHERE id=?", (now_t, request_id))
        c.execute("UPDATE matches SET status='COMPLETED' WHERE help_request_id=? AND status!='CANCELLED'", (request_id,))
        vol_id = r.get("assigned_volunteer_id")
        if not vol_id:
            m = c.execute("SELECT volunteer_id FROM matches WHERE help_request_id=? ORDER BY id DESC LIMIT 1", (request_id,)).fetchone()
            if m:
                vol_id = m["volunteer_id"]
        if vol_id:
            c.execute("UPDATE volunteers SET available=1 WHERE id=?", (vol_id,))
        _log_event(c, request_id, "COMPLETED", "Request completed")
        return {
            "status": "COMPLETED",
            "request": dict(one(c, "help_requests", request_id, "Help request")),
        }


@app.post("/help-requests/{request_id}/cancel")
def cancel_help_request(request_id: int, body: Optional[CancelIn] = None, user: dict = Depends(auth.current_user)):
    with db.session() as c:
        r = dict(one(c, "help_requests", request_id, "Help request"))
        if user["role"] != auth.ROLE_ADMIN and r["user_id"] != user["id"]:
            if user["role"] == auth.ROLE_VOLUNTEER:
                v = _my_row(c, user)
                if r.get("assigned_volunteer_id") != v["id"]:
                    raise HTTPException(403, "Not authorized to cancel this request.")
            else:
                raise HTTPException(403, "Not authorized to cancel this request.")
        now_t = db.now()
        reason = body.reason if body and body.reason else "Cancelled by user"
        c.execute("UPDATE help_requests SET status='CANCELLED', cancellation_reason=?, updated_at=? WHERE id=?", (reason, now_t, request_id))
        c.execute("UPDATE matches SET status='CANCELLED' WHERE help_request_id=?", (request_id,))
        vol_id = r.get("assigned_volunteer_id")
        if vol_id:
            c.execute("UPDATE volunteers SET available=1 WHERE id=?", (vol_id,))
        _log_event(c, request_id, "CANCELLED", reason)
        return {
            "status": "CANCELLED",
            "cancellation_reason": reason,
            "request": dict(one(c, "help_requests", request_id, "Help request")),
        }


@app.post("/help-requests/{request_id}/reject")
def reject_help_request(request_id: int, user: dict = Depends(auth.require_roles(auth.ROLE_VOLUNTEER, auth.ROLE_ADMIN))):
    with db.session() as c:
        r = dict(one(c, "help_requests", request_id, "Help request"))
        now_t = db.now()
        vol_id = None
        if user["role"] == auth.ROLE_VOLUNTEER:
            v = _my_row(c, user)
            vol_id = v["id"]
            mine = c.execute("SELECT 1 FROM matches WHERE help_request_id=? AND volunteer_id=? AND status IN ('PROPOSED','MATCHED','ACCEPTED','EN_ROUTE','ARRIVED')", (request_id, vol_id)).fetchone()
            if r.get("assigned_volunteer_id") != vol_id and not mine:
                raise HTTPException(403, "You are not assigned to this request.")
        else:
            vol_id = r.get("assigned_volunteer_id")
        if r["status"] in ("COMPLETED", "CANCELLED"):
            raise HTTPException(409, f"Request is already {r['status'].lower()}.")
        if vol_id:
            c.execute("UPDATE matches SET status='REJECTED' WHERE help_request_id=? AND volunteer_id=?", (request_id, vol_id))
            c.execute("UPDATE volunteers SET available=1 WHERE id=?", (vol_id,))
        c.execute("UPDATE help_requests SET status='OPEN', assigned_volunteer_id=NULL, updated_at=? WHERE id=?", (now_t, request_id))
        _log_event(c, request_id, "REJECTED", "Volunteer declined; request returned to the open pool")
        return {
            "status": "OPEN",
            "message": "Request returned to open pool.",
            "request": dict(one(c, "help_requests", request_id, "Help request")),
        }


@app.get("/help-requests/{request_id}/tracking")
async def get_help_request_tracking(request_id: int, user: dict = Depends(auth.current_user)):
    with db.session() as c:
        r = dict(one(c, "help_requests", request_id, "Help request"))
        if not request_visible(c, user, r):
            raise HTTPException(404, f"Help request {request_id} not found")

        vol_id = r.get("assigned_volunteer_id")
        if not vol_id:
            m_chk = c.execute("SELECT volunteer_id FROM matches WHERE help_request_id=? AND status!='CANCELLED' ORDER BY id DESC LIMIT 1", (request_id,)).fetchone()
            if m_chk:
                vol_id = m_chk["volunteer_id"]

        vol_row = None
        if vol_id:
            raw_v = c.execute("SELECT * FROM volunteers WHERE id=?", (vol_id,)).fetchone()
            if raw_v:
                vol_row = dict(raw_v)

        match_raw = c.execute(
            "SELECT * FROM matches WHERE help_request_id=? AND status!='CANCELLED' ORDER BY id DESC LIMIT 1",
            (request_id,)
        ).fetchone()
        match_row = dict(match_raw) if match_raw else None
        match_data = match_out(c, match_raw) if match_raw else None
        timeline = [dict(e) for e in c.execute("SELECT event, detail, at FROM match_events WHERE help_request_id=? ORDER BY id", (request_id,))]
        shared = bool(match_row and match_row["status"] in ("ACCEPTED", "EN_ROUTE", "ARRIVED", "COMPLETED"))

        req_u = c.execute("SELECT name, phone FROM users WHERE id=?", (r["user_id"],)).fetchone() if r.get("user_id") else None
        req_user = dict(req_u) if req_u else None

    dist_km = None
    eta_min = None
    route_polyline = None
    if vol_row and None not in (r["latitude"], r["longitude"], vol_row["latitude"], vol_row["longitude"]):
        meters = haversine_meters(vol_row["latitude"], vol_row["longitude"], r["latitude"], r["longitude"])
        dist_km = round(meters / 1000.0, 2)
        eta_min = max(1, round(dist_km / 25.0 * 60))
        try:
            cand = await routing_provider.compute_routes(
                RoutePoint(latitude=vol_row["latitude"], longitude=vol_row["longitude"]),
                RoutePoint(latitude=r["latitude"], longitude=r["longitude"]),
            )
            if cand:
                route_polyline = cand[0].polyline
                dist_km = round(cand[0].distance_meters / 1000.0, 2)
                eta_min = cand[0].eta_minutes
        except Exception:
            route_polyline = [[vol_row["latitude"], vol_row["longitude"]], [r["latitude"], r["longitude"]]]

    return {
        "request_id": r["id"],
        "status": r["status"],
        "type": r["type"],
        "priority": r["priority"],
        "created_at": r["created_at"],
        "updated_at": r.get("updated_at") or r["created_at"],
        "requester": {
            "id": r["user_id"],
            "name": req_user["name"] if req_user else "Requester",
            "phone": r.get("phone") or (req_user["phone"] if req_user else None),
            "latitude": r["latitude"],
            "longitude": r["longitude"],
            "destination_lat": r.get("destination_lat"),
            "destination_lng": r.get("destination_lng"),
            "notes": r.get("notes"),
            "description": r.get("description"),
            "is_manual_location": bool(r.get("is_manual_location")),
        },
        "volunteer": {
            "id": vol_row["id"],
            "name": vol_row["name"],
            "skill": vol_row["skill"],
            "phone": vol_row.get("phone") if shared else None,
            "latitude": vol_row["latitude"] if r["status"] != "COMPLETED" else None,
            "longitude": vol_row["longitude"] if r["status"] != "COMPLETED" else None,
            "available": bool(vol_row["available"]),
            "last_location_update": vol_row.get("last_location_update"),
            "distance_km": dist_km if dist_km is not None else (match_row.get("distance_km") if match_row else None),
            "eta_minutes": eta_min if eta_min is not None else (match_row.get("eta_minutes") if match_row else None),
        } if vol_row else None,
        "match": match_data,
        "match_status": match_row["status"] if match_row else None,
        "timeline": timeline,
        "distance_km": dist_km if dist_km is not None else (match_row.get("distance_km") if match_row else None),
        "eta_minutes": eta_min if eta_min is not None else (match_row.get("eta_minutes") if match_row else None),
        "polyline": route_polyline,
    }


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
        _log_event(c, body.help_request_id, "MATCHED", v["name"])
        _tell_volunteer(c, body.volunteer_id, "New help request for you", f"{r['type'].replace('_', ' ').title()} needed.", body.help_request_id)
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
        vol = c.execute("SELECT name FROM volunteers WHERE id=?", (m["volunteer_id"],)).fetchone()
        _log_event(c, m["help_request_id"], new_status, (vol["name"] if vol else "") )
        if new_status == "ACCEPTED":
            _tell_requester(c, m["help_request_id"], "A volunteer is on the way", f"{vol['name'] if vol else 'A volunteer'} accepted your request.")
        if new_status == "COMPLETED":
            c.execute("UPDATE help_requests SET status='COMPLETED' WHERE id=?", (m["help_request_id"],))
            req = c.execute("SELECT type, quantity FROM help_requests WHERE id=?", (m["help_request_id"],)).fetchone()
            v = c.execute("SELECT id, quantities FROM volunteers WHERE id=?", (m["volunteer_id"],)).fetchone()
            if req and v and v["quantities"]:  # a volunteer who tracks stock has given some away
                q = json.loads(v["quantities"])
                if req["type"] in q:
                    q[req["type"]] = max(0, int(q[req["type"]]) - int(req["quantity"] or 1))
                    c.execute("UPDATE volunteers SET quantities=? WHERE id=?", (json.dumps(q), v["id"]))
            _tell_requester(c, m["help_request_id"], "Your help request is complete", "The volunteer marked your request as completed.")
            c.execute("UPDATE volunteers SET available=1 WHERE id=?", (m["volunteer_id"],))
        return match_out(c, one(c, "matches", match_id, "Match"))


@app.post("/matches/{match_id}/accept")
def accept_match(match_id: int, user: dict = Depends(auth.require_roles(auth.ROLE_VOLUNTEER, auth.ROLE_ADMIN))):
    # matches saved by help-request matching start as MATCHED; manually proposed ones as PROPOSED
    return _match_action(match_id, user, ("PROPOSED", "MATCHED"), "ACCEPTED")


@app.post("/matches/{match_id}/complete")
def complete_match(match_id: int, user: dict = Depends(auth.require_roles(auth.ROLE_VOLUNTEER, auth.ROLE_ADMIN))):
    return _match_action(match_id, user, ("ACCEPTED", "EN_ROUTE", "ARRIVED"), "COMPLETED")


# ==========================================
# 8. Admin Control & Summary
# ==========================================

@app.get("/admin/summary")
def admin_summary(_: dict = Depends(auth.require_admin)):
    with db.session() as c:
        risks = [compute_risk(c, z) for z in db.ZONES]
        n = lambda q: c.execute(q).fetchone()[0]  # noqa: E731
        roads_blocked = n(f"SELECT COUNT(*) FROM roads WHERE status='BLOCKED' AND {db.road_scope(c)}") if db.table_exists(c, 'roads') else 0
        return {
            "risk": max(risks, key=lambda r: r["risk_score"]),
            "active_alerts": n("SELECT COUNT(*) FROM alerts WHERE active=1"),
            "open_incidents": n("SELECT COUNT(*) FROM incidents WHERE status='REPORTED'"),
            "blocked_roads": roads_blocked,
            "pending_help_requests": n("SELECT COUNT(*) FROM help_requests WHERE status='OPEN'"),
            "available_volunteers": n("SELECT COUNT(*) FROM volunteers WHERE status='ACTIVE' AND available=1"),
            "open_matches": n("SELECT COUNT(*) FROM matches WHERE status IN ('PROPOSED','MATCHED','ACCEPTED','EN_ROUTE','ARRIVED')"),
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
        audit.record(c, admin, "user.enable" if body.is_active else "user.disable", user_id, r["email"])
        return {"id": r["id"], "name": r["name"], "email": r["email"], "role": r["role"], "is_active": bool(r["is_active"])}


@app.post("/reset")
def reset(admin: dict = Depends(auth.require_admin)):
    db.reset_db()
    with db.session() as c:
        audit.record(c, admin, "demo.reset", "", "all incidents, alerts, help requests and matches cleared")
    purge_photos()  # the incidents they belonged to are gone
    with db.session() as c:
        risks = refresh_all(c)
        alerts = c.execute("SELECT COUNT(*) FROM alerts WHERE active=1").fetchone()[0]
        blocked = c.execute(f"SELECT COUNT(*) FROM roads WHERE status='BLOCKED' AND {db.road_scope(c)}").fetchone()[0] if db.table_exists(c, 'roads') else 0
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
def create_alert(body: AlertIn, admin: dict = Depends(auth.require_admin)):
    require_zone(body.affected_zone)
    t = db.now()
    with db.session() as c:
        cur = c.execute(
            "INSERT INTO alerts(severity,message,affected_zone,active,created_at,source,updated_at) "
            "VALUES(?,?,?,1,?,'MANUAL',?)",
            (body.severity, body.message.strip(), body.affected_zone, t, t),
        )
        audit.record(c, admin, "alert.create", cur.lastrowid, f"{body.severity} {body.affected_zone}")
        return alert_out(one(c, "alerts", cur.lastrowid, "Alert"))


class SimIn(BaseModel):
    hazard: Literal["FLOOD"] = "FLOOD"
    rainfall: float = Field(..., ge=0, le=500)
    zone: Optional[str] = None

    _norm_h = field_validator("hazard", mode="before")(norm)


@app.post("/simulate-hazard")
def simulate(body: SimIn, admin: dict = Depends(auth.require_admin)):
    require_zone(body.zone)
    zones = [body.zone] if body.zone else list(db.ZONES)
    results = []
    with db.session() as c:
        for z in zones:
            before = compute_risk(c, z)
            c.execute("UPDATE environment_data SET rainfall=?, updated_at=?, data_source='SIMULATED' WHERE zone=?",
                      (body.rainfall, db.now(), z))
            results.append({"zone": z, "before": before, "after": refresh_zone(c, z)})
        audit.record(c, admin, "hazard.simulate", ", ".join(zones), f"{body.rainfall:g} mm (drill)")
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
    with db.session() as c:
        q, args = f"SELECT * FROM roads WHERE {db.road_scope(c)}", []
        if status:
            q += " AND status=?"; args.append(status)
        risk = {x["id"]: x for x in road_risk.assess_roads(c)}
        out = []
        for r in c.execute(q + " ORDER BY id", args).fetchall():
            d = road_out(r)
            x = risk.get(r["id"], {})
            d.update(risk_state=x.get("state", "OPEN"), risk_score=x.get("risk_score"), risk_level=x.get("risk_level"), risk_reasons=x.get("reasons", []))
            out.append(d)
        return out


@app.get("/roads/{road_id}")
def get_road(road_id: int):
    with db.session() as c:
        return road_out(one(c, "roads", road_id, "Road"))


def _set_road(road_id: int, status: str, actor: dict = None):
    with db.session() as c:
        road = one(c, "roads", road_id, "Road")
        c.execute("UPDATE roads SET status=? WHERE id=?", (status, road_id))
        refresh_all(c)
        audit.record(c, actor, "road.block" if status == "BLOCKED" else "road.unblock", road_id, road["name"])
        return road_out(one(c, "roads", road_id, "Road"))


@app.post("/roads/{road_id}/block")
def block_road(road_id: int, admin: dict = Depends(auth.require_admin)):
    return _set_road(road_id, "BLOCKED", admin)


@app.post("/roads/{road_id}/unblock")
def unblock_road(road_id: int, admin: dict = Depends(auth.require_admin)):
    return _set_road(road_id, "AVAILABLE", admin)


# ==========================================
# 10. Real-Time Telemetry Bundle (/sync)
# ==========================================

@app.get("/weather/monitoring")
async def weather_monitoring():
    """Latest rainfall across the monitored grid, read from the backend cache (clients never call the weather API).
    This is rainfall only: a flood risk level comes from /risk and /alerts, reports from /incidents."""
    snap = weather_monitor.status()
    if snap["status"] == "unavailable" and not weather_monitor._state["refreshing"] and weather_monitor._state["last_attempt"] is None:
        snap = await weather_monitor.refresh(weather_provider)  # first request before the background loop has run
    return snap


@app.get("/weather")
async def get_weather(latitude: float = Query(..., ge=-90.0, le=90.0), longitude: float = Query(..., ge=-180.0, le=180.0)):
    """Current rainfall for a position from the configured weather provider (Open-Meteo by default). The risk engine
    uses this same provider, so this is the data the risk score is built from."""
    try:
        obs = await weather_provider.get_weather(latitude, longitude)
    except Exception:
        raise HTTPException(503, "The weather service is unavailable right now.")
    return {**obs.model_dump(), "precipitation_mm": obs.rainfall_24h_mm, "timestamp": obs.observed_at}


def _cell_weather(env) -> dict:
    """The cached weather reading of a grid cell, shaped like the live provider's observation."""
    return {"source": env["data_source"], "station": f"monitored grid cell {env['latitude']:.2f}, {env['longitude']:.2f}", "latitude": env["latitude"],
            "longitude": env["longitude"], "rainfall_24h_mm": env["rainfall_24h"] or 0.0, "rainfall_intensity_mm_per_hour": env["rainfall"] or 0.0,
            "rain_1h_mm": env["rain_1h"], "rain_3h_mm": env["rain_3h"], "rain_6h_mm": env["rain_6h"], "forecast_3h_mm": env["forecast_3h_mm"],
            "forecast_6h_mm": env["forecast_6h_mm"], "warning_level": "NONE", "observed_at": env["observed_at"] or env["updated_at"], "cached": True,
            "stale": (flood_intel.age_minutes(env["updated_at"]) or 0) > config.WEATHER_REFRESH_INTERVAL / 20.0}


def _intel_to_risk(a: dict, env) -> dict:
    """Intelligence assessment in the shape the app already reads (risk_score, risk_level, reason ...) plus the explanation."""
    w = _cell_weather(env)
    return {"risk_score": a["risk_score"], "risk_level": a["risk_level"], "weather_source": w["source"], "rainfall_24h_mm": w["rainfall_24h_mm"],
            "rainfall_intensity_mm_per_hour": w["rainfall_intensity_mm_per_hour"], "warning_level": "NONE", "reason": a["reason"], "observed_at": w["observed_at"],
            "probability": a["probability"], "probability_basis": a["probability_basis"], "signals": a["signals"], "missing": a["missing"], "sources": a["sources"],
            "explanation": a["explanation"], "model": a["model"], "recommended_action": a["recommended_action"], "insufficient": False, "mode": "LIVE",
            "incident_count": a.get("report_counts", {}).get("total", 0), "verified_incidents": a.get("report_counts", {}).get("verified", 0),
            "confidence": a.get("confidence"), "confidence_basis": a.get("confidence_basis"), "computed_at": a.get("computed_at"),
            "weather_stale": bool(a.get("weather_stale")), "features": a.get("features") or {},
            "rain_1h_mm": w["rain_1h_mm"], "rain_3h_mm": w["rain_3h_mm"], "rain_6h_mm": w["rain_6h_mm"],
            "forecast_3h_mm": w["forecast_3h_mm"], "forecast_6h_mm": w["forecast_6h_mm"]}


@app.get("/sync")
async def sync_telemetry(
    latitude: float = Query(..., ge=-90.0, le=90.0),
    longitude: float = Query(..., ge=-180.0, le=180.0),
    user: Optional[dict] = Depends(auth.optional_user),
):
    """Synchronizes live risk, weather, incidents, and responder presence in a single payload. Risk and weather come from
    the backend's cached monitoring grid, so a phone never triggers a weather or satellite request; only a position outside
    the monitored area falls back to one live weather query (and is labelled as such)."""
    c = db.conn()
    cell = flood_intel.nearest_cell(c, latitude, longitude)
    assessment = flood_intel.assess_cell(c, cell["zone"], near=(latitude, longitude)) if cell else None
    weather = None
    if assessment and not assessment["insufficient"]:
        weather = _cell_weather(cell)
    else:
        try:
            weather = (await weather_provider.get_weather(latitude, longitude)).model_dump()
            weather["cached"] = False
        except Exception:
            weather = None
        assessment = None

    inc_rows = c.execute(
        "SELECT * FROM incidents WHERE duplicate_of IS NULL AND status IN ('REPORTED', 'VERIFIED') ORDER BY id DESC"
    ).fetchall()
    incidents = []
    for r in inc_rows:
        item = dict(r)
        item["trustScore"] = compute_trust(c, item)
        item["confidence"] = confidence_label(item["trustScore"])
        item["has_photo"] = bool(item.pop("photo_file", None)) | bool(item.pop("photo_url", None))  # storage details stay server-side
        item["user_id"] = None  # who reported is not shown to other people
        incidents.append(item)

    vol_rows = c.execute(
        "SELECT id, name, skill, resources, latitude, longitude, available, last_location_update "
        "FROM volunteers WHERE available=1 AND (responder_mode=1 OR responder_mode IS NULL) AND latitude IS NOT NULL"
    ).fetchall()
    volunteers = [dict(v) for v in vol_rows]

    if assessment:
        risk_eval = _intel_to_risk(assessment, cell)
    elif weather:
        from providers.weather.base import WeatherObservation
        risk_eval = {**compute_flood_risk(WeatherObservation(**{k: v for k, v in weather.items() if k in WeatherObservation.model_fields}), incidents),
                     "insufficient": False, "mode": "LIVE (direct weather query)", "signals": [], "missing": [], "sources": [], "explanation": [],
                     "model": "Prototype flood-risk model (legacy rainfall rules)", "probability": None, "recommended_action": None}
    else:
        risk_eval = {"risk_score": 0, "risk_level": "LOW", "weather_source": "Unavailable", "rainfall_24h_mm": 0.0, "rainfall_intensity_mm_per_hour": 0.0,
                     "warning_level": "NONE", "reason": "Insufficient data to estimate current flood risk.", "insufficient": True, "mode": "NO LIVE DATA",
                     "signals": [], "missing": [], "sources": [], "explanation": [], "probability": None, "recommended_action": None}

    active_assistance = None
    if user:
        if user.get("role") == auth.ROLE_USER:
            req_row = c.execute(
                "SELECT * FROM help_requests WHERE user_id=? AND status NOT IN ('COMPLETED', 'CANCELLED') ORDER BY id DESC LIMIT 1",
                (user["id"],),
            ).fetchone()
            if req_row:
                req = dict(req_row)
                vol = None
                vol_id = req.get("assigned_volunteer_id")
                if vol_id:
                    v_row = c.execute("SELECT id, name, skill, phone, latitude, longitude, available, last_location_update FROM volunteers WHERE id=?", (vol_id,)).fetchone()
                    if v_row:
                        vol = dict(v_row)
                m_row = c.execute("SELECT * FROM matches WHERE help_request_id=? AND status!='CANCELLED' ORDER BY id DESC LIMIT 1", (req["id"],)).fetchone()
                active_assistance = {
                    "role": "requester",
                    "request_id": req["id"],
                    "status": req["status"],
                    "type": req["type"],
                    "priority": req["priority"],
                    "destination_lat": req.get("destination_lat"),
                    "destination_lng": req.get("destination_lng"),
                    "volunteer": vol,
                    "match": dict(m_row) if m_row else None,
                    "distance_km": m_row["distance_km"] if m_row else None,
                    "eta_minutes": m_row["eta_minutes"] if m_row else None,
                }
        elif user.get("role") == auth.ROLE_VOLUNTEER:
            v_row = c.execute("SELECT * FROM volunteers WHERE user_id=?", (user["id"],)).fetchone()
            if v_row:
                m_row = c.execute(
                    "SELECT m.*, r.type as req_type, r.priority as req_priority, r.latitude as req_lat, r.longitude as req_lng, r.status as req_status, r.phone as req_phone "
                    "FROM matches m JOIN help_requests r ON r.id=m.help_request_id "
                    "WHERE m.volunteer_id=? AND m.status IN ('MATCHED', 'ACCEPTED', 'EN_ROUTE', 'ARRIVED') "
                    "ORDER BY m.id DESC LIMIT 1",
                    (v_row["id"],),
                ).fetchone()
                if m_row:
                    req_u = c.execute("SELECT name, phone FROM users WHERE id=(SELECT user_id FROM help_requests WHERE id=?)", (m_row["help_request_id"],)).fetchone()
                    active_assistance = {
                        "role": "volunteer",
                        "request_id": m_row["help_request_id"],
                        "match_id": m_row["id"],
                        "status": m_row["req_status"],
                        "match_status": m_row["status"],
                        "type": m_row["req_type"],
                        "priority": m_row["req_priority"],
                        "requester": {
                            "name": req_u["name"] if req_u else "Requester",
                            "phone": m_row["req_phone"] or (req_u["phone"] if req_u else None),
                            "latitude": m_row["req_lat"],
                            "longitude": m_row["req_lng"],
                        },
                        "distance_km": m_row["distance_km"],
                        "eta_minutes": m_row["eta_minutes"],
                    }

    c.close()

    return {
        "timestamp": now_iso(),
        "risk": risk_eval,
        "weather": weather,
        "incidents": incidents,
        "volunteers": volunteers,
        "active_assistance": active_assistance,
    }
