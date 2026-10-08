import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Header from '../../components/Header';
import ActionButton from '../../components/ActionButton';
import { Card, ErrorText } from '../../components/ui';
import { RequestCard } from '../../components/RequestCards';
import { useVolunteer } from '../../context/VolunteerContext';
import { colors, fonts } from '../../theme';

export default function VolunteerNearby({ navigate }) {
  const { reqs, loading, error, available, claim } = useVolunteer();
  const [busyId, setBusyId] = useState(null);
  const [msg, setMsg] = useState('');

  const accept = async (id) => {
    setBusyId(id);
    setMsg('');
    const r = await claim(id);
    if (!r.ok) setMsg(r.message || 'Unable to accept request. Please try again.');
    else navigate('Requests');
    setBusyId(null);
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Header title="Nearby Requests" subtitle="Open requests you can help with" />
      <ScrollView contentContainerStyle={s.body}>
        <ErrorText>{error ? `${error} Showing the last data received.` : ''}</ErrorText>
        <ErrorText>{msg}</ErrorText>
        {!available && <Card><Text style={s.warn}>You are unavailable. Go available on the Home tab to accept requests.</Text></Card>}
        <Text style={s.sort}>Sorted by priority, then distance</Text>
        {loading ? <Text style={s.hint}>Loading…</Text> : reqs.nearby_open.length === 0 ? (
          <Card><Text style={s.hint}>No open requests nearby match your skills right now.</Text></Card>
        ) : reqs.nearby_open.map((r) => (
          <RequestCard key={r.request_id} item={r} highlight={r.priority === 'CRITICAL' || r.priority === 'HIGH'}>
            <ActionButton variant="primary" label={busyId === r.request_id ? 'ACCEPTING…' : 'ACCEPT REQUEST'} color={colors.LOW}
              disabled={!available || busyId === r.request_id} onPress={() => accept(r.request_id)} />
            <ActionButton variant="primary" label="SHOW ON MAP" color={colors.route} onPress={() => navigate('Map', { requestId: r.request_id })} />
          </RequestCard>
        ))}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  body: { padding: 16, paddingBottom: 40 },
  sort: { fontFamily: fonts.semibold, fontSize: 12, color: colors.muted, marginBottom: 10 },
  hint: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted, lineHeight: 19 },
  warn: { fontFamily: fonts.semibold, fontSize: 14, color: '#B45309', lineHeight: 20 },
});
