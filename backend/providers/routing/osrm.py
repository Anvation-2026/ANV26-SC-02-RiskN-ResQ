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
        url = f"https://router.project-osrm.org/route/v1/driving/{coords}?overview=full&geometries=geojson&alternatives={'false' if via else 'true'}"

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
                )
            )

        return candidates
