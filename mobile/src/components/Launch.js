import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { fonts, palette } from '../theme';
import BrandMark from './BrandMark';
import { useReducedMotion } from './motion';

// Shown while fonts load and the saved session is restored: the rq mark springs in, then its wave-arrow keeps drawing
// itself from risk (r) to rescue (q) until the app is ready.
export default function LaunchScreen() {
  const reduced = useReducedMotion();
  const tile = useRef(new Animated.Value(reduced ? 1 : 0)).current;
  const letters = useRef(new Animated.Value(reduced ? 1 : 0)).current;
  const draw = useRef(new Animated.Value(reduced ? 1 : 0)).current;
  const text = useRef(new Animated.Value(reduced ? 1 : 0)).current;
  useEffect(() => {
    if (reduced) return undefined;
    const intro = Animated.parallel([
      Animated.spring(tile, { toValue: 1, friction: 6, tension: 90, useNativeDriver: true }),
      Animated.timing(letters, { toValue: 1, duration: 380, delay: 140, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(text, { toValue: 1, duration: 480, delay: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]);
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(draw, { toValue: 1, duration: 760, easing: Easing.inOut(Easing.cubic), useNativeDriver: false }),
      Animated.delay(520),
      Animated.timing(draw, { toValue: 0, duration: 0, useNativeDriver: false }),
      Animated.delay(120),
    ]));
    intro.start();
    const t = setTimeout(() => loop.start(), 300);
    return () => { clearTimeout(t); intro.stop(); loop.stop(); };
  }, [reduced]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <View style={s.root} accessibilityRole="progressbar" accessibilityLabel="RiskN ResQ is loading">
      <BrandMark size={104} tile={tile} letters={letters} draw={draw} style={{ marginBottom: 20 }} />
      <Animated.View style={{ opacity: text, transform: [{ translateY: text.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }], alignItems: 'center' }}>
        <Text style={s.brand}>RiskN ResQ</Text>
        <Text style={s.tag}>From risk to rescue</Text>
      </Animated.View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.ink, alignItems: 'center', justifyContent: 'center' },
  brand: { fontFamily: fonts.extrabold, fontSize: 28, color: '#FFFFFF', letterSpacing: -0.5 },
  tag: { fontFamily: fonts.medium, fontSize: 13, color: '#94A3B8', marginTop: 4 },
});
