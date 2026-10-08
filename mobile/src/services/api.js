/**
 * Production API service layer for RiskNResQ.
 * Communicates directly with the FastAPI real-data backend with bearer token session support.
 * Zero hardcoded synthetic demo data or fake coordinates in live operations.
 */
import { API_BASE_URL, REQUEST_TIMEOUT_MS, FORCE_MOCK } from '../config/api';
import { getToken, notifyUnauthorized } from './session';

let source = 'live';
export const getSource = () => source;

export async function http(path, options = {}) {
  if (FORCE_MOCK) throw new Error('MOCK_MODE_ACTIVE');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const token = getToken();

  try {
    const res = await fetch(API_BASE_URL + path, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });

    if (!res.ok) {
      let detail = null;
      try {
        const b = await res.json();
        detail = typeof b.detail === 'string' ? b.detail : null;
      } catch (e) {
        /* not JSON */
      }
      const err = new Error(detail || `API ${res.status}: ${res.statusText}`);
      err.status = res.status;
      err.detail = detail;
      if (res.status === 401 && token && !path.startsWith('/auth/login')) {
        notifyUnauthorized();
      }
      throw err;
    }

    source = 'live';
    return await res.json();
  } catch (err) {
    source = 'offline';
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// ── 1. REAL TELEMETRY SYNC ──────────────────────────────────────────────
export async function syncTelemetry(latitude, longitude) {
  if (typeof latitude !== 'number' || typeof longitude !== 'number') {
    throw new Error('Valid GPS coordinates are required for telemetry sync.');
  }
  return await http(`/sync?latitude=${latitude}&longitude=${longitude}`);
}

// ── 2. REAL FLOOD RISK EVALUATION ───────────────────────────────────────
export async function getRisk(latitude, longitude) {
  let url = '/risk';
  if (typeof latitude === 'number' && typeof longitude === 'number') {
    url += `?latitude=${latitude}&longitude=${longitude}`;
  }
  const raw = await http(url);
  const o = raw.overall || raw;
  return {
    score: o.risk_score,
    level: o.risk_level,
    zone: o.location || (typeof o.latitude === 'number' ? `${o.latitude.toFixed(4)}, ${o.longitude.toFixed(4)}` : 'Current Zone'),
    reason: o.reason,
    rainfall: o.rainfall_24h_mm ?? o.rainfall ?? 0,
    intensity: o.rainfall_intensity_mm_per_hour,
    warning: o.warning_level,
    weatherSource: o.weather_source,
    factors: o.factors,
    observedAt: o.observed_at,
    zones: raw.zones || [o],
  };
}

export async function getAlerts() {
  try {
    const raw = await http('/alerts?active_only=true');
    return raw.filter((a) => a.active !== false).map((a) => ({
      id: a.id,
      severity: a.severity,
      message: a.message,
      zone: a.affected_zone,
      createdAt: a.created_at,
    }));
  } catch (e) {
    return [];
  }
}

// ── 3. INCIDENTS & HAZARDS ──────────────────────────────────────────────
export async function getIncidents(latitude, longitude, radiusKm = 25.0) {
  let url = '/incidents';
  if (typeof latitude === 'number' && typeof longitude === 'number') {
    url += `?latitude=${latitude}&longitude=${longitude}&radius_km=${radiusKm}`;
  }
  return await http(url);
}

export async function submitIncident({ type, description, latitude, longitude, severity = 3 }) {
  if (typeof latitude !== 'number' || typeof longitude !== 'number') {
    throw new Error('GPS coordinates are required to submit an incident.');
  }

  // Map client types to backend enum
  let mappedType = type;
  if (type === 'FLOOD') mappedType = 'FLOODED_ROAD';
  else if (type === 'EMERGENCY') mappedType = 'OTHER';

  const body = {
    type: mappedType,
    description: description || 'Reported via RiskNResQ mobile application',
    severity: Math.min(5, Math.max(1, severity)),
    latitude,
    longitude,
    radiusMeters: 50.0,
    reportedBy: 'Citizen Reporter',
  };

  return await http('/incidents', { method: 'POST', body });
}

// ── 4. REAL INCIDENT-AWARE ROUTING ──────────────────────────────────────
export async function computeRoute(origin, destination, travelMode = 'DRIVE') {
  if (!origin || !destination) {
    throw new Error('Origin and destination coordinates are required for route computation.');
  }

  const body = {
    origin: {
      latitude: origin.latitude,
      longitude: origin.longitude,
    },
    destination: {
      latitude: destination.latitude,
      longitude: destination.longitude,
    },
    travelMode,
  };

  return await http('/routes/compute', { method: 'POST', body });
}

// ── 5. REAL VOLUNTEER REGISTRATION & PRESENCE ───────────────────────────
export async function registerVolunteer({ name, skill, resources, phone, latitude, longitude }) {
  const body = {
    name,
    skill: skill || 'COMMUNITY_RESPONDER',
    resources: resources || 'Emergency Assistance',
    phone,
    latitude,
    longitude,
  };
  return await http('/volunteers/register', { method: 'POST', body });
}

export async function getNearbyVolunteers(latitude, longitude, radiusKm = 15.0, resource = null) {
  let url = `/volunteers/nearby?latitude=${latitude}&longitude=${longitude}&radius_km=${radiusKm}`;
  if (resource) {
    url += `&resource=${encodeURIComponent(resource)}`;
  }
  return await http(url);
}

export async function updateVolunteerLocation(volunteerId, latitude, longitude) {
  return await http(`/volunteers/${volunteerId}/location`, {
    method: 'POST',
    body: { latitude, longitude },
  });
}

// ── 6. REAL HELP REQUESTS & MATCHING ────────────────────────────────────
let lastMatch = null;
export const getMatch = () => lastMatch;

export async function requestHelp({ type, priority = 'HIGH', latitude, longitude }) {
  if (typeof latitude !== 'number' || typeof longitude !== 'number') {
    throw new Error('GPS coordinates are required to request emergency assistance.');
  }

  const body = {
    userId: 1,
    type,
    priority,
    latitude,
    longitude,
  };

  const response = await http('/help-requests', { method: 'POST', body });
  lastMatch = response;
  return response;
}

// ── 7. DEMO / DEVELOPMENT CONTROLS ──────────────────────────────────────
export async function setDemoScenario(scenario) {
  const flood = scenario === 'flood';
  const rainfall = flood ? 85 : 5;
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
    source = 'offline';
  }
}

export async function syncRoadA(blocked) {
  try {
    const roads = await http('/roads');
    if (roads && roads.length) {
      await http(`/roads/${roads[0].id}/${blocked ? 'block' : 'unblock'}`, { method: 'POST' });
    }
  } catch (e) {
    /* best effort */
  }
}

// Uploads the chosen image to the backend as raw bytes. Resolves only when the server confirmed it stored the photo.
export async function uploadIncidentPhoto(incidentId, uri) {
  const blob = await (await fetch(uri)).blob();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch(`${API_BASE_URL}/incidents/${incidentId}/photo`, {
      method: 'POST',
      headers: { 'Content-Type': blob.type || 'application/octet-stream', Authorization: `Bearer ${getToken()}` },
      body: blob,
      signal: controller.signal,
    });
    if (!res.ok) {
      let detail = null;
      try { const b = await res.json(); detail = typeof b.detail === 'string' ? b.detail : null; } catch (e) { /* not JSON */ }
      const err = new Error(detail || `Upload failed (${res.status})`);
      err.status = res.status;
      err.detail = detail;
      if (res.status === 401) notifyUnauthorized();
      throw err;
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}
