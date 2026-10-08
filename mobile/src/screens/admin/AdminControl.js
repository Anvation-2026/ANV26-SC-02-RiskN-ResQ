import React, { useState } from 'react';
import { Image, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { symbols } from '../../assets';
import Header from '../../components/Header';
import ActionButton from '../../components/ActionButton';
import { Card, ErrorText, Field, Label, Pill, SmallButton, statusColor } from '../../components/ui';
import { errorText } from '../../context/AuthContext';
import { useData } from '../../context/DataContext';
import usePolling from '../../hooks/usePolling';
import { getActiveAlerts, getAllRoads, resetDemo, setRoad, simulateRain } from '../../services/accountApi';
import { colors, fonts, riskColor } from '../../theme';

const PRESETS = [['Normal', 5, colors.LOW], ['Heavy rain', 80, colors.MEDIUM], ['Extreme', 120, colors.HIGH]];

export default function AdminControl() {
  const { refresh } = useData();
  const roads = usePolling(getAllRoads, 5000);
  const alerts = usePolling(getActiveAlerts, 5000);
  const [rain, setRain] = useState('80');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

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

  const reset = async () => {
    if (!confirmReset) return setConfirmReset(true);
    setConfirmReset(false);
    const out = await run(resetDemo);
    if (out) setResult(null);
  };

  return (
    <View style={{ flex: 1 }}>
      <Header title="Control" subtitle="Hazard simulation, roads and demo reset" />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <ErrorText>{error || roads.error}</ErrorText>

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
                : <SmallButton label="Block" color={colors.HIGH} disabled={busy} onPress={() => run(() => setRoad(r.id, true))} />}
            </View>
          ))}
        </Card>

        <Card>
          <Label>RESET DEMO</Label>
          <Text style={styles.line}>Restores LOW risk, open roads, no alerts, and clears incidents and help requests. Accounts are kept.</Text>
          <View style={{ marginTop: 12 }}>
            <ActionButton variant="primary" color={colors.HIGH} disabled={busy} label={confirmReset ? 'TAP AGAIN TO CONFIRM RESET' : 'RESET DEMO'} onPress={reset} />
          </View>
        </Card>
      </ScrollView>
      </KeyboardAvoidingView>
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
