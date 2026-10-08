from abc import ABC, abstractmethod
from typing import List, Optional
from pydantic import BaseModel, Field


class RoutePoint(BaseModel):
    latitude: float
    longitude: float


class RouteCandidate(BaseModel):
    polyline: List[List[float]] = Field(..., description="Array of [latitude, longitude] coordinates along the street")
    distance_meters: int
    duration_seconds: int
    eta_minutes: int
    summary: str = "Recommended route"
    traffic: str = Field("NORMAL", description="Traffic condition: NORMAL, MODERATE, HEAVY")
    source: str = Field("Google Routes", description="Routing provider used")
    warnings: List[str] = Field(default_factory=list)


class RoutingProvider(ABC):
    @abstractmethod
    async def compute_routes(
        self, origin: RoutePoint, destination: RoutePoint
    ) -> List[RouteCandidate]:
        """Compute real street-level route candidates from origin to destination."""
        pass

    @abstractmethod
    def get_source_name(self) -> str:
        pass
