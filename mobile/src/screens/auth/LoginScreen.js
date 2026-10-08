import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Image, KeyboardAvoidingView, LayoutAnimation, Platform, Pressable, ScrollView, StyleSheet, Text, UIManager, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Feather from '@expo/vector-icons/Feather';
import ActionButton from '../../components/ActionButton';
import OtpInput from '../../components/OtpInput';
import { ErrorText, Field } from '../../components/ui';
import { errorText, useAuth } from '../../context/AuthContext';
import { requestLoginCode } from '../../services/accountApi';
import { symbols } from '../../assets';
import { LANGUAGES } from '../../i18n/strings';
import { useLang } from '../../i18n';
import { colors, fonts } from '../../theme';
import { FadeIn, useReducedMotion, useShake } from '../../components/motion';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) UIManager.setLayoutAnimationEnabledExperimental(true);
const ease = () => LayoutAnimation.configureNext(LayoutAnimation.create(220, LayoutAnimation.Types.easeInEaseOut, LayoutAnimation.Properties.opacity));
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Two ways in: email + password (every role), or an emailed 6-digit code (user accounts only; the server never sends one
// to a volunteer or admin, and answers the same way for unknown emails so it cannot reveal who is registered).
function MethodSwitch({ value, onChange, t }) {
  const reduced = useReducedMotion();
  const [w, setW] = useState(0);
  const x = useRef(new Animated.Value(value === 'code' ? 1 : 0)).current;
  useEffect(() => {
    const to = value === 'code' ? 1 : 0;
    if (reduced) { x.setValue(to); return; }
    Animated.spring(x, { toValue: to, friction: 9, tension: 120, useNativeDriver: true }).start();
  }, [value, reduced]); // eslint-disable-line react-hooks/exhaustive-deps
  const half = w / 2;
  return (
    <View style={s.switch} onLayout={(e) => setW(e.nativeEvent.layout.width - 8)} accessibilityRole="tablist">
      {w > 0 && <Animated.View style={[s.switchPill, { width: half, transform: [{ translateX: x.interpolate({ inputRange: [0, 1], outputRange: [0, half] }) }] }]} />}
      {[['password', t('auth.withPassword'), 'lock'], ['code', t('auth.withCode'), 'mail']].map(([k, label, icon]) => (
        <Pressable key={k} style={s.switchBtn} onPress={() => onChange(k)} accessibilityRole="tab" accessibilityState={{ selected: value === k }} aria-selected={value === k}>
          <Feather name={icon} size={14} color={value === k ? colors.navy : '#64748B'} />
          <Text style={[s.switchText, value === k && { color: colors.navy }]}>{label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export default function LoginScreen({ goRegister, goForgot, message }) {
  const { t, lang, setLang } = useLang();
  const insets = useSafeAreaInsets();
  const { login, loginWithCode, notice } = useAuth();
  const [method, setMethod] = useState('password');
  const [step, setStep] = useState('email'); // email code flow: 'email' → 'code'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [codeError, setCodeError] = useState(0); // bumps on every wrong code, so the boxes shake each time
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(0); // seconds until "resend" is allowed
  const [shakeStyle, shake] = useShake();
  const fail = (msg) => { setError(msg); shake(); };

  useEffect(() => {
    if (wait <= 0) return undefined;
    const id = setTimeout(() => setWait((n) => n - 1), 1000);
    return () => clearTimeout(id);
  }, [wait]);

  const switchMethod = (m) => { ease(); setMethod(m); setError(''); setInfo(''); setStep('email'); setCode(''); };

  const submitPassword = async () => {
    if (!email.trim() || !password) return fail('Enter your email and password.');
    setBusy(true); setError('');
    try {
      await login(email, password); // on success this screen is replaced by the welcome transition
    } catch (e) {
      fail(errorText(e)); setBusy(false);
    }
  };

  const sendCode = async () => {
    if (!EMAIL_RE.test(email.trim())) return fail('Enter the email address of your account.');
    setBusy(true); setError('');
    try {
      const r = await requestLoginCode(email.trim());
      ease();
      setInfo(r.status);
      setWait(r.resend_after_seconds || 30);
      setStep('code'); setCode('');
    } catch (e) {
      fail(errorText(e));
    }
    setBusy(false);
  };

  const submitCode = async (digits = code) => {
    if (digits.length !== 6) return fail('Enter the 6-digit code from your email.');
    setBusy(true); setError('');
    try {
      await loginWithCode(email, digits);
    } catch (e) {
      setError(errorText(e)); setCodeError((n) => n + 1); setCode(''); setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: 'transparent' }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={[s.scroll, { paddingTop: insets.top + 48 }]} keyboardShouldPersistTaps="handled">
        <FadeIn from="down" distance={10}><Image source={symbols.logo} style={s.logo} /></FadeIn>
        <FadeIn delay={60}><Text style={s.brand}>RiskN ResQ</Text></FadeIn>
        <FadeIn delay={110}><Text style={s.tag}>Hyper-local flood early warning</Text></FadeIn>
        <FadeIn delay={160} distance={22}>
          <Animated.View style={[s.card, shakeStyle]}>
            <Text style={s.title}>{t('auth.welcome')}</Text>
            <MethodSwitch value={method} onChange={switchMethod} t={t} />
            {message ? <Text style={s.ok}>{message}</Text> : null}
            <ErrorText>{error || notice}</ErrorText>

            {method === 'password' ? (
              <View key="password">
                <Field label={t('auth.email')} value={email} onChangeText={setEmail} keyboardType="email-address" autoComplete="email" autoCapitalize="none" placeholder="you@example.com" />
                <Field label={t('auth.password')} value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" placeholder="Your password" onSubmitEditing={submitPassword} />
                <View style={{ marginTop: 6 }}>
                  <ActionButton variant="primary" label={busy ? t('auth.signingIn') : t('auth.login')} loading={busy} onPress={submitPassword} />
                </View>
                <Pressable onPress={goForgot} style={{ marginTop: 16, alignItems: 'center' }} hitSlop={8} accessibilityRole="button">
                  <Text style={[s.link, { color: colors.primary, fontFamily: fonts.bold }]}>{t('auth.forgot')}</Text>
                </Pressable>
              </View>
            ) : step === 'email' ? (
              <View key="code-email">
                <Text style={s.help}>{t('auth.codeHelp')}</Text>
                <Field label={t('auth.email')} value={email} onChangeText={setEmail} keyboardType="email-address" autoComplete="email" autoCapitalize="none" placeholder="you@example.com" onSubmitEditing={sendCode} />
                <View style={{ marginTop: 6 }}>
                  <ActionButton variant="primary" label={busy ? t('auth.sending') : t('auth.sendCode')} loading={busy} onPress={sendCode} />
                </View>
                <Text style={s.small}>{t('auth.codeUsersOnly')}</Text>
              </View>
            ) : (
              <View key="code-enter">
                <View style={s.sentRow}>
                  <View style={s.sentIcon}><Feather name="mail" size={16} color={colors.primary} /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.sentTitle}>{t('auth.checkEmail')}</Text>
                    <Text style={s.sentText} numberOfLines={3}>{info || `We sent a code to ${email.trim()}.`}</Text>
                  </View>
                </View>
                <Text style={s.label}>{t('auth.enterCode')}</Text>
                <OtpInput value={code} onChange={(v) => { setCode(v); if (error) setError(''); }} onComplete={submitCode} error={codeError && error ? codeError : 0} disabled={busy} />
                <View style={{ marginTop: 16 }}>
                  <ActionButton variant="primary" label={busy ? t('auth.signingIn') : t('auth.verify')} loading={busy} onPress={() => submitCode()} />
                </View>
                <View style={s.codeLinks}>
                  <Pressable onPress={() => { ease(); setStep('email'); setCode(''); setError(''); }} hitSlop={8} accessibilityRole="button">
                    <Text style={s.linkSmall}>{t('auth.changeEmail')}</Text>
                  </Pressable>
                  <Pressable onPress={sendCode} disabled={wait > 0 || busy} hitSlop={8} accessibilityRole="button" accessibilityState={{ disabled: wait > 0 }}>
                    <Text style={[s.linkSmall, (wait > 0 || busy) && { color: '#94A3B8' }]}>{wait > 0 ? `${t('auth.resendIn')} ${wait}s` : t('auth.resend')}</Text>
                  </Pressable>
                </View>
                <Text style={s.small}>{t('auth.codeExpiry')}</Text>
              </View>
            )}

            <Pressable onPress={goRegister} style={{ marginTop: 18, alignItems: 'center' }} hitSlop={8} accessibilityRole="button">
              <Text style={s.link}>{t('auth.newHere')} <Text style={{ fontFamily: fonts.bold, color: colors.primary }}>{t('auth.create')}</Text></Text>
            </Pressable>
          </Animated.View>
        </FadeIn>
        <View style={s.langRow}>
          {LANGUAGES.map(([k, l]) => (
            <Pressable key={k} onPress={() => setLang(k)} accessibilityRole="button" accessibilityLabel={l} accessibilityState={{ selected: lang === k }} aria-selected={lang === k}
              style={[s.langBtn, lang === k && { backgroundColor: '#fff' }]}>
              <Text style={[s.langText, lang === k && { color: colors.navy }]}>{l}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={s.foot}>Volunteer and admin accounts are created by an administrator and sign in with their password.</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  logo: { width: 72, height: 72, borderRadius: 18, marginBottom: 14 },
  scroll: { paddingHorizontal: 20, paddingBottom: 40, flexGrow: 1 },
  brand: { fontFamily: fonts.extrabold, fontSize: 32, color: '#fff', letterSpacing: -0.5 },
  tag: { fontFamily: fonts.medium, fontSize: 14, color: '#94A3B8', marginTop: 4, marginBottom: 24 },
  card: { backgroundColor: colors.bg, borderRadius: 24, padding: 20, shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 24, shadowOffset: { width: 0, height: 12 }, elevation: 8 },
  title: { fontFamily: fonts.extrabold, fontSize: 22, color: colors.text, marginBottom: 14 },
  switch: { flexDirection: 'row', backgroundColor: '#E2E8F0', borderRadius: 14, padding: 4, marginBottom: 14 },
  switchPill: { position: 'absolute', top: 4, bottom: 4, left: 4, borderRadius: 10, backgroundColor: '#FFFFFF', shadowColor: '#0F172A', shadowOpacity: 0.12, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  switchBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, minHeight: 44 },
  switchText: { fontFamily: fonts.bold, fontSize: 13, color: '#64748B' },
  help: { fontFamily: fonts.medium, fontSize: 13, color: colors.muted, lineHeight: 19, marginBottom: 10 },
  label: { fontFamily: fonts.bold, fontSize: 12, letterSpacing: 0.6, color: colors.muted, marginTop: 14, marginBottom: 8 },
  small: { fontFamily: fonts.medium, fontSize: 12, color: colors.muted, lineHeight: 17, marginTop: 12, textAlign: 'center' },
  sentRow: { flexDirection: 'row', gap: 10, alignItems: 'center', backgroundColor: '#EFF6FF', borderRadius: 14, padding: 12 },
  sentIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#DBEAFE', alignItems: 'center', justifyContent: 'center' },
  sentTitle: { fontFamily: fonts.extrabold, fontSize: 14, color: colors.text },
  sentText: { fontFamily: fonts.medium, fontSize: 12, color: colors.muted, marginTop: 1, lineHeight: 16 },
  codeLinks: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 16 },
  linkSmall: { fontFamily: fonts.bold, fontSize: 13, color: colors.primary },
  link: { fontFamily: fonts.medium, fontSize: 14, color: colors.muted },
  ok: { fontFamily: fonts.semibold, fontSize: 13, color: colors.LOW, marginBottom: 10 },
  langRow: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginTop: 20 },
  langBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: '#475569', minHeight: 36, justifyContent: 'center' },
  langText: { fontFamily: fonts.bold, fontSize: 13, color: '#CBD5E1' },
  foot: { fontFamily: fonts.regular, fontSize: 12, color: '#94A3B8', textAlign: 'center', marginTop: 18, lineHeight: 17 },
});
