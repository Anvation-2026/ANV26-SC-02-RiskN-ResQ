"""Destination routing that checks every candidate route against the app's own hazard layers.

A routing engine (OSRM / Google) knows roads, not floods. So candidate routes are fetched first (the engine's alternatives,
plus detours forced around any hazard the routes cross), and then each route's geometry is intersected with the hazard
polygons in metres (Shapely, local equal-area projection, see geo.py):

  hazard class  examples                                                          effect on a route
  EXCLUDE       satellite-detected new water (pass <= 3 days old), verified        route is not recommended
                flood/blocked-road reports, credible recent reports, roads
                closed by an administrator
  AVOID         satellite detections 3-12 days old, reported (unverified)         ranked by metres exposed first
                blocked roads, lower-trust recent reports
  CAUTION       area-level weather-based HIGH/CRITICAL flood-risk cells (~9 km)   adds time-equivalent penalty

Feasible routes (no EXCLUDE hazard) are ranked by AVOID exposure (25 m steps), then travel time plus the CAUTION penalty,
then distance. When every route crosses an EXCLUDE hazard none is recommended: the least exposed is shown with a warning.
A route that crosses no known hazard is never called safe: hazard coverage can be incomplete or out of date.
"""
import asyncio
import hashlib
import json
import math
import uuid
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from shapely.geometry import LineString, Point, box as shp_box

import config
import flood_analysis
import geo
import road_risk
from engine import compute_trust, haversine_meters

EXCLUDE, AVOID, CAUTION = "EXCLUDE", "AVOID", "CAUTION"
CAUTION_S_PER_M = 0.3       # 1 km inside a high-risk weather cell weighs like 5 extra minutes of driving
FRESH_SAT_DAYS = 3.0
REPORT_MAX_AGE_H = 48.0
MAX_DETOUR_FACTOR = 1.8      # detours slower than this many times the fastest route are dropped
ROUTE_NOTE = ("RiskN ResQ cannot guarantee any route: hazard data can be incomplete or delayed. Follow official instructions "
              "and never drive into floodwater.")
REPORT_TYPES = ("FLOOD", "FLOODED_ROAD", "BLOCKED_ROAD", "WATERLOGGING", "FALLEN_TREE", "LANDSLIDE", "INFRASTRUCTURE_DAMAGE")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _parse(ts: Optional[str]) -> Optional[datetime]:
    if not ts:
        return None
    try:
        d = datetime.fromisoformat(str(ts).replace("Z", "+00:00").replace(" ", "T"))
        return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def _age_h(ts) -> Optional[float]:
    d = _parse(ts)
    return round((_now() - d).total_seconds() / 3600, 1) if d else None


# ------------------------------------------------------------------------------------------------- hazard layer
class Hazard:
    __slots__ = ("id", "kind", "label", "hclass", "reliability", "observed_at", "source", "geom_m", "geom_ll")

    def __init__(self, id, kind, label, hclass, reliability, observed_at, source, geom_m, geom_ll):
        self.id, self.kind, self.label, self.hclass = id, kind, label, hclass
        self.reliability, self.observed_at, self.source = reliability, observed_at, source
        self.geom_m, self.geom_ll = geom_m, geom_ll

    def public(self) -> dict:
        return {"hazard_id": self.id, "kind": self.kind, "label": self.label, "class": self.hclass,
                "reliability": self.reliability, "observed_at": self.observed_at, "age_hours": _age_h(self.observed_at),
                "source": self.source, "geometry": geo.to_geojson(self.geom_ll, 5)}


class HazardLayer:
    def __init__(self, proj, hazards: List[Hazard], coverage: dict, alerts: list):
        self.proj, self.hazards, self.coverage, self.alerts = proj, hazards, coverage, alerts

    @property
    def version(self) -> str:
        key = "|".join(sorted(f"{h.id}@{h.observed_at}:{h.hclass}" for h in self.hazards))
        return hashlib.sha1(key.encode()).hexdigest()[:12]

    def usable(self) -> bool:
        """At least one area-wide flood layer (satellite or weather) covers the trip; reports and closures alone are too sparse
        to call a route checked."""
        return any(self.coverage.get(k, {}).get("usable") for k in ("satellite", "weather"))


