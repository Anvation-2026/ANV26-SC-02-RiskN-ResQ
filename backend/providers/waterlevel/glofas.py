"""River discharge from the GloFAS model through Open-Meteo's free Flood API.

This is MODELLED river discharge (m3/s) on a ~5 km grid, not a gauge reading, and it is labelled that way everywhere.
'normal' is the model's mean for the date and 'maximum' its recorded maximum for the date."""
from datetime import datetime, timezone

import httpx

from .base import WaterLevelProvider, WaterReading

URL = "https://flood-api.open-meteo.com/v1/flood"


async def _get(params: dict):
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.get(URL, params=params)
        resp.raise_for_status()
        return resp.json()


class GloFASProvider(WaterLevelProvider):
    def get_source_name(self) -> str:
        return "GloFAS river discharge model (Open-Meteo Flood API)"

    async def get_levels(self, points: list):
        out = []
        today = datetime.now(timezone.utc).date().isoformat()
        for i in range(0, len(points), 50):
            chunk = points[i:i + 50]
            data = await _get({"latitude": ",".join(f"{la:.4f}" for la, _ in chunk), "longitude": ",".join(f"{lo:.4f}" for _, lo in chunk),
                               "daily": "river_discharge,river_discharge_mean,river_discharge_max", "past_days": 2, "forecast_days": 1})
            if isinstance(data, dict):
                data = [data]
            for item in data:
                d = item.get("daily") or {}
                times = d.get("time") or []
                idx = times.index(today) if today in times else (len(times) - 1 if times else None)
                cur = (d.get("river_discharge") or [None])[idx] if idx is not None else None
                if cur is None:
                    out.append(None)
                    continue
                pick = lambda key: (d.get(key) or [None] * (idx + 1))[idx]  # noqa: E731
                out.append(WaterReading("RIVER_DISCHARGE_MODEL", float(cur), pick("river_discharge_mean"), pick("river_discharge_max"),
                                        "m3/s", times[idx], self.get_source_name()))
            if len(out) < i + len(chunk):
                out.extend([None] * (i + len(chunk) - len(out)))
        return out
