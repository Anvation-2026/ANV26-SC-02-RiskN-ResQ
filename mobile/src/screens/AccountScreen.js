import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Header from '../components/Header';
import ActionButton from '../components/ActionButton';
import { Card, Label, Pill } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { colors, fonts } from '../theme';

const ROLE_LABEL = { user: 'Normal user', volunteer: 'Volunteer', admin: 'Super Admin' };

export default function AccountScreen() {
  const { user, logout } = useAuth();
  return (
    <View style={{ flex: 1 }}>
      <Header title="Account" subtitle="Your session" />
      <ScrollView contentContainerStyle={styles.body}>
        <Card>
          <Text style={styles.name}>{user.name}</Text>
          <View style={{ marginTop: 6, marginBottom: 14 }}><Pill text={ROLE_LABEL[user.role] || user.role} color={colors.primary} /></View>
          <Label>EMAIL</Label>
          <Text style={styles.value}>{user.email}</Text>
          {user.phone ? (<><Label>PHONE</Label><Text style={styles.value}>{user.phone}</Text></>) : null}
        </Card>
        <ActionButton variant="primary" label="LOG OUT" color={colors.navy} onPress={logout} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, paddingBottom: 32 },
  name: { fontFamily: fonts.extrabold, fontSize: 22, color: colors.text },
  value: { fontFamily: fonts.medium, fontSize: 16, color: colors.text, marginBottom: 12 },
});
