import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { DEMO_CONTROLS } from '../config/api';
import { useData } from '../context/DataContext';
import { setDemoScenario } from '../services/api';
import ActionButton from './ActionButton';
import { colors } from '../theme';

// DEVELOPMENT / DEMO ONLY. Hide by setting DEMO_CONTROLS = false in config/api.js.
export default function DemoPanel() {
  const { refresh, risk } = useData();
  const [busy, setBusy] = useState(null);
  if (!DEMO_CONTROLS) return null;

  const run = async (s) => {
    setBusy(s);
    await setDemoScenario(s);
    await refresh();
    setBusy(null);
  };

  return (
    <View style={styles.box}>
      <Text style={styles.title}>🛠 DEMO MODE · development control</Text>
      <Text style={styles.sub}>Simulate heavy rainfall + road closure (remove before final submission). Current: {risk ? risk.level : '…'}</Text>
      <View style={styles.row}>
        <View style={{ flex: 1 }}><ActionButton variant="primary" label={busy === 'normal' ? '…' : 'Normal'} color={colors.LOW} disabled={!!busy} onPress={() => run('normal')} /></View>
        <View style={{ flex: 1 }}><ActionButton variant="primary" label={busy === 'flood' ? '…' : 'Flood Risk'} color={colors.HIGH} disabled={!!busy} onPress={() => run('flood')} /></View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderWidth: 2, borderStyle: 'dashed', borderColor: '#F59E0B', backgroundColor: '#FFFBEB', borderRadius: 16, padding: 14, marginTop: 18 },
  title: { fontSize: 13, fontFamily: 'PlusJakartaSans_800ExtraBold', color: '#92400E', letterSpacing: 0.5 },
  sub: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12, color: '#92400E', marginTop: 2, marginBottom: 10 },
  row: { flexDirection: 'row', gap: 10 },
});
