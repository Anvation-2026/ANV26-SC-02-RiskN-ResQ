import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { colors, radius, shadow } from '../theme';

// variant "tile" = quick-action tile; "primary" = full-width CTA
export default function ActionButton({ icon, label, onPress, variant = 'tile', color = colors.primary, disabled }) {
  if (variant === 'primary') {
    return (
      <Pressable onPress={onPress} disabled={disabled} style={({ pressed }) => [styles.primary, { backgroundColor: color, opacity: disabled ? 0.55 : pressed ? 0.85 : 1 }]}>
        <Text style={styles.primaryText}>{label}</Text>
      </Pressable>
    );
  }
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.tile, pressed && { opacity: 0.8 }]}>
      <Text style={styles.icon}>{icon}</Text>
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: { flexBasis: '47%', flexGrow: 1, backgroundColor: colors.card, borderRadius: radius.card, paddingVertical: 18, paddingHorizontal: 12, alignItems: 'center', ...shadow },
  icon: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 30, marginBottom: 8 },
  label: { fontSize: 14, fontFamily: 'PlusJakartaSans_700Bold', color: colors.text, textAlign: 'center' },
  primary: { borderRadius: radius.button, paddingVertical: 17, alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: '#fff', fontSize: 16, fontFamily: 'PlusJakartaSans_800ExtraBold', letterSpacing: 1 },
});
