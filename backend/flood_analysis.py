"""Satellite flood detection: Sentinel-1 radar change detection between a recent pass and earlier passes on the same orbit track.

Method (the widely used UN-SPIDER recommended practice for Sentinel-1 flood mapping, adapted):
  1. Pick the newest Sentinel-1 IW pass over the area ("after") and earlier passes from the SAME orbit track ("baseline",
     12-60 days earlier by default, or a pre-event window chosen by the admin). Different tracks look at the ground from
     different angles and cannot be compared pixel by pixel.
  2. VV backscatter in dB; speckle reduced with a 3 x 3 median filter (Planetary Computer) or a 50 m focal median (Earth
     Engine); the baseline is the median of its passes, which reduces speckle further.
  3. New water = the pixel is dark now (VV below FLOOD_WATER_DB), was not dark in the baseline, and became at least
     FLOOD_CHANGE_DB darker. Calm water reflects radar away from the satellite, so it looks dark.
  4. Masks: permanent water (JRC Global Surface Water, water 10+ months a year), slopes over FLOOD_MAX_SLOPE_DEG (radar
     shadow; water cannot pond there), pixels without valid data in both images.
  5. Spatial filtering: patches smaller than FLOOD_MIN_AREA_M2 are dropped (isolated dark pixels are mostly speckle).
  6. Areas in square kilometres from an equal-area projection (geo.py).

Limits that are reported, never hidden: radar misses flooding between buildings and under dense vegetation (and shadows
can look like water), a pass is hours to days old, and a long flood can already be in the baseline. A detection is
"potential newly inundated land", never an officially confirmed flood. No result is ever invented: when imagery is
missing, stale or insufficient the analysis ends with an explicit status instead.

Engines: Google Earth Engine (COPERNICUS/S1_GRD) when a service account is configured, otherwise Microsoft Planetary
Computer (sentinel-1-rtc, no key needed) with the same method run here in numpy.
"""
import asyncio
import base64
import io
import json
import logging
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from typing import List, Optional, Tuple

import httpx
import numpy as np
from shapely.geometry import box as shp_box
from shapely.geometry.base import BaseGeometry

import config
import db
import geo

logger = logging.getLogger(__name__)

QUEUED, RUNNING, COMPLETED = "QUEUED", "RUNNING", "COMPLETED"
INSUFFICIENT_DATA, UNAVAILABLE, FAILED = "INSUFFICIENT_DATA", "UNAVAILABLE", "FAILED"
FINAL = (COMPLETED, INSUFFICIENT_DATA, UNAVAILABLE, FAILED)
FLOOD_WATER_DB = -18.0  # VV darker than this is treated as open water (calm water is typically -18 to -25 dB)
DETECTION_LABEL = "Potential newly inundated land (satellite radar)"
MAX_BBOX_DEG = 0.6       # about 65 km: larger areas are refused (cost and request size)
MAX_FEATURES = 1500
LIMITATIONS = [
    "Radar often misses flooding between buildings and under dense vegetation, and radar shadows can look like water.",
    "A satellite pass is a snapshot: water may have risen or receded since it was taken.",
    "If flooding lasted longer than the baseline window, the baseline may already contain it and it will not show as new.",
    "This is a potential detection from satellite data, not an officially confirmed flood.",
]


class AnalysisStop(Exception):
    """Ends an analysis with an explicit, honest status (INSUFFICIENT_DATA or UNAVAILABLE) instead of a result."""

    def __init__(self, status: str, message: str):
        super().__init__(message)
        self.status, self.message = status, message


@dataclass
class Request:
    bbox: Tuple[float, float, float, float]  # west, south, east, north
    after_date: Optional[str] = None         # analyse the newest pass on or before this date (default: newest)
    baseline_start: Optional[str] = None     # optional pre-event window for the baseline (dates)
    baseline_end: Optional[str] = None


@dataclass
class RawResult:
    """What an engine returns before post-processing. Geometries are lon/lat."""
    engine: str
    source: str
    method: str
    after_scenes: List[str]
    after_acquired: str
    baseline_dates: List[str]
    flood: BaseGeometry
    permanent_water: Optional[BaseGeometry]
    valid_fraction: float
    pixel_size_m: float
    thresholds: dict
    warnings: List[str] = field(default_factory=list)
    urban_fraction: Optional[float] = None
    slope_masked_fraction: Optional[float] = None
    tile_url: Optional[str] = None


