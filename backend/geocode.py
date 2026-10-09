"""Place search and place names (OpenStreetMap Nominatim), so people can check the flood risk at any place by name and the
web app can show a place name instead of coordinates.

Nominatim's usage policy is respected: an identifying User-Agent, at most one request per second for the whole server,
and results cached (a day for searches, a week for place names). Phones never call Nominatim directly.
"""
import asyncio
import time
from typing import List, Optional

import httpx

import config

BASE = "https://nominatim.openstreetmap.org"
HEADERS = {"User-Agent": "RiskN-ResQ/1.0 (flood early-warning; https://github.com/Anvation-2026/ANV26-SC-02-RiskN-ResQ)", "Accept-Language": "en"}
SEARCH_TTL_S = 24 * 3600
REVERSE_TTL_S = 7 * 24 * 3600
_cache: dict = {}
_lock = asyncio.Lock()
_last = [0.0]
_transport: Optional[httpx.AsyncBaseTransport] = None  # tests inject httpx.MockTransport here


async def _get(path: str, params: dict):
    async with _lock:  # one request per second across the server (Nominatim policy)
        wait = 1.05 - (time.time() - _last[0])
        if wait > 0:
            await asyncio.sleep(wait)
        _last[0] = time.time()
        async with httpx.AsyncClient(timeout=12.0, headers=HEADERS, transport=_transport) as client:
            r = await client.get(f"{BASE}{path}", params=params)
    r.raise_for_status()
    return r.json()


def _cached(key):
    hit = _cache.get(key)
    return hit[1] if hit and hit[0] > time.time() else None


def _store(key, value, ttl):
    if len(_cache) > 2000:
        _cache.clear()
    _cache[key] = (time.time() + ttl, value)


def _short_name(item: dict) -> str:
    a = item.get("address") or {}
    first = item.get("name") or a.get("neighbourhood") or a.get("suburb") or a.get("road") or (item.get("display_name") or "").split(",")[0]
    area = a.get("suburb") or a.get("city_district") or a.get("city") or a.get("town") or a.get("county")
    return f"{first}, {area}" if area and area != first else first


async def search(query: str) -> List[dict]:
    """Up to 6 places matching the query, preferring the monitored area (results elsewhere are still returned, flagged)."""
    q = " ".join(query.split())[:120]
    key = ("s", q.lower())
    hit = _cached(key)
    if hit is not None:
        return hit
    s, w, n, e = config.MONITORING_BOUNDS
    data = await _get("/search", {"q": q, "format": "jsonv2", "addressdetails": 1, "limit": 6, "countrycodes": "in",
                                  "viewbox": f"{w},{n},{e},{s}", "bounded": 0})
    out = []
    for it in data or []:
        lat, lng = float(it["lat"]), float(it["lon"])
        out.append({"name": _short_name(it), "display_name": it.get("display_name"), "latitude": round(lat, 6), "longitude": round(lng, 6),
                    "inside_monitored_area": s <= lat <= n and w <= lng <= e, "source": "OpenStreetMap Nominatim"})
    out.sort(key=lambda p: not p["inside_monitored_area"])  # places we monitor first
    unique = []  # OpenStreetMap often has several objects for one place (area, node, ward): keep one per name within ~1 km
    for p in out:
        if not any(p["name"] == u["name"] and abs(p["latitude"] - u["latitude"]) < 0.01 and abs(p["longitude"] - u["longitude"]) < 0.01 for u in unique):
            unique.append(p)
    out = unique
    _store(key, out, SEARCH_TTL_S)
    return out


async def reverse(lat: float, lng: float) -> Optional[str]:
    """A short place name for a position (cached per ~100 m), or None when Nominatim has nothing."""
    key = ("r", round(lat, 3), round(lng, 3))
    hit = _cached(key)
    if hit is not None:
        return hit or None
    data = await _get("/reverse", {"lat": lat, "lon": lng, "format": "jsonv2", "zoom": 16, "addressdetails": 1})
    name = _short_name(data) if data and not data.get("error") else ""
    _store(key, name, REVERSE_TTL_S)
    return name or None
