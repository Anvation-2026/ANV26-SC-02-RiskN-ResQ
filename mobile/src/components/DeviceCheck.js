import React, { useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import Constants from 'expo-constants';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import Feather from '@expo/vector-icons/Feather';
import { Card, Label, SmallButton } from './ui';
import { FadeIn } from './motion';
import { API_BASE_URL, API_CONFIGURED, API_IS_INSECURE } from '../config/api';
import { getRegisteredPushToken } from '../services/push';
import { colors, fonts } from '../theme';

// "Device and connection check": what a person holding a real phone needs to know in 20 seconds. Every row is a live reading,
// never an assumption: server reachability is measured, permissions are asked of the operating system, storage is written and read.
const OK = { icon: 'check-circle', color: colors.LOW };
const WARN = { icon: 'alert-triangle', color: '#B45309' };
const BAD = { icon: 'x-circle', color: colors.HIGH };
const NA = { icon: 'minus-circle', color: colors.muted };
const web = Platform.OS === 'web';

async function secureStorageCheck() {
  try {
    const key = 'risknresq_selftest';
    if (web) { window.localStorage.setItem(key, '1'); const ok = window.localStorage.getItem(key) === '1'; window.localStorage.removeItem(key); return ok; }
    await SecureStore.setItemAsync(key, '1');
    const ok = (await SecureStore.getItemAsync(key)) === '1';
    await SecureStore.deleteItemAsync(key);
    return ok;
  } catch (e) { return false; }
}

async function readChecks() {
  const rows = [];
  const add = (label, st, detail) => rows.push({ label, st, detail });

  if (!API_CONFIGURED) add('Server address', BAD, 'This build has no server address. Set EXPO_PUBLIC_API_URL to your https:// backend and rebuild.');
  else {
    const t0 = Date.now();
    try {
      const r = await fetch(`${API_BASE_URL}/health`);
      const ms = Date.now() - t0;
      add('Server', r.ok ? (API_IS_INSECURE ? WARN : OK) : BAD, `${API_BASE_URL}: ${r.ok ? `reachable in ${ms} ms` : `answered ${r.status}`}${API_IS_INSECURE ? ' (plain http: Android release builds refuse this; use https)' : ''}`);
    } catch (e) {
      add('Server', BAD, `${API_BASE_URL} is not reachable from this device. On a phone, "localhost" means the phone itself: use your computer's Wi-Fi address (the app finds it automatically in Expo Go) and keep both on the same network.`);
    }
  }

  try {
    const services = await Location.hasServicesEnabledAsync();
    const p = await Location.getForegroundPermissionsAsync();
    add('Location', p.granted && services ? OK : p.granted ? WARN : BAD, !services ? 'Location services are switched off in the device settings.' : p.granted ? 'Permission granted.' : p.canAskAgain === false ? 'Permission denied. Enable it in the device settings.' : 'Permission not granted yet. Tap "Ask for permissions".');
  } catch (e) { add('Location', NA, 'Not available on this device.'); }

  if (web) add('Camera', NA, 'In the browser the report screen opens the file chooser instead of the camera.');
  else {
    try {
      const c = await ImagePicker.getCameraPermissionsAsync();
      add('Camera', c.granted ? OK : BAD, c.granted ? 'Permission granted.' : c.canAskAgain === false ? 'Permission denied. Enable it in the device settings.' : 'Permission not granted yet. Tap "Ask for permissions".');
      const l = await ImagePicker.getMediaLibraryPermissionsAsync();
      add('Photo library', l.granted ? OK : WARN, l.granted ? 'Permission granted.' : 'Not granted yet (asked when you choose a photo).');
    } catch (e) { add('Camera', NA, 'Not available on this device.'); }
  }

  if (web) add('Notifications', NA, 'Push notifications are for phone builds.');
  else {
    try {
      const n = await Notifications.getPermissionsAsync();
      const token = getRegisteredPushToken();
      const expoGo = Constants.appOwnership === 'expo';
      add('Notifications', n.granted && token ? OK : expoGo ? WARN : n.granted ? WARN : BAD,
        expoGo ? 'Running in Expo Go: remote push is limited there. Use an EAS development build to test push.' : n.granted ? (token ? 'Permission granted and this phone is registered for alerts.' : 'Permission granted; registration with the server has not completed.') : 'Permission not granted.');
    } catch (e) { add('Notifications', NA, 'Not available on this device.'); }
  }

  add('Secure storage', (await secureStorageCheck()) ? OK : BAD, web ? 'Browser storage (the login token is kept here on the web).' : 'Login token is kept in the device keychain / keystore.');
  const mode = web ? 'Browser' : Constants.appOwnership === 'expo' ? 'Expo Go' : typeof __DEV__ !== 'undefined' && __DEV__ ? 'Development build' : 'Release build';
  add('App', NA, `${mode} · version ${(Constants.expoConfig && Constants.expoConfig.version) || '1.0.0'} · ${Platform.OS}`);
  return rows;
}

export default function DeviceCheck() {
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(false);
  const [gps, setGps] = useState(null);

  const run = async () => { setBusy(true); try { setRows(await readChecks()); } finally { setBusy(false); } };
  const ask = async () => {
    setBusy(true);
    try {
      try { await Location.requestForegroundPermissionsAsync(); } catch (e) { /* reported by the next check */ }
      if (!web) { try { await ImagePicker.requestCameraPermissionsAsync(); } catch (e) { /* reported below */ } try { await Notifications.requestPermissionsAsync(); } catch (e) { /* reported below */ } }
      setRows(await readChecks());
    } finally { setBusy(false); }
  };
  const testGps = async () => {
    setBusy(true); setGps('Waiting for a GPS fix (up to 12 s)…');
    try {
      const fix = await Promise.race([Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 12000))]);
      setGps(`Fix: ${fix.coords.latitude.toFixed(5)}, ${fix.coords.longitude.toFixed(5)} · accuracy ±${Math.round(fix.coords.accuracy || 0)} m`);
    } catch (e) {
      setGps(e && e.message === 'timeout' ? 'No GPS fix within 12 seconds. Go outdoors or check that location services are on.' : 'Could not read the location. Check the permission and location services.');
    }
    setBusy(false);
  };

  return (
    <Card>
      <Label>DEVICE & CONNECTION CHECK</Label>
      <Text style={s.help}>Shows whether this device can reach the server and use GPS, camera, notifications and secure storage.</Text>
      <View style={s.buttons}>
        <SmallButton label={busy ? 'Checking…' : rows ? 'Run again' : 'Run check'} disabled={busy} onPress={run} />
        {!web ? <SmallButton label="Ask for permissions" outline disabled={busy} onPress={ask} /> : null}
        <SmallButton label="Test GPS" outline disabled={busy} onPress={testGps} />
      </View>
      {gps ? <Text style={s.gps}>{gps}</Text> : null}
      {rows ? (
        <FadeIn from="none">
          <View style={{ marginTop: 6 }}>
            {rows.map((r) => (
              <View key={r.label} style={s.row} accessible accessibilityLabel={`${r.label}: ${r.detail}`}>
                <Feather name={r.st.icon} size={16} color={r.st.color} style={{ marginTop: 2 }} />
                <View style={{ flex: 1 }}>
                  <Text style={s.rowTitle}>{r.label}</Text>
                  <Text style={s.rowDetail}>{r.detail}</Text>
                </View>
              </View>
            ))}
          </View>
        </FadeIn>
      ) : null}
    </Card>
  );
}

const s = StyleSheet.create({
  help: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted, lineHeight: 19, marginBottom: 10 },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  gps: { fontFamily: fonts.semibold, fontSize: 12, color: colors.text, marginTop: 10 },
  row: { flexDirection: 'row', gap: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.border, marginTop: 8 },
  rowTitle: { fontFamily: fonts.bold, fontSize: 13, color: colors.text },
  rowDetail: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, lineHeight: 17, marginTop: 1 },
});
