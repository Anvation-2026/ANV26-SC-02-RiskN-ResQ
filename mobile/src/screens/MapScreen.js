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
import ErrorBoundary from '../components/ErrorBoundary';
import { useResponse } from '../context/ResponseContext';
import { useData } from '../context/DataContext';
import { RAIN_LABEL } from '../components/rain';
import { ROUTE_NOTE } from '../services/copy';
import { colors, radius, shadow } from '../theme';

const MODES = [
  ['live', 'Live Telemetry'],
  ['response', 'Corridor & Response'],
];

export default function MapScreen() {
  const insets = useSafeAreaInsets();
  const { height: screenHeight } = useWindowDimensions();
  const { userLocation, risk, blocked, roads, alternative, incidents, locationLabel, weatherMonitor } = useData();
  const [rainPick, setRainPick] = useState(null);
  const [mode, setMode] = useState('live');
  const R = useResponse();

  // Dominant map height: 50-54% of screen height
  const mapHeight = Math.max(340, Math.min(480, Math.round(screenHeight * 0.50)));

  // Real response markers & route line
  const scenario = useMemo(() => {
    const markers = [];
    const matchedId = R?.match?.matched && R?.match?.volunteer ? String(R.match.volunteer.id) : null;

    if (R?.destinationVolunteer) {
      const dv = R.destinationVolunteer;
      markers.push({
        id: 'dest',
        latitude: dv.latitude,
        longitude: dv.longitude,
        label: `★ ${dv.name} (${dv.resource || dv.skill || 'Responder'})`,
        color: colors.route,
        highlight: true,
      });
    }

    if (Array.isArray(R?.volunteers)) {
      R.volunteers.forEach((v) => {
        if (v && typeof v.latitude === 'number' && typeof v.longitude === 'number') {
          const isMatched = String(v.id) === matchedId;
          // Avoid duplicate marker if destinationVolunteer is already added
          if (isMatched && R?.destinationVolunteer) return;
          markers.push({
            id: String(v.id),
            latitude: v.latitude,
            longitude: v.longitude,
            highlight: isMatched,
            label: isMatched ? `★ ${v.name} · ${v.resource}` : `${v.name} · ${v.resource}`,
            color: isMatched ? colors.route : v.availability === 'AVAILABLE' ? colors.LOW : '#94A3B8',
          });
        }
      });
    }

    const routeLine = R?.route && R.route.success && Array.isArray(R.route.coordinates)
      ? R.route.coordinates
      : undefined;

    return {
      edges: [],
      blockedEdges: [],
      routeLine,
      markers,
    };
  }, [R]);

  const names = (blocked || []).map((r) => r.name).join(', ');

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

        {/* DOMINANT REAL INTERACTIVE MAP */}
        <ErrorBoundary fallbackTitle="Map View Unavailable">
          <View style={styles.mapWrapper}>
            <MapView
              risk={risk}
              roads={roads}
              blocked={blocked}
              alternative={alternative}
              incidents={incidents}
              height={mapHeight}
              routeLine={scenario.routeLine}
              markers={scenario.markers}
              user={userLocation || R?.userLocation}
              labelBlockedOnly
              rainAreas={weatherMonitor ? weatherMonitor.locations : []}
              onRainPress={setRainPick}
            />
          </View>
        </ErrorBoundary>


        <MapLegend />

        {rainPick && (
          <View style={styles.rainCard}>
            <View style={styles.kickerRow}>
              <Text style={styles.rainTitle}>{RAIN_LABEL[rainPick.rain_level]}</Text>
              <Pressable onPress={() => setRainPick(null)} hitSlop={10}><Feather name="x" size={16} color={colors.muted} /></Pressable>
            </View>
            <Text style={styles.rainLine}>Rainfall: <Text style={styles.rainBold}>{rainPick.rainfall_mm.toFixed(1)} mm</Text></Text>
            <Text style={styles.rainLine}>Period: <Text style={styles.rainBold}>1 hour</Text> ({(rainPick.rainfall_24h_mm ?? 0).toFixed(1)} mm in 24 h)</Text>
            <Text style={styles.rainLine}>Location: <Text style={styles.rainBold}>{rainPick.latitude.toFixed(3)}, {rainPick.longitude.toFixed(3)}</Text></Text>
            <Text style={styles.rainLine}>Observed: <Text style={styles.rainBold}>{new Date(rainPick.timestamp).toLocaleString()}</Text></Text>
            <Text style={styles.rainLine}>Source: <Text style={styles.rainBold}>{rainPick.source}</Text></Text>
            <Text style={styles.rainLine}>Status: <Text style={styles.rainBold}>{RAIN_LABEL[rainPick.rain_level].toUpperCase()}</Text></Text>
            <Text style={styles.rainNote}>This is a rainfall reading. Flood risk is shown separately by the risk level and alerts.</Text>
          </View>
        )}
        {weatherMonitor && weatherMonitor.status !== 'ok' && (
          <Text style={styles.rainStale}>{weatherMonitor.message || 'Weather data unavailable'}</Text>
        )}

        {/* BOTTOM SECTION / ROUTE STATUS */}
        {mode === 'response' ? (
          <ErrorBoundary fallbackTitle="Response Telemetry Unavailable">
            <View style={styles.responseContainer}>
              <ResponsePanel />
            </View>
          </ErrorBoundary>
        ) : (
          <View style={styles.routeCard}>
            <View style={styles.kickerRow}>
              <Text style={styles.kicker}>MONITORED CORRIDORS</Text>
              {blocked.length > 0 && (
                <View style={styles.blockedPill}>
                  <Text style={styles.blockedPillText}>HAZARD DETECTED</Text>
                </View>
              )}
            </View>

            {blocked.length > 0 ? (
              <>
                <View style={styles.hazardNotice}>
                  <Feather name="alert-triangle" size={15} color={colors.HIGH} style={{ marginRight: 6 }} />
                  <Text style={styles.warn}>
                    {blocked.length} Active Corridor Blockage{blocked.length > 1 ? 's' : ''}
                  </Text>
                </View>
                <Text style={styles.blockedListText} numberOfLines={2}>
                  {names}
                </Text>

                {scenario.routeLine ? (
                  <View style={styles.altSection}>
                    <Text style={styles.altLabel}>ACTIVE REROUTED CORRIDOR:</Text>
                    <Text style={styles.altName}>
                      {R?.destinationLabel || 'Validated Safe Path'}
                    </Text>
                    <View style={styles.stats}>
                      <View style={styles.statBox}>
                        <Text style={styles.sl}>Distance</Text>
                        <Text style={styles.sv}>
                          {R?.route?.distanceKm ? `${R.route.distanceKm.toFixed(1)} km` : '--'}
                        </Text>
                      </View>
                      <View style={styles.statBox}>
                        <Text style={styles.sl}>Est. Time</Text>
                        <Text style={styles.sv}>
                          {R?.route?.etaMinutes ? `${R.route.etaMinutes} min` : '--'}
                        </Text>
                      </View>
                    </View>
                    <Text style={styles.reasonText}>
                      Reason: {R?.route?.reason || 'Avoids reported blocked road.'}
                    </Text>
                  </View>
                ) : (
                  <Text style={styles.noAltText}>
                    Switch to Corridor & Response to calculate an automated detour around active hazards.
                  </Text>
                )}
              </>
            ) : (
              <View style={styles.okSection}>
                <Feather name="check-circle" size={16} color={colors.LOW} style={{ marginRight: 6 }} />
                <Text style={styles.ok}>No blocked corridors reported in your vicinity.</Text>
              </View>
            )}

            <View style={styles.noteDivider} />
            <Text style={styles.note}>
              {ROUTE_NOTE}
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  rainCard: { backgroundColor: '#fff', borderRadius: 16, padding: 14, marginTop: 12, borderWidth: 1, borderColor: '#FED7AA' },
  rainTitle: { fontFamily: 'PlusJakartaSans_800ExtraBold', fontSize: 15, color: colors.text },
  rainLine: { fontFamily: 'PlusJakartaSans_500Medium', fontSize: 13, color: colors.text, marginTop: 3 },
  rainBold: { fontFamily: 'PlusJakartaSans_700Bold' },
  rainNote: { fontFamily: 'PlusJakartaSans_500Medium', fontSize: 11, color: colors.muted, marginTop: 8 },
  rainStale: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12, color: '#B45309', marginTop: 8 },
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
    marginBottom: 6,
  },
  warn: {
    fontSize: 14,
    fontFamily: 'PlusJakartaSans_800ExtraBold',
    color: colors.HIGH,
  },
  blockedListText: {
    fontSize: 12,
    fontFamily: 'PlusJakartaSans_600SemiBold',
    color: '#475569',
    marginBottom: 8,
  },
  altSection: {
    marginTop: 4,
  },
  altLabel: {
    fontSize: 12,
    fontFamily: 'PlusJakartaSans_700Bold',
    color: '#64748B',
    letterSpacing: 0.6,
  },
  altName: {
    fontSize: 16,
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
    fontSize: 12,
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
