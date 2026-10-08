import json
import re
import logging
import sqlite3
from contextlib import asynccontextmanager
from typing import Literal, Optional

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator, model_validator

import auth
import db
from engine import _km, compute_risk, compute_trust, refresh_all, refresh_zone, similar_count

log = logging.getLogger("risknresq")

# Shown with every risk payload: this is demo/simulated data, never a live hazard forecast.
DATA_NOTICE = "Demo/simulated data for a hackathon prototype. Not a real-time hazard forecast or official warning."


@asynccontextmanager
async def lifespan(_: FastAPI):
    db.init_db()
    auth.ensure_admin()
    yield


app = FastAPI(title="RiskN ResQ API", version="2.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

IncidentType = Literal["FLOOD", "BLOCKED_ROAD", "EMERGENCY"]
IncidentStatus = Literal["REPORTED", "VERIFIED", "REJECTED", "RESOLVED"]
Priority = Literal["LOW", "MEDIUM", "HIGH", "CRITICAL"]
HELP_TYPES = ("MEDICINE", "FOOD", "WATER", "FIRST_AID", "EVACUATION")
HELP_ALIASES = {"EVACUATION_ASSISTANCE": "EVACUATION", "FIRSTAID": "FIRST_AID"}


# ---------- error handling: the API answers with JSON errors and never crashes ----------

@app.exception_handler(RequestValidationError)
async def validation_error(_: Request, exc: RequestValidationError):
    errors = jsonable_encoder(exc.errors(), custom_encoder={Exception: str})
    msg = "; ".join(f"{'.'.join(str(p) for p in e['loc'] if p != 'body')}: {e['msg']}" for e in errors)
    return JSONResponse(status_code=422, content={"detail": f"Invalid request: {msg}", "errors": errors})


@app.exception_handler(sqlite3.Error)
async def database_error(_: Request, exc: sqlite3.Error):
    log.exception("database error")
    return JSONResponse(status_code=500, content={"detail": "Database error. Nothing was saved; please retry.", "error": "database"})


@app.exception_handler(Exception)
async def unexpected_error(_: Request, exc: Exception):
    log.exception("unexpected error")
    return JSONResponse(status_code=500, content={"detail": "Internal server error.", "error": "internal"})


# ---------- helpers / serializers ----------

def norm(value):
    """'Blocked Road' / 'blocked-road' -> 'BLOCKED_ROAD'"""
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
    return {"id": r["id"], "type": r["type"], "latitude": r["latitude"], "longitude": r["longitude"],
            "description": r["description"], "severity": r["severity"], "trust_score": compute_trust(c, r),
            "similar_reports": similar_count(c, r), "status": r["status"], "zone": r["zone"],
            "user_id": r["user_id"] if include_user else None, "timestamp": r["timestamp"]}


def road_out(r) -> dict:
    return {"id": r["id"], "name": r["name"], "coordinates": json.loads(r["coordinates"]), "status": r["status"]}


def alert_out(r) -> dict:
    return {"id": r["id"], "severity": r["severity"], "message": r["message"], "affected_zone": r["affected_zone"],
            "affected_road": r["affected_road"], "reason": r["reason"], "risk_score": r["risk_score"],
            "source": r["source"], "active": bool(r["active"]), "created_at": r["created_at"], "updated_at": r["updated_at"]}


def volunteer_public(r) -> dict:
    """What any signed-in user may see: enough for matching, no contact details or account info."""
    return {"id": r["id"], "name": r["name"], "skill": r["skill"], "latitude": r["latitude"],
            "longitude": r["longitude"], "available": bool(r["available"]) and r["status"] == "ACTIVE"}


def volunteer_full(c, r) -> dict:
    u = c.execute("SELECT email, phone, is_active FROM users WHERE id=?", (r["user_id"],)).fetchone() if r["user_id"] else None
    return {**volunteer_public(r), "status": r["status"], "user_id": r["user_id"],
            "email": u["email"] if u else None, "phone": u["phone"] if u else None,
            "has_login": bool(u)}


# ---------- health / reset ----------

@app.get("/health")
def health():
    try:
        with db.session() as c:
            c.execute("SELECT 1").fetchone()
        return {"status": "ok", "database": "ok"}
    except sqlite3.Error:
        return JSONResponse(status_code=503, content={"status": "degraded", "database": "unavailable"})


@app.post("/reset")
def reset(_: dict = Depends(auth.require_admin)):
    """Restore the seeded demo state: LOW risk, all roads AVAILABLE, no alerts. Atomic."""
    db.reset_db()
    with db.session() as c:
        risks = refresh_all(c)
        alerts = c.execute("SELECT COUNT(*) FROM alerts WHERE active=1").fetchone()[0]
        blocked = c.execute("SELECT COUNT(*) FROM roads WHERE status='BLOCKED'").fetchone()[0]
    return {"status": "reset", "risk_level": max(risks, key=lambda r: r["risk_score"])["risk_level"],
            "active_alerts": alerts, "blocked_roads": blocked}


# ---------- risk ----------

@app.get("/risk")
def get_risk(zone: Optional[str] = None):
    """All zones: {overall, zones[]}; with ?zone=Zone%20A a single zone object."""
    require_zone(zone)
    with db.session() as c:
        risks = [compute_risk(c, z) for z in ([zone] if zone else list(db.ZONES))]
    if zone:
        return {**risks[0], "notice": DATA_NOTICE}
    return {"overall": max(risks, key=lambda r: r["risk_score"]), "zones": risks, "notice": DATA_NOTICE}


# ---------- incidents ----------

class IncidentIn(BaseModel):
    type: IncidentType
    latitude: float = Field(..., ge=-90, le=90)
    longitude: float = Field(..., ge=-180, le=180)
    description: str = Field("", max_length=500)
    severity: int = Field(3, ge=1, le=5)

    _norm_type = field_validator("type", mode="before")(norm)


@app.post("/incidents", status_code=201)
def create_incident(body: IncidentIn, user: dict = Depends(auth.current_user)):
    zone = db.nearest_zone(body.latitude, body.longitude)
    with db.session() as c:
        cur = c.execute(
            "INSERT INTO incidents(type,latitude,longitude,description,severity,trust_score,status,zone,user_id,timestamp)"
            " VALUES(?,?,?,?,?,50,'REPORTED',?,?,?)",
            (body.type, body.latitude, body.longitude, body.description.strip(), body.severity, zone, user["id"], db.now()))
        row = one(c, "incidents", cur.lastrowid, "Incident")
        risk = refresh_zone(c, zone)  # a new report may raise risk -> alert
        out = incident_out(c, row, include_user=user["role"] == auth.ROLE_ADMIN)
    return {**out, "zone_risk": risk}


@app.get("/incidents")
def list_incidents(status: Optional[IncidentStatus] = None, type: Optional[IncidentType] = None,
                   limit: int = Query(200, ge=1, le=500), user: dict = Depends(auth.current_user)):
    q, args = "SELECT * FROM incidents WHERE 1=1", []
    if status:
        q += " AND status=?"; args.append(status)
    if type:
        q += " AND type=?"; args.append(type)
    with db.session() as c:
        rows = c.execute(q + " ORDER BY id DESC LIMIT ?", [*args, limit]).fetchall()
        return [incident_out(c, r, user["role"] == auth.ROLE_ADMIN) for r in rows]


@app.get("/incidents/{incident_id}")
def get_incident(incident_id: int, user: dict = Depends(auth.current_user)):
    with db.session() as c:
        return incident_out(c, one(c, "incidents", incident_id, "Incident"), user["role"] == auth.ROLE_ADMIN)


class StatusIn(BaseModel):
    status: IncidentStatus

    _norm = field_validator("status", mode="before")(norm)


def _set_status(incident_id: int, status: str):
    with db.session() as c:
        r = one(c, "incidents", incident_id, "Incident")
        c.execute("UPDATE incidents SET status=? WHERE id=?", (status, incident_id))
        risk = refresh_zone(c, r["zone"])
        out = incident_out(c, one(c, "incidents", incident_id, "Incident"), include_user=True)
    return {**out, "zone_risk": risk}


@app.patch("/incidents/{incident_id}")
def update_incident(incident_id: int, body: StatusIn, _: dict = Depends(auth.require_admin)):
    return _set_status(incident_id, body.status)


@app.post("/incidents/{incident_id}/verify")
def verify_incident(incident_id: int, _: dict = Depends(auth.require_admin)):
    return _set_status(incident_id, "VERIFIED")


@app.post("/incidents/{incident_id}/reject")
def reject_incident(incident_id: int, _: dict = Depends(auth.require_admin)):
    return _set_status(incident_id, "REJECTED")


@app.post("/incidents/{incident_id}/resolve")
def resolve_incident(incident_id: int, _: dict = Depends(auth.require_admin)):
    return _set_status(incident_id, "RESOLVED")


# ---------- alerts ----------

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


@app.post("/alerts", status_code=201)
def create_alert(body: AlertIn, _: dict = Depends(auth.require_admin)):
    """Manual alert (source MANUAL). The risk engine never edits or clears these."""
    require_zone(body.affected_zone)
    t = db.now()
    with db.session() as c:
        cur = c.execute("INSERT INTO alerts(severity,message,affected_zone,active,created_at,source,updated_at)"
                        " VALUES(?,?,?,1,?,'MANUAL',?)", (body.severity, body.message.strip(), body.affected_zone, t, t))
        return alert_out(one(c, "alerts", cur.lastrowid, "Alert"))


# ---------- simulation ----------

class SimIn(BaseModel):
    hazard: Literal["FLOOD"] = "FLOOD"
    rainfall: float = Field(..., ge=0, le=500, description="mm of rainfall")
    zone: Optional[str] = None  # omit = all zones

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
    return {"hazard": body.hazard, "rainfall": body.rainfall, "before": first["before"], "after": first["after"],
            "zones": results, "active_alerts": alerts, "notice": DATA_NOTICE}


# ---------- roads ----------

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
        refresh_all(c)  # alerts list the affected road, so keep them in step
        return road_out(one(c, "roads", road_id, "Road"))


@app.post("/roads/{road_id}/block")
def block_road(road_id: int, _: dict = Depends(auth.require_admin)):
    return _set_road(road_id, "BLOCKED")


@app.post("/roads/{road_id}/unblock")
def unblock_road(road_id: int, _: dict = Depends(auth.require_admin)):
    return _set_road(road_id, "AVAILABLE")


# ---------- authentication ----------

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
    """Public sign-up. There is deliberately NO role field: extra fields are rejected, so a client
    cannot ask for volunteer/admin. Every self-registered account is role 'user'."""
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


@app.post("/auth/register", status_code=201)
def register(body: RegisterIn):
    with db.session() as c:
        if c.execute("SELECT 1 FROM users WHERE email=?", (body.email,)).fetchone():
            raise HTTPException(409, "An account with this email already exists.")
        cur = c.execute("INSERT INTO users(name, role, email, password_hash, phone, created_at, is_active) VALUES(?,?,?,?,?,?,1)",
                        (body.name, auth.ROLE_USER, body.email, auth.hash_password(body.password), body.phone, db.now()))
        return auth.user_public(one(c, "users", cur.lastrowid, "User"))


@app.post("/auth/login")
def login(body: LoginIn):
    email = body.email.strip().lower()
    if auth.throttled(email):
        raise HTTPException(429, "Too many failed attempts. Please wait a few minutes and try again.")
    with db.session() as c:
        row = c.execute("SELECT * FROM users WHERE email=?", (email,)).fetchone()
        ok = auth.verify_password(body.password, row["password_hash"] if row else auth._DUMMY_HASH)
        if not row or not ok:
            auth.record_failure(email)
            raise HTTPException(401, "Invalid email or password.")
        if not row["is_active"]:
            raise HTTPException(403, "This account has been disabled. Contact an administrator.")
        token, expires = auth.create_session(c, row["id"])
        user = auth.user_public(row)
    auth._failures.pop(email, None)
    return {"token": token, "token_type": "bearer", "expires_at": expires, "user": user}


def _me(c, user: dict) -> dict:
    out = auth.user_public(user)
    if user["role"] == auth.ROLE_VOLUNTEER:
        v = c.execute("SELECT * FROM volunteers WHERE user_id=?", (user["id"],)).fetchone()
        out["volunteer"] = volunteer_full(c, v) if v else None
    return out


@app.get("/auth/me")
def me(user: dict = Depends(auth.current_user)):
    with db.session() as c:
        return _me(c, user)


@app.post("/auth/logout")
def logout(token: str = Depends(auth.current_token), user: dict = Depends(auth.current_user)):
    with db.session() as c:
        auth.revoke_token(c, token)
    return {"status": "logged out"}


# ---------- help requests ----------
# Matching itself happens in the mobile app (geospatial module); the backend stores and serves the data.

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


@app.post("/help-request", status_code=201)
def create_help(body: HelpIn, user: dict = Depends(auth.current_user)):
    with db.session() as c:
        cur = c.execute("INSERT INTO help_requests(user_id,type,priority,latitude,longitude,status,created_at)"
                        " VALUES(?,?,?,?,?,'OPEN',?)",
                        (user["id"], body.type, body.priority, body.latitude, body.longitude, db.now()))
        row = dict(one(c, "help_requests", cur.lastrowid, "Help request"))
    return {"request_id": row["id"], **row}


@app.get("/help-requests")
def list_help(status: Optional[Literal["OPEN", "MATCHED", "COMPLETED"]] = None, user: dict = Depends(auth.current_user)):
    """Admin: every request. User: their own. Volunteer: requests assigned to them."""
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
            raise HTTPException(404, f"Help request {request_id} not found")  # don't reveal other people's requests
        return dict(r)


# ---------- volunteers ----------

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
    """Disable the roster entry AND its login, and release any work in progress so requests are not stranded."""
    c.execute("UPDATE volunteers SET status='DISABLED', available=0 WHERE id=?", (v["id"],))
    if v["user_id"]:
        c.execute("UPDATE users SET is_active=0 WHERE id=?", (v["user_id"],))
        auth.revoke_user_sessions(c, v["user_id"])
    for m in c.execute("SELECT * FROM matches WHERE volunteer_id=? AND status IN ('PROPOSED','ACCEPTED')", (v["id"],)).fetchall():
        c.execute("UPDATE matches SET status='CANCELLED' WHERE id=?", (m["id"],))
        c.execute("UPDATE help_requests SET status='OPEN' WHERE id=? AND status='MATCHED'", (m["help_request_id"],))


def _enable_volunteer(c, v):
    c.execute("UPDATE volunteers SET status='ACTIVE' WHERE id=?", (v["id"],))
    if v["user_id"]:
        c.execute("UPDATE users SET is_active=1 WHERE id=?", (v["user_id"],))


@app.get("/volunteers")
def list_volunteers(skill: Optional[str] = None, available: Optional[bool] = None, user: dict = Depends(auth.current_user)):
    """Admin: full roster incl. disabled, with contact details. Everyone else: active volunteers, public fields only."""
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


@app.post("/volunteers", status_code=201)
def create_volunteer(body: VolunteerIn, _: dict = Depends(auth.require_admin)):
    """Only a Super Admin can create volunteer accounts."""
    with db.session() as c:
        if c.execute("SELECT 1 FROM users WHERE email=?", (body.email,)).fetchone():
            raise HTTPException(409, "An account with this email already exists.")
        u = c.execute("INSERT INTO users(name, role, email, password_hash, phone, created_at, is_active, latitude, longitude)"
                      " VALUES(?,?,?,?,?,?,1,?,?)",
                      (body.name.strip(), auth.ROLE_VOLUNTEER, body.email, auth.hash_password(body.password), body.phone,
                       db.now(), body.latitude, body.longitude))
        cur = c.execute("INSERT INTO volunteers(name, skill, latitude, longitude, available, user_id, status)"
                        " VALUES(?,?,?,?,?,?,'ACTIVE')",
                        (body.name.strip(), body.skill, body.latitude, body.longitude, int(body.available), u.lastrowid))
        return volunteer_full(c, one(c, "volunteers", cur.lastrowid, "Volunteer"))


@app.get("/volunteers/me")
def my_volunteer(user: dict = Depends(auth.require_volunteer)):
    with db.session() as c:
        v = _my_row(c, user)
        assigned, nearby = _my_requests(c, v)
        return {"volunteer": volunteer_full(c, v), "assigned_count": len(assigned), "nearby_open_count": len(nearby)}


def _my_row(c, user: dict):
    v = c.execute("SELECT * FROM volunteers WHERE user_id=?", (user["id"],)).fetchone()
    if not v:
        raise HTTPException(404, "No volunteer profile is linked to this account.")
    return v


def _my_requests(c, v):
    assigned = []
    for m in c.execute("SELECT * FROM matches WHERE volunteer_id=? AND status IN ('PROPOSED','ACCEPTED') ORDER BY id DESC", (v["id"],)):
        r = c.execute("SELECT * FROM help_requests WHERE id=?", (m["help_request_id"],)).fetchone()
        who = c.execute("SELECT name, phone FROM users WHERE id=?", (r["user_id"],)).fetchone() if r["user_id"] else None
        dist = None
        if None not in (r["latitude"], r["longitude"], v["latitude"], v["longitude"]):
            dist = round(_km(v["latitude"], v["longitude"], r["latitude"], r["longitude"]), 2)
        assigned.append({"match_id": m["id"], "match_status": m["status"], "request_id": r["id"], "type": r["type"],
                         "priority": r["priority"], "status": r["status"], "latitude": r["latitude"],
                         "longitude": r["longitude"], "distance_km": dist, "created_at": r["created_at"],
                         "requester_name": who["name"] if who else None, "requester_phone": who["phone"] if who else None})
    nearby = []
    if v["status"] == "ACTIVE":
        for r in c.execute("SELECT * FROM help_requests WHERE status='OPEN' AND type=? ORDER BY id DESC", (v["skill"],)):
            if None in (r["latitude"], r["longitude"], v["latitude"], v["longitude"]):
                continue
            d = round(_km(v["latitude"], v["longitude"], r["latitude"], r["longitude"]), 2)
            if d <= 15:
                nearby.append({"request_id": r["id"], "type": r["type"], "priority": r["priority"], "distance_km": d,
                               "created_at": r["created_at"]})
        nearby.sort(key=lambda x: x["distance_km"])
    return assigned, nearby


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
    """assigned = requests matched to this volunteer; nearby_open = unmatched requests for their skill within 15 km."""
    with db.session() as c:
        assigned, nearby = _my_requests(c, _my_row(c, user))
        return {"assigned": assigned, "nearby_open": nearby}


@app.put("/volunteers/{volunteer_id}")
def update_volunteer(volunteer_id: int, body: VolunteerUpdate, _: dict = Depends(auth.require_admin)):
    with db.session() as c:
        v = one(c, "volunteers", volunteer_id, "Volunteer")
        d = body.model_dump(exclude_unset=True)
        if "email" in d and d["email"] is not None and v["user_id"]:
            clash = c.execute("SELECT id FROM users WHERE email=? AND id!=?", (d["email"], v["user_id"])).fetchone()
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
    """Disables rather than erases: the login stops working, open assignments are released, history is kept."""
    with db.session() as c:
        v = one(c, "volunteers", volunteer_id, "Volunteer")
        _disable_volunteer(c, v)
        return volunteer_full(c, one(c, "volunteers", volunteer_id, "Volunteer"))


# ---------- matches ----------

class MatchIn(BaseModel):
    help_request_id: int = Field(..., ge=1)
    volunteer_id: int = Field(..., ge=1)


def match_out(c, m) -> dict:
    v = c.execute("SELECT name, skill FROM volunteers WHERE id=?", (m["volunteer_id"],)).fetchone()
    r = c.execute("SELECT type, priority FROM help_requests WHERE id=?", (m["help_request_id"],)).fetchone()
    return {**dict(m), "volunteer_name": v["name"] if v else None, "request_type": r["type"] if r else None,
            "request_priority": r["priority"] if r else None}


@app.get("/matches")
def list_matches(help_request_id: Optional[int] = None, user: dict = Depends(auth.current_user)):
    """Admin: all. User: matches for their requests. Volunteer: their own matches."""
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


@app.post("/matches", status_code=201)
def create_match(body: MatchIn, user: dict = Depends(auth.current_user)):
    """Persist a match chosen by the matching engine. Allowed for the request's owner or an admin.
    The volunteer must be active, available and have the skill the request asks for."""
    with db.session() as c:
        r = one(c, "help_requests", body.help_request_id, "Help request")
        if user["role"] != auth.ROLE_ADMIN and r["user_id"] != user["id"]:
            raise HTTPException(404, f"Help request {body.help_request_id} not found")
        v = one(c, "volunteers", body.volunteer_id, "Volunteer")
        if c.execute("SELECT 1 FROM matches WHERE help_request_id=? AND status!='CANCELLED'", (body.help_request_id,)).fetchone():
            raise HTTPException(409, f"Help request {body.help_request_id} already has a match")
        if v["status"] != "ACTIVE" or not v["available"]:
            raise HTTPException(409, "That volunteer is not available.")
        if v["skill"] != r["type"]:
            raise HTTPException(422, f"Volunteer skill {v['skill']} does not match the requested {r['type']}.")
        cur = c.execute("INSERT INTO matches(help_request_id,volunteer_id,status,created_at) VALUES(?,?,'PROPOSED',?)",
                        (body.help_request_id, body.volunteer_id, db.now()))
        c.execute("UPDATE help_requests SET status='MATCHED' WHERE id=?", (body.help_request_id,))
        return match_out(c, one(c, "matches", cur.lastrowid, "Match"))


def _match_action(match_id: int, user: dict, expect: str, new_status: str):
    with db.session() as c:
        m = one(c, "matches", match_id, "Match")
        if user["role"] != auth.ROLE_ADMIN:
            mine = c.execute("SELECT 1 FROM volunteers WHERE id=? AND user_id=?", (m["volunteer_id"], user["id"])).fetchone()
            if not mine:
                raise HTTPException(404, f"Match {match_id} not found")
        if m["status"] != expect:
            raise HTTPException(409, f"Match is {m['status']}; it must be {expect} to do this.")
        c.execute("UPDATE matches SET status=? WHERE id=?", (new_status, match_id))
        if new_status == "COMPLETED":
            c.execute("UPDATE help_requests SET status='COMPLETED' WHERE id=?", (m["help_request_id"],))
        return match_out(c, one(c, "matches", match_id, "Match"))


@app.post("/matches/{match_id}/accept")
def accept_match(match_id: int, user: dict = Depends(auth.require_roles(auth.ROLE_VOLUNTEER, auth.ROLE_ADMIN))):
    return _match_action(match_id, user, "PROPOSED", "ACCEPTED")


@app.post("/matches/{match_id}/complete")
def complete_match(match_id: int, user: dict = Depends(auth.require_roles(auth.ROLE_VOLUNTEER, auth.ROLE_ADMIN))):
    return _match_action(match_id, user, "ACCEPTED", "COMPLETED")


# ---------- admin ----------

@app.get("/admin/summary")
def admin_summary(_: dict = Depends(auth.require_admin)):
    with db.session() as c:
        risks = [compute_risk(c, z) for z in db.ZONES]
        n = lambda q: c.execute(q).fetchone()[0]  # noqa: E731
        return {
            "risk": max(risks, key=lambda r: r["risk_score"]),
            "active_alerts": n("SELECT COUNT(*) FROM alerts WHERE active=1"),
            "open_incidents": n("SELECT COUNT(*) FROM incidents WHERE status='REPORTED'"),
            "blocked_roads": n("SELECT COUNT(*) FROM roads WHERE status='BLOCKED'"),
            "pending_help_requests": n("SELECT COUNT(*) FROM help_requests WHERE status='OPEN'"),
            "available_volunteers": n("SELECT COUNT(*) FROM volunteers WHERE status='ACTIVE' AND available=1"),
            "open_matches": n("SELECT COUNT(*) FROM matches WHERE status IN ('PROPOSED','ACCEPTED')"),
            "users": {role: n(f"SELECT COUNT(*) FROM users WHERE role='{role}'") for role in (auth.ROLE_USER, auth.ROLE_VOLUNTEER, auth.ROLE_ADMIN)},
            "notice": DATA_NOTICE,
        }


@app.get("/admin/users")
def admin_users(_: dict = Depends(auth.require_admin)):
    with db.session() as c:
        return [{"id": r["id"], "name": r["name"], "email": r["email"], "role": r["role"], "phone": r["phone"],
                 "is_active": bool(r["is_active"]), "created_at": r["created_at"]}
                for r in c.execute("SELECT * FROM users ORDER BY id").fetchall()]


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
