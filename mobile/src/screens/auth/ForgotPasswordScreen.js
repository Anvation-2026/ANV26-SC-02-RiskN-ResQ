import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ActionButton from '../../components/ActionButton';
import { ErrorText, Field } from '../../components/ui';
import { errorText } from '../../context/AuthContext';
import { forgotPassword, resetPassword } from '../../services/accountApi';
import { useT } from '../../i18n';
import { colors, fonts } from '../../theme';

// Two steps: ask for a code by email, then enter the code with a new password.
export default function ForgotPasswordScreen({ goLogin }) {
  const t = useT();
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState(1);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [info, setInfo] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const send = async () => {
    if (!email.trim()) return setError('Enter your email.');
    setBusy(true); setError('');
    try { await forgotPassword(email.trim()); setInfo(t('auth.codeSent')); setStep(2); } catch (e) { setError(errorText(e)); }
    setBusy(false);
  };
  const reset = async () => {
    if (code.trim().length < 4) return setError('Enter the code from your email.');
    if (password.length < 8) return setError('Password must be at least 8 characters.');
    setBusy(true); setError('');
    try { await resetPassword(email.trim(), code.trim(), password); goLogin(t('auth.resetDone')); } catch (e) { setError(errorText(e)); setBusy(false); }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: 'transparent' }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 56 }]} keyboardShouldPersistTaps="handled">
        <Text style={styles.brand}>{t('auth.forgotTitle')}</Text>
        <View style={styles.card}>
          <Text style={styles.help}>{step === 1 ? t('auth.forgotHelp') : info}</Text>
          <ErrorText>{error}</ErrorText>
          <Field label={t('auth.email')} value={email} onChangeText={setEmail} keyboardType="email-address" editable={step === 1} placeholder="you@example.com" />
          {step === 2 && (
            <>
              <Field label={t('auth.code')} value={code} onChangeText={setCode} keyboardType="number-pad" maxLength={6} placeholder="123456" />
              <Field label={t('auth.newPassword')} value={password} onChangeText={setPassword} secureTextEntry placeholder="At least 8 characters" onSubmitEditing={reset} />
            </>
          )}
          <ActionButton variant="primary" label={step === 1 ? t('auth.sendCode') : t('auth.reset')} loading={busy} onPress={step === 1 ? send : reset} />
          <Pressable onPress={() => goLogin()} style={{ marginTop: 18, alignItems: 'center' }} hitSlop={8}>
            <Text style={styles.link}>{t('auth.backLogin')}</Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: 20, paddingBottom: 40 },
  brand: { fontFamily: fonts.extrabold, fontSize: 28, color: '#fff', marginBottom: 24 },
  card: { backgroundColor: colors.bg, borderRadius: 22, padding: 22 },
  help: { fontFamily: fonts.medium, fontSize: 14, color: colors.muted, marginBottom: 14, lineHeight: 20 },
  link: { fontFamily: fonts.bold, fontSize: 14, color: colors.primary },
});
