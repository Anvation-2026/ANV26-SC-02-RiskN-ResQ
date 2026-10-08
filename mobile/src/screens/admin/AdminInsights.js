import React, { useState } from 'react';
import { Animated, Easing, Platform, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import Header from '../../components/Header';
import { Card, ErrorText, Label, SkeletonCard, SmallButton, StateView } from '../../components/ui';
import { FadeIn } from '../../components/motion';
import { errorText } from '../../context/AuthContext';
import usePolling from '../../hooks/usePolling';
import { fetchCsv, getAnalytics, getAudit } from '../../services/accountApi';
import { timeAgo } from '../../services/geo';
import { colors, fonts } from '../../theme';
import { useReducedMotion } from '../../components/motion';

// Plain bar chart (no chart library): each bar is a View whose height is its share of the largest value.
function Bar({ value, max, color, height, index }) {
  const v = React.useRef(new Animated.Value(0)).current;
  const reduced = useReducedMotion();
  React.useEffect(() => {
    const target = Math.max(2, (value / max) * (height - 6));
    if (reduced) { v.setValue(target); return undefined; }
    const a = Animated.timing(v, { toValue: target, duration: 650, delay: Math.min(index * 25, 500), easing: Easing.out(Easing.cubic), useNativeDriver: false });
    a.start();
    return () => a.stop();
  }, [value, max, reduced]); // eslint-disable-line react-hooks/exhaustive-deps
  return <Animated.View style={[styles.bar, { height: v, backgroundColor: value ? color : '#E2E8F0' }]} />;
}

// Plain bar chart (no chart library): each bar eases up to its share of the largest value; an empty period says so.
function Bars({ data, color = colors.primary, height = 90, labelEvery = 3 }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const empty = data.every((d) => !d.value);
  return (
    <View>
      <View style={[styles.bars, { height }]}>
        {data.map((d, i) => (
          <View key={i} style={styles.barCol} accessible accessibilityLabel={`${d.label}: ${d.value}`}>
            <Bar value={d.value} max={max} color={color} height={height} index={i} />
          </View>
        ))}
        {empty ? <Text style={styles.empty}>Nothing recorded in this period</Text> : null}
      </View>
      <View style={styles.axis}>
        {data.map((d, i) => <Text key={i} style={styles.axisText}>{i % labelEvery === 0 ? d.label : ''}</Text>)}
      </View>
    </View>
  );
}

const day = (iso) => iso.slice(5).replace('-', '/');
const hour = (iso) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

async function saveCsv(kind, text) {
  if (Platform.OS === 'web') {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url; a.download = `riskn-${kind}.csv`; a.click();
    URL.revokeObjectURL(url);
  } else {
    await Share.share({ title: `riskn-${kind}.csv`, message: text });
  }
}

export default function AdminInsights() {
  const stats = usePolling(getAnalytics, 30000);
  const audit = usePolling(getAudit, 15000);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const a = stats.data;

  const exportKind = async (kind) => {
    setBusy(kind); setError('');
    try { await saveCsv(kind, await fetchCsv(kind)); } catch (e) { setError(errorText(e)); }
    setBusy('');
  };

  return (
    <View style={{ flex: 1 }}>
      <Header title="Insights" subtitle="Charts, audit log and exports" />
      <ScrollView contentContainerStyle={styles.body}>
        <ErrorText>{error || (a ? stats.error || audit.error : '')}</ErrorText>
        {!a && stats.error ? <StateView kind="error" title="Unable to load the insights." message={stats.error} onRetry={stats.reload} /> : null}
        {!a && !stats.error ? <><SkeletonCard lines={4} /><SkeletonCard lines={3} /></> : null}
        {a && (
          <>
            <Card>
              <Label>INCIDENTS PER DAY (LAST {a.days})</Label>
              <Bars data={a.incidents_per_day.map((d) => ({ label: day(d.date), value: d.count }))} color={colors.MEDIUM} />
              <Text style={styles.line}>{a.duplicates_merged} duplicate report(s) merged. By status: {Object.entries(a.incidents_by_status).map(([k, v]) => `${k.toLowerCase()} ${v}`).join(' · ') || 'none'}</Text>
            </Card>
            <Card>
              <Label>HELP REQUESTS PER DAY</Label>
              <Bars data={a.help_requests_per_day.map((d) => ({ label: day(d.date), value: d.count }))} color={colors.HIGH} />
              <Text style={styles.line}>
                {a.avg_response_minutes != null ? `Average time to a volunteer accepting: ${a.avg_response_minutes} min (${a.responses_measured} measured).` : 'No accepted requests yet, so no response time to show.'}
              </Text>
              <Text style={styles.line}>By status: {Object.entries(a.help_requests_by_status).map(([k, v]) => `${k.toLowerCase()} ${v}`).join(' · ') || 'none'}</Text>
            </Card>
            <Card>
              <Label>RAINFALL, HIGHEST AREA (MM/H, RECENT REFRESHES)</Label>
              {a.rainfall_history.length ? (
                <Bars data={a.rainfall_history.map((h) => ({ label: hour(h.at), value: h.max_mm }))} color="#2563EB" labelEvery={Math.max(1, Math.ceil(a.rainfall_history.length / 4))} />
              ) : <Text style={styles.line}>No weather refreshes recorded yet.</Text>}
            </Card>
            <Card>
              <Label>PEOPLE</Label>
              <Text style={styles.line}>Users {a.users.user} · Volunteers {a.users.volunteer} · Admins {a.users.admin}</Text>
              <Text style={styles.line}>Alerts raised: {Object.entries(a.alerts_by_severity).map(([k, v]) => `${k.toLowerCase()} ${v}`).join(' · ') || 'none'}</Text>
            </Card>
          </>
        )}

        <Card>
          <Label>EXPORT (CSV)</Label>
          <View style={styles.row}>
            {['incidents', 'help-requests', 'alerts', 'audit'].map((k) => (
              <SmallButton key={k} label={busy === k ? '…' : k.replace('-', ' ')} outline disabled={!!busy} onPress={() => exportKind(k)} />
            ))}
          </View>
        </Card>

        <Card>
          <Label>AUDIT LOG (WHO DID WHAT)</Label>
          {(audit.data || []).length === 0 && <Text style={styles.line}>No admin actions recorded yet.</Text>}
          {(audit.data || []).map((e) => (
            <View key={e.id} style={styles.event}>
              <Text style={styles.action}>{e.action}{e.target ? ` · ${e.target}` : ''}</Text>
              <Text style={styles.line}>{e.actor} · {timeAgo(e.at)}{e.detail ? ` · ${e.detail}` : ''}</Text>
            </View>
          ))}
        </Card>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, paddingBottom: 100 },
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 3 },
  barCol: { flex: 1, justifyContent: 'flex-end' },
  bar: { width: '100%', borderRadius: 3 },
  empty: { position: 'absolute', alignSelf: 'center', top: '40%', fontFamily: fonts.medium, fontSize: 12, color: colors.muted },
  axis: { flexDirection: 'row', marginTop: 4 },
  axisText: { flex: 1, fontFamily: fonts.regular, fontSize: 9, color: colors.muted },
  line: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted, marginTop: 6, lineHeight: 19 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  event: { paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.border },
  action: { fontFamily: fonts.bold, fontSize: 14, color: colors.text },
});
