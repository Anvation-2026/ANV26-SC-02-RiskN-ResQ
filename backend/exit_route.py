"""Route OUT of a flagged flood area: from the person's position, by real roads, to the nearest lower-risk place outside it.

The flagged area is what RiskN ResQ currently warns about:
  * HIGH / CRITICAL zone alerts (including admin SIMULATED DRILLs): a circle of ZONE_ALERT_RADIUS_KM around the zone centre,
  * HIGH / CRITICAL flood-risk cells from the live model (area-level, ~9 km),
  * fresh satellite-detected inundation and credible flood reports (with a 300 m margin).

Exit candidates are points just beyond the edge of that area in 16 directions, plus designated shelters / hospitals that lie
outside it. The routing service's table gives driving times to all of them in one request; the quickest few are routed,
each route is checked against the hazard layer (safe_route), and they are ranked by: no EXCLUDE hazard, then the time until
the route leaves the flagged area, then the total time. A drill's area is simulated; the roads and the route are real.
"Lower-risk" means outside the currently flagged area. It is never described as safe."""
import asyncio
import hashlib
import json
import math
import uuid
from typing import List, Optional

from shapely.geometry import LineString, Point

import config
import db
import flood_analysis
import geo
import safe_route

EXIT_MARGIN_M = 500.0        # targets sit this far beyond the edge, so the route really leaves the area
RAY_LENGTH_M = 40000.0
MAX_ROUTED = 4
DIRS = ("north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west")


