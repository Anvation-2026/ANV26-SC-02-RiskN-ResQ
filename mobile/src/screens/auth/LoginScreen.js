import React, { useState } from 'react';
import { Animated, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ActionButton from '../../components/ActionButton';
import { ErrorText, Field } from '../../components/ui';
import { errorText, useAuth } from '../../context/AuthContext';
import { Image } from 'react-native';
import { symbols } from '../../assets';
import { LANGUAGES } from '../../i18n/strings';
import { useLang } from '../../i18n';
import { colors, fonts } from '../../theme';
import { FadeIn, useShake } from '../../components/motion';

export default function LoginScreen({ goRegister, goForgot, message }) {
  const { t, lang, setLang } = useLang();
  const insets = useSafeAreaInsets();
  const { login, notice } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [shakeStyle, shake] = useShake();
  const fail = (msg) => { setError(msg); shake(); };

  const submit = async () => {
    if (!email.trim() || !password) return fail('Enter your email and password.');
    setBusy(true);
    setError('');
    try {
      await login(email, password);
    } catch (e) {
      fail(errorText(e));
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: 'transparent' }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 56 }]} keyboardShouldPersistTaps="handled">
        <Image source={symbols.logo} style={styles.logo} />
        <Text style={styles.brand}>RiskN ResQ</Text>
        <Text style={styles.tag}>Hyper-local flood early warning</Text>
        <Animated.View style={[styles.card, shakeStyle]}>
          <Text style={styles.title}>{t('auth.welcome')}</Text>
          {message ? <Text style={styles.ok}>{message}</Text> : null}
          <ErrorText>{error || notice}</ErrorText>
          <FadeIn delay={120}><Field label={t('auth.email')} value={email} onChangeText={setEmail} keyboardType="email-address" autoComplete="email" placeholder="you@example.com" /></FadeIn>
          <FadeIn delay={200}><Field label={t('auth.password')} value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" placeholder="Your password" onSubmitEditing={submit} /></FadeIn>
          <View style={{ marginTop: 6 }}>
            <FadeIn delay={280}><ActionButton variant="primary" label={busy ? t('auth.signingIn') : t('auth.login')} loading={busy} onPress={submit} /></FadeIn>
          </View>
          <Pressable onPress={goForgot} style={{ marginTop: 16, alignItems: 'center' }} hitSlop={8} accessibilityRole="button">
            <Text style={[styles.link, { color: colors.primary, fontFamily: fonts.bold }]}>{t('auth.forgot')}</Text>
          </Pressable>
          <Pressable onPress={goRegister} style={{ marginTop: 14, alignItems: 'center' }} hitSlop={8} accessibilityRole="button">
            <Text style={styles.link}>{t('auth.newHere')} <Text style={{ fontFamily: fonts.bold, color: colors.primary }}>{t('auth.create')}</Text></Text>
          </Pressable>
        </Animated.View>
        <View style={styles.langRow}>
          {LANGUAGES.map(([k, l]) => (
            <Pressable key={k} onPress={() => setLang(k)} accessibilityRole="button" accessibilityLabel={l} accessibilityState={{ selected: lang === k }} aria-selected={lang === k}
              style={[styles.langBtn, lang === k && { backgroundColor: '#fff' }]}>
              <Text style={[styles.langText, lang === k && { color: colors.navy }]}>{l}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.foot}>Volunteer and admin accounts are created by an administrator.</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  logo: { width: 72, height: 72, borderRadius: 18, marginBottom: 14 },
  scroll: { paddingHorizontal: 20, paddingBottom: 40 },
  brand: { fontFamily: fonts.extrabold, fontSize: 32, color: '#fff', letterSpacing: -0.5 },
  tag: { fontFamily: fonts.medium, fontSize: 14, color: '#94A3B8', marginTop: 4, marginBottom: 28 },
  card: { backgroundColor: colors.bg, borderRadius: 22, padding: 22 },
  title: { fontFamily: fonts.extrabold, fontSize: 22, color: colors.text, marginBottom: 16 },
  link: { fontFamily: fonts.medium, fontSize: 14, color: colors.muted },
  ok: { fontFamily: fonts.semibold, fontSize: 13, color: colors.LOW, marginBottom: 10 },
  langRow: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginTop: 20 },
  langBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: '#475569' },
  langText: { fontFamily: fonts.bold, fontSize: 13, color: '#CBD5E1' },
  foot: { fontFamily: fonts.regular, fontSize: 12, color: '#94A3B8', textAlign: 'center', marginTop: 18 },
});