def collect_hazards(c, corridor_ll) -> HazardLayer:
    """All hazards touching the corridor (a lon/lat polygon around the trip), with per-layer coverage and freshness."""
    ctr = corridor_ll.centroid
    proj = geo.projection_for(ctr.y, ctr.x)
    corridor_m = proj.to_m(corridor_ll)
    hz: List[Hazard] = []
    coverage = {}
    s, w, n, e = config.MONITORING_BOUNDS
    inside = geo.bbox_polygon(w, s, e, n).intersects(corridor_ll)

    def add(id, kind, label, hclass, rel, observed, source, geom_ll):
        gm = proj.to_m(geom_ll)
        if gm.is_empty or not gm.intersects(corridor_m):
            return
        hz.append(Hazard(id, kind, label, hclass, round(rel, 2), observed, source, gm, geom_ll))

    # 1. satellite-detected inundation (the newest completed analysis)
    row = flood_analysis.latest_completed(c)
    if row is None:
        coverage["satellite"] = {"usable": False, "status": "NONE", "note": "No satellite flood analysis is available yet."}
    else:
        res = flood_analysis.result_dict(row)
        age_d = (res["age_hours"] or 0) / 24
        grade = (res.get("quality") or {}).get("grade", "LOW")
        stale = age_d > config.FLOOD_ANALYSIS_STALE_DAYS
        coverage["satellite"] = {"usable": not stale, "status": "STALE" if stale else "AVAILABLE", "analysis_id": res["analysis_id"],
                                 "acquired_at": res["acquired_at"], "age_hours": res["age_hours"], "quality": grade,
                                 "engine": res["engine"], "newly_inundated_km2": res["newly_inundated_km2"],
                                 "note": (f"Satellite pass is {round(age_d)} days old: not used to choose routes." if stale else
                                          "Satellite pass from " + (res["acquired_at"] or "")[:10] + "; not a live view.")}
        if not stale:
            hclass = EXCLUDE if age_d <= FRESH_SAT_DAYS else AVOID
            rel = (0.7 if grade == "MODERATE" else 0.5) * (1.0 if age_d <= FRESH_SAT_DAYS else 0.7)
            for f in res["geojson"]["features"]:
                add(f"sat:{res['analysis_id']}:{f['properties']['id']}", "SATELLITE_INUNDATION", flood_analysis.DETECTION_LABEL,
                    hclass, rel, res["acquired_at"], res["data_source"], geo.from_geojson(f["geometry"]))

    # 2. recent, credible user / volunteer reports
    since = (_now() - timedelta(hours=REPORT_MAX_AGE_H))
    reports = c.execute("SELECT * FROM incidents WHERE duplicate_of IS NULL AND status IN ('REPORTED','VERIFIED') AND type IN (%s)"
                        % ",".join("?" * len(REPORT_TYPES)), REPORT_TYPES).fetchall()
    used = 0
    newest = None
    for r in reports:
        inc = dict(r)
        t = _parse(inc.get("timestamp"))
        if inc["status"] != "VERIFIED" and (t is None or t < since):
            continue  # old unverified reports are not used; verified ones stay until an admin resolves them
        trust = compute_trust(c, inc)
        if inc["status"] == "VERIFIED":
            hclass, rel = EXCLUDE, 0.9
        elif trust >= 45:
            hclass, rel = EXCLUDE, trust / 100
        elif trust >= 25:
            hclass, rel = AVOID, trust / 100
        else:
            continue
        radius = float(inc.get("radius_meters") or 50.0) + 15.0
        geom = proj.to_lonlat(geo.circle(inc["latitude"], inc["longitude"], radius, proj))
        label = f"{inc['type'].replace('_', ' ').title()} report" + (" (verified)" if inc["status"] == "VERIFIED" else " (not yet verified)")
        before = len(hz)
        add(f"report:{inc['id']}", "VERIFIED_REPORT" if inc["status"] == "VERIFIED" else "USER_REPORT", label, hclass, rel,
            inc.get("timestamp"), "RiskN ResQ reports", geom)
        if len(hz) > before:
            used += 1
            newest = max(newest or "", inc.get("timestamp") or "")
    coverage["reports"] = {"usable": True, "status": "AVAILABLE", "count_on_corridor": used, "newest": newest,
                           "note": "Reports from the last 48 h (verified reports until resolved)."}

    # 3. road closures and blocked-road evidence
    closed = 0
    for name, state, pts in road_risk.blocked_polylines(c):
        if len(pts) < 2:
            continue
        line_m = proj.to_m(geo.line_from_latlng(pts))
        geom = proj.to_lonlat(line_m.buffer(25.0, 8))
        hclass = EXCLUDE if state == road_risk.VERIFIED_BLOCKED else AVOID
        before = len(hz)
        add(f"road:{name}", "ROAD_CLOSURE" if hclass == EXCLUDE else "REPORTED_BLOCKED_ROAD",
            f"{name}: {'closed / verified blocked' if hclass == EXCLUDE else 'reported blocked (not verified)'}", hclass,
            0.95 if hclass == EXCLUDE else 0.6, None, "RiskN ResQ road status", geom)
        closed += len(hz) > before
    coverage["roads"] = {"usable": True, "status": "AVAILABLE", "closures_on_corridor": closed,
                         "note": "Road closures set by administrators and roads with blocked-road reports."}

    # 4. weather-based flood-risk cells (area-level)
    preds = c.execute("SELECT cell, latitude, longitude, risk_score, risk_level, insufficient, computed_at FROM flood_risk_predictions").fetchall()
    good = [p for p in preds if not p["insufficient"]]
    if good:
        idx = road_risk.PredictionIndex(c)
        newest_pred = max(p["computed_at"] for p in good)
        for p in good:
            if p["risk_level"] in ("HIGH", "CRITICAL"):
                cell = shp_box(p["longitude"] - idx.dlng / 2, p["latitude"] - idx.dlat / 2, p["longitude"] + idx.dlng / 2, p["latitude"] + idx.dlat / 2)
                add(f"cell:{p['cell']}", "WEATHER_RISK_AREA", f"{p['risk_level'].title()} flood risk area ({p['risk_score']}/100, weather-based estimate)",
                    CAUTION, 0.4, p["computed_at"], "RiskN ResQ flood-risk model", cell)
        stale = (_age_h(newest_pred) or 0) > 3
        coverage["weather"] = {"usable": not stale, "status": "STALE" if stale else "AVAILABLE", "updated_at": newest_pred,
                               "note": "Area-level estimate per ~9 km cell, not a road observation."}
    else:
        coverage["weather"] = {"usable": False, "status": "NONE", "note": "Weather-based flood risk is unavailable."}

    # official alerts are listed, not drawn: they name an area, not a geometry
    alerts = [dict(a) for a in c.execute("SELECT id, severity, message, affected_zone, created_at, source FROM alerts WHERE active=1 "
                                         "AND severity IN ('HIGH','CRITICAL') ORDER BY id DESC LIMIT 5").fetchall()]
    coverage["official_alerts"] = {"usable": True, "status": "AVAILABLE", "active_high_alerts": len(alerts),
                                   "note": "Active HIGH/CRITICAL alerts are listed with the result."}
    if not inside:
        for k in ("satellite", "weather"):
            coverage[k] = {**coverage[k], "usable": False, "note": "The trip is outside the monitored area: this layer does not cover it."}
    return HazardLayer(proj, hz, coverage, alerts)


