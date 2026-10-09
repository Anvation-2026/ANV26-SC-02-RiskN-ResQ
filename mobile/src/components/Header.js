import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../theme';
import { symbols } from '../assets';

// `brand` shows the rq mark before the title (used on each portal's main screen).
export default function Header({ title, subtitle, right, children, brand }) {
  const insets = useSafeAreaInsets();
  const paddingTop = Math.max(insets.top, 40) + 6;

  return (
    <View style={[styles.wrap, { paddingTop }]}>
      <View style={styles.glow} pointerEvents="none" />
      <View style={styles.glow2} pointerEvents="none" />
      <View style={styles.edge} pointerEvents="none"><View style={[styles.edgePart, { backgroundColor: '#22D3EE' }]} /><View style={[styles.edgePart, { backgroundColor: '#6366F1' }]} /><View style={[styles.edgePart, { backgroundColor: '#A855F7' }]} /></View>
      <View style={styles.row}>
        {brand ? <Image source={symbols.logo} style={styles.mark} accessibilityLabel="RiskN ResQ" /> : null}
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
  glow2: { position: 'absolute', bottom: -90, left: -60, width: 200, height: 200, borderRadius: 100, backgroundColor: 'rgba(124,58,237,0.16)' },
  edge: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 3, flexDirection: 'row' },
  edgePart: { flex: 1 },
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
  mark: { width: 40, height: 40, borderRadius: 11, marginRight: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)' },
  childContainer: {
    marginTop: 8,
  },
});
