/**
 * Production API service layer for RiskNResQ.
 * Communicates directly with the FastAPI real-data backend.
 * Zero hardcoded synthetic demo data or fake coordinates.
 */
import { API_BASE_URL, REQUEST_TIMEOUT_MS, FORCE_MOCK } from '../config/api';

let source = 'live';
export const getSource = () => source;

async function http(path, options = {}) {
  if (FORCE_MOCK) throw new Error('MOCK_MODE_ACTIVE');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(API_BASE_URL + path, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });
    if (!res.ok) {
      const errorText = await res.text().catch(() => '');
      throw new Error(`API ${res.status}: ${errorText || res.statusText}`);
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
  if (typeof latitude !== 'number' || typeof longitude !== 'number') {
    throw new Error('Valid GPS coordinates are required for risk calculation.');
  }
  const raw = await http(`/risk?latitude=${latitude}&longitude=${longitude}`);
  return {
    score: raw.risk_score,
    level: raw.risk_level,
    zone: raw.location || `${raw.latitude.toFixed(4)}, ${raw.longitude.toFixed(4)}`,
    reason: raw.reason,
    rainfall: raw.rainfall_24h_mm,
    intensity: raw.rainfall_intensity_mm_per_hour,
    warning: raw.warning_level,
    weatherSource: raw.weather_source,
    factors: raw.factors,
    observedAt: raw.observed_at,
  };
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
