"""Backend ingestion for the flood intelligence layer. Providers are called here, on a schedule, and the results are cached
in the database; the mobile app only ever reads the processed results. Every job records its outcome in provider_status so
the admin can see what is fresh, stale or unavailable, and a failing provider never stops the others."""
import asyncio
import logging
import math
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from statistics import median
from typing import Any, List, Optional

import config
import db
import flood_intel
import weather_monitor
from providers.satellite.base import SatelliteUnavailable

logger = logging.getLogger(__name__)
PROVIDERS = ("weather", "satellite", "terrain", "water_level", "climatology")
# After this long without a success a provider is shown as stale (hours); static datasets never go stale.
STALE_AFTER_H = {"weather": config.WEATHER_REFRESH_INTERVAL * 3 / 3600.0, "satellite": config.SATELLITE_REFRESH_INTERVAL * 3 / 3600.0,
                 "water_level": config.WATER_LEVEL_REFRESH_INTERVAL * 3 / 3600.0, "terrain": None, "climatology": None}


@dataclass
class Providers:
    weather: Any
    satellite: Any
    terrain: Any
    water: List[Any] = field(default_factory=list)
    climate: Any = None


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def why(exc: Exception) -> str:
    """A short, honest reason for a provider failure, e.g. 'HTTP 429: Daily API request limit exceeded' (no URLs, no secrets)."""
    resp = getattr(exc, "response", None)
    if resp is not None and getattr(resp, "status_code", None):
        reason = ""
        try:
            reason = str((resp.json() or {}).get("reason") or "")[:120]
        except Exception:
            pass
        return f"HTTP {resp.status_code}" + (f": {reason}" if reason else "")
    return str(exc)[:120] if isinstance(exc, SatelliteUnavailable) else type(exc).__name__


# ----------------------------------------------------------------------------------------------------- status
def set_status(name: str, ok: Optional[bool], error: Optional[str] = None, detail: str = "") -> None:
    """ok=True success, ok=False failure, ok=None 'ran but nothing to do / not applicable'."""
    t = _now()
    with db.session() as c:
        row = c.execute("SELECT 1 FROM provider_status WHERE name=?", (name,)).fetchone()
        if not row:
            c.execute("INSERT INTO provider_status(name) VALUES(?)", (name,))
        if ok:
            c.execute("UPDATE provider_status SET last_attempt=?, last_success=?, last_error=NULL, detail=? WHERE name=?", (t, t, detail, name))
        else:
            c.execute("UPDATE provider_status SET last_attempt=?, last_error=?, detail=? WHERE name=?", (t, error, detail, name))


def provider_statuses() -> list:
    out = []
    with db.session() as c:
        rows = {r["name"]: r for r in c.execute("SELECT * FROM provider_status").fetchall()}
    for name in PROVIDERS:
        r = rows.get(name)
        ok_age = flood_intel.age_minutes(r["last_success"]) if r and r["last_success"] else None
        limit = STALE_AFTER_H[name]
        if not r or not r["last_attempt"]:
            state = "NOT_RUN"
        elif ok_age is None:
            state = "UNAVAILABLE"
        elif limit is not None and ok_age > limit * 60:
            state = "STALE"
        else:
            state = "OK" if not r["last_error"] else "DEGRADED"
        out.append({"name": name, "state": state, "last_success": r["last_success"] if r else None, "age_minutes": round(ok_age) if ok_age is not None else None,
                    "last_attempt": r["last_attempt"] if r else None, "last_error": r["last_error"] if r else None, "detail": (r["detail"] if r else None) or ""})
    return out


# ------------------------------------------------------------------------------------------------------ grid
def monitored_cells() -> list:
    """(key, lat, lng) for every point of the configured monitoring grid, independent of whether weather has run yet."""
    return [(weather_monitor._key(la, lo), la, lo) for la, lo in weather_monitor.grid_points()]


def grid_steps_from(cells: list) -> tuple:
    lats = sorted({round(c[1], 4) for c in cells})
    lngs = sorted({round(c[2], 4) for c in cells})
    dlat = min((b - a for a, b in zip(lats, lats[1:])), default=config.GRID_SPACING)
    dlng = min((b - a for a, b in zip(lngs, lngs[1:])), default=config.GRID_SPACING)
    return dlat, dlng


def cell_bbox(lat: float, lng: float, dlat: float, dlng: float) -> tuple:
    return (lng - dlng / 2, lat - dlat / 2, lng + dlng / 2, lat + dlat / 2)


