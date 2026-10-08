import { calculateDistanceKm } from '../features/disaster-response/utils/distance';

// Pure geospatial calculations and formatters

export const haversineKm = (lat1, lng1, lat2, lng2) => calculateDistanceKm(lat1, lng1, lat2, lng2);

export function pathKm(coords) {
  if (!Array.isArray(coords) || coords.length < 2) return 0;
  let km = 0;
  for (let i = 1; i < coords.length; i++) {
    const p1 = coords[i - 1];
    const p2 = coords[i];
    const lat1 = Array.isArray(p1) ? p1[0] : p1.latitude;
    const lng1 = Array.isArray(p1) ? p1[1] : p1.longitude;
    const lat2 = Array.isArray(p2) ? p2[0] : p2.latitude;
    const lng2 = Array.isArray(p2) ? p2[1] : p2.longitude;
    if (typeof lat1 === 'number' && typeof lat2 === 'number') {
      km += haversineKm(lat1, lng1, lat2, lng2);
    }
  }
  return km;
}

export function timeAgo(iso) {
  if (!iso) return 'Just now';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${Math.floor(s)}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  return `${Math.floor(s / 3600)} h ago`;
}
