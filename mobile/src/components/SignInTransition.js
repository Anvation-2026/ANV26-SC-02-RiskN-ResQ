import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { brand } from '../assets';
import { fonts, palette } from '../theme';
import { useReducedMotion } from './motion';

// The moment between "signed in" and the dashboard, told with the rq mark (from risk to rescue):
//   1. the tile springs in and the letters "rq" rise into place
//   2. the coral wave-arrow draws itself from the r to the q, and a pulse fires at the arrow tip
//   3. the mark lifts along the arrow and its tile zooms out to fill the screen, opening onto the dashboard
// The dashboard is mounted underneath from the start (its data starts loading straight away). Everything except the
// wave drawing is transform/opacity on the native driver. Reduce Motion: a short cross-fade. A tap skips it.
// Always mounted around the signed-in app (finishing never remounts the dashboard); it plays only when `play` is true.
const ROLE = {
  user: 'Opening your flood dashboard',
  volunteer: 'Opening your volunteer portal',
  admin: 'Opening the operations centre',
};
const SIZE = 132;
const TIP = { x: (109 - 75) / 150, y: (96 - 75) / 150 }; // the arrow tip, relative to the mark's centre

export default function SignInTransition({ user, play, onDone, children }) {
  const reduced = useReducedMotion();
  const { width, height } = useWindowDimensions();
  const line = ROLE[user && user.role] || ROLE.user;
  const first = user && user.name ? String(user.name).trim().split(/\s+/)[0] : '';
  const tile = useRef(new Animated.Value(0)).current;     // tile springs in
  const letters = useRef(new Animated.Value(0)).current;  // "rq" rises in
  const draw = useRef(new Animated.Value(0)).current;     // wave-arrow drawn r → q (JS driver: it animates a width)
  const pulse = useRef(new Animated.Value(0)).current;    // ring at the arrow tip
  const text = useRef(new Animated.Value(0)).current;     // welcome line
  const out = useRef(new Animated.Value(play ? 0 : 1)).current; // mark launches, overlay leaves, dashboard arrives
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
      [tile, letters, draw, text].forEach((v) => v.setValue(1));
      const a = Animated.timing(out, { toValue: 1, duration: 220, useNativeDriver: true });
      a.start(finish);
      return () => a.stop();
    }
    const seq = Animated.sequence([
      Animated.parallel([
        Animated.spring(tile, { toValue: 1, friction: 7, tension: 110, useNativeDriver: true }),
        Animated.timing(letters, { toValue: 1, duration: 320, delay: 120, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      ]),
      Animated.parallel([
        Animated.timing(draw, { toValue: 1, duration: 520, easing: Easing.inOut(Easing.cubic), useNativeDriver: false }),
        Animated.timing(text, { toValue: 1, duration: 380, delay: 120, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      ]),
      Animated.timing(pulse, { toValue: 1, duration: 420, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(out, { toValue: 1, duration: 520, easing: Easing.bezier(0.5, 0, 0.2, 1), useNativeDriver: true }),
    ]);
    seq.start(finish);
    return () => seq.stop();
  }, [play, reduced]); // eslint-disable-line react-hooks/exhaustive-deps

  const cover = (Math.hypot(width, height) / SIZE) * 1.25; // tile scale that fills the screen
  const box = { width: SIZE, height: SIZE };
  // during the launch the letters and wave fade first, so only the tile's colour sweeps across the screen
  const content = out.interpolate({ inputRange: [0, 0.25, 1], outputRange: [1, 0, 0] });

  return (
    <View style={{ flex: 1 }}>
      {/* the dashboard: already mounted, it settles into place as the overlay opens */}
      <Animated.View style={gone ? s.fill : { flex: 1, opacity: out.interpolate({ inputRange: [0, 0.55, 1], outputRange: [0, 0, 1] }), transform: [{ scale: out.interpolate({ inputRange: [0, 1], outputRange: [1.04, 1] }) }] }}>
        {children}
      </Animated.View>

      {!gone && (
        <Animated.View
          style={[StyleSheet.absoluteFill, s.overlay, { opacity: out.interpolate({ inputRange: [0, 0.6, 1], outputRange: [1, 1, 0] }) }]}
          accessibilityLiveRegion="polite"
          accessibilityLabel={`Signed in${first ? ` as ${first}` : ''}. ${line}.`}
        >
          <Pressable style={s.center} onPress={finish} accessibilityRole="button" accessibilityHint="Skips the welcome animation">
            {/* the mark: it lifts slightly along the arrow while its tile zooms to fill the screen */}
            <Animated.View style={[box, { transform: [
              { translateX: out.interpolate({ inputRange: [0, 1], outputRange: [0, SIZE * 0.12] }) },
              { translateY: out.interpolate({ inputRange: [0, 1], outputRange: [0, -SIZE * 0.1] }) },
            ] }]}>
              <Animated.Image source={brand.tile} style={[box, s.abs, { opacity: tile, transform: [{ scale: Animated.multiply(tile.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] }), out.interpolate({ inputRange: [0, 1], outputRange: [1, cover] })) }] }]} />
              <Animated.Image source={brand.letters} style={[box, s.abs, { opacity: Animated.multiply(letters, content), transform: [{ translateY: letters.interpolate({ inputRange: [0, 1], outputRange: [SIZE * 0.1, 0] }) }] }]} />
              <Animated.View style={[s.abs, { left: 0, top: 0, height: SIZE, overflow: 'hidden', width: draw.interpolate({ inputRange: [0, 1], outputRange: [SIZE * 0.2, SIZE * 0.78] }) }]}>
                {/* separate layers: `content` runs on the native driver, `draw` on the JS driver; one node must never mix the two */}
                <Animated.View style={{ opacity: content }}>
                  <Animated.Image source={brand.wave} style={[box, { opacity: draw.interpolate({ inputRange: [0, 0.03, 1], outputRange: [0, 1, 1] }) }]} />
                </Animated.View>
              </Animated.View>
              <Animated.View pointerEvents="none" style={[s.ring, {
                left: SIZE / 2 + SIZE * TIP.x - 14, top: SIZE / 2 + SIZE * TIP.y - 14,
                opacity: Animated.multiply(pulse.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0, 0.9, 0] }), content),
                transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.4, 2.4] }) }],
              }]} />
            </Animated.View>
            <Animated.View style={{ alignItems: 'center', marginTop: 26, opacity: Animated.multiply(text, content), transform: [{ translateY: text.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }] }}>
              <Text style={s.hello}>{first ? `Welcome, ${first}` : 'Welcome'}</Text>
              <Text style={s.line}>{line}</Text>
            </Animated.View>
          </Pressable>
        </Animated.View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1 },
  abs: { position: 'absolute' },
  overlay: { backgroundColor: palette.ink, zIndex: 50, elevation: 50 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  ring: { position: 'absolute', width: 28, height: 28, borderRadius: 14, borderWidth: 3, borderColor: '#FB7185' },
  hello: { fontFamily: fonts.extrabold, fontSize: 26, color: '#FFFFFF', letterSpacing: -0.4 },
  line: { fontFamily: fonts.semibold, fontSize: 14, color: 'rgba(255,255,255,0.8)', marginTop: 6 },
});
