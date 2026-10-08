"""Flood intelligence engine (PROTOTYPE, rule-based).

Environmental evidence is primary; community reports are a capped, secondary signal. Every signal carries its source,
timestamp and freshness. A signal that has no data is listed under `missing` and simply does not contribute: nothing is
estimated or invented. Weights are documented heuristics, NOT scientifically validated or calibrated.

Score (0-100) = rainfall + forecast + satellite water expansion + terrain + river level + history + reports, capped at 100:

  rainfall   0-100  the existing rain_score() of the worst of: 24 h total, 1.5 x 6 h total, 4 x 1 h total
  forecast   0-10   rain expected in the next 3 / 6 hours
  satellite  0-20   abnormal net water gain vs earlier scenes on the same orbit, scaled by confidence (only while fresh)
  terrain    0-12   flood susceptibility of the ground, counted only while it is raining (amplifies, never proves)
  river      0-15   modelled river discharge well above normal (or a real gauge when one is connected)
  history    0-10   past flood records nearby and today's rain compared with the 10-year extremes (only while raining)
  reports    0-15   trusted community reports (secondary): on their own they can never lift the score above 49

Levels: LOW < 25 <= MEDIUM < 50 <= HIGH < 75 <= CRITICAL. The reported "probability" is a logistic mapping of the score
and is labelled uncalibrated unless a trained model (ml_model) supplies it.
"""
import json
import math
from datetime import datetime, timedelta, timezone
from typing import Optional

import config
import db
from engine import _age_hours, compute_trust, haversine_meters, level_for, rain_score

MODEL_NAME = "Prototype flood-risk model v2 (rule-based, additive; weights not scientifically validated)"
HOTSPOT_MIN_FAMILIES = 2
REPORT_CAP = 15
ACTIONS = {
    "LOW": "No action needed now. Keep notifications on and check again if heavy rain starts.",
    "MEDIUM": "Stay alert and check the map before you travel.",
    "HIGH": "Avoid potentially affected roads and follow the recommended route.",
    "CRITICAL": "Move away from low-lying areas, follow official instructions and use designated evacuation points.",
}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt=None) -> str:
    return (dt or _now()).isoformat(timespec="seconds")


def _parse(iso: Optional[str]):
    try:
        dt = datetime.fromisoformat(iso)
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except Exception:
        return None


def age_minutes(iso: Optional[str]) -> Optional[float]:
    dt = _parse(iso)
    return None if dt is None else max(0.0, (_now() - dt).total_seconds() / 60.0)


def probability_from_score(score: float) -> float:
    """Prototype mapping only: a logistic curve centred on score 55. Not calibrated against real flood outcomes."""
    return round(1.0 / (1.0 + math.exp(-(score - 55.0) / 9.0)), 2)


# ---------------------------------------------------------------------------------------------------- grid helpers
def grid_cells(c) -> list:
    return c.execute("SELECT * FROM environment_data WHERE zone LIKE 'grid:%' ORDER BY latitude, longitude").fetchall()


def grid_steps(rows) -> tuple:
    lats = sorted({round(r["latitude"], 4) for r in rows})
    lngs = sorted({round(r["longitude"], 4) for r in rows})
    dlat = min((b - a for a, b in zip(lats, lats[1:])), default=config.GRID_SPACING)
    dlng = min((b - a for a, b in zip(lngs, lngs[1:])), default=config.GRID_SPACING)
    return dlat, dlng


def cell_area_km2(lat: float, dlat: float, dlng: float) -> float:
    return (dlat * 111.32) * (dlng * 111.32 * math.cos(math.radians(lat)))


def nearest_cell(c, lat: float, lng: float):
    """The grid cell whose box contains (lat, lng), or None when the point lies outside the monitored area."""
    rows = grid_cells(c)
    if not rows:
        return None
    dlat, dlng = grid_steps(rows)
    best = min(rows, key=lambda r: haversine_meters(lat, lng, r["latitude"], r["longitude"]))
    if abs(best["latitude"] - lat) <= dlat * 0.6 and abs(best["longitude"] - lng) <= dlng * 0.6:
        return best
    return None


