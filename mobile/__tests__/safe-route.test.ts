// The satellite flood layer and the route planner draw GeoJSON from the backend: polygons (with holes and multi-parts) must
// become map rings, and a plan must become the right map layers (selected route highlighted, others dashed, hazards, end points).
const { polygonRings, planLayers, ROUTE_COLOR, HAZARD_STYLE } = require('../src/components/geojson.js');

describe('polygonRings', () => {
  test('a polygon with a hole becomes [lat, lng] rings', () => {
    const g = { type: 'Polygon', coordinates: [[[77.5, 12.9], [77.6, 12.9], [77.6, 13.0], [77.5, 12.9]], [[77.55, 12.92], [77.56, 12.92], [77.56, 12.93], [77.55, 12.92]]] };
    const [p] = polygonRings(g);
    expect(p.outer[0]).toEqual([12.9, 77.5]);
    expect(p.holes).toHaveLength(1);
  });
  test('multipolygons give one entry per part; junk is dropped', () => {
    const tri = [[[77.5, 12.9], [77.6, 12.9], [77.6, 13.0], [77.5, 12.9]]];
    expect(polygonRings({ type: 'MultiPolygon', coordinates: [tri, tri] })).toHaveLength(2);
    expect(polygonRings({ type: 'Point', coordinates: [1, 2] })).toEqual([]);
    expect(polygonRings(null)).toEqual([]);
    expect(polygonRings({ type: 'Polygon', coordinates: [[[1, 2], [null, 3]]] })).toEqual([]);
  });
  test('every hazard kind from the backend has a style', () => {
    ['SATELLITE_INUNDATION', 'VERIFIED_REPORT', 'USER_REPORT', 'ROAD_CLOSURE', 'REPORTED_BLOCKED_ROAD', 'WEATHER_RISK_AREA'].forEach((k) => expect(HAZARD_STYLE[k].color).toMatch(/^#/));
  });
});

const route = (id: string, extra: object) => ({ route_id: id, geometry: [[12.9, 77.5], [12.95, 77.6]], label: 'Alternative', distance_km: 5, eta_minutes: 9, feasible: true, recommended: false, ...extra });
const plan = (routes: any[]) => ({
  routes, origin: { latitude: 12.9, longitude: 77.5, label: 'My location' }, destination: { latitude: 12.95, longitude: 77.6, label: 'Whitefield' },
  hazards: [{ hazard_id: 'report:1', kind: 'VERIFIED_REPORT', label: 'Flooded road', geometry: { type: 'Polygon', coordinates: [] } }],
});

describe('planLayers', () => {
  test('nothing to draw without a plan', () => {
    expect(planLayers({ plan: null })).toBeNull();
  });
  test('the recommended route is green and the others become tappable dashed options', () => {
    const rec = route('a', { recommended: true, label: 'Recommended' });
    const bad = route('b', { feasible: false, label: 'Crosses a flood hazard' });
    const out = planLayers({ plan: plan([rec, bad]), selected: rec });
    expect(out.routeColor).toBe(ROUTE_COLOR.recommended);
    expect(out.routeOptions).toEqual([expect.objectContaining({ id: 'b', affected: true })]);
    expect(out.hazardShapes[0]).toEqual(expect.objectContaining({ id: 'report:1', kind: 'VERIFIED_REPORT' }));
    expect(out.endpoints.map((e: any) => e.label)).toEqual(['Start: My location', 'Destination: Whitefield']);
  });
  test('a selected alternative is violet and a selected hazard route is red', () => {
    const rec = route('a', { recommended: true });
    const alt = route('c', {});
    const bad = route('b', { feasible: false });
    expect(planLayers({ plan: plan([rec, alt, bad]), selected: alt }).routeColor).toBe(ROUTE_COLOR.selected);
    expect(planLayers({ plan: plan([rec, alt, bad]), selected: bad }).routeColor).toBe(ROUTE_COLOR.affected);
  });
});
