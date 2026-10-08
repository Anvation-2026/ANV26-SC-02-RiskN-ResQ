/**
 * Real device geolocation service using expo-location.
 * Never invents coordinates or defaults to synthetic cities.
 */
import * as Location from 'expo-location';

let watchSubscription = null;
const listeners = new Set();
let cachedLocation = null;
let cachedPermissionStatus = 'undetermined';

export function formatCoordinates(lat, lng) {
  if (typeof lat !== 'number' || typeof lng !== 'number') return 'Unknown Location';
  const latDir = lat >= 0 ? 'N' : 'S';
  const lngDir = lng >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(4)}° ${latDir}, ${Math.abs(lng).toFixed(4)}° ${lngDir}`;
}

export async function reverseGeocodeLocation(latitude, longitude) {
  try {
    const results = await Location.reverseGeocodeAsync({ latitude, longitude });
    if (results && results.length > 0) {
      const place = results[0];
      const parts = [
        place.name || place.street,
        place.district || place.subregion,
        place.city,
      ].filter(Boolean);
      if (parts.length > 0) {
        return parts.slice(0, 2).join(', ');
      }
    }
  } catch (e) {
    // Reverse geocoding optional; fall back to coordinate string
  }
  return formatCoordinates(latitude, longitude);
}

export async function geocodeSearch(query) {
  if (!query || typeof query !== 'string' || !query.trim()) return [];
  try {
    const results = await Location.geocodeAsync(query.trim());
    return results.map((r) => ({
      latitude: r.latitude,
      longitude: r.longitude,
    }));
  } catch (e) {
    return [];
  }
}

export async function checkLocationPermission() {
  try {
    const { status } = await Location.getForegroundPermissionsAsync();
    cachedPermissionStatus = status;
    return status;
  } catch (err) {
    cachedPermissionStatus = 'error';
    return 'error';
  }
}

export async function requestLocationPermission() {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    cachedPermissionStatus = status;
    return status;
  } catch (err) {
    cachedPermissionStatus = 'error';
    return 'error';
  }
}

export async function getLiveCurrentPosition() {
  const status = await requestLocationPermission();
  if (status !== 'granted') {
    throw new Error('LOCATION_PERMISSION_DENIED');
  }

  const pos = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.Balanced,
  });

  const loc = {
    latitude: pos.coords.latitude,
    longitude: pos.coords.longitude,
    accuracy: pos.coords.accuracy,
    heading: pos.coords.heading,
    speed: pos.coords.speed,
    timestamp: pos.timestamp,
  };

  cachedLocation = loc;
  notifyListeners(loc);
  return loc;
}

export function subscribeToLiveLocation(callback) {
  listeners.add(callback);
  if (cachedLocation) {
    callback(cachedLocation);
  }

  // Start watcher if not already running
  if (!watchSubscription && cachedPermissionStatus === 'granted') {
    startLocationWatcher();
  }

  return () => {
    listeners.delete(callback);
    if (listeners.size === 0 && watchSubscription) {
      watchSubscription.remove();
      watchSubscription = null;
    }
  };
}

async function startLocationWatcher() {
  try {
    watchSubscription = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.Balanced,
        distanceInterval: 15, // update every 15 meters
        timeInterval: 5000,    // or at least 5 seconds
      },
      (pos) => {
        const loc = {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          heading: pos.coords.heading,
          speed: pos.coords.speed,
          timestamp: pos.timestamp,
        };
        cachedLocation = loc;
        notifyListeners(loc);
      }
    );
  } catch (e) {
    // Watcher failure handled silently
  }
}

function notifyListeners(loc) {
  for (const listener of listeners) {
    try {
      listener(loc);
    } catch (e) {
      console.warn('Location listener error:', e);
    }
  }
}

export function setManualLocation(loc) {
  cachedLocation = loc;
  notifyListeners(loc);
}

export function getLastKnownLocation() {
  return cachedLocation;
}

export function getLocationPermissionStatus() {
  return cachedPermissionStatus;
}
