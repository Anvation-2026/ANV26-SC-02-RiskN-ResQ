/**
 * Real device geolocation service using expo-location.
 * Never invents coordinates or defaults to synthetic cities.
 */
import * as Location from 'expo-location';
import { Linking, Platform } from 'react-native';

const FIX_TIMEOUT_MS = 15000;   // a first GPS fix can take a while indoors; after this we use the last known position (labelled)
const LAST_KNOWN_MAX_AGE_MS = 10 * 60 * 1000;

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

// Where location stands, without prompting: 'granted' | 'undetermined' (can still ask) | 'denied' (asked, refused) |
// 'blocked' (refused and the system will not ask again: only Settings can change it) | 'services_off' (GPS switched off) | 'error'
export async function getLocationState() {
  try {
    if (Platform.OS !== 'web') {
      const on = await Location.hasServicesEnabledAsync().catch(() => true);
      if (!on) return 'services_off';
    }
    const { status, canAskAgain } = await Location.getForegroundPermissionsAsync();
    cachedPermissionStatus = status;
    if (status === 'granted') return 'granted';
    if (status === 'denied') return canAskAgain === false ? 'blocked' : 'denied';
    return 'undetermined';
  } catch (err) {
    return 'error';
  }
}

// Opens this app's page in the phone's Settings (the only way back after "Don't allow" on iOS). Not available on the web.
export async function openLocationSettings() {
  if (Platform.OS === 'web') return false;
  try { await Linking.openSettings(); return true; } catch (e) { return false; }
}

const toLoc = (pos, source) => ({
  latitude: pos.coords.latitude,
  longitude: pos.coords.longitude,
  accuracy: pos.coords.accuracy,
  heading: pos.coords.heading,
  speed: pos.coords.speed,
  timestamp: pos.timestamp,
  source, // 'gps' (fresh fix) | 'last_known' (the phone's most recent fix, used while a fresh one is slow)
});

// A fresh, high-accuracy position. If the first fix is slow, the phone's last known position (if recent) is used and
// labelled as such; a fresher one then arrives through the live watcher. Never invents a position.
export async function getLiveCurrentPosition() {
  const status = await requestLocationPermission();
  if (status !== 'granted') {
    throw new Error('LOCATION_PERMISSION_DENIED');
  }
  let loc = null;
  try {
    const pos = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('LOCATION_TIMEOUT')), FIX_TIMEOUT_MS)),
    ]);
    loc = toLoc(pos, 'gps');
  } catch (e) {
    const last = Platform.OS !== 'web' ? await Location.getLastKnownPositionAsync({ maxAge: LAST_KNOWN_MAX_AGE_MS }).catch(() => null) : null;
    if (!last) throw new Error(e && e.message === 'LOCATION_TIMEOUT' ? 'LOCATION_TIMEOUT' : 'LOCATION_UNAVAILABLE');
    loc = toLoc(last, 'last_known');
  }
  cachedLocation = loc;
  notifyListeners(loc);
  if (!watchSubscription && listeners.size > 0) startLocationWatcher(); // keep following the user once allowed
  return loc;
}

export function subscribeToLiveLocation(callback) {
  listeners.add(callback);
  if (cachedLocation) {
    callback(cachedLocation);
  }

  // Start the live watcher once location is allowed
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
    watchSubscription = { remove: () => {} }; // claimed before the await, so two callers never start two watchers
    const sub = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.High, // hyper-local risk needs a street-level position while the app is open
        distanceInterval: 10, // a new position after moving 10 m
        timeInterval: 4000,   // or at least every 4 seconds
      },
      (pos) => {
        const loc = toLoc(pos, 'gps');
        cachedLocation = loc;
        notifyListeners(loc);
      }
    );
    watchSubscription = sub;
    if (listeners.size === 0) { sub.remove(); watchSubscription = null; } // everyone unsubscribed while it was starting
  } catch (e) {
    watchSubscription = null; // a later subscribe can try again
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
  cachedLocation = { ...loc, source: 'manual' };
  notifyListeners(loc);
}

export function getLastKnownLocation() {
  return cachedLocation;
}

export function getLocationPermissionStatus() {
  return cachedPermissionStatus;
}
