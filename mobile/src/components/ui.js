// Small shared building blocks for the account, volunteer and admin screens.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Modal, PanResponder, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { colors, fonts, palette, radius, riskColor, riskIndex, riskSoft, riskSurface, shadow } from '../theme';
import { AnimatedBar, AnimatedNumber, FadeIn, PopIn, Pulse, PressableScale, useReducedMotion } from './motion';

export const Card = ({ children, style }) => <View style={[s.card, style]}>{children}</View>;

export const Label = ({ children }) => <Text style={s.label}>{children}</Text>;

export const Pill = ({ text, color = colors.muted }) => (
  <View style={[s.pill, { backgroundColor: color + '1F' }]}>
    <Text style={[s.pillText, { color }]}>{text}</Text>
  </View>
);

export const ErrorText = ({ children }) => (children ? <Text style={s.error}>{children}</Text> : null);

export const Field = ({ label, ...props }) => (
  <View style={{ marginBottom: 12 }}>
    <Label>{label}</Label>
    <TextInput style={s.input} placeholderTextColor="#94A3B8" autoCapitalize="none" {...props} />
  </View>
);

export const SmallButton = ({ label, onPress, color = colors.primary, outline, disabled }) => (
  <Pressable
    onPress={onPress}
    disabled={disabled}
    style={({ pressed }) => [s.small, outline ? { borderColor: color, borderWidth: 1.5 } : { backgroundColor: color }, { opacity: disabled ? 0.45 : pressed ? 0.8 : 1 }]}
  >
    <Text style={[s.smallText, { color: outline ? color : '#fff' }]}>{label}</Text>
  </Pressable>
);

export const Segmented = ({ options, value, onChange }) => (
  <View style={s.seg}>
    {options.map(([k, l]) => (
      <Pressable key={k} onPress={() => onChange(k)} style={[s.segBtn, value === k && { backgroundColor: colors.primary }]}>
        <Text style={[s.segText, value === k && { color: '#fff' }]}>{l}</Text>
      </Pressable>
    ))}
  </View>
);

export const statusColor = (v) =>
  ({ VERIFIED: colors.LOW, RESOLVED: colors.LOW, ACTIVE: colors.LOW, AVAILABLE: colors.LOW, COMPLETED: colors.LOW, OPEN: colors.MEDIUM,
     REPORTED: colors.MEDIUM, PROPOSED: colors.MEDIUM, MATCHED: colors.primary, ACCEPTED: colors.primary, REJECTED: colors.HIGH,
     DISABLED: colors.HIGH, BLOCKED: colors.HIGH, CANCELLED: colors.muted }[v] || colors.muted);

const s = StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: radius.card, padding: 16, marginBottom: 12, ...shadow },
  label: { fontFamily: fonts.bold, fontSize: 12, letterSpacing: 0.6, color: colors.muted, marginBottom: 6 },
  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, alignSelf: 'flex-start' },
  pillText: { fontFamily: fonts.bold, fontSize: 12 },
  error: { fontFamily: fonts.semibold, fontSize: 13, color: colors.HIGH, marginBottom: 10, lineHeight: 19 },
  input: { fontFamily: fonts.regular, fontSize: 15, color: colors.text, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12 },
  small: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  smallText: { fontFamily: fonts.bold, fontSize: 13 },
  seg: { flexDirection: 'row', backgroundColor: '#E2E8F0', borderRadius: 12, padding: 3, marginBottom: 12 },
  segBtn: { flex: 1, paddingVertical: 9, borderRadius: 10, alignItems: 'center' },
  segText: { fontFamily: fonts.bold, fontSize: 13, color: colors.text },
});


// ───────────────────────────── shared design-system components ─────────────────────────────
// One version of each, used by every screen: skeletons, empty/error states, metric cards, status pills, bottom sheet,
// confirmation dialog, risk gauge, timeline. Motion lives in ./motion and honours "reduce motion".

export const SectionTitle = ({ children, right }) => (
  <View style={k.sectionRow}><Text style={k.section}>{children}</Text>{right}</View>
);