# --------------------------------------------------------------------------------------------- route evaluation
def evaluate(points: list, layer: HazardLayer) -> dict:
    """Metres of the route inside each hazard, and the route's class (feasible or not)."""
    line_m = layer.proj.to_m(geo.line_from_latlng(points))
    hits = []
    for h in layer.hazards:
        if not line_m.intersects(h.geom_m):
            continue
        length = line_m.intersection(h.geom_m).length
        hits.append({"hazard_id": h.id, "kind": h.kind, "label": h.label, "class": h.hclass, "length_m": round(length),
                     "reliability": h.reliability, "observed_at": h.observed_at, "source": h.source,
                     "near": _first_hit_point(line_m, h.geom_m, layer.proj)})
    excl = sum(x["length_m"] for x in hits if x["class"] == EXCLUDE)
    avoid = sum(x["length_m"] * x["reliability"] for x in hits if x["class"] == AVOID)
    caution = sum(x["length_m"] * x["reliability"] for x in hits if x["class"] == CAUTION)
    feasible = not any(x["class"] == EXCLUDE for x in hits)
    return {"hits": sorted(hits, key=lambda x: ({EXCLUDE: 0, AVOID: 1, CAUTION: 2}[x["class"]], -x["length_m"])),
            "exclude_m": round(excl), "avoid_m": round(avoid), "caution_m": round(caution), "feasible": feasible,
            "length_m": line_m.length}


