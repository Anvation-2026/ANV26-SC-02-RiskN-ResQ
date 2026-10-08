"""Road status from environmental risk plus reports. A road is only BLOCKED on evidence (an admin closure, or a reported /
verified blocked-road incident on it). A high-risk area merely marks roads POTENTIALLY AFFECTED. The risk comes from a ~9 km
grid cell estimate, not from a road-level observation, and is labelled that way."""
import json
import math
from typing import Optional

import flood_intel
from engine import haversine_meters

OPEN, POTENTIAL, REPORTED_BLOCKED, VERIFIED_BLOCKED = "OPEN", "POTENTIALLY_AFFECTED", "REPORTED_BLOCKED", "VERIFIED_BLOCKED"
BLOCKING_TYPES = ("BLOCKED_ROAD", "FLOODED_ROAD")
NEAR_ROAD_M = 80.0


class PredictionIndex:
    """Stored per-cell risk predictions, looked up by position without touching the database again."""

    def __init__(self, c):
        self.rows = c.execute("SELECT cell, latitude, longitude, risk_score, risk_level, insufficient FROM flood_risk_predictions").fetchall()
        env = flood_intel.grid_cells(c)
        self.dlat, self.dlng = flood_intel.grid_steps(env) if env else (0.08, 0.08)

    def at(self, lat: float, lng: float):
        best, bd = None, 1e18
        for r in self.rows:
            if abs(r["latitude"] - lat) <= self.dlat * 0.6 and abs(r["longitude"] - lng) <= self.dlng * 0.6:
                d = haversine_meters(lat, lng, r["latitude"], r["longitude"])
                if d < bd:
                    best, bd = r, d
        return best if best is not None and not best["insufficient"] else None


def point_segment_m(lat: float, lng: float, a: list, b: list) -> float:
    """Distance in metres from a point to the segment a-b (local flat approximation, fine at city scale)."""
    k = math.cos(math.radians(lat))
    px, py = (lng) * 111320.0 * k, lat * 110540.0
    ax, ay = a[1] * 111320.0 * k, a[0] * 110540.0
    bx, by = b[1] * 111320.0 * k, b[0] * 110540.0
    dx, dy = bx - ax, by - ay
    t = 0.0 if dx == dy == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def near_polyline(lat: float, lng: float, pts: list, within_m: float) -> bool:
    return any(point_segment_m(lat, lng, a, b) <= within_m for a, b in zip(pts, pts[1:]))


def densify(pts: list, step_m: float = 25.0) -> list:
    """Insert points so no two neighbours are further apart than step_m. Routing engines put vertices only at turns, so a
    long straight stretch can cross a closed road between two vertices; checking only the vertices would miss it."""
    out = []
    for a, b in zip(pts, pts[1:]):
        n = max(1, int(haversine_meters(a[0], a[1], b[0], b[1]) // step_m))
        out.extend([a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n] for i in range(n))
    return out + ([pts[-1]] if pts else [])


def bbox_of(pts: list, margin_m: float = 60.0) -> tuple:
    dlat = margin_m / 110540.0
    dlng = margin_m / (111320.0 * max(0.2, math.cos(math.radians(pts[0][0]))))
    return (min(p[0] for p in pts) - dlat, min(p[1] for p in pts) - dlng, max(p[0] for p in pts) + dlat, max(p[1] for p in pts) + dlng)


def route_touches(route_dense: list, road_pts: list, bbox: tuple, within_m: float = 40.0) -> bool:
    """Does a (densified) route pass within within_m of the road? A bounding-box test first keeps this cheap."""
    return any(bbox[0] <= p[0] <= bbox[2] and bbox[1] <= p[1] <= bbox[3] and near_polyline(p[0], p[1], road_pts, within_m) for p in route_dense)


def assess_roads(c) -> list:
    idx = PredictionIndex(c)
    incidents = c.execute("SELECT id, type, status, trust_score, latitude, longitude, description FROM incidents "
                          "WHERE duplicate_of IS NULL AND status IN ('REPORTED','VERIFIED') AND type IN ('BLOCKED_ROAD','FLOODED_ROAD')").fetchall()
    out = []
    for r in c.execute("SELECT * FROM roads ORDER BY id").fetchall():
        pts = json.loads(r["coordinates"])
        keys = r.keys()
        low = bool(r["low_lying"]) if "low_lying" in keys else False
        state, reasons = OPEN, []
        worst = None
        for p in pts[:: max(1, len(pts) // 40)] + [pts[-1]]:
            pred = idx.at(p[0], p[1])
            if pred and (worst is None or (pred["risk_score"] or 0) > (worst["risk_score"] or 0)):
                worst = pred
        score = worst["risk_score"] if worst else None
        level = worst["risk_level"] if worst else None
        if worst and ((score or 0) >= 50 or ((score or 0) >= 25 and low)):
            state = POTENTIAL
            reasons.append(f"Passes through an area with {level} flood risk ({score}/100)" + (" and is low-lying ground" if low else "") +
                           ". Area-level estimate, not a road observation")
        for inc in incidents:
            if near_polyline(inc["latitude"], inc["longitude"], pts, NEAR_ROAD_M):
                if inc["status"] == "VERIFIED":
                    state = VERIFIED_BLOCKED
                    reasons.insert(0, f"Verified incident on this road: {inc['type'].replace('_', ' ').lower()}")
                elif (inc["trust_score"] or 0) >= 45 and state != VERIFIED_BLOCKED:
                    state = REPORTED_BLOCKED
                    reasons.insert(0, f"Reported incident on this road: {inc['type'].replace('_', ' ').lower()} (not yet verified)")
        if r["status"] == "BLOCKED":
            state = VERIFIED_BLOCKED
            reasons.insert(0, "Closed by an administrator")
        out.append({"id": r["id"], "name": r["name"], "state": state, "risk_score": score, "risk_level": level, "low_lying": low,
                    "source": r["source"] if "source" in keys else "SEED", "reasons": reasons})
    return out


def blocked_polylines(c, states=(VERIFIED_BLOCKED, REPORTED_BLOCKED)) -> list:
    """(road name, state, points) for roads that are blocked on evidence, used to keep routes off them."""
    info = {x["id"]: x for x in assess_roads(c)}
    out = []
    for r in c.execute("SELECT id, name, coordinates FROM roads").fetchall():
        if info[r["id"]]["state"] in states:
            out.append((r["name"], info[r["id"]]["state"], json.loads(r["coordinates"])))
    return out
