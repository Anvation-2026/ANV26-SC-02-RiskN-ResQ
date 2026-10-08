"""Risk, trust and alert engines — deterministic, no ML."""
import math
from datetime import datetime, timezone

from db import now

# ---------- Trust score ----------

def _age_hours(ts: str) -> float:
    return (datetime.now(timezone.utc) - datetime.fromisoformat(ts)).total_seconds() / 3600


def _km(a_lat, a_lng, b_lat, b_lng) -> float:
    return math.hypot((a_lat - b_lat) * 111, (a_lng - b_lng) * 108)


def similar_count(c, inc) -> int:
    """Other non-rejected reports of the same type within 500 m and 3 h."""
    rows = c.execute("SELECT * FROM incidents WHERE type=? AND id!=? AND status!='REJECTED'",
                     (inc["type"], inc["id"])).fetchall()
    return sum(1 for r in rows
               if _km(inc["latitude"], inc["longitude"], r["latitude"], r["longitude"]) <= 0.5
               and abs(_age_hours(r["timestamp"]) - _age_hours(inc["timestamp"])) <= 3)


def compute_trust(c, inc) -> int:
    if inc["status"] == "REJECTED":
        return 0
    score = 50
    if similar_count(c, inc) >= 1:
        score += 15
    if inc["status"] in ("VERIFIED", "RESOLVED"):
        score += 25
    age = _age_hours(inc["timestamp"])
    if age > 6:  # stale reports lose 5 points per extra hour, max -30
        score -= min(30, int((age - 6) * 5))
    return max(0, min(100, score))


# ---------- Risk engine ----------

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


def compute_risk(c, zone: str) -> dict:
    env = c.execute("SELECT rainfall FROM environment_data WHERE zone=?", (zone,)).fetchone()
    rainfall = env["rainfall"] if env else 0
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
    return {"location": zone, "risk_score": score, "risk_level": level_for(score),
            "rainfall": rainfall, "reason": " + ".join(reasons)}


# ---------- Alert engine ----------

def sync_alert(c, risk: dict):
    """Create/update an active alert for HIGH/CRITICAL, resolve it otherwise. Returns alert row or None."""
    zone, level = risk["location"], risk["risk_level"]
    active = c.execute("SELECT * FROM alerts WHERE affected_zone=? AND active=1", (zone,)).fetchone()
    if level in ("HIGH", "CRITICAL"):
        msg = f"{level.capitalize()} flood risk detected in your area ({zone}). {risk['reason']}."
        if active:
            c.execute("UPDATE alerts SET severity=?, message=? WHERE id=?", (level, msg, active["id"]))
            return c.execute("SELECT * FROM alerts WHERE id=?", (active["id"],)).fetchone()
        cur = c.execute("INSERT INTO alerts(severity,message,affected_zone,active,created_at) VALUES(?,?,?,1,?)",
                        (level, msg, zone, now()))
        return c.execute("SELECT * FROM alerts WHERE id=?", (cur.lastrowid,)).fetchone()
    if active:
        c.execute("UPDATE alerts SET active=0 WHERE id=?", (active["id"],))
    return None


def refresh_zone(c, zone: str) -> dict:
    risk = compute_risk(c, zone)
    sync_alert(c, risk)
    return risk