# ---------------------------------------------------------------------------------------------- shared processing
def median3(a: np.ndarray) -> np.ndarray:
    """3 x 3 median filter that ignores NaN (speckle reduction without SciPy)."""
    p = np.pad(a, 1, mode="edge")
    win = np.lib.stride_tricks.sliding_window_view(p, (3, 3))
    with np.errstate(all="ignore"), _quiet():
        return np.nanmedian(win.reshape(a.shape[0], a.shape[1], 9), axis=2)


class _quiet:
    def __enter__(self):
        import warnings
        self._w = warnings.catch_warnings()
        self._w.__enter__()
        warnings.simplefilter("ignore", RuntimeWarning)

    def __exit__(self, *a):
        self._w.__exit__(*a)


def to_db(linear: np.ndarray) -> np.ndarray:
    with np.errstate(all="ignore"):
        return 10.0 * np.log10(np.where(linear > 0, linear, np.nan))


def detect_new_water(after_db: np.ndarray, base_db: np.ndarray, slope_deg: Optional[np.ndarray] = None,
                     water_db: float = FLOOD_WATER_DB, change_db: Optional[float] = None, max_slope: Optional[float] = None) -> np.ndarray:
    """Boolean mask of new water: dark now, not dark before, and darker by at least change_db. NaN (no data) is never water."""
    change_db = config.FLOOD_CHANGE_DB if change_db is None else change_db
    max_slope = config.FLOOD_MAX_SLOPE_DEG if max_slope is None else max_slope
    with np.errstate(invalid="ignore"):
        m = (after_db < water_db) & (base_db >= water_db) & ((after_db - base_db) <= change_db)
        if slope_deg is not None:
            m &= ~(slope_deg > max_slope)
    return m & np.isfinite(after_db) & np.isfinite(base_db)


def mask_to_geometry(mask: np.ndarray, bbox: Tuple[float, float, float, float]) -> BaseGeometry:
    """Vectorise a boolean raster (north-up, covering bbox) into lon/lat polygons: runs of pixels per row become
    rectangles, then everything touching is merged."""
    w, s, e, n = bbox
    rows, cols = mask.shape
    dx, dy = (e - w) / cols, (n - s) / rows
    rects = []
    for r in range(rows):
        row = mask[r]
        if not row.any():
            continue
        padded = np.concatenate(([False], row, [False]))
        edges = np.flatnonzero(padded[1:] != padded[:-1])
        top, bottom = n - r * dy, n - (r + 1) * dy  # computed the same way for neighbouring rows, so they share edges exactly
        for c0, c1 in zip(edges[::2], edges[1::2]):
            rects.append(shp_box(w + c0 * dx, bottom, w + c1 * dx, top))
    return geo.union(rects) if rects else geo.union([])


def postprocess(flood: BaseGeometry, aoi: BaseGeometry, permanent_water: Optional[BaseGeometry] = None,
                min_area_m2: Optional[float] = None, simplify_m: float = 0.0) -> dict:
    """Clip to the area, remove permanent water, drop patches below the minimum area, simplify, and measure. Returns
    {"features": [...GeoJSON features...], "flooded_km2", "dropped_small", "permanent_water_km2"}."""
    min_area_m2 = config.FLOOD_MIN_AREA_M2 if min_area_m2 is None else min_area_m2
    c = aoi.centroid
    proj = geo.projection_for(c.y, c.x)
    g = flood.intersection(aoi) if not flood.is_empty else flood
    perm_km2 = 0.0
    if permanent_water is not None and not permanent_water.is_empty:
        perm = permanent_water.intersection(aoi)
        perm_km2 = proj.to_m(perm).area / 1e6
        g = g.difference(perm)
    features, dropped, total = [], 0, 0.0
    parts = sorted(geo.polygons_of(proj.to_m(g)), key=lambda p: -p.area)
    for poly in parts:
        if poly.area < min_area_m2:
            dropped += 1
            continue
        if simplify_m:
            poly = poly.simplify(simplify_m, preserve_topology=True)
        total += poly.area
        if len(features) < MAX_FEATURES:
            features.append({"type": "Feature", "geometry": geo.to_geojson(proj.to_lonlat(poly)),
                             "properties": {"id": f"sat-{len(features) + 1}", "area_km2": round(poly.area / 1e6, 4),
                                            "kind": "SATELLITE_DETECTED_INUNDATION", "label": DETECTION_LABEL}})
    return {"features": features, "flooded_km2": round(total / 1e6, 3), "dropped_small": dropped,
            "permanent_water_km2": round(perm_km2, 3), "truncated": len(parts) - dropped > len(features)}


