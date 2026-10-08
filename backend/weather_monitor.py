"""Weather monitoring grid.

The backend (never the phones) asks the weather provider for rainfall at a grid of points covering the configured
area, stores the latest reading per grid cell, and feeds that rainfall into the existing risk engine.
Heavy rainfall is a WEATHER fact, not a flood: flood risk is still decided by engine.compute_risk.
"""
import asyncio
import logging
import math
from datetime import datetime, timezone

import config
import db
from engine import haversine_meters, refresh_zone

logger = logging.getLogger(__name__)

LEVELS = ("LOW", "MODERATE", "HEAVY", "VERY_HEAVY")
_state = {"last_error": None, "last_attempt": None, "refreshing": False}


def grid_points() -> list:
    """Evenly spaced (lat, lng) points covering MONITORING_BOUNDS at roughly GRID_SPACING degrees."""
    south, west, north, east = config.MONITORING_BOUNDS
    rows = max(1, round((north - south) / config.GRID_SPACING) + 1)
    cols = max(1, round((east - west) / config.GRID_SPACING) + 1)
    lat_at = lambda i: south if rows == 1 else south + (north - south) * i / (rows - 1)
    lng_at = lambda j: west if cols == 1 else west + (east - west) * j / (cols - 1)
    return [(round(lat_at(i), 4), round(lng_at(j), 4)) for i in range(rows) for j in range(cols)]


def rain_level(mm_per_hour: float) -> str:
    if mm_per_hour >= config.RAIN_VERY_HEAVY_THRESHOLD:
        return "VERY_HEAVY"
    if mm_per_hour >= config.HEAVY_RAIN_THRESHOLD:
        return "HEAVY"
    if mm_per_hour >= config.RAIN_MODERATE_THRESHOLD:
        return "MODERATE"
    return "LOW"


def _key(lat: float, lng: float) -> str:
    return f"grid:{lat:.4f},{lng:.4f}"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def store(c, observations: list, source: str) -> None:
    """One row per grid cell, updated in place (the previous reading is kept alongside), so the table never grows."""
    t = _now()
    for o in observations:
        key = _key(o.latitude, o.longitude)
        rate = float(o.rainfall_intensity_mm_per_hour or 0.0)
        old = c.execute("SELECT rainfall, updated_at FROM environment_data WHERE zone=?", (key,)).fetchone()
        values = (rate, rain_level(rate), o.rainfall_24h_mm, o.observed_at, o.weather_code, t, source)
        if old:
            c.execute("UPDATE environment_data SET rainfall=?, rain_level=?, rainfall_24h=?, observed_at=?, weather_code=?, "
                      "updated_at=?, data_source=?, prev_rainfall=?, prev_at=? WHERE zone=?",
                      values + (old["rainfall"], old["updated_at"], key))
        else:
            c.execute("INSERT INTO environment_data(rainfall, rain_level, rainfall_24h, observed_at, weather_code, updated_at, "
                      "data_source, zone, latitude, longitude) VALUES(?,?,?,?,?,?,?,?,?,?)",
                      values + (key, o.latitude, o.longitude))


def feed_risk_engine(c, observations: list, source: str) -> None:
    """Give each risk zone the real 24h rainfall of its nearest grid cell, then let the existing engine re-score it
    (and raise/clear its alert). Zones under an admin drill (SIMULATED) are left alone until the admin resets."""
    if not observations:
        return
    for zone, (zla, zlo) in db.ZONES.items():
        row = c.execute("SELECT data_source FROM environment_data WHERE zone=?", (zone,)).fetchone()
        if row and row["data_source"] == "SIMULATED":
            continue
        near = min(observations, key=lambda o: haversine_meters(zla, zlo, o.latitude, o.longitude))
        if haversine_meters(zla, zlo, near.latitude, near.longitude) > config.GRID_SPACING * 111000:
            continue  # zone lies outside the monitored area
        c.execute("UPDATE environment_data SET rainfall=?, updated_at=?, data_source=? WHERE zone=?",
                  (near.rainfall_24h_mm, _now(), source, zone))
        refresh_zone(c, zone)


async def refresh(provider) -> dict:
    """Fetch the whole grid (batched), store it and update risk. Never raises: failures are recorded and the last
    good data stays in the table (the API labels it stale)."""
    if _state["refreshing"]:
        return status()
    _state["refreshing"] = True
    _state["last_attempt"] = _now()
    try:
        observations = await provider.get_weather_grid(grid_points())
        source = provider.get_source_name()
        with db.session() as c:
            store(c, observations, source)
            feed_risk_engine(c, observations, source)
        _state["last_error"] = None
    except Exception as exc:
        _state["last_error"] = f"{type(exc).__name__}"
        logger.warning("Weather refresh failed: %s", exc)
    finally:
        _state["refreshing"] = False
    return status()


def _age_seconds(iso: str):
    try:
        dt = datetime.fromisoformat(iso)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return max(0, int((datetime.now(timezone.utc) - dt).total_seconds()))
    except Exception:
        return None


def status() -> dict:
    """Latest stored reading per cell plus a summary, labelled ok / stale / unavailable. Fabricates nothing."""
    with db.session() as c:
        rows = c.execute("SELECT * FROM environment_data WHERE zone LIKE 'grid:%' ORDER BY latitude, longitude").fetchall()
    locations = [{
        "latitude": r["latitude"], "longitude": r["longitude"],
        "rainfall_mm": r["rainfall"], "rainfall_period": "1h", "rainfall_24h_mm": r["rainfall_24h"],
        "rain_level": r["rain_level"] or rain_level(r["rainfall"]),
        "previous_rainfall_mm": r["prev_rainfall"], "weather_code": r["weather_code"],
        "timestamp": r["observed_at"] or r["updated_at"], "updated_at": r["updated_at"], "source": r["data_source"],
    } for r in rows]
    updated_at = max((r["updated_at"] for r in rows), default=None)
    age = _age_seconds(updated_at) if updated_at else None
    stale = age is None or age > config.WEATHER_REFRESH_INTERVAL * 3
    state = "unavailable" if not rows else "stale" if stale else "ok"
    heavy = [l for l in locations if l["rain_level"] in ("HEAVY", "VERY_HEAVY")]
    return {
        "status": state,
        "source": locations[0]["source"] if locations else None,
        "updated_at": updated_at, "age_seconds": age, "stale": stale,
        "last_error": _state["last_error"],
        "refresh_interval_seconds": config.WEATHER_REFRESH_INTERVAL,
        "message": ("Weather data unavailable" if state == "unavailable"
                    else f"Last updated {max(1, (age or 0) // 60)} min ago" if stale else None),
        "summary": {
            "monitored_locations": len(locations), "heavy_rain_locations": len(heavy),
            "highest_rainfall_mm": max((l["rainfall_mm"] for l in locations), default=0.0),
        },
        "thresholds_mm_per_hour": {"moderate": config.RAIN_MODERATE_THRESHOLD, "heavy": config.HEAVY_RAIN_THRESHOLD,
                                   "very_heavy": config.RAIN_VERY_HEAVY_THRESHOLD},
        "locations": locations,
    }


async def run_forever(provider) -> None:
    while True:
        await refresh(provider)
        await asyncio.sleep(config.WEATHER_REFRESH_INTERVAL)