def _first_hit_point(line_m, hazard_m, proj) -> Optional[list]:
    inter = line_m.intersection(hazard_m)
    if inter.is_empty:
        return None
    p = proj.to_lonlat(inter.representative_point() if inter.geom_type != "Point" else inter)
    return [round(p.y, 6), round(p.x, 6)]


def rank_key(r: dict):
    """Exposure to EXCLUDE hazards first (only matters when none is feasible), then AVOID exposure in 25 m steps, then time
    plus the CAUTION penalty, then distance."""
    ev = r["eval"]
    return (ev["exclude_m"], round(ev["avoid_m"] / 25), r["cand"].duration_seconds + ev["caution_m"] * CAUTION_S_PER_M, r["cand"].distance_meters)


# ------------------------------------------------------------------------------------------------- candidates
async def _safe_routes(provider, origin, destination, via=None) -> list:
    try:
        return await (provider.compute_routes(origin, destination, via=via) if via else provider.compute_routes(origin, destination))
    except Exception:
        return []


def _hazard_vias(points: list, hits: list, layer: HazardLayer, origin, destination) -> list:
    """Waypoints that push a route around the hazards it crosses: for each of the (up to two) worst hazards, a point beyond
    the hazard on each side of the travel direction."""
    from providers.routing.base import RoutePoint
    proj = layer.proj
    o = proj.to_m(Point(origin.longitude, origin.latitude))
    d = proj.to_m(Point(destination.longitude, destination.latitude))
    dx, dy = d.x - o.x, d.y - o.y
    norm = math.hypot(dx, dy) or 1.0
    px, py = -dy / norm, dx / norm
    out = []
    by_id = {h.id: h for h in layer.hazards}
    for hit in [x for x in hits if x["class"] in (EXCLUDE, AVOID)][:2]:
        h = by_id.get(hit["hazard_id"])
        if h is None:
            continue
        g = h.geom_m
        c = g.centroid
        minx, miny, maxx, maxy = g.bounds
        reach = math.hypot(maxx - minx, maxy - miny) / 2 + 500.0
        for side in (1, -1):
            p = proj.to_lonlat(Point(c.x + side * reach * px, c.y + side * reach * py))
            out.append(RoutePoint(latitude=round(p.y, 6), longitude=round(p.x, 6)))
    return out


def _side_vias(origin, destination) -> list:
    """Two waypoints beside the trip's midpoint, for a choice of corridors when the engine returns only one route."""
    from providers.routing.base import RoutePoint
    mid_lat, mid_lng = (origin.latitude + destination.latitude) / 2, (origin.longitude + destination.longitude) / 2
    k = math.cos(math.radians(mid_lat))
    dy, dx = destination.latitude - origin.latitude, (destination.longitude - origin.longitude) * k
    length = math.hypot(dx, dy)
    if length < 0.004:
        return []
    off = max(0.006, 0.3 * length)
    ux, uy = -dy / length, dx / length
    return [RoutePoint(latitude=mid_lat + s * off * uy, longitude=mid_lng + s * off * ux / k) for s in (1, -1)]


def _dupe(cand, existing) -> bool:
    return any(abs(cand.distance_meters - e.distance_meters) <= max(60, e.distance_meters * 0.015)
               and abs(cand.duration_seconds - e.duration_seconds) <= max(30, e.duration_seconds * 0.03) for e in existing)


def corridor_for(points_list: List[list], origin, destination, margin_m: float = 2500.0):
    lats = [origin.latitude, destination.latitude] + [p[0] for pts in points_list for p in pts]
    lngs = [origin.longitude, destination.longitude] + [p[1] for pts in points_list for p in pts]
    k = max(0.2, math.cos(math.radians(sum(lats) / len(lats))))
    dlat, dlng = margin_m / 110540.0, margin_m / (111320.0 * k)
    return geo.bbox_polygon(min(lngs) - dlng, min(lats) - dlat, max(lngs) + dlng, max(lats) + dlat)


