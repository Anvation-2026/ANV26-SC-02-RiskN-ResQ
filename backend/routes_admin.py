"""Admin operations: analytics, CSV export, audit log, area broadcast, shelters/hospitals, OpenStreetMap imports.
Public read: GET /places."""
import csv
import io
import json
import math
from collections import Counter
from datetime import datetime, timedelta, timezone
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel, Field

import audit
import auth
import config
import db
import notify
import osm
import weather_monitor
from engine import _km

router = APIRouter()
provider = None  # the weather provider, set by main (used for elevation lookups)

PLACE_KINDS = ("HOSPITAL", "SHELTER", "HELPLINE_POINT")


def _day(iso: str) -> str:
    return (iso or "")[:10]


def _parse(iso: str):
    try:
        dt = datetime.fromisoformat(iso)
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except Exception:
        return None


# ---------------------------------------------------------------------------------------------------------- analytics
@router.get("/admin/analytics")
def analytics(days: int = Query(14, ge=1, le=60), _: dict = Depends(auth.require_admin)):
    since = (datetime.now(timezone.utc) - timedelta(days=days)).date().isoformat()
    with db.session() as c:
        inc = c.execute("SELECT timestamp, type, status, duplicate_of FROM incidents WHERE timestamp >= ?", (since,)).fetchall()
        reqs = c.execute("SELECT id, type, status, created_at FROM help_requests WHERE created_at >= ?", (since,)).fetchall()
        alerts = c.execute("SELECT severity, created_at, source FROM alerts WHERE created_at >= ?", (since,)).fetchall()
        events = c.execute("SELECT help_request_id, event, at FROM match_events ORDER BY id").fetchall()
        hist = c.execute("SELECT at, max_mm, avg_mm, heavy FROM weather_history ORDER BY id DESC LIMIT 96").fetchall()
        totals = {role: c.execute("SELECT COUNT(*) FROM users WHERE role=?", (role,)).fetchone()[0]
                  for role in (auth.ROLE_USER, auth.ROLE_VOLUNTEER, auth.ROLE_ADMIN)}
    labels = [(datetime.now(timezone.utc).date() - timedelta(days=i)).isoformat() for i in range(days - 1, -1, -1)]
    per_day = Counter(_day(r["timestamp"]) for r in inc if not r["duplicate_of"])
    # response time = request created -> a volunteer accepted it
    first = {}
    for e in events:
        if e["event"] == "REQUESTED":
            first.setdefault(e["help_request_id"], {})["req"] = e["at"]
        elif e["event"] == "ACCEPTED":
            first.setdefault(e["help_request_id"], {}).setdefault("acc", e["at"])
    mins = []
    for v in first.values():
        a, b = _parse(v.get("req")), _parse(v.get("acc"))
        if a and b and b >= a:
            mins.append((b - a).total_seconds() / 60)
    return {
        "days": days,
        "incidents_per_day": [{"date": d, "count": per_day.get(d, 0)} for d in labels],
        "incidents_by_type": dict(Counter(r["type"] for r in inc if not r["duplicate_of"])),
        "incidents_by_status": dict(Counter(r["status"] for r in inc if not r["duplicate_of"])),
        "duplicates_merged": sum(1 for r in inc if r["duplicate_of"]),
        "help_requests_by_status": dict(Counter(r["status"] for r in reqs)),
        "help_requests_per_day": [{"date": d, "count": sum(1 for r in reqs if _day(r["created_at"]) == d)} for d in labels],
        "avg_response_minutes": round(sum(mins) / len(mins), 1) if mins else None,
        "responses_measured": len(mins),
        "alerts_by_severity": dict(Counter(r["severity"] for r in alerts)),
        "rainfall_history": [{"at": r["at"], "max_mm": r["max_mm"], "avg_mm": r["avg_mm"], "heavy_areas": r["heavy"]} for r in reversed(hist)],
        "users": totals,
    }


# -------------------------------------------------------------------------------------------------------------- export
def _cell(v):
    if v is None:
        return ""
    s = str(v)
    return "'" + s if s[:1] in ("=", "+", "-", "@", "\t", "\r") else s  # a spreadsheet must never run a stored value as a formula


