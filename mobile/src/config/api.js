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
  if (ENV_API_URL) return ENV_API_URL.replace(/\/+$/, '');
  if (API_URL_OVERRIDE) return API_URL_OVERRIDE;
  const hostUri = Constants.expoConfig?.hostUri || Constants.expoGoConfig?.debuggerHost;
  const host = hostUri ? hostUri.split(':')[0] : null;
  if (Platform.OS === 'web' || !host) return 'http://localhost:8000';
  return `http://${host}:8000`;
}

export const API_BASE_URL = detectBaseUrl();

export const FORCE_MOCK = false;          // Production: Live backend data
export const DEMO_CONTROLS = false;        // Production: Hide demo controls
export const POLL_MS = 15000;              // 15-second real-time telemetry sync
export const REQUEST_TIMEOUT_MS = 6000;    // Network timeout
export const USE_DEVICE_LOCATION = true;   // Production: Real GPS via expo-location
