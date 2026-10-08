"""Satellite water observation interface. A real provider only has to implement find_scenes and water_fraction; the
flood engine never talks to a satellite service directly."""
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import List, Optional


@dataclass
class SatelliteScene:
    scene_id: str
    kind: str                      # "SAR" (Sentinel-1 radar, sees through cloud) or "OPTICAL" (Sentinel-2)
    collection: str
    acquired_at: str               # ISO timestamp of the satellite pass
    orbit_state: Optional[str] = None
    relative_orbit: Optional[int] = None
    cloud_cover: Optional[float] = None
    source: str = ""

    @property
    def track(self):
        """Scenes are only comparable when they come from the same orbit track and direction."""
        return (self.orbit_state, self.relative_orbit)


@dataclass
class WaterStat:
    fraction: float                # share of the area classified as open water (0-1)
    valid_pixels: int
    method: str                    # e.g. "Sentinel-1 VV backscatter threshold" or "Sentinel-2 NDWI"
    threshold: str


class SatelliteUnavailable(Exception):
    """The provider could not be reached or returned nothing usable. Callers report 'data unavailable', never fake a result."""


class SatelliteProvider(ABC):
    @abstractmethod
    def get_source_name(self) -> str: ...

    @abstractmethod
    async def find_scenes(self, bbox: tuple, kind: str = "SAR", limit: int = 20) -> List[SatelliteScene]:
        """Scenes covering bbox (west, south, east, north), newest first."""

    @abstractmethod
    async def water_fraction(self, scene: SatelliteScene, bbox: tuple) -> WaterStat:
        """Open-water share of the bbox in this scene."""
