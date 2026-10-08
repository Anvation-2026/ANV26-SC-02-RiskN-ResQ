import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { colors, radius, shadow } from '../theme';
import { formatDistance } from '../features/disaster-response/utils/distance';

const Cell = ({ label, value }) => (
  <View style={styles.cell}>
    <Text style={styles.cl}>{label}</Text>
    <Text style={styles.cv} numberOfLines={1}>{value}</Text>
  </View>
);

export default function MatchCard({ match, requestId }) {
  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <View style={styles.badgeRow}>
          <Feather name="check-circle" size={16} color="#065F46" style={{ marginRight: 6 }} />
          <Text style={styles.head}>VOLUNTEER FOUND</Text>
        </View>
        {requestId ? <Text style={styles.req}>#{requestId}</Text> : null}
      </View>

      <View style={styles.grid}>
        <Cell label="Volunteer" value={match.volunteer} />
        <Cell label="Resource" value={match.resource} />
        <Cell label="Proximity" value={formatDistance(match.distanceKm)} />
        <Cell label="Status" value={match.status || 'Available'} />
      </View>

      <View style={styles.scoreBox}>
        <View style={styles.scoreHeader}>
          <Text style={styles.scoreLabel}>MATCH SCORE</Text>
          <Text style={styles.score}>{match.score} / 100</Text>
        </View>
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${Math.min(100, match.score)}%` }]} />
        </View>
        {match.breakdown ? (
          <Text style={styles.why}>
            Resource: +{match.breakdown.resourceCompatibility} · Availability: +{match.breakdown.availabilityScore} · Proximity: +{match.breakdown.distanceScore} · Priority: +{match.breakdown.priorityScore}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#ECFDF5',
    borderRadius: radius.card,
    borderWidth: 1.5,
    borderColor: '#A7F3D0',
    padding: 14,
    marginTop: 6,
    ...shadow,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  head: {
    fontSize: 14,
    fontFamily: 'PlusJakartaSans_800ExtraBold',
    color: '#065F46',
    letterSpacing: 0.5,
  },
  req: {
    fontFamily: 'PlusJakartaSans_600SemiBold',
    fontSize: 12,
    color: '#047857',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 2,
  },
  cell: {
    flexBasis: '47%',
    flexGrow: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: '#D1FAE5',
  },
  cl: {
    fontSize: 12,
    fontFamily: 'PlusJakartaSans_700Bold',
    color: colors.muted,
    letterSpacing: 0.5,
  },
  cv: {
    fontSize: 14,
    fontFamily: 'PlusJakartaSans_800ExtraBold',
    color: colors.text,
    marginTop: 2,
  },
  scoreBox: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    padding: 10,
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#D1FAE5',
  },
  scoreHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  scoreLabel: {
    fontSize: 12,
    fontFamily: 'PlusJakartaSans_800ExtraBold',
    color: colors.muted,
    letterSpacing: 0.6,
  },
  score: {
    fontSize: 16,
    fontFamily: 'PlusJakartaSans_800ExtraBold',
    color: '#065F46',
  },
  track: {
    height: 5,
    backgroundColor: '#D1FAE5',
    borderRadius: 3,
    overflow: 'hidden',
    marginTop: 2,
  },
  fill: {
    height: 5,
    backgroundColor: '#059669',
    borderRadius: 3,
  },
  why: {
    fontFamily: 'PlusJakartaSans_500Medium',
    fontSize: 12,
    color: '#047857',
    marginTop: 6,
    lineHeight: 15,
  },
});
