import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { fonts, palette, radius, riskSurface } from '../theme';
import RiskExplainer, { FAMILY, impactOf, topSignals } from './RiskExplainer';
import { FadeIn, Pulse } from './motion';
import { RiskGauge, Skeleton } from './ui';
import { ago } from './rain';

// The hero of the Home screen: the flood-intelligence engine's risk ESTIMATE for where you are, how confident the data
// behind it is, how fresh it is, the main contributing signals and what to do. Every value comes from the backend;
// it never says a flood is happening or confirmed.
const SUBTEXT = {
  LOW: 'Signals look normal. No elevated flood risk estimated.',
  MEDIUM: 'Waterlogging risk is rising. Stay alert.',
  HIGH: 'Elevated flood risk estimated in your area.',
  CRITICAL: 'Very high flood risk estimated. Follow official instructions.',
};
const CONF_COLOR = { HIGH: '#4ADE80', MEDIUM: '#FBBF24', LOW: '#F87171' };
const mm = (v) => (v == null ? '—' : `${Number(v).toFixed(1)} mm`);

function Freshness({ risk, offline, cachedAt }) {
  // SAVED DATA when the server is unreachable, STALE when the backend says its weather input is old, LIVE otherwise
  if (offline) return <View style={[st.tag, { backgroundColor: 'rgba(0,0,0,0.35)' }]}><Text style={st.tagText}>SAVED DATA (OFFLINE){cachedAt ? ` · ${ago(new Date(cachedAt).toISOString())}` : ''}</Text></View>;
  if (risk.weather_stale) return <View style={[st.tag, { backgroundColor: '#B45309' }]}><Text style={st.tagText}>STALE DATA</Text></View>;
  return <View style={[st.tag, { backgroundColor: 'rgba(22,163,74,0.85)' }]}><Text style={st.tagText}>● LIVE</Text></View>;
}

export default function RiskCard({ risk, offline, cachedAt }) {
  if (!risk && offline) {
    return (
      <View style={[st.card, { backgroundColor: '#475569' }]}>
        <Text style={st.kicker}>FLOOD RISK</Text>
        <Text style={st.loading}>Unable to connect to the server.</Text>
      </View>
    );
  }
  if (!risk) {
    return (
      <View style={[st.card, { backgroundColor: palette.navy }]} accessibilityLabel="Evaluating flood risk" accessibilityRole="progressbar">
        <Text style={st.kicker}>FLOOD RISK</Text>
        <Skeleton height={40} width="45%" style={{ marginTop: 14, backgroundColor: 'rgba(255,255,255,0.25)' }} />
        <Skeleton height={10} width="100%" style={{ marginTop: 16, backgroundColor: 'rgba(255,255,255,0.18)' }} />
        <Skeleton height={10} width="70%" style={{ marginTop: 10, backgroundColor: 'rgba(255,255,255,0.14)' }} />
        <Text style={[st.loading, { marginTop: 12 }]}>Evaluating flood intelligence…</Text>
      </View>
    );
  }
  if (risk.insufficient && !risk.drill) {
    return (
      <FadeIn>
        <View style={[st.card, { backgroundColor: '#475569' }]}>
          <View style={st.topRow}>
            <View style={st.badge}><Text style={st.kicker}>FLOOD RISK</Text></View>
            <Freshness risk={risk} offline={offline} cachedAt={cachedAt} />
          </View>
          <Text style={[st.level, { fontSize: 24, marginTop: 14 }]}>Insufficient data</Text>
          <Text style={st.subtext}>{risk.reason || 'Insufficient data to estimate current flood risk.'}</Text>
          <RiskExplainer risk={risk} />
        </View>
      </FadeIn>
    );
  }

  const level = risk.level === 'MODERATE' ? 'MEDIUM' : risk.level;
  const urgent = level === 'HIGH' || level === 'CRITICAL';
  const top = topSignals(risk);
  const updated = risk.computed_at || risk.observed_at;
  return (
    <FadeIn>
      <View style={[st.card, { backgroundColor: riskSurface(level) }]}>
        <View style={st.glow} pointerEvents="none" />
        <View style={st.topRow}>
          <View style={st.badge}><Text style={st.kicker}>FLOOD INTELLIGENCE</Text></View>
          <Freshness risk={risk} offline={offline} cachedAt={cachedAt} />
        </View>

        <View style={st.headline}>
          <Pulse active={urgent} min={0.7} duration={900}>
            <View style={st.levelPill}>
              {urgent ? <Feather name="alert-triangle" size={12} color="#fff" style={{ marginRight: 5 }} /> : null}
              <Text style={st.levelPillText}>{level} FLOOD RISK</Text>
            </View>
          </Pulse>
          {risk.drill ? <Text style={st.drillNote}>SIMULATED DRILL: not a real warning</Text> : risk.zoneAlert ? <Text style={st.drillNote}>Raised by an active zone alert</Text> : null}
        </View>

        <View style={{ marginTop: 12 }}>
          <RiskGauge score={risk.score} level={level} />
        </View>
        <Text style={st.subtext}>{SUBTEXT[level] || SUBTEXT.LOW}</Text>

        {/* confidence · updated · probability */}
        <View style={st.metaRow}>
          {risk.confidence ? (
            <View style={st.meta} accessibilityLabel={`Data confidence ${risk.confidence}`}>
              <View style={[st.dot, { backgroundColor: CONF_COLOR[risk.confidence] || '#fff' }]} />
              <Text style={st.metaText}>Confidence: {risk.confidence[0] + risk.confidence.slice(1).toLowerCase()}</Text>
            </View>
          ) : null}
          {updated ? <View style={st.meta}><Feather name="clock" size={11} color="#fff" /><Text style={st.metaText}>Updated {ago(updated)}</Text></View> : null}
          {risk.probability != null ? <View style={st.meta}><Text style={st.metaText}>Probability {Math.round(risk.probability * 100)}% (prototype)</Text></View> : null}
        </View>

        {/* rainfall now and forecast, from the same backend reading the risk used */}
        {risk.rainfall_24h_mm != null || risk.rain_1h_mm != null ? (
          <View style={st.rainRow}>
            <View style={st.rainBox}><Text style={st.rainLabel}>RAIN LAST HOUR</Text><Text style={st.rainValue}>{mm(risk.rain_1h_mm)}</Text></View>
            <View style={st.rainBox}><Text style={st.rainLabel}>LAST 24 H</Text><Text style={st.rainValue}>{mm(risk.rainfall_24h_mm)}</Text></View>
            <View style={st.rainBox}><Text style={st.rainLabel}>FORECAST 3 H</Text><Text style={st.rainValue}>{mm(risk.forecast_3h_mm)}</Text></View>
          </View>
        ) : null}

        {/* why: the strongest contributing signals, always visible */}
        <Text style={st.section}>WHY THIS RISK?</Text>
        {top.length ? top.map((x) => {
          const imp = impactOf(x);
          return (
            <View key={x.key} style={st.why}>
              <Text style={st.bullet}>•</Text>
              <Text style={st.whyText}>{x.label}<Text style={st.whyFam}>  {(FAMILY[x.key] || {}).title || ''} · {imp.word.toLowerCase()} impact</Text></Text>
            </View>
          );
        }) : <Text style={st.whyText}>{risk.reason || 'No strong flood signals right now.'}</Text>}

        {risk.recommended_action && !risk.drill ? (
          <View style={st.action}>
            <Feather name="navigation-2" size={13} color="#fff" />
            <View style={{ flex: 1 }}>
              <Text style={st.actionLabel}>RECOMMENDED ACTION</Text>
              <Text style={st.actionText}>{risk.recommended_action}</Text>
            </View>
          </View>
        ) : null}

        <RiskExplainer risk={risk} />
      </View>
    </FadeIn>
  );
}

