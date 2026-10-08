import json
from typing import Literal, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

import db
from engine import compute_risk, compute_trust, refresh_zone, similar_count

app = FastAPI(title="ResilientUrban API", version="1.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

IncidentType = Literal["FLOOD", "BLOCKED_ROAD", "EMERGENCY"]
IncidentStatus = Literal["REPORTED", "VERIFIED", "REJECTED", "RESOLVED"]


@app.on_event("startup")
def _startup():
    db.init_db()


# ---------- serializers ----------

def incident_out(c, r) -> dict:
    return {"id": r["id"], "type": r["type"], "latitude": r["latitude"], "longitude": r["longitude"],
            "description": r["description"], "severity": r["severity"], "trust_score": compute_trust(c, r),
            "similar_reports": similar_count(c, r), "status": r["status"], "zone": r["zone"],
            "user_id": r["user_id"], "timestamp": r["timestamp"]}


def road_out(r) -> dict:
    return {"id": r["id"], "name": r["name"], "coordinates": json.loads(r["coordinates"]), "status": r["status"]}


def alert_out(r) -> dict:
    return {"id": r["id"], "severity": r["severity"], "message": r["message"],
            "affected_zone": r["affected_zone"], "active": bool(r["active"]), "created_at": r["created_at"]}


# ---------- health ----------

@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/reset")
def reset():
    """Reset DB to seeded demo state (use before the demo)."""
    db.init_db(reset=True)
    return {"status": "reset"}


# ---------- risk ----------

@app.get("/risk")
def get_risk(zone: Optional[str] = None):
    """All zones (list), or one zone with ?zone=Zone%20A. Also includes the worst zone as `overall`."""
    c = db.conn()
    zones = [zone] if zone else list(db.ZONES)
    if zone and zone not in db.ZONES:
        raise HTTPException(404, f"Unknown zone. Valid: {list(db.ZONES)}")
    risks = [compute_risk(c, z) for z in zones]
    c.close()
    if zone:
        return risks[0]
    return {"overall": max(risks, key=lambda r: r["risk_score"]), "zones": risks}


# ---------- incidents ----------

class IncidentIn(BaseModel):
    type: IncidentType
    latitude: float
    longitude: float
    description: str = ""
    severity: int = Field(3, ge=1, le=5)
    user_id: Optional[int] = None


@app.post("/incidents", status_code=201)
def create_incident(body: IncidentIn):
    c = db.conn()
    zone = db.nearest_zone(body.latitude, body.longitude)
    cur = c.execute(
        "INSERT INTO incidents(type,latitude,longitude,description,severity,trust_score,status,zone,user_id,timestamp)"
        " VALUES(?,?,?,?,?,50,'REPORTED',?,?,?)",
        (body.type, body.latitude, body.longitude, body.description, body.severity, zone, body.user_id, db.now()))
    row = c.execute("SELECT * FROM incidents WHERE id=?", (cur.lastrowid,)).fetchone()
    risk = refresh_zone(c, zone)  # new report may raise risk -> alert
    out = incident_out(c, row)
    c.commit()
    c.close()
    return {**out, "zone_risk": risk}


@app.get("/incidents")
def list_incidents(status: Optional[IncidentStatus] = None, type: Optional[IncidentType] = None):
    c = db.conn()
    q, args = "SELECT * FROM incidents WHERE 1=1", []
    if status:
        q += " AND status=?"; args.append(status)
    if type:
        q += " AND type=?"; args.append(type)
    rows = c.execute(q + " ORDER BY id DESC", args).fetchall()
    out = [incident_out(c, r) for r in rows]
    c.close()
    return out


@app.get("/incidents/{incident_id}")
def get_incident(incident_id: int):
    c = db.conn()
    r = c.execute("SELECT * FROM incidents WHERE id=?", (incident_id,)).fetchone()
    if not r:
        raise HTTPException(404, "Incident not found")
    out = incident_out(c, r)
    c.close()
    return out


class StatusIn(BaseModel):
    status: IncidentStatus


def _set_status(incident_id: int, status: str):
    c = db.conn()
    r = c.execute("SELECT * FROM incidents WHERE id=?", (incident_id,)).fetchone()
    if not r:
        raise HTTPException(404, "Incident not found")
    c.execute("UPDATE incidents SET status=? WHERE id=?", (status, incident_id))
    risk = refresh_zone(c, r["zone"])
    out = incident_out(c, c.execute("SELECT * FROM incidents WHERE id=?", (incident_id,)).fetchone())
    c.commit()
    c.close()
    return {**out, "zone_risk": risk}


@app.patch("/incidents/{incident_id}")
def update_incident(incident_id: int, body: StatusIn):
    return _set_status(incident_id, body.status)


@app.post("/incidents/{incident_id}/verify")
def verify_incident(incident_id: int):
    return _set_status(incident_id, "VERIFIED")


@app.post("/incidents/{incident_id}/reject")
def reject_incident(incident_id: int):
    return _set_status(incident_id, "REJECTED")


@app.post("/incidents/{incident_id}/resolve")
def resolve_incident(incident_id: int):
    return _set_status(incident_id, "RESOLVED")


# ---------- alerts ----------

class AlertIn(BaseModel):
    severity: Literal["LOW", "MEDIUM", "HIGH", "CRITICAL"]
    message: str
    affected_zone: str


@app.get("/alerts")
def list_alerts(active_only: bool = False):
    c = db.conn()
    q = "SELECT * FROM alerts" + (" WHERE active=1" if active_only else "") + " ORDER BY id DESC"
    out = [alert_out(r) for r in c.execute(q).fetchall()]
    c.close()
    return out


@app.post("/alerts", status_code=201)
def create_alert(body: AlertIn):
    c = db.conn()
    cur = c.execute("INSERT INTO alerts(severity,message,affected_zone,active,created_at) VALUES(?,?,?,1,?)",
                    (body.severity, body.message, body.affected_zone, db.now()))
    out = alert_out(c.execute("SELECT * FROM alerts WHERE id=?", (cur.lastrowid,)).fetchone())
    c.commit()
    c.close()
    return out


# ---------- simulation ----------

class SimIn(BaseModel):
    hazard: Literal["FLOOD"] = "FLOOD"
    rainfall: float = Field(..., ge=0)
    zone: Optional[str] = None  # omit = all zones


@app.post("/simulate-hazard")
def simulate(body: SimIn):
    if body.zone and body.zone not in db.ZONES:
        raise HTTPException(404, f"Unknown zone. Valid: {list(db.ZONES)}")
    zones = [body.zone] if body.zone else list(db.ZONES)
    c = db.conn()
    results = []
    for z in zones:
        before = compute_risk(c, z)
        c.execute("UPDATE environment_data SET rainfall=?, updated_at=? WHERE zone=?", (body.rainfall, db.now(), z))
        after = refresh_zone(c, z)
        results.append({"zone": z, "before": before, "after": after})
    alerts = [alert_out(r) for r in c.execute("SELECT * FROM alerts WHERE active=1 ORDER BY id DESC").fetchall()]
    c.commit()
    c.close()
    first = results[0]
    return {"hazard": body.hazard, "rainfall": body.rainfall, "before": first["before"], "after": first["after"],
            "zones": results, "active_alerts": alerts}


# ---------- roads ----------

@app.get("/roads")
def list_roads(status: Optional[Literal["AVAILABLE", "BLOCKED"]] = None):
    c = db.conn()
    q, args = "SELECT * FROM roads", []
    if status:
        q += " WHERE status=?"; args.append(status)
    out = [road_out(r) for r in c.execute(q, args).fetchall()]
    c.close()
    return out


def _set_road(road_id: int, status: str):
    c = db.conn()
    if not c.execute("SELECT 1 FROM roads WHERE id=?", (road_id,)).fetchone():
        raise HTTPException(404, "Road not found")
    c.execute("UPDATE roads SET status=? WHERE id=?", (status, road_id))
    out = road_out(c.execute("SELECT * FROM roads WHERE id=?", (road_id,)).fetchone())
    c.commit()
    c.close()
    return out


@app.get("/roads/{road_id}")
def get_road(road_id: int):
    c = db.conn()
    r = c.execute("SELECT * FROM roads WHERE id=?", (road_id,)).fetchone()
    c.close()
    if not r:
        raise HTTPException(404, "Road not found")
    return road_out(r)


@app.post("/roads/{road_id}/block")
def block_road(road_id: int):
    return _set_road(road_id, "BLOCKED")


@app.post("/roads/{road_id}/unblock")
def unblock_road(road_id: int):
    return _set_road(road_id, "AVAILABLE")


# ---------- help requests / volunteers / matches (matching logic = Person 3) ----------

class HelpIn(BaseModel):
    user_id: Optional[int] = None
    type: str  # e.g. MEDICINE, FOOD, FIRST_AID
    priority: Literal["LOW", "MEDIUM", "HIGH", "CRITICAL"] = "MEDIUM"
    latitude: Optional[float] = None
    longitude: Optional[float] = None


@app.post("/help-request", status_code=201)
def create_help(body: HelpIn):
    c = db.conn()
    cur = c.execute("INSERT INTO help_requests(user_id,type,priority,latitude,longitude,status,created_at)"
                    " VALUES(?,?,?,?,?,'OPEN',?)",
                    (body.user_id, body.type.upper(), body.priority, body.latitude, body.longitude, db.now()))
    rid = cur.lastrowid
    row = dict(c.execute("SELECT * FROM help_requests WHERE id=?", (rid,)).fetchone())
    c.commit()
    c.close()
    return {"request_id": rid, **row}


@app.get("/help-requests")
def list_help():
    c = db.conn()
    out = [dict(r) for r in c.execute("SELECT * FROM help_requests ORDER BY id DESC").fetchall()]
    c.close()
    return out


@app.get("/volunteers")
def list_volunteers():
    c = db.conn()
    out = [dict(r) | {"available": bool(r["available"])} for r in c.execute("SELECT * FROM volunteers").fetchall()]
    c.close()
    return out


class MatchIn(BaseModel):
    help_request_id: int
    volunteer_id: int


@app.get("/matches")
def list_matches():
    c = db.conn()
    out = [dict(r) for r in c.execute("SELECT * FROM matches ORDER BY id DESC").fetchall()]
    c.close()
    return out


@app.post("/matches", status_code=201)
def create_match(body: MatchIn):
    """For Person 3's matching engine to persist a match."""
    c = db.conn()
    cur = c.execute("INSERT INTO matches(help_request_id,volunteer_id,status,created_at) VALUES(?,?,'PROPOSED',?)",
                    (body.help_request_id, body.volunteer_id, db.now()))
    c.execute("UPDATE help_requests SET status='MATCHED' WHERE id=?", (body.help_request_id,))
    out = dict(c.execute("SELECT * FROM matches WHERE id=?", (cur.lastrowid,)).fetchone())
    c.commit()
    c.close()
    return out