def quality(raw: RawResult, baseline_count: int, age_days: float) -> dict:
    """Plain data-quality indicators, and an overall LOW/MODERATE grade. Never HIGH: this is a single-sensor threshold method
    that has not been validated against ground truth here."""
    reasons = []
    if baseline_count < 2:
        reasons.append("only one baseline pass")
    if raw.valid_fraction < 0.8:
        reasons.append(f"only {round(raw.valid_fraction * 100)}% of the area had valid radar data")
    if raw.urban_fraction is not None and raw.urban_fraction >= 0.4:
        reasons.append(f"{round(raw.urban_fraction * 100)}% of the area is built-up")
    if raw.permanent_water is None:
        reasons.append("permanent-water mask unavailable")
    if age_days > config.FLOOD_ANALYSIS_STALE_DAYS:
        reasons.append(f"the satellite pass is {round(age_days)} days old")
    return {"grade": "LOW" if reasons else "MODERATE", "reasons": reasons, "baseline_passes": baseline_count,
            "valid_data_fraction": round(raw.valid_fraction, 3), "pixel_size_m": round(raw.pixel_size_m, 1),
            "built_up_fraction": round(raw.urban_fraction, 3) if raw.urban_fraction is not None else None,
            "slope_masked_fraction": round(raw.slope_masked_fraction, 3) if raw.slope_masked_fraction is not None else None,
            "note": "Data-quality grade of the inputs, not a measured accuracy."}


# ------------------------------------------------------------------------------------- Planetary Computer engine
PC_S1 = "sentinel-1-rtc"


async def _http(method: str, url: str, **kw) -> httpx.Response:
    """Single choke point for HTTP so tests can replace it."""
    async with httpx.AsyncClient(timeout=90.0, headers={"User-Agent": "RiskN-ResQ/1.0"}) as client:
        r = await client.request(method, url, **kw)
        r.raise_for_status()
        return r


def _grid(bbox) -> Tuple[int, int]:
    w, s, e, n = bbox
    lat = (s + n) / 2
    cols = config.FLOOD_ANALYSIS_PIXELS
    rows = max(16, int(round(cols * (n - s) / ((e - w) * np.cos(np.radians(lat))))))
    return cols, min(rows, 1400)


