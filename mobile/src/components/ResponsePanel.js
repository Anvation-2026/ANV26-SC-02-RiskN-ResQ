import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import ActionButton from './ActionButton';
import MatchCard from './MatchCard';
import { RESOURCES, useResponse } from '../context/ResponseContext';
import { useData } from '../context/DataContext';
import { getRiskLevelColor } from '../features/disaster-response/services/geofencing';
import { colors, radius, shadow } from '../theme';

const Chip = ({ active, onPress, children }) => (
  <Pressable
    onPress={onPress}
    style={[styles.chip, active && styles.chipOn]}
    hitSlop={4}
  >
    <Text style={[styles.chipText, active && styles.chipTextOn]}>{children}</Text>
  </Pressable>
);

function Card({ title, children }) {
  return (
    <View style={styles.card}>
      <Text style={styles.kicker}>{title}</Text>
      {children}
    </View>
  );
}

const Stat = ({ label, value }) => (
  <View style={styles.stat}>
    <Text style={styles.sl}>{label}</Text>
    <Text style={styles.sv}>{value}</Text>
  </View>
);

export default function ResponsePanel() {
  const { locationLabel, userLocation } = useData();
  const {
    assessment,
    route,
    match,
    resource,
    setResource,
    destinationVolunteer,
    destinationLabel,
    isRouting,
    requestRoute,
    requestResource,
  } = useResponse();

  const risk = getRiskLevelColor(assessment?.riskLevel || 'LOW');

  // Adapt the real match to MatchCard props
  const cardMatch = match?.matched && match.volunteer
    ? {
        volunteer: match.volunteer.name,
        resource: match.volunteer.resource || match.volunteer.skill || resource,
        distanceKm: match.distanceKm || 0,
        status: 'Available',
        score: match.matchScore || 85,
        breakdown: match.scoreBreakdown,
      }
    : null;

  const originName = locationLabel || 'Your Current Position';
  const destName = destinationVolunteer
    ? `${destinationVolunteer.name} (${destinationVolunteer.resource || destinationVolunteer.skill || 'Responder'})`
    : destinationLabel || 'Nearest Response Hub';

  return (
    <View style={{ gap: 10 }}>
      {/* 1. GEOFENCE & RISK LEVEL */}
      <Card title="GEOFENCE TELEMETRY">
        <View style={styles.rowBetween}>
          <Text style={styles.big}>
            {assessment?.insideRiskZone ? 'Within Flood-Risk Zone' : 'Outside Flood-Risk Zone'}
          </Text>
          <View style={[styles.pill, { backgroundColor: risk.badgeBg }]}>
            <Text style={[styles.pillText, { color: risk.badgeText }]}>
              {assessment?.riskLevel || 'LOW'}
            </Text>
          </View>
        </View>
        <Text style={styles.muted}>
          {assessment?.reason || 'Verified through live environmental telemetry'}
        </Text>
      </Card>

      {/* 2. ROUTE COMPUTATION */}
      <Card title="RECOMMENDED CORRIDOR">
        <Text style={styles.corridorName}>
          {originName} → {destName}
        </Text>
        <View style={{ marginTop: 8 }}>
          <ActionButton
            variant="primary"
            label={isRouting ? 'CALCULATING ROUTE...' : route ? 'RECALCULATE ROUTE' : 'CALCULATE ROUTE'}
            disabled={isRouting || !userLocation}
            onPress={() => requestRoute()}
          />
        </View>

        {!route && (
          <View style={styles.noRouteBox}>
            <Feather name="info" size={13} color={colors.muted} style={{ marginRight: 6 }} />
            <Text style={styles.noRouteText}>Tap Calculate Route to compute an incident-aware corridor via road network.</Text>
          </View>
        )}

        {route && route.success && (
          <View style={{ marginTop: 10 }}>
            <Text style={styles.big}>
              {route.blockedRoads && route.blockedRoads.length > 0
                ? 'Recommended alternative route'
                : 'Direct primary corridor'}
            </Text>
            <View style={styles.stats}>
              <Stat label="Distance" value={`${(route.distanceKm || 0).toFixed(1)} km`} />
              <Stat label="Est. Time" value={`${route.etaMinutes || 0} min`} />
            </View>
            <Text style={styles.why}>Reason: {route.reason || 'Optimal path'}</Text>
            {route.blockedRoads && route.blockedRoads.length > 0 && (
              <View style={styles.avoidBox}>
                <Feather name="alert-triangle" size={13} color={colors.HIGH} style={{ marginRight: 4 }} />
                <Text style={styles.warn}>
                  Avoiding: {route.blockedRoads.map((r) => r?.name || r?.id || 'Hazard blockage').join(', ')}
                </Text>
              </View>
            )}
            <Text style={styles.note}>{route.safetyNote}</Text>
          </View>
        )}

        {route && !route.success && (
          <Text style={styles.warn}>{route.reason || 'No route found'}. {route.safetyNote || ''}</Text>
        )}
      </Card>

      {/* 3. REQUEST RESOURCE */}
      <Card title="REQUEST EMERGENCY SUPPLIES">
        <View style={styles.wrap}>
          {RESOURCES.map((r) => (
            <Chip key={r} active={resource === r} onPress={() => setResource(r)}>
              {r}
            </Chip>
          ))}
        </View>
        <View style={{ marginTop: 10 }}>
          <ActionButton
            variant="primary"
            label={`REQUEST ${resource.toUpperCase()}`}
            color={colors.HIGH}
            onPress={() => requestResource(resource)}
          />
        </View>
      </Card>

      {/* 4. MATCH RESULT */}
      {match && (
        cardMatch ? (
          <MatchCard match={cardMatch} />
        ) : (
          <View style={styles.none}>
            <Text style={styles.noneTitle}>No matching volunteer currently available.</Text>
            <Text style={styles.muted}>
              {match.message || 'No available volunteer currently matches this resource within your area.'}
            </Text>
          </View>
        )
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.card,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    ...shadow,
  },
  kicker: {
    fontSize: 10,
    fontFamily: 'PlusJakartaSans_800ExtraBold',
    letterSpacing: 0.8,
    color: colors.muted,
    marginBottom: 6,
  },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  big: {
    fontSize: 14,
    fontFamily: 'PlusJakartaSans_800ExtraBold',
    color: colors.text,
    flex: 1,
  },
  corridorName: {
    fontSize: 13,
    fontFamily: 'PlusJakartaSans_700Bold',
    color: colors.text,
  },
  pill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  pillText: {
    fontSize: 10,
    fontFamily: 'PlusJakartaSans_800ExtraBold',
    letterSpacing: 0.5,
  },
  muted: {
    fontSize: 12,
    fontFamily: 'PlusJakartaSans_500Medium',
    color: colors.muted,
    marginTop: 4,
  },
  stats: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 6,
  },
  stat: {
    flex: 1,
    backgroundColor: colors.bg,
    borderRadius: 10,
    padding: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  sl: {
    fontSize: 10,
    color: colors.muted,
    fontFamily: 'PlusJakartaSans_600SemiBold',
  },
  sv: {
    fontSize: 14,
    fontFamily: 'PlusJakartaSans_800ExtraBold',
    color: colors.text,
    marginTop: 2,
  },
  why: {
    fontSize: 12,
    fontFamily: 'PlusJakartaSans_600SemiBold',
    color: '#475569',
    marginTop: 6,
  },
  avoidBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF2F2',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 6,
    marginTop: 6,
  },
  warn: {
    fontSize: 12,
    fontFamily: 'PlusJakartaSans_700Bold',
    color: colors.HIGH,
  },
  note: {
    fontSize: 11,
    fontFamily: 'PlusJakartaSans_500Medium',
    color: colors.muted,
    fontStyle: 'italic',
    marginTop: 6,
  },
  wrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  chip: {
    backgroundColor: '#F1F5F9',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  chipOn: {
    backgroundColor: colors.navy,
    borderColor: colors.navy,
  },
  chipText: {
    fontFamily: 'PlusJakartaSans_600SemiBold',
    fontSize: 12,
    color: '#475569',
  },
  chipTextOn: {
    color: '#FFFFFF',
    fontFamily: 'PlusJakartaSans_700Bold',
  },
  noRouteBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderRadius: 8,
    padding: 10,
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  noRouteText: {
    fontSize: 12,
    fontFamily: 'PlusJakartaSans_500Medium',
    color: colors.muted,
    flex: 1,
  },
  none: {
    backgroundColor: '#FFFBEB',
    borderRadius: radius.card,
    padding: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  noneTitle: {
    fontSize: 14,
    fontFamily: 'PlusJakartaSans_800ExtraBold',
    color: '#92400E',
    marginBottom: 4,
    textAlign: 'center',
  },
});