const st = StyleSheet.create({
  card: { borderRadius: radius.card + 4, paddingHorizontal: 18, paddingVertical: 18, marginBottom: 14, overflow: 'hidden', shadowColor: '#0F172A', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.18, shadowRadius: 16, elevation: 5 },
  glow: { position: 'absolute', top: -60, right: -60, width: 180, height: 180, borderRadius: 90, backgroundColor: 'rgba(255,255,255,0.10)' },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  badge: { backgroundColor: 'rgba(0,0,0,0.22)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  kicker: { color: '#FFFFFF', fontFamily: fonts.bold, fontSize: 11, letterSpacing: 0.8 },
  tag: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3, flexShrink: 1 },
  tagText: { color: '#fff', fontFamily: fonts.extrabold, fontSize: 10, letterSpacing: 0.5 },
  headline: { marginTop: 14, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  levelPill: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.28)', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5 },
  levelPillText: { color: '#fff', fontFamily: fonts.extrabold, fontSize: 13, letterSpacing: 0.6 },
  level: { color: '#FFFFFF', fontFamily: fonts.extrabold, fontSize: 30, letterSpacing: -0.5 },
  subtext: { color: 'rgba(255,255,255,0.92)', fontFamily: fonts.medium, fontSize: 13, marginTop: 8 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(0,0,0,0.22)', borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4 },
  metaText: { color: '#fff', fontFamily: fonts.semibold, fontSize: 11 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  rainRow: { flexDirection: 'row', gap: 6, marginTop: 12 },
  rainBox: { flex: 1, backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 12, paddingVertical: 8, paddingHorizontal: 9, borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)' },
  rainLabel: { color: 'rgba(255,255,255,0.75)', fontFamily: fonts.bold, fontSize: 9, letterSpacing: 0.5 },
  rainValue: { color: '#fff', fontFamily: fonts.extrabold, fontSize: 15, marginTop: 2 },
  section: { color: 'rgba(255,255,255,0.8)', fontFamily: fonts.extrabold, fontSize: 11, letterSpacing: 0.8, marginTop: 14, marginBottom: 4 },
  why: { flexDirection: 'row', gap: 6, marginTop: 2 },
  bullet: { color: '#fff', fontFamily: fonts.bold, fontSize: 13 },
  whyText: { flex: 1, color: '#fff', fontFamily: fonts.semibold, fontSize: 13, lineHeight: 19 },
  whyFam: { color: 'rgba(255,255,255,0.7)', fontFamily: fonts.medium, fontSize: 11 },
  action: { flexDirection: 'row', gap: 8, marginTop: 12, backgroundColor: 'rgba(0,0,0,0.24)', borderRadius: 12, padding: 11 },
  actionLabel: { color: 'rgba(255,255,255,0.75)', fontFamily: fonts.extrabold, fontSize: 10, letterSpacing: 0.6 },
  actionText: { color: '#fff', fontFamily: fonts.semibold, fontSize: 13, lineHeight: 18, marginTop: 2 },
  drillNote: { color: '#FFFFFF', backgroundColor: 'rgba(0,0,0,0.3)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, fontSize: 11, fontFamily: fonts.bold, overflow: 'hidden' },
  loading: { color: '#FFFFFF', fontFamily: fonts.semibold, fontSize: 15, marginTop: 8 },
});
