"""Geometry in metres. Coordinates arrive as WGS84 longitude/latitude (EPSG:4326); lengths, buffers and areas are computed
after projecting to a Lambert azimuthal equal-area projection centred on the area of interest, so a square kilometre is a
real square kilometre and a 30 m buffer is 30 m on the ground (distance error is negligible at city scale)."""
from functools import lru_cache
from typing import Iterable, List, Sequence

import numpy as np
import shapely
from pyproj import Transformer
from shapely import ops
from shapely.geometry import LineString, Point, Polygon, mapping, shape
from shapely.geometry.base import BaseGeometry


@lru_cache(maxsize=32)
def _transformers(lat0: float, lon0: float):
    crs = f"+proj=laea +lat_0={lat0} +lon_0={lon0} +x_0=0 +y_0=0 +ellps=WGS84 +units=m +no_defs"
    return (Transformer.from_crs("EPSG:4326", crs, always_xy=True), Transformer.from_crs(crs, "EPSG:4326", always_xy=True))


class LocalProjection:
    """Projects lon/lat geometries to metres around (lat0, lon0) and back."""

    def __init__(self, lat0: float, lon0: float):
        self.lat0, self.lon0 = round(lat0, 3), round(lon0, 3)
        self._fwd, self._inv = _transformers(self.lat0, self.lon0)

    @staticmethod
    def _apply(t, geom):
        return shapely.transform(geom, lambda xy: np.column_stack(t.transform(xy[:, 0], xy[:, 1])))

    def to_m(self, geom: BaseGeometry) -> BaseGeometry:
        return self._apply(self._fwd, geom)

    def to_lonlat(self, geom: BaseGeometry) -> BaseGeometry:
        return self._apply(self._inv, geom)


def projection_for(lat: float, lon: float) -> LocalProjection:
    return LocalProjection(lat, lon)


def line_from_latlng(points: Sequence[Sequence[float]]) -> LineString:
    """The app's polylines are [[lat, lng], ...]; shapely uses (x=lng, y=lat)."""
    return LineString([(p[1], p[0]) for p in points])


def area_km2(geom_lonlat: BaseGeometry) -> float:
    if geom_lonlat.is_empty:
        return 0.0
    c = geom_lonlat.centroid
    return projection_for(c.y, c.x).to_m(geom_lonlat).area / 1e6


def circle(lat: float, lng: float, radius_m: float, proj: LocalProjection) -> BaseGeometry:
    """A circle of radius_m around a point, returned in the projection's metres."""
    return proj.to_m(Point(lng, lat)).buffer(radius_m, 24)


def to_geojson(geom_lonlat: BaseGeometry, decimals: int = 6) -> dict:
    """GeoJSON geometry with rounded coordinates (smaller responses; 6 decimals is ~0.1 m)."""
    def rnd(x):
        if isinstance(x, (list, tuple)):
            if x and isinstance(x[0], (int, float)):
                return [round(v, decimals) for v in x]
            return [rnd(v) for v in x]
        return x
    g = mapping(geom_lonlat)
    return {"type": g["type"], "coordinates": rnd(g["coordinates"])}


def from_geojson(g: dict) -> BaseGeometry:
    return shape(g)


def polygons_of(geom: BaseGeometry) -> List[Polygon]:
    if geom.is_empty:
        return []
    if geom.geom_type == "Polygon":
        return [geom]
    if hasattr(geom, "geoms"):
        return [p for g in geom.geoms for p in polygons_of(g)]
    return []


def bbox_polygon(west: float, south: float, east: float, north: float) -> Polygon:
    return Polygon([(west, south), (east, south), (east, north), (west, north)])


def union(geoms: Iterable[BaseGeometry]) -> BaseGeometry:
    return ops.unary_union(list(geoms))
