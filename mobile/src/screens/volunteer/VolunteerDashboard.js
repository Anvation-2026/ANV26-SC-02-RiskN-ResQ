import React, { useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { symbols } from '../../assets';
import Header from '../../components/Header';
import ActionButton from '../../components/ActionButton';
import { Card, ErrorText, Label, Pill, SmallButton, statusColor } from '../../components/ui';
import { errorText, useAuth } from '../../context/AuthContext';
import usePolling from '../../hooks/usePolling';
import { acceptMatch, completeMatch, getMyRequests, getMyVolunteer, patchMyVolunteer } from '../../services/accountApi';
import { formatDistance } from '../../features/disaster-response/utils/distance';
import { prettyResource } from '../../integration/volunteerAdapter';
import { colors, fonts } from '../../theme';

export default function VolunteerDashboard() {
  const { user, logout } = useAuth();
  const me = usePolling(getMyVolunteer, 6000);
  const reqs = usePolling(getMyRequests, 6000);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');

  const act = async (fn) => {
    setBusy(true);
    setActionError('');
    try { await fn(); await Promise.all([me.reload(), reqs.reload()]); } catch (e) { setActionError(errorText(e)); }
    setBusy(false);
  };

  const v = me.data && me.data.volunteer;
  const assigned = (reqs.data && reqs.data.assigned) || [];
  const nearby = (reqs.data && reqs.data.nearby_open) || [];
  const available = v && v.available;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Header title={`Welcome, ${user.name.split(' ')[0]}`} subtitle="Volunteer dashboard" right={<SmallButton label="Log out" outline color="#fff" onPress={logout} />} />
      <ScrollView contentContainerStyle={styles.body}>
        <ErrorText>{me.error || reqs.error || actionError}</ErrorText>
        {!v ? (
          <Text style={styles.muted}>{me.loading ? 'Loading…' : 'No volunteer profile is linked to this account.'}</Text>
        ) : (
          <>
            <Card>
              <Label>STATUS</Label>
              <View style={styles.rowBetween}>
                <Pill text={available ? 'AVAILABLE' : 'UNAVAILABLE'} color={available ? colors.LOW : colors.HIGH} />
                <SmallButton label={available ? 'Mark Unavailable' : 'Mark Available'} color={available ? colors.HIGH : colors.LOW} disabled={busy}
                  onPress={() => act(() => patchMyVolunteer({ available: !available }))} />
              </View>
              <View style={styles.stats}>
                <View style={styles.stat}><Label>RESOURCE</Label><Text style={styles.statValue}>{prettyResource(v.skill)}</Text></View>
                <View style={styles.stat}><Label>NEARBY REQUESTS</Label><Text style={styles.statValue}>{nearby.length}</Text></View>
                <View style={styles.stat}><Label>ASSIGNED</Label><Text style={styles.statValue}>{assigned.length}</Text></View>
              </View>
              <Text style={styles.muted}>Location: {v.latitude}, {v.longitude}</Text>
            </Card>

            <Text style={styles.section}>Assigned requests</Text>
            {assigned.length === 0 ? <Card><Text style={styles.muted}>Nothing assigned right now.</Text></Card> : assigned.map((a) => (
              <Card key={a.match_id}>
                <View style={styles.rowBetween}>
                  <Text style={styles.title}>{prettyResource(a.type)} · Request #{a.request_id}</Text>
                  <Pill text={a.match_status} color={statusColor(a.match_status)} />
                </View>
                <Text style={styles.line}>Priority: <Text style={styles.strong}>{a.priority}</Text></Text>
                {a.distance_km != null ? <Text style={styles.line}>Distance: <Text style={styles.strong}>{formatDistance(a.distance_km)}</Text></Text> : null}
                {a.requester_name ? <Text style={styles.line}>Requester: <Text style={styles.strong}>{a.requester_name}{a.requester_phone ? ` · ${a.requester_phone}` : ''}</Text></Text> : null}
                <View style={{ marginTop: 12 }}>
                  {(a.match_status === 'PROPOSED' || a.match_status === 'MATCHED') && <ActionButton variant="primary" label="ACCEPT REQUEST" disabled={busy} onPress={() => act(() => acceptMatch(a.match_id))} />}
                  {a.match_status === 'ACCEPTED' && <ActionButton variant="primary" label="MARK COMPLETED" color={colors.LOW} disabled={busy} onPress={() => act(() => completeMatch(a.match_id))} />}
                </View>
              </Card>
            ))}

            <Text style={styles.section}>Open requests for {prettyResource(v.skill)} nearby</Text>
            {nearby.length === 0 ? <Card><Text style={styles.muted}>No open requests within 15 km.</Text></Card> : nearby.map((n) => (
              <Card key={n.request_id}>
                <View style={styles.rowBetween}>
                  <Text style={styles.title}>Request #{n.request_id}</Text>
                  <Pill text={n.priority} color={n.priority === 'CRITICAL' || n.priority === 'HIGH' ? colors.HIGH : colors.MEDIUM} />
                </View>
                <Text style={styles.line}>{formatDistance(n.distance_km)} away · waiting to be matched</Text>
              </Card>
            ))}
          </>
        )}
        <Text style={styles.section}>Account</Text>
        <Card>
          <View style={styles.accountRow}>
            <Image source={symbols.verified} style={styles.accountSymbol} />
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{user.name}</Text>
              <Text style={styles.line}>{user.email}</Text>
              <View style={{ marginTop: 6 }}><Pill text="VOLUNTEER" color={colors.primary} /></View>
            </View>
          </View>
          <View style={{ marginTop: 12 }}>
            <ActionButton variant="primary" label="LOG OUT" color={colors.navy} onPress={logout} />
          </View>
        </Card>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  accountRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  accountSymbol: { width: 44, height: 44, borderRadius: 12 },
  body: { padding: 16, paddingBottom: 40 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  stats: { flexDirection: 'row', gap: 10, marginTop: 16, marginBottom: 10 },
  stat: { flex: 1, backgroundColor: colors.bg, borderRadius: 12, padding: 10 },
  statValue: { fontFamily: fonts.extrabold, fontSize: 16, color: colors.text },
  section: { fontFamily: fonts.extrabold, fontSize: 16, color: colors.text, marginVertical: 10 },
  title: { fontFamily: fonts.bold, fontSize: 15, color: colors.text, flexShrink: 1 },
  line: { fontFamily: fonts.regular, fontSize: 14, color: colors.muted, marginTop: 6 },
  strong: { fontFamily: fonts.bold, color: colors.text },
  muted: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted },
});
