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
import { timeAgo } from '../services/geo';

const TEXT = {
  LOW: ['LOW FLOOD RISK', 'Drainage and street runoff within normal limits. No severe hazard reported.'],
  MODERATE: ['MODERATE FLOOD RISK', 'Elevated precipitation detected. Water accumulation monitored in low-lying corridors.'],
  HIGH: ['HIGH FLOOD RISK', 'Heavy rainfall intensity. Waterlogging and road obstructions confirmed.'],
  CRITICAL: ['CRITICAL FLOOD RISK', 'Severe localized flooding. Essential transport corridors compromised. Evacuation alert.'],
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
    incidents,
    alerts,
    blocked,
    source,
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
  const topAlert = alerts.length > 0 ? alerts[0] : null; // strongest active alert (zone alert or reported incident)

  const isPermissionDenied = locationStatus === 'denied' || locationStatus === 'error';

  return (
    <View style={styles.container}>
      <Header
        title="RiskNResQ"
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
              RiskNResQ requires your device GPS location to provide verified hyper-local rainfall calculations, corridor obstruction alerts, and community response dispatch.
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

        {/* 1b. WEATHER (rainfall only; flood risk is the separate card below) */}
        <WeatherCard monitor={weatherMonitor} at={userLocation} />

        {/* 2. REAL MULTI-FACTOR FLOOD RISK CARD */}
        <RiskCard
          offline={source !== 'live'}
          risk={
            risk
              ? {
                  score: risk.score ?? risk.risk_score ?? 0,
                  level: currentLevel,
                  reason: risk.reason,
                  drill: risk.drill,
                  zoneAlert: risk.zoneAlert,
                }
              : null
          }
        />

        {/* 3. ENVIRONMENTAL TELEMETRY ATTRIBUTION */}
        {risk && (
          <View style={styles.telemetryCard}>
            <View style={styles.telemetryHeader}>
              <Text style={styles.telemetryKicker}>ENVIRONMENTAL TELEMETRY</Text>
              <Text style={styles.telemetryTime}>
                {lastUpdated ? `Updated ${timeAgo(new Date(lastUpdated).toISOString())}` : 'Live'}
              </Text>
            </View>
            <View style={styles.telemetryGrid}>
              <View style={styles.telemetryItem}>
                <Text style={styles.telemetryLabel}>24h Rainfall</Text>
                <Text style={styles.telemetryValue}>
                  {risk.rainfall_24h_mm != null ? `${Number(risk.rainfall_24h_mm).toFixed(1)} mm` : '0.0 mm'}
                </Text>
              </View>
              <View style={styles.telemetryItem}>
                <Text style={styles.telemetryLabel}>Rain Rate</Text>
                <Text style={styles.telemetryValue}>
                  {risk.rainfall_intensity_mm_per_hour != null
                    ? `${Number(risk.rainfall_intensity_mm_per_hour).toFixed(1)} mm/h`
                    : '0.0 mm/h'}
                </Text>
              </View>
              <View style={styles.telemetryItem}>
                <Text style={styles.telemetryLabel}>Active Incidents</Text>
                <Text style={styles.telemetryValue}>{activeIncidents.length}</Text>
              </View>
            </View>
            {risk.weather_source && (
              <Text style={styles.attributionText}>Source: {risk.weather_source}</Text>
            )}
          </View>
        )}

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
});
