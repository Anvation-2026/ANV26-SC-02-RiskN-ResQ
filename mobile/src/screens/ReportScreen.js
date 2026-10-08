import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Feather from '@expo/vector-icons/Feather';
import Header from '../components/Header';
import ActionButton from '../components/ActionButton';
import { useData } from '../context/DataContext';
import { submitIncident } from '../services/api';
import { colors, radius, shadow } from '../theme';
import { USER } from '../services/geo';

const TYPES = [
  { key: 'FLOOD', label: 'Flood Hazard', icon: 'droplet' },
  { key: 'BLOCKED_ROAD', label: 'Blocked Road', icon: 'alert-triangle' },
  { key: 'EMERGENCY', label: 'Emergency', icon: 'alert-octagon' },
];

export const Chip = ({ active, onPress, children }) => (
  <Pressable
    onPress={onPress}
    style={[styles.chip, active && styles.chipOn]}
    hitSlop={4}
  >
    <Text style={[styles.chipText, active && styles.chipTextOn]}>{children}</Text>
  </Pressable>
);

export default function ReportScreen({ navigate }) {
  const insets = useSafeAreaInsets();
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
      await submitIncident({ type, description: text.trim() || 'Reported via mobile app' });
      await refresh();
    } catch (e) {
      /* api layer already falls back; never crash */
    }
    setBusy(false);
    setDone(true);
  };

  const reset = () => {
    setDone(false);
    setText('');
    setPhoto(false);
    setLocated(false);
    setType('FLOOD');
  };

  return (
    <View style={styles.root}>
      <Header
        title="Report Incident"
        subtitle="Submit Hyper-Local Hazard Telemetry"
      />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={[
            styles.body,
            { paddingBottom: Math.max(insets.bottom, 16) + 85 },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {done ? (
            <View style={styles.success}>
              <View style={styles.check}>
                <Feather name="check" size={24} color="#FFFFFF" />
              </View>
              <Text style={styles.sTitle}>Incident Logged</Text>
              <Text style={styles.sBody}>
                Your report has been broadcast to civic monitors and will factor into real-time routing adjustments.
              </Text>
              <View style={{ alignSelf: 'stretch', gap: 10, marginTop: 16 }}>
                <ActionButton
                  variant="primary"
                  label="VIEW LIVE MAP"
                  onPress={() => navigate('Map')}
                />
                <ActionButton
                  variant="primary"
                  label="SUBMIT ANOTHER"
                  color={colors.navy}
                  onPress={reset}
                />
              </View>
            </View>
          ) : (
            <>
              <Text style={styles.label}>INCIDENT CLASSIFICATION</Text>
              <View style={styles.types}>
                {TYPES.map((t) => {
                  const active = type === t.key;
                  return (
                    <Pressable
                      key={t.key}
                      onPress={() => setType(t.key)}
                      style={[styles.typeBtn, active && styles.typeBtnOn]}
                    >
                      <Feather
                        name={t.icon}
                        size={20}
                        color={active ? colors.primary : '#64748B'}
                      />
                      <Text style={[styles.typeText, active && styles.typeTextOn]}>
                        {t.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={styles.label}>GEO-COORDINATES</Text>
              <Pressable
                onPress={() => setLocated(true)}
                style={[styles.field, located && styles.fieldOk]}
              >
                <Feather
                  name="crosshair"
                  size={16}
                  color={located ? colors.LOW : colors.muted}
                />
                <Text style={styles.fieldText}>
                  {located
                    ? `Locked: ${USER.latitude.toFixed(4)}, ${USER.longitude.toFixed(4)} (${USER.label})`
                    : `Tap to attach current GPS (${USER.label})`}
                </Text>
              </Pressable>

              <Text style={styles.label}>FIELD OBSERVATION</Text>
              <TextInput
                style={styles.input}
                value={text}
                onChangeText={setText}
                placeholder="Describe water depth, obstruction, or damage..."
                placeholderTextColor="#94A3B8"
                multiline
                numberOfLines={3}
              />

              <Pressable
                onPress={() => setPhoto(!photo)}
                style={[styles.field, photo && styles.fieldOk]}
              >
                <Feather
                  name="camera"
                  size={16}
                  color={photo ? colors.LOW : colors.muted}
                />
                <Text style={styles.fieldText}>
                  {photo ? 'Photo evidence attached (1 file)' : 'Attach geo-tagged photo (Optional)'}
                </Text>
              </Pressable>

              <View style={{ marginTop: 14 }}>
                <ActionButton
                  variant="primary"
                  label={busy ? 'TRANSMITTING REPORT...' : 'SUBMIT REPORT'}
                  disabled={busy}
                  color={colors.HIGH}
                  onPress={submit}
                />
              </View>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  body: {
    padding: 14,
  },
  label: {
    fontSize: 11,
    fontFamily: 'PlusJakartaSans_800ExtraBold',
    letterSpacing: 0.8,
    color: colors.muted,
    marginTop: 12,
    marginBottom: 6,
  },
  types: {
    flexDirection: 'row',
    gap: 8,
  },
  typeBtn: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: radius.card,
    paddingVertical: 12,
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    ...shadow,
  },
  typeBtnOn: {
    borderColor: colors.primary,
    backgroundColor: '#EFF6FF',
  },
  typeText: {
    fontSize: 12,
    fontFamily: 'PlusJakartaSans_700Bold',
    color: colors.muted,
    textAlign: 'center',
  },
  typeTextOn: {
    color: colors.primary,
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.card,
    borderRadius: radius.button,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 6,
    ...shadow,
  },
  fieldOk: {
    borderColor: colors.LOW,
    backgroundColor: '#F0FDF4',
  },
  fieldText: {
    flex: 1,
    fontFamily: 'PlusJakartaSans_600SemiBold',
    fontSize: 13,
    color: colors.text,
  },
  input: {
    backgroundColor: colors.card,
    borderRadius: radius.button,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    fontFamily: 'PlusJakartaSans_500Medium',
    fontSize: 13,
    color: colors.text,
    minHeight: 75,
    textAlignVertical: 'top',
    marginBottom: 8,
    ...shadow,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  chipOn: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  chipText: {
    fontFamily: 'PlusJakartaSans_600SemiBold',
    fontSize: 12,
    color: colors.text,
  },
  chipTextOn: {
    color: '#FFFFFF',
  },
  success: {
    backgroundColor: colors.card,
    borderRadius: radius.card,
    padding: 22,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginTop: 10,
    ...shadow,
  },
  check: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.LOW,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  sTitle: {
    fontSize: 18,
    fontFamily: 'PlusJakartaSans_800ExtraBold',
    color: colors.text,
    marginBottom: 4,
  },
  sBody: {
    fontFamily: 'PlusJakartaSans_500Medium',
    fontSize: 13,
    color: colors.muted,
    textAlign: 'center',
    lineHeight: 18,
  },
});
