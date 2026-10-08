import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Header from '../../components/Header';
import ActionButton from '../../components/ActionButton';
import { Card, ErrorText, Label, SmallButton } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import usePolling from '../../hooks/usePolling';
import { getAdminSummary } from '../../services/accountApi';
import { colors, fonts, riskColor } from '../../theme';

const Stat = ({ label, value, color }) => (
  <View style={styles.stat}>
    <Label>{label}</Label>
    <Text style={[styles.value, color && { color }]}>{value}</Text>
  </View>
);

export default function AdminDashboard({ navigate }) {
  const { user, logout } = useAuth();
  const { data: s, error } = usePolling(getAdminSummary, 5000);
  return (
    <View style={{ flex: 1 }}>
      <Header title="Admin Dashboard" subtitle={`Signed in as ${user.name}`} right={<SmallButton label="Log out" outline color="#fff" onPress={logout} />} />
      <ScrollView contentContainerStyle={styles.body}>
        <ErrorText>{error}</ErrorText>
        {s ? (
          <>
            <View style={styles.grid}>
              <Stat label="ACTIVE RISK" value={`${s.risk.risk_level} · ${s.risk.risk_score}`} color={riskColor(s.risk.risk_level)} />
              <Stat label="ACTIVE ALERTS" value={s.active_alerts} />
              <Stat label="OPEN INCIDENTS" value={s.open_incidents} />
              <Stat label="BLOCKED ROADS" value={s.blocked_roads} color={s.blocked_roads ? colors.HIGH : undefined} />
              <Stat label="PENDING HELP REQUESTS" value={s.pending_help_requests} />
              <Stat label="AVAILABLE VOLUNTEERS" value={s.available_volunteers} />
            </View>
            <Text style={styles.note}>{s.notice}</Text>
          </>
        ) : <Text style={styles.note}>Loading…</Text>}
        <Text style={styles.section}>Manage</Text>
        <View style={styles.tiles}>
          <ActionButton iconName="users" label="Manage Volunteers" onPress={() => navigate('People')} />
          <ActionButton iconName="alert-triangle" label="Manage Incidents" onPress={() => navigate('Incidents')} />
          <ActionButton iconName="slash" label="Manage Roads" onPress={() => navigate('Control')} />
          <ActionButton iconName="cloud-rain" label="Simulate Hazard" onPress={() => navigate('Control')} />
          <ActionButton iconName="inbox" label="Help Requests & Matches" onPress={() => navigate('Requests')} />
          <ActionButton iconName="rotate-ccw" label="Reset Demo" color={colors.HIGH} onPress={() => navigate('Control')} />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, paddingBottom: 40 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  stat: { flexBasis: '47%', flexGrow: 1, backgroundColor: '#fff', borderRadius: 16, padding: 14 },
  value: { fontFamily: fonts.extrabold, fontSize: 22, color: colors.text },
  note: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, marginTop: 12 },
  section: { fontFamily: fonts.extrabold, fontSize: 16, color: colors.text, marginTop: 20, marginBottom: 10 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
});