class PlanetaryEngine:
    name = "planetary"
    source = "Sentinel-1 RTC (Microsoft Planetary Computer)"

    def configured(self) -> bool:
        return True

    async def search(self, collection: str, bbox, start: str, end: str, limit: int = 100) -> list:
        body = {"collections": [collection], "bbox": list(bbox), "limit": limit, "datetime": f"{start}/{end}",
                "sortby": [{"field": "datetime", "direction": "desc"}]}
        r = await _http("POST", f"{config.PLANETARY_COMPUTER_URL}/stac/v1/search", json=body)
        return r.json().get("features", [])

    async def array(self, collection: str, item: str, asset: str, bbox, size) -> Tuple[np.ndarray, np.ndarray]:
        """(values, valid) for one asset of one item resampled to the analysis grid (EPSG:4326, north-up)."""
        w, s, e, n = bbox
        url = f"{config.PLANETARY_COMPUTER_URL}/data/v1/item/bbox/{w},{s},{e},{n}/{size[0]}x{size[1]}.npy"
        r = await _http("GET", url, params={"collection": collection, "item": item, "assets": asset})
        a = np.load(io.BytesIO(r.content), allow_pickle=False)
        return a[0].astype("float32"), a[-1] > 0

    async def composite(self, collection: str, items: List[str], asset: str, bbox, size) -> Tuple[np.ndarray, np.ndarray]:
        """Several items (adjacent frames / tiles) merged: the first valid value per pixel."""
        out = np.full((size[1], size[0]), np.nan, dtype="float32")
        for it in items:
            v, ok = await self.array(collection, it, asset, bbox, size)
            fill = ok & np.isnan(out)
            out[fill] = v[fill]
        return out, np.isfinite(out)

    async def run(self, req: Request) -> RawResult:
        bbox = req.bbox
        size = _grid(bbox)
        end = (datetime.fromisoformat(req.after_date) + timedelta(days=1)).strftime("%Y-%m-%dT00:00:00Z") if req.after_date \
            else datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        start = (datetime.fromisoformat(end[:10]) - timedelta(days=150)).strftime("%Y-%m-%dT00:00:00Z")
        try:
            feats = await self.search(PC_S1, bbox, start, end)
        except Exception as exc:
            raise AnalysisStop(UNAVAILABLE, f"Sentinel-1 scene search failed ({type(exc).__name__}).") from exc
        passes = {}  # (date, orbit_state, relative_orbit) -> [item ids]
        for f in feats:
            p = f.get("properties", {})
            key = (p.get("datetime", "")[:10], p.get("sat:orbit_state"), p.get("sat:relative_orbit"))
            passes.setdefault(key, []).append(f["id"])
        if not passes:
            raise AnalysisStop(INSUFFICIENT_DATA, "No Sentinel-1 pass covers this area in the last 150 days.")
        after_key = max(passes, key=lambda k: k[0])
        after_day = date.fromisoformat(after_key[0])
        if req.baseline_start and req.baseline_end:
            lo, hi = date.fromisoformat(req.baseline_start), date.fromisoformat(req.baseline_end)
            if hi >= after_day:
                raise AnalysisStop(INSUFFICIENT_DATA, "The baseline window must end before the analysed pass.")
            if lo < after_day - timedelta(days=150):
                base_feats = await self.search(PC_S1, bbox, f"{lo}T00:00:00Z", f"{hi}T23:59:59Z")
                for f in base_feats:
                    p = f.get("properties", {})
                    passes.setdefault((p.get("datetime", "")[:10], p.get("sat:orbit_state"), p.get("sat:relative_orbit")), []).append(f["id"])
        else:
            lo, hi = after_day - timedelta(days=60), after_day - timedelta(days=10)
        base_keys = sorted([k for k in passes if k[1:] == after_key[1:] and lo <= date.fromisoformat(k[0]) <= hi], key=lambda k: k[0], reverse=True)[:3]
        if not base_keys:
            raise AnalysisStop(INSUFFICIENT_DATA, f"No earlier Sentinel-1 pass on the same orbit track between {lo} and {hi} to compare with.")

        warnings = []
        try:
            after, after_ok = await self.composite(PC_S1, sorted(set(passes[after_key])), "vv", bbox, size)
            stack = []
            for k in base_keys:
                v, _ = await self.composite(PC_S1, sorted(set(passes[k])), "vv", bbox, size)
                stack.append(v)
        except Exception as exc:
            raise AnalysisStop(UNAVAILABLE, f"Sentinel-1 imagery could not be read ({type(exc).__name__}).") from exc
        valid_fraction = float(after_ok.mean())
        if valid_fraction < 0.2:
            raise AnalysisStop(INSUFFICIENT_DATA, f"The newest pass covers only {round(valid_fraction * 100)}% of the area.")

        slope, slope_frac = None, None
        try:
            dem_items = [f["id"] for f in await self.search("cop-dem-glo-30", bbox, "2000-01-01T00:00:00Z", "2100-01-01T00:00:00Z", 10)]
            dem, _ = await self.composite("cop-dem-glo-30", dem_items, "data", bbox, size)
            px = (bbox[2] - bbox[0]) * 111320 * np.cos(np.radians((bbox[1] + bbox[3]) / 2)) / size[0]
            py = (bbox[3] - bbox[1]) * 110540 / size[1]
            gy, gx = np.gradient(dem, py, px)
            slope = np.degrees(np.arctan(np.hypot(gx, gy)))
            slope_frac = float(np.nanmean(slope > config.FLOOD_MAX_SLOPE_DEG))
        except Exception as exc:
            warnings.append(f"Slope mask unavailable ({type(exc).__name__}); steep-ground shadows were not removed.")

        permanent = None
        try:
            jrc_items = [f["id"] for f in await self.search("jrc-gsw", bbox, "1984-01-01T00:00:00Z", "2100-01-01T00:00:00Z", 10)]
            seas, seas_ok = await self.composite("jrc-gsw", jrc_items, "seasonality", bbox, size)
            permanent = mask_to_geometry(seas_ok & (seas >= 10) & (seas <= 12), bbox)
        except Exception as exc:
            warnings.append(f"Permanent-water mask unavailable ({type(exc).__name__}); lakes and rivers were not removed.")

        urban = None
        try:
            wc = [f for f in await self.search("esa-worldcover", bbox, "2020-01-01T00:00:00Z", "2100-01-01T00:00:00Z", 10)]
            newest = max((f["properties"].get("datetime") or f["properties"].get("start_datetime") or "") for f in wc) if wc else ""
            wc_items = [f["id"] for f in wc if (f["properties"].get("datetime") or f["properties"].get("start_datetime") or "") == newest]
            lc, lc_ok = await self.composite("esa-worldcover", wc_items, "map", bbox, size)
            urban = float(np.mean(lc[lc_ok] == 50)) if lc_ok.any() else None
        except Exception as exc:
            warnings.append(f"Land-cover data unavailable ({type(exc).__name__}); the built-up share is unknown.")
        if urban is not None and urban >= 0.25:
            warnings.append(f"{round(urban * 100)}% of the area is built-up: radar can miss flooded streets between buildings.")

        def compute():
            with _quiet():
                base_lin = np.nanmedian(np.stack(stack), axis=0)
            return detect_new_water(median3(to_db(after)), median3(to_db(base_lin)), slope)

        mask = await asyncio.to_thread(compute)
        flood = await asyncio.to_thread(mask_to_geometry, mask, bbox)
        px_m = (bbox[2] - bbox[0]) * 111320 * np.cos(np.radians((bbox[1] + bbox[3]) / 2)) / size[0]
        return RawResult(
            engine=self.name, source=self.source, method="Sentinel-1 VV change detection (3x3 median speckle filter, median baseline)",
            after_scenes=sorted(set(passes[after_key])), after_acquired=next(f["properties"]["datetime"] for f in feats if f["id"] in passes[after_key]),
            baseline_dates=[k[0] for k in base_keys], flood=flood, permanent_water=permanent, valid_fraction=valid_fraction,
            pixel_size_m=float(px_m), thresholds={"water_db": FLOOD_WATER_DB, "change_db": config.FLOOD_CHANGE_DB,
                                                  "max_slope_deg": config.FLOOD_MAX_SLOPE_DEG, "min_area_m2": config.FLOOD_MIN_AREA_M2},
            warnings=warnings, urban_fraction=urban, slope_masked_fraction=slope_frac)


