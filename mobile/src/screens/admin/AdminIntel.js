import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Header from '../../components/Header';
import { Card, ErrorText, Label, Pill, SkeletonCard, SmallButton, StateView } from '../../components/ui';
import { ago, RISK_COLOR } from '../../components/rain';
import { errorText } from '../../context/AuthContext';
import usePolling from '../../hooks/usePolling';
import { getAdminSummary, getMlStatus, getPositioning, getProviders, getResources, getRiskHistory, refreshIntelligence } from '../../services/accountApi';
import { colors, fonts } from '../../theme';

const STATE = { OK: ['ONLINE', colors.LOW, 'Updated'], STALE: ['STALE', '#B45309', 'Stale, last success'], DEGRADED: ['STALE', '#B45309', 'Partly failing, last success'],
  UNAVAILABLE: ['UNAVAILABLE', colors.HIGH, 'Unavailable'], NOT_RUN: ['UNAVAILABLE', colors.muted, 'Not run yet'], NOT_CONNECTED: ['NOT CONNECTED', colors.muted, 'Not connected'] };
const NAMES = { weather: 'WEATHER', satellite: 'SATELLITE', terrain: 'TERRAIN (DEM)', water_level: 'RIVER / FLOOD MODEL', climatology: 'RAINFALL HISTORY' };
const KIND = { weather: 'Real-time observation + forecast (Open-Meteo)', satellite: 'Periodic satellite pass (Sentinel-1 SAR, Microsoft Planetary Computer)',
  terrain: 'Static elevation model (Copernicus DEM)', water_level: 'MODELLED river discharge (GloFAS), not a gauge', climatology: '10-year reanalysis (ERA5)' };
const hhmm = (iso) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