# ----------------------------------------------------------------------------------------------- evidence gatherers
def _signal(key, label, points, detail, source=None, observed_at=None, stale=False, max_points=None, available=True):
    return {"key": key, "label": label, "points": int(round(points)), "max_points": max_points, "detail": detail, "source": source,
            "observed_at": observed_at, "stale": bool(stale), "available": available}


def report_evidence(c, zone: Optional[str] = None, near: Optional[tuple] = None) -> dict:
    """Community reports as SECONDARY evidence (the existing trust model). Duplicates count once."""
    q = "SELECT * FROM incidents WHERE duplicate_of IS NULL AND status IN ('REPORTED','VERIFIED') AND type IN ('FLOOD','BLOCKED_ROAD','FLOODED_ROAD')"
    rows = c.execute(q + (" AND zone=?" if zone else ""), (zone,) if zone else ()).fetchall()
    if near:
        rows = [r for r in rows if haversine_meters(near[0], near[1], r["latitude"], r["longitude"]) <= 5000]
    bonus, verified, credible = 0.0, 0, 0
    for r in rows:
        trust = compute_trust(c, r)
        if r["status"] == "VERIFIED":
            verified += 1
            bonus += 8 + r["severity"]
        elif trust >= 60:
            credible += 1
            bonus += 4 + r["severity"] / 2
    return {"points": min(REPORT_CAP, bonus), "verified": verified, "credible": credible, "total": len(rows)}


def historical_evidence(c, lat: float, lng: float, rain24: float, key: str) -> dict:
    cutoff = (_now() - timedelta(days=3650)).date().isoformat()
    events = [e for e in c.execute("SELECT * FROM historical_events WHERE event_date >= ? AND kind='FLOOD'", (cutoff,)).fetchall()
              if haversine_meters(lat, lng, e["latitude"], e["longitude"]) <= 3000]
    clim = c.execute("SELECT * FROM climatology WHERE cell=?", (key,)).fetchone()
    exceed = None
    if clim and clim["p99_mm"]:
        exceed = "p99" if rain24 >= clim["p99_mm"] else "p95" if rain24 >= clim["p95_mm"] else None
    return {"events": len(events), "sources": sorted({e["source"] for e in events}), "climatology": dict(clim) if clim else None, "exceeds": exceed}


def env_context(c, lat: float, lng: float) -> dict:
    """Plain facts about the environment at a point, used to judge how plausible a community report is."""
    cell = nearest_cell(c, lat, lng)
    if not cell:
        return {"covered": False}
    p = c.execute("SELECT * FROM flood_risk_predictions WHERE cell=?", (cell["zone"],)).fetchone()
    sat = c.execute("SELECT * FROM satellite_observations WHERE cell=?", (cell["zone"],)).fetchone()
    ter = c.execute("SELECT * FROM terrain_data WHERE cell=?", (cell["zone"],)).fetchone()
    heavy = (cell["rain_1h"] or 0) >= config.HEAVY_RAIN_THRESHOLD or (cell["rain_6h"] or 0) >= 30 or (cell["rainfall_24h"] or 0) >= 50
    fresh_sat = bool(sat and sat["abnormal"] and (age_minutes(sat["observed_at"]) or 1e9) <= config.SATELLITE_STALE_DAYS * 1440)
    return {"covered": True, "heavy_rain": bool(heavy), "satellite_abnormal": fresh_sat,
            "flood_prone": bool(ter and (ter["susceptibility"] or 0) >= 60), "cell_level": p["risk_level"] if p else None}


