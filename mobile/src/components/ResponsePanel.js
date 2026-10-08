import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import ActionButton from './ActionButton';
import MatchCard from './MatchCard';
import { Chip } from '../screens/ReportScreen';
import { RESOURCES, useResponse } from '../context/ResponseContext';
import { getRiskLevelColor } from '../features/disaster-response/services/geofencing';
import { formatDistance } from '../features/disaster-response/utils/distance';
import { DEMO_CONTROLS } from '../config/api';
import { colors, radius, shadow } from '../theme';

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
  const {
    assessment,
    route,
    match,
    resource,
    setResource,
    roadDemo,
    graph,
    requestRoute,
    requestResource,
    block,
    unblock,
    reset,
  } = useResponse();

  const isBlocked = roadDemo?.status === 'BLOCKED';
  const risk = getRiskLevelColor(assessment.riskLevel);

  // Adapt the module's MatchResult to MatchCard props
  const cardMatch = match?.matched
    ? {
        volunteer: match.volunteer.name,
        resource: match.resource,
        distanceKm: match.distanceKm,
        status: 'Available',
        score: match.matchScore,
        breakdown: match.scoreBreakdown,
      }
    : null;

  return (
    <View style={{ gap: 10 }}>
      {/* 1. LOCATION & GEOFENCE */}
      <Card title="GEOFENCE TELEMETRY">
        <View style={styles.rowBetween}>
          <Text style={styles.big}>
            {assessment.insideRiskZone ? 'Within Flood-Risk Zone' : 'Outside Flood-Risk Zone'}
          </Text>
          <View style={[styles.pill, { backgroundColor: risk.badgeBg }]}>
            <Text style={[styles.pillText, { color: risk.badgeText }]}>
              {assessment.riskLevel}
            </Text>
          </View>
        </View>
        <Text style={styles.muted}>
          Distance to zone center: {formatDistance(assessment.distanceKm)}
        </Text>
      </Card>

      {/* 2. ROUTE COMPUTATION */}
      <Card title="RECOMMENDED CORRIDOR">
        <Text style={styles.muted}>
          {graph.nodes.A.name} → {graph.nodes.D.name}
        </Text>
        <View style={{ marginTop: 8 }}>
          <ActionButton
            variant="primary"
            label={route ? 'RECALCULATE ROUTE' : 'CALCULATE ROUTE'}
            onPress={requestRoute}
          />
        </View>
        {route && route.success && (
          <View style={{ marginTop: 10 }}>
            <Text style={styles.big}>
              {route.blockedRoads.length
                ? 'Recommended alternative route'
                : 'Direct primary corridor'}
            </Text>
            <View style={styles.stats}>
              <Stat label="Distance" value={`${route.distanceKm.toFixed(1)} km`} />
              <Stat label="Est. Time" value={`${route.etaMinutes} min`} />
            </View>
            <Text style={styles.why}>Reason: {route.reason}</Text>
            {route.blockedRoads.length > 0 && (
              <View style={styles.avoidBox}>
                <Feather name="alert-triangle" size={13} color={colors.HIGH} style={{ marginRight: 4 }} />
                <Text style={styles.warn}>
                  Avoiding: {route.blockedRoads.map((r) => r.name).join(', ')}
                </Text>
              </View>
            )}
            <Text style={styles.note}>{route.safetyNote}</Text>
          </View>
        )}
        {route && !route.success && (
          <Text style={styles.warn}>{route.reason}. {route.safetyNote}</Text>
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
            onPress={() => requestResource()}
          />
        </View>
      </Card>

      {/* 4. MATCH RESULT */}
      {match && (
        cardMatch ? (
          <MatchCard match={cardMatch} />
        ) : (
          <View style={styles.none}>
            <Text style={styles.noneTitle}>{match.message}</Text>
            <Text style={styles.muted}>
              No available volunteer currently matches this resource.
            </Text>
          </View>
        )
      )}

      {/* 5. DEMO CONTROLS */}
      {DEMO_CONTROLS && (
        <View style={styles.demo}>
          <View style={styles.rowBetween}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Feather name="sliders" size={14} color="#64748B" style={{ marginRight: 6 }} />
              <Text style={styles.demoTitle}>DEMO CONTROLS</Text>
            </View>
            <View style={[styles.pill, { backgroundColor: isBlocked ? '#FEE2E2' : '#DCFCE7' }]}>
              <Text style={[styles.pillText, { color: isBlocked ? '#991B1B' : '#166534' }]}>
                {roadDemo?.name}: {isBlocked ? 'BLOCKED' : 'OPEN'}
              </Text>
            </View>
          </View>
          <View style={styles.btns}>
            <View style={{ flex: 1 }}>
              <ActionButton
                variant="primary"
                label="Block Road A"
                color={colors.HIGH}
                disabled={isBlocked}
                onPress={block}
              />
            </View>
            <View style={{ flex: 1 }}>
              <ActionButton
                variant="primary"
                label="Unblock Road A"
                color={colors.LOW}
                disabled={!isBlocked}
                onPress={unblock}
              />
            </View>
          </View>
          <View style={{ marginTop: 8 }}>
            <ActionButton
              variant="primary"
              label="Reset Demo State"
              color={colors.navy}
              onPress={reset}
            />
          </View>
        </View>
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
    fontSize: 12,
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
  pill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  pillText: {
    fontSize: 12,
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
    fontSize: 12,
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
    fontSize: 12,
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
  },
  demo: {
    backgroundColor: colors.card,
    borderRadius: radius.card,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    ...shadow,
  },
  demoTitle: {
    fontSize: 12,
    fontFamily: 'PlusJakartaSans_800ExtraBold',
    color: colors.text,
    letterSpacing: 0.8,
  },
  btns: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
});
