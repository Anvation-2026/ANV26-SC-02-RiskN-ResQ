import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ActionButton from '../../components/ActionButton';
import { ErrorText, Field } from '../../components/ui';
import { errorText, useAuth } from '../../context/AuthContext';
import { colors, fonts } from '../../theme';

export default function RegisterScreen({ goLogin }) {
  const insets = useSafeAreaInsets();
  const { register } = useAuth();
  const [f, setF] = useState({ name: '', email: '', phone: '', password: '', confirm: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));

  const submit = async () => {
    if (!f.name.trim() || !f.email.trim()) return setError('Name and email are required.');
    if (f.password.length < 8) return setError('Password must be at least 8 characters.');
    if (f.password !== f.confirm) return setError('Passwords do not match.');
    setBusy(true);
    setError('');
    try {
      // Only these fields are sent. There is no role field: every self-registered account is a normal user.
      await register({ name: f.name.trim(), email: f.email.trim(), password: f.password, confirm_password: f.confirm, ...(f.phone.trim() ? { phone: f.phone.trim() } : {}) });
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.navy }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 36 }]} keyboardShouldPersistTaps="handled">
        <Text style={styles.brand}>RiskN ResQ</Text>
        <View style={styles.card}>
          <Text style={styles.title}>Create Account</Text>
          <ErrorText>{error}</ErrorText>
          <Field label="NAME" value={f.name} onChangeText={set('name')} autoCapitalize="words" placeholder="Your name" />
          <Field label="EMAIL" value={f.email} onChangeText={set('email')} keyboardType="email-address" placeholder="you@example.com" />
          <Field label="PHONE (OPTIONAL)" value={f.phone} onChangeText={set('phone')} keyboardType="phone-pad" placeholder="+91 98450 12345" />
          <Field label="PASSWORD" value={f.password} onChangeText={set('password')} secureTextEntry placeholder="At least 8 characters" />
          <Field label="CONFIRM PASSWORD" value={f.confirm} onChangeText={set('confirm')} secureTextEntry placeholder="Repeat your password" onSubmitEditing={submit} />
          <View style={{ marginTop: 6 }}>
            <ActionButton variant="primary" label={busy ? 'CREATING…' : 'CREATE ACCOUNT'} disabled={busy} onPress={submit} />
          </View>
          <Pressable onPress={goLogin} style={{ marginTop: 18, alignItems: 'center' }} hitSlop={8}>
            <Text style={styles.link}>Already have an account? <Text style={{ fontFamily: fonts.bold, color: colors.primary }}>Log in</Text></Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: 20, paddingBottom: 40 },
  brand: { fontFamily: fonts.extrabold, fontSize: 28, color: '#fff', letterSpacing: -0.5, marginBottom: 18 },
  card: { backgroundColor: colors.bg, borderRadius: 22, padding: 22 },
  title: { fontFamily: fonts.extrabold, fontSize: 22, color: colors.text, marginBottom: 16 },
  link: { fontFamily: fonts.medium, fontSize: 14, color: colors.muted },
});
