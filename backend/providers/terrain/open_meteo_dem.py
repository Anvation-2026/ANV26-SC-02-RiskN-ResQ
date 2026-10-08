"""Terrain from the Copernicus DEM (90 m) through Open-Meteo's free elevation API.
Slope and concavity come from four extra samples ~550 m around each point."""
import math

import httpx

from .base import TerrainPoint, TerrainProvider

STEP_DEG = 0.005  # about 550 m


async def _get(url: str, params: dict):
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.get(url, params=params)
        resp.raise_for_status()
        return resp.json()


class OpenMeteoDEMProvider(TerrainProvider):
    def get_source_name(self) -> str:
        return "Copernicus DEM 90 m (Open-Meteo)"

    async def _elevations(self, coords: list) -> list:
        out = []
        for i in range(0, len(coords), 100):
            chunk = coords[i:i + 100]
            data = await _get("https://api.open-meteo.com/v1/elevation",
                              {"latitude": ",".join(f"{la:.5f}" for la, _ in chunk), "longitude": ",".join(f"{lo:.5f}" for _, lo in chunk)})
            vals = data.get("elevation") or []
            if len(vals) != len(chunk):
                raise ValueError("unexpected elevation response")
            out.extend(float(v) if v is not None else None for v in vals)
        return out

    async def get_terrain(self, points: list) -> list:
        coords = []
        for la, lo in points:
            coords += [(la, lo), (la + STEP_DEG, lo), (la - STEP_DEG, lo), (la, lo + STEP_DEG), (la, lo - STEP_DEG)]
        z = await self._elevations(coords)
        out = []
        for i, (la, _) in enumerate(points):
            c, n, s, e, w = z[i * 5:i * 5 + 5]
            if None in (c, n, s, e, w):
                out.append(TerrainPoint(c, None, None))
                continue
            dy = 2 * STEP_DEG * 111_320.0
            dx = 2 * STEP_DEG * 111_320.0 * math.cos(math.radians(la))
            slope = math.degrees(math.atan(math.hypot((e - w) / dx, (n - s) / dy)))
            out.append(TerrainPoint(round(c, 1), round(slope, 2), round(c - (n + s + e + w) / 4.0, 2)))
        return out
