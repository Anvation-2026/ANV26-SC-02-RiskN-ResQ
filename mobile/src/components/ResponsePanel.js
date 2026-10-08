import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import ActionButton from './ActionButton';
import MatchCard from './MatchCard';
import { Chip } from '../screens/ReportScreen';
import { RESOURCES, useResponse } from '../context/ResponseContext';
import { getRiskLevelColor } from '../features/disaster-response/services/geofencing';
import { formatDistance } from '../features/disaster-response/utils/distance';
import { DEMO_CONTROLS } from '../config/api';
import { colors, radius, shadow } from '../theme';

const F = { r: 'PlusJakartaSans_400Regular', s: 'PlusJakartaSans_600SemiBold', b: 'PlusJakartaSans_700Bold', x: 'PlusJakartaSans_800ExtraBold' };

function Card({ title, children }) {
  return (
    <View style={styles.card}>
      <Text style={styles.kicker}>{title}</Text>
      {children}
    </View>
  );
}

const Stat = ({ label, value }) => (
  <View style={styles.stat}><Text style={styles.sl}>{label}</Text><Text style={styles.sv}>{value}</Text></View>
);

export default function ResponsePanel() {
  const { assessment, route, match, resource, setResource, roadDemo, graph, requestRoute, requestResource, block, unblock, reset } = useResponse();
  const isBlocked = roadDemo?.status === 'BLOCKED';
  const risk = getRiskLevelColor(assessment.riskLevel);

  // Adapt the module's MatchResult to the existing MatchCard props.
  const cardMatch = match?.matched
    ? { volunteer: match.volunteer.name, resource: match.resource, distanceKm: match.distanceKm, status: 'Available', score: match.matchScore, breakdown: match.scoreBreakdown }
    : null;

  return (
    <View style={{ gap: 14 }}>
      <Card title="LOCATION & GEOFENCE">
        <View style={styles.rowBetween}>
          <Text style={styles.big}>{assessment.insideRiskZone ? 'Inside flood-risk zone' : 'Outside flood-risk zone'}</Text>
          <View style={[styles.pill, { backgroundColor: risk.badgeBg }]}>
            <Text style={[styles.pillText, { color: risk.badgeText }]}>{assessment.riskLevel}</Text>
          </View>
        </View>
        <Text style={styles.muted}>Distance to zone centre: {formatDistance(assessment.distanceKm)}</Text>
      </Card>

      <Card title="ROUTE">
        <Text style={styles.muted}>{graph.nodes.A.name} → {graph.nodes.D.name}</Text>
        <View style={{ marginTop: 12 }}>
          <ActionButton variant="primary" label={route ? 'REQUEST ROUTE AGAIN' : 'REQUEST ROUTE'} onPress={requestRoute} />
        </View>
        {route && route.success && (
          <View style={{ marginTop: 14 }}>
            <Text style={styles.big}>{route.blockedRoads.length ? 'Recommended alternative route' : 'Recommended route'}</Text>
            <View style={styles.stats}>
              <Stat label="Distance" value={`${route.distanceKm.toFixed(1)} km`} />
              <Stat label="ETA" value={`${route.etaMinutes} min`} />
            </View>
            <Text style={styles.why}>Reason: {route.reason}</Text>
            {route.blockedRoads.length > 0 && <Text style={styles.warn}>🚧 Avoiding: {route.blockedRoads.map((r) => r.name).join(', ')}</Text>}
            <Text style={styles.note}>{route.safetyNote}</Text>
          </View>
        )}
        {route && !route.success && <Text style={styles.warn}>{route.reason}. {route.safetyNote}</Text>}
      </Card>

      <Card title="REQUEST A RESOURCE">
        <View style={styles.wrap}>{RESOURCES.map((r) => <Chip key={r} active={resource === r} onPress={() => setResource(r)}>{r}</Chip>)}</View>
        <View style={{ marginTop: 12 }}><ActionButton variant="primary" label={`REQUEST ${resource.toUpperCase()}`} color={colors.HIGH} onPress={() => requestResource()} /></View>
      </Card>
      {match && (cardMatch ? <MatchCard match={cardMatch} /> : (
        <View style={styles.none}>
          <Text style={styles.noneTitle}>{match.message}</Text>
          <Text style={styles.muted}>No available volunteer has the requested resource.</Text>
        </View>
      ))}

      {DEMO_CONTROLS && (
        <View style={styles.demo}>
          <View style={styles.rowBetween}>
            <Text style={styles.demoTitle}>🛠 DEMO CONTROLS</Text>
            <View style={[styles.pill, { backgroundColor: isBlocked ? '#FEE2E2' : '#DCFCE7' }]}>
              <Text style={[styles.pillText, { color: isBlocked ? '#991B1B' : '#166534' }]}>{roadDemo?.name}: {isBlocked ? 'BLOCKED' : 'OPEN'}</Text>
            </View>
          </View>
          <View style={styles.btns}>
            <View style={{ flex: 1 }}><ActionButton variant="primary" label="Block Road" color={colors.HIGH} disabled={isBlocked} onPress={block} /></View>
            <View style={{ flex: 1 }}><ActionButton variant="primary" label="Unblock Road" color={colors.LOW} disabled={!isBlocked} onPress={unblock} /></View>
          </View>
          <View style={{ marginTop: 10 }}><ActionButton variant="primary" label="Reset Demo" color={colors.navy} onPress={reset} /></View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: radius.card, padding: 18, ...shadow },
  kicker: { fontFamily: F.x, fontSize: 12, letterSpacing: 1.2, color: colors.muted, marginBottom: 10 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  big: { fontFamily: F.x, fontSize: 17, color: colors.text, flexShrink: 1 },
  muted: { fontFamily: F.r, fontSize: 13, color: colors.muted, marginTop: 4, lineHeight: 19 },
  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  pillText: { fontFamily: F.x, fontSize: 12 },
  stats: { flexDirection: 'row', gap: 10, marginTop: 10 },
  stat: { flex: 1, backgroundColor: colors.bg, borderRadius: 14, padding: 12 },
  sl: { fontFamily: F.s, fontSize: 12, color: colors.muted },
  sv: { fontFamily: F.x, fontSize: 22, color: colors.text },
  why: { fontFamily: F.b, fontSize: 14, color: colors.text, marginTop: 12 },
  warn: { fontFamily: F.b, fontSize: 14, color: colors.HIGH, marginTop: 8, lineHeight: 20 },
  note: { fontFamily: F.r, fontSize: 12, color: colors.muted, marginTop: 10, lineHeight: 18 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  none: { backgroundColor: '#FEF3C7', borderRadius: radius.card, padding: 18, borderWidth: 1, borderColor: '#FCD34D' },
  noneTitle: { fontFamily: F.x, fontSize: 17, color: '#78350F' },
  demo: { borderWidth: 2, borderStyle: 'dashed', borderColor: '#F59E0B', backgroundColor: '#FFFBEB', borderRadius: 16, padding: 14 },
  demoTitle: { fontFamily: F.x, fontSize: 13, color: '#92400E' },
  btns: { flexDirection: 'row', gap: 10, marginTop: 12 },
});
