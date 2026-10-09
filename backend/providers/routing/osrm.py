import logging
from typing import List, Optional
import httpx
from .base import RouteCandidate, RoutePoint, RoutingProvider

logger = logging.getLogger(__name__)


class OSRMProvider(RoutingProvider):
    """Real street-level routing engine based on OpenStreetMap driving network.
    Provides verified real-world routes globally without proprietary key requirements.
    """

    def __init__(self, timeout: float = 6.0):
        self.timeout = timeout

    def get_source_name(self) -> str:
        return "OSRM"

    supports_via = True

    async def compute_routes(
        self, origin: RoutePoint, destination: RoutePoint, via: Optional[List[RoutePoint]] = None
    ) -> List[RouteCandidate]:
        # OSRM expects coordinates as {longitude},{latitude}; a via point forces a detour through it (used to route around danger)
        pts = [origin, *(via or []), destination]
        coords = ";".join(f"{p.longitude},{p.latitude}" for p in pts)
        url = f"https://router.project-osrm.org/route/v1/driving/{coords}?overview=full&geometries=geojson&steps=true&alternatives={'false' if via else 'true'}"

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            data = resp.json()

        if data.get("code") != "Ok":
            logger.warning(f"OSRM returned non-ok code: {data.get('code')}")
            return []

        routes = data.get("routes", [])
        candidates = []

        for idx, r in enumerate(routes):
            geom = r.get("geometry", {})
            raw_pts = geom.get("coordinates", [])
            # Convert [lng, lat] to [lat, lng]
            pts = [[round(p[1], 6), round(p[0], 6)] for p in raw_pts]
            if len(pts) < 2:
                continue

            dist_m = int(round(r.get("distance", 0.0)))
            dur_s = int(round(r.get("duration", 0.0)))
            eta_m = max(1, round(dur_s / 60))

            summary = f"Route via {r.get('legs', [{}])[0].get('summary', 'Corridor')}" if r.get('legs') else "Real road route"

            candidates.append(
                RouteCandidate(
                    polyline=pts,
                    distance_meters=dist_m,
                    duration_seconds=dur_s,
                    eta_minutes=eta_m,
                    summary=summary,
                    traffic="NORMAL",
                    source=self.get_source_name(),
                    steps=directions(r.get("legs", [])),
                )
            )

        return candidates

    async def durations(self, origin: RoutePoint, destinations: List[RoutePoint]) -> List[Optional[float]]:
        """Driving time in seconds from origin to each destination (OSRM table service, one request); None if unreachable."""
        pts = [origin, *destinations]
        coords = ";".join(f"{p.longitude},{p.latitude}" for p in pts)
        url = f"https://router.project-osrm.org/table/v1/driving/{coords}?sources=0&annotations=duration"
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            data = resp.json()
        if data.get("code") != "Ok":
            return [None] * len(destinations)
        return list(data["durations"][0][1:])


COMPASS = ("north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest")


def _instruction(step: dict) -> str:
    m = step.get("maneuver", {})
    kind, mod = m.get("type", ""), (m.get("modifier") or "").replace("uturn", "U-turn")
    name = step.get("name") or step.get("ref") or ""
    onto = f" onto {name}" if name else ""
    if kind == "depart":
        return f"Head {COMPASS[int(((m.get('bearing_after') or 0) + 22.5) // 45) % 8]}" + (f" on {name}" if name else "")
    if kind == "arrive":
        return "Arrive at your destination" + (f", on the {mod}" if mod in ("left", "right") else "")
    if kind in ("roundabout", "rotary"):
        return f"At the roundabout, take exit {m.get('exit', 1)}{onto}"
    if kind in ("exit roundabout", "exit rotary"):
        return f"Leave the roundabout{onto}"
    if kind == "merge":
        return f"Merge {mod}{onto}".replace("  ", " ")
    if kind == "on ramp":
        return f"Take the ramp{onto}"
    if kind == "off ramp":
        return f"Take the exit{onto}"
    if kind == "fork":
        return f"Keep {mod or 'straight'} at the fork{onto}"
    if kind in ("new name", "continue", "notification") or mod == "straight":
        return f"Continue{onto or ' straight'}"
    if mod:
        return f"Turn {mod}{onto}"
    return f"Continue{onto}"


def directions(legs: list) -> list:
    """OSRM steps as plain instructions with distance and time (no geometry, to keep responses small)."""
    out = []
    for li, leg in enumerate(legs or []):
        for st in leg.get("steps", []):
            if li > 0 and st.get("maneuver", {}).get("type") == "depart":
                continue  # a via waypoint is not a stop: no second "Head ..." in the middle of the trip
            loc = st.get("maneuver", {}).get("location") or [None, None]
            out.append({"instruction": _instruction(st), "distance_m": int(round(st.get("distance", 0))),
                        "duration_s": int(round(st.get("duration", 0))), "road": st.get("name") or None,
                        "location": [round(loc[1], 6), round(loc[0], 6)] if loc[0] is not None else None})
    out = [s for i, s in enumerate(out) if not (s["instruction"].startswith("Arrive") and i < len(out) - 1)]
    merged = []
    for s in out:  # "Continue onto X" right after a step already on X adds nothing: fold it into that step
        if merged and s["instruction"].startswith("Continue") and s["road"] and s["road"] == merged[-1]["road"]:
            merged[-1]["distance_m"] += s["distance_m"]
            merged[-1]["duration_s"] += s["duration_s"]
        else:
            merged.append(s)
    return merged
