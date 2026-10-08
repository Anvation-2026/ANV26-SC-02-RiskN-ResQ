import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Header from '../../components/Header';
import ActionButton from '../../components/ActionButton';
import { ErrorText, MetricCard, RiskGauge, SkeletonCard, SmallButton, StateView } from '../../components/ui';
import { FadeIn } from '../../components/motion';
import { getProviders } from '../../services/accountApi';
import { getWeatherMonitoring } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import usePolling from '../../hooks/usePolling';
import { getAdminSummary } from '../../services/accountApi';
import { colors, fonts, riskSurface } from '../../theme';

const PROV = { weather: 'Weather', satellite: 'Satellite', terrain: 'Terrain', water_level: 'River', climatology: 'History' };
const PROV_COLOR = { OK: colors.LOW, STALE: colors.MEDIUM, DEGRADED: colors.MEDIUM, UNAVAILABLE: colors.HIGH, NOT_RUN: '#94A3B8' };
export const PROV_WORD = { OK: 'ONLINE', STALE: 'STALE', DEGRADED: 'STALE', UNAVAILABLE: 'UNAVAILABLE', NOT_RUN: 'UNAVAILABLE' };

export default function AdminDashboard({ navigate }) {
  const { user, logout } = useAuth();
  const sum = usePolling(getAdminSummary, 5000);
  const prov = usePolling(getProviders, 20000);
  const rain = usePolling(getWeatherMonitoring, 60000);
  const s = sum.data;
  const critical = prov.data ? prov.data.high_risk_zones.length : null;
  return (
    <View style={{ flex: 1 }}>
      <Header title="Admin Dashboard" subtitle={`Signed in as ${user.name}`} right={<SmallButton label="Log out" outline color="#fff" onPress={logout} />} />
      <ScrollView contentContainerStyle={styles.body}>
        <ErrorText>{s ? '' : sum.error}</ErrorText>
        {s ? (
          <>
            <FadeIn>
              <View style={[styles.hero, { backgroundColor: riskSurface(s.risk.risk_level) }]}>
                <View style={styles.heroTop}>
                  <Text style={styles.heroKicker}>OPERATIONS CENTRE · WORST ZONE</Text>
                  <Text style={styles.heroLevel}>{s.risk.risk_level}</Text>
                </View>
                <RiskGauge score={s.risk.risk_score} level={s.risk.risk_level} big={false} />
                <Text style={styles.heroLine}>
                  {critical == null ? 'Checking zones…' : critical === 0 ? 'No zone is HIGH or CRITICAL right now.' : `${critical} zone${critical > 1 ? 's' : ''} at HIGH or CRITICAL risk.`}
                  {s.risk.mode === 'SIMULATED DRILL' ? '  ·  SIMULATED DRILL active' : ''}
                </Text>
                <View style={styles.provRow}>
                  {(prov.data ? prov.data.providers : []).map((p) => (
                    <Pressable key={p.name} onPress={() => navigate('Intel')} accessibilityRole="button" accessibilityLabel={`${PROV[p.name] || p.name} data ${p.state.toLowerCase().replace('_', ' ')}`} style={styles.provChip}>
                      <View style={[styles.provDot, { backgroundColor: PROV_COLOR[p.state] || '#94A3B8' }]} />
                      <Text style={styles.provText}>{PROV[p.name] || p.name} · {PROV_WORD[p.state] || p.state}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            </FadeIn>
            <View style={styles.row}>
              <MetricCard label="ACTIVE ALERTS" value={s.active_alerts} icon="bell" color={s.active_alerts ? colors.HIGH : colors.text} delay={60} onPress={() => navigate('Control')} />
              <MetricCard label="OPEN INCIDENTS" value={s.open_incidents} icon="alert-triangle" delay={120} onPress={() => navigate('Incidents')} />
            </View>
            <View style={styles.row}>
              <MetricCard label="BLOCKED ROADS" value={s.blocked_roads} icon="slash" color={s.blocked_roads ? colors.HIGH : colors.text} delay={180} onPress={() => navigate('Control')} />
              <MetricCard label="HELP REQUESTS" value={s.pending_help_requests} icon="life-buoy" hint="waiting for a volunteer" color={s.pending_help_requests ? colors.MEDIUM : colors.text} delay={240} onPress={() => navigate('Requests')} />
            </View>
            <View style={styles.row}>
              <MetricCard label="VOLUNTEERS AVAILABLE" value={s.available_volunteers} icon="users" color={colors.LOW} delay={300} onPress={() => navigate('People')} />
              <MetricCard label="HIGH-RISK ZONES" value={critical == null ? '—' : critical} icon="map" color={critical ? colors.HIGH : colors.text} delay={330} onPress={() => navigate('Intel')} />
            </View>
            <View style={styles.row}>
              <MetricCard label="HIGHEST RAINFALL" value={rain.data && rain.data.summary ? Number(rain.data.summary.highest_rainfall_mm) : '—'} format={(n) => `${n.toFixed(1)}`} hint={rain.data && rain.data.status === 'ok' ? 'mm/h, monitored grid' : rain.data ? 'STALE or unavailable' : 'loading'} icon="cloud-rain" delay={360} onPress={() => navigate('Intel')} />
            </View>
            <Text style={styles.note}>{s.notice}</Text>
          </>
        ) : sum.error ? (
          <StateView kind="error" title="Unable to load the operations summary." message={sum.error} onRetry={sum.reload} />
        ) : (
          <><SkeletonCard lines={3} /><SkeletonCard lines={2} /></>
        )}
        <Text style={styles.section}>Manage</Text>
        <View style={styles.tiles}>
          <ActionButton iconName="users" label="Manage Volunteers" onPress={() => navigate('People')} />
          <ActionButton iconName="alert-triangle" label="Manage Incidents" onPress={() => navigate('Incidents')} />
          <ActionButton iconName="slash" label="Manage Roads" onPress={() => navigate('Control')} />
          <ActionButton iconName="cloud-rain" label="Simulate Hazard" onPress={() => navigate('Control')} />
          <ActionButton iconName="inbox" label="Help Requests & Matches" onPress={() => navigate('Requests')} />
          <ActionButton iconName="rotate-ccw" label="Reset Demo" color={colors.HIGH} onPress={() => navigate('Control')} />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { borderRadius: 22, padding: 18, marginBottom: 12, overflow: 'hidden' },
  heroTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  heroKicker: { color: '#fff', fontFamily: fonts.bold, fontSize: 11, letterSpacing: 0.8, backgroundColor: 'rgba(0,0,0,0.22)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, overflow: 'hidden' },
  heroLevel: { color: '#fff', fontFamily: fonts.extrabold, fontSize: 14, letterSpacing: 0.6 },
  heroLine: { color: 'rgba(255,255,255,0.92)', fontFamily: fonts.medium, fontSize: 12, marginTop: 10, lineHeight: 17 },
  provRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12 },
  provChip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(0,0,0,0.25)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  provDot: { width: 8, height: 8, borderRadius: 4 },
  provText: { color: '#fff', fontFamily: fonts.bold, fontSize: 11 },
  row: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  body: { padding: 16, paddingBottom: 40 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  stat: { flexBasis: '47%', flexGrow: 1, backgroundColor: '#fff', borderRadius: 16, padding: 14 },
  value: { fontFamily: fonts.extrabold, fontSize: 22, color: colors.text },
  note: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, marginTop: 12 },
  section: { fontFamily: fonts.extrabold, fontSize: 16, color: colors.text, marginTop: 20, marginBottom: 10 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
});
