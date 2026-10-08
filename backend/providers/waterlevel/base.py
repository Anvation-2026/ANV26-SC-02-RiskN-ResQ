from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import List, Optional


@dataclass
class WaterReading:
    kind: str                      # "RIVER_DISCHARGE_MODEL" (GloFAS) or "GAUGE_LEVEL" (a real gauge)
    current: float
    normal: Optional[float]
    maximum: Optional[float]
    unit: str
    observed_on: str               # date of the value
    source: str


class WaterLevelProvider(ABC):
    @abstractmethod
    def get_source_name(self) -> str: ...

    @abstractmethod
    async def get_levels(self, points: list) -> List[Optional[WaterReading]]:
        """A reading per (lat, lng), or None where this provider has no data for that place. Never invents a value."""


class GaugeWaterLevelProvider(WaterLevelProvider):
    """Placeholder for a real river-gauge network. No public, keyless gauge API covers the monitored area (India-WRIS and
    CWC data need registration), so this returns nothing instead of inventing readings. Replace it with a provider that
    reads real gauges (current level, normal level, warning and danger thresholds) when access is available."""

    def get_source_name(self) -> str:
        return "River gauge network (not connected)"

    async def get_levels(self, points: list):
        return [None] * len(points)