def _recompute() -> None:
    try:
        with db.session() as c:
            flood_intel.recompute_all(c)
    except Exception as exc:  # the data is stored; scoring will catch up on the next pass
        logger.warning("recompute failed: %s", exc)


# ------------------------------------------------------------------------------------------ satellite comparison
def compare_water(current_fraction: float, baseline_fractions: list, cell_area_km2: float) -> dict:
    """Net change in open-water area against earlier passes on the same orbit track. Only an abnormal gain counts: normal
    rivers, lakes and reservoirs are in the baseline and therefore never flagged. Heuristic thresholds (see config)."""
    water = current_fraction * cell_area_km2
    base = median(baseline_fractions) * cell_area_km2
    expansion = max(0.0, water - base)
    pct = (expansion / base * 100.0) if base > 0 else None
    abnormal = expansion >= config.SAT_ABNORMAL_MIN_KM2 and (pct is None or pct >= config.SAT_ABNORMAL_MIN_PCT) \
        and (len(baseline_fractions) < 2 or water > max(baseline_fractions) * cell_area_km2)
    n = len(baseline_fractions)
    if not abnormal:
        confidence = "MEDIUM" if n >= 2 else "LOW"
    elif n >= 3 and expansion >= 4 * config.SAT_ABNORMAL_MIN_KM2 and (pct is None or pct >= 100):
        confidence = "HIGH"
    elif n >= 2:
        confidence = "MEDIUM"
    else:
        confidence = "LOW"
    return {"water_area_km2": round(water, 3), "baseline_water_area_km2": round(base, 3), "expansion_area_km2": round(expansion, 3),
            "expansion_percentage": round(pct, 1) if pct is not None else None, "abnormal": abnormal, "confidence": confidence}


async def get_satellite_observation(provider, bbox: tuple, kind: str = "SAR") -> dict:
    """Water-extent change for ONE area (west, south, east, north): current pass vs the median of up to three earlier passes
    on the same orbit track. Raises SatelliteUnavailable when there is nothing usable; never returns invented numbers."""
    scenes = await provider.find_scenes(bbox, kind, 24)
    if not scenes:
        raise SatelliteUnavailable("no satellite scenes cover this area")
    cur = scenes[0]
    base = [s for s in scenes[1:] if s.track == cur.track][:3]
    if not base:
        raise SatelliteUnavailable("no earlier pass on the same orbit track to compare against")
    cur_stat = await provider.water_fraction(cur, bbox)
    fracs = [(await provider.water_fraction(s, bbox)).fraction for s in base]
    area = flood_intel.cell_area_km2((bbox[1] + bbox[3]) / 2, bbox[3] - bbox[1], bbox[2] - bbox[0])
    res = compare_water(cur_stat.fraction, fracs, area)
    return {"area": list(bbox), "timestamp": cur.acquired_at, "water_area": res["water_area_km2"], "baseline_water_area": res["baseline_water_area_km2"],
            "expansion_area": res["expansion_area_km2"], "expansion_percentage": res["expansion_percentage"], "abnormal": res["abnormal"],
            "confidence": res["confidence"], "source": cur_stat.method + " via " + provider.get_source_name(), "baseline_scenes": len(base)}