EXPORTS = {
    "incidents": ("SELECT id, type, status, severity, trust_score, confirmations, duplicate_of, zone, latitude, longitude, "
                  "description, reported_by, timestamp FROM incidents ORDER BY id"),
    "help-requests": ("SELECT h.id, h.type, h.priority, h.status, u.name AS requester, h.latitude, h.longitude, h.created_at "
                      "FROM help_requests h LEFT JOIN users u ON u.id=h.user_id ORDER BY h.id"),
    "alerts": "SELECT id, severity, affected_zone, source, active, message, risk_score, created_at FROM alerts ORDER BY id",
    "audit": "SELECT id, at, actor, action, target, detail FROM audit_log ORDER BY id",
}


@router.get("/admin/export/{kind}.csv")
def export_csv(kind: str, admin: dict = Depends(auth.require_admin)):
    if kind not in EXPORTS:
        raise HTTPException(404, f"Unknown export. Choose one of: {', '.join(EXPORTS)}")
    with db.session() as c:
        cur = c.execute(EXPORTS[kind])
        rows = cur.fetchall()
        cols = rows[0].keys() if rows else [d[0] for d in (cur.description or [])]
        audit.record(c, admin, "export.csv", kind, f"{len(rows)} rows")
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(list(cols))
    for r in rows:
        w.writerow([_cell(r[k]) for k in cols])
    return Response(buf.getvalue(), media_type="text/csv",
                    headers={"Content-Disposition": f'attachment; filename="riskn-{kind}.csv"'})


# ----------------------------------------------------------------------------------------------------------- audit log
@router.get("/admin/audit")
def audit_log(limit: int = Query(100, ge=1, le=500), _: dict = Depends(auth.require_admin)):
    with db.session() as c:
        return [dict(r) for r in c.execute("SELECT * FROM audit_log ORDER BY id DESC LIMIT ?", (limit,)).fetchall()]


@router.get("/admin/system")
def system_status(_: dict = Depends(auth.require_admin)):
    """Which optional channels are configured (never shows the secrets themselves)."""
    with db.session() as c:
        devices = c.execute("SELECT COUNT(*) FROM push_tokens").fetchone()[0]
        sms_users = c.execute("SELECT COUNT(*) FROM users WHERE notify_sms=1").fetchone()[0]
    return {"push": {"enabled": config.PUSH_ENABLED, "registered_devices": devices},
            "sms": {"configured": notify.sms_configured(), "opted_in_users": sms_users},
            "email": {"configured": notify.email_configured()},
            "database": db.BACKEND, "weather_monitor": config.WEATHER_MONITOR_ENABLED}


# ----------------------------------------------------------------------------------------------------------- broadcast
class BroadcastIn(BaseModel):
    message: str = Field(..., min_length=3, max_length=300)
    severity: Literal["LOW", "MEDIUM", "HIGH", "CRITICAL"] = "MEDIUM"
    zone: Optional[str] = None  # None = everyone


@router.post("/admin/broadcast", status_code=201)
def broadcast(body: BroadcastIn, admin: dict = Depends(auth.require_admin)):
    if body.zone is not None and body.zone not in db.ZONES:
        raise HTTPException(404, f"Unknown zone '{body.zone}'. Valid zones: {list(db.ZONES)}")
    t = db.now()
    with db.session() as c:
        cur = c.execute("INSERT INTO alerts(severity,message,affected_zone,active,created_at,source,updated_at) "
                        "VALUES(?,?,?,1,?,'ADMIN',?)", (body.severity, body.message.strip(), body.zone or "All areas", t, t))
        if body.zone:
            ids = notify.users_near(c, *db.ZONES[body.zone], 10.0)
        else:
            ids = [r["id"] for r in c.execute("SELECT id FROM users WHERE role='user' AND is_active=1").fetchall()]
        sent = notify.notify_users(c, ids, f"{body.severity.capitalize()} alert from RiskN ResQ", body.message.strip(),
                                   {"type": "alert", "alert_id": cur.lastrowid}, sms=body.severity in ("HIGH", "CRITICAL"))  # admin broadcasts are deliberate: no cooldown
        audit.record(c, admin, "broadcast.send", cur.lastrowid, f"{body.severity} to {body.zone or 'everyone'}: {body.message[:120]}")
    return {"alert_id": cur.lastrowid, "recipients": len(ids), **sent}


