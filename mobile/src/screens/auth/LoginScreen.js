import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ActionButton from '../../components/ActionButton';
import { ErrorText, Field } from '../../components/ui';
import { errorText, useAuth } from '../../context/AuthContext';
import { Image } from 'react-native';
import { symbols } from '../../assets';
import { colors, fonts } from '../../theme';

export default function LoginScreen({ goRegister }) {
  const insets = useSafeAreaInsets();
  const { login, notice } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!email.trim() || !password) return setError('Enter your email and password.');
    setBusy(true);
    setError('');
    try {
      await login(email, password);
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.navy }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 56 }]} keyboardShouldPersistTaps="handled">
        <Image source={symbols.logo} style={styles.logo} />
        <Text style={styles.brand}>RiskN ResQ</Text>
        <Text style={styles.tag}>Hyper-local flood early warning</Text>
        <View style={styles.card}>
          <Text style={styles.title}>Welcome Back</Text>
          <ErrorText>{error || notice}</ErrorText>
          <Field label="EMAIL" value={email} onChangeText={setEmail} keyboardType="email-address" autoComplete="email" placeholder="you@example.com" />
          <Field label="PASSWORD" value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" placeholder="Your password" onSubmitEditing={submit} />
          <View style={{ marginTop: 6 }}>
            <ActionButton variant="primary" label={busy ? 'SIGNING IN…' : 'LOGIN'} disabled={busy} onPress={submit} />
          </View>
          <Pressable onPress={goRegister} style={{ marginTop: 18, alignItems: 'center' }} hitSlop={8}>
            <Text style={styles.link}>New here? <Text style={{ fontFamily: fonts.bold, color: colors.primary }}>Create an account</Text></Text>
          </Pressable>
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
  foot: { fontFamily: fonts.regular, fontSize: 12, color: '#94A3B8', textAlign: 'center', marginTop: 18 },
});
