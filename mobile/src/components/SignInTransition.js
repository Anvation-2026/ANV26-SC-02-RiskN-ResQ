import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Image, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { symbols } from '../assets';
import { fonts, palette } from '../theme';
import { useReducedMotion } from './motion';

// The moment between "signed in" and the dashboard. The dashboard mounts straight away underneath (so its data starts
// loading), while this overlay plays on top:
//   1. from the login screen's dark background a coloured disc grows out of the centre and the logo springs in
//   2. a short welcome line (with the role's portal name) rises in, holds briefly
//   3. the overlay zooms through and fades while the dashboard scales up into place
// Only transform and opacity are animated (native driver on phones: smooth even while the dashboard renders).
// Reduce Motion: a quick cross-fade instead. A tap skips it. It never blocks the dashboard for more than ~1.4 s.
const ROLE = {
  user: { color: '#1565FF', line: 'Opening your flood dashboard' },
  volunteer: { color: '#0F766E', line: 'Opening your volunteer portal' },
  admin: { color: '#4338CA', line: 'Opening the operations centre' },
};

// Always mounted around the signed-in app (so finishing never remounts the dashboard); it plays only when `play` is true.
export default function SignInTransition({ user, play, onDone, children }) {
  const reduced = useReducedMotion();
  const { width, height } = useWindowDimensions();
  const role = ROLE[user && user.role] || ROLE.user;
  const first = user && user.name ? String(user.name).trim().split(/\s+/)[0] : '';
  const disc = useRef(new Animated.Value(0)).current;   // 0 → 1: the disc covers the screen
  const logo = useRef(new Animated.Value(0)).current;   // 0 → 1: logo springs in
  const text = useRef(new Animated.Value(0)).current;   // 0 → 1: welcome text rises in
  const out = useRef(new Animated.Value(play ? 0 : 1)).current; // 0 → 1: overlay leaves, dashboard arrives
  const [gone, setGone] = useState(!play);
  const finished = useRef(!play);

  const finish = () => {
    if (finished.current) return;
    finished.current = true;
    out.stopAnimation(); out.setValue(1);
    setGone(true);
    onDone && onDone();
  };

  useEffect(() => {
    if (!play) return undefined;
    if (reduced) {
      const a = Animated.timing(out, { toValue: 1, duration: 220, useNativeDriver: true });
      a.start(finish);
      return () => a.stop();
    }
    const seq = Animated.sequence([
      Animated.parallel([
        Animated.timing(disc, { toValue: 1, duration: 520, easing: Easing.bezier(0.2, 0.8, 0.2, 1), useNativeDriver: true }),
        Animated.spring(logo, { toValue: 1, delay: 140, friction: 6, tension: 110, useNativeDriver: true }),
        Animated.timing(text, { toValue: 1, duration: 360, delay: 300, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      ]),
      Animated.delay(360),
      Animated.timing(out, { toValue: 1, duration: 460, easing: Easing.bezier(0.4, 0, 0.2, 1), useNativeDriver: true }),
    ]);
    seq.start(finish);
    return () => seq.stop();
  }, [reduced]); // eslint-disable-line react-hooks/exhaustive-deps

  const size = 140;
  const cover = (Math.hypot(width, height) / size) * 1.15; // scale at which the disc covers every corner

  return (
    <View style={{ flex: 1 }}>
      {/* the dashboard: already mounted, it scales up and fades in as the overlay leaves */}
      <Animated.View style={gone ? s.fill : { flex: 1, opacity: out, transform: [{ scale: out.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) }, { translateY: out.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }] }}>
        {children}
      </Animated.View>

      {!gone && (
        <Animated.View
          style={[StyleSheet.absoluteFill, s.overlay, { opacity: out.interpolate({ inputRange: [0, 0.75, 1], outputRange: [1, 0.35, 0] }), transform: [{ scale: out.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] }) }] }]}
          accessibilityLiveRegion="polite"
          accessibilityLabel={`Signed in${first ? ` as ${first}` : ''}. ${role.line}.`}
        >
          <Pressable style={s.center} onPress={finish} accessibilityRole="button" accessibilityHint="Skips the welcome animation">
            <Animated.View style={[s.disc, { width: size, height: size, borderRadius: size / 2, backgroundColor: role.color, transform: [{ scale: disc.interpolate({ inputRange: [0, 1], outputRange: [0.01, cover] }) }] }]} />
            <Animated.View style={[s.halo, { opacity: logo.interpolate({ inputRange: [0, 1], outputRange: [0, 0.16] }), transform: [{ scale: logo.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1.3] }) }] }]} />
            <Animated.View style={{ opacity: logo, transform: [{ scale: logo.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }) }] }}>
              <Image source={symbols.logo} style={s.logo} />
            </Animated.View>
            <Animated.View style={{ alignItems: 'center', opacity: text, transform: [{ translateY: text.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }] }}>
              <Text style={s.hello}>{first ? `Welcome, ${first}` : 'Welcome'}</Text>
              <Text style={s.line}>{role.line}</Text>
            </Animated.View>
          </Pressable>
        </Animated.View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1 },
  overlay: { backgroundColor: palette.ink, zIndex: 50, elevation: 50 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  disc: { position: 'absolute' },
  halo: { position: 'absolute', width: 132, height: 132, borderRadius: 66, backgroundColor: '#FFFFFF' },
  logo: { width: 88, height: 88, borderRadius: 24, marginBottom: 18 },
  hello: { fontFamily: fonts.extrabold, fontSize: 26, color: '#FFFFFF', letterSpacing: -0.4 },
  line: { fontFamily: fonts.semibold, fontSize: 14, color: 'rgba(255,255,255,0.85)', marginTop: 6 },
});
