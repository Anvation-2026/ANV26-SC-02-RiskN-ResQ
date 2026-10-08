import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../theme';

export default function Header({ title, subtitle, right, children }) {
  const insets = useSafeAreaInsets();
  const paddingTop = Math.max(insets.top, 40) + 6;

  return (
    <View style={[styles.wrap, { paddingTop }]}>
      <View style={styles.glow} pointerEvents="none" />
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{title}</Text>
          {subtitle ? <Text style={styles.sub} numberOfLines={1}>{subtitle}</Text> : null}
        </View>
        {right}
      </View>
      {children ? <View style={styles.childContainer}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  glow: { position: 'absolute', top: -70, right: -50, width: 190, height: 190, borderRadius: 95, backgroundColor: 'rgba(34,211,238,0.10)' },
  wrap: {
    overflow: 'hidden',
    backgroundColor: colors.navy,
    paddingHorizontal: 18,
    paddingBottom: 14,
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    color: '#FFFFFF',
    fontSize: 24,
    fontFamily: 'PlusJakartaSans_800ExtraBold',
    letterSpacing: -0.4,
  },
  sub: {
    color: '#94A3B8',
    fontFamily: 'PlusJakartaSans_500Medium',
    fontSize: 12,
    marginTop: 2,
  },
  childContainer: {
    marginTop: 8,
  },
});
