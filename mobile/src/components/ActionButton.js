import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { colors, radius, shadow } from '../theme';

// variant "tile" = quick-action tile in 2-column grid; "primary" = full-width CTA button
export default function ActionButton({
  icon,
  iconName,
  label,
  onPress,
  variant = 'tile',
  color = colors.primary,
  disabled,
}) {
  if (variant === 'primary') {
    return (
      <Pressable
        onPress={onPress}
        disabled={disabled}
        style={({ pressed }) => [
          styles.primary,
          { backgroundColor: color, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 },
        ]}
      >
        <Text style={styles.primaryText}>{label}</Text>
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.tile,
        pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] },
      ]}
    >
      <View style={[styles.iconWrapper, { backgroundColor: color + '15' }]}>
        {iconName ? (
          <Feather name={iconName} size={20} color={color} />
        ) : (
          <Text style={styles.fallbackIcon}>{icon}</Text>
        )}
      </View>
      <Text style={styles.label} numberOfLines={2}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: {
    flex: 1,
    minWidth: '46%',
    backgroundColor: colors.card,
    borderRadius: radius.card,
    paddingVertical: 14,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    minHeight: 90,
    ...shadow,
  },
  iconWrapper: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  fallbackIcon: {
    fontSize: 20,
  },
  label: {
    fontSize: 13,
    fontFamily: 'PlusJakartaSans_700Bold',
    color: colors.text,
    textAlign: 'center',
    lineHeight: 17,
  },
  primary: {
    borderRadius: radius.button,
    paddingVertical: 13,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 2,
  },
  primaryText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontFamily: 'PlusJakartaSans_800ExtraBold',
    letterSpacing: 0.6,
  },
});