# ------------------------------------------------------------------------------------------ Earth Engine engine
def gee_credentials() -> Optional[dict]:
    """The service-account key from GEE_SERVICE_ACCOUNT_JSON (raw JSON or base64 of it), or None when not configured."""
    raw = config.GEE_SERVICE_ACCOUNT_JSON
    if not raw:
        return None
    try:
        text = raw if raw.lstrip().startswith("{") else base64.b64decode(raw).decode()
        data = json.loads(text)
        return data if data.get("client_email") and data.get("private_key") else None
    except Exception:
        return None


class EarthEngineEngine:
    name = "earth-engine"
    source = "Sentinel-1 GRD (Google Earth Engine, COPERNICUS/S1_GRD)"

    def configured(self) -> bool:
        return gee_credentials() is not None and bool(config.GEE_PROJECT)

    def _init(self):
        import ee  # imported lazily: only needed when Earth Engine is configured
        creds = gee_credentials()
        ee.Initialize(ee.ServiceAccountCredentials(creds["client_email"], key_data=json.dumps(creds)), project=config.GEE_PROJECT)
        return ee

    def _compute(self, req: Request) -> RawResult:
        ee = self._init()
        w, s, e, n = req.bbox
        aoi = ee.Geometry.Rectangle([w, s, e, n], None, False)
        end = ee.Date(req.after_date).advance(1, "day") if req.after_date else ee.Date(datetime.now(timezone.utc).isoformat())
        s1 = (ee.ImageCollection("COPERNICUS/S1_GRD").filterBounds(aoi).filter(ee.Filter.eq("instrumentMode", "IW"))
              .filter(ee.Filter.listContains("transmitterReceiverPolarisation", "VV")).select("VV"))
        latest = s1.filterDate(end.advance(-60, "day"), end).sort("system:time_start", False).first()
        if latest is None or not s1.filterDate(end.advance(-60, "day"), end).size().getInfo():
            raise AnalysisStop(INSUFFICIENT_DATA, "No Sentinel-1 pass covers this area in the last 60 days.")
        info = latest.toDictionary(["orbitProperties_pass", "relativeOrbitNumber_start"]).getInfo()
        t_after = ee.Date(latest.get("system:time_start"))
        track = s1.filter(ee.Filter.eq("orbitProperties_pass", info.get("orbitProperties_pass"))) \
                  .filter(ee.Filter.eq("relativeOrbitNumber_start", info.get("relativeOrbitNumber_start")))
        after_col = track.filterDate(t_after.advance(-1, "hour"), t_after.advance(1, "hour"))
        if req.baseline_start and req.baseline_end:
            base_col = track.filterDate(req.baseline_start, ee.Date(req.baseline_end).advance(1, "day"))
        else:
            base_col = track.filterDate(t_after.advance(-60, "day"), t_after.advance(-10, "day"))
        base_dates = base_col.aggregate_array("system:time_start").getInfo() or []
        if not base_dates:
            raise AnalysisStop(INSUFFICIENT_DATA, "No earlier Sentinel-1 pass on the same orbit track to compare with.")
        after = after_col.mosaic().focal_median(50, "circle", "meters").clip(aoi)
        before = base_col.median().focal_median(50, "circle", "meters").clip(aoi)
        change = after.subtract(before)
        flood = change.lt(config.FLOOD_CHANGE_DB).And(after.lt(FLOOD_WATER_DB)).And(before.gte(FLOOD_WATER_DB))
        permanent = ee.Image("JRC/GSW1_4/GlobalSurfaceWater").select("seasonality").gte(10)
        flood = flood.where(permanent, 0)
        slope = ee.Terrain.slope(ee.Image("WWF/HydroSHEDS/03VFDEM"))
        flood = flood.updateMask(slope.lt(config.FLOOD_MAX_SLOPE_DEG))
        flood = flood.updateMask(flood.connectedPixelCount(25).gte(8)).selfMask()
        vectors = flood.reduceToVectors(geometry=aoi, scale=30, geometryType="polygon", eightConnected=False, maxPixels=1e10, bestEffort=True)
        fc = vectors.limit(5000).getInfo()
        perm_fc = permanent.selfMask().clip(aoi).reduceToVectors(geometry=aoi, scale=60, maxPixels=1e10, bestEffort=True).limit(3000).getInfo()
        stats = ee.Dictionary({
            "valid": after.mask().reduceRegion(ee.Reducer.mean(), aoi, 100, bestEffort=True).get("VV"),
            "urban": ee.ImageCollection("ESA/WorldCover/v200").first().eq(50).reduceRegion(ee.Reducer.mean(), aoi, 100, bestEffort=True).get("Map"),
            "slope": slope.gte(config.FLOOD_MAX_SLOPE_DEG).reduceRegion(ee.Reducer.mean(), aoi, 100, bestEffort=True).get("b1"),
            "after": after_col.aggregate_array("system:index"),
            "acquired": t_after.format("YYYY-MM-dd'T'HH:mm:ss'Z'"),
        }).getInfo()
        tile = None
        try:
            tile = flood.getMapId({"palette": ["1d4ed8"]})["tile_fetcher"].url_format
        except Exception:
            pass
        shapes = [geo.from_geojson(f["geometry"]) for f in fc.get("features", [])]
        perm = [geo.from_geojson(f["geometry"]) for f in perm_fc.get("features", [])]
        urban = stats.get("urban")
        warnings = [f"{round(urban * 100)}% of the area is built-up: radar can miss flooded streets between buildings."] if urban and urban >= 0.25 else []
        return RawResult(
            engine=self.name, source=self.source, method="Sentinel-1 VV change detection (50 m focal median speckle filter, median baseline)",
            after_scenes=stats.get("after") or [], after_acquired=stats.get("acquired"),
            baseline_dates=sorted({datetime.fromtimestamp(t / 1000, timezone.utc).date().isoformat() for t in base_dates}, reverse=True),
            flood=geo.union(shapes), permanent_water=geo.union(perm), valid_fraction=float(stats.get("valid") or 0), pixel_size_m=30.0,
            thresholds={"water_db": FLOOD_WATER_DB, "change_db": config.FLOOD_CHANGE_DB, "max_slope_deg": config.FLOOD_MAX_SLOPE_DEG,
                        "min_area_m2": config.FLOOD_MIN_AREA_M2},
            warnings=warnings, urban_fraction=urban, slope_masked_fraction=stats.get("slope"), tile_url=tile)

    async def run(self, req: Request) -> RawResult:
        try:
            return await asyncio.to_thread(self._compute, req)
        except AnalysisStop:
            raise
        except Exception as exc:
            raise AnalysisStop(UNAVAILABLE, f"Google Earth Engine request failed ({type(exc).__name__}).") from exc


