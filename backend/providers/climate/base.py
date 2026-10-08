from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import List, Optional


@dataclass
class Climatology:
    p95_mm: float      # 95th percentile of wet-day (>=1 mm) daily rainfall
    p99_mm: float
    max_mm: float
    years: int
    source: str


class ClimateProvider(ABC):
    @abstractmethod
    def get_source_name(self) -> str: ...

    @abstractmethod
    async def get_climatology(self, points: list) -> List[Optional[Climatology]]:
        """Historical daily-rainfall extremes per (lat, lng): how unusual is today's rain here?"""
