import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { colors, fonts } from '../theme';
import { useReducedMotion } from './motion';

// Six boxes over one real text field, so paste, iOS one-time-code autofill and the number pad all work. The active box
// shows a blinking caret; each digit pops in; a wrong code shakes the row (the parent passes `error`).
const LENGTH = 6;

function Cell({ char, active, error }) {
  const reduced = useReducedMotion();
  const pop = useRef(new Animated.Value(char ? 1 : 0)).current;
  const caret = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!char) { pop.setValue(0); return; }
    if (reduced) { pop.setValue(1); return; }
    pop.setValue(0.6);
    Animated.spring(pop, { toValue: 1, friction: 5, tension: 220, useNativeDriver: true }).start();
  }, [char, reduced]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!active || reduced) { caret.setValue(active ? 1 : 0); return undefined; }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(caret, { toValue: 1, duration: 420, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      Animated.timing(caret, { toValue: 0, duration: 420, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [active, reduced]); // eslint-disable-line react-hooks/exhaustive-deps
  const border = error ? colors.HIGH : active ? colors.primary : char ? '#94A3B8' : '#CBD5E1';
  return (
    <View style={[s.cell, { borderColor: border }, active && s.cellActive, error && { backgroundColor: '#FEF2F2' }]}>
      {char ? (
        <Animated.Text style={[s.char, { transform: [{ scale: pop }] }]}>{char}</Animated.Text>
      ) : active ? (
        <Animated.View style={[s.caret, { opacity: caret }]} />
      ) : null}
    </View>
  );
}

export default function OtpInput({ value, onChange, onComplete, error, autoFocus = true, disabled }) {
  const input = useRef(null);
  const [focused, setFocused] = useState(false);
  const reduced = useReducedMotion();
  const shake = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!error || reduced) return;
    Animated.sequence([-10, 10, -7, 7, -3, 0].map((x) => Animated.timing(shake, { toValue: x, duration: 50, useNativeDriver: true }))).start();
  }, [error]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (txt) => {
    const digits = String(txt || '').replace(/\D/g, '').slice(0, LENGTH);
    onChange(digits);
    if (digits.length === LENGTH && onComplete) onComplete(digits);
  };

  return (
    <Pressable onPress={() => input.current && input.current.focus()} accessible={false}>
      <Animated.View style={[s.row, { transform: [{ translateX: shake }] }]}>
        {Array.from({ length: LENGTH }).map((_, i) => (
          <Cell key={i} char={value[i]} active={focused && !disabled && (i === value.length || (i === LENGTH - 1 && value.length === LENGTH))} error={!!error} />
        ))}
        <TextInput
          ref={input}
          value={value}
          onChangeText={set}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          autoFocus={autoFocus}
          editable={!disabled}
          keyboardType="number-pad"
          inputMode="numeric"
          textContentType="oneTimeCode"
          autoComplete={Platform.OS === 'android' ? 'sms-otp' : 'one-time-code'}
          maxLength={LENGTH}
          caretHidden
          accessibilityLabel="Sign-in code"
          placeholder="Sign-in code"
          style={s.hidden}
        />
      </Animated.View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  cell: { flex: 1, aspectRatio: 0.82, maxWidth: 54, borderRadius: 14, borderWidth: 1.5, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  cellActive: { borderWidth: 2, shadowColor: colors.primary, shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  char: { fontFamily: fonts.extrabold, fontSize: 24, color: colors.text },
  caret: { width: 2, height: 24, borderRadius: 1, backgroundColor: colors.primary },
  // the real field covers the boxes but is invisible (a tiny opacity, not 0, so Android still lets it take focus)
  hidden: { ...StyleSheet.absoluteFillObject, opacity: 0.015, color: 'transparent', fontSize: 1 },
});