async def refresh_satellite(provider) -> dict:
    """Newest scene vs earlier same-track scenes, per grid cell. Per-scene results are cached, so a new pass costs one
    statistics request per cell and nothing is requested again for scenes already processed."""
    cells = monitored_cells()
    dlat, dlng = grid_steps_from(cells)
    south, west, north, east = config.MONITORING_BOUNDS
    whole = (west - dlng / 2, south - dlat / 2, east + dlng / 2, north + dlat / 2)
    try:
        for kind in ("SAR", "OPTICAL"):
            try:
                scenes = await provider.find_scenes(whole, kind, 24)
            except SatelliteUnavailable:
                if kind == "OPTICAL":
                    raise
                continue
            if scenes:
                cur = scenes[0]
                base = [s for s in scenes[1:] if s.track == cur.track and s.acquired_at < cur.acquired_at][:3]
                if base:
                    break
        else:
            raise SatelliteUnavailable("no scene with an earlier same-track pass to compare against")
        chosen = [cur] + base
        sem = asyncio.Semaphore(4)
        with db.session() as c:
            for s in chosen:
                if not c.execute("SELECT 1 FROM satellite_scenes WHERE scene_id=?", (s.scene_id,)).fetchone():
                    c.execute("INSERT INTO satellite_scenes(scene_id,kind,collection,acquired_at,orbit_state,relative_orbit,cloud_cover,source,fetched_at) VALUES(?,?,?,?,?,?,?,?,?)",
                              (s.scene_id, s.kind, s.collection, s.acquired_at, s.orbit_state, s.relative_orbit, s.cloud_cover, s.source, _now()))
            have = {(r["scene_id"], r["cell"]) for r in c.execute("SELECT scene_id, cell FROM water_extent_observations WHERE scene_id IN (%s)" % ",".join("?" * len(chosen)),
                                                                   [s.scene_id for s in chosen]).fetchall()}
        failures = 0

        async def one(scene, key, lat, lng):
            nonlocal failures
            if (scene.scene_id, key) in have:
                return
            async with sem:
                try:
                    stat = await provider.water_fraction(scene, cell_bbox(lat, lng, dlat, dlng))
                except SatelliteUnavailable:
                    failures += 1
                    return
            area = flood_intel.cell_area_km2(lat, dlat, dlng)
            with db.session() as c:
                c.execute("INSERT INTO water_extent_observations(scene_id,cell,water_fraction,water_area_km2,cell_area_km2,valid_pixels,method,threshold,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
                          (scene.scene_id, key, stat.fraction, round(stat.fraction * area, 4), round(area, 3), stat.valid_pixels, stat.method, stat.threshold, _now()))

        await asyncio.gather(*[one(s, k, la, lo) for s in chosen for k, la, lo in cells])
        computed = abnormal = 0
        with db.session() as c:
            for key, lat, lng in cells:
                rows = {r["scene_id"]: r for r in c.execute("SELECT * FROM water_extent_observations WHERE cell=? AND scene_id IN (%s)" % ",".join("?" * len(chosen)),
                                                              [key] + [s.scene_id for s in chosen]).fetchall()}
                if cur.scene_id not in rows:
                    continue
                best = max(r["valid_pixels"] or 0 for r in rows.values())
                if best and (rows[cur.scene_id]["valid_pixels"] or 0) < 0.8 * best:
                    continue  # the pass only partly covers this cell: do not compare
                bfr = [rows[s.scene_id]["water_fraction"] for s in base if s.scene_id in rows]
                if not bfr:
                    continue
                area = flood_intel.cell_area_km2(lat, dlat, dlng)
                res = compare_water(rows[cur.scene_id]["water_fraction"], bfr, area)
                vals = (cur.scene_id, cur.acquired_at, rows[cur.scene_id]["method"], res["water_area_km2"], res["baseline_water_area_km2"], res["expansion_area_km2"],
                        res["expansion_percentage"], int(res["abnormal"]), res["confidence"], len(bfr), cur.source, _now())
                if c.execute("SELECT 1 FROM satellite_observations WHERE cell=?", (key,)).fetchone():
                    c.execute("UPDATE satellite_observations SET scene_id=?, observed_at=?, method=?, water_area_km2=?, baseline_water_area_km2=?, expansion_area_km2=?, "
                              "expansion_percentage=?, abnormal=?, confidence=?, baseline_scenes=?, source=?, computed_at=? WHERE cell=?", vals + (key,))
                else:
                    c.execute("INSERT INTO satellite_observations(scene_id, observed_at, method, water_area_km2, baseline_water_area_km2, expansion_area_km2, expansion_percentage, "
                              "abnormal, confidence, baseline_scenes, source, computed_at, cell, latitude, longitude) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", vals + (key, lat, lng))
                computed += 1
                abnormal += res["abnormal"]
        if computed == 0:
            raise SatelliteUnavailable("no cell could be compared (scene coverage or provider errors)")
        detail = f"{cur.kind} pass {cur.acquired_at[:10]} vs {len(base)} earlier pass(es): {computed} cells compared, {abnormal} with abnormal water gain" + (f", {failures} request(s) failed" if failures else "")
        set_status("satellite", True, detail=detail)
        _recompute()
        return {"ok": True, "detail": detail}
    except SatelliteUnavailable as exc:
        set_status("satellite", False, str(exc), "Satellite data unavailable; weather-based risk continues")
        return {"ok": False, "error": str(exc)}
    except Exception as exc:
        logger.warning("satellite refresh failed: %s", exc)
        set_status("satellite", False, why(exc), "Satellite data unavailable; weather-based risk continues")
        return {"ok": False, "error": why(exc)}


