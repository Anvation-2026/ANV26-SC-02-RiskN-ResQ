import React from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import Header from '../../components/Header';
import ActionButton from '../../components/ActionButton';
import { Card, ErrorText, Label, SmallButton, MetricCard, Notice, SkeletonCard } from '../../components/ui';
import { FadeIn, Pulse } from '../../components/motion';
import { RequestCard } from '../../components/RequestCards';
import { useAuth } from '../../context/AuthContext';
import { useVolunteer } from '../../context/VolunteerContext';
import { prettyResource } from '../../integration/volunteerAdapter';
import { symbols } from '../../assets';
import { colors, fonts } from '../../theme';

const Stat = ({ label, value, onPress }) => (
  <Pressable onPress={onPress} style={s.stat}>
    <Text style={s.statValue}>{value}</Text>
    <Text style={s.statLabel}>{label}</Text>
  </Pressable>
);

export default function VolunteerHome({ navigate }) {
  const { user } = useAuth();
  const { volunteer, reqs, loading, error, newIds, available, setAvailable, updateLocationFromGps } = useVolunteer();
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState('');

  const [notice, setNotice] = React.useState(null);
  const run = async (fn, okText) => {
    setBusy(true);
    setMsg('');
    const r = await fn();
    if (!r.ok) setMsg(r.message);
    else if (okText) setNotice({ id: Date.now(), text: okText });
    setBusy(false);
  };

  const hasLocation = volunteer && typeof volunteer.latitude === 'number' && typeof volunteer.longitude === 'number';
  const first = reqs.assigned[0];

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Header brand title={`Hello, ${user.name.split(' ')[0]}`} subtitle="Volunteer Dashboard" />
      <ScrollView contentContainerStyle={s.body}>
        <ErrorText>{error ? `${error} Showing the last data received.` : ''}</ErrorText>
        <ErrorText>{msg}</ErrorText>
        {notice ? <Notice key={notice.id} onDone={() => setNotice(null)}>{notice.text}</Notice> : null}

        {newIds.length > 0 && (
          <FadeIn from="down">
            <Pressable style={s.newBanner} onPress={() => navigate('Requests')} accessibilityRole="button">
              <Pulse min={0.5}><Feather name="bell" size={16} color="#fff" /></Pulse>
              <Text style={s.newText}>New help request assigned. Tap to view.</Text>
            </Pressable>
          </FadeIn>
        )}

        {first && (first.match_status === 'ACCEPTED' || first.match_status === 'EN_ROUTE' || first.match_status === 'ARRIVED') && (
          <View style={{ marginBottom: 12 }}>
            <ActionButton
              variant="primary"
              label={`ACTIVE MISSION: ${first.match_status.replace('_', ' ')} · MAP & ROUTE`}
              color={colors.route}
              onPress={() => navigate('Map', { requestId: first.request_id })}
            />
          </View>
        )}

        <Card>
          <Label>STATUS</Label>
          <View style={s.statusRow}>
            <Pulse active={available} min={0.35} duration={1000}><View style={[s.dot, { backgroundColor: available ? colors.LOW : colors.HIGH }]} /></Pulse>
            <Text style={[s.statusText, { color: available ? colors.LOW : colors.HIGH }]}>{available ? 'AVAILABLE' : 'UNAVAILABLE'}</Text>
          </View>
          <Text style={s.hint}>{available ? 'You can be matched to new help requests.' : 'You will not be matched to new requests while unavailable.'}</Text>
          <View style={{ marginTop: 12 }}>
            <ActionButton variant="primary" disabled={busy || loading || !volunteer} color={available ? colors.HIGH : colors.LOW}
              label={available ? 'GO UNAVAILABLE' : 'GO AVAILABLE'} onPress={() => run(() => setAvailable(!available), available ? 'You are now unavailable. No new requests will be assigned.' : 'You are now available for new requests.')} />
          </View>
        </Card>

        <View style={s.stats}>
          <MetricCard label="ASSIGNED" value={reqs.stats.assigned} color={colors.primary} icon="inbox" delay={60} onPress={() => navigate('Requests')} />
          <MetricCard label="NEARBY" value={reqs.stats.nearby} color={colors.MEDIUM} icon="crosshair" delay={120} onPress={() => navigate('Nearby')} />
          <MetricCard label="COMPLETED" value={reqs.stats.completed} color={colors.LOW} icon="check-circle" delay={180} onPress={() => navigate('Requests')} />
        </View>

        <Card>
          <View style={s.resRow}>
            <Image source={symbols.medical} style={s.sym} />
            <View style={{ flex: 1 }}>
              <Label>RESOURCE / SKILL</Label>
              <Text style={s.resText}>{volunteer ? prettyResource(volunteer.skill) : loading ? 'Loading…' : '—'}</Text>
            </View>
          </View>
          <View style={s.locRow}>
            <Feather name="map-pin" size={14} color={colors.muted} />
            <Text style={s.locText}>{hasLocation ? `${volunteer.latitude.toFixed(4)}, ${volunteer.longitude.toFixed(4)}` : 'Location unavailable'}</Text>
          </View>
          <View style={{ marginTop: 10, alignSelf: 'flex-start' }}>
            <SmallButton label="Update from my GPS" outline disabled={busy} onPress={() => run(updateLocationFromGps, 'Your location was updated from GPS.')} />
          </View>
        </Card>

        <Text style={s.section}>Next request</Text>
        {loading ? <SkeletonCard lines={3} /> : first ? (
          <RequestCard item={first} highlight onPress={() => navigate('Requests')} />
        ) : (
          <Card><Text style={s.hint}>{available ? 'No requests assigned right now.' : 'You are unavailable, so no requests will be assigned.'}</Text></Card>
        )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  body: { padding: 16, paddingBottom: 40 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dot: { width: 14, height: 14, borderRadius: 7 },
  statusText: { fontFamily: fonts.extrabold, fontSize: 24, letterSpacing: 0.4 },
  hint: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted, marginTop: 6, lineHeight: 19 },
  stats: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  stat: { flex: 1, backgroundColor: '#fff', borderRadius: 16, paddingVertical: 14, alignItems: 'center' },
  statValue: { fontFamily: fonts.extrabold, fontSize: 28, color: colors.text },
  statLabel: { fontFamily: fonts.semibold, fontSize: 12, color: colors.muted },
  resRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  sym: { width: 42, height: 42, borderRadius: 11 },
  resText: { fontFamily: fonts.extrabold, fontSize: 18, color: colors.text },
  locRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 12 },
  locText: { fontFamily: fonts.medium, fontSize: 14, color: colors.text },
  section: { fontFamily: fonts.extrabold, fontSize: 16, color: colors.text, marginVertical: 10 },
  newBanner: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.primary, borderRadius: 14, padding: 14, marginBottom: 12 },
  newText: { color: '#fff', fontFamily: fonts.bold, fontSize: 14, flex: 1 },
});
