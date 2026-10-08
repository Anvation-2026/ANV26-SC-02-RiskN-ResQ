// Motion primitives built on React Native's own Animated API (no extra dependency). Every animation honours the system
// "reduce motion" setting (it then jumps straight to the final state), and nothing here delays an emergency action: they are all
// short, run on mount or on change, and never block touches.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Pressable, Text, View } from 'react-native';

export function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled?.().then((v) => { if (alive) setReduced(!!v); }).catch(() => {});
    const sub = AccessibilityInfo.addEventListener?.('reduceMotionChanged', (v) => setReduced(!!v));
    return () => { alive = false; sub && sub.remove && sub.remove(); };
  }, []);
  return reduced;
}

export const staggerDelay = (index, step = 70, max = 420) => Math.min(index * step, max);

// Fades (and slides a little) its children in when they first appear.
export function FadeIn({ children, delay = 0, duration = 380, from = 'up', distance = 14, style }) {
  const reduced = useReducedMotion();
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduced) { v.setValue(1); return; }
    const a = Animated.timing(v, { toValue: 1, duration, delay, easing: Easing.out(Easing.cubic), useNativeDriver: true });
    a.start();
    return () => a.stop();
  }, [reduced]); // eslint-disable-line react-hooks/exhaustive-deps
  const shift = from === 'up' ? [distance, 0] : from === 'down' ? [-distance, 0] : [0, 0];
  const translate = from === 'left' || from === 'right'
    ? { translateX: v.interpolate({ inputRange: [0, 1], outputRange: [from === 'left' ? -distance : distance, 0] }) }
    : { translateY: v.interpolate({ inputRange: [0, 1], outputRange: shift }) };
  return <Animated.View style={[{ opacity: v, transform: [translate] }, style]}>{children}</Animated.View>;
}

// A number that eases to its new value instead of jumping. `format` turns the in-between value into text.
export function AnimatedNumber({ value, format = (n) => String(Math.round(n)), duration = 700, style, ...rest }) {
  const reduced = useReducedMotion();
  const v = useRef(new Animated.Value(Number(value) || 0)).current;
  const [text, setText] = useState(format(Number(value) || 0));
  useEffect(() => {
    const id = v.addListener(({ value: n }) => setText(format(n)));
    return () => v.removeListener(id);
  }, [v]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const target = Number(value) || 0;
    if (reduced) { v.setValue(target); setText(format(target)); return; }
    const a = Animated.timing(v, { toValue: target, duration, easing: Easing.out(Easing.cubic), useNativeDriver: false });
    a.start();
    return () => a.stop();
  }, [value, reduced]); // eslint-disable-line react-hooks/exhaustive-deps
  return <Text style={style} {...rest}>{text}</Text>;
}

// A bar whose width eases to `pct` (0-100).
export function AnimatedBar({ pct, color, height = 8, track = 'rgba(0,0,0,0.12)', style, radius = 999 }) {
  const reduced = useReducedMotion();
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const target = Math.max(0, Math.min(100, Number(pct) || 0));
    if (reduced) { v.setValue(target); return; }
    const a = Animated.timing(v, { toValue: target, duration: 800, easing: Easing.out(Easing.cubic), useNativeDriver: false });
    a.start();
    return () => a.stop();
  }, [pct, reduced]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <View style={[{ height, borderRadius: radius, backgroundColor: track, overflow: 'hidden' }, style]}>
      <Animated.View style={{ height, borderRadius: radius, backgroundColor: color, width: v.interpolate({ inputRange: [0, 100], outputRange: ['0%', '100%'] }) }} />
    </View>
  );
}

// Pressable with a quick press-in scale: tactile feedback without delaying the action.
export function PressableScale({ children, style, containerStyle, onPress, disabled, scaleTo = 0.97, ...rest }) {
  const reduced = useReducedMotion();
  const v = useRef(new Animated.Value(1)).current;
  const to = (n) => { if (!reduced) Animated.spring(v, { toValue: n, speed: 40, bounciness: 4, useNativeDriver: true }).start(); };
  return (
    <Pressable onPress={onPress} disabled={disabled} onPressIn={() => to(scaleTo)} onPressOut={() => to(1)} style={containerStyle} {...rest}>
      <Animated.View style={[style, { transform: [{ scale: v }] }]}>{children}</Animated.View>
    </Pressable>
  );
}

// A soft pulse for something that is genuinely live or urgent. Off when `active` is false or motion is reduced.
export function Pulse({ active = true, children, style, min = 0.55, duration = 1100 }) {
  const reduced = useReducedMotion();
  const v = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!active || reduced) { v.setValue(1); return undefined; }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(v, { toValue: min, duration, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      Animated.timing(v, { toValue: 1, duration, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [active, reduced]); // eslint-disable-line react-hooks/exhaustive-deps
  return <Animated.View style={[{ opacity: v }, style]}>{children}</Animated.View>;
}

// Horizontal shake for a rejected input. `const [shakeStyle, shake] = useShake()`; call shake() when validation fails.
export function useShake() {
  const reduced = useReducedMotion();
  const v = useRef(new Animated.Value(0)).current;
  const shake = useMemo(() => () => {
    if (reduced) return;
    Animated.sequence([-8, 8, -6, 6, 0].map((x) => Animated.timing(v, { toValue: x, duration: 55, useNativeDriver: true }))).start();
  }, [reduced, v]);
  return [{ transform: [{ translateX: v }] }, shake];
}

// Pops a confirmation mark in (scale + fade).
export function PopIn({ children, delay = 0, style }) {
  const reduced = useReducedMotion();
  const v = useRef(new Animated.Value(reduced ? 1 : 0)).current;
  useEffect(() => {
    if (reduced) return undefined;
    const a = Animated.spring(v, { toValue: 1, delay, friction: 5, tension: 120, useNativeDriver: true });
    a.start();
    return () => a.stop();
  }, [reduced]); // eslint-disable-line react-hooks/exhaustive-deps
  return <Animated.View style={[{ opacity: v, transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) }] }, style]}>{children}</Animated.View>;
}

// Cross-fades a screen in when it becomes the active tab (inactive tabs stay mounted but hidden).
export function ScreenFade({ active, children, style }) {
  const reduced = useReducedMotion();
  const v = useRef(new Animated.Value(active ? 1 : 0)).current;
  useEffect(() => {
    if (!active) { v.setValue(0); return undefined; }
    if (reduced) { v.setValue(1); return undefined; }
    v.setValue(0.0);
    const a = Animated.timing(v, { toValue: 1, duration: 180, easing: Easing.out(Easing.quad), useNativeDriver: true });
    a.start();
    return () => a.stop();
  }, [active, reduced]); // eslint-disable-line react-hooks/exhaustive-deps
  return <Animated.View style={[{ flex: 1, opacity: v }, style]}>{children}</Animated.View>;
}
