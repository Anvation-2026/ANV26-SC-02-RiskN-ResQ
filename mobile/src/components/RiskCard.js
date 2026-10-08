import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { radius, riskColor } from '../theme';

export default function RiskCard({ risk }) {
  if (!risk) {
    return (
      <View style={[styles.card, { backgroundColor: '#475569' }]}>
        <Text style={styles.kicker}>FLOOD RISK</Text>
        <Text style={styles.loading}>Loading risk...</Text>
      </View>
    );
  }
  const pct = Math.max(0, Math.min(100, risk.score));
  return (
    <View style={[styles.card, { backgroundColor: riskColor(risk.level) }]}>
      <Text style={styles.kicker}>FLOOD RISK</Text>
      <Text style={styles.level} adjustsFontSizeToFit numberOfLines={1}>{risk.level}</Text>
      <Text style={styles.score}>{risk.score} / 100</Text>
      <View style={styles.track}><View style={[styles.fill, { width: `${pct}%` }]} /></View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.card + 4, padding: 22, alignItems: 'center', boxShadow: '0 10px 24px rgba(15,23,42,0.22)' },
  kicker: { color: 'rgba(255,255,255,0.85)', fontSize: 13, fontFamily: 'PlusJakartaSans_800ExtraBold', letterSpacing: 2 },
  level: { color: '#fff', fontSize: 56, fontFamily: 'PlusJakartaSans_800ExtraBold', marginVertical: 2 },
  loading: { color: '#fff', fontSize: 22, fontFamily: 'PlusJakartaSans_700Bold', marginVertical: 18 },
  score: { color: '#fff', fontSize: 20, fontFamily: 'PlusJakartaSans_700Bold', marginBottom: 14 },
  track: { height: 8, alignSelf: 'stretch', backgroundColor: 'rgba(255,255,255,0.3)', borderRadius: 4, overflow: 'hidden' },
  fill: { height: 8, backgroundColor: '#fff', borderRadius: 4 },
});