@router.post("/admin/broadcast/{alert_id}/clear")
def clear_broadcast(alert_id: int, admin: dict = Depends(auth.require_admin)):
    with db.session() as c:
        row = c.execute("SELECT * FROM alerts WHERE id=? AND source='ADMIN'", (alert_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Broadcast not found.")
        c.execute("UPDATE alerts SET active=0, updated_at=? WHERE id=?", (db.now(), alert_id))
        audit.record(c, admin, "broadcast.clear", alert_id)
    return {"status": "cleared"}


# ------------------------------------------------------------------------------------------------ shelters & hospitals
def _place(r) -> dict:
    return {"id": r["id"], "kind": r["kind"], "name": r["name"], "latitude": r["latitude"], "longitude": r["longitude"],
            "phone": r["phone"], "address": r["address"], "source": r["source"]}


@router.get("/places")
def list_places(kind: Optional[str] = None, latitude: Optional[float] = None, longitude: Optional[float] = None,
                radius_km: float = Query(30.0, ge=0.1, le=200), limit: int = Query(500, ge=1, le=500)):
    q, args = "SELECT * FROM places", []
    if kind:
        q += " WHERE kind=?"; args.append(kind.upper())
    with db.session() as c:
        rows = [_place(r) for r in c.execute(q + " ORDER BY id", args).fetchall()]
    if latitude is not None and longitude is not None:
        for r in rows:
            r["distance_km"] = round(_km(latitude, longitude, r["latitude"], r["longitude"]), 2)
        rows = sorted((r for r in rows if r["distance_km"] <= radius_km), key=lambda r: r["distance_km"])
    return rows[:limit]


class PlaceIn(BaseModel):
    kind: Literal["HOSPITAL", "SHELTER"]
    name: str = Field(..., min_length=2, max_length=120)
    latitude: float = Field(..., ge=-90, le=90)
    longitude: float = Field(..., ge=-180, le=180)
    phone: Optional[str] = Field(None, max_length=30)
    address: Optional[str] = Field(None, max_length=200)


@router.post("/admin/places", status_code=201)
def add_place(body: PlaceIn, admin: dict = Depends(auth.require_admin)):
    with db.session() as c:
        cur = c.execute("INSERT INTO places(kind,name,latitude,longitude,phone,address,source,created_at) VALUES(?,?,?,?,?,?,'ADMIN',?)",
                        (body.kind, body.name.strip(), body.latitude, body.longitude, body.phone, body.address, db.now()))
        audit.record(c, admin, "place.add", cur.lastrowid, f"{body.kind} {body.name}")
        return _place(c.execute("SELECT * FROM places WHERE id=?", (cur.lastrowid,)).fetchone())


@router.delete("/admin/places/{place_id}")
def delete_place(place_id: int, admin: dict = Depends(auth.require_admin)):
    with db.session() as c:
        row = c.execute("SELECT * FROM places WHERE id=?", (place_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Place not found.")
        c.execute("DELETE FROM places WHERE id=?", (place_id,))
        audit.record(c, admin, "place.delete", place_id, row["name"])
    return {"status": "deleted"}


@router.post("/admin/places/import-osm")
async def import_places(admin: dict = Depends(auth.require_admin)):
    """Hospitals and shelters/assembly points inside the monitored area, from OpenStreetMap."""
    elements, failed = [], 0
    for q in (osm.shelters_query(), osm.hospitals_query()):   # separate queries so neither kind crowds the other out of the result limit
        try:
            elements += (await osm.fetch(q)).get("elements", [])
        except Exception:
            failed += 1
    if failed == 2:
        raise HTTPException(503, "OpenStreetMap is unavailable right now. Try again in a minute.")
    data = {"elements": elements}
    added = 0
    with db.session() as c:
        have = {r["external_id"] for r in c.execute("SELECT external_id FROM places WHERE external_id IS NOT NULL")}
        els = data.get("elements", [])
        is_hospital = lambda e: (e.get("tags") or {}).get("amenity") == "hospital"  # noqa: E731
        # shelters / assembly points first (there are far fewer of them), then hospitals, so neither crowds the other out
        for el in ([e for e in els if not is_hospital(e)][:100] + [e for e in els if is_hospital(e)][:150]):
            tags = el.get("tags") or {}
            name = (tags.get("name") or "").strip()
            lat = el.get("lat") or (el.get("center") or {}).get("lat")
            lon = el.get("lon") or (el.get("center") or {}).get("lon")
            ext = f"osm:{el.get('type')}:{el.get('id')}"
            if not name or lat is None or lon is None or ext in have:
                continue
            kind = "HOSPITAL" if tags.get("amenity") == "hospital" else "SHELTER"
            addr = ", ".join(x for x in (tags.get("addr:street"), tags.get("addr:suburb"), tags.get("addr:city")) if x) or None
            c.execute("INSERT INTO places(kind,name,latitude,longitude,phone,address,source,external_id,created_at) VALUES(?,?,?,?,?,?,'OSM',?,?)",
                      (kind, name[:120], lat, lon, tags.get("phone") or tags.get("contact:phone"), addr, ext, db.now()))
            have.add(ext)
            added += 1
        audit.record(c, admin, "places.import_osm", "", f"{added} added")
        total = c.execute("SELECT COUNT(*) FROM places").fetchone()[0]
    return {"added": added, "total": total, "source": "OpenStreetMap"}


# ------------------------------------------------------------------------------------------------------ OSM road import
@router.post("/admin/roads/import-osm")
async def import_roads(admin: dict = Depends(auth.require_admin), limit: int = Query(40, ge=1, le=100)):
    """Real named major roads (trunk/primary/secondary) in the monitored area, with ground elevation. Low-lying ones are
    flagged as flood-prone. Existing roads (same name) are never overwritten."""
    try:
        data = await osm.fetch(osm.roads_query())
    except Exception:
        raise HTTPException(503, "OpenStreetMap is unavailable right now. Try again in a minute.")
    best = {}
    for el in data.get("elements", []):
        name = ((el.get("tags") or {}).get("name") or "").strip()
        pts = [[g["lat"], g["lon"]] for g in el.get("geometry") or [] if "lat" in g]
        if name and len(pts) >= 2:
            length = sum(_km(a[0], a[1], b[0], b[1]) for a, b in zip(pts, pts[1:]))
            if name not in best or length > best[name][0]:
                best[name] = (length, pts)
    chosen = sorted(best.items(), key=lambda kv: -kv[1][0])[:limit]
    elev = []
    if provider is not None and chosen:
        try:
            mids = [tuple(p[1][len(p[1]) // 2]) for _, p in chosen]
            elev = await provider.get_elevations(mids)
        except Exception:
            elev = []
    elev = list(elev) + [None] * (len(chosen) - len(elev))
    added = 0
    with db.session() as c:
        have = {r["name"].lower() for r in c.execute("SELECT name FROM roads")}
        grid = [r["elevation_m"] for r in c.execute("SELECT elevation_m FROM terrain_data")]
        limit_m = weather_monitor.low_lying_threshold([e for e in grid if e is not None] or [e for e in elev if e is not None])
        for (name, (_, pts)), e in zip(chosen, elev):
            if name.lower() in have:
                continue
            low = 1 if (limit_m is not None and e is not None and e <= limit_m) else 0
            c.execute("INSERT INTO roads(name, coordinates, status, source, elevation, low_lying) VALUES(?,?,'AVAILABLE','OSM',?,?)",
                      (name, json.dumps(osm.thin(pts)), e, low))
            added += 1
        audit.record(c, admin, "roads.import_osm", "", f"{added} added")
        total = c.execute("SELECT COUNT(*) FROM roads").fetchone()[0]
    return {"added": added, "total": total, "source": "OpenStreetMap", "elevation": "Open-Meteo" if any(e is not None for e in elev) else "unavailable"}
