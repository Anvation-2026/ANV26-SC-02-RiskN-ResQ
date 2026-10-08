// Small persistent key-value store (AsyncStorage on phones, localStorage on the web). Best effort: failures are ignored.
import AsyncStorage from '@react-native-async-storage/async-storage';

export async function saveJSON(key, value) {
  try { await AsyncStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage is a convenience, never required */ }
}

export async function loadJSON(key) {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

export async function removeKey(key) {
  try { await AsyncStorage.removeItem(key); } catch (e) { /* ignore */ }
}