def pick_engine():
    """The engine to use, per FLOOD_ANALYSIS_ENGINE (auto = Earth Engine when configured, else Planetary Computer)."""
    gee = EarthEngineEngine()
    choice = config.FLOOD_ANALYSIS_ENGINE
    if choice in ("gee", "earth-engine", "earthengine"):
        return gee
    if choice == "planetary":
        return PlanetaryEngine()
    return gee if gee.configured() else PlanetaryEngine()


def engine_status() -> dict:
    gee = EarthEngineEngine()
    eng = pick_engine()
    return {"selected": eng.name, "earth_engine_configured": gee.configured(),
            "earth_engine_setup": None if gee.configured() else "Set GEE_SERVICE_ACCOUNT_JSON and GEE_PROJECT (see README_REAL_DATA.md).",
            "planetary_computer": "Keyless public access to Sentinel-1 RTC."}


# ----------------------------------------------------------------------------------------------- jobs and storage
def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def validate_bbox(bbox) -> Tuple[float, float, float, float]:
    w, s, e, n = (float(v) for v in bbox)
    if not (-180 <= w < e <= 180 and -90 <= s < n <= 90):
        raise ValueError("bbox must be west,south,east,north with west < east and south < north")
    if e - w > MAX_BBOX_DEG or n - s > MAX_BBOX_DEG:
        raise ValueError(f"bbox is too large (at most {MAX_BBOX_DEG} degrees on each side)")
    return (w, s, e, n)


