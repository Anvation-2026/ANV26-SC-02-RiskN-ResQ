/**
 * Production API service layer for RiskNResQ.
 * Communicates directly with the FastAPI real-data backend with bearer token session support.
 * Zero hardcoded synthetic demo data or fake coordinates in live operations.
 */
import { API_BASE_URL, API_CONFIGURED, REQUEST_TIMEOUT_MS } from '../config/api';
import { getToken, notifyUnauthorized } from './session';

let source = 'live';
export const getSource = () => source;

export async function http(path, options = {}) {
  if (!API_CONFIGURED) {  // a release build that was never given a server address
    throw Object.assign(new Error('not configured'), { status: 503, detail: 'This build has no server address. Set EXPO_PUBLIC_API_URL to your https:// backend and rebuild.' });
  }
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

export const newRequestKey = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

// the signed-in person's own reports, newest first, to follow their review status
export async function getMyReports() {
  return await http('/incidents?mine=true&limit=20');
}

export async function submitIncident({ type, description, latitude, longitude, severity = 3, idempotencyKey }) {
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

  return await http('/incidents', { method: 'POST', body, headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined });
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

export async function requestHelp({
  type,
  priority = 'HIGH',
  latitude,
  longitude,
  userId,
  destination_lat,
  destination_lng,
  phone,
  notes,
  description,
  photo_url,
  is_manual_location = false,
  quantity = 1,
  idempotencyKey,
}) {
  if (typeof latitude !== 'number' || typeof longitude !== 'number') {
    throw new Error('GPS coordinates are required to request emergency assistance.');
  }

  const body = {
    ...(userId != null ? { userId } : {}),
    type,
    priority,
    quantity,
    latitude,
    longitude,
    ...(destination_lat != null ? { destination_lat } : {}),
    ...(destination_lng != null ? { destination_lng } : {}),
    ...(phone ? { phone } : {}),
    ...(notes ? { notes } : {}),
    ...(description ? { description } : {}),
    ...(photo_url ? { photo_url } : {}),
    is_manual_location: !!is_manual_location,
  };

  // the same key for the same form: a double tap or a retry after a timeout returns the first request instead of making a second
  const response = await http('/help-requests', { method: 'POST', body, headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined });
  lastMatch = response;
  return response;
}

export async function getHelpRequestTracking(requestId) {
  return await http(`/help-requests/${requestId}/tracking`);
}

export async function cancelHelpRequest(requestId, reason = '') {
  return await http(`/help-requests/${requestId}/cancel`, {
    method: 'POST',
    body: { reason },
  });
}

export async function completeHelpRequest(requestId) {
  return await http(`/help-requests/${requestId}/complete`, {
    method: 'POST',
  });
}

export async function deleteIncident(incidentId) {
  return await http(`/incidents/${incidentId}`, {
    method: 'DELETE',
  });
}

// ── Admin-managed state shown to every user (public read endpoints) ──────────
// Rainfall across the monitored grid, served from the backend cache (the phone never calls the weather API).
export async function getWeatherMonitoring() {
  return http('/weather/monitoring');
}

// Hospitals and shelters (admin-added or imported from OpenStreetMap), nearest first when a position is given.
export async function getPlaces(latitude, longitude) {
  const q = latitude != null && longitude != null ? `?latitude=${latitude}&longitude=${longitude}&radius_km=40&limit=60` : '?limit=60';
  return http(`/places${q}`);
}

// Everything the map and Home need from the flood-intelligence layer in one cached read (never calls a weather or satellite service).
export async function getIntelligenceOverview(latitude, longitude) {
  const q = latitude != null && longitude != null ? `?latitude=${latitude}&longitude=${longitude}` : '';
  return http(`/intelligence/overview${q}`);
}

// satellite basemap + NASA daily imagery / flood detection / radar water layers, each with the date it really shows
export async function getSatelliteImagery() {
  return await http('/satellite/imagery');
}

// place search and place names go through the backend (OpenStreetMap Nominatim, cached and throttled there)
export async function searchPlaces(q) {
  return await http(`/geocode/search?q=${encodeURIComponent(q)}`);
}

export async function placeName(latitude, longitude) {
  return await http(`/geocode/reverse?latitude=${latitude}&longitude=${longitude}`);
}

export async function getFloodRiskAt(latitude, longitude) {
  return http(`/flood-risk?latitude=${latitude}&longitude=${longitude}`);
}

export async function getNearestEvacuation(latitude, longitude) {
  return http(`/evacuation/nearest?latitude=${latitude}&longitude=${longitude}`);
}

export async function getZoneAlerts() {
  const raw = await http('/alerts?active_only=true');
  return raw.filter((a) => a.active !== false);
}

export async function getRoadStatus() {
  return await http('/roads');
}

// Uploads the chosen image to the backend as raw bytes. Resolves only when the server confirmed it stored the photo, with where it
// was stored ("cloudinary" or "local"). `onProgress(0-100)` reports real bytes sent (XMLHttpRequest, which fetch cannot do).
export async function uploadIncidentPhoto(incidentId, uri, onProgress) {
  if (!API_CONFIGURED) throw Object.assign(new Error('not configured'), { status: 503, detail: 'This build has no server address.' });
  const blob = await (await fetch(uri)).blob();
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_BASE_URL}/incidents/${incidentId}/photo`);
    xhr.timeout = 45000;
    xhr.setRequestHeader('Content-Type', blob.type || 'application/octet-stream');
    xhr.setRequestHeader('Authorization', `Bearer ${getToken()}`);
    if (xhr.upload && onProgress) xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)); };
    const fail = (message) => reject(Object.assign(new Error(message), { detail: message }));
    xhr.onerror = () => fail('Could not reach the server. The report is saved; try the photo again.');
    xhr.ontimeout = () => fail('The upload took too long. The report is saved; try the photo again.');
    xhr.onload = () => {
      let body = null;
      try { body = JSON.parse(xhr.responseText); } catch (e) { /* not JSON */ }
      if (xhr.status >= 200 && xhr.status < 300) { if (onProgress) onProgress(100); return resolve(body || {}); }
      const detail = body && typeof body.detail === 'string' ? body.detail : null;
      const err = Object.assign(new Error(detail || `Upload failed (${xhr.status})`), { status: xhr.status, detail });
      if (xhr.status === 401) notifyUnauthorized();
      reject(err);
    };
    xhr.send(blob);
  });
}

// ── AI ASSISTANT (GROUNDED FLOOD & EMERGENCY INTELLIGENCE) ───────────────
/**
 * @param {{ message: string, latitude?: number, longitude?: number, history?: Array<{ role: string, content: string }> }} params
 */
export async function sendChatMessage({ message, latitude, longitude, history = [] }) {
  const body = {
    message,
    ...(typeof latitude === 'number' ? { latitude } : {}),
    ...(typeof longitude === 'number' ? { longitude } : {}),
    history: history.map((m) => ({ role: m.role, content: m.content })),
  };
  return await http('/assistant/chat', { method: 'POST', body });
}

export async function getSuggestedQuestions(latitude, longitude) {
  let url = '/assistant/suggested-questions';
  if (typeof latitude === 'number' && typeof longitude === 'number') {
    url += `?latitude=${latitude}&longitude=${longitude}`;
  }
  return await http(url);
}

export async function getAssistantStatus() {
  return await http('/assistant/status');
}
