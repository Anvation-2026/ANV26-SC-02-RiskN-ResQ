"""Historical rainfall extremes from ERA5 reanalysis through Open-Meteo's free archive API (10 years of daily totals).
This is rainfall climatology, NOT a record of past floods."""
from datetime import datetime, timezone

import httpx

from .base import ClimateProvider, Climatology

URL = "https://archive-api.open-meteo.com/v1/archive"


async def _get(params: dict):
    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.get(URL, params=params)
        resp.raise_for_status()
        return resp.json()


def percentile(sorted_vals: list, q: float) -> float:
    if not sorted_vals:
        return 0.0
    k = (len(sorted_vals) - 1) * q
    lo, hi = int(k), min(int(k) + 1, len(sorted_vals) - 1)
    return sorted_vals[lo] + (sorted_vals[hi] - sorted_vals[lo]) * (k - lo)


class ERA5Provider(ClimateProvider):
    YEARS = 10

    def get_source_name(self) -> str:
        return "ERA5 reanalysis, 10-year daily rainfall (Open-Meteo archive)"

    async def get_climatology(self, points: list):
        end = datetime.now(timezone.utc).year - 1
        out = []
        for i in range(0, len(points), 10):
            chunk = points[i:i + 10]
            data = await _get({"latitude": ",".join(f"{la:.4f}" for la, _ in chunk), "longitude": ",".join(f"{lo:.4f}" for _, lo in chunk),
                               "start_date": f"{end - self.YEARS + 1}-01-01", "end_date": f"{end}-12-31",
                               "daily": "precipitation_sum", "timezone": "GMT"})
            if isinstance(data, dict):
                data = [data]
            for item in data:
                vals = [float(v) for v in (item.get("daily") or {}).get("precipitation_sum") or [] if v is not None]
                wet = sorted(v for v in vals if v >= 1.0)
                if len(wet) < 50:
                    out.append(None)
                    continue
                out.append(Climatology(round(percentile(wet, 0.95), 1), round(percentile(wet, 0.99), 1), round(max(vals), 1),
                                       self.YEARS, self.get_source_name()))
        return out
