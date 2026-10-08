import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Header from '../components/Header';
import ActionButton from '../components/ActionButton';
import { useData } from '../context/DataContext';
import { submitIncident } from '../services/api';
import { colors, radius, shadow } from '../theme';
import { USER } from '../services/geo';

const TYPES = [
  { key: 'FLOOD', label: 'Flood', icon: '🌊' },
  { key: 'BLOCKED_ROAD', label: 'Blocked Road', icon: '🚧' },
  { key: 'EMERGENCY', label: 'Emergency', icon: '🚨' },
];

export const Chip = ({ active, onPress, children }) => (
  <Pressable onPress={onPress} style={[styles.chip, active && styles.chipOn]}>
    <Text style={[styles.chipText, active && { color: '#fff' }]}>{children}</Text>
  </Pressable>
);

export default function ReportScreen({ navigate }) {
  const { refresh } = useData();
  const [type, setType] = useState('FLOOD');
  const [text, setText] = useState('');
  const [located, setLocated] = useState(false);
  const [photo, setPhoto] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await submitIncident({ type, description: text.trim() || 'Reported via app' });
      await refresh();
    } catch (e) { /* api layer already falls back; never crash */ }
    setBusy(false);
    setDone(true);
  };
  const reset = () => { setDone(false); setText(''); setPhoto(false); setLocated(false); setType('FLOOD'); };

  return (
    <View style={{ flex: 1 }}>
      <Header title="Report an Incident" subtitle="Help improve local risk assessment" />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          {done ? (
            <View style={styles.success}>
              <View style={styles.check}><Text style={styles.checkMark}>✓</Text></View>
              <Text style={styles.sTitle}>Report Submitted</Text>
              <Text style={styles.sBody}>Your report has been received and will be considered in the local risk assessment.</Text>
              <View style={{ alignSelf: 'stretch', gap: 10, marginTop: 20 }}>
                <ActionButton variant="primary" label="VIEW LIVE MAP" onPress={() => navigate('Map')} />
                <ActionButton variant="primary" label="REPORT ANOTHER" color={colors.navy} onPress={reset} />
              </View>
            </View>
          ) : (
            <>
              <Text style={styles.label}>INCIDENT TYPE</Text>
              <View style={styles.types}>
                {TYPES.map((t) => (
                  <Pressable key={t.key} onPress={() => setType(t.key)} style={[styles.type, type === t.key && styles.typeOn]}>
                    <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 26 }}>{t.icon}</Text>
                    <Text style={[styles.typeText, type === t.key && { color: colors.primary }]}>{t.label}</Text>
                  </Pressable>
                ))}
              </View>

              <Text style={styles.label}>LOCATION</Text>
              <Pressable onPress={() => setLocated(true)} style={[styles.field, located && styles.fieldOk]}>
                <Text style={styles.fieldText}>{located ? `✓ ${USER.label} · ${USER.latitude.toFixed(4)}, ${USER.longitude.toFixed(4)}` : '📍 Use Current Location'}</Text>
              </Pressable>

              <Text style={styles.label}>DESCRIPTION</Text>
              <TextInput
                style={[styles.field, styles.input]} multiline value={text} onChangeText={setText}
                placeholder="Describe what you observed..." placeholderTextColor={colors.muted} textAlignVertical="top"
              />

              <Pressable onPress={() => setPhoto(!photo)} style={[styles.field, photo && styles.fieldOk, { marginTop: 12 }]}>
                <Text style={styles.fieldText}>{photo ? '✓ Photo attached (tap to remove)' : '📷 Add Photo'}</Text>
              </Pressable>

              <View style={{ marginTop: 22 }}>
                <ActionButton variant="primary" label={busy ? 'SUBMITTING…' : 'SUBMIT REPORT'} disabled={busy} color={colors.HIGH} onPress={submit} />
              </View>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, paddingBottom: 32 },
  label: { fontSize: 12, fontFamily: 'PlusJakartaSans_800ExtraBold', letterSpacing: 1.2, color: colors.muted, marginTop: 18, marginBottom: 8 },
  types: { flexDirection: 'row', gap: 10 },
  type: { flex: 1, backgroundColor: colors.card, borderRadius: radius.card, paddingVertical: 14, alignItems: 'center', gap: 6, borderWidth: 2, borderColor: 'transparent', ...shadow },
  typeOn: { borderColor: colors.primary, backgroundColor: '#EFF6FF' },
  typeText: { fontSize: 13, fontFamily: 'PlusJakartaSans_700Bold', color: colors.text, textAlign: 'center' },
  field: { backgroundColor: colors.card, borderRadius: radius.button, padding: 15, borderWidth: 1, borderColor: colors.border },
  fieldOk: { borderColor: colors.LOW, backgroundColor: '#ECFDF5' },
  fieldText: { fontSize: 15, fontFamily: 'PlusJakartaSans_600SemiBold', color: colors.text },
  input: { minHeight: 110, fontFamily: 'PlusJakartaSans_400Regular', fontSize: 15, color: colors.text },
  chip: { paddingHorizontal: 14, paddingVertical: 11, borderRadius: 999, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 14, fontFamily: 'PlusJakartaSans_700Bold', color: colors.text },
  success: { backgroundColor: colors.card, borderRadius: radius.card + 4, padding: 26, alignItems: 'center', marginTop: 20, ...shadow },
  check: { width: 76, height: 76, borderRadius: 38, backgroundColor: colors.LOW, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  checkMark: { color: '#fff', fontSize: 42, fontFamily: 'PlusJakartaSans_800ExtraBold' },
  sTitle: { fontSize: 24, fontFamily: 'PlusJakartaSans_800ExtraBold', color: colors.text, marginBottom: 8 },
  sBody: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 15, lineHeight: 22, color: colors.muted, textAlign: 'center' },
});
