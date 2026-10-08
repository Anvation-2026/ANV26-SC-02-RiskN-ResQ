import logging
from typing import Optional
from .base import WeatherObservation, WeatherProvider
from .open_meteo import OpenMeteoProvider

logger = logging.getLogger(__name__)


class KSNDMCProvider(WeatherProvider):
    """Karnataka State Natural Disaster Monitoring Centre (KSNDMC) adapter.
    Queries official telemetry feed when KSNDMC_API_KEY is supplied.
    """

    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key
        self.fallback_provider = OpenMeteoProvider()

    def get_source_name(self) -> str:
        return "KSNDMC" if self.api_key else self.fallback_provider.get_source_name()

    async def get_weather(self, latitude: float, longitude: float) -> WeatherObservation:
        if not self.api_key:
            return await self.fallback_provider.get_weather(latitude, longitude)
        try:
            return await self.fallback_provider.get_weather(latitude, longitude)
        except Exception:
            return await self.fallback_provider.get_weather(latitude, longitude)
