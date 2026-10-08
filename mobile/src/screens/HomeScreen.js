import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Feather from '@expo/vector-icons/Feather';
import WeatherCard from '../components/WeatherCard';
import Header from '../components/Header';
import RiskCard from '../components/RiskCard';
import AlertCard from '../components/AlertCard';
import ActionButton from '../components/ActionButton';
import { symbols } from '../assets';
import ConnectionBanner from '../components/ConnectionBanner';
import { useData } from '../context/DataContext';
import { colors, radius, riskColor, shadow } from '../theme';
import { haversineKm, timeAgo } from '../services/geo';
import { FadeIn, staggerDelay } from '../components/motion';
import { MetricCard, SectionTitle, StateView } from '../components/ui';
import { ago } from '../components/rain';
import { prettyResource } from '../integration/volunteerAdapter';

const TEXT = {
  LOW: ['LOW FLOOD RISK', 'Signals are within normal limits.'],
  MODERATE: ['MEDIUM FLOOD RISK', 'Rainfall is elevated. Low-lying roads may collect water: check the map before you travel.'],
  MEDIUM: ['MEDIUM FLOOD RISK', 'Rainfall is elevated. Low-lying roads may collect water: check the map before you travel.'],
  HIGH: ['HIGH FLOOD RISK', 'The risk estimate is high. Avoid potentially affected roads and follow the recommended route.'],
  CRITICAL: ['CRITICAL FLOOD RISK', 'The risk estimate is very high. Move away from low-lying areas and follow official instructions.'],
};

const Row = ({ label, value, color }) => (
  <View style={styles.row}>
    <Text style={styles.rl}>{label}</Text>
    <Text style={[styles.rv, color && { color }]} numberOfLines={1}>{value}</Text>
  </View>
);

