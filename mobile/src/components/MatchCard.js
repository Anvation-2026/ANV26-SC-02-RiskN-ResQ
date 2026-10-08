import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, radius } from '../theme';
import { formatDistance } from '../features/disaster-response/utils/distance';

const Cell = ({ label, value }) => (
  <View style={styles.cell}>
    <Text style={styles.cl}>{label}</Text>
    <Text style={styles.cv}>{value}</Text>
  </View>
);

export default function MatchCard({ match, requestId }) {
  return (
    <View style={styles.card}>
      <Text style={styles.head}>🤝 MATCH FOUND</Text>
      {requestId ? <Text style={styles.req}>Request #{requestId}</Text> : null}
      <View style={styles.grid}>
        <Cell label="Volunteer" value={match.volunteer} />
        <Cell label="Resource" value={match.resource} />
        <Cell label="Distance" value={formatDistance(match.distanceKm)} />
        <Cell label="Status" value={`● ${match.status}`} />
      </View>
      <View style={styles.scoreBox}>
        <Text style={styles.cl}>Match Score</Text>
        <Text style={styles.score}>{match.score}%</Text>
        <View style={styles.track}><View style={[styles.fill, { width: `${match.score}%` }]} /></View>
        {match.breakdown ? (
          <Text style={styles.why}>
            Resource {match.breakdown.resourceCompatibility} · Availability {match.breakdown.availabilityScore} · Distance {match.breakdown.distanceScore} · Priority {match.breakdown.priorityScore}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#ECFDF5', borderRadius: radius.card + 4, borderWidth: 2, borderColor: colors.LOW, padding: 20, boxShadow: '0 10px 24px rgba(22,163,74,0.2)' },
  head: { fontSize: 22, fontFamily: 'PlusJakartaSans_800ExtraBold', color: '#065F46' },
  req: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 13, color: '#047857', marginTop: 2, marginBottom: 14 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 6 },
  cell: { flexBasis: '47%', flexGrow: 1, backgroundColor: '#fff', borderRadius: 14, padding: 12 },
  cl: { fontSize: 12, fontFamily: 'PlusJakartaSans_700Bold', color: colors.muted, letterSpacing: 0.6 },
  cv: { fontSize: 17, fontFamily: 'PlusJakartaSans_800ExtraBold', color: colors.text, marginTop: 2 },
  scoreBox: { backgroundColor: '#fff', borderRadius: 14, padding: 14, marginTop: 10 },
  score: { fontSize: 38, fontFamily: 'PlusJakartaSans_800ExtraBold', color: colors.LOW },
  why: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12, color: colors.muted, marginTop: 8, lineHeight: 18 },
  track: { height: 8, backgroundColor: '#D1FAE5', borderRadius: 4, overflow: 'hidden', marginTop: 4 },
  fill: { height: 8, backgroundColor: colors.LOW },
});
