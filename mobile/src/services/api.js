// API service layer. Every call tries the live backend first and silently falls
// back to centralised mock data (mockData.js) when it is unreachable.
import { API_BASE_URL, FORCE_MOCK, REQUEST_TIMEOUT_MS, FLOOD_RAINFALL_MM, NORMAL_RAINFALL_MM } from '../config/api';
import { USER, routeInfo } from './geo';
import { matchBackendVolunteers } from '../integration/volunteerAdapter';
import * as mock from './mockData';
import { getToken, notifyUnauthorized } from './session';

let source = 'demo'; // 'live' | 'demo' — what the last call actually used
export const getSource = () => source;

export async function http(path, options = {}) {
  if (FORCE_MOCK) throw new Error('mock mode');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const token = getToken();
  try {
    const res = await fetch(API_BASE_URL + path, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });
    if (!res.ok) {
      let detail = null;
      try { const b = await res.json(); detail = typeof b.detail === 'string' ? b.detail : null; } catch (e) { /* not JSON */ }
      const err = new Error(detail || `Request failed (${res.status})`);
      err.status = res.status;
      err.detail = detail;
      if (res.status === 401 && token && !path.startsWith('/auth/login')) notifyUnauthorized();
      throw err;
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// Demo data is used ONLY when the server cannot be reached. A real HTTP error (validation, permission,
// expired login) is never turned into a fake success: it is re-thrown for the screen to show.
async function withFallback(live, fallback) {
  try {
    const data = await live();
    source = 'live';
    return data;
  } catch (e) {
    if (e && e.status) throw e;
    source = 'demo';
    return fallback();
  }
}

// ── reads ──────────────────────────────────────────────
export async function getRisk() {
  const raw = await withFallback(() => http('/risk'), mock.mockRisk);
  const o = raw.overall || raw;
  return { score: o.risk_score, level: o.risk_level, zone: o.location, reason: o.reason, rainfall: o.rainfall, zones: raw.zones || [o] };
}

export async function getAlerts() {
  const raw = await withFallback(() => http('/alerts?active_only=true'), mock.mockAlerts);
  return raw.filter((a) => a.active !== false).map((a) => ({
    id: a.id, severity: a.severity, message: a.message, zone: a.affected_zone, createdAt: a.created_at,
  }));
}

export const getIncidents = () => withFallback(() => http('/incidents'), mock.mockIncidents);

export async function getRoute() {
  // Backend has no /route: derive blocked roads + alternative from GET /roads.
  const roads = await withFallback(() => http('/roads'), mock.mockRoads);
  return routeInfo(roads);
}

// ── writes ─────────────────────────────────────────────
export function submitIncident({ type, description }) {
  const body = { type, description, severity: 3, latitude: USER.latitude, longitude: USER.longitude };
  return withFallback(() => http('/incidents', { method: 'POST', body }), () => mock.mockSubmitIncident(body));
}

let lastMatch = null;
export const getMatch = () => lastMatch;

export async function requestHelp({ type, priority }) {
  const body = { type, priority, latitude: USER.latitude, longitude: USER.longitude };
  const request = await withFallback(() => http('/help-request', { method: 'POST', body }), () => mock.mockHelp(body));
  const live = source === 'live';
  const volunteers = live ? await http('/volunteers').catch(() => []) : mock.mockVolunteers();
  const result = matchBackendVolunteers(volunteers, body); // module matching engine
  const match = result.matched
    ? {
        volunteerId: Number(result.volunteer.id), volunteer: result.volunteer.name, resource: result.resource,
        distanceKm: result.distanceKm, status: 'Available', score: result.matchScore, breakdown: result.scoreBreakdown,
      }
    : null;
  if (live && match) {
    http('/matches', { method: 'POST', body: { help_request_id: request.request_id, volunteer_id: match.volunteerId } }).catch(() => {});
  }
  lastMatch = { requestId: request.request_id, match };
  return lastMatch;
}

// ── DEMO control (see components/DemoPanel.js) ─────────
export async function setDemoScenario(scenario) {
  const flood = scenario === 'flood';
  const rainfall = flood ? FLOOD_RAINFALL_MM : NORMAL_RAINFALL_MM;
  try {
    if (!flood) await http('/reset', { method: 'POST' });
    await http('/simulate-hazard', { method: 'POST', body: { hazard: 'FLOOD', rainfall } });
    const roads = await http('/roads');
    for (const r of roads) {
      const shouldBlock = flood && r.id === roads[0].id;
      if (shouldBlock && r.status !== 'BLOCKED') await http(`/roads/${r.id}/block`, { method: 'POST' });
      if (!shouldBlock && r.status === 'BLOCKED') await http(`/roads/${r.id}/unblock`, { method: 'POST' });
    }
    source = 'live';
  } catch (e) {
    source = 'demo';
  }
  mock.mockSetScenario(scenario, rainfall); // keep demo data in step either way
}

// Keep the backend's first road ("Road A") in step with the module's ROAD_A demo control. Best effort.
export async function syncRoadA(blocked) {
  try {
    const roads = await http('/roads');
    if (roads.length) await http(`/roads/${roads[0].id}/${blocked ? 'block' : 'unblock'}`, { method: 'POST' });
  } catch (e) { /* backend optional */ }
}
