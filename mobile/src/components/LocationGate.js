import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Feather from '@expo/vector-icons/Feather';
import ActionButton from './ActionButton';
import { useReducedMotion } from './motion';
import { colors, fonts, palette } from '../theme';

// Asks for location the right way: it says why first, then the system dialog appears only when the person taps "Allow".
// Variants: 'undetermined' (first ask), 'blocked' (refused before: only Settings can change it), 'services_off' (GPS off).
const WHY = {
  user: [
    ['map-pin', 'Flood risk where you are', 'The risk estimate, rainfall and alerts are for your exact area, not the whole city.'],
    ['navigation', 'Lower-risk routes and help nearby', 'Routes, evacuation points and the nearest volunteers start from your position.'],
    ['shield', 'Used only while the app is open', 'Your position is shared with a volunteer only when you ask for help.'],
  ],
  volunteer: [
    ['crosshair', 'Matched to people near you', 'Requests are offered to the volunteers closest to them.'],
    ['clock', 'Accurate arrival times', 'The person you are helping sees how far away you are while you are on the way.'],
    ['toggle-left', 'Only while you are available', 'Your position updates while you are marked available and the app is open.'],
  ],
};

export default function LocationGate({ state, role = 'user', busy, onAllow, onLater, onSettings, onRetry }) {
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const ring = useRef(new Animated.Value(0)).current;
  const pin = useRef(new Animated.Value(reduced ? 1 : 0)).current;
  useEffect(() => {
    if (reduced) return undefined;
    Animated.spring(pin, { toValue: 1, friction: 6, tension: 90, useNativeDriver: true }).start();
    const loop = Animated.loop(Animated.timing(ring, { toValue: 1, duration: 1800, easing: Easing.out(Easing.quad), useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [reduced]); // eslint-disable-line react-hooks/exhaustive-deps

  const blocked = state === 'blocked';
  const off = state === 'services_off';
  const web = Platform.OS === 'web';
  const title = off ? 'Turn on Location Services' : blocked ? 'Location is turned off for RiskN ResQ' : 'Allow your location';
  const body = off
    ? 'Location Services are switched off on this phone, so RiskN ResQ cannot find where you are.'
    : blocked
      ? web
        ? 'Location was blocked for this site. Allow it from the lock icon in the address bar, then try again.'
        : 'Location was refused earlier, so the phone will not ask again. Turn it on in Settings, then come back.'
      : 'RiskN ResQ uses your real-time location to warn you and find help nearby during floods.';

  return (
    <View style={[StyleSheet.absoluteFill, s.root, { paddingTop: insets.top + 40, paddingBottom: Math.max(insets.bottom, 20) }]} accessibilityViewIsModal>
      <View style={s.hero}>
        <Animated.View style={[s.ring, { opacity: ring.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] }), transform: [{ scale: ring.interpolate({ inputRange: [0, 1], outputRange: [0.7, 2.2] }) }] }]} />
        <Animated.View style={[s.pin, { opacity: pin, transform: [{ scale: pin.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }) }] }]}>
          <Feather name={off || blocked ? 'map-pin' : 'navigation'} size={34} color="#FFFFFF" />
        </Animated.View>
      </View>
      <Text style={s.title} accessibilityRole="header">{title}</Text>
      <Text style={s.body}>{body}</Text>

      {!off && !blocked ? (
        <View style={s.list}>
          {(WHY[role] || WHY.user).map(([icon, head, text]) => (
            <View key={head} style={s.item}>
              <View style={s.itemIcon}><Feather name={icon} size={16} color={palette.accent} /></View>
              <View style={{ flex: 1 }}>
                <Text style={s.itemHead}>{head}</Text>
                <Text style={s.itemText}>{text}</Text>
              </View>
            </View>
          ))}
        </View>
      ) : <View style={{ height: 24 }} />}

      <View style={{ flex: 1 }} />
      {off || blocked ? (
        <>
          {!web ? <ActionButton variant="primary" label="OPEN SETTINGS" onPress={onSettings} /> : null}
          <View style={{ height: 10 }} />
          <ActionButton variant="primary" label={busy ? 'CHECKING…' : 'I HAVE TURNED IT ON'} color={colors.navy} loading={busy} onPress={onRetry} />
        </>
      ) : (
        <ActionButton variant="primary" label={busy ? 'ASKING…' : 'ALLOW LOCATION'} loading={busy} onPress={onAllow} />
      )}
      <Pressable onPress={onLater} style={s.later} hitSlop={10} accessibilityRole="button">
        <Text style={s.laterText}>Not now</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  root: { backgroundColor: palette.ink, paddingHorizontal: 24, zIndex: 40, elevation: 40 },
  hero: { alignItems: 'center', justifyContent: 'center', height: 130, marginBottom: 12 },
  ring: { position: 'absolute', width: 96, height: 96, borderRadius: 48, borderWidth: 2, borderColor: palette.accent },
  pin: { width: 84, height: 84, borderRadius: 42, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: fonts.extrabold, fontSize: 26, color: '#FFFFFF', textAlign: 'center', letterSpacing: -0.4 },
  body: { fontFamily: fonts.medium, fontSize: 14, color: '#CBD5E1', textAlign: 'center', marginTop: 8, lineHeight: 21 },
  list: { marginTop: 26, gap: 16 },
  item: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  itemIcon: { width: 34, height: 34, borderRadius: 10, backgroundColor: 'rgba(34,211,238,0.12)', alignItems: 'center', justifyContent: 'center' },
  itemHead: { fontFamily: fonts.bold, fontSize: 15, color: '#FFFFFF' },
  itemText: { fontFamily: fonts.regular, fontSize: 13, color: '#94A3B8', marginTop: 2, lineHeight: 19 },
  later: { alignSelf: 'center', marginTop: 14, paddingVertical: 6 },
  laterText: { fontFamily: fonts.bold, fontSize: 14, color: '#94A3B8' },
});
