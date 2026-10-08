"""OpenStreetMap (Overpass) lookups used by the admin imports: real roads, hospitals and shelters for the monitored area."""
import httpx

import config


MIRRORS = ["https://overpass.kumi.systems/api/interpreter", "https://overpass.private.coffee/api/interpreter"]


async def fetch(query: str) -> dict:
    """Run an Overpass query, trying the configured server and then public mirrors (the main one is often busy).
    A single choke point so tests can replace it."""
    last = None
    async with httpx.AsyncClient(timeout=60.0, headers={"User-Agent": "RiskN-ResQ/1.0 (flood response demo)"}) as client:
        for url in [config.OVERPASS_URL, *MIRRORS]:
            try:
                resp = await client.post(url, data={"data": query})
                resp.raise_for_status()
                return resp.json()
            except Exception as exc:
                last = exc
    raise last


def bbox() -> str:
    s, w, n, e = config.MONITORING_BOUNDS
    return f"{s},{w},{n},{e}"


def roads_query(limit_hint: int = 400) -> str:
    return (f'[out:json][timeout:50];way["highway"~"^(trunk|primary|secondary)$"]["name"]({bbox()});out geom {limit_hint};')


def hospitals_query() -> str:
    b = bbox()
    return f'[out:json][timeout:40];(node["amenity"="hospital"]["name"]({b});way["amenity"="hospital"]["name"]({b}););out center 150;'


def shelters_query() -> str:
    b = bbox()
    return f'[out:json][timeout:40];(node["emergency"="assembly_point"]["name"]({b});node["social_facility"="shelter"]["name"]({b}););out center 100;'


def thin(points: list, max_points: int = 40) -> list:
    if len(points) <= max_points:
        return points
    step = len(points) / (max_points - 1)
    out = [points[int(i * step)] for i in range(max_points - 1)]
    return out + [points[-1]]
