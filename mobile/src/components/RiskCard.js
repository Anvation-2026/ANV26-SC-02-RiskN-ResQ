import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { radius, riskColor } from '../theme';

export default function RiskCard({ risk }) {
  if (!risk) {
    return (
      <View style={[styles.card, { backgroundColor: '#475569' }]}>
        <Text style={styles.kicker}>FLOOD RISK</Text>
        <Text style={styles.loading}>Evaluating risk telemetry...</Text>
      </View>
    );
  }

  const pct = Math.max(0, Math.min(100, risk.score));
  const cardBg = riskColor(risk.level);

  return (
    <View style={[styles.card, { backgroundColor: cardBg }]}>
      <View style={styles.topRow}>
        <View style={styles.badge}>
          <Text style={styles.kicker}>FLOOD RISK ASSESSMENT</Text>
        </View>
        <View style={styles.scorePill}>
          <Text style={styles.score}>{risk.score} / 100</Text>
        </View>
      </View>

      <View style={styles.middleRow}>
        <Text style={styles.level} numberOfLines={1}>{risk.level}</Text>
        {risk.drill ? <Text style={styles.drillNote}>SIMULATED DRILL: not a real warning</Text> : risk.zoneAlert ? <Text style={styles.drillNote}>Raised by an active zone alert</Text> : null}
        <Text style={styles.subtext}>
          {risk.level === 'CRITICAL' || risk.level === 'HIGH'
            ? 'Elevated flood risk in your area'
            : risk.level === 'MEDIUM' || risk.level === 'MODERATE'
            ? 'Waterlogging risk is rising'
            : 'Conditions look normal'}
        </Text>
      </View>

      <View style={styles.track}>
        <View style={[styles.fill, { width: `${pct}%` }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  drillNote: { color: '#FFFFFF', backgroundColor: 'rgba(0,0,0,0.25)', alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, fontSize: 11, fontFamily: 'PlusJakartaSans_700Bold', marginTop: 4, overflow: 'hidden' },
  card: {
    borderRadius: radius.card,
    paddingHorizontal: 16,
    paddingVertical: 14,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.16,
    shadowRadius: 8,
    elevation: 3,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  badge: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  kicker: {
    color: '#FFFFFF',
    fontSize: 12,
    fontFamily: 'PlusJakartaSans_800ExtraBold',
    letterSpacing: 0.8,
  },
  scorePill: {
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  score: {
    color: '#FFFFFF',
    fontSize: 12,
    fontFamily: 'PlusJakartaSans_800ExtraBold',
    letterSpacing: 0.5,
  },
  middleRow: {
    marginVertical: 4,
  },
  level: {
    color: '#FFFFFF',
    fontSize: 30,
    fontFamily: 'PlusJakartaSans_800ExtraBold',
    letterSpacing: -0.6,
  },
  subtext: {
    color: 'rgba(255, 255, 255, 0.9)',
    fontSize: 12,
    fontFamily: 'PlusJakartaSans_500Medium',
    marginTop: 2,
    marginBottom: 8,
  },
  loading: {
    color: '#FFFFFF',
    fontSize: 15,
    fontFamily: 'PlusJakartaSans_700Bold',
    marginVertical: 10,
  },
  track: {
    height: 5,
    alignSelf: 'stretch',
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
    borderRadius: 3,
    overflow: 'hidden',
  },
  fill: {
    height: 5,
    backgroundColor: '#FFFFFF',
    borderRadius: 3,
  },
});