export function Skeleton({ height = 14, width = '100%', radius: r = 8, style }) {
  const reduced = useReducedMotion();
  const v = useRef(new Animated.Value(0.45)).current;
  useEffect(() => {
    if (reduced) { v.setValue(0.6); return undefined; }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(v, { toValue: 0.9, duration: 800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      Animated.timing(v, { toValue: 0.45, duration: 800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [reduced]); // eslint-disable-line react-hooks/exhaustive-deps
  return <Animated.View accessibilityElementsHidden importantForAccessibility="no" style={[{ height, width, borderRadius: r, backgroundColor: '#CBD5E1', opacity: v }, style]} />;
}

export const SkeletonCard = ({ lines = 3, style }) => (
  <View style={[k.skelCard, style]} accessibilityLabel="Loading" accessibilityRole="progressbar">
    <Skeleton height={12} width="35%" />
    {Array.from({ length: lines }).map((_, i) => <Skeleton key={i} height={14} width={i === lines - 1 ? '60%' : '100%'} style={{ marginTop: 10 }} />)}
  </View>
);

// loading / empty / error block with an optional retry. Messages are plain language, never raw status codes.
export function StateView({ kind = 'empty', title, message, onRetry, retryLabel = 'Try again', icon, compact }) {
  if (kind === 'loading') return <SkeletonCard lines={compact ? 2 : 3} />;
  const isError = kind === 'error';
  return (
    <FadeIn>
      <View style={[k.state, compact && { paddingVertical: 14 }, isError && { borderColor: '#FECACA', backgroundColor: '#FEF2F2' }]} accessibilityRole={isError ? 'alert' : undefined}>
        <View style={[k.stateIcon, { backgroundColor: isError ? '#FEE2E2' : '#E0F2FE' }]}>
          <Feather name={icon || (isError ? 'alert-circle' : 'inbox')} size={20} color={isError ? colors.HIGH : colors.primary} />
        </View>
        <Text style={k.stateTitle}>{title}</Text>
        {message ? <Text style={k.stateMsg}>{message}</Text> : null}
        {onRetry ? <View style={{ marginTop: 12 }}><SmallButton label={retryLabel} outline onPress={onRetry} /></View> : null}
      </View>
    </FadeIn>
  );
}

// Wraps an API-driven section: skeleton while loading, an error with retry when it failed and nothing is cached, an empty state,
// otherwise the content. `state` is what usePolling returns ({data, error, loading, reload}).
export function Async({ state, isEmpty, empty, errorTitle = 'Unable to load this right now.', children }) {
  if (state.data == null && state.loading) return <StateView kind="loading" />;
  if (state.data == null && state.error) return <StateView kind="error" title={errorTitle} message={state.error} onRetry={state.reload} />;
  if (state.data != null && isEmpty && isEmpty(state.data)) return <StateView kind="empty" title={empty.title} message={empty.message} icon={empty.icon} compact />;
  return children(state.data);
}

export const StatusPill = ({ status, text, dot }) => {
  const c = statusColor(status);
  return (
    <View style={[s.pill, { backgroundColor: c + '1F', flexDirection: 'row', alignItems: 'center', gap: 6 }]}>
      {dot ? <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: c }} /> : null}
      <Text style={[s.pillText, { color: c }]}>{text || status}</Text>
    </View>
  );
};

// A number tile that counts up to its value.
export function MetricCard({ label, value, hint, color = colors.text, icon, delay = 0, onPress, format }) {
  const body = (
    <View style={k.metric}>
      <View style={k.metricTop}>
        <Text style={k.metricLabel} numberOfLines={1}>{label}</Text>
        {icon ? <Feather name={icon} size={14} color={color} /> : null}
      </View>
      {typeof value === 'number'
        ? <AnimatedNumber value={value} format={format} style={[k.metricValue, { color }]} />
        : <Text style={[k.metricValue, { color }]} numberOfLines={1}>{value}</Text>}
      {hint ? <Text style={k.metricHint} numberOfLines={2}>{hint}</Text> : null}
    </View>
  );
  return <FadeIn delay={delay} style={{ flex: 1 }}>{onPress ? <PressableScale onPress={onPress} accessibilityRole="button" accessibilityLabel={`${label} ${value}`}>{body}</PressableScale> : body}</FadeIn>;
}

// A semicircle-free gauge (no SVG needed): four colour bands with a marker that glides to the score.
export function RiskGauge({ score, level, light = true, big = true }) {
  const reduced = useReducedMotion();
  const pos = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const target = Math.max(0, Math.min(100, Number(score) || 0));
    if (reduced) { pos.setValue(target); return undefined; }
    const a = Animated.timing(pos, { toValue: target, duration: 900, easing: Easing.out(Easing.cubic), useNativeDriver: false });
    a.start();
    return () => a.stop();
  }, [score, reduced]); // eslint-disable-line react-hooks/exhaustive-deps
  const urgent = riskIndex(level) >= 2;
  const fg = light ? '#FFFFFF' : colors.text;
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel={`Risk score ${score} of 100, ${level}`} accessibilityValue={{ min: 0, max: 100, now: Number(score) || 0 }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
        <AnimatedNumber value={Number(score) || 0} style={[k.gaugeNum, { color: fg, fontSize: big ? 44 : 30 }]} />
        <Text style={[k.gaugeOf, { color: fg }]}>/ 100</Text>
      </View>
      <View style={k.gaugeTrack}>
        {['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map((l) => <View key={l} style={[k.gaugeBand, { backgroundColor: riskColor(l) }]} />)}
        <Animated.View style={[k.gaugeMarker, { left: pos.interpolate({ inputRange: [0, 100], outputRange: ['0%', '100%'] }) }]}>
          <Pulse active={urgent} min={0.6} duration={900}><View style={k.gaugeKnob} /></Pulse>
        </Animated.View>
      </View>
      <View style={k.gaugeLabels}>
        {['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map((l) => <Text key={l} style={[k.gaugeLabel, { color: fg }]}>{l}</Text>)}
      </View>
    </View>
  );
}

// Vertical progress timeline. state: 'done' | 'current' | 'todo'.
export function Timeline({ items }) {
  return (
    <View>
      {items.map((it, i) => (
        <FadeIn key={it.key || i} delay={i * 80} from="left" distance={10}>
          <View style={k.tlRow}>
            <View style={k.tlRail}>
              <Pulse active={it.state === 'current'} min={0.5} duration={900}>
                <View style={[k.tlDot, it.state === 'done' && { backgroundColor: colors.LOW, borderColor: colors.LOW }, it.state === 'current' && { backgroundColor: colors.primary, borderColor: colors.primary }]}>
                  {it.state === 'done' ? <Feather name="check" size={10} color="#fff" /> : null}
                </View>
              </Pulse>
              {i < items.length - 1 ? <View style={[k.tlLine, it.state === 'done' && { backgroundColor: colors.LOW }]} /> : null}
            </View>
            <View style={{ flex: 1, paddingBottom: 14 }}>
              <Text style={[k.tlTitle, it.state === 'todo' && { color: colors.muted }]}>{it.title}</Text>
              {it.detail ? <Text style={k.tlDetail}>{it.detail}</Text> : null}
            </View>
            {it.time ? <Text style={k.tlTime}>{it.time}</Text> : null}
          </View>
        </FadeIn>
      ))}
    </View>
  );
}

// Bottom sheet: slides up over the screen, dismisses on backdrop tap or Close. Content scrolls.
// Bottom sheet: springs up, animates out on close, and can be swiped down by its handle/header (the phone-native way to dismiss).
export function Sheet({ visible, onClose, title, children, tone }) {
  const reduced = useReducedMotion();
  const v = useRef(new Animated.Value(0)).current;      // 0 hidden → 1 open
  const drag = useRef(new Animated.Value(0)).current;   // finger offset while swiping down
  const [mounted, setMounted] = useState(!!visible);
  useEffect(() => {
    if (visible) {
      setMounted(true); drag.setValue(0);
      if (reduced) { v.setValue(1); return undefined; }
      v.setValue(0);
      const a = Animated.spring(v, { toValue: 1, friction: 9, tension: 80, useNativeDriver: true });
      a.start();
      return () => a.stop();
    }
    if (!mounted) return undefined;
    if (reduced) { v.setValue(0); setMounted(false); return undefined; }
    const a = Animated.timing(v, { toValue: 0, duration: 200, easing: Easing.in(Easing.cubic), useNativeDriver: true });
    a.start(() => setMounted(false));
    return () => a.stop();
  }, [visible, reduced]); // eslint-disable-line react-hooks/exhaustive-deps
  const pan = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => g.dy > 6 && Math.abs(g.dy) > Math.abs(g.dx),
    onPanResponderMove: (_, g) => drag.setValue(Math.max(0, g.dy)),
    onPanResponderRelease: (_, g) => {
      if (g.dy > 90 || g.vy > 0.9) onClose && onClose();
      else Animated.spring(drag, { toValue: 0, friction: 7, tension: 120, useNativeDriver: true }).start();
    },
    onPanResponderTerminate: () => Animated.spring(drag, { toValue: 0, useNativeDriver: true }).start(),
  }), [onClose]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!mounted) return null;
  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <View style={k.sheetRoot}>
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(2,6,23,0.45)', opacity: v }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close details" accessibilityRole="button" />
        </Animated.View>
        <Animated.View style={[k.sheet, tone && { borderTopColor: tone, borderTopWidth: 3 }, { opacity: v, transform: [{ translateY: Animated.add(v.interpolate({ inputRange: [0, 1], outputRange: [120, 0] }), drag) }] }]}>
          <View {...pan.panHandlers}>
            <View style={k.sheetHandle} />
            <View style={k.sheetHead}>
              <Text style={k.sheetTitle} numberOfLines={2}>{title}</Text>
              <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close"><Feather name="x" size={20} color={colors.muted} /></Pressable>
            </View>
          </View>
          <ScrollView contentContainerStyle={{ paddingBottom: 24 }} showsVerticalScrollIndicator={false}>{children}</ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

// Confirmation for anything dangerous or hard to undo.
export function ConfirmDialog({ visible, title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger, busy, onConfirm, onCancel }) {
  return (
    <Modal visible={!!visible} transparent animationType="fade" onRequestClose={onCancel} statusBarTranslucent>
      <View style={k.dialogRoot}>
        <View style={k.dialog} accessibilityViewIsModal>
          <View style={[k.dialogIcon, { backgroundColor: danger ? '#FEE2E2' : '#E0F2FE' }]}><Feather name={danger ? 'alert-triangle' : 'help-circle'} size={22} color={danger ? colors.HIGH : colors.primary} /></View>
          <Text style={k.dialogTitle}>{title}</Text>
          {message ? <Text style={k.dialogMsg}>{message}</Text> : null}
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 18 }}>
            <View style={{ flex: 1 }}><SmallButton label={cancelLabel} outline color={colors.muted} onPress={onCancel} disabled={busy} /></View>
            <View style={{ flex: 1 }}><SmallButton label={busy ? 'Working…' : confirmLabel} color={danger ? colors.HIGH : colors.primary} onPress={onConfirm} disabled={busy} /></View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// A short confirmation that appears, stays, and fades (success or failure). Controlled by the parent via `show`.
export function Notice({ kind = 'success', children, onDone }) {
  const reduced = useReducedMotion();
  const v = useRef(new Animated.Value(reduced ? 1 : 0)).current;
  useEffect(() => {
    const a = Animated.sequence([
      Animated.timing(v, { toValue: 1, duration: reduced ? 0 : 220, useNativeDriver: true }),
      Animated.delay(2600),
      Animated.timing(v, { toValue: 0, duration: reduced ? 0 : 300, useNativeDriver: true }),
    ]);
    a.start(({ finished }) => { if (finished && onDone) onDone(); });
    return () => a.stop();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const ok = kind === 'success';
  return (
    <Animated.View accessibilityRole="alert" style={[k.notice, { backgroundColor: ok ? '#DCFCE7' : '#FEE2E2', borderColor: ok ? '#86EFAC' : '#FCA5A5', opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [-8, 0] }) }] }]}>
      <PopIn><Feather name={ok ? 'check-circle' : 'x-circle'} size={18} color={ok ? colors.LOW : colors.HIGH} /></PopIn>
      <Text style={[k.noticeText, { color: ok ? '#166534' : '#991B1B' }]}>{children}</Text>
    </Animated.View>
  );
}

const k = StyleSheet.create({
  sectionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, marginBottom: 10 },
  section: { fontFamily: fonts.extrabold, fontSize: 16, color: colors.text },
  skelCard: { backgroundColor: colors.card, borderRadius: radius.card, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: colors.border },
  state: { alignItems: 'center', backgroundColor: colors.card, borderRadius: radius.card, padding: 22, marginBottom: 12, borderWidth: 1, borderColor: colors.border },
  stateIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  stateTitle: { fontFamily: fonts.bold, fontSize: 15, color: colors.text, textAlign: 'center' },
  stateMsg: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted, textAlign: 'center', marginTop: 4, lineHeight: 19 },
  metric: { flex: 1, backgroundColor: colors.card, borderRadius: radius.card, padding: 14, borderWidth: 1, borderColor: colors.border, minHeight: 92, ...shadow },
  metricTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  metricLabel: { fontFamily: fonts.bold, fontSize: 11, letterSpacing: 0.5, color: colors.muted, flexShrink: 1 },
  metricValue: { fontFamily: fonts.extrabold, fontSize: 26, marginTop: 6 },
  metricHint: { fontFamily: fonts.regular, fontSize: 11, color: colors.muted, marginTop: 2 },
  gaugeNum: { fontFamily: fonts.extrabold, letterSpacing: -1 },
  gaugeOf: { fontFamily: fonts.semibold, fontSize: 14, opacity: 0.85 },
  gaugeTrack: { flexDirection: 'row', height: 10, borderRadius: 999, marginTop: 10, position: 'relative', overflow: 'visible', gap: 3, borderWidth: 1, borderColor: 'rgba(255,255,255,0.55)', padding: 1 },
  gaugeBand: { flex: 1, borderRadius: 999 },
  gaugeMarker: { position: 'absolute', top: -5, marginLeft: -10, width: 20, height: 20, alignItems: 'center', justifyContent: 'center' },
  gaugeKnob: { width: 18, height: 18, borderRadius: 9, backgroundColor: '#FFFFFF', borderWidth: 3, borderColor: palette.ink },
  gaugeLabels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  gaugeLabel: { fontFamily: fonts.bold, fontSize: 9, letterSpacing: 0.6, opacity: 0.75, flex: 1, textAlign: 'center' },
  tlRow: { flexDirection: 'row', alignItems: 'flex-start' },
  tlRail: { width: 26, alignItems: 'center' },
  tlDot: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: '#CBD5E1', backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  tlLine: { width: 2, flex: 1, minHeight: 22, backgroundColor: '#E2E8F0', marginTop: 2 },
  tlTitle: { fontFamily: fonts.bold, fontSize: 14, color: colors.text, marginTop: -1 },
  tlDetail: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, marginTop: 2, lineHeight: 17 },
  tlTime: { fontFamily: fonts.medium, fontSize: 11, color: colors.muted, marginLeft: 8 },
  sheetRoot: { flex: 1, justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 18, paddingTop: 8, maxHeight: '82%' },
  sheetHandle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: '#CBD5E1', marginBottom: 10 },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 10 },
  sheetTitle: { fontFamily: fonts.extrabold, fontSize: 17, color: colors.text, flex: 1 },
  dialogRoot: { flex: 1, backgroundColor: 'rgba(2,6,23,0.55)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  dialog: { width: '100%', maxWidth: 380, backgroundColor: colors.card, borderRadius: 22, padding: 22, alignItems: 'center' },
  dialogIcon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  dialogTitle: { fontFamily: fonts.extrabold, fontSize: 18, color: colors.text, textAlign: 'center' },
  dialogMsg: { fontFamily: fonts.regular, fontSize: 14, color: colors.muted, textAlign: 'center', marginTop: 6, lineHeight: 20 },
  notice: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 14, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 12 },
  noticeText: { fontFamily: fonts.semibold, fontSize: 13, flex: 1 },
});
