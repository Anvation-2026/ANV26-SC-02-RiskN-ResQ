import logging
from typing import List, Optional
from .base import RouteCandidate, RoutePoint, RoutingProvider
from .google_routes import GoogleRoutesProvider
from .osrm import OSRMProvider

logger = logging.getLogger(__name__)


class CompositeRoutingProvider(RoutingProvider):
    """Prefers Google Routes when configured; falls back safely to OSRM."""

    def __init__(self, google_api_key: Optional[str] = None):
        self.google_api_key = google_api_key
        self.google_provider = GoogleRoutesProvider(google_api_key) if google_api_key else None
        self.osrm_provider = OSRMProvider()

    def get_source_name(self) -> str:
        if self.google_provider:
            return "Google Routes (with OSRM fallback)"
        return "OSRM"

    async def compute_routes(
        self, origin: RoutePoint, destination: RoutePoint
    ) -> List[RouteCandidate]:
        if self.google_provider:
            try:
                routes = await self.google_provider.compute_routes(origin, destination)
                if routes:
                    return routes
                logger.warning("Google Routes returned no candidates. Trying OSRM fallback.")
            except Exception as e:
                logger.warning(f"Google Routes API call failed ({e}). Falling back to OSRM.")

        # Fallback to OSRM
        return await self.osrm_provider.compute_routes(origin, destination)
