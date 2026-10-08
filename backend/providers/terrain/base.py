from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import List, Optional


@dataclass
class TerrainPoint:
    elevation_m: Optional[float]
    slope_deg: Optional[float]
    concavity_m: Optional[float]   # centre minus the mean of its neighbours: negative = a local depression


class TerrainProvider(ABC):
    @abstractmethod
    def get_source_name(self) -> str: ...

    @abstractmethod
    async def get_terrain(self, points: list) -> List[TerrainPoint]:
        """Elevation, slope and local concavity for each (lat, lng)."""