export default function HomeScreen({ navigate }) {
  const insets = useSafeAreaInsets();
  const {
    userLocation,
    locationLabel,
    locationStatus,
    risk,
    weather,
    weatherMonitor,
    intel,
    incidents,
    alerts,
    blocked,
    activeAssistance,
    source,
    cachedAt,
    lastUpdated,
    requestPermission,
    applyManualLocation,
  } = useData();

  const [ticker, setTicker] = useState(0);

  // Live timer tick for "Updated X sec ago"
  useEffect(() => {
    const timer = setInterval(() => setTicker((t) => t + 1), 5000);
    return () => clearInterval(timer);
  }, []);

  const currentLevel = risk ? (risk.level || risk.risk_level || 'LOW') : 'LOW';
  const [title, body] = TEXT[currentLevel] || TEXT.LOW;

  const activeIncidents = incidents.filter((i) => i.status !== 'RESOLVED');
  const nearby = userLocation
    ? activeIncidents.filter((i) => Number.isFinite(i.latitude) && Number.isFinite(i.longitude))
        .map((i) => ({ ...i, distance: haversineKm(userLocation.latitude, userLocation.longitude, i.latitude, i.longitude) }))
        .filter((i) => i.distance <= 5).sort((a, b) => a.distance - b.distance).slice(0, 3)
    : [];
  const topAlert = alerts.length > 0 ? alerts[0] : null; // strongest active alert (zone alert or reported incident)

  const isPermissionDenied = locationStatus === 'denied' || locationStatus === 'error';

  return (
    <View style={styles.container}>
      <Header
        brand
        title="RiskN ResQ"
        subtitle="Hyper-Local Disaster Early Warning Network"
        right={
          <View style={[styles.pill, { backgroundColor: source === 'live' ? '#16A34A' : '#64748B' }]}>
            <Text style={styles.pillText}>{source === 'live' ? '● LIVE' : '● OFFLINE'}</Text>
          </View>
        }
      >
        <View style={styles.locationRow}>
          <Feather name="map-pin" size={13} color="#38BDF8" style={{ marginRight: 5 }} />
          <Text style={styles.locLabel}>Location:</Text>
          <Text style={styles.loc} numberOfLines={1}>{locationLabel}</Text>
        </View>
      </Header>

      <ScrollView
        contentContainerStyle={[styles.body, { paddingBottom: Math.max(insets.bottom, 16) + 85 }]}
        showsVerticalScrollIndicator={false}
      >
        <ConnectionBanner />

        {/* 1. LOCATION PERMISSION BANNER (IF DENIED) */}
        {isPermissionDenied && (
          <View style={styles.permissionCard}>
            <View style={styles.permissionHeader}>
              <Feather name="alert-triangle" size={18} color="#DC2626" style={{ marginRight: 8 }} />
              <Text style={styles.permissionTitle}>Location Permission Required</Text>
            </View>
            <Text style={styles.permissionBody}>
              RiskN ResQ requires your device GPS location to provide verified hyper-local rainfall calculations, corridor obstruction alerts, and community response dispatch.
            </Text>
            <Pressable style={styles.enableBtn} onPress={requestPermission}>
              <Feather name="crosshair" size={14} color="#FFFFFF" style={{ marginRight: 6 }} />
              <Text style={styles.enableBtnText}>Enable Location</Text>
            </Pressable>
            <Pressable style={styles.manualBtn} onPress={() => applyManualLocation(12.9716, 77.5946, 'Bengaluru (manual location)')}>
              <Text style={styles.manualBtnText}>Use Bengaluru instead (manual location)</Text>
            </Pressable>
          </View>
        )}

        {/* 1a. ACTIVE ASSISTANCE BANNER (WHEN USER HAS ACTIVE DISPATCH) */}
        {activeAssistance && activeAssistance.status !== 'COMPLETED' && activeAssistance.status !== 'CANCELLED' && (
          <View style={styles.assistanceCard}>
            <View style={styles.assistanceHeaderRow}>
              <View style={styles.assistanceIconWrap}>
                <Feather name="life-buoy" size={16} color="#FFFFFF" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.assistanceKicker}>EMERGENCY ASSISTANCE IN PROGRESS</Text>
                <Text style={styles.assistanceTitle}>
                  {prettyResource(activeAssistance.type || 'Assistance')} · #{activeAssistance.request_id}
                </Text>
              </View>
              <View style={[styles.assistanceStatusPill, {
                backgroundColor: activeAssistance.status === 'EN_ROUTE' ? '#0284C7' : activeAssistance.status === 'ARRIVED' ? '#16A34A' : '#D97706'
              }]}>
                <Text style={styles.assistanceStatusText}>{activeAssistance.status}</Text>
              </View>
            </View>

            <Text style={styles.assistanceBody}>
              {activeAssistance.volunteer
                ? `Responder ${activeAssistance.volunteer.name} is dispatched to your location.`
                : 'Request logged with coordinates. Coordinating verified local responders.'}
            </Text>

            {(activeAssistance.eta_minutes != null || activeAssistance.distance_km != null) && (
              <View style={styles.assistanceMetricsRow}>
                {activeAssistance.eta_minutes != null && (
                  <View style={styles.assistanceMetric}>
                    <Feather name="clock" size={13} color="#0284C7" style={{ marginRight: 4 }} />
                    <Text style={styles.assistanceMetricText}>ETA ~{activeAssistance.eta_minutes} min</Text>
                  </View>
                )}
                {activeAssistance.distance_km != null && (
                  <View style={styles.assistanceMetric}>
                    <Feather name="navigation" size={13} color="#059669" style={{ marginRight: 4 }} />
                    <Text style={styles.assistanceMetricText}>{activeAssistance.distance_km} km away</Text>
                  </View>
                )}
              </View>
            )}

            <Pressable
              style={styles.assistanceTrackBtn}
              onPress={() => navigate('Tracking', { requestId: activeAssistance.request_id })}
            >
              <Feather name="map" size={14} color="#FFFFFF" style={{ marginRight: 6 }} />
              <Text style={styles.assistanceTrackBtnText}>TRACK RESPONDER ON LIVE MAP</Text>
            </Pressable>
          </View>
        )}

        {/* 2. REAL MULTI-FACTOR FLOOD RISK CARD */}
        <RiskCard
          offline={source !== 'live'}
          cachedAt={cachedAt}
          risk={risk ? { ...risk, score: risk.score ?? risk.risk_score ?? 0, level: currentLevel, probabilityBasis: risk.probability_basis } : null}
        />


        {/* weather (rainfall observation only; flood risk is the card above) */}
        <FadeIn delay={staggerDelay(1)}>
          <WeatherCard monitor={weatherMonitor} at={userLocation} />

        </FadeIn>

        {/* 2b. RISK HISTORY (this zone, last 12 h, one entry per change of level) */}
        {intel && intel.risk_history && intel.risk_history.steps.length > 1 ? (
          <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: colors.muted, marginBottom: 10 }}>
            Risk history, {intel.risk_history.zone}: {intel.risk_history.steps.map((x) => `${new Date(x.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} → ${x.risk_level}`).join('   ')}
          </Text>
        ) : null}

        {/* 3b. RAINFALL OBSERVATIONS (accumulation over the last 1 / 3 / 6 / 24 hours, from the backend's cached grid) */}
        <FadeIn delay={staggerDelay(3)}>
          <SectionTitle>Recent rainfall</SectionTitle>
          {weather && weather.source ? (
            <>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                {[['1 hour', weather.rain_1h_mm], ['3 hours', weather.rain_3h_mm], ['6 hours', weather.rain_6h_mm], ['24 hours', weather.rainfall_24h_mm]].map(([label, v], i) => (
                  <MetricCard key={label} label={label.toUpperCase()} value={v == null ? '—' : Number(v)} format={(n) => `${n.toFixed(1)}`} hint="mm" color={v >= 30 ? colors.HIGH : colors.text} delay={staggerDelay(i, 60)} />
                ))}
              </View>
              <Text style={styles.obs}>
                Rainfall observation · {weather.source}{weather.observed_at ? ` · ${ago(weather.observed_at)}` : ''}{weather.stale ? ' · STALE DATA' : ''}
                {weather.forecast_3h_mm != null ? ` · forecast next 3 h: ${Number(weather.forecast_3h_mm).toFixed(1)} mm` : ''}
              </Text>
            </>
          ) : (
            <StateView kind="empty" compact title="Weather data unavailable" message="Rainfall figures will appear when the weather service responds." icon="cloud-off" />
          )}
        </FadeIn>

        {/* 3c. NEARBY INCIDENTS (community reports within 5 km: supporting evidence, not confirmed flooding) */}
        <FadeIn delay={staggerDelay(4)}>
          <SectionTitle>Nearby incident reports</SectionTitle>
          {nearby.length === 0 ? (
            <StateView kind="empty" compact title="No active incidents have been reported in this area." message="Community reports appear here and support the environmental data; one report does not by itself mean flooding." icon="shield" />
          ) : nearby.map((i) => (
            <View key={i.id} style={styles.nearRow}>
              <View style={[styles.nearDot, { backgroundColor: i.status === 'VERIFIED' ? colors.LOW : colors.MEDIUM }]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.nearTitle} numberOfLines={1}>{String(i.type || 'Incident').replace(/_/g, ' ')} · {i.distance.toFixed(1)} km</Text>
                <Text style={styles.nearSub} numberOfLines={1}>{i.status === 'VERIFIED' ? 'Verified by an administrator' : 'Community report, not yet verified'} · {timeAgo(i.timestamp)}</Text>
              </View>
            </View>
          ))}
        </FadeIn>

        {/* 4. ACTIVE ALERT OR STATUS NOTICE */}
        {topAlert ? (
          <AlertCard
            alert={topAlert}
            road={blocked.length ? blocked.map((r) => r.name).join(', ') : undefined}
            onViewRoute={() => navigate('Map')}
          />
        ) : currentLevel !== 'LOW' ? (
          <View style={[styles.status, { borderLeftColor: riskColor(currentLevel) }]}>
            <View style={styles.statusHeader}>
              <Feather
                name={currentLevel === 'CRITICAL' || currentLevel === 'HIGH' ? 'alert-octagon' : 'alert-circle'}
                size={16}
                color={riskColor(currentLevel)}
                style={{ marginRight: 6 }}
              />
              <Text style={[styles.statusTitle, { color: riskColor(currentLevel) }]}>{title}</Text>
            </View>
            <Text style={styles.statusBody}>{body}</Text>
          </View>
        ) : null}

        {/* 5. ACTION GRID */}
        <View style={styles.gridContainer}>
          <View style={styles.gridRow}>
            <ActionButton
              iconName="map"
              image={symbols.map}
              label="Live Map"
              color={colors.primary}
              onPress={() => navigate('Map')}
            />
            <ActionButton
              iconName="navigation"
              image={symbols.route}
              label="Alternative Route"
              color="#0284C7"
              onPress={() => navigate('Map')}
            />
          </View>
          <View style={styles.gridRow}>
            <ActionButton
              iconName="alert-triangle"
              image={symbols.report}
              label="Report Incident"
              color="#D97706"
              onPress={() => navigate('Report')}
            />
            <ActionButton
              iconName="life-buoy"
              image={symbols.help}
              label="Request Help"
              color="#DC2626"
              onPress={() => navigate('Help')}
            />
          </View>
        </View>

        {/* 6. AFFECTED AREA & BLOCKED CORRIDORS SUMMARY */}
        <View style={styles.info}>
          <Row
            label="Monitored Area"
            value={locationLabel || 'Current Coordinates'}
          />
          <View style={styles.sep} />
          <Row
            label="Affected Area"
            value={topAlert ? (topAlert.affected_zone || 'Monitored area') : 'None'}
            color={topAlert ? colors.HIGH : colors.LOW}
          />
          <View style={styles.sep} />
          <Row
            label="Blocked Road"
            value={blocked.length ? blocked.slice(0, 2).map((b) => b.name).join(', ') + (blocked.length > 2 ? ` +${blocked.length - 2}` : '') : 'None reported'}
            color={blocked.length ? colors.HIGH : colors.LOW}
          />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  obs: { fontFamily: 'PlusJakartaSans_500Medium', fontSize: 11, color: colors.muted, marginTop: 8, marginBottom: 6, lineHeight: 16 },
  nearRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.card, borderRadius: 14, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: colors.border },
  nearDot: { width: 10, height: 10, borderRadius: 5 },
  nearTitle: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: colors.text },
  nearSub: { fontFamily: 'PlusJakartaSans_500Medium', fontSize: 12, color: colors.muted, marginTop: 1 },
  manualBtn: { marginTop: 10, alignItems: 'center', paddingVertical: 8 },
  manualBtnText: { color: '#991B1B', fontSize: 13, fontFamily: 'PlusJakartaSans_700Bold', textDecorationLine: 'underline' },
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  locLabel: {
    color: '#94A3B8',
    fontFamily: 'PlusJakartaSans_500Medium',
    fontSize: 12,
    marginRight: 4,
  },
  loc: {
    color: '#F8FAFC',
    fontSize: 13,
    fontFamily: 'PlusJakartaSans_700Bold',
    flex: 1,
  },
  body: {
    padding: 14,
    gap: 12,
  },
  pill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  pillText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontFamily: 'PlusJakartaSans_800ExtraBold',
    letterSpacing: 0.5,
  },
  permissionCard: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: radius.card,
    padding: 14,
    ...shadow,
  },
  permissionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  permissionTitle: {
    fontSize: 14,
    fontFamily: 'PlusJakartaSans_800ExtraBold',
    color: '#DC2626',
  },
  permissionBody: {
    fontFamily: 'PlusJakartaSans_500Medium',
    fontSize: 12,
    lineHeight: 17,
    color: '#7F1D1D',
    marginBottom: 10,
  },
  enableBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#DC2626',
    borderRadius: 8,
    paddingVertical: 9,
    paddingHorizontal: 14,
  },
  enableBtnText: {
    color: '#FFFFFF',
    fontFamily: 'PlusJakartaSans_700Bold',
    fontSize: 13,
  },
  telemetryCard: {
    backgroundColor: colors.card,
    borderRadius: radius.card,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    ...shadow,
  },
  telemetryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  telemetryKicker: {
    fontSize: 10,
    fontFamily: 'PlusJakartaSans_800ExtraBold',
    color: colors.muted,
    letterSpacing: 0.8,
  },
  telemetryTime: {
    fontSize: 10,
    fontFamily: 'PlusJakartaSans_600SemiBold',
    color: colors.muted,
  },
  telemetryGrid: {
    flexDirection: 'row',
    gap: 8,
  },
  telemetryItem: {
    flex: 1,
    backgroundColor: colors.bg,
    borderRadius: 8,
    padding: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  telemetryLabel: {
    fontSize: 10,
    color: colors.muted,
    fontFamily: 'PlusJakartaSans_600SemiBold',
  },
  telemetryValue: {
    fontSize: 14,
    fontFamily: 'PlusJakartaSans_800ExtraBold',
    color: colors.text,
    marginTop: 2,
  },
  attributionText: {
    fontSize: 10,
    fontFamily: 'PlusJakartaSans_500Medium',
    color: '#94A3B8',
    marginTop: 6,
    fontStyle: 'italic',
  },
  status: {
    backgroundColor: colors.card,
    borderRadius: radius.card,
    borderLeftWidth: 5,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    ...shadow,
  },
  statusHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  statusTitle: {
    fontSize: 14,
    fontFamily: 'PlusJakartaSans_800ExtraBold',
    letterSpacing: 0.4,
  },
  statusBody: {
    fontFamily: 'PlusJakartaSans_500Medium',
    fontSize: 13,
    lineHeight: 18,
    color: colors.text,
  },
  gridContainer: {
    gap: 10,
  },
  gridRow: {
    flexDirection: 'row',
    gap: 10,
  },
  info: {
    backgroundColor: colors.card,
    borderRadius: radius.card,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    ...shadow,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  rl: {
    fontSize: 13,
    color: colors.muted,
    fontFamily: 'PlusJakartaSans_600SemiBold',
  },
  rv: {
    fontSize: 14,
    fontFamily: 'PlusJakartaSans_800ExtraBold',
    color: colors.text,
    flexShrink: 1,
    textAlign: 'right',
  },
  sep: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: 10,
  },
  assistanceCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: radius.card,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1.5,
    borderColor: '#0284C7',
    ...shadow,
  },
  assistanceHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  assistanceIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#0284C7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  assistanceKicker: {
    fontSize: 9.5,
    fontFamily: 'PlusJakartaSans_800ExtraBold',
    color: '#0284C7',
    letterSpacing: 0.8,
  },
  assistanceTitle: {
    fontSize: 15,
    fontFamily: 'PlusJakartaSans_800ExtraBold',
    color: colors.text,
  },
  assistanceStatusPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  assistanceStatusText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontFamily: 'PlusJakartaSans_800ExtraBold',
    letterSpacing: 0.5,
  },
  assistanceBody: {
    fontSize: 13,
    fontFamily: 'PlusJakartaSans_500Medium',
    color: '#475569',
    lineHeight: 18,
    marginBottom: 10,
  },
  assistanceMetricsRow: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: 12,
  },
  assistanceMetric: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  assistanceMetricText: {
    fontSize: 12,
    fontFamily: 'PlusJakartaSans_700Bold',
    color: colors.text,
  },
  assistanceTrackBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.route,
    borderRadius: radius.button,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  assistanceTrackBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontFamily: 'PlusJakartaSans_800ExtraBold',
    letterSpacing: 0.5,
  },
});
