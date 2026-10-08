from abc import ABC, abstractmethod
from typing import Optional
from pydantic import BaseModel, Field


class WeatherObservation(BaseModel):
    source: str = Field(..., description="Provider source identifier e.g. IMD, Open-Meteo, KSNDMC")
    station: str = Field(..., description="Weather station or grid location name")
    latitude: float
    longitude: float
    rainfall_24h_mm: float = Field(0.0, description="Cumulative 24-hour precipitation in mm")
    rainfall_intensity_mm_per_hour: float = Field(0.0, description="Current precipitation intensity in mm/h")
    temperature: Optional[float] = None
    humidity: Optional[float] = None
    warning_level: str = Field("NONE", description="Official or threshold-derived warning: NONE, YELLOW, ORANGE, RED")
    observed_at: str


class WeatherProvider(ABC):
    @abstractmethod
    async def get_weather(self, latitude: float, longitude: float) -> WeatherObservation:
        """Fetch current weather and precipitation observation for coordinates."""
        pass

    @abstractmethod
    def get_source_name(self) -> str:
        """Return the source name of this provider."""
        pass
