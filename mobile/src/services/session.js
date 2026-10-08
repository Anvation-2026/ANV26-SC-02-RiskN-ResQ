// Holds the login token (in memory + persisted) and the "session expired" callback.
// The token never contains credentials; passwords are only ever sent to POST /auth/login or /auth/register.
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const KEY = 'risknresq_token';
let token = null;
let onUnauthorized = null;

export const getToken = () => token;
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };
export const notifyUnauthorized = () => { if (onUnauthorized) onUnauthorized(); };

export async function saveToken(value) {
  token = value;
  try {
    if (Platform.OS === 'web') window.localStorage.setItem(KEY, value);
    else await SecureStore.setItemAsync(KEY, value);
  } catch (e) { /* persistence is best effort */ }
}

export async function loadToken() {
  try {
    token = Platform.OS === 'web' ? window.localStorage.getItem(KEY) : await SecureStore.getItemAsync(KEY);
  } catch (e) { token = null; }
  return token;
}

export async function clearToken() {
  token = null;
  try {
    if (Platform.OS === 'web') window.localStorage.removeItem(KEY);
    else await SecureStore.deleteItemAsync(KEY);
  } catch (e) { /* ignore */ }
}
