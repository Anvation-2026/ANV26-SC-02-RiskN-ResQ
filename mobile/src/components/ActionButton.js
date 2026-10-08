import React from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { colors, radius, shadow } from '../theme';
import { PressableScale } from './motion';

// variant "tile" = quick-action tile in 2-column grid; "primary" = full-width CTA button
export default function ActionButton({
  icon,
  iconName,
  image,
  label,
  onPress,
  variant = 'tile',
  color = colors.primary,
  disabled,
  loading,
}) {
  if (variant === 'primary') {
    const off = disabled || loading;
    return (
      <PressableScale
        onPress={onPress}
        disabled={off}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: !!off, busy: !!loading }}
        style={[styles.primary, { backgroundColor: color, opacity: disabled ? 0.5 : 1, flexDirection: 'row', gap: 8 }]}
      >
        {loading ? <ActivityIndicator size="small" color="#FFFFFF" /> : null}
        <Text style={styles.primaryText}>{label}</Text>
      </PressableScale>
    );
  }

  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      containerStyle={{ flexGrow: 1, flexBasis: 96, maxWidth: '100%' }}
      scaleTo={0.96}
      style={styles.tile}
    >
      <View style={[styles.iconWrapper, image ? styles.imageWrapper : { backgroundColor: color + '15' }]}>
        {image ? (
          <Image source={image} style={styles.symbol} />
        ) : iconName ? (
          <Feather name={iconName} size={20} color={color} />
        ) : (
          <Text style={styles.fallbackIcon}>{icon}</Text>
        )}
      </View>
      <Text style={styles.label} numberOfLines={2}>{label}</Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  tile: {
    alignSelf: 'stretch',
    backgroundColor: colors.card,
    borderRadius: radius.card,
    paddingVertical: 14,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    minHeight: 88,
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
  imageWrapper: { width: 46, height: 46, borderRadius: 14, overflow: 'hidden' },
  symbol: { width: 46, height: 46 },
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
