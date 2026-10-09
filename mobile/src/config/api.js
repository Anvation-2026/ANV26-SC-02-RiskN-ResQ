import { Platform } from 'react-native';
import Constants from 'expo-constants';

// ───────────────────────────────────────────────────────────────
// PRODUCTION API CONFIGURATION
// Auto-detects the backend IP address from the Expo host URL.
// ───────────────────────────────────────────────────────────────
const API_URL_OVERRIDE = null;

// Preferred way to point a phone at another backend without editing code (not committed):
//   EXPO_PUBLIC_API_URL=http://192.168.1.20:8000 npx expo start      (use https:// for a deployed backend)
const ENV_API_URL = process.env.EXPO_PUBLIC_API_URL;

function detectBaseUrl() {
  // a bare host (as Render's fromService provides) means https://host
  if (ENV_API_URL) { const u = ENV_API_URL.trim().replace(/\/+$/, ''); return /^https?:\/\//i.test(u) ? u : `https://${u}`; }
  if (API_URL_OVERRIDE) return API_URL_OVERRIDE;
  // A release build has no dev server to learn the address from. Falling back to localhost would silently point the phone at
  // itself, so a release build without EXPO_PUBLIC_API_URL has no server address and says so (see http() in services/api.js).
  if (typeof __DEV__ !== 'undefined' && !__DEV__) return '';
  const hostUri = Constants.expoConfig?.hostUri || Constants.expoGoConfig?.debuggerHost;
  const host = hostUri ? hostUri.split(':')[0] : null;
  if (Platform.OS === 'web' || !host) return 'http://localhost:8000';
  return `http://${host}:8000`;
}

export const API_BASE_URL = detectBaseUrl();
export const API_CONFIGURED = API_BASE_URL !== '';
// Release builds on Android refuse plain http:// to anything but localhost: a deployed backend must be https://
export const API_IS_INSECURE = API_CONFIGURED && /^http:\/\//i.test(API_BASE_URL) && !/localhost|127\.0\.0\.1|10\.|192\.168\./.test(API_BASE_URL);

export const POLL_MS = 15000;              // 15-second real-time telemetry sync
export const REQUEST_TIMEOUT_MS = 6000;    // Network timeout
export const USE_DEVICE_LOCATION = true;   // Production: Real GPS via expo-location
