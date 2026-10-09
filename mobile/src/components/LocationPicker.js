import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { Sheet } from './ui';
import { searchPlaces } from '../services/api';
import { colors, fonts } from '../theme';

// Choose where to check the flood risk: search any place by name (OpenStreetMap, through the backend) or go back to GPS.
// Picking a place never pretends to be the person's position: the app labels it "Viewing <place>, not your GPS location".
export default function LocationPicker({ visible, onClose, onPick, onUseGps, gpsAvailable }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const seq = useRef(0);

  useEffect(() => { if (!visible) { setQ(''); setResults([]); setError(''); } }, [visible]);

  // search as the person types (waits 500 ms after the last key; only the newest search is shown)
  useEffect(() => {
    const text = q.trim();
    if (text.length < 3) { setResults([]); setError(''); return undefined; }
    const id = ++seq.current;
    const t = setTimeout(async () => {
      setBusy(true);
      try {
        const r = await searchPlaces(text);
        if (id === seq.current) { setResults(r.results || []); setError((r.results || []).length ? '' : 'No place found with that name.'); }
      } catch (e) {
        if (id === seq.current) setError(e && e.detail ? e.detail : 'Place search is unavailable right now.');
      }
      if (id === seq.current) setBusy(false);
    }, 500);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <Sheet visible={visible} onClose={onClose} title="Check the risk at another place" tone={colors.primary}>
      <View style={s.searchRow}>
        <Feather name="search" size={16} color={colors.muted} />
        <TextInput value={q} onChangeText={setQ} placeholder="Search a place, e.g. Koramangala" placeholderTextColor="#94A3B8" style={s.input}
          autoFocus accessibilityLabel="Search a place" returnKeyType="search" autoCorrect={false} />
        {busy ? <ActivityIndicator size="small" color={colors.primary} /> : null}
      </View>
      {error ? <Text style={s.error}>{error}</Text> : null}
      {results.map((r) => (
        <Pressable key={`${r.latitude},${r.longitude}`} style={s.result} accessibilityRole="button" accessibilityLabel={`Check flood risk at ${r.name}`}
          onPress={() => onPick({ latitude: r.latitude, longitude: r.longitude, label: r.name })}>
          <View style={[s.pin, !r.inside_monitored_area && { backgroundColor: '#F1F5F9' }]}>
            <Feather name="map-pin" size={15} color={r.inside_monitored_area ? colors.primary : colors.muted} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.name} numberOfLines={1}>{r.name}</Text>
            <Text style={s.sub} numberOfLines={2}>{r.display_name}</Text>
            {!r.inside_monitored_area ? <Text style={s.outside}>Outside the monitored area: risk data may be unavailable</Text> : null}
          </View>
          <Feather name="chevron-right" size={16} color={colors.muted} />
        </Pressable>
      ))}
      {gpsAvailable ? (
        <Pressable style={s.gps} onPress={onUseGps} accessibilityRole="button">
          <Feather name="navigation" size={15} color="#fff" />
          <Text style={s.gpsText}>Use my GPS location</Text>
        </Pressable>
      ) : null}
      <Text style={s.note}>Place search: OpenStreetMap. You can also tap any spot on the Map to check the risk there.</Text>
    </Sheet>
  );
}

const s = StyleSheet.create({
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#F1F5F9', borderRadius: 14, paddingHorizontal: 12, minHeight: 48, marginTop: 4 },
  input: { flex: 1, fontFamily: fonts.semibold, fontSize: 15, color: colors.text, paddingVertical: 10 },
  error: { fontFamily: fonts.medium, fontSize: 13, color: colors.muted, marginTop: 10 },
  result: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  pin: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#DBEAFE', alignItems: 'center', justifyContent: 'center' },
  name: { fontFamily: fonts.bold, fontSize: 15, color: colors.text },
  sub: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, marginTop: 1 },
  outside: { fontFamily: fonts.semibold, fontSize: 11, color: '#B45309', marginTop: 2 },
  gps: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.navy, borderRadius: 14, minHeight: 48, marginTop: 14 },
  gpsText: { color: '#fff', fontFamily: fonts.extrabold, fontSize: 14 },
  note: { fontFamily: fonts.medium, fontSize: 11, color: colors.muted, marginTop: 10, lineHeight: 16 },
});
