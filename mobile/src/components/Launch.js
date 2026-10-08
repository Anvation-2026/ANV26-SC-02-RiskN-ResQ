import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Image, StyleSheet, Text, View } from 'react-native';
import { symbols } from '../assets';
import { fonts, palette } from '../theme';
import { useReducedMotion } from './motion';

// Shown while fonts load and the saved session is restored: the logo eases in over a soft ring, then the app fades in over it.
export default function LaunchScreen() {
  const reduced = useReducedMotion();
  const logo = useRef(new Animated.Value(reduced ? 1 : 0)).current;
  const ring = useRef(new Animated.Value(0)).current;
  const text = useRef(new Animated.Value(reduced ? 1 : 0)).current;
  useEffect(() => {
    if (reduced) return undefined;
    const intro = Animated.parallel([
      Animated.spring(logo, { toValue: 1, friction: 6, tension: 90, useNativeDriver: true }),
      Animated.timing(text, { toValue: 1, duration: 500, delay: 250, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]);
    const loop = Animated.loop(Animated.timing(ring, { toValue: 1, duration: 1800, easing: Easing.out(Easing.quad), useNativeDriver: true }));
    intro.start(); loop.start();
    return () => { intro.stop(); loop.stop(); };
  }, [reduced]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <View style={s.root} accessibilityRole="progressbar" accessibilityLabel="RiskN ResQ is loading">
      <Animated.View style={[s.ring, { opacity: ring.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0] }), transform: [{ scale: ring.interpolate({ inputRange: [0, 1], outputRange: [0.8, 2.1] }) }] }]} />
      <Animated.View style={{ opacity: logo, transform: [{ scale: logo.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }] }}>
        <Image source={symbols.logo} style={s.logo} />
      </Animated.View>
      <Animated.View style={{ opacity: text, transform: [{ translateY: text.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }], alignItems: 'center' }}>
        <Text style={s.brand}>RiskN ResQ</Text>
        <Text style={s.tag}>Hyper-local flood intelligence</Text>
      </Animated.View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.ink, alignItems: 'center', justifyContent: 'center' },
  ring: { position: 'absolute', width: 120, height: 120, borderRadius: 60, borderWidth: 2, borderColor: palette.accent },
  logo: { width: 84, height: 84, borderRadius: 22, marginBottom: 18 },
  brand: { fontFamily: fonts.extrabold, fontSize: 28, color: '#FFFFFF', letterSpacing: -0.5 },
  tag: { fontFamily: fonts.medium, fontSize: 13, color: '#94A3B8', marginTop: 4 },
});
