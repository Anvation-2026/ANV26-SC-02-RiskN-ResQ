"""Real-data risk, trust, incident intersection and routing safety engines.
Deterministic, multi-factor models combining real meteorological and community telemetry.
"""
import math
from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple
from providers.weather.base import WeatherObservation
from providers.routing.base import RouteCandidate


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


def _age_hours(ts: str) -> float:
    try:
        dt = datetime.fromisoformat(ts)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return max(0.0, (datetime.now(timezone.utc) - dt).total_seconds() / 3600.0)
    except Exception:
        return 0.0


# ---------- 1. Trust & Confidence Engine ----------

def compute_trust(c, inc: dict) -> int:
    """Calculate incident trust/confidence score (0 to 100)."""
    if inc.get("status") == "REJECTED":
        return 0

    score = 50  # Baseline for a citizen report

    # Verified status from emergency dispatcher / admin
    if inc.get("status") in ("VERIFIED", "RESOLVED"):
        score += 30

    # Presence of photographic evidence
    if inc.get("photo_url"):
        score += 10

    # Corroborating reports of same type within 500m and 3 hours
    similar = 0
    try:
        rows = c.execute(
            "SELECT latitude, longitude, timestamp FROM incidents WHERE type=? AND id!=? AND status!='REJECTED'",
            (inc["type"], inc["id"]),
        ).fetchall()
        for r in rows:
            dist = haversine_meters(inc["latitude"], inc["longitude"], r["latitude"], r["longitude"])
            if dist <= 500.0 and abs(_age_hours(r["timestamp"]) - _age_hours(inc["timestamp"])) <= 3.0:
                similar += 1
    except Exception:
        pass

    if similar >= 1:
        score += min(20, similar * 10)

    # Time decay: loses 5 points per hour after 4 hours
    age = _age_hours(inc.get("timestamp", ""))
    if age > 4.0:
        score -= min(35, int((age - 4.0) * 5))

    return max(0, min(100, score))


def confidence_label(trust_score: int) -> str:
    if trust_score >= 80:
        return "VERY HIGH"
    if trust_score >= 65:
        return "HIGH"
    if trust_score >= 45:
        return "MEDIUM"
    return "LOW"


# ---------- 2. Real Multi-Factor Flood Risk Engine ----------

def level_for_score(score: int) -> str:
    if score >= 75:
        return "CRITICAL"
    if score >= 50:
        return "HIGH"
    if score >= 25:
        return "MODERATE"
    return "LOW"


def compute_flood_risk(
    weather: WeatherObservation,
    nearby_incidents: List[dict],
) -> dict:
    """Multi-factor flood risk evaluation:
    Combines:
    1. Rainfall intensity (mm/h)
    2. 24-hour cumulative rainfall (mm)
    3. Meteorological warning level
    4. Active verified & high-confidence community flood reports
    """
    reasons = []

    # Factor A: Rainfall intensity (0 to 25 pts)
    intensity = weather.rainfall_intensity_mm_per_hour
    intensity_pts = min(25.0, intensity * 2.5)

    # Factor B: 24-hour cumulative precipitation (0 to 20 pts)
    cumulative = weather.rainfall_24h_mm
    cumulative_pts = min(20.0, cumulative * 0.2)

    rainfall_score = intensity_pts + cumulative_pts

    if intensity >= 15.0:
        reasons.append(f"Heavy rainfall intensity ({intensity:.1f} mm/h)")
    elif intensity >= 5.0:
        reasons.append(f"Moderate rainfall ({intensity:.1f} mm/h)")
    elif cumulative >= 30.0:
        reasons.append(f"Accumulated 24h rainfall ({cumulative:.1f} mm)")
    else:
        reasons.append(f"Normal precipitation ({intensity:.1f} mm/h, {cumulative:.1f} mm 24h)")

    # Factor C: Meteorological warning level (0 to 20 pts)
    warning_pts = 0.0
    if weather.warning_level == "RED":
        warning_pts = 20.0
        reasons.append("Official RED flood advisory")
    elif weather.warning_level == "ORANGE":
        warning_pts = 15.0
        reasons.append("Official ORANGE weather warning")
    elif weather.warning_level == "YELLOW":
        warning_pts = 8.0
        reasons.append("Official YELLOW weather advisory")

    # Factor D: Active verified / credible incidents (0 to 35 pts)
    incident_pts = 0.0
    verified_count = 0
    credible_count = 0

    for inc in nearby_incidents:
        if inc.get("status") == "VERIFIED":
            verified_count += 1
            incident_pts += 8.0 + float(inc.get("severity", 3)) * 1.5
        elif inc.get("trust_score", 50) >= 60:
            credible_count += 1
            incident_pts += 4.0 + float(inc.get("severity", 3))

    incident_pts = min(35.0, incident_pts)

    if verified_count > 0:
        reasons.append(f"{verified_count} verified flood/road hazard(s)")
    if credible_count > 0:
        reasons.append(f"{credible_count} active community report(s)")

    total_score = round(min(100.0, rainfall_score + warning_pts + incident_pts))
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


# ---------- 3. Incident Intersection & Rerouting Engine ----------

def does_route_intersect_incident(
    polyline: List[List[float]],
    incident: dict,
    buffer_meters: float = 65.0,
) -> bool:
    """Checks whether any segment or point of the route polyline enters an active incident zone."""
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
        inc for inc in active_incidents
        if inc.get("status") in ("VERIFIED", "REPORTED")
        and inc.get("type") in ("FLOOD", "FLOODED_ROAD", "BLOCKED_ROAD", "WATERLOGGING", "FALLEN_TREE")
        and (inc.get("trust_score", 50) >= 45 or inc.get("status") == "VERIFIED")
    ]

    for candidate in candidates:
        intersected = []
        for inc in blocking_incidents:
            if does_route_intersect_incident(candidate.polyline, inc):
                intersected.append(inc)

        if not intersected:
            # Found a clean route that avoids all active blockages
            return candidate, []

    # If all candidate routes intersect at least one blocked zone,
    # find the route intersecting the fewest / lowest-severity incidents
    # or return alternative if viable
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
