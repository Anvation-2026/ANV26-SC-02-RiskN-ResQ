"""Real-data risk, trust, incident intersection and routing safety engines.
Deterministic, multi-factor models combining real meteorological and community telemetry.
Includes zone-based analytical models for simulation and automated validation.
"""
import json
import math
from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple

from providers.weather.base import WeatherObservation
from providers.routing.base import RouteCandidate
from db import ZONES, nearest_zone, now


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def haversine_meters(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in meters between two coordinates."""
    r = 6371000.0  # Earth radius in meters
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)

    a = (
        math.sin(delta_phi / 2.0) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2.0) ** 2
    )
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    return r * c


def _km(a_lat, a_lng, b_lat, b_lng) -> float:
    return math.hypot((a_lat - b_lat) * 111, (a_lng - b_lng) * 108)


def _age_hours(ts: str) -> float:
    try:
        dt = datetime.fromisoformat(ts)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return max(0.0, (datetime.now(timezone.utc) - dt).total_seconds() / 3600.0)
    except Exception:
        return 0.0


# ---------- 1. Trust & Confidence Engine ----------

def similar_count(c, inc) -> int:
    """Other non-rejected reports of the same type within 500 m and 3 h."""
    inc = dict(inc)
    try:
        rows = c.execute(
            "SELECT * FROM incidents WHERE type=? AND id!=? AND status!='REJECTED'",
            (inc["type"], inc["id"]),
        ).fetchall()
        return sum(
            1 for r in rows
            if _km(inc["latitude"], inc["longitude"], r["latitude"], r["longitude"]) <= 0.5
            and abs(_age_hours(r["timestamp"]) - _age_hours(inc["timestamp"])) <= 3
        )
    except Exception:
        return 0


def compute_trust(c, inc) -> int:
    """Calculate incident trust/confidence score (0 to 100)."""
    inc = dict(inc)
    if inc.get("status") == "REJECTED":
        return 0

    score = 50  # Baseline for a citizen report

    # Corroborating reports of same type within 500m and 3 hours
    try:
        if similar_count(c, inc) >= 1:
            score += 15
    except Exception:
        pass

    # Verified status from emergency dispatcher / admin
    if inc.get("status") in ("VERIFIED", "RESOLVED"):
        score += 25

    # Presence of photographic evidence
    if inc.get("photo_url"):
        score += 10

    # Aging decay: stale reports lose confidence over time (> 6 hours)
    if "timestamp" in inc and inc["timestamp"]:
        age = _age_hours(inc["timestamp"])
        if age > 6:
            score -= min(30, int((age - 6) * 5))

    return max(0, min(100, score))


def confidence_label(trust_score: int) -> str:
    if trust_score >= 80:
        return "VERY HIGH"
    if trust_score >= 65:
        return "HIGH"
    if trust_score >= 45:
        return "MEDIUM"
    return "LOW"


# ---------- 2. Multi-Factor Real Environmental Flood Risk Model ----------

def level_for_score(score: int) -> str:
    if score < 25:
        return "LOW"
    if score < 50:
        return "MODERATE"
    if score < 75:
        return "HIGH"
    return "CRITICAL"


def level_for(score: int) -> str:
    return "LOW" if score < 25 else "MEDIUM" if score < 50 else "HIGH" if score < 75 else "CRITICAL"


def rain_score(r: float) -> float:
    if r < 20:
        return r / 20 * 24
    if r < 60:
        return 25 + (r - 20) / 40 * 24
    if r <= 100:
        return 50 + (r - 60) / 40 * 24
    return min(100, 75 + (r - 100) / 50 * 25)


def compute_flood_risk(
    weather: WeatherObservation,
    nearby_incidents: List[dict],
) -> dict:
    """Combines rainfall intensity, 24h cumulative precipitation, warning level,
    and verified incident density into a unified 0-100 flood risk score.
    """
    cumulative = float(weather.rainfall_24h_mm or 0.0)
    intensity = float(weather.rainfall_intensity_mm_per_hour or 0.0)

    # 1. Base rainfall contribution (0 to 50 pts)
    rainfall_score = 0.0
    if cumulative >= 100.0 or intensity >= 35.0:
        rainfall_score = 50.0
    elif cumulative >= 65.0 or intensity >= 20.0:
        rainfall_score = 38.0
    elif cumulative >= 30.0 or intensity >= 10.0:
        rainfall_score = 25.0
    elif cumulative >= 10.0 or intensity >= 3.0:
        rainfall_score = 12.0
    else:
        rainfall_score = min(10.0, (cumulative / 10.0) * 10.0)

    # 2. Meteorological warning level contribution (0 to 25 pts)
    warning_pts = 0.0
    wl = (weather.warning_level or "NONE").upper()
    if wl in ("RED", "CRITICAL"):
        warning_pts = 25.0
    elif wl in ("ORANGE", "HIGH"):
        warning_pts = 18.0
    elif wl in ("YELLOW", "MODERATE"):
        warning_pts = 10.0

    # 3. Nearby active incident density contribution (0 to 25 pts)
    incident_pts = 0.0
    verified_count = sum(1 for i in nearby_incidents if i.get("status") == "VERIFIED")
    high_trust_count = sum(
        1 for i in nearby_incidents
        if i.get("trust_score", 0) >= 60 and i.get("status") != "REJECTED"
    )

    if verified_count >= 2 or high_trust_count >= 4:
        incident_pts = 25.0
    elif verified_count == 1 or high_trust_count >= 2:
        incident_pts = 16.0
    elif len(nearby_incidents) >= 1:
        incident_pts = 8.0

    total_score = int(round(min(100.0, rainfall_score + warning_pts + incident_pts)))

    reasons = []
    if intensity >= 15.0:
        reasons.append(f"Heavy rainfall intensity ({intensity:.1f} mm/h)")
    elif cumulative >= 25.0:
        reasons.append(f"Significant cumulative precipitation ({cumulative:.1f} mm 24h)")
    else:
        reasons.append(f"Normal precipitation ({intensity:.1f} mm/h, {cumulative:.1f} mm 24h)")

    if wl in ("RED", "ORANGE", "YELLOW"):
        reasons.append(f"Meteorological {wl} warning")

    if verified_count > 0:
        reasons.append(f"{verified_count} verified localized flood incident(s)")
    elif len(nearby_incidents) > 0:
        reasons.append(f"{len(nearby_incidents)} reported waterlogging observation(s)")

    level = level_for_score(total_score)

    return {
        "risk_score": total_score,
        "risk_level": level,
        "weather_source": weather.source,
        "rainfall_24h_mm": cumulative,
        "rainfall_intensity_mm_per_hour": intensity,
        "warning_level": weather.warning_level,
        "incident_count": len(nearby_incidents),
        "verified_incidents": verified_count,
        "reason": " + ".join(reasons) if reasons else "Conditions normal",
        "breakdown": {
            "rainfall_contribution": round(rainfall_score, 1),
            "warning_contribution": round(warning_pts, 1),
            "incident_contribution": round(incident_pts, 1),
        },
        "observed_at": weather.observed_at,
    }


def compute_risk(c, zone: str) -> dict:
    env = c.execute("SELECT rainfall, data_source FROM environment_data WHERE zone=?", (zone,)).fetchone()
    rainfall = env["rainfall"] if env else 0
    data_source = env["data_source"] if env else "DEMO_SEED"
    score = rain_score(rainfall)
    reasons = [f"{'Heavy' if rainfall >= 60 else 'Moderate' if rainfall >= 20 else 'Light'} rainfall ({rainfall:g} mm)"]

    rows = c.execute("SELECT * FROM incidents WHERE zone=? AND status IN ('REPORTED','VERIFIED') "
                     "AND type IN ('FLOOD','BLOCKED_ROAD')", (zone,)).fetchall()
    bonus, verified, credible = 0.0, 0, 0
    for r in rows:
        trust = compute_trust(c, r)
        if r["status"] == "VERIFIED":
            verified += 1
            bonus += 8 + r["severity"]
        elif trust >= 60:
            credible += 1
            bonus += 4 + r["severity"] / 2
    bonus = min(25, bonus)
    score = min(100, score + bonus)
    if verified:
        reasons.append(f"{verified} verified flood/blocked-road report(s)")
    if credible:
        reasons.append(f"{credible} credible citizen report(s)")
    elif len(rows) > 1 and not verified:
        reasons.append(f"{len(rows)} flood reports")

    score = round(score)
    return {
        "location": zone,
        "risk_score": score,
        "risk_level": level_for(score),
        "rainfall": rainfall,
        "reason": " + ".join(reasons),
        "blocked_roads": blocked_roads(c, zone),
        "data_source": data_source,
    }


def blocked_roads(c, zone: str) -> list:
    """Names of BLOCKED roads whose start point lies in this zone."""
    out = []
    try:
        for r in c.execute("SELECT name, coordinates FROM roads WHERE status='BLOCKED' ORDER BY id"):
            first = json.loads(r["coordinates"])[0]
            if nearest_zone(first[0], first[1]) == zone:
                out.append(r["name"])
    except Exception:
        pass
    return out


def sync_alert(c, risk: dict):
    zone, level = risk["location"], risk["risk_level"]
    active = c.execute("SELECT * FROM alerts WHERE affected_zone=? AND active=1 AND source='ENGINE'", (zone,)).fetchone()
    if level in ("HIGH", "CRITICAL"):
        roads = ", ".join(risk["blocked_roads"]) or None
        msg = f"{level.capitalize()} flood risk detected in {zone}. {risk['reason']}."
        if risk.get("data_source") == "SIMULATED":
            msg = "SIMULATED DRILL (not a real warning): " + msg  # an admin-set demo scenario must never read as real
        if roads:
            msg += f" Reported blocked: {roads}."
        if active:
            changed = (active["severity"], active["message"], active["risk_score"]) != (level, msg, risk["risk_score"])
            if changed:
                c.execute("UPDATE alerts SET severity=?, message=?, reason=?, affected_road=?, risk_score=?, updated_at=? WHERE id=?",
                          (level, msg, risk["reason"], roads, risk["risk_score"], now(), active["id"]))
            return c.execute("SELECT * FROM alerts WHERE id=?", (active["id"],)).fetchone()
        t = now()
        cur = c.execute("INSERT INTO alerts(severity,message,affected_zone,active,created_at,reason,affected_road,risk_score,source,updated_at)"
                        " VALUES(?,?,?,1,?,?,?,?,'ENGINE',?)", (level, msg, zone, t, risk["reason"], roads, risk["risk_score"], t))
        return c.execute("SELECT * FROM alerts WHERE id=?", (cur.lastrowid,)).fetchone()
    if active:
        c.execute("UPDATE alerts SET active=0, updated_at=? WHERE id=?", (now(), active["id"]))
    return None


def refresh_zone(c, zone: str) -> dict:
    risk = compute_risk(c, zone)
    sync_alert(c, risk)
    return risk


def refresh_all(c) -> list:
    return [refresh_zone(c, z) for z in ZONES]


# ---------- 3. Incident Intersection & Rerouting Engine ----------

def does_route_intersect_incident(
    polyline: List[List[float]],
    incident: dict,
    buffer_meters: float = 65.0,
) -> bool:
    """Checks whether any segment or point of the route polyline enters an active incident zone."""
    incident = dict(incident)
    inc_lat = float(incident["latitude"])
    inc_lng = float(incident["longitude"])
    radius = float(incident.get("radius_meters") or 50.0) + buffer_meters

    # Subsample polyline checking every point
    for pt in polyline:
        dist = haversine_meters(pt[0], pt[1], inc_lat, inc_lng)
        if dist <= radius:
            return True

    return False


def select_best_valid_route(
    candidates: List[RouteCandidate],
    active_incidents: List[dict],
) -> Tuple[Optional[RouteCandidate], List[dict]]:
    """Evaluates candidate routes against active high-severity incidents.
    Returns: (selected_candidate, list_of_avoided_incidents)
    """
    if not candidates:
        return None, []

    # Filter incidents that genuinely block vehicular passage
    blocking_incidents = [
        dict(inc) for inc in active_incidents
        if dict(inc).get("status") in ("VERIFIED", "REPORTED")
        and dict(inc).get("type") in ("FLOOD", "FLOODED_ROAD", "BLOCKED_ROAD", "WATERLOGGING", "FALLEN_TREE")
        and (dict(inc).get("trust_score", 50) >= 45 or dict(inc).get("status") == "VERIFIED")
    ]

    for candidate in candidates:
        intersected = []
        for inc in blocking_incidents:
            if does_route_intersect_incident(candidate.polyline, inc):
                intersected.append(inc)

        if not intersected:
            # Found a clean route that avoids all active blockages
            return candidate, []

    best_candidate = None
    min_intersections = float("inf")
    avoided_for_best = []

    for candidate in candidates:
        intersected = [inc for inc in blocking_incidents if does_route_intersect_incident(candidate.polyline, inc)]
        if len(intersected) < min_intersections:
            min_intersections = len(intersected)
            best_candidate = candidate
            avoided_for_best = intersected

    return best_candidate, avoided_for_best
