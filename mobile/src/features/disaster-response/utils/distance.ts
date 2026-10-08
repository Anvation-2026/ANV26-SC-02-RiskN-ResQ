/**
 * distance.ts
 * Haversine formula distance calculation utilities for RiskNResQ geospatial operations.
 */

const EARTH_RADIUS_KM = 6371;

/**
 * Calculates the great-circle distance between two geographic coordinates using the Haversine formula.
 *
 * @param latitude1 - Latitude of point 1 in decimal degrees
 * @param longitude1 - Longitude of point 1 in decimal degrees
 * @param latitude2 - Latitude of point 2 in decimal degrees
 * @param longitude2 - Longitude of point 2 in decimal degrees
 * @returns Distance in kilometers, rounded to 2 decimal places for consistency
 */
export function calculateDistanceKm(
  latitude1: number,
  longitude1: number,
  latitude2: number,
  longitude2: number
): number {
  if (latitude1 === latitude2 && longitude1 === longitude2) {
    return 0;
  }

  const toRad = (value: number): number => (value * Math.PI) / 180;

  const dLat = toRad(latitude2 - latitude1);
  const dLon = toRad(longitude2 - longitude1);

  const radLat1 = toRad(latitude1);
  const radLat2 = toRad(latitude2);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(radLat1) * Math.cos(radLat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = EARTH_RADIUS_KM * c;

  // Round to 2 decimal places to maintain clean deterministic responses
  return Math.round(distance * 100) / 100;
}

/**
 * Helper to display human-readable distance (e.g., "800 m" or "1.5 km").
 */
export function formatDistance(distanceKm: number): string {
  if (distanceKm < 1) {
    const meters = Math.round(distanceKm * 1000);
    return `${meters} m`;
  }
  return `${distanceKm.toFixed(1)} km`;
}
