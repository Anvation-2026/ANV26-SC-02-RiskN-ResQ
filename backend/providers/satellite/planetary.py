"""Sentinel-1 / Sentinel-2 water detection through Microsoft's free Planetary Computer (no key needed).

The search uses the public STAC API; the water fraction uses the public statistics endpoint, which evaluates a band
expression over an area and returns its mean, so no raster libraries are required here:
  * Sentinel-1 RTC (radar, works through monsoon cloud): water where VV backscatter is below a dB threshold.
  * Sentinel-2 L2A (optical): NDWI = (green - NIR) / (green + NIR) above zero, only for low-cloud scenes.
"""
import math
from datetime import datetime, timezone
from typing import List

import httpx

import config
from .base import SatelliteProvider, SatelliteScene, SatelliteUnavailable, WaterStat

COLLECTIONS = {"SAR": "sentinel-1-rtc", "OPTICAL": "sentinel-2-l2a"}


async def _request(method: str, url: str, **kw):
    """Single choke point for HTTP so tests can replace it."""
    async with httpx.AsyncClient(timeout=60.0, headers={"User-Agent": "RiskN-ResQ/1.0"}) as client:
        resp = await client.request(method, url, **kw)
        resp.raise_for_status()
        return resp.json()


def _polygon(bbox: tuple) -> dict:
    w, s, e, n = bbox
    return {"type": "Feature", "properties": {}, "geometry": {"type": "Polygon", "coordinates": [[[w, s], [e, s], [e, n], [w, n], [w, s]]]}}


class PlanetaryComputerProvider(SatelliteProvider):
    def get_source_name(self) -> str:
        return "Sentinel (Microsoft Planetary Computer)"

    async def find_scenes(self, bbox: tuple, kind: str = "SAR", limit: int = 20) -> List[SatelliteScene]:
        body = {"collections": [COLLECTIONS[kind]], "bbox": list(bbox), "limit": limit,
                "datetime": f"2015-01-01T00:00:00Z/{datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')}",
                "sortby": [{"field": "datetime", "direction": "desc"}]}
        if kind == "OPTICAL":
            body["query"] = {"eo:cloud_cover": {"lt": 25}}
        try:
            data = await _request("POST", f"{config.PLANETARY_COMPUTER_URL}/stac/v1/search", json=body)
        except Exception as exc:
            raise SatelliteUnavailable(f"scene search failed: {type(exc).__name__}") from exc
        out = []
        for f in data.get("features", []):
            p = f.get("properties", {})
            out.append(SatelliteScene(
                scene_id=f["id"], kind=kind, collection=COLLECTIONS[kind], acquired_at=p.get("datetime", ""),
                orbit_state=p.get("sat:orbit_state"), relative_orbit=p.get("sat:relative_orbit"),
                cloud_cover=p.get("eo:cloud_cover"), source=self.get_source_name()))
        return out

    async def water_fraction(self, scene: SatelliteScene, bbox: tuple) -> WaterStat:
        if scene.kind == "SAR":
            linear = 10 ** (config.SAR_WATER_THRESHOLD_DB / 10.0)
            params = {"assets": "vv", "asset_bidx": "vv|1", "expression": f"where(vv<{linear:.5f},1,0)"}
            method, threshold = "Sentinel-1 VV backscatter threshold", f"VV < {config.SAR_WATER_THRESHOLD_DB:g} dB"
        else:
            params = {"assets": "B03,B08", "expression": "where((B03*1.0-B08*1.0)/(B03*1.0+B08*1.0+1)>0,1,0)"}
            method, threshold = "Sentinel-2 NDWI", "NDWI > 0"
        params.update({"collection": scene.collection, "item": scene.scene_id, "asset_as_band": "true", "max_size": "512"})
        try:
            data = await _request("POST", f"{config.PLANETARY_COMPUTER_URL}/data/v1/item/statistics", params=params, json=_polygon(bbox))
            stats = next(iter(data["properties"]["statistics"].values()))
            frac, count = float(stats["mean"]), int(stats["count"])
        except Exception as exc:
            raise SatelliteUnavailable(f"statistics failed: {type(exc).__name__}") from exc
        if not math.isfinite(frac) or count <= 0:
            raise SatelliteUnavailable("no valid pixels in this scene for the area")
        return WaterStat(fraction=min(1.0, max(0.0, frac)), valid_pixels=count, method=method, threshold=threshold)
