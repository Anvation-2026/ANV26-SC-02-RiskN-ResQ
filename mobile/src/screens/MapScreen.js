import React, { useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Feather from '@expo/vector-icons/Feather';
import Header from '../components/Header';
import MapView, { MapLegend } from '../components/MapView';
import ConnectionBanner from '../components/ConnectionBanner';
import ResponsePanel from '../components/ResponsePanel';
import { useResponse } from '../context/ResponseContext';
import { useData } from '../context/DataContext';
import { colors, radius, shadow } from '../theme';

const MODES = [
  ['live', 'Live Data'],
  ['response', 'Route & Resources'],
];

export default function MapScreen() {
  const insets = useSafeAreaInsets();
  const { height: screenHeight } = useWindowDimensions();
  const { risk, roads, blocked, alternative, incidents } = useData();
  const [mode, setMode] = useState('live');
  const R = useResponse();

  // Dominant map height: 50-54% of screen height
  const mapHeight = Math.max(340, Math.min(480, Math.round(screenHeight * 0.50)));

  // Disaster-response scenario translated into MapView's props
  const scenario = useMemo(() => {
    const status = new Map(R.roads.map((r) => [r.id, r]));
    const edges = R.graph.edges.map((e, i) => {
      const a = R.graph.nodes[e.from];
      const b = R.graph.nodes[e.to];
      const road = status.get(e.roadId);
      return {
        id: `${e.roadId}-${i}`,
        name: road ? road.name : e.roadId,
        status: road ? road.status : 'OPEN',
        coordinates: [
          [a.latitude, a.longitude],
          [b.latitude, b.longitude],
        ],
      };
    });
    const dest = R.graph.nodes.D;
    const matchedId = R.match && R.match.matched ? R.match.volunteer.id : null;

    return {
      edges,
      blockedEdges: edges.filter((e) => e.status === 'BLOCKED'),
      routeLine:
        R.route && R.route.success
          ? R.route.coordinates.map((c) => [c.latitude, c.longitude])
          : undefined,
      markers: [
        {
          id: 'dest',
          latitude: dest.latitude,
          longitude: dest.longitude,
          label: 'Relief Station',
          color: colors.navy,
        },
        ...R.volunteers.map((v) => ({
          id: v.id,
          latitude: v.latitude,
          longitude: v.longitude,
          highlight: v.id === matchedId,
          label: `${v.name} · ${v.resource}`,
          color: v.availability === 'AVAILABLE' ? colors.LOW : '#94A3B8',
        })),
      ],
    };
  }, [R.roads, R.route, R.match, R.graph, R.volunteers]);

  const names = blocked.map((r) => r.name).join(', ');

  return (
    <View style={styles.root}>
      <Header
        title="Live Map"
        subtitle="Real-Time Corridor Telemetry & Risk Zones"
      />

      <ScrollView
        contentContainerStyle={[
          styles.scrollBody,
          { paddingBottom: Math.max(insets.bottom, 16) + 85 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* TAB SWITCHER */}
        <View style={styles.tabSwitcher}>
          {MODES.map(([k, l]) => {
            const active = mode === k;
            return (
              <Pressable
                key={k}
                onPress={() => setMode(k)}
                style={[styles.tabBtn, active && styles.tabBtnActive]}
                hitSlop={4}
              >
                <Text style={[styles.tabText, active && styles.tabTextActive]}>
                  {l}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <ConnectionBanner />

        {/* LARGE DOMINANT REAL INTERACTIVE MAP */}
        <View style={styles.mapWrapper}>
          {mode === 'response' ? (
            <MapView
              risk={risk}
              roads={scenario.edges}
              blocked={scenario.blockedEdges}
              alternative={null}
              zones={R.zones.map((z) => ({
                latitude: z.latitude,
                longitude: z.longitude,
                radiusKm: z.radiusKm,
                level: z.riskLevel,
              }))}
              height={mapHeight}
              routeLine={scenario.routeLine}
              markers={scenario.markers}
              user={R.userLocation}
              labelBlockedOnly
            />
          ) : (
            <MapView
              risk={risk}
              roads={roads}
              blocked={blocked}
              alternative={alternative}
              incidents={incidents}
              height={mapHeight}
            />
          )}
        </View>

        {/* COMPACT MAP LEGEND */}
        <MapLegend />

        {/* BOTTOM SECTION / ROUTE STATUS */}
        {mode === 'response' ? (
          <View style={styles.responseContainer}>
            <ResponsePanel />
          </View>
        ) : (
          <View style={styles.routeCard}>
            <View style={styles.kickerRow}>
              <Text style={styles.kicker}>ROUTE STATUS</Text>
              {blocked.length > 0 && (
                <View style={styles.blockedPill}>
                  <Text style={styles.blockedPillText}>INCIDENT REPORTED</Text>
                </View>
              )}
            </View>

            {blocked.length > 0 ? (
              <>
                <View style={styles.hazardNotice}>
                  <Feather name="alert-triangle" size={15} color={colors.HIGH} style={{ marginRight: 6 }} />
                  <Text style={styles.warn}>
                    {names} {blocked.length > 1 ? 'are' : 'is'} BLOCKED
                  </Text>
                </View>

                {alternative ? (
                  <View style={styles.altSection}>
                    <Text style={styles.altLabel}>RECOMMENDED ALTERNATIVE ROUTE:</Text>
                    <Text style={styles.altName}>{alternative.road.name}</Text>
                    <View style={styles.stats}>
                      <View style={styles.statBox}>
                        <Text style={styles.sl}>Distance</Text>
                        <Text style={styles.sv}>{alternative.km.toFixed(1)} km</Text>
                      </View>
                      <View style={styles.statBox}>
                        <Text style={styles.sl}>Est. Time</Text>
                        <Text style={styles.sv}>{alternative.minutes} min</Text>
                      </View>
                    </View>
                    <Text style={styles.reasonText}>Reason: Avoids reported blocked road.</Text>
                  </View>
                ) : (
                  <Text style={styles.noAltText}>No alternative route is available in current telemetry.</Text>
                )}
              </>
            ) : (
              <View style={styles.okSection}>
                <Feather name="check-circle" size={16} color={colors.LOW} style={{ marginRight: 6 }} />
                <Text style={styles.ok}>No blocked roads reported. All monitored corridors open.</Text>
              </View>
            )}

            <View style={styles.noteDivider} />
            <Text style={styles.note}>
              Recommended alternative route based on available incident data.
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  scrollBody: {
    paddingHorizontal: 14,
    paddingTop: 12,
  },
  tabSwitcher: {
    flexDirection: 'row',
    backgroundColor: '#E2E8F0',
    borderRadius: 12,
    padding: 3,
    marginBottom: 10,
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabBtnActive: {
    backgroundColor: colors.navy,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 2,
  },
  tabText: {
    fontFamily: 'PlusJakartaSans_700Bold',
    fontSize: 13,
    color: '#64748B',
  },
  tabTextActive: {
    color: '#FFFFFF',
  },
  mapWrapper: {
    borderRadius: radius.card,
    overflow: 'hidden',
    backgroundColor: '#E2E8F0',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  responseContainer: {
    marginTop: 6,
  },
  routeCard: {
    backgroundColor: colors.card,
    borderRadius: radius.card,
    padding: 14,
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    ...shadow,
  },
  kickerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  kicker: {
    fontSize: 12,
    fontFamily: 'PlusJakartaSans_800ExtraBold',
    letterSpacing: 1,
    color: colors.muted,
  },
  blockedPill: {
    backgroundColor: '#FEE2E2',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  blockedPillText: {
    color: '#991B1B',
    fontSize: 9,
    fontFamily: 'PlusJakartaSans_800ExtraBold',
    letterSpacing: 0.5,
  },
  hazardNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF2F2',
    borderLeftWidth: 4,
    borderLeftColor: colors.HIGH,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 6,
    marginBottom: 10,
  },
  warn: {
    fontSize: 14,
    fontFamily: 'PlusJakartaSans_800ExtraBold',
    color: colors.HIGH,
  },
  altSection: {
    marginTop: 2,
  },
  altLabel: {
    fontSize: 12,
    fontFamily: 'PlusJakartaSans_700Bold',
    color: '#64748B',
    letterSpacing: 0.6,
  },
  altName: {
    fontSize: 18,
    fontFamily: 'PlusJakartaSans_800ExtraBold',
    color: colors.route,
    marginVertical: 3,
  },
  stats: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 6,
  },
  statBox: {
    flex: 1,
    backgroundColor: colors.bg,
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  sl: {
    fontSize: 12,
    color: colors.muted,
    fontFamily: 'PlusJakartaSans_600SemiBold',
  },
  sv: {
    fontSize: 16,
    fontFamily: 'PlusJakartaSans_800ExtraBold',
    color: colors.text,
    marginTop: 2,
  },
  reasonText: {
    fontSize: 12,
    fontFamily: 'PlusJakartaSans_600SemiBold',
    color: '#475569',
    marginTop: 8,
  },
  noAltText: {
    fontSize: 13,
    fontFamily: 'PlusJakartaSans_500Medium',
    color: colors.muted,
    marginVertical: 6,
  },
  okSection: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F0FDF4',
    padding: 10,
    borderRadius: 8,
    marginVertical: 4,
  },
  ok: {
    fontSize: 13,
    fontFamily: 'PlusJakartaSans_700Bold',
    color: colors.LOW,
  },
  noteDivider: {
    height: 1,
    backgroundColor: '#F1F5F9',
    marginVertical: 10,
  },
  note: {
    fontFamily: 'PlusJakartaSans_500Medium',
    fontSize: 12,
    color: colors.muted,
    fontStyle: 'italic',
  },
});