# ----------------------------------------------------------------------------------------------------- terrain
def susceptibility(rel_elev_pct: float, slope_deg: Optional[float], concavity_m: Optional[float]) -> float:
    """0-100 flood susceptibility of the ground: 50% low relative elevation, 30% flatness, 20% sitting in a local depression."""
    low = 1.0 - rel_elev_pct / 100.0
    flat = 0.5 if slope_deg is None else min(1.0, max(0.0, 1.0 - slope_deg / 8.0))
    dep = 0.0 if concavity_m is None else min(1.0, max(0.0, -concavity_m / 5.0))
    return round(100.0 * (0.5 * low + 0.3 * flat + 0.2 * dep), 1)


async def refresh_terrain(provider, force: bool = False) -> dict:
    cells = monitored_cells()
    try:
        with db.session() as c:
            have = {r["cell"] for r in c.execute("SELECT cell FROM terrain_data WHERE elevation_m IS NOT NULL").fetchall()}
        if not force and len(have) >= len(cells):
            set_status("terrain", True, detail=f"{len(cells)} cells cached (terrain does not change)")
            return {"ok": True, "cached": True}
        pts = await provider.get_terrain([(la, lo) for _, la, lo in cells])
        elevs = sorted(p.elevation_m for p in pts if p.elevation_m is not None)
        if not elevs:
            raise SatelliteUnavailable("no elevation values returned")
        with db.session() as c:
            for (key, la, lo), p in zip(cells, pts):
                if p.elevation_m is None:
                    continue
                rel = 100.0 * sum(1 for e in elevs if e < p.elevation_m) / max(1, len(elevs) - 1)
                vals = (la, lo, p.elevation_m, p.slope_deg, round(min(100.0, rel), 1), p.concavity_m, susceptibility(min(100.0, rel), p.slope_deg, p.concavity_m),
                        provider.get_source_name(), _now())
                if c.execute("SELECT 1 FROM terrain_data WHERE cell=?", (key,)).fetchone():
                    c.execute("UPDATE terrain_data SET latitude=?, longitude=?, elevation_m=?, slope_deg=?, relative_elevation_pct=?, concavity_m=?, susceptibility=?, source=?, fetched_at=? WHERE cell=?", vals + (key,))
                else:
                    c.execute("INSERT INTO terrain_data(latitude, longitude, elevation_m, slope_deg, relative_elevation_pct, concavity_m, susceptibility, source, fetched_at, cell) VALUES(?,?,?,?,?,?,?,?,?,?)", vals + (key,))
        set_status("terrain", True, detail=f"{len(elevs)} cells, {provider.get_source_name()}")
        _recompute()
        return {"ok": True, "cells": len(elevs)}
    except Exception as exc:
        set_status("terrain", False, why(exc), "Terrain data unavailable")
        return {"ok": False, "error": why(exc)}


# ------------------------------------------------------------------------------------------------------ water level
def classify_discharge(reading) -> tuple:
    """(ratio, status). Thresholds are relative to the model's own normal, not official gauge warning/danger levels."""
    ratio = (reading.current / reading.normal) if reading.normal and reading.normal > 0 else None
    if reading.maximum and reading.current >= 0.8 * reading.maximum and reading.current > (reading.normal or 0) * 1.5:
        return ratio, "HIGH"
    if ratio is not None and ratio >= 3.0:
        return ratio, "HIGH"
    if ratio is not None and ratio >= 1.5:
        return ratio, "ELEVATED"
    return ratio, "NORMAL"