# ------------------------------------------------------------------------------------------------------- assessment
def assess_cell(c, key: str, zone: Optional[str] = None, near: Optional[tuple] = None) -> dict:
    env = c.execute("SELECT * FROM environment_data WHERE zone=?", (key,)).fetchone()
    base = {"cell": key, "model": MODEL_NAME, "computed_at": _iso(), "signals": [], "missing": [], "insufficient": False}
    if not env:
        return {**base, "insufficient": True, "risk_score": None, "risk_level": None, "probability": None, "probability_basis": None,
                "reason": "Insufficient data to estimate current flood risk.", "explanation": [], "sources": [], "evidence_families": 0,
                "satellite_abnormal": False, "features": {}, "recommended_action": None}
    lat, lng = env["latitude"], env["longitude"]
    signals, missing, sources = [], [], {}
    fam = set()

    # --- rainfall (primary) ---
    w_age = age_minutes(env["updated_at"])
    interval_min = config.WEATHER_REFRESH_INTERVAL / 60.0
    w_stale = w_age is None or w_age > interval_min * 3
    w_gone = w_age is None or w_age > interval_min * 12
    r1, r3, r6, r24 = (env["rain_1h"] or 0.0), (env["rain_3h"] or 0.0), (env["rain_6h"] or 0.0), (env["rainfall_24h"] or 0.0)
    rain_pts = 0.0
    if w_gone:
        missing.append({"key": "rainfall", "label": "Rainfall", "reason": "Weather data unavailable (last update too old)"})
    else:
        rain_pts = min(100.0, max(rain_score(r24), rain_score(r6 * 1.5), rain_score(r1 * 4.0)))
        word = "Heavy" if rain_pts >= 50 else "Moderate" if rain_pts >= 25 else "Light"
        signals.append(_signal("rainfall", f"{word} rainfall", rain_pts,
                               f"{r1:g} mm last hour, {r3:g} mm in 3 h, {r6:g} mm in 6 h, {r24:g} mm in 24 h",
                               env["data_source"], env["observed_at"], w_stale, 100))
        sources["weather"] = (env["data_source"], env["observed_at"])
        if rain_pts >= 25:
            fam.add("rainfall")

    # --- forecast ---
    f3, f6 = env["forecast_3h_mm"], env["forecast_6h_mm"]
    fc_pts = 0.0
    if f3 is not None and not w_gone:
        fc_pts = 10 if (f3 >= 30 or (f6 or 0) >= 50) else 6 if (f3 >= 15 or (f6 or 0) >= 30) else 3 if (f3 >= 8 or (f6 or 0) >= 15) else 0
        if fc_pts:
            signals.append(_signal("forecast", "Heavy rain forecast", fc_pts, f"{f3:g} mm expected in the next 3 h, {f6 or 0:g} mm in 6 h",
                                   env["data_source"], env["observed_at"], w_stale, 10))
    # --- satellite ---
    sat = c.execute("SELECT * FROM satellite_observations WHERE cell=?", (key,)).fetchone()
    sat_pts, sat_abnormal, sat_age_days = 0.0, False, None
    if not sat:
        missing.append({"key": "satellite", "label": "Satellite water extent", "reason": "No satellite observation available for this area"})
    else:
        s_age = (age_minutes(sat["observed_at"]) or 0) / 1440.0
        sat_age_days = round(s_age, 1)
        s_stale = s_age > config.SATELLITE_STALE_DAYS
        when = sat["observed_at"][:10]
        if s_stale:
            signals.append(_signal("satellite", "Satellite observation is old", 0, f"Last pass {when} ({s_age:.0f} days ago), too old to use",
                                   sat["source"], sat["observed_at"], True, 20))
        elif sat["abnormal"]:
            factor = {"HIGH": 1.0, "MEDIUM": 0.8}.get(sat["confidence"], 0.5)
            sat_pts = min(20.0, (6 + min(14.0, (sat["expansion_percentage"] or 0) / 15.0)) * factor)
            sat_abnormal = True
            pct = sat["expansion_percentage"]
            more = "new water where there was almost none before" if pct is None else f"{pct:.0f}% more"
            signals.append(_signal("satellite", "Abnormal surface-water expansion", sat_pts,
                                   f"+{sat['expansion_area_km2']:.1f} km2 of water vs earlier passes ({more}), "
                                   f"{sat['confidence'].lower()} confidence, pass {when}", sat["source"], sat["observed_at"], False, 20))
            sources["satellite"] = (sat["source"], sat["observed_at"])
            fam.add("satellite")
        else:
            signals.append(_signal("satellite", "No abnormal water expansion", 0, f"Water extent in line with earlier passes (pass {when})",
                                   sat["source"], sat["observed_at"], False, 20))
            sources["satellite"] = (sat["source"], sat["observed_at"])
    # --- terrain ---
    ter = c.execute("SELECT * FROM terrain_data WHERE cell=?", (key,)).fetchone()
    ter_pts = 0.0
    if not ter or ter["susceptibility"] is None:
        missing.append({"key": "terrain", "label": "Terrain", "reason": "No elevation data available for this area"})
    else:
        ter_pts = 12.0 * ter["susceptibility"] / 100.0 if rain_pts >= 20 else 0.0
        note = "" if rain_pts >= 20 else " (counts only while it is raining)"
        signals.append(_signal("terrain", "Low-lying, flat terrain" if ter["susceptibility"] >= 60 else "Terrain susceptibility", ter_pts,
                               f"Susceptibility {ter['susceptibility']:.0f}/100: {ter['elevation_m']:.0f} m elevation, {ter['slope_deg']:.1f}° slope"
                               f"{note}. Susceptibility, not proof of flooding", ter["source"], ter["fetched_at"], False, 12))
        sources["terrain"] = (ter["source"], ter["fetched_at"])
        if ter["susceptibility"] >= 60 and rain_pts >= 20:
            fam.add("terrain")
    # --- river level ---
    wl = c.execute("SELECT * FROM water_level_observations WHERE cell=?", (key,)).fetchone()
    wl_pts = 0.0
    if not wl:
        missing.append({"key": "river", "label": "Water level", "reason": "Water-level data unavailable for this area."})
    else:
        wl_stale = (age_minutes(wl["fetched_at"]) or 0) > 36 * 60
        wl_pts = 0.0 if wl_stale else {"HIGH": 15.0, "ELEVATED": 8.0}.get(wl["status"], 0.0)
        kind = "Modelled river discharge" if wl["kind"] == "RIVER_DISCHARGE_MODEL" else "River gauge level"
        signals.append(_signal("river", f"{kind} {wl['status'].lower()}" if wl["status"] != "NORMAL" else f"{kind} normal", wl_pts,
                               f"{wl['current_value']:g} {wl['unit']} vs a normal {wl['normal_value'] if wl['normal_value'] is not None else 'n/a'} "
                               f"({wl['ratio']:.1f}x)" if wl["ratio"] is not None else f"{wl['current_value']:g} {wl['unit']}",
                               wl["source"], wl["fetched_at"], wl_stale, 15))
        if wl_pts:
            fam.add("river")
            sources["river"] = (wl["source"], wl["fetched_at"])
    # --- history ---
    hist = historical_evidence(c, lat, lng, r24, key)
    hist_pts = 0.0
    if hist["events"] or hist["climatology"]:
        hist_pts = min(10.0, 3.0 * hist["events"] + {"p99": 6, "p95": 3}.get(hist["exceeds"], 0)) if rain_pts >= 20 else 0.0
        bits = []
        if hist["events"]:
            bits.append(f"{hist['events']} recorded flood event(s) within 3 km in the last 10 years ({', '.join(hist['sources'])})")
        if hist["climatology"]:
            cl = hist["climatology"]
            bits.append(f"today's 24 h rain vs the 10-year wet-day extremes: p95 {cl['p95_mm']:g} mm, p99 {cl['p99_mm']:g} mm"
                        + (f", currently above {hist['exceeds']}" if hist["exceeds"] else ""))
        signals.append(_signal("history", "Historical flood susceptibility" if hist_pts else "Historical context", hist_pts, "; ".join(bits),
                               ", ".join(hist["sources"]) or (hist["climatology"] or {}).get("source"), None, False, 10))
        if hist_pts:
            fam.add("history")
    else:
        missing.append({"key": "history", "label": "Historical floods", "reason": "No historical flood records or rainfall climatology for this area yet"})
    # --- reports (secondary) ---
    rep = report_evidence(c, zone=zone, near=near)
    rep_pts = rep["points"]
    if rep["total"]:
        signals.append(_signal("reports", "Community reports (secondary evidence)", rep_pts,
                               f"{rep['verified']} verified and {rep['credible']} credible of {rep['total']} report(s); reports alone cannot raise risk to HIGH",
                               "RiskN ResQ community reports", None, False, REPORT_CAP))

    env_total = rain_pts + fc_pts + sat_pts + ter_pts + wl_pts + hist_pts
    score = min(100.0, env_total + rep_pts)
    if env_total < 25:
        score = min(score, 49.0)  # a handful of reports cannot declare a flood on their own
    score = int(round(score))
    insufficient = w_gone and not (sat_abnormal or wl_pts or hist_pts)  # community reports alone are not environmental evidence
    if insufficient:
        return {**base, "insufficient": True, "risk_score": None, "risk_level": None, "probability": None, "probability_basis": None,
                "signals": signals, "missing": missing, "reason": "Insufficient data to estimate current flood risk.", "explanation": [],
                "sources": [], "evidence_families": 0, "satellite_abnormal": False, "features": {}, "recommended_action": None}
    level = level_for(score)
    features = {"rain_1h": r1, "rain_3h": r3, "rain_6h": r6, "rain_24h": r24, "forecast_3h": f3 or 0.0, "forecast_6h": f6 or 0.0,
                "elevation": ter["elevation_m"] if ter else None, "slope": ter["slope_deg"] if ter else None,
                "relative_elevation_pct": ter["relative_elevation_pct"] if ter else None, "susceptibility": ter["susceptibility"] if ter else None,
                "satellite_expansion_pct": sat["expansion_percentage"] if sat and sat["expansion_percentage"] is not None else None,
                "satellite_abnormal": int(sat_abnormal), "discharge_ratio": wl["ratio"] if wl else None,
                "historical_events": hist["events"], "rain_vs_p99": (r24 / hist["climatology"]["p99_mm"]) if hist["climatology"] and hist["climatology"]["p99_mm"] else None}
    import ml_model
    prob, basis = ml_model.predict(features, score)
    contributing = [s for s in signals if s["points"] > 0]
    explanation = [f"{s['label']}: {s['detail']}" for s in contributing]
    if level == "LOW":
        reason = f"No strong flood signals: {r24:g} mm of rain in the last 24 h."
    else:
        names = [s["label"].lower() for s in sorted(contributing, key=lambda s: -s["points"])[:4] if s["key"] != "reports"]
        reason = "Flood risk is elevated because of " + (", ".join(names) if names else "community reports") + "."
    srcs = [{"name": k, "source": v[0], "observed_at": v[1]} for k, v in sources.items()]
    conf, conf_basis = data_confidence(signals, missing, w_stale, len(fam), level)
    return {"confidence": conf, "confidence_basis": conf_basis, **base, "signals": signals, "missing": missing, "risk_score": score, "risk_level": level, "probability": prob,
            "probability_basis": basis, "reason": reason, "explanation": explanation, "sources": srcs, "evidence_families": len(fam),
            "families": sorted(fam), "satellite_abnormal": sat_abnormal, "satellite_confidence": sat["confidence"] if sat_abnormal else None, "satellite_age_days": sat_age_days,
            "features": features, "recommended_action": ACTIONS.get(level), "report_counts": rep,
            "weather_stale": w_stale, "rainfall": r24}


