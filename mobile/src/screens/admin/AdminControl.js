import React, { useState } from 'react';
import { Image, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { symbols } from '../../assets';
import Header from '../../components/Header';
import ActionButton from '../../components/ActionButton';
import { Card, ConfirmDialog, ErrorText, Field, Label, Pill, Segmented, SmallButton, statusColor } from '../../components/ui';
import { errorText } from '../../context/AuthContext';
import { useData } from '../../context/DataContext';
import usePolling from '../../hooks/usePolling';
import { clearBroadcast, getActiveAlerts, getAllRoads, getSystem, importOsmPlaces, importOsmRoads, resetDemo, sendBroadcast, setRoad, simulateRain } from '../../services/accountApi';
import WeatherCard from '../../components/WeatherCard';
import { getWeatherMonitoring } from '../../services/api';
import { colors, fonts, riskColor } from '../../theme';

const PRESETS = [['Normal', 5, colors.LOW], ['Heavy rain', 80, colors.MEDIUM], ['Extreme', 120, colors.HIGH]];

export default function AdminControl() {
  const { refresh } = useData();
  const roads = usePolling(getAllRoads, 5000);
  const alerts = usePolling(getActiveAlerts, 5000);
  const weather = usePolling(getWeatherMonitoring, 60000); // the backend cache, so this is cheap
  const [rain, setRain] = useState('80');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(null); // dangerous actions ask first: { title, message, confirmLabel, action }
  const system = usePolling(getSystem, 60000);
  const [bMsg, setBMsg] = useState('');
  const [bSev, setBSev] = useState('MEDIUM');
  const [bZone, setBZone] = useState('ALL');
  const [note, setNote] = useState('');
  const [step, setStep] = useState(0);

  const run = async (fn) => {
    setBusy(true);
    setError('');
    try { const out = await fn(); await Promise.all([roads.reload(), alerts.reload(), refresh()]); return out; } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };

  const simulate = async (mm) => {
    const n = Number(mm);
    if (Number.isNaN(n) || n < 0 || n > 500) return setError('Rainfall must be a number between 0 and 500 mm.');
    const out = await run(() => simulateRain(n));
    if (out) setResult(out);
  };

  const reset = () => setConfirm({
    title: 'Reset the demo?',
    message: 'Clears incidents, help requests, matches, alerts and any simulated rainfall, and re-opens blocked roads. Accounts, volunteers and imported map data are kept.',
    confirmLabel: 'Yes, reset',
    action: async () => { const out = await run(resetDemo); if (out) setResult(null); },
  });

  // Guided demo: every step is a real admin action on simulated data, labelled as such.
  const DEMO = [
    ['Reset the demo', 'Start from LOW risk, open roads and no alerts.', () => resetDemo()],
    ['Simulate heavy rain (80 mm)', 'A SIMULATION: risk rises, an alert marked "SIMULATED DRILL" appears.', () => simulateRain(80)],
    ['Block a road', 'Closes the first monitored road; it turns red on every map.', () => {
      const r = (roads.data || []).find((x) => x.status !== 'BLOCKED' && x.source !== 'OSM') || (roads.data || [])[0];
      if (!r) throw Object.assign(new Error('No roads'), { status: 400, detail: 'There are no roads to block.' });
      return setRoad(r.id, true);
    }],
    ['Show the response', 'On a user phone: Map > Corridor & Response for the detour, Help to request a volunteer. On a volunteer phone: accept the request.', null],
    ['Reset the demo', 'Back to a clean state.', () => resetDemo()],
  ];
  const nextDemo = async () => {
    const [label, , action] = DEMO[step];
    if (action) { const out = await run(action); if (out === undefined) return; if (label.startsWith('Simulate')) setResult(out); }
    setStep((step + 1) % DEMO.length);
    if (step === DEMO.length - 1) setResult(null);
  };

  const send = async () => {
    if (bMsg.trim().length < 3) return setError('Write the message to send.');
    setConfirm({
      title: 'Send this notice?',
      message: `"${bMsg.trim()}" will appear in the Alerts of ${bZone === 'ALL' ? 'everyone' : bZone} and be pushed to their phones${bSev === 'HIGH' || bSev === 'CRITICAL' ? ' (and texted to people who opted in)' : ''}. This is a real notice, not a drill.`,
      confirmLabel: 'Send notice', danger: true,
      action: async () => {
        const out = await run(() => sendBroadcast({ message: bMsg.trim(), severity: bSev, zone: bZone === 'ALL' ? null : bZone }));
        if (out) { setNote(`Sent to ${out.recipients} people (${out.push_devices} devices${out.sms ? `, ${out.sms} SMS` : ''}).`); setBMsg(''); }
      },
    });
  };
  const doImport = async (fn, label) => {
    setNote('');
    const out = await run(fn);
    if (out) setNote(`${label}: ${out.added} added, ${out.total} in total (${out.source}).`);
  };

  return (
    <View style={{ flex: 1 }}>
      <Header title="Control" subtitle="Hazard simulation, roads and demo reset" />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <ErrorText>{error || roads.error}</ErrorText>

        <WeatherCard admin monitor={weather.data} />

        <Card>
          <Label>GUIDED DEMO (SIMULATION)</Label>
          <Text style={styles.line}>Step {step + 1} of {DEMO.length}: <Text style={{ fontFamily: fonts.bold, color: colors.text }}>{DEMO[step][0]}</Text></Text>
          <Text style={styles.line}>{DEMO[step][1]}</Text>
          <View style={{ marginTop: 12 }}><ActionButton variant="primary" color={colors.primary} disabled={busy} label={step === DEMO.length - 1 ? 'FINISH AND RESET' : 'RUN THIS STEP'} onPress={nextDemo} /></View>
        </Card>

        <Card>
          <View style={styles.titleRow}><Image source={symbols.rain} style={styles.sym} /><Text style={styles.title}>Simulate hazard (flood)</Text></View>
          <Text style={styles.line}>Sets rainfall for all zones. Simulated demo data, not a live reading.</Text>
          <View style={styles.row}>
            {PRESETS.map(([l, mm, c]) => <View key={l} style={{ flex: 1 }}><SmallButton label={`${l} ${mm}mm`} color={c} disabled={busy} onPress={() => { setRain(String(mm)); simulate(mm); }} /></View>)}
          </View>
          <View style={[styles.row, { alignItems: 'flex-end', marginTop: 12 }]}>
            <View style={{ flex: 1 }}><Field label="RAINFALL (MM)" value={rain} onChangeText={setRain} keyboardType="numeric" /></View>
            <View style={{ marginBottom: 12 }}><SmallButton label="Apply" disabled={busy} onPress={() => simulate(rain)} /></View>
          </View>
          {result && (
            <View style={styles.result}>
              <Text style={styles.line}>Risk {result.before.risk_level} → <Text style={{ fontFamily: fonts.extrabold, color: riskColor(result.after.risk_level) }}>{result.after.risk_level}</Text> ({result.after.risk_score}/100)</Text>
            </View>
          )}
        </Card>

        <Card>
          <View style={styles.titleRow}><Image source={symbols.bell} style={styles.sym} /><Text style={styles.title}>Active alerts</Text></View>
          {(alerts.data || []).length === 0 ? <Text style={styles.line}>No active alerts.</Text> : alerts.data.map((a) => (
            <View key={a.id} style={{ marginTop: 8 }}>
              <Pill text={`${a.severity} · ${a.affected_zone}`} color={riskColor(a.severity)} />
              <Text style={styles.line}>{a.message}</Text>
            </View>
          ))}
        </Card>

        <Card>
          <View style={styles.titleRow}><Image source={symbols.roadBlocked} style={styles.sym} /><Text style={styles.title}>Roads</Text></View>
          {(roads.data || []).map((r) => (
            <View key={r.id} style={styles.roadRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.road}>{r.name}</Text>
                <Pill text={r.status} color={statusColor(r.status)} />
              </View>
              {r.status === 'BLOCKED'
                ? <SmallButton label="Unblock" color={colors.LOW} disabled={busy} onPress={() => run(() => setRoad(r.id, false))} />
                : <SmallButton label="Block" color={colors.HIGH} disabled={busy} onPress={() => setConfirm({ title: `Block ${r.name}?`, message: 'Every map will show it closed and routes will avoid it until you unblock it. Users and volunteers rely on this.', confirmLabel: 'Block road', danger: true, action: () => run(() => setRoad(r.id, true)) })} />}
            </View>
          ))}
        </Card>

        <Card>
          <Label>BROADCAST A NOTICE</Label>
          <Text style={styles.line}>Shows in everyone's Alerts and is pushed to phones (and texted to people who opted in, for HIGH and CRITICAL). Real notice: use it carefully.</Text>
          <View style={{ marginTop: 10 }}>
            <Field label="MESSAGE" value={bMsg} onChangeText={setBMsg} multiline maxLength={300} placeholder="e.g. Avoid the Silk Board underpass until further notice." />
            <Segmented options={[['LOW', 'Low'], ['MEDIUM', 'Medium'], ['HIGH', 'High'], ['CRITICAL', 'Critical']]} value={bSev} onChange={setBSev} />
            <Segmented options={[['ALL', 'Everyone'], ['Zone A', 'Zone A'], ['Zone B', 'Zone B'], ['Zone C', 'Zone C']]} value={bZone} onChange={setBZone} />
            <ActionButton variant="primary" color={colors.HIGH} disabled={busy} label="SEND NOTICE" onPress={send} />
          </View>
          {(alerts.data || []).filter((a) => a.source === 'ADMIN').map((a) => (
            <View key={a.id} style={styles.roadRow}>
              <View style={{ flex: 1 }}><Pill text={`${a.severity} · ${a.affected_zone}`} color={riskColor(a.severity)} /><Text style={styles.line}>{a.message}</Text></View>
              <SmallButton label="Clear" outline disabled={busy} onPress={() => run(() => clearBroadcast(a.id))} />
            </View>
          ))}
        </Card>

        <Card>
          <Label>REAL MAP DATA (OPENSTREETMAP)</Label>
          <Text style={styles.line}>Imports named major roads (with ground elevation; low-lying ones are flagged) and hospitals and shelters inside the monitored area. Safe to repeat: nothing is duplicated.</Text>
          <View style={styles.row}>
            <SmallButton label="Import roads" disabled={busy} onPress={() => doImport(importOsmRoads, 'Roads')} />
            <SmallButton label="Import hospitals & shelters" disabled={busy} onPress={() => doImport(importOsmPlaces, 'Places')} />
          </View>
          {note ? <Text style={[styles.line, { color: colors.LOW, fontFamily: fonts.semibold }]}>{note}</Text> : null}
          {system.data && (
            <Text style={styles.line}>
              Channels: push {system.data.push.registered_devices} device(s) · SMS {system.data.sms.configured ? `on (${system.data.sms.opted_in_users} opted in)` : 'not configured'} · email {system.data.email.configured ? 'on' : 'not configured'}
            </Text>
          )}
        </Card>

        <Card>
          <Label>RESET DEMO</Label>
          <Text style={styles.line}>Restores LOW risk, open roads, no alerts, and clears incidents and help requests. Accounts are kept.</Text>
          <View style={{ marginTop: 12 }}>
            <ActionButton variant="primary" color={colors.HIGH} disabled={busy} label="RESET DEMO" onPress={reset} />
          </View>
        </Card>
      </ScrollView>
      </KeyboardAvoidingView>
      <ConfirmDialog visible={!!confirm} title={confirm && confirm.title} message={confirm && confirm.message} confirmLabel={confirm && confirm.confirmLabel} danger busy={busy}
        onCancel={() => setConfirm(null)} onConfirm={async () => { const a = confirm.action; setConfirm(null); await a(); }} />
    </View>
  );
}

const styles = StyleSheet.create({
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  sym: { width: 30, height: 30, borderRadius: 8 },
  body: { padding: 16, paddingBottom: 40 },
  row: { flexDirection: 'row', gap: 8, marginTop: 12 },
  title: { fontFamily: fonts.bold, fontSize: 16, color: colors.text },
  line: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted, marginTop: 4, lineHeight: 19 },
  result: { backgroundColor: colors.bg, borderRadius: 12, padding: 12 },
  roadRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 },
  road: { fontFamily: fonts.bold, fontSize: 15, color: colors.text, marginBottom: 4 },
});
