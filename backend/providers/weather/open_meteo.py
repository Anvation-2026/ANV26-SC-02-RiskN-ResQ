import logging
from datetime import datetime, timezone
import httpx
from .base import WeatherObservation, WeatherProvider

logger = logging.getLogger(__name__)


def accumulations(hourly: list) -> dict:
    """Rain accumulations from Open-Meteo's hourly series requested with past_hours=24: indices 0-23 are the last 24
    completed hours (oldest first), index 24 is the current hour, 25+ are forecast hours."""
    h = [float(v or 0.0) for v in hourly]
    past = h[:24]
    out = {"rain_24h_mm": round(sum(past), 2)}
    if len(past) >= 6:
        out.update(rain_1h_mm=round(past[-1], 2), rain_3h_mm=round(sum(past[-3:]), 2), rain_6h_mm=round(sum(past[-6:]), 2))
    ahead = h[25:31]
    if ahead:
        out["forecast_3h_mm"] = round(sum(ahead[:3]), 2)
        out["forecast_6h_mm"] = round(sum(ahead), 2)
    return out


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
            f"&hourly=precipitation,rain&past_hours=24&forecast_hours=7"
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
        acc = accumulations(hourly_precip) if hourly_precip else {"rain_24h_mm": 0.0}
        rainfall_24h = acc["rain_24h_mm"]

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
            rain_1h_mm=acc.get("rain_1h_mm"), rain_3h_mm=acc.get("rain_3h_mm"), rain_6h_mm=acc.get("rain_6h_mm"),
            forecast_3h_mm=acc.get("forecast_3h_mm"), forecast_6h_mm=acc.get("forecast_6h_mm"),
        )

    async def get_weather_grid(self, points: list) -> list:
        """One request per chunk of points (Open-Meteo accepts comma-separated coordinates), not one per point."""
        out = []
        for i in range(0, len(points), 50):
            chunk = points[i:i + 50]
            url = (
                "https://api.open-meteo.com/v1/forecast"
                f"?latitude={','.join(str(la) for la, _ in chunk)}&longitude={','.join(str(lo) for _, lo in chunk)}"
                "&current=precipitation,weather_code&hourly=precipitation&past_hours=24&forecast_hours=7"
            )
            async with httpx.AsyncClient(timeout=max(self.timeout, 15.0)) as client:
                resp = await client.get(url)
                resp.raise_for_status()
                data = resp.json()
            if isinstance(data, dict):  # a single point comes back as an object, several as a list
                data = [data]
            if len(data) != len(chunk):
                raise ValueError("Open-Meteo returned an unexpected number of locations")
            for (la, lo), item in zip(chunk, data):
                curr = item.get("current") or {}
                hourly = (item.get("hourly") or {}).get("precipitation") or []
                obs_time = curr.get("time")
                try:
                    observed = datetime.fromisoformat(obs_time).replace(tzinfo=timezone.utc).isoformat()
                except Exception:
                    observed = datetime.now(timezone.utc).isoformat(timespec="seconds")
                ahead = [float(v or 0.0) for v in hourly[25:28]]  # next three hours (index 24 is the current hour)
                peak = max(ahead) if ahead else None
                out.append(WeatherObservation(
                    forecast_peak_mm=peak, forecast_peak_in_h=(ahead.index(peak) + 1) if ahead else None,
                    source=self.get_source_name(), station=f"grid {la:.2f},{lo:.2f}", latitude=la, longitude=lo,
                    rainfall_24h_mm=accumulations(hourly)["rain_24h_mm"],
                    **{k: v for k, v in accumulations(hourly).items() if k != "rain_24h_mm"},
                    rainfall_intensity_mm_per_hour=float(curr.get("precipitation") or 0.0),
                    observed_at=observed, weather_code=curr.get("weather_code"),
                ))
        return out

    async def get_elevations(self, points: list) -> list:
        out = []
        for i in range(0, len(points), 100):
            chunk = points[i:i + 100]
            url = ("https://api.open-meteo.com/v1/elevation"
                   f"?latitude={','.join(str(la) for la, _ in chunk)}&longitude={','.join(str(lo) for _, lo in chunk)}")
            async with httpx.AsyncClient(timeout=max(self.timeout, 15.0)) as client:
                resp = await client.get(url)
                resp.raise_for_status()
                values = resp.json().get("elevation") or []
            out.extend([float(v) if v is not None else None for v in values] + [None] * (len(chunk) - len(values)))
        return out