def _bearing_word(deg: float) -> str:
    return DIRS[int(((deg % 360) + 22.5) // 45) % 8]


def danger_area(c, proj) -> dict:
    """The flagged flood area in projected metres, with its parts and whether any of it is a drill."""
    parts, labels, drill = [], [], False
    for a in c.execute("SELECT affected_zone, severity, message FROM alerts WHERE active=1 AND severity IN ('HIGH','CRITICAL')").fetchall():
        z = a["affected_zone"]
        if z not in db.ZONES:
            continue
        sim = (a["message"] or "").startswith("SIMULATED DRILL")
        drill |= sim
        parts.append(geo.circle(db.ZONES[z][0], db.ZONES[z][1], config.ZONE_ALERT_RADIUS_KM * 1000, proj))
        labels.append(f"{z}: {a['severity']} flood alert{' (SIMULATED DRILL)' if sim else ''}")
    preds = c.execute("SELECT cell, latitude, longitude, risk_level, risk_score, insufficient, computed_at FROM flood_risk_predictions "
                      "WHERE risk_level IN ('HIGH','CRITICAL')").fetchall()
    if preds:
        import road_risk
        idx = road_risk.PredictionIndex(c)
        for p in preds:
            if p["insufficient"] or (safe_route._age_h(p["computed_at"]) or 99) > 3:
                continue
            cell = geo.bbox_polygon(p["longitude"] - idx.dlng / 2, p["latitude"] - idx.dlat / 2, p["longitude"] + idx.dlng / 2, p["latitude"] + idx.dlat / 2)
            parts.append(proj.to_m(cell))
            labels.append(f"{p['risk_level'].title()} flood-risk area ({p['risk_score']}/100, weather-based)")
    row = flood_analysis.latest_completed(c)
    if row is not None:
        res = flood_analysis.result_dict(row)
        if not res["stale"]:
            for f in res["geojson"]["features"]:
                parts.append(proj.to_m(geo.from_geojson(f["geometry"])).buffer(300))
            if res["geojson"]["features"]:
                labels.append("Satellite-detected potential new water (+300 m)")
    for r in c.execute("SELECT id, type, status, latitude, longitude, radius_meters, timestamp, trust_score FROM incidents WHERE duplicate_of IS NULL "
                       "AND status IN ('REPORTED','VERIFIED') AND type IN ('FLOOD','FLOODED_ROAD')").fetchall():
        recent = (safe_route._age_h(r["timestamp"]) or 1e9) <= safe_route.REPORT_MAX_AGE_H
        if r["status"] == "VERIFIED" or (recent and (r["trust_score"] or 0) >= 45):
            parts.append(geo.circle(r["latitude"], r["longitude"], float(r["radius_meters"] or 50) + 300, proj))
            labels.append(f"{r['type'].replace('_', ' ').title()} report #{r['id']} (+300 m)")
    return {"geom": geo.union(parts) if parts else None, "labels": labels, "drill": drill}


def _component(geom, pt):
    for p in geo.polygons_of(geom):
        if p.buffer(1).contains(pt):
            return p
    return None


def exit_targets(component, origin_m, danger_m) -> List[dict]:
    """Points EXIT_MARGIN_M beyond the edge of the area, in 16 directions from the person, that are outside every flagged part."""
    out = []
    for i in range(16):
        deg = i * 22.5
        dx, dy = math.sin(math.radians(deg)), math.cos(math.radians(deg))
        ray = LineString([(origin_m.x, origin_m.y), (origin_m.x + dx * RAY_LENGTH_M, origin_m.y + dy * RAY_LENGTH_M)])
        hit = ray.intersection(component.boundary)
        pts = [g for g in (getattr(hit, "geoms", None) or [hit]) if not g.is_empty and g.geom_type == "Point"]
        if not pts:
            continue
        edge = min(pts, key=lambda p: p.distance(origin_m))
        d = edge.distance(origin_m)
        for extra in (EXIT_MARGIN_M, EXIT_MARGIN_M * 3, EXIT_MARGIN_M * 6):  # step further out if another flagged part is right there
            t = Point(origin_m.x + dx * (d + extra), origin_m.y + dy * (d + extra))
            if not danger_m.contains(t):
                out.append({"point_m": t, "bearing": deg, "edge_m": d, "label": f"Outside the flagged area ({_bearing_word(deg)})", "kind": "EDGE"})
                break
    return out


def _place_targets(c, proj, danger_m, origin_m, max_km: float = 15.0) -> List[dict]:
    out = []
    for p in c.execute("SELECT name, kind, latitude, longitude FROM places").fetchall():
        pm = proj.to_m(Point(p["longitude"], p["latitude"]))
        if pm.distance(origin_m) <= max_km * 1000 and not danger_m.buffer(200).contains(pm):
            deg = math.degrees(math.atan2(pm.x - origin_m.x, pm.y - origin_m.y)) % 360
            out.append({"point_m": pm, "bearing": deg, "edge_m": None, "kind": p["kind"],
                        "label": f"{p['name']} ({'hospital' if p['kind'] == 'HOSPITAL' else 'designated shelter'}, outside the flagged area)"})
    return out


def _inside_profile(points: list, duration_s: int, danger_m, proj) -> dict:
    """How long the route stays inside the flagged area: distance and time until it leaves for the last time."""
    line = proj.to_m(geo.line_from_latlng(points))
    total = line.length or 1.0
    inside = line.intersection(danger_m)
    last = 0.0
    for g in (getattr(inside, "geoms", None) or [inside]):
        if g.is_empty:
            continue
        for x, y in list(g.coords) if g.geom_type == "LineString" else []:
            last = max(last, line.project(Point(x, y)))
    return {"inside_m": round(inside.length), "exit_after_m": round(last), "exit_after_s": round(duration_s * last / total),
            "exit_point": (lambda p: [round(p.y, 6), round(p.x, 6)])(proj.to_lonlat(line.interpolate(last))) if last else None}


async def plan_exit(c, provider, origin, name_lookup=None) -> dict:
    from providers.routing.base import RoutePoint
    proj = geo.projection_for(origin.latitude, origin.longitude)
    origin_m = proj.to_m(Point(origin.longitude, origin.latitude))
    area = danger_area(c, proj)
    base = {"plan_id": uuid.uuid4().hex[:12], "mode": "EXIT", "drill": area["drill"], "origin": {**origin.model_dump(), "label": "My location"},
            "flagged_area_parts": area["labels"], "generated_at": safe_route._now().isoformat(timespec="seconds")}
    danger_m = area["geom"]
    comp = _component(danger_m, origin_m) if danger_m is not None else None
    if comp is None:
        return {**base, "status": "ALREADY_OUTSIDE", "routes": [], "recommended_route_id": None, "least_exposed_route_id": None,
                "destination": None, "hazards": [], "danger_area": geo.to_geojson(proj.to_lonlat(danger_m), 5) if danger_m is not None else None,
                "selection_reason": "Your position is outside every area RiskN ResQ currently flags for flooding. Stay alert; use the planner if you need to travel.",
                "warnings": [], "limitations": [safe_route.ROUTE_NOTE], "data_coverage": {}, "hazard_version": None}

    targets = exit_targets(comp, origin_m, danger_m) + _place_targets(c, proj, danger_m, origin_m)
    if not targets:
        return {**base, "status": "NO_EXIT_FOUND", "routes": [], "recommended_route_id": None, "least_exposed_route_id": None, "destination": None,
                "hazards": [], "danger_area": geo.to_geojson(proj.to_lonlat(danger_m), 5), "warnings": ["No point outside the flagged area could be found."],
                "selection_reason": "No way out of the flagged area could be found. Move to higher ground and call 112.", "limitations": [safe_route.ROUTE_NOTE],
                "data_coverage": {}, "hazard_version": None}
    for t in targets:
        ll = proj.to_lonlat(t["point_m"])
        t["rp"] = RoutePoint(latitude=round(ll.y, 6), longitude=round(ll.x, 6))
        t["straight_m"] = t["point_m"].distance(origin_m)

    # quickest targets by driving time (one table request); straight-line distance when the table is unavailable
    times = None
    if hasattr(provider, "durations"):
        try:
            times = await provider.durations(origin, [t["rp"] for t in targets])
        except Exception:
            times = None
    for t, s in zip(targets, times or [None] * len(targets)):
        t["table_s"] = s if s is not None else (None if times else t["straight_m"] / 8.0)
    ranked = sorted([t for t in targets if t["table_s"] is not None], key=lambda t: t["table_s"])
    chosen = []
    for t in ranked:  # spread over directions: two exits less than 45 degrees apart are usually the same road
        if all(abs((t["bearing"] - u["bearing"] + 180) % 360 - 180) >= 45 for u in chosen):
            chosen.append(t)
        if len(chosen) >= MAX_ROUTED:
            break
    try:
        results = await asyncio.gather(*(provider.compute_routes(origin, t["rp"]) for t in chosen), return_exceptions=True)
    except Exception as exc:
        raise safe_route.RoutingFailed(f"The routing service is unavailable right now ({type(exc).__name__}).") from exc
    pairs = [(t, r[0]) for t, r in zip(chosen, results) if not isinstance(r, Exception) and r]
    if not pairs:
        if all(isinstance(r, Exception) for r in results):
            raise safe_route.RoutingFailed("The routing service is unavailable right now.")
        return {**base, "status": "NO_EXIT_FOUND", "routes": [], "recommended_route_id": None, "least_exposed_route_id": None, "destination": None,
                "hazards": [], "danger_area": geo.to_geojson(proj.to_lonlat(danger_m), 5), "warnings": ["No drivable road leads out of the flagged area."],
                "selection_reason": "No drivable road out of the flagged area was found. Move to higher ground and call 112.", "limitations": [safe_route.ROUTE_NOTE],
                "data_coverage": {}, "hazard_version": None}

    corridor = safe_route.corridor_for([cd.polyline for _, cd in pairs], origin, pairs[0][0]["rp"])
    layer = safe_route.collect_hazards(c, corridor)
    rows = []
    for t, cd in pairs:
        ev = safe_route.evaluate(cd.polyline, layer)
        prof = _inside_profile(cd.polyline, cd.duration_seconds, danger_m, proj)
        rows.append({"t": t, "cand": cd, "eval": ev, "prof": prof})
    rows.sort(key=lambda r: (not r["eval"]["feasible"], r["prof"]["exit_after_s"], r["cand"].duration_seconds))
    rec = next((r for r in rows if r["eval"]["feasible"]), None)
    if rec is not None and name_lookup and rec["t"]["kind"] == "EDGE":
        try:
            name = await asyncio.wait_for(name_lookup(rec["t"]["rp"].latitude, rec["t"]["rp"].longitude), 5)
            if name:
                rec["t"]["label"] = f"{name} (outside the flagged area, {_bearing_word(rec['t']['bearing'])})"
        except Exception:
            pass
    routes = []
    for i, r in enumerate(rows):
        cd, ev, prof, t = r["cand"], r["eval"], r["prof"], r["t"]
        rid = "x-" + hashlib.sha1(json.dumps(cd.polyline[:: max(1, len(cd.polyline) // 50)]).encode()).hexdigest()[:10]
        routes.append({
            "route_id": rid, "rank": i + 1, "recommended": r is rec, "feasible": ev["feasible"],
            "label": "Quickest way out" if r is rec else ("Crosses a flood hazard" if not ev["feasible"] else "Another way out"),
            "summary": f"To {t['label']}", "is_fastest": cd.duration_seconds == min(x["cand"].duration_seconds for x in rows),
            "destination": {"latitude": t["rp"].latitude, "longitude": t["rp"].longitude, "label": t["label"]},
            "geometry": cd.polyline, "distance_km": round(cd.distance_meters / 1000, 2), "eta_minutes": cd.eta_minutes, "duration_seconds": cd.duration_seconds,
            "exit_after_km": round(prof["exit_after_m"] / 1000, 2), "exit_after_minutes": max(1, round(prof["exit_after_s"] / 60)) if prof["exit_after_m"] else 0,
            "exit_point": prof["exit_point"], "hazard_intersections": ev["hits"],
            "exposure": {"excluded_hazard_m": ev["exclude_m"], "avoid_hazard_m": ev["avoid_m"], "caution_area_m": ev["caution_m"], "route_length_m": round(ev["length_m"]),
                         "inside_flagged_area_m": prof["inside_m"]},
            "steps": getattr(cd, "steps", None) or [], "source": cd.source,
        })
    best = next((x for x in routes if x["recommended"]), None)
    status = "EXIT_ROUTE_FOUND" if best else "ALL_ROUTES_AFFECTED"
    if best:
        reason = (f"Quickest of {len(routes)} way(s) out by road: you leave the flagged flood area after about {best['exit_after_km']} km "
                  f"(~{best['exit_after_minutes']} min) and reach a lower-risk area outside it in about {best['eta_minutes']} min ({best['distance_km']} km).")
        if best["exposure"]["avoid_hazard_m"]:
            reason += f" It still passes {best['exposure']['avoid_hazard_m']} m of lower-confidence hazards."
    else:
        reason = ("Every way out found crosses a known flood hazard, so none is recommended. The first one listed has the least exposure. "
                  "If water is rising, move to higher ground (an upper floor) and call 112.")
    warnings = []
    if area["drill"]:
        warnings.append("SIMULATED DRILL: the flagged flood area comes from an admin exercise. The roads and the route are real.")
    warnings += safe_route._warnings(status if status == "ALL_ROUTES_AFFECTED" else "RECOMMENDED", layer, routes)
    kind = "DRILL_ZONE" if area["drill"] else "FLOOD_ZONE"
    danger_ll = proj.to_lonlat(danger_m)
    hazards = [{"hazard_id": "flagged-area", "kind": kind, "label": "Flagged flood area" + (" (SIMULATED DRILL)" if area["drill"] else ""),
                "class": "AREA", "geometry": geo.to_geojson(danger_ll, 5)}] + \
              [h.public() for h in layer.hazards if h.hclass != safe_route.CAUTION or any(h.id == x["hazard_id"] for r in routes for x in r["hazard_intersections"])]
    return {**base, "status": status, "routes": routes, "recommended_route_id": best["route_id"] if best else None,
            "least_exposed_route_id": routes[0]["route_id"], "destination": (best or routes[0])["destination"],
            "selection_reason": reason, "candidates_considered": len(targets), "hazards": hazards, "danger_area": geo.to_geojson(danger_ll, 5),
            "hazard_version": layer.version, "data_coverage": layer.coverage, "official_alerts": layer.alerts, "warnings": warnings,
            "limitations": ["Lower-risk means outside the area RiskN ResQ currently flags; flood data can be incomplete or delayed. "
                            "Never drive into floodwater. If water is rising around you, move to higher ground and call 112.", safe_route.ROUTE_NOTE],
            "routing_source": (best or routes[0])["source"]}
