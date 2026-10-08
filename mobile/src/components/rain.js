// Shared rainfall helpers (map overlay colours, labels). Rainfall is weather, not a flood: wording stays "rainfall".
export const RAIN_RADIUS_KM = 4.4; // half a grid cell (the backend grid is ~9 km apart)
export const RAIN_LABEL = { LOW: 'Light rainfall', MODERATE: 'Moderate rainfall', HEAVY: 'Heavy rainfall', VERY_HEAVY: 'Very heavy rainfall' };
export const RAIN_COLOR = { LOW: '#64748B', MODERATE: '#64748B', HEAVY: '#F97316', VERY_HEAVY: '#DC2626' };
export const RAIN_FILL = { MODERATE: 0.12, HEAVY: 0.28, VERY_HEAVY: 0.34 };

// Only areas worth showing are drawn (never one marker per grid point).
export const drawableRain = (locations) => (Array.isArray(locations) ? locations : []).filter(
  (l) => RAIN_FILL[l.rain_level] && Number.isFinite(l.latitude) && Number.isFinite(l.longitude));

export function ago(iso) {
  const t = Date.parse(iso);
  if (!t) return 'unknown';
  const m = Math.max(0, Math.round((Date.now() - t) / 60000));
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
}

// Translated label for a rain level (falls back to the English label).
export const rainLabel = (t, level) => t(`rain.${level}`);

// Flood-risk map colours and cell geometry (the hyper-local grid from the backend).
export const RISK_COLOR = { LOW: '#22C55E', MEDIUM: '#EAB308', HIGH: '#F97316', CRITICAL: '#DC2626' };
export const RISK_FILL = { LOW: 0.07, MEDIUM: 0.2, HIGH: 0.3, CRITICAL: 0.4 };
export const SAT_COLOR = '#7C3AED';
export const TERRAIN_COLOR = '#92400E';

export const cellCorners = (cell, half) => [
  [cell.latitude - half.lat, cell.longitude - half.lng], [cell.latitude - half.lat, cell.longitude + half.lng],
  [cell.latitude + half.lat, cell.longitude + half.lng], [cell.latitude + half.lat, cell.longitude - half.lng],
];

export const drawableCells = (cells) => (Array.isArray(cells) ? cells : []).filter(
  (c) => c && !c.insufficient && RISK_COLOR[c.risk_level] && Number.isFinite(c.latitude) && Number.isFinite(c.longitude));
