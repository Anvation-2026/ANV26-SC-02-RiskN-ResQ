"""Risk-aware route selection on top of the existing routing providers.

Candidates come from the real street network (OSRM/Google). Routes that cross a blocked road or a blocking incident are
excluded (the existing rule, now also covering admin-blocked roads). Among the rest the cheapest wins, where
cost = travel time x (1 + 0.6 x mean flood-risk score along the route / 100) x (1 + 0.1 per potentially-affected road, max +30%).
The wording is always 'recommended ... based on current environmental and incident data': never 'safe'."""
from typing import Optional

import road_risk
from engine import compute_trust, does_route_intersect_incident, now_iso

ROUTE_NOTE = "Recommended alternative route based on current environmental and incident data."
BLOCKING = ("FLOOD", "FLOODED_ROAD", "BLOCKED_ROAD", "WATERLOGGING", "FALLEN_TREE")


def evaluate(candidate, incidents: list, blocked: list, potentially: list, idx) -> dict:
    dense = road_risk.densify(candidate.polyline, 25.0)
    hit_inc = [i for i in incidents if does_route_intersect_incident(road_risk.densify(candidate.polyline, 40.0), i)]
    hit_blocked = [(n, s) for n, s, pts in blocked if road_risk.route_touches(dense, pts, road_risk.bbox_of(pts))]
    hit_potential = [n for n, pts in potentially if road_risk.route_touches(dense, pts, road_risk.bbox_of(pts))]
    scores = []
    for p in road_risk.densify(candidate.polyline, 200.0):
        pred = idx.at(p[0], p[1])
        if pred:
            scores.append(pred["risk_score"] or 0)
    mean = sum(scores) / len(scores) if scores else None
    cost = candidate.duration_seconds * (1 + 0.6 * (mean or 0) / 100.0) * (1 + min(0.3, 0.1 * len(hit_potential)))
    return {"candidate": candidate, "incidents": hit_inc, "blocked": hit_blocked, "potential": hit_potential, "mean_risk": mean,
            "max_risk": max(scores) if scores else None, "cost": cost, "covered": len(scores)}


async def plan_route(c, routing_provider, origin, destination) -> dict:
    rows = c.execute("SELECT * FROM incidents WHERE duplicate_of IS NULL AND status IN ('REPORTED', 'VERIFIED') ORDER BY id DESC").fetchall()
    incidents = []
    for r in rows:
        inc = dict(r)
        inc["trust_score"] = compute_trust(c, inc)
        if inc["type"] in BLOCKING and (inc["trust_score"] >= 45 or inc["status"] == "VERIFIED"):
            incidents.append(inc)
    states = {x["id"]: x for x in road_risk.assess_roads(c)}
    import json as _json
    geo = {r["id"]: _json.loads(r["coordinates"]) for r in c.execute("SELECT id, coordinates FROM roads").fetchall()}
    names = {i: s["name"] for i, s in states.items()}
    blocked = [(names[i], s["state"], geo[i]) for i, s in states.items() if s["state"] in (road_risk.VERIFIED_BLOCKED, road_risk.REPORTED_BLOCKED)]
    potentially = [(names[i], geo[i]) for i, s in states.items() if s["state"] == road_risk.POTENTIAL]
    idx = road_risk.PredictionIndex(c)

    candidates = await routing_provider.compute_routes(origin, destination)
    base = {"origin": origin.model_dump(), "destination": destination.model_dump()}
    if not candidates:
        return {**base, "success": False, "message": "No traversable route found between these locations.",
                "safetyNote": "Route calculated using available data; incident information may be outdated."}
    scored = [evaluate(cd, incidents, blocked, potentially, idx) for cd in candidates]
    clean = [s for s in scored if not s["incidents"] and not s["blocked"]]
    pool = clean or sorted(scored, key=lambda s: (len(s["incidents"]) + len(s["blocked"]), s["cost"]))[:1]
    best = min(pool, key=lambda s: s["cost"])
    sel = best["candidate"]
    avoided_incidents = sorted({i["id"]: i for s in scored if s is not best for i in s["incidents"]}.values(), key=lambda i: i["id"]) if clean else best["incidents"]
    avoided_roads = sorted({n for s in scored if s is not best for n, _ in s["blocked"]}) if clean else []
    risk_info = {"mean_risk_score": round(best["mean_risk"], 1) if best["mean_risk"] is not None else None,
                 "max_risk_score": best["max_risk"], "route_points_with_risk_data": best["covered"],
                 "potentially_affected_roads_on_route": best["potential"],
                 "blocked_roads_on_route": [n for n, _ in best["blocked"]],
                 "basis": "Flood-risk estimate per ~9 km grid cell along the route; an area-level estimate, not a road-level observation."}
    if risk_info["mean_risk_score"] is None:
        reason = "Chosen from the available routes. Flood-risk data was unavailable along this route, so only blocked roads and reported incidents were considered."
    else:
        reason = (f"Chosen from {len(scored)} candidate route(s){' that avoid ' + ', '.join(avoided_roads) if avoided_roads else ''}; "
                  f"lowest combined travel time and flood-risk exposure (mean risk {risk_info['mean_risk_score']}/100).")
    if not clean:
        reason = "Every available route crosses a blocked road or reported incident; this is the one with the fewest. Consider waiting or using a designated evacuation point."
    avoided_summary = [{"id": i["id"], "type": i["type"], "description": i.get("description", ""), "latitude": i["latitude"], "longitude": i["longitude"]} for i in avoided_incidents]
    primary = scored[0]
    pc = primary["candidate"]
    primary_hits = len(primary["incidents"]) + len(primary["blocked"])
    changed = best is not primary
    if primary_hits and changed:
        route_status = "HAZARD_AVOIDED"
    elif primary_hits:
        route_status = "AFFECTED"
    else:
        route_status = "CLEAR"
    return {
        **base, "success": True, "status": route_status, "hasAlternate": changed,
        "primaryRoute": {"distanceKm": round(pc.distance_meters / 1000.0, 2), "etaMinutes": pc.eta_minutes, "polyline": pc.polyline,
                         "intersections": primary_hits, "summary": pc.summary},
        "alternateRoute": {"distanceKm": round(sel.distance_meters / 1000.0, 2), "etaMinutes": sel.eta_minutes, "polyline": sel.polyline,
                           "avoidedCount": len(avoided_summary), "summary": sel.summary} if changed else None,
        "distanceMeters": sel.distance_meters, "distanceKm": round(sel.distance_meters / 1000.0, 2), "distance_km": round(sel.distance_meters / 1000.0, 2),
        "durationSeconds": sel.duration_seconds, "etaMinutes": sel.eta_minutes, "eta_minutes": sel.eta_minutes, "polyline": sel.polyline, "recommended_route": sel.polyline,
        "traffic": sel.traffic, "summary": sel.summary, "avoidedIncidents": avoided_summary, "avoided_roads": avoided_roads, "risk_information": risk_info,
        "reason": reason, "source": sel.source, "validatedAgainstIncidents": True, "safetyNote": ROUTE_NOTE, "generatedAt": now_iso(),
    }
