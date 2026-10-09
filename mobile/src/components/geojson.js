// GeoJSON (lon/lat) polygons as [lat, lng] rings for the maps. Returns [{ outer: [[lat, lng], ...], holes: [[[lat, lng], ...]] }].
const ring = (r) => (Array.isArray(r) ? r.filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])).map((p) => [p[1], p[0]]) : []);

export function polygonRings(geometry) {
  if (!geometry || !Array.isArray(geometry.coordinates)) return [];
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.type === 'MultiPolygon' ? geometry.coordinates : [];
  return polys.map((p) => ({ outer: ring(p[0]), holes: p.slice(1).map(ring).filter((h) => h.length > 2) })).filter((p) => p.outer.length > 2);
}

// how each kind of hazard is drawn (shared by both maps and the legend)
export const HAZARD_STYLE = {
  SATELLITE_INUNDATION: { color: '#1D4ED8', fill: 0.45, label: 'Satellite: potential new water' },
  VERIFIED_REPORT: { color: '#B91C1C', fill: 0.3, label: 'Verified flood / blocked-road report' },
  USER_REPORT: { color: '#EF4444', fill: 0.22, label: 'Recent community report' },
  ROAD_CLOSURE: { color: '#7F1D1D', fill: 0.5, label: 'Road closure' },
  REPORTED_BLOCKED_ROAD: { color: '#DC2626', fill: 0.35, label: 'Reported blocked road' },
  WEATHER_RISK_AREA: { color: '#F59E0B', fill: 0.1, dashed: true, label: 'High flood-risk area (weather-based)' },
};

export const ROUTE_COLOR = { recommended: '#059669', selected: '#7C3AED', affected: '#DC2626', other: '#64748B' };

// map drawing for the current plan: every route (selected one highlighted), hazards and the two end points
export function planLayers(sr) {
  if (!sr.plan || !sr.plan.routes) return null;
  const sel = sr.selected;
  const color = !sel ? ROUTE_COLOR.other : !sel.feasible ? ROUTE_COLOR.affected : sel.recommended ? ROUTE_COLOR.recommended : ROUTE_COLOR.selected;
  return {
    routeLine: sel ? sel.geometry : undefined,
    routeColor: color,
    routeOptions: sr.plan.routes.filter((r) => !sel || r.route_id !== sel.route_id).map((r) => ({ id: r.route_id, points: r.geometry, affected: !r.feasible, label: `${r.label}: ${r.distance_km} km, ${r.eta_minutes} min` })),
    hazardShapes: (sr.plan.hazards || []).map((h) => ({ id: h.hazard_id, kind: h.kind, geometry: h.geometry, label: h.label })),
    endpoints: [
      { id: 'sr-origin', latitude: sr.plan.origin.latitude, longitude: sr.plan.origin.longitude, label: `Start: ${sr.plan.origin.label || 'origin'}`, color: '#0F172A' },
      { id: 'sr-dest', latitude: sr.plan.destination.latitude, longitude: sr.plan.destination.longitude, label: `Destination: ${sr.plan.destination.label || 'selected place'}`, color: '#7C3AED', highlight: true },
    ],
  };
}
