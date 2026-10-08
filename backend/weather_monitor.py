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


def _status(name, ok, error=None, detail=""):
    try:
        import intel_jobs
        intel_jobs.set_status(name, ok, error, detail)
    except Exception:
        pass


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def low_lying_threshold(elevations: list):
    """Elevation at the 25th percentile of the monitored area: cells at or below it count as low-lying (flood-prone)."""
    vals = sorted(e for e in elevations if e is not None)
    return vals[max(0, int(len(vals) * 0.25) - (1 if len(vals) % 4 == 0 else 0))] if len(vals) >= 4 else None


def store(c, observations: list, source: str, elevations: dict | None = None) -> None:
    """One row per grid cell, updated in place (the previous reading is kept alongside), so the table never grows."""
    t = _now()
    for o in observations:
        key = _key(o.latitude, o.longitude)
        rate = float(o.rainfall_intensity_mm_per_hour or 0.0)
        old = c.execute("SELECT rainfall, updated_at FROM environment_data WHERE zone=?", (key,)).fetchone()
        values = (rate, rain_level(rate), o.rainfall_24h_mm, o.observed_at, o.weather_code, t, source,
                  o.forecast_peak_mm, o.forecast_peak_in_h, o.rain_1h_mm, o.rain_3h_mm, o.rain_6h_mm, o.forecast_3h_mm, o.forecast_6h_mm)
        elev = (elevations or {}).get(key)
        if old:
            c.execute("UPDATE environment_data SET rainfall=?, rain_level=?, rainfall_24h=?, observed_at=?, weather_code=?, "
                      "updated_at=?, data_source=?, forecast_peak_mm=?, forecast_peak_in_h=?, rain_1h=?, rain_3h=?, rain_6h=?, "
                      "forecast_3h_mm=?, forecast_6h_mm=?, prev_rainfall=?, prev_at=?, "
                      "elevation=COALESCE(?, elevation) WHERE zone=?",
                      values + (old["rainfall"], old["updated_at"], elev, key))
        else:
            c.execute("INSERT INTO environment_data(rainfall, rain_level, rainfall_24h, observed_at, weather_code, updated_at, "
                      "data_source, forecast_peak_mm, forecast_peak_in_h, rain_1h, rain_3h, rain_6h, forecast_3h_mm, forecast_6h_mm, "
                      "zone, latitude, longitude, elevation) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                      values + (key, o.latitude, o.longitude, elev))


def feed_risk_engine(c, observations: list, source: str) -> None:
    """Give each risk zone the real 24 h rainfall of its nearest grid cell (used by the drill/legacy path and as its
    data-source label), then recompute the flood intelligence for every cell, which also re-scores zones and alerts.
    Zones under an admin drill (SIMULATED) are left alone until the admin resets."""
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
    import flood_intel
    flood_intel.recompute_all(c)


async def refresh(provider) -> dict:
    """Fetch the whole grid (batched), store it and update risk. Never raises: failures are recorded and the last
    good data stays in the table (the API labels it stale)."""
    if _state["refreshing"]:
        return status()
    _state["refreshing"] = True
    _state["last_attempt"] = _now()
    try:
        points = grid_points()
        observations = await provider.get_weather_grid(points)
        source = provider.get_source_name()
        with db.session() as c:
            store(c, observations, source)
            feed_risk_engine(c, observations, source)
            record_history(c, observations)
        _state["last_error"] = None
        _status("weather", True, detail=f"{len(observations)} grid points from {source}")
    except Exception as exc:
        import intel_jobs
        _state["last_error"] = intel_jobs.why(exc)
        logger.warning("Weather refresh failed: %s", exc)
        _status("weather", False, intel_jobs.why(exc), "Weather data unavailable; showing the last known readings as stale")
    finally:
        _state["refreshing"] = False
    return status()


def record_history(c, observations: list) -> None:
    """One summary row per refresh (kept 7 days) so the admin can chart rainfall over time."""
    if not observations:
        return
    rates = [float(o.rainfall_intensity_mm_per_hour or 0.0) for o in observations]
    c.execute("INSERT INTO weather_history(at, monitored, heavy, max_mm, avg_mm) VALUES(?,?,?,?,?)",
              (_now(), len(rates), sum(1 for r in rates if rain_level(r) in ("HEAVY", "VERY_HEAVY")), max(rates), round(sum(rates) / len(rates), 3)))
    cutoff = (datetime.now(timezone.utc).timestamp() - 7 * 86400)
    c.execute("DELETE FROM weather_history WHERE at < ?", (datetime.fromtimestamp(cutoff, timezone.utc).isoformat(timespec="seconds"),))


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
        "rain_1h_mm": r["rain_1h"], "rain_3h_mm": r["rain_3h"], "rain_6h_mm": r["rain_6h"],
        "forecast_3h_mm": r["forecast_3h_mm"], "forecast_6h_mm": r["forecast_6h_mm"],
        "rain_level": r["rain_level"] or rain_level(r["rainfall"]),
        "previous_rainfall_mm": r["prev_rainfall"], "weather_code": r["weather_code"],
        "forecast_peak_mm": r["forecast_peak_mm"], "forecast_peak_in_h": r["forecast_peak_in_h"],
        "forecast_level": rain_level(r["forecast_peak_mm"]) if r["forecast_peak_mm"] is not None else None,
        "elevation_m": r["elevation"],
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
                    else f"STALE DATA: last updated {max(1, (age or 0) // 60)} min ago" if stale else None),
        "summary": {
            "monitored_locations": len(locations), "heavy_rain_locations": len(heavy),
            "highest_rainfall_mm": max((l["rainfall_mm"] for l in locations), default=0.0),
            "forecast_heavy_locations": sum(1 for l in locations if l["forecast_level"] in ("HEAVY", "VERY_HEAVY")),
        },
        "thresholds_mm_per_hour": {"moderate": config.RAIN_MODERATE_THRESHOLD, "heavy": config.HEAVY_RAIN_THRESHOLD,
                                   "very_heavy": config.RAIN_VERY_HEAVY_THRESHOLD},
        "locations": locations,
    }


async def run_forever(provider) -> None:
    while True:
        await refresh(provider)
        await asyncio.sleep(config.WEATHER_REFRESH_INTERVAL)
