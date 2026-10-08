import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import Header from '../../components/Header';
import ActionButton from '../../components/ActionButton';
import { Chip } from '../ReportScreen';
import { Card, ErrorText, Field, Label, Pill, Segmented, SmallButton, statusColor } from '../../components/ui';
import { errorText } from '../../context/AuthContext';
import usePolling from '../../hooks/usePolling';
import { createVolunteer, disableVolunteer, getAdminUsers, getVolunteersFull, setUserActive, updateVolunteer } from '../../services/accountApi';
import { prettyResource } from '../../integration/volunteerAdapter';
import { colors, fonts } from '../../theme';

const SKILLS = ['MEDICINE', 'FOOD', 'WATER', 'FIRST_AID', 'EVACUATION'];
const BLANK = { name: '', email: '', phone: '', password: '', skill: 'MEDICINE', latitude: '12.9716', longitude: '77.5946', available: true };

export default function AdminPeople() {
  const [tab, setTab] = useState('volunteers');
  const vols = usePolling(getVolunteersFull, 8000);
  const users = usePolling(getAdminUsers, 8000);
  const [form, setForm] = useState(null); // null = hidden, {id?, ...fields}
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));

  const run = async (fn) => {
    setBusy(true);
    setError('');
    try { await fn(); await Promise.all([vols.reload(), users.reload()]); return true; } catch (e) { setError(errorText(e)); return false; } finally { setBusy(false); }
  };

  const save = async () => {
    const lat = parseFloat(form.latitude), lng = parseFloat(form.longitude);
    if (!form.name.trim() || (!form.id && (!form.email.trim() || form.password.length < 8))) return setError('Name, email and a password of at least 8 characters are required.');
    if (Number.isNaN(lat) || Number.isNaN(lng)) return setError('Latitude and longitude must be numbers.');
    const body = { name: form.name.trim(), phone: form.phone.trim() || null, skill: form.skill, latitude: lat, longitude: lng, available: form.available };
    if (form.id) {
      if (form.hasLogin) { body.email = form.email.trim(); if (form.password) body.password = form.password; }
      if (await run(() => updateVolunteer(form.id, body))) setForm(null);
    } else if (await run(() => createVolunteer({ ...body, email: form.email.trim(), password: form.password }))) setForm(null);
  };

  const edit = (v) => setForm({ id: v.id, hasLogin: v.has_login, name: v.name, email: v.email || '', phone: v.phone || '', password: '', skill: v.skill, latitude: String(v.latitude), longitude: String(v.longitude), available: v.available });

  return (
    <View style={{ flex: 1 }}>
      <Header title="People" subtitle="Volunteers and user accounts" />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Segmented options={[['volunteers', 'Volunteers'], ['users', 'All users']]} value={tab} onChange={setTab} />
        <ErrorText>{error || vols.error || users.error}</ErrorText>

        {tab === 'volunteers' && (
          <>
            {form ? (
              <Card>
                <Text style={styles.title}>{form.id ? 'Edit volunteer' : 'Add volunteer'}</Text>
                <Field label="NAME" value={form.name} onChangeText={set('name')} autoCapitalize="words" />
                {(!form.id || form.hasLogin) && <Field label="EMAIL" value={form.email} onChangeText={set('email')} keyboardType="email-address" />}
                <Field label="PHONE" value={form.phone} onChangeText={set('phone')} keyboardType="phone-pad" />
                {(!form.id || form.hasLogin) && <Field label={form.id ? 'NEW PASSWORD (LEAVE BLANK TO KEEP)' : 'PASSWORD (MIN 8)'} value={form.password} onChangeText={set('password')} secureTextEntry />}
                <Label>RESOURCE / SKILL</Label>
                <View style={styles.wrap}>{SKILLS.map((k) => <Chip key={k} active={form.skill === k} onPress={() => set('skill')(k)}>{prettyResource(k)}</Chip>)}</View>
                <View style={{ height: 12 }} />
                <View style={styles.two}>
                  <View style={{ flex: 1 }}><Field label="LATITUDE" value={form.latitude} onChangeText={set('latitude')} keyboardType="numeric" /></View>
                  <View style={{ flex: 1 }}><Field label="LONGITUDE" value={form.longitude} onChangeText={set('longitude')} keyboardType="numeric" /></View>
                </View>
                <View style={styles.rowBetween}><Label>AVAILABLE</Label><Switch value={form.available} onValueChange={set('available')} /></View>
                <View style={{ marginTop: 10, gap: 8 }}>
                  <ActionButton variant="primary" label={busy ? 'SAVING…' : form.id ? 'SAVE CHANGES' : 'CREATE VOLUNTEER ACCOUNT'} disabled={busy} onPress={save} />
                  <ActionButton variant="primary" label="CANCEL" color={colors.muted} onPress={() => { setForm(null); setError(''); }} />
                </View>
              </Card>
            ) : (
              <View style={{ marginBottom: 12 }}><ActionButton variant="primary" label="+ ADD VOLUNTEER" onPress={() => { setError(''); setForm({ ...BLANK }); }} /></View>
            )}
            {(vols.data || []).map((v) => (
              <Card key={v.id}>
                <View style={styles.rowBetween}>
                  <Text style={styles.title}>{v.name}</Text>
                  <Pill text={v.status} color={statusColor(v.status)} />
                </View>
                <Text style={styles.line}>{prettyResource(v.skill)} · {v.latitude}, {v.longitude}</Text>
                <Text style={styles.line}>{v.email || 'Demo roster entry (no login)'}{v.phone ? ` · ${v.phone}` : ''}</Text>
                <View style={[styles.rowBetween, { marginTop: 10 }]}>
                  <Pill text={v.available ? 'AVAILABLE' : 'UNAVAILABLE'} color={v.available ? colors.LOW : colors.muted} />
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <SmallButton label="Edit" outline onPress={() => edit(v)} />
                    {v.status === 'ACTIVE'
                      ? <SmallButton label="Disable" color={colors.HIGH} disabled={busy} onPress={() => run(() => disableVolunteer(v.id))} />
                      : <SmallButton label="Enable" color={colors.LOW} disabled={busy} onPress={() => run(() => updateVolunteer(v.id, { status: 'ACTIVE' }))} />}
                  </View>
                </View>
              </Card>
            ))}
          </>
        )}

        {tab === 'users' && (users.data || []).map((u) => (
          <Card key={u.id}>
            <View style={styles.rowBetween}>
              <Text style={styles.title}>{u.name}</Text>
              <Pill text={u.role === 'admin' ? 'SUPER ADMIN' : u.role.toUpperCase()} color={u.role === 'admin' ? colors.CRITICAL : u.role === 'volunteer' ? colors.primary : colors.muted} />
            </View>
            <Text style={styles.line}>{u.email}{u.phone ? ` · ${u.phone}` : ''}</Text>
            <View style={[styles.rowBetween, { marginTop: 10 }]}>
              <Pill text={u.is_active ? 'ACTIVE' : 'DISABLED'} color={statusColor(u.is_active ? 'ACTIVE' : 'DISABLED')} />
              {u.role !== 'admin' && (
                <SmallButton label={u.is_active ? 'Disable' : 'Enable'} color={u.is_active ? colors.HIGH : colors.LOW} disabled={busy}
                  onPress={() => run(() => setUserActive(u.id, !u.is_active))} />
              )}
            </View>
          </Card>
        ))}
      </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, paddingBottom: 40 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  two: { flexDirection: 'row', gap: 10 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  title: { fontFamily: fonts.bold, fontSize: 16, color: colors.text, flexShrink: 1, marginBottom: 6 },
  line: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted, marginTop: 3 },
});
