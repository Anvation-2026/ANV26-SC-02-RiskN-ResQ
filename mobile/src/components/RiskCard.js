import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { fonts, palette, radius, riskSurface } from '../theme';
import RiskExplainer from './RiskExplainer';
import { FadeIn, Pulse } from './motion';
import { RiskGauge, Skeleton } from './ui';

// The hero of the Home screen: the flood-risk ESTIMATE, its probability (prototype, uncalibrated) and the reason.
// It never says a flood is happening: the wording is "estimate" / "risk" throughout.
const SUBTEXT = {
  LOW: 'Signals look normal. No elevated flood risk estimated.',
  MEDIUM: 'Waterlogging risk is rising. Stay alert.',
  MODERATE: 'Waterlogging risk is rising. Stay alert.',
  HIGH: 'Elevated flood risk estimated in your area.',
  CRITICAL: 'Very high flood risk estimated. Follow official instructions.',
};

export default function RiskCard({ risk, offline }) {
  if (!risk && offline) {
    return (
      <View style={[styles.card, { backgroundColor: '#475569' }]}>
        <Text style={styles.kicker}>FLOOD RISK</Text>
        <Text style={styles.loading}>Unable to connect to the server.</Text>
      </View>
    );
  }
  if (!risk) {
    return (
      <View style={[styles.card, { backgroundColor: palette.navy }]} accessibilityLabel="Evaluating flood risk" accessibilityRole="progressbar">
        <Text style={styles.kicker}>FLOOD RISK</Text>
        <Skeleton height={40} width="45%" style={{ marginTop: 14, backgroundColor: 'rgba(255,255,255,0.25)' }} />
        <Skeleton height={10} width="100%" style={{ marginTop: 16, backgroundColor: 'rgba(255,255,255,0.18)' }} />
        <Text style={[styles.loading, { marginTop: 12 }]}>Evaluating risk telemetry...</Text>
      </View>
    );
  }
  if (risk.insufficient && !risk.drill) {
    return (
      <FadeIn>
        <View style={[styles.card, { backgroundColor: '#475569' }]}>
          <Text style={styles.kicker}>FLOOD RISK</Text>
          <Text style={styles.loading}>Insufficient data to estimate current flood risk.</Text>
          <RiskExplainer risk={risk} />
        </View>
      </FadeIn>
    );
  }

  const level = risk.level === 'MODERATE' ? 'MEDIUM' : risk.level;
  const urgent = level === 'HIGH' || level === 'CRITICAL';
  return (
    <FadeIn>
      <View style={[styles.card, { backgroundColor: riskSurface(level) }]}>
        <View style={styles.glow} pointerEvents="none" />
        <View style={styles.topRow}>
          <View style={styles.badge}><Text style={styles.kicker}>FLOOD RISK ASSESSMENT</Text></View>
          <Pulse active={urgent} min={0.7} duration={900}>
            <View style={styles.levelPill}>
              {urgent ? <Feather name="alert-triangle" size={12} color="#fff" style={{ marginRight: 5 }} /> : null}
              <Text style={styles.levelPillText}>{level}</Text>
            </View>
          </Pulse>
        </View>

        <View style={{ marginTop: 14 }}>
          <RiskGauge score={risk.score} level={level} />
        </View>

        <View style={styles.middle}>
          <Text style={styles.level} numberOfLines={1}>{level}</Text>
          {risk.drill ? <Text style={styles.drillNote}>SIMULATED DRILL: not a real warning</Text> : risk.zoneAlert ? <Text style={styles.drillNote}>Raised by an active zone alert</Text> : null}
          <Text style={styles.subtext}>{SUBTEXT[level] || SUBTEXT.LOW}</Text>
          {risk.probability != null ? (
            <Text style={styles.prob}>Flood probability {Math.round(risk.probability * 100)}% (prototype estimate)</Text>
          ) : null}
        </View>

        {risk.reason && !risk.drill ? <Text style={styles.reason}>{risk.reason}</Text> : null}
        <RiskExplainer risk={risk} />
      </View>
    </FadeIn>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.card + 4, paddingHorizontal: 18, paddingVertical: 18, marginBottom: 14, overflow: 'hidden', shadowColor: '#0F172A', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.18, shadowRadius: 16, elevation: 5 },
  glow: { position: 'absolute', top: -60, right: -60, width: 180, height: 180, borderRadius: 90, backgroundColor: 'rgba(255,255,255,0.10)' },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  badge: { backgroundColor: 'rgba(0,0,0,0.22)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  kicker: { color: '#FFFFFF', fontFamily: fonts.bold, fontSize: 11, letterSpacing: 0.8 },
  levelPill: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.28)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  levelPillText: { color: '#fff', fontFamily: fonts.extrabold, fontSize: 11, letterSpacing: 0.6 },
  middle: { marginTop: 16 },
  level: { color: '#FFFFFF', fontFamily: fonts.extrabold, fontSize: 30, letterSpacing: -0.5 },
  subtext: { color: 'rgba(255,255,255,0.92)', fontFamily: fonts.medium, fontSize: 13, marginTop: 2 },
  prob: { color: '#FFFFFF', fontFamily: fonts.bold, fontSize: 12, marginTop: 8 },
  reason: { color: 'rgba(255,255,255,0.92)', fontFamily: fonts.medium, fontSize: 12, lineHeight: 17, marginTop: 12 },
  drillNote: { color: '#FFFFFF', backgroundColor: 'rgba(0,0,0,0.3)', alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, fontSize: 11, fontFamily: fonts.bold, marginTop: 6, overflow: 'hidden' },
  loading: { color: '#FFFFFF', fontFamily: fonts.semibold, fontSize: 15, marginTop: 8 },
});
