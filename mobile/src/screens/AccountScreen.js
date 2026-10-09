import React, { useState } from 'react';
import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import Header from '../components/Header';
import ActionButton from '../components/ActionButton';
import DeviceCheck from '../components/DeviceCheck';
import { Card, ErrorText, Field, Label, Pill, Segmented, SmallButton } from '../components/ui';
import { errorText, useAuth } from '../context/AuthContext';
import { updatePreferences } from '../services/accountApi';
import { LANGUAGES } from '../i18n/strings';
import { useLang } from '../i18n';
import { colors, fonts } from '../theme';

const ROLE_LABEL = { user: 'Normal user', volunteer: 'Volunteer', admin: 'Super Admin' };

export default function AccountScreen() {
  const { user, logout, updateUser } = useAuth();
  const { t, lang, setLang } = useLang();
  const [phone, setPhone] = useState(user.phone || '');
  const [sms, setSms] = useState(!!user.notify_sms);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const run = async (fn, ok) => {
    setBusy(true); setError(''); setMsg('');
    try { await fn(); if (ok) setMsg(ok); } catch (e) { setError(errorText(e)); }
    setBusy(false);
  };
  const changeLang = (l) => { setLang(l); updatePreferences({ language: l }).then((u) => updateUser(u)).catch(() => {}); };
  const savePrefs = () => run(async () => updateUser(await updatePreferences({ phone, notify_sms: sms })), 'Saved.');

  return (
    <View style={{ flex: 1 }}>
      <Header title={t('tab.Account')} subtitle="Your session" />
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Card>
          <Text style={styles.name}>{user.name}</Text>
          <View style={{ marginTop: 6, marginBottom: 14 }}><Pill text={ROLE_LABEL[user.role] || user.role} color={colors.primary} /></View>
          <Label>EMAIL</Label>
          <Text style={styles.value}>{user.email}</Text>
          {user.email_verified ? <Pill text={t('account.verified')} color={colors.LOW} /> : <Text style={styles.help}>Your email is verified the first time you sign in with an email code.</Text>}
        </Card>

        <Card>
          <Text style={styles.h}>{t('account.language')}</Text>
          <Segmented options={LANGUAGES} value={lang} onChange={changeLang} />
        </Card>

        <Card>
          <Text style={styles.h}>{t('account.notifications')}</Text>
          <Field label={t('account.phone').toUpperCase()} value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="+91 98450 00000" />
          <View style={styles.switchRow}>
            <Text style={styles.switchText}>{t('account.sms')}</Text>
            <Switch value={sms} onValueChange={setSms} accessibilityLabel={t('account.sms')} />
          </View>
          <ErrorText>{error}</ErrorText>
          {msg ? <Text style={styles.ok}>{msg}</Text> : null}
          <SmallButton label={t('account.save')} disabled={busy} onPress={savePrefs} />
        </Card>

        <DeviceCheck />

        <ActionButton variant="primary" label={t('account.logout')} color={colors.navy} onPress={logout} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, paddingBottom: 100 },
  name: { fontFamily: fonts.extrabold, fontSize: 22, color: colors.text },
  value: { fontFamily: fonts.medium, fontSize: 16, color: colors.text, marginBottom: 12 },
  h: { fontFamily: fonts.extrabold, fontSize: 16, color: colors.text, marginBottom: 8 },
  help: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted, marginBottom: 10, lineHeight: 19 },
  row: { flexDirection: 'row', gap: 10 },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 },
  switchText: { flex: 1, fontFamily: fonts.medium, fontSize: 14, color: colors.text },
  ok: { fontFamily: fonts.semibold, fontSize: 13, color: colors.LOW, marginBottom: 10 },
});
