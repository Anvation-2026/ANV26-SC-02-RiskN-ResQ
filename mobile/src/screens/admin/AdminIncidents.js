import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Header from '../../components/Header';
import { Card, ErrorText, Pill, SmallButton, statusColor } from '../../components/ui';
import { errorText } from '../../context/AuthContext';
import usePolling from '../../hooks/usePolling';
import { getAllIncidents, setIncident } from '../../services/accountApi';
import { timeAgo } from '../../services/geo';
import { colors, fonts } from '../../theme';

export default function AdminIncidents() {
  const { data, error, reload } = usePolling(getAllIncidents, 6000);
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState(false);

  const act = async (id, action) => {
    setBusy(true);
    setActionError('');
    try { await setIncident(id, action); await reload(); } catch (e) { setActionError(errorText(e)); }
    setBusy(false);
  };

  return (
    <View style={{ flex: 1 }}>
      <Header title="Incidents" subtitle="Verify, reject or resolve citizen reports" />
      <ScrollView contentContainerStyle={styles.body}>
        <ErrorText>{actionError || error}</ErrorText>
        {data && data.length === 0 && <Text style={styles.line}>No incidents yet.</Text>}
        {(data || []).map((i) => (
          <Card key={i.id}>
            <View style={styles.rowBetween}>
              <Text style={styles.title}>{i.type.replace('_', ' ')} · #{i.id}</Text>
              <Pill text={i.status} color={statusColor(i.status)} />
            </View>
            <Text style={styles.desc}>{i.description || 'No description'}</Text>
            <Text style={styles.line}>{i.zone} · trust {i.trust_score} · severity {i.severity} · {timeAgo(i.timestamp)}</Text>
            <View style={styles.actions}>
              {i.status === 'REPORTED' && <SmallButton label="Verify" color={colors.LOW} disabled={busy} onPress={() => act(i.id, 'verify')} />}
              {i.status === 'REPORTED' && <SmallButton label="Reject" color={colors.HIGH} disabled={busy} onPress={() => act(i.id, 'reject')} />}
              {(i.status === 'REPORTED' || i.status === 'VERIFIED') && <SmallButton label="Resolve" outline disabled={busy} onPress={() => act(i.id, 'resolve')} />}
            </View>
          </Card>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, paddingBottom: 40 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  title: { fontFamily: fonts.bold, fontSize: 15, color: colors.text, flexShrink: 1 },
  desc: { fontFamily: fonts.medium, fontSize: 14, color: colors.text, marginTop: 8 },
  line: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, marginTop: 4 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 12 },
});
