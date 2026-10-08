import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Header from '../components/Header';
import MapView, { MapLegend } from '../components/MapView';
import ConnectionBanner from '../components/ConnectionBanner';
import ResponsePanel from '../components/ResponsePanel';
import { useResponse } from '../context/ResponseContext';
import { useData } from '../context/DataContext';
import { colors, radius, shadow } from '../theme';

const MODES = [['live', 'Live Data'], ['response', 'Route & Resources']];
const RESPONSE_LEGEND = [['🔴', 'High Risk'], ['🚧', 'Blocked Road'], ['📍', 'Your Location'], ['🛣️', 'Recommended Route'], ['🤝', 'Resource']];

export default function MapScreen() {
  const { risk, roads, blocked, alternative, incidents } = useData();
  const [mode, setMode] = useState('live');
  const R = useResponse();

  // Disaster-response scenario translated into MapView's props (graph edges drawn as 2-point roads).
  const scenario = useMemo(() => {
    const status = new Map(R.roads.map((r) => [r.id, r]));
    const edges = R.graph.edges.map((e, i) => {
      const a = R.graph.nodes[e.from], b = R.graph.nodes[e.to], road = status.get(e.roadId);
      return { id: `${e.roadId}-${i}`, name: road.name, status: road.status, coordinates: [[a.latitude, a.longitude], [b.latitude, b.longitude]] };
    });
    const dest = R.graph.nodes.D;
    const matchedId = R.match && R.match.matched ? R.match.volunteer.id : null;
    return {
      edges, blockedEdges: edges.filter((e) => e.status === 'BLOCKED'),
      routeLine: R.route && R.route.success ? R.route.coordinates.map((c) => [c.latitude, c.longitude]) : undefined,
      markers: [
        { id: 'dest', latitude: dest.latitude, longitude: dest.longitude, emoji: '🏥', label: 'Relief Station', color: colors.navy },
        ...R.volunteers.map((v) => ({
          id: v.id, latitude: v.latitude, longitude: v.longitude, emoji: '🤝', highlight: v.id === matchedId, fit: v.id === matchedId,
          label: v.id === matchedId ? `${v.name} · ${v.resource}` : null,
          color: v.availability === 'AVAILABLE' ? colors.LOW : '#94A3B8',
        })),
      ],
    };
  }, [R.roads, R.route, R.match, R.graph, R.volunteers]);
  const names = blocked.map((r) => r.name).join(', ');

  return (
    <View style={{ flex: 1 }}>
      <Header title="Live Map" subtitle="Flood zone, closures and recommended route" />
      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.seg}>
          {MODES.map(([k, l]) => (
            <Pressable key={k} onPress={() => setMode(k)} style={[styles.segBtn, mode === k && styles.segOn]}>
              <Text style={[styles.segText, mode === k && { color: '#fff' }]}>{l}</Text>
            </Pressable>
          ))}
        </View>
        <ConnectionBanner />
        {mode === 'response' ? (
          <>
            <MapView
              risk={risk} roads={scenario.edges} blocked={scenario.blockedEdges} alternative={null}
              zones={R.zones.map((z) => ({ latitude: z.latitude, longitude: z.longitude, radiusKm: z.radiusKm, level: z.riskLevel }))}
              height={400} routeLine={scenario.routeLine} markers={scenario.markers} user={R.userLocation} labelBlockedOnly
            />
            <MapLegend items={RESPONSE_LEGEND} />
            <View style={{ marginTop: 16 }}><ResponsePanel /></View>
          </>
        ) : (
        <>
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
        </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  seg: { flexDirection: 'row', backgroundColor: '#E2E8F0', borderRadius: 14, padding: 4, marginBottom: 14 },
  segBtn: { flex: 1, paddingVertical: 10, borderRadius: 11, alignItems: 'center' },
  segOn: { backgroundColor: colors.primary },
  segText: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: colors.text },
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