def default_bbox() -> Tuple[float, float, float, float]:
    s, w, n, e = config.MONITORING_BOUNDS
    return (w, s, e, n)


class Busy(Exception):
    pass


def create(c, req: Request, user_id: Optional[int], trigger: str) -> int:
    running = c.execute("SELECT id, created_at FROM flood_analyses WHERE status IN (?, ?) ORDER BY id DESC", (QUEUED, RUNNING)).fetchall()
    for r in running:
        if datetime.fromisoformat(r["created_at"]) > datetime.now(timezone.utc) - timedelta(minutes=20):
            raise Busy(int(r["id"]))
        c.execute("UPDATE flood_analyses SET status=?, error=?, finished_at=? WHERE id=?", (FAILED, "Timed out", _now(), r["id"]))
    params = {"after_date": req.after_date, "baseline_start": req.baseline_start, "baseline_end": req.baseline_end}
    cur = c.execute("INSERT INTO flood_analyses(status, bbox, params, requested_by, triggered_by, created_at) VALUES(?,?,?,?,?,?)",
                    (QUEUED, json.dumps(list(req.bbox)), json.dumps(params), user_id, trigger, _now()))
    return int(cur.lastrowid)


def recent_same(c, req: Request, hours: float = 6.0) -> Optional[int]:
    """A completed analysis of the same area and settings from the last few hours (re-running would give the same answer)."""
    params = json.dumps({"after_date": req.after_date, "baseline_start": req.baseline_start, "baseline_end": req.baseline_end})
    since = (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat(timespec="seconds")
    r = c.execute("SELECT id FROM flood_analyses WHERE status=? AND bbox=? AND params=? AND finished_at>=? ORDER BY id DESC LIMIT 1",
                  (COMPLETED, json.dumps(list(req.bbox)), params, since)).fetchone()
    return int(r["id"]) if r else None


async def execute(analysis_id: int, engine=None) -> None:
    """Runs one analysis and stores its outcome. Never raises: every failure becomes a stored status."""
    with db.session() as c:
        row = c.execute("SELECT * FROM flood_analyses WHERE id=?", (analysis_id,)).fetchone()
        if not row:
            return
        params = json.loads(row["params"] or "{}")
        req = Request(bbox=tuple(json.loads(row["bbox"])), **params)
        engine = engine or pick_engine()
        c.execute("UPDATE flood_analyses SET status=?, engine=?, started_at=? WHERE id=?", (RUNNING, engine.name, _now(), analysis_id))
    try:
        raw = await engine.run(req)
        aoi = geo.bbox_polygon(*req.bbox)
        out = await asyncio.to_thread(postprocess, raw.flood, aoi, raw.permanent_water, None, raw.pixel_size_m / 3)
        acquired = datetime.fromisoformat(raw.after_acquired.replace("Z", "+00:00"))
        age_days = (datetime.now(timezone.utc) - acquired).total_seconds() / 86400
        q = quality(raw, len(raw.baseline_dates), age_days)
        warnings = list(raw.warnings)
        if out["truncated"]:
            warnings.append(f"Only the {MAX_FEATURES} largest flood patches are included.")
        with db.session() as c:
            c.execute("UPDATE flood_analyses SET status=?, finished_at=?, after_scene=?, acquired_at=?, baseline_dates=?, flooded_km2=?, analysed_km2=?, "
                      "polygons=?, quality=?, warnings=?, method=?, source=?, tile_url=?, error=NULL WHERE id=?",
                      (COMPLETED, _now(), json.dumps(raw.after_scenes), raw.after_acquired, json.dumps(raw.baseline_dates), out["flooded_km2"],
                       round(geo.area_km2(aoi), 2), json.dumps({"type": "FeatureCollection", "features": out["features"]}),
                       json.dumps({**q, "permanent_water_km2": out["permanent_water_km2"], "small_patches_dropped": out["dropped_small"], "thresholds": raw.thresholds}),
                       json.dumps(warnings), raw.method, raw.source, raw.tile_url, analysis_id))
    except AnalysisStop as stop:
        _finish(analysis_id, stop.status, stop.message)
    except Exception as exc:  # unexpected: stored, logged, never shown as a result
        logger.exception("flood analysis %s failed", analysis_id)
        _finish(analysis_id, FAILED, f"Analysis failed ({type(exc).__name__}).")


def _finish(analysis_id: int, status: str, message: str) -> None:
    with db.session() as c:
        c.execute("UPDATE flood_analyses SET status=?, finished_at=?, error=? WHERE id=?", (status, _now(), message, analysis_id))


def status_dict(row) -> dict:
    r = dict(row)
    acquired = r.get("acquired_at")
    age_h = None
    if acquired:
        age_h = round((datetime.now(timezone.utc) - datetime.fromisoformat(acquired.replace("Z", "+00:00"))).total_seconds() / 3600, 1)
    return {"analysis_id": r["id"], "status": r["status"], "engine": r.get("engine"), "bbox": json.loads(r["bbox"]),
            "requested_at": r["created_at"], "started_at": r.get("started_at"), "analysis_timestamp": r.get("finished_at"),
            "message": r.get("error"), "acquired_at": acquired, "age_hours": age_h,
            "stale": age_h is not None and age_h > config.FLOOD_ANALYSIS_STALE_DAYS * 24}


def result_dict(row) -> dict:
    r = dict(row)
    out = status_dict(row)
    if r["status"] != COMPLETED:
        return {**out, "features": None}
    q = json.loads(r.get("quality") or "{}")
    warnings = json.loads(r.get("warnings") or "[]")
    if out["stale"]:
        warnings = [f"This satellite pass is {round(out['age_hours'] / 24)} days old: conditions have likely changed."] + warnings
    return {**out, "after_scenes": json.loads(r.get("after_scene") or "[]"), "baseline_dates": json.loads(r.get("baseline_dates") or "[]"),
            "baseline_observation_date": (json.loads(r.get("baseline_dates") or "[]") or [None])[0],
            "satellite_acquisition_date": r.get("acquired_at"), "area_analysed_km2": r.get("analysed_km2"),
            "newly_inundated_km2": r.get("flooded_km2"), "detection_method": r.get("method"), "data_source": r.get("source"),
            "quality": q, "warnings": warnings, "limitations": LIMITATIONS, "tile_url": r.get("tile_url"),
            "label": DETECTION_LABEL, "official": False, "live": False,
            "geojson": json.loads(r.get("polygons") or '{"type":"FeatureCollection","features":[]}')}


def latest_completed(c) -> Optional[dict]:
    row = c.execute("SELECT * FROM flood_analyses WHERE status=? ORDER BY acquired_at DESC, id DESC LIMIT 1", (COMPLETED,)).fetchone()
    return row


async def auto_analyse(engine=None) -> Optional[int]:
    """Analyse the monitored area once per new satellite pass (called by the background scheduler, never per user request)."""
    if not config.FLOOD_AUTO_ANALYSIS:
        return None
    with db.session() as c:
        newest = c.execute("SELECT MAX(acquired_at) AS t FROM satellite_scenes WHERE kind='SAR'").fetchone()
        last = c.execute("SELECT MAX(acquired_at) AS t FROM flood_analyses WHERE status IN (?, ?)", (COMPLETED, INSUFFICIENT_DATA)).fetchone()
        tried = c.execute("SELECT MAX(created_at) AS t FROM flood_analyses WHERE triggered_by='auto'").fetchone()
        if newest is None or not newest["t"]:
            return None
        if last and last["t"] and last["t"][:16] >= newest["t"][:16]:
            return None
        if tried and tried["t"] and datetime.fromisoformat(tried["t"]) > datetime.now(timezone.utc) - timedelta(hours=6):
            return None  # an automatic attempt in the last 6 h (successful or not): do not hammer the imagery service
        try:
            aid = create(c, Request(bbox=default_bbox()), None, "auto")
        except Busy:
            return None
    await execute(aid, engine)
    return aid
