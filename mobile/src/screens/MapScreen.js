import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Header from '../components/Header';
import MapView, { MapLegend } from '../components/MapView';
import ConnectionBanner from '../components/ConnectionBanner';
import { useData } from '../context/DataContext';
import { colors, radius, shadow } from '../theme';

export default function MapScreen() {
  const { risk, roads, blocked, alternative, incidents } = useData();
  const names = blocked.map((r) => r.name).join(', ');

  return (
    <View style={{ flex: 1 }}>
      <Header title="Live Map" subtitle="Flood zone, closures and recommended route" />
      <ScrollView contentContainerStyle={styles.body}>
        <ConnectionBanner />
        <MapView risk={risk} roads={roads} blocked={blocked} alternative={alternative} incidents={incidents} />
        <MapLegend />
        <View style={styles.card}>
          <Text style={styles.kicker}>ROUTE STATUS</Text>
          {blocked.length ? (
            <>
              <Text style={styles.warn}>⚠️ {names} {blocked.length > 1 ? 'are' : 'is'} currently reported blocked.</Text>
              {alternative ? (
                <>
                  <Text style={styles.l}>Recommended alternative:</Text>
                  <Text style={styles.alt}>{alternative.road.name}</Text>
                  <View style={styles.stats}>
                    <View style={styles.stat}><Text style={styles.sl}>Distance</Text><Text style={styles.sv}>{alternative.km.toFixed(1)} km</Text></View>
                    <View style={styles.stat}><Text style={styles.sl}>Estimated time</Text><Text style={styles.sv}>{alternative.minutes} min</Text></View>
                  </View>
                </>
              ) : (
                <Text style={styles.l}>No alternative route is available in the current data.</Text>
              )}
            </>
          ) : (
            <Text style={styles.ok}>✅ No blocked roads reported. All monitored roads are currently available.</Text>
          )}
          <Text style={styles.note}>Recommended alternative route based on available incident data.</Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, paddingBottom: 32 },
  card: { backgroundColor: colors.card, borderRadius: radius.card, padding: 18, marginTop: 16, ...shadow },
  kicker: { fontSize: 12, fontFamily: 'PlusJakartaSans_800ExtraBold', letterSpacing: 1.2, color: colors.muted, marginBottom: 10 },
  warn: { fontSize: 16, fontFamily: 'PlusJakartaSans_700Bold', color: colors.HIGH, lineHeight: 22, marginBottom: 12 },
  ok: { fontSize: 16, fontFamily: 'PlusJakartaSans_700Bold', color: colors.LOW, lineHeight: 22 },
  l: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 14, color: colors.muted },
  alt: { fontSize: 26, fontFamily: 'PlusJakartaSans_800ExtraBold', color: colors.route, marginVertical: 4 },
  stats: { flexDirection: 'row', gap: 10, marginTop: 8 },
  stat: { flex: 1, backgroundColor: colors.bg, borderRadius: 14, padding: 12 },
  sl: { fontSize: 12, color: colors.muted, fontFamily: 'PlusJakartaSans_600SemiBold' },
  sv: { fontSize: 20, fontFamily: 'PlusJakartaSans_800ExtraBold', color: colors.text },
  note: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12, color: colors.muted, marginTop: 14, lineHeight: 18 },
});