# -------------------------------------------------------------------------------------------------- planning
class RoutingFailed(Exception):
    def __init__(self, message: str, status: int = 503, retry_after: Optional[int] = None):
        super().__init__(message)
        self.message, self.status, self.retry_after = message, status, retry_after


async def plan(c, provider, origin, destination, labels: Optional[dict] = None) -> dict:
    if haversine_meters(origin.latitude, origin.longitude, destination.latitude, destination.longitude) < 50:
        raise RoutingFailed("The origin and destination are the same place.", 422)
    try:
        base = await provider.compute_routes(origin, destination)
    except Exception as exc:
        resp = getattr(exc, "response", None)
        if resp is not None and getattr(resp, "status_code", None) == 429:
            raise RoutingFailed("The routing service is rate-limiting requests. Try again in a minute.", 503, 60) from exc
        raise RoutingFailed(f"The routing service is unavailable right now ({type(exc).__name__}).") from exc
    if not base:
        raise RoutingFailed("No drivable route was found between these places.", 404)
    cands = list(base)
    via_ok = getattr(provider, "supports_via", False)
    if via_ok and len(cands) < 2:
        extra = await asyncio.gather(*(_safe_routes(provider, origin, destination, [v]) for v in _side_vias(origin, destination)))
        for res in extra:
            if res and not _dupe(res[0], cands):
                res[0].summary = "Alternative corridor"
                cands.append(res[0])
    layer = collect_hazards(c, corridor_for([x.polyline for x in cands], origin, destination))
    rows = [{"cand": x, "eval": evaluate(x.polyline, layer)} for x in cands]
    if via_ok and layer.hazards and not any(r["eval"]["feasible"] and r["eval"]["avoid_m"] == 0 for r in rows):
        worst = min(rows, key=rank_key)
        vias = _hazard_vias(worst["cand"].polyline, worst["eval"]["hits"], layer, origin, destination)[:4]
        extra = await asyncio.gather(*(_safe_routes(provider, origin, destination, [v]) for v in vias))
        for res in extra:
            if res and not _dupe(res[0], [r["cand"] for r in rows]):
                res[0].summary = "Detour around a reported hazard"
                rows.append({"cand": res[0], "eval": evaluate(res[0].polyline, layer)})
    fastest_s = min(r["cand"].duration_seconds for r in rows)
    rows = [r for r in rows if r["cand"].duration_seconds <= fastest_s * MAX_DETOUR_FACTOR or r["cand"] in base]
    rows.sort(key=rank_key)
    feasible = [r for r in rows if r["eval"]["feasible"]]
    usable = layer.usable()
    if not feasible:
        status = "ALL_ROUTES_AFFECTED"
    elif not usable:
        status = "NOT_CHECKED"
    else:
        status = "RECOMMENDED"
    recommended = feasible[0] if feasible else None
    fastest = min(rows, key=lambda r: r["cand"].duration_seconds)
    routes = []
    for i, r in enumerate(rows[:4]):
        cd, ev = r["cand"], r["eval"]
        rid = "r-" + hashlib.sha1(json.dumps(cd.polyline[:: max(1, len(cd.polyline) // 50)]).encode()).hexdigest()[:10]
        if r is recommended:
            label = "Recommended"
        elif not ev["feasible"]:
            label = "Crosses a flood hazard"
        else:
            label = "Alternative"
        routes.append({
            "route_id": rid, "rank": i + 1, "label": label, "summary": cd.summary, "is_fastest": r is fastest,
            "recommended": r is recommended, "feasible": ev["feasible"], "geometry": cd.polyline,
            "distance_km": round(cd.distance_meters / 1000, 2), "eta_minutes": cd.eta_minutes, "duration_seconds": cd.duration_seconds,
            "hazard_intersections": ev["hits"], "exposure": {"excluded_hazard_m": ev["exclude_m"], "avoid_hazard_m": ev["avoid_m"],
                                                              "caution_area_m": ev["caution_m"], "route_length_m": round(ev["length_m"])},
            "steps": getattr(cd, "steps", None) or [], "source": cd.source,
        })
    rec = next((x for x in routes if x["recommended"]), None)
    reason = _reason(status, rec, routes, len(rows))
    warnings = _warnings(status, layer, routes)
    return {
        "plan_id": uuid.uuid4().hex[:12], "status": status, "recommended_route_id": rec["route_id"] if rec else None,
        "least_exposed_route_id": routes[0]["route_id"] if routes else None,
        "origin": {**origin.model_dump(), "label": (labels or {}).get("origin")},
        "destination": {**destination.model_dump(), "label": (labels or {}).get("destination")},
        "routes": routes, "selection_reason": reason, "candidates_considered": len(rows),
        "hazards": [h.public() for h in layer.hazards if h.hclass != CAUTION or any(h.id == x["hazard_id"] for r in routes for x in r["hazard_intersections"])],
        "hazard_version": layer.version, "data_coverage": layer.coverage, "official_alerts": layer.alerts,
        "warnings": warnings, "limitations": [ROUTE_NOTE, "The routing engine does not know about floods; routes are checked against "
                                              "RiskN ResQ hazard layers only.", *flood_analysis.LIMITATIONS[:2]],
        "routing_source": (rec or routes[0])["source"] if routes else None, "generated_at": _now().isoformat(timespec="seconds"),
    }


def _reason(status, rec, routes, n) -> str:
    if status == "ALL_ROUTES_AFFECTED":
        return (f"All {n} candidate route(s) cross a known flood hazard. No route is recommended. The one listed first has the least "
                "exposure; consider waiting, choosing another destination, or contacting emergency services.")
    if rec is None:
        return "No route could be recommended."
    parts = [f"Chosen from {n} candidate route(s)"]
    others = [r for r in routes if not r["recommended"]]
    if any(not r["feasible"] for r in others):
        parts.append("it avoids hazards that other routes cross")
    if rec["exposure"]["avoid_hazard_m"]:
        parts.append(f"it still passes {rec['exposure']['avoid_hazard_m']} m of lower-confidence hazards")
    elif not rec["hazard_intersections"]:
        parts.append("it crosses no hazard currently known to RiskN ResQ")
    if rec["exposure"]["caution_area_m"]:
        parts.append(f"{round(rec['exposure']['caution_area_m'] / 1000, 1)} km lies in high flood-risk areas (weather-based)")
    fastest = next((r for r in routes if r["is_fastest"]), None)
    if fastest and fastest is not rec:
        parts.append(f"+{max(0, rec['eta_minutes'] - fastest['eta_minutes'])} min compared with the fastest route")
    return "; ".join(parts) + "."


def _warnings(status, layer: HazardLayer, routes) -> list:
    out = []
    if status == "ALL_ROUTES_AFFECTED":
        out.append("Every route found crosses a known flood hazard. Do not drive through floodwater.")
    if status == "NOT_CHECKED":
        out.append("This route could not be fully checked for flood risk: no usable hazard data covers it.")
    for k, v in layer.coverage.items():
        if k in ("satellite", "weather") and not v.get("usable"):
            out.append(f"{k.title()} layer: {v['note']}")
    for a in layer.alerts:
        out.append(f"Official alert ({a['severity']}, {a['affected_zone']}): {a['message']}")
    return out


def reassess(c, points: list, known_ids: List[str]) -> dict:
    """Re-check a route the person is following against the current hazards (cheap: stored data only, no satellite request)."""
    lats, lngs = [p[0] for p in points], [p[1] for p in points]
    from providers.routing.base import RoutePoint
    o, d = RoutePoint(latitude=lats[0], longitude=lngs[0]), RoutePoint(latitude=lats[-1], longitude=lngs[-1])
    layer = collect_hazards(c, corridor_for([points], o, d, 500.0))
    ev = evaluate(points, layer)
    known = set(known_ids or [])
    new = [h for h in ev["hits"] if h["hazard_id"] not in known and h["class"] in (EXCLUDE, AVOID)]
    return {"affected": bool(new), "feasible": ev["feasible"], "new_intersections": new, "hazard_intersections": ev["hits"],
            "hazard_version": layer.version, "data_coverage": layer.coverage, "checked_at": _now().isoformat(timespec="seconds"),
            "message": ("New hazard information affects your route. Review the new route before switching." if new else
                        "No new hazard on your route in RiskN ResQ data. Conditions can change: stay alert.")}
