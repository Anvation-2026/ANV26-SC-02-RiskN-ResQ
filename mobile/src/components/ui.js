// Small shared building blocks for the account, volunteer and admin screens.
import React from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, fonts, radius, shadow } from '../theme';

export const Card = ({ children, style }) => <View style={[s.card, style]}>{children}</View>;

export const Label = ({ children }) => <Text style={s.label}>{children}</Text>;

export const Pill = ({ text, color = colors.muted }) => (
  <View style={[s.pill, { backgroundColor: color + '1F' }]}>
    <Text style={[s.pillText, { color }]}>{text}</Text>
  </View>
);

export const ErrorText = ({ children }) => (children ? <Text style={s.error}>{children}</Text> : null);

export const Field = ({ label, ...props }) => (
  <View style={{ marginBottom: 12 }}>
    <Label>{label}</Label>
    <TextInput style={s.input} placeholderTextColor="#94A3B8" autoCapitalize="none" {...props} />
  </View>
);

export const SmallButton = ({ label, onPress, color = colors.primary, outline, disabled }) => (
  <Pressable
    onPress={onPress}
    disabled={disabled}
    style={({ pressed }) => [s.small, outline ? { borderColor: color, borderWidth: 1.5 } : { backgroundColor: color }, { opacity: disabled ? 0.45 : pressed ? 0.8 : 1 }]}
  >
    <Text style={[s.smallText, { color: outline ? color : '#fff' }]}>{label}</Text>
  </Pressable>
);

export const Segmented = ({ options, value, onChange }) => (
  <View style={s.seg}>
    {options.map(([k, l]) => (
      <Pressable key={k} onPress={() => onChange(k)} style={[s.segBtn, value === k && { backgroundColor: colors.primary }]}>
        <Text style={[s.segText, value === k && { color: '#fff' }]}>{l}</Text>
      </Pressable>
    ))}
  </View>
);

export const statusColor = (v) =>
  ({ VERIFIED: colors.LOW, RESOLVED: colors.LOW, ACTIVE: colors.LOW, AVAILABLE: colors.LOW, COMPLETED: colors.LOW, OPEN: colors.MEDIUM,
     REPORTED: colors.MEDIUM, PROPOSED: colors.MEDIUM, MATCHED: colors.primary, ACCEPTED: colors.primary, REJECTED: colors.HIGH,
     DISABLED: colors.HIGH, BLOCKED: colors.HIGH, CANCELLED: colors.muted }[v] || colors.muted);

const s = StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: radius.card, padding: 16, marginBottom: 12, ...shadow },
  label: { fontFamily: fonts.bold, fontSize: 12, letterSpacing: 0.6, color: colors.muted, marginBottom: 6 },
  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, alignSelf: 'flex-start' },
  pillText: { fontFamily: fonts.bold, fontSize: 12 },
  error: { fontFamily: fonts.semibold, fontSize: 13, color: colors.HIGH, marginBottom: 10, lineHeight: 19 },
  input: { fontFamily: fonts.regular, fontSize: 15, color: colors.text, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12 },
  small: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  smallText: { fontFamily: fonts.bold, fontSize: 13 },
  seg: { flexDirection: 'row', backgroundColor: '#E2E8F0', borderRadius: 12, padding: 3, marginBottom: 12 },
  segBtn: { flex: 1, paddingVertical: 9, borderRadius: 10, alignItems: 'center' },
  segText: { fontFamily: fonts.bold, fontSize: 13, color: colors.text },
});