async def refresh_water_levels(providers: list) -> dict:
    cells = monitored_cells()
    pts = [(la, lo) for _, la, lo in cells]
    if not providers:
        set_status("water_level", False, "no provider configured", "Water-level data unavailable for this area.")
        return {"ok": False}
    readings = [None] * len(cells)
    errors = []
    for prov in providers:
        try:
            got = await prov.get_levels(pts)
        except Exception as exc:
            errors.append(f"{prov.get_source_name()}: {why(exc)}")
            continue
        for i, r in enumerate(got):
            if readings[i] is None and r is not None:
                readings[i] = r
    found = [r for r in readings if r is not None]
    if not found:
        set_status("water_level", False, "; ".join(errors) or "no water-level data covers this area", "Water-level data unavailable for this area.")
        return {"ok": False}
    with db.session() as c:
        for (key, la, lo), r in zip(cells, readings):
            if r is None:
                continue
            ratio, status = classify_discharge(r)
            vals = (la, lo, r.kind, r.current, r.normal, r.maximum, ratio, r.unit, status, r.observed_on, r.source, _now())
            if c.execute("SELECT 1 FROM water_level_observations WHERE cell=?", (key,)).fetchone():
                c.execute("UPDATE water_level_observations SET latitude=?, longitude=?, kind=?, current_value=?, normal_value=?, max_value=?, ratio=?, unit=?, status=?, observed_on=?, source=?, fetched_at=? WHERE cell=?", vals + (key,))
            else:
                c.execute("INSERT INTO water_level_observations(latitude, longitude, kind, current_value, normal_value, max_value, ratio, unit, status, observed_on, source, fetched_at, cell) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)", vals + (key,))
    kinds = sorted({r.kind for r in found})
    set_status("water_level", True, detail=f"{len(found)}/{len(cells)} cells ({', '.join(kinds)}); " + ("river gauges not connected: modelled discharge only" if "GAUGE_LEVEL" not in kinds else "gauge data"))
    _recompute()
    return {"ok": True, "cells": len(found)}


# ------------------------------------------------------------------------------------------------------ climatology
async def refresh_climatology(provider, force: bool = False) -> dict:
    cells = monitored_cells()
    try:
        with db.session() as c:
            have = {r["cell"] for r in c.execute("SELECT cell FROM climatology").fetchall()}
        if not force and len(have) >= len(cells):
            set_status("climatology", True, detail=f"{len(cells)} cells cached")
            return {"ok": True, "cached": True}
        got = await provider.get_climatology([(la, lo) for _, la, lo in cells])
        n = 0
        with db.session() as c:
            for (key, _, _), cl in zip(cells, got):
                if cl is None:
                    continue
                vals = (cl.p95_mm, cl.p99_mm, cl.max_mm, cl.years, cl.source, _now())
                if c.execute("SELECT 1 FROM climatology WHERE cell=?", (key,)).fetchone():
                    c.execute("UPDATE climatology SET p95_mm=?, p99_mm=?, max_mm=?, years=?, source=?, fetched_at=? WHERE cell=?", vals + (key,))
                else:
                    c.execute("INSERT INTO climatology(p95_mm, p99_mm, max_mm, years, source, fetched_at, cell) VALUES(?,?,?,?,?,?,?)", vals + (key,))
                n += 1
        if n == 0:
            raise SatelliteUnavailable("no climatology returned")
        set_status("climatology", True, detail=f"{n} cells, {got[0].source if got and got[0] else ''}")
        _recompute()
        return {"ok": True, "cells": n}
    except Exception as exc:
        set_status("climatology", False, why(exc), "Historical rainfall extremes unavailable")
        return {"ok": False, "error": why(exc)}


# ---------------------------------------------------------------------------------------------------- scheduling
async def run_all(p: Providers, jobs=("terrain", "climatology", "water", "satellite")) -> dict:
    out = {}
    if "terrain" in jobs:
        out["terrain"] = await refresh_terrain(p.terrain)
    if "climatology" in jobs and p.climate:
        out["climatology"] = await refresh_climatology(p.climate)
    if "water" in jobs:
        out["water"] = await refresh_water_levels(p.water)
    if "satellite" in jobs:
        out["satellite"] = await refresh_satellite(p.satellite)
    return out


async def run_forever(p: Providers) -> None:
    await run_all(p, ("terrain", "climatology"))
    last = {"water": -1e9, "satellite": -1e9, "static": asyncio.get_event_loop().time()}
    while True:
        loop_now = asyncio.get_event_loop().time()
        if loop_now - last["static"] >= 12 * 3600:  # terrain / rainfall history that failed earlier (for example a free-tier limit) are retried
            last["static"] = loop_now
            await run_all(p, ("terrain", "climatology"))
        if loop_now - last["water"] >= config.WATER_LEVEL_REFRESH_INTERVAL:
            last["water"] = loop_now
            await run_all(p, ("water",))
        if loop_now - last["satellite"] >= config.SATELLITE_REFRESH_INTERVAL:
            last["satellite"] = loop_now
            await run_all(p, ("satellite",))
        await asyncio.sleep(300)