// Flood intelligence monitoring: provider freshness, high-risk zones, hotspots, risk history, volunteer positioning, resources.
export default function AdminIntel() {
  const prov = usePolling(getProviders, 30000);
  const hist = usePolling(() => getRiskHistory(12), 60000);
  const pos = usePolling(getPositioning, 60000);
  const res = usePolling(getResources, 60000);
  const ml = usePolling(getMlStatus, 120000);
  const sum = usePolling(getAdminSummary, 60000);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const d = prov.data;

  const refreshAll = async () => {
    setBusy(true); setError(''); setNote('');
    try {
      const out = await refreshIntelligence();
      const bad = Object.entries(out.results).filter(([, v]) => v && (v.ok === false || v.status === 'unavailable')).map(([k]) => k);
      setNote(bad.length ? `Refreshed. Unavailable right now: ${bad.join(', ')}.` : 'All providers refreshed.');
      await Promise.all([prov.reload(), hist.reload()]);
    } catch (e) { setError(errorText(e)); }
    setBusy(false);
  };

  const timeline = (zone) => {
    const rows = ((hist.data && hist.data.history) || []).filter((h) => h.zone === zone);
    const out = [];
    rows.forEach((h) => { if (!out.length || out[out.length - 1].risk_level !== h.risk_level) out.push(h); });
    return out.slice(-6);
  };

  return (
    <View style={{ flex: 1 }}>
      <Header title="Intelligence" subtitle="Flood-risk data sources, hotspots and history" />
      <ScrollView contentContainerStyle={styles.body}>
        <ErrorText>{error || (d ? prov.error : '')}</ErrorText>
        {!d && prov.error ? <StateView kind="error" title="Unable to load the data-provider status." message={prov.error} onRetry={prov.reload} /> : null}
        {!d && !prov.error ? <><SkeletonCard lines={4} /><SkeletonCard lines={3} /></> : null}
        {d && (
          <Card>
            <Label>DATA PROVIDERS</Label>
            {d.providers.map((p) => {
              const [icon, color, word] = STATE[p.state] || STATE.NOT_RUN;
              return (
                <View key={p.name} style={styles.prov}>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Text style={styles.name}>{NAMES[p.name] || p.name}</Text>
                      <View style={[styles.badge, { backgroundColor: color + '22', borderColor: color }]}><Text style={[styles.badgeText, { color }]}>{icon}</Text></View>
                    </View>
                    {KIND[p.name] ? <Text style={styles.line}>{KIND[p.name]}</Text> : null}
                    <Text style={[styles.line, { color }]}>{p.state === 'OK' || p.age_minutes != null ? `${word} ${p.age_minutes != null ? ago(p.last_success) : ''}` : word}</Text>
                    {p.detail ? <Text style={styles.line}>{p.detail}</Text> : null}
                    {p.last_error ? <Text style={[styles.line, { color: colors.HIGH }]}>Last error: {p.last_error}</Text> : null}
                  </View>
                </View>
              );
            })}
            {(d.other_sources || []).map((p) => {
              const [badge, color] = STATE[p.state] || STATE.NOT_RUN;
              return (
                <View key={p.name} style={styles.prov}>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Text style={styles.name}>{(p.label || p.name).toUpperCase()}</Text>
                      <View style={[styles.badge, { backgroundColor: color + '22', borderColor: color }]}><Text style={[styles.badgeText, { color }]}>{badge}</Text></View>
                    </View>
                    {p.detail ? <Text style={styles.line}>{p.detail}</Text> : null}
                    {p.last_success ? <Text style={styles.line}>Last import {ago(p.last_success)}</Text> : null}
                  </View>
                </View>
              );
            })}
            {sum.data ? (
              <View style={styles.prov}>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text style={styles.name}>INCIDENTS</Text>
                    <View style={[styles.badge, { backgroundColor: colors.LOW + '22', borderColor: colors.LOW }]}><Text style={[styles.badgeText, { color: colors.LOW }]}>ONLINE</Text></View>
                  </View>
                  <Text style={styles.line}>User-generated community reports (secondary evidence)</Text>
                  <Text style={styles.line}>{sum.data.open_incidents} open report(s) in the database</Text>
                </View>
              </View>
            ) : null}
            <Text style={styles.line}>
              {d.counts.monitored_cells} monitored cells · terrain {d.counts.terrain_cells} · satellite {d.counts.satellite_cells} ({d.counts.abnormal_water_cells} with abnormal water gain) · river level {d.counts.water_level_cells} · {d.counts.historical_events} historical record(s)
            </Text>
            <Text style={styles.line}>River gauges are not connected: water level is the GloFAS model's river discharge, not a gauge reading.</Text>
            {note ? <Text style={[styles.line, { color: colors.LOW, fontFamily: fonts.semibold }]}>{note}</Text> : null}
            <View style={{ marginTop: 10, alignSelf: 'flex-start' }}><SmallButton label={busy ? 'Refreshing…' : 'Refresh all now'} disabled={busy} onPress={refreshAll} /></View>
          </Card>
        )}

        {d && (
          <Card>
            <Label>ZONE RISK (PROTOTYPE MODEL)</Label>
            {d.zones.map((z) => (
              <View key={z.zone} style={styles.zone}>
                <View style={styles.rowBetween}>
                  <Text style={styles.name}>{z.zone}</Text>
                  {z.insufficient ? <Pill text="NO DATA" color={colors.muted} /> : <Pill text={`${z.risk_level} · ${z.risk_score}/100${z.probability != null ? ` · ${Math.round(z.probability * 100)}%` : ''}`} color={RISK_COLOR[z.risk_level] || colors.muted} />}
                </View>
                <Text style={styles.line}>{z.reason}{z.mode === 'SIMULATED DRILL' ? ' (SIMULATED DRILL)' : ''}</Text>
                {z.signals.filter((s) => s.points > 0).map((s) => <Text key={s.key} style={styles.line}>• {s.label} +{s.points} [{s.source}]</Text>)}
                {z.missing.length ? <Text style={styles.line}>Unavailable: {z.missing.map((m) => m.label.toLowerCase()).join(', ')}</Text> : null}
                {timeline(z.zone).length > 1 ? (
                  <Text style={styles.hist}>{timeline(z.zone).map((h) => `${hhmm(h.at)} → ${h.risk_level}`).join('   ')}</Text>
                ) : null}
              </View>
            ))}
            <Text style={styles.line}>{d.model}</Text>
            {ml.data ? <Text style={styles.line}>Machine learning: {ml.data.status === 'trained' ? `trained on ${ml.data.samples} samples (hold-out F1 ${ml.data.holdout_metrics.f1})` : `not trained (${ml.data.labelled_rows} real labelled rows, ${ml.data.positives} positive; ${ml.data.reason})`}</Text> : null}
          </Card>
        )}

        <Card>
          <Label>POTENTIAL FLOOD HOTSPOTS</Label>
          {d && d.counts.active_hotspots === 0 ? <Text style={styles.line}>None right now. A hotspot needs HIGH risk backed by at least two independent signals.</Text> : (d && d.high_risk_zones.length ? d.high_risk_zones.map((z) => <Text key={z.zone} style={styles.line}>{z.zone}: {z.risk_level}</Text>) : null)}
        </Card>

        <Card>
          <Label>VOLUNTEER POSITIONING (SUGGESTION ONLY)</Label>
          {pos.data && pos.data.zones.length === 0 ? <Text style={styles.line}>No zone currently needs extra volunteers.</Text> : null}
          {(pos.data ? pos.data.zones : []).map((z) => <Text key={z.zone} style={styles.line}>{z.suggestion}</Text>)}
        </Card>

        <Card>
          <Label>RESOURCES</Label>
          {(res.data ? res.data.resources : []).map((r) => (
            <Text key={r.type} style={styles.line}>{r.type.replace('_', ' ')}: {r.available_now}/{r.volunteers} volunteers available{r.quantity_on_hand ? ` · ${r.quantity_on_hand} on hand` : ''} · {r.open_requests} open request(s){r.quantity_requested ? ` (${r.quantity_requested} requested)` : ''}</Text>
          ))}
        </Card>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, paddingBottom: 100 },
  prov: { flexDirection: 'row', gap: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.border },
  icon: { fontFamily: fonts.extrabold, fontSize: 16, width: 18 },
  badge: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 1 },
  badgeText: { fontFamily: fonts.extrabold, fontSize: 10, letterSpacing: 0.5 },
  name: { fontFamily: fonts.bold, fontSize: 14, color: colors.text },
  line: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, marginTop: 3, lineHeight: 17 },
  zone: { paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.border },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  hist: { fontFamily: fonts.bold, fontSize: 12, color: colors.text, marginTop: 6 },
});
