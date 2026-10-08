import logging
from typing import List, Optional
import httpx
from .base import RouteCandidate, RoutePoint, RoutingProvider

logger = logging.getLogger(__name__)


def decode_polyline(polyline_str: str) -> List[List[float]]:
    coords = []
    index = 0
    lat = 0
    lng = 0
    length = len(polyline_str)
    while index < length:
        result = 0
        shift = 0
        while True:
            b = ord(polyline_str[index]) - 63
            index += 1
            result |= (b & 0x1f) << shift
            shift += 5
            if b < 0x20:
                break
        dlat = ~(result >> 1) if (result & 1) else (result >> 1)
        lat += dlat

        result = 0
        shift = 0
        while True:
            b = ord(polyline_str[index]) - 63
            index += 1
            result |= (b & 0x1f) << shift
            shift += 5
            if b < 0x20:
                break
        dlng = ~(result >> 1) if (result & 1) else (result >> 1)
        lng += dlng

        coords.append([round(lat * 1e-5, 6), round(lng * 1e-5, 6)])
    return coords


class GoogleRoutesProvider(RoutingProvider):
    """Production routing provider using Google Maps Routes API (ComputeRoutes)."""

    def __init__(self, api_key: str, timeout: float = 8.0):
        self.api_key = api_key
        self.timeout = timeout

    def get_source_name(self) -> str:
        return "Google Routes"

    async def compute_routes(
        self, origin: RoutePoint, destination: RoutePoint
    ) -> List[RouteCandidate]:
        url = "https://routes.googleapis.com/directions/v2:computeRoutes"
        headers = {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": self.api_key,
            "X-Goog-FieldMask": (
                "routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline,"
                "routes.description,routes.warnings,routes.travelAdvisory.speedReadingIntervals"
            ),
        }
        body = {
            "origin": {
                "location": {
                    "latLng": {
                        "latitude": origin.latitude,
                        "longitude": origin.longitude,
                    }
                }
            },
            "destination": {
                "location": {
                    "latLng": {
                        "latitude": destination.latitude,
                        "longitude": destination.longitude,
                    }
                }
            },
            "travelMode": "DRIVE",
            "routingPreference": "TRAFFIC_AWARE",
            "computeAlternativeRoutes": True,
        }

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.post(url, headers=headers, json=body)
            resp.raise_for_status()
            data = resp.json()

        routes_data = data.get("routes", [])
        if not routes_data:
            return []

        candidates = []
        for r in routes_data:
            enc_poly = r.get("polyline", {}).get("encodedPolyline", "")
            pts = decode_polyline(enc_poly) if enc_poly else []
            if len(pts) < 2:
                continue

            dist_meters = int(r.get("distanceMeters", 0))
            # duration format: e.g. "450s"
            raw_dur = r.get("duration", "0s").replace("s", "")
            try:
                dur_secs = int(float(raw_dur))
            except ValueError:
                dur_secs = 0

            eta_min = max(1, round(dur_secs / 60))
            desc = r.get("description") or "Recommended route"

            # Check traffic condition from advisory if present
            traffic = "NORMAL"
            advisory = r.get("travelAdvisory", {})
            speed_intervals = advisory.get("speedReadingIntervals", [])
            for interval in speed_intervals:
                speed_type = interval.get("speed", "")
                if speed_type == "TRAFFIC_JAM":
                    traffic = "HEAVY"
                    break
                elif speed_type == "SLOW":
                    traffic = "MODERATE"

            candidates.append(
                RouteCandidate(
                    polyline=pts,
                    distance_meters=dist_meters,
                    duration_seconds=dur_secs,
                    eta_minutes=eta_min,
                    summary=desc,
                    traffic=traffic,
                    source=self.get_source_name(),
                    warnings=r.get("warnings", []),
                )
            )

        return candidates
