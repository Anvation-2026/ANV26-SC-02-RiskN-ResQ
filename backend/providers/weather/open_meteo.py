import logging
from datetime import datetime, timezone
import httpx
from .base import WeatherObservation, WeatherProvider

logger = logging.getLogger(__name__)


class OpenMeteoProvider(WeatherProvider):
    """Real-world weather and precipitation provider using the Open-Meteo API.
    Does not require private credentials and operates globally.
    """

    def __init__(self, timeout: float = 6.0):
        self.timeout = timeout

    def get_source_name(self) -> str:
        return "Open-Meteo"

    async def get_weather(self, latitude: float, longitude: float) -> WeatherObservation:
        url = (
            f"https://api.open-meteo.com/v1/forecast"
            f"?latitude={latitude}&longitude={longitude}"
            f"&current=temperature_2m,relative_humidity_2m,precipitation,rain,weather_code"
            f"&hourly=precipitation,rain&past_hours=24&forecast_hours=1"
        )
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            data = resp.json()

        curr = data.get("current", {})
        hourly = data.get("hourly", {})

        intensity = float(curr.get("precipitation") or curr.get("rain") or 0.0)
        temp = float(curr.get("temperature_2m")) if curr.get("temperature_2m") is not None else None
        humidity = float(curr.get("relative_humidity_2m")) if curr.get("relative_humidity_2m") is not None else None

        hourly_precip = hourly.get("precipitation", [])
        # Sum past 24 hours (excluding the future forecast hour)
        rainfall_24h = sum(float(p or 0.0) for p in hourly_precip[:24]) if hourly_precip else 0.0
        rainfall_24h = round(rainfall_24h, 2)

        # Derive meteorological flood warning level
        if intensity >= 30.0 or rainfall_24h >= 100.0:
            warning_level = "RED"
        elif intensity >= 15.0 or rainfall_24h >= 50.0:
            warning_level = "ORANGE"
        elif intensity >= 5.0 or rainfall_24h >= 20.0:
            warning_level = "YELLOW"
        else:
            warning_level = "NONE"

        obs_time = curr.get("time")
        if obs_time:
            try:
                obs_iso = datetime.fromisoformat(obs_time).replace(tzinfo=timezone.utc).isoformat()
            except Exception:
                obs_iso = datetime.now(timezone.utc).isoformat(timespec="seconds")
        else:
            obs_iso = datetime.now(timezone.utc).isoformat(timespec="seconds")

        return WeatherObservation(
            source=self.get_source_name(),
            station=f"Open-Meteo Global Surface ({latitude:.2f}, {longitude:.2f})",
            latitude=latitude,
            longitude=longitude,
            rainfall_24h_mm=rainfall_24h,
            rainfall_intensity_mm_per_hour=intensity,
            temperature=temp,
            humidity=humidity,
            warning_level=warning_level,
            observed_at=obs_iso,
        )
