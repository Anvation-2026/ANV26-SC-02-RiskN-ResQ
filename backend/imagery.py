"""Satellite imagery catalogue for the map: which tile layers the app can show and how recent each one really is.

- "Satellite" basemap: Esri World Imagery, high resolution but a mosaic of photos taken months or years ago (NOT live).
- "Today": NASA GIBS VIIRS true colour, a new global image every day (about 375 m per pixel; clouds hide the ground).
- NASA flood detection: VIIRS combined flood product, 2-day window, updated daily (red = flood, yellow = recurring flood).
- Radar water: OPERA DSWx from Sentinel-1 radar (30 m, sees through cloud), for the days a satellite passes over.

The latest date of each NASA layer is read from the GIBS capabilities document (cached for a few hours, refreshed in the
background) so the app can say exactly which day it is showing. If NASA cannot be reached the tiles still load with
GIBS's "default" time (its latest day); only the date label is then unknown. Phones never download the catalogue.
"""
import logging
import re
import threading
import time
from typing import Optional

import httpx

logger = logging.getLogger("risknresq.imagery")
GIBS = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best"
CAPABILITIES = f"{GIBS}/wmts.cgi?SERVICE=WMTS&REQUEST=GetCapabilities"
REFRESH_S = 3 * 3600
ATTRIBUTION_NASA = "Imagery: NASA EOSDIS GIBS"

LAYERS = [
    {"id": "satellite", "role": "basemap", "name": "Satellite", "provider": "Esri World Imagery",
     "url": "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
     "max_native_zoom": 19, "resolution": "up to ~0.5 m", "live": False,
     "attribution": "Imagery: Esri, Maxar, Earthstar Geographics",
     "note": "High-resolution photo mosaic captured over past months or years. It is not live and will not show today's flooding."},
    {"id": "today", "role": "basemap", "name": "Today (NASA)", "provider": "NASA VIIRS (Suomi NPP)", "gibs": "VIIRS_SNPP_CorrectedReflectance_TrueColor",
     "ext": "jpg", "matrix": "GoogleMapsCompatible_Level9", "max_native_zoom": 9, "resolution": "~375 m per pixel", "live": True,
     "attribution": ATTRIBUTION_NASA,
     "note": "A new satellite image of the whole region every day. Too coarse to see streets, and clouds hide the ground during heavy rain."},
    {"id": "nasa_flood", "role": "overlay", "name": "NASA flood detection", "provider": "NASA LANCE VIIRS combined flood (2-day)", "gibs": "VIIRS_Combined_Flood_2-Day",
     "ext": "png", "matrix": "GoogleMapsCompatible_Level9", "max_native_zoom": 9, "resolution": "~375 m per pixel", "live": True,
     "attribution": ATTRIBUTION_NASA,
     "legend": [{"color": "#FA1E24", "label": "Flood"}, {"color": "#FFFF00", "label": "Recurring flood"}, {"color": "#32D2F5", "label": "Normal surface water"}, {"color": "#AFAFAF", "label": "Insufficient data (cloud)"}],
     "note": "Water detected by satellite over the last 2 days, updated daily. Area-level: it cannot show flooding on a single street."},
    {"id": "radar_water", "role": "overlay", "name": "Radar water (Sentinel-1)", "provider": "NASA OPERA DSWx-S1", "gibs": "OPERA_L3_Dynamic_Surface_Water_Extent-Sentinel-1",
     "ext": "png", "matrix": "GoogleMapsCompatible_Level12", "max_native_zoom": 12, "resolution": "30 m", "live": True,
     "attribution": ATTRIBUTION_NASA,
     "legend": [{"color": "#0000FF", "label": "Open water"}, {"color": "#B4D5F4", "label": "Partial surface water"}, {"color": "#AFAFAF", "label": "Cloud / no data"}],
     "note": "Surface water mapped from Sentinel-1 radar, which sees through cloud. Shown for the latest pass; satellites pass every few days, so it may be older than today."},
]

_state = {"dates": {}, "fetched_at": None, "error": None, "busy": False}
_lock = threading.Lock()


def parse_latest_dates(xml: str, layer_ids) -> dict:
    """{layer id: latest date} from a GIBS WMTS capabilities document (each layer's <Default> time)."""
    out = {}
    for lid in layer_ids:
        i = xml.find(f"<ows:Identifier>{lid}</ows:Identifier>")
        if i < 0:
            continue
        end = xml.find("</Layer>", i)
        m = re.search(r"<Default>([0-9]{4}-[0-9]{2}-[0-9]{2})", xml[i:end])
        if m:
            out[lid] = m.group(1)
    return out


def _refresh() -> None:
    try:
        r = httpx.get(CAPABILITIES, timeout=40.0)
        r.raise_for_status()
        dates = parse_latest_dates(r.text, [l["gibs"] for l in LAYERS if l.get("gibs")])
        with _lock:
            _state.update(dates=dates, fetched_at=time.time(), error=None)
    except Exception as e:  # keep serving the tiles; only the date labels are unknown
        logger.warning("GIBS capabilities unavailable: %s", e)
        with _lock:
            _state.update(error="NASA imagery catalogue unreachable; showing the latest available day without a date.", fetched_at=time.time())
    finally:
        with _lock:
            _state["busy"] = False


def _ensure_fresh() -> None:
    with _lock:
        stale = _state["fetched_at"] is None or time.time() - _state["fetched_at"] > REFRESH_S
        if not stale or _state["busy"]:
            return
        _state["busy"] = True
    threading.Thread(target=_refresh, daemon=True).start()  # never block a request on NASA


def catalogue() -> dict:
    _ensure_fresh()
    with _lock:
        dates, err, fetched = dict(_state["dates"]), _state["error"], _state["fetched_at"]
    layers = []
    for l in LAYERS:
        d = {k: v for k, v in l.items() if k not in ("gibs", "ext", "matrix")}
        if l.get("gibs"):
            d["url"] = f"{GIBS}/{l['gibs']}/default/default/{l['matrix']}/{{z}}/{{y}}/{{x}}.{l['ext']}"
            d["date"] = dates.get(l["gibs"])
        else:
            d["date"] = None
        layers.append(d)
    return {"layers": layers, "message": err, "catalogue_checked": bool(fetched and not err),
            "note": "Satellite imagery shows what a satellite saw on the date given; it is not a live video feed."}
