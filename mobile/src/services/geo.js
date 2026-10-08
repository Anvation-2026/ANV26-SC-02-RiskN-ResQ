import { calculateDistanceKm } from '../features/disaster-response/utils/distance';

// Geography, route derivation and volunteer-matching helpers (pure functions).

export const USER = { latitude: 12.9716, longitude: 77.5946, label: 'Bengaluru' };

export const ZONES = {
  'Zone A': { latitude: 12.9716, longitude: 77.5946 },
  'Zone B': { latitude: 12.9352, longitude: 77.6245 },
  'Zone C': { latitude: 13.0358, longitude: 77.597 },
};

export function nearestZone(lat, lng) {
  return Object.keys(ZONES).reduce((best, z) => {
    const d = (ZONES[z].latitude - lat) ** 2 + (ZONES[z].longitude - lng) ** 2;
    return !best || d < best.d ? { z, d } : best;
  }, null).z;
}

export const haversineKm = (lat1, lng1, lat2, lng2) => calculateDistanceKm(lat1, lng1, lat2, lng2);

export function pathKm(coords) {
  let km = 0;
  for (let i = 1; i < coords.length; i++) {
    km += haversineKm(coords[i - 1][0], coords[i - 1][1], coords[i][0], coords[i][1]);
  }
  return km;
}

// Blocked roads + the shortest AVAILABLE road as the recommended alternative.
export function routeInfo(roads) {
  const blocked = roads.filter((r) => r.status === 'BLOCKED');
  const available = roads
    .filter((r) => r.status !== 'BLOCKED')
    .map((r) => ({ road: r, km: pathKm(r.coordinates) }))
    .sort((a, b) => a.km - b.km);
  const best = available[0];
  const alternative =
    blocked.length && best
      ? { road: best.road, km: best.km, minutes: Math.max(1, Math.round((best.km / 25) * 60)) }
      : null;
  return { roads, blocked, alternative };
}

export function timeAgo(iso) {
  if (!iso) return 'Just now';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'Just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  return `${Math.floor(s / 3600)} h ago`;
}
