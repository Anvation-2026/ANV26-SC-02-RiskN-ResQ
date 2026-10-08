/**
 * geolocation.ts
 * Device location capture service with robust fallback coordinates.
 */

import * as LocationAPI from 'expo-location';
import { Location } from '../types/types';

export const DEMO_FALLBACK_LOCATION: Location = {
  latitude: 12.9716,
  longitude: 77.5946,
};

/**
 * Retrieves the current device coordinates using Expo Location.
 * Gracefully falls back to Bengaluru central demo coordinates if permissions are denied,
 * location services are disabled, or if running in an automated test/simulator environment.
 *
 * @returns Promise<Location> with latitude and longitude
 */
export async function getCurrentUserLocation(): Promise<Location> {
  try {
    // Check if LocationAPI is available (guard for test or mock environments)
    if (!LocationAPI || typeof LocationAPI.requestForegroundPermissionsAsync !== 'function') {
      return DEMO_FALLBACK_LOCATION;
    }

    const permissionResult = await LocationAPI.requestForegroundPermissionsAsync();
    if (permissionResult.status !== 'granted') {
      return DEMO_FALLBACK_LOCATION;
    }

    const position = await LocationAPI.getCurrentPositionAsync({
      accuracy: LocationAPI.Accuracy.Balanced,
    });

    if (
      position &&
      position.coords &&
      typeof position.coords.latitude === 'number' &&
      typeof position.coords.longitude === 'number'
    ) {
      return {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      };
    }

    return DEMO_FALLBACK_LOCATION;
  } catch (error) {
    // Non-fatal fallback ensures the mobile app never crashes on location failure
    return DEMO_FALLBACK_LOCATION;
  }
}
