import React from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import Header from '../../components/Header';
import ActionButton from '../../components/ActionButton';
import { Card, Label, Pill } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { useVolunteer } from '../../context/VolunteerContext';
import { prettyResource } from '../../integration/volunteerAdapter';
import { symbols } from '../../assets';
import { colors, fonts } from '../../theme';

export default function VolunteerAccount() {
  const { user, logout } = useAuth();
  const { volunteer, available } = useVolunteer();
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Header title="Account" subtitle="Your volunteer profile" />
      <ScrollView contentContainerStyle={s.body}>
        <Card>
          <View style={s.row}>
            <Image source={symbols.verified} style={s.sym} />
            <View style={{ flex: 1 }}>
              <Text style={s.name}>{user.name}</Text>
              <View style={{ marginTop: 6 }}><Pill text="VOLUNTEER" color={colors.primary} /></View>
            </View>
          </View>
          <View style={{ height: 14 }} />
          <Label>EMAIL</Label>
          <Text style={s.value}>{user.email}</Text>
          {user.phone ? (<><Label>PHONE</Label><Text style={s.value}>{user.phone}</Text></>) : null}
          <Label>AVAILABILITY</Label>
          <View style={{ marginBottom: 12 }}><Pill text={available ? 'AVAILABLE' : 'UNAVAILABLE'} color={available ? colors.LOW : colors.HIGH} /></View>
          <Label>RESOURCE / SKILL</Label>
          <Text style={s.value}>{volunteer ? prettyResource(volunteer.skill) : '—'}</Text>
        </Card>
        <Text style={s.note}>Your role and permissions are set by an administrator and cannot be changed here.</Text>
        <ActionButton variant="primary" label="LOG OUT" color={colors.navy} onPress={logout} />
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  body: { padding: 16, paddingBottom: 40 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  sym: { width: 48, height: 48, borderRadius: 12 },
  name: { fontFamily: fonts.extrabold, fontSize: 20, color: colors.text },
  value: { fontFamily: fonts.semibold, fontSize: 15, color: colors.text, marginBottom: 12 },
  note: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, marginVertical: 12, lineHeight: 18 },
});
