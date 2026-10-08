import { Platform } from 'react-native';
import Constants from 'expo-constants';

// ───────────────────────────────────────────────────────────────
// >>> CONNECT THE BACKEND HERE <<<
// Leave null to auto-detect: the app uses the same machine that serves Expo
// (http://<your-computer-LAN-IP>:8000). To force a URL, set e.g.
//   const API_URL_OVERRIDE = 'http://192.168.1.20:8000';
// The backend must listen on all interfaces: uvicorn main:app --host 0.0.0.0 --port 8000
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

export const FORCE_MOCK = false;       // true = never call the network, use demo data only
export const DEMO_CONTROLS = true;     // false = hide the admin demo controls on the map (set before final submission)
export const POLL_MS = 4000;           // how often risk / alerts / roads refresh
export const REQUEST_TIMEOUT_MS = 2500;
export const FLOOD_RAINFALL_MM = 80;   // rainfall used by the "Flood Risk" demo control
export const NORMAL_RAINFALL_MM = 5;
export const USE_DEVICE_LOCATION = false; // true = real GPS via expo-location; false = deterministic demo location (Bengaluru)