CORE_FAMILIES = ("rainfall", "satellite", "terrain", "river", "history")


def data_confidence(signals: list, missing: list, weather_stale: bool, agreeing: int, level: str) -> tuple:
    """How complete and fresh the evidence behind an estimate is (HIGH / MEDIUM / LOW). It describes data coverage and
    agreement between independent signals; it is not a calibrated statistical confidence."""
    usable = {s["key"] for s in signals if s["key"] in CORE_FAMILIES and not s.get("stale")}
    n = len(usable)
    if not weather_stale and n >= 4 and (level == "LOW" or agreeing >= 2):
        conf = "HIGH"
    elif not weather_stale and n >= 3:
        conf = "MEDIUM"
    else:
        conf = "LOW"
    bits = [f"{n} of {len(CORE_FAMILIES)} data sources available and current"]
    if level != "LOW":
        bits.append(f"{agreeing} independent signal(s) point to elevated risk")
    if weather_stale:
        bits.append("weather data is stale")
    return conf, "; ".join(bits) + ". Describes data coverage, not a calibrated probability."


def assess_point(c, lat: float, lng: float) -> Optional[dict]:
    cell = nearest_cell(c, lat, lng)
    return assess_cell(c, cell["zone"], near=(lat, lng)) if cell else None


# ---------------------------------------------------------------------------------------------------- persistence
def store_prediction(c, key: str, a: dict, zone: Optional[str]) -> None:
    env = c.execute("SELECT latitude, longitude FROM environment_data WHERE zone=?", (key,)).fetchone()
    if not env:
        return
    vals = (env["latitude"], env["longitude"], zone, a["risk_score"], a["risk_level"], a["probability"], a["probability_basis"],
            int(a["insufficient"]), json.dumps(a["signals"]), json.dumps(a["missing"]), json.dumps(a["features"]), a["model"], a["computed_at"])
    if c.execute("SELECT 1 FROM flood_risk_predictions WHERE cell=?", (key,)).fetchone():
        c.execute("UPDATE flood_risk_predictions SET latitude=?, longitude=?, zone=?, risk_score=?, risk_level=?, probability=?, probability_basis=?, "
                  "insufficient=?, signals=?, missing=?, features=?, model=?, computed_at=? WHERE cell=?", vals + (key,))
    else:
        c.execute("INSERT INTO flood_risk_predictions(latitude, longitude, zone, risk_score, risk_level, probability, probability_basis, insufficient, "
                  "signals, missing, features, model, computed_at, cell) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)", vals + (key,))


def detect_hotspots(c) -> list:
    """Potential hotspots: a HIGH-or-worse cell backed by at least two independent evidence families
    (rainfall, satellite, terrain, history, river). Never a confirmed flood."""
    rows = grid_cells(c)
    dlat, dlng = grid_steps(rows) if rows else (config.GRID_SPACING, config.GRID_SPACING)
    radius = round(max(dlat, dlng) * 111.32 / 2.0, 1)
    now = _iso()
    live = set()
    for r in rows:
        p = c.execute("SELECT * FROM flood_risk_predictions WHERE cell=?", (r["zone"],)).fetchone()
        if not p or p["insufficient"] or (p["risk_score"] or 0) < 50:
            continue
        sigs = json.loads(p["signals"] or "[]")
        fams = [s["key"] for s in sigs if s["points"] > 0 and s["key"] in ("rainfall", "satellite", "terrain", "history", "river")]
        if len(fams) < HOTSPOT_MIN_FAMILIES:
            continue
        live.add(r["zone"])
        zone = p["zone"]
        sources = sorted({s["source"] for s in sigs if s["points"] > 0 and s.get("source") and s["key"] != "reports"})
        conf = "HIGH" if len(fams) >= 3 else "MEDIUM"
        vals = (p["risk_score"], p["risk_level"], json.dumps([s for s in sigs if s["points"] > 0]), json.dumps(sources), conf, now)
        if c.execute("SELECT 1 FROM flood_hotspots WHERE cell=? AND active=1", (r["zone"],)).fetchone():
            c.execute("UPDATE flood_hotspots SET risk_score=?, risk_level=?, signals=?, sources=?, confidence=?, updated_at=? WHERE cell=? AND active=1", vals + (r["zone"],))
        else:
            c.execute("INSERT INTO flood_hotspots(risk_score, risk_level, signals, sources, confidence, updated_at, cell, latitude, longitude, radius_km, zone, status, active, created_at) "
                      "VALUES(?,?,?,?,?,?,?,?,?,?,?,'POTENTIAL',1,?)", vals + (r["zone"], r["latitude"], r["longitude"], radius, zone, now))
    for h in c.execute("SELECT id, cell FROM flood_hotspots WHERE active=1").fetchall():
        if h["cell"] not in live:
            c.execute("UPDATE flood_hotspots SET active=0, updated_at=? WHERE id=?", (now, h["id"]))
    return live


def hotspot_out(r) -> dict:
    return {"id": r["id"], "cell": r["cell"], "latitude": r["latitude"], "longitude": r["longitude"], "radius_km": r["radius_km"],
            "zone": r["zone"], "risk_score": r["risk_score"], "risk_level": r["risk_level"], "signals": json.loads(r["signals"] or "[]"),
            "sources": json.loads(r["sources"] or "[]"), "confidence": r["confidence"], "status": "POTENTIAL FLOOD HOTSPOT",
            "note": "Potential hotspot from several independent signals; not a confirmed flood.",
            "recommended_action": ACTIONS.get(r["risk_level"]), "created_at": r["created_at"], "updated_at": r["updated_at"]}


def record_history(c, force: bool = False) -> None:
    """One row per zone when its risk changed or 10 minutes have passed, kept 90 days."""
    from engine import compute_risk
    now = _iso()
    n_alerts = c.execute("SELECT COUNT(*) FROM alerts WHERE active=1").fetchone()[0]
    for zone in db.ZONES:
        r = compute_risk(c, zone)
        last = c.execute("SELECT * FROM risk_history WHERE zone=? ORDER BY id DESC LIMIT 1", (zone,)).fetchone()
        intel = r.get("intelligence") or {}
        if not force and last and last["risk_level"] == r["risk_level"] and abs((last["risk_score"] or 0) - r["risk_score"]) < 5 \
                and (age_minutes(last["at"]) or 0) < 10:
            continue
        sat = c.execute("SELECT expansion_percentage FROM satellite_observations WHERE cell=?", (intel.get("cell"),)).fetchone() if intel.get("cell") else None
        c.execute("INSERT INTO risk_history(at, zone, rainfall_24h, risk_score, risk_level, probability, satellite_expansion_pct, active_alerts, features, source) "
                  "VALUES(?,?,?,?,?,?,?,?,?,?)",
                  (now, zone, r.get("rainfall"), r["risk_score"], r["risk_level"], intel.get("probability"), sat["expansion_percentage"] if sat else None,
                   n_alerts, json.dumps(intel.get("features") or {}), r.get("data_source")))
    c.execute("DELETE FROM risk_history WHERE at < ?", (_iso(_now() - timedelta(days=90)),))


def recompute_all(c) -> dict:
    """Re-assess every grid cell, refresh hotspots, then let the existing risk/alert machinery and history catch up."""
    from engine import refresh_all
    n = 0
    for r in grid_cells(c):
        z = db.nearest_zone(r["latitude"], r["longitude"])
        a = assess_cell(c, r["zone"], near=(r["latitude"], r["longitude"]))
        store_prediction(c, r["zone"], a, z)
        n += 1
    hot = detect_hotspots(c)
    refresh_all(c)
    record_history(c)
    return {"cells": n, "hotspots": len(hot)}
