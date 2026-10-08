import React, { useEffect, useState } from 'react';
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import Header from '../../components/Header';
import ActionButton from '../../components/ActionButton';
import { Card, ErrorText, Label, Segmented } from '../../components/ui';
import { Fact, PriorityBadge, RequestCard } from '../../components/RequestCards';
import { useVolunteer } from '../../context/VolunteerContext';
import { formatDistance } from '../../features/disaster-response/utils/distance';
import { prettyResource } from '../../integration/volunteerAdapter';
import { timeAgo } from '../../services/geo';
import { colors, fonts } from '../../theme';

export default function VolunteerRequests({ navigate, active }) {
  const { reqs, loading, error, markSeen, accept, complete, enRoute, arrived, reject, cancel } = useVolunteer();
  const [tab, setTab] = useState('active');
  const [selected, setSelected] = useState(null); // match_id
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => { if (active) markSeen(); }, [active, markSeen, reqs.assigned.length]);

  const list = tab === 'active' ? reqs.assigned : reqs.completed;
  const item = [...reqs.assigned, ...reqs.completed].find((r) => r.match_id === selected);

  const run = async (fn, failText) => {
    setBusy(true);
    setMsg('');
    const r = await fn();
    if (!r.ok) setMsg(r.message || failText);
    setBusy(false);
  };

  if (item) {
    const toAccept = item.match_status === 'MATCHED' || item.match_status === 'PROPOSED';
    const isAccepted = item.match_status === 'ACCEPTED';
    const isEnRoute = item.match_status === 'EN_ROUTE';
    const isArrived = item.match_status === 'ARRIVED';
    const isDone = item.match_status === 'COMPLETED';

    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <Header title="Request details" subtitle={`${prettyResource(item.type)} · #${item.request_id}`} />
        <ScrollView contentContainerStyle={s.body}>
          <ErrorText>{msg}</ErrorText>
          <Card>
            <View style={s.top}><Text style={s.type}>{prettyResource(item.type)}</Text><PriorityBadge priority={item.priority} /></View>
            <Label>STATUS</Label>
            <Text style={s.value}>
              {toAccept
                ? 'ASSIGNED (waiting for your acceptance)'
                : isEnRoute
                ? 'EN ROUTE TO CITIZEN'
                : isArrived
                ? 'ARRIVED AT SCENE'
                : item.match_status}
            </Text>
            <Label>LOCATION</Label>
            <Text style={s.value}>{item.zone || 'Target location'}{item.latitude != null ? ` · ${item.latitude.toFixed(4)}, ${item.longitude.toFixed(4)}` : ''}</Text>
            <Label>DISTANCE</Label>
            <Text style={s.value}>{item.distance_km != null ? `${formatDistance(item.distance_km)} from you` : 'Unknown'}</Text>
            <Label>REQUESTED</Label>
            <Text style={s.value}>{timeAgo(item.created_at)}</Text>
            {item.requester_name ? (<><Label>REQUESTER</Label><Text style={s.value}>{item.requester_name}{item.requester_phone ? ` · ${item.requester_phone}` : ''}</Text></>) : null}
          </Card>
          {!isDone && (
            <View style={{ gap: 10 }}>
              {toAccept && (
                <>
                  <ActionButton
                    variant="primary"
                    label={busy ? 'ACCEPTING…' : 'ACCEPT ASSIGNMENT'}
                    disabled={busy}
                    color={colors.LOW}
                    onPress={() => run(() => accept(item.match_id), 'Unable to accept request. Please try again.')}
                  />
                  <ActionButton
                    variant="primary"
                    label={busy ? 'DECLINING…' : 'DECLINE / REJECT'}
                    disabled={busy}
                    color={colors.HIGH}
                    onPress={() => run(async () => { const r = await reject(item.request_id); if (r.ok) setSelected(null); return r; }, 'Unable to decline request.')}
                  />
                </>
              )}

              {isAccepted && (
                <>
                  <ActionButton
                    variant="primary"
                    label={busy ? 'STARTING TRAVEL…' : 'START TRAVEL (EN ROUTE)'}
                    disabled={busy}
                    color="#0284C7"
                    onPress={() => run(() => enRoute(item.request_id), 'Unable to update status.')}
                  />
                  <ActionButton
                    variant="primary"
                    label="CANCEL ASSIGNMENT"
                    disabled={busy}
                    color="#DC2626"
                    onPress={() => run(async () => { const r = await cancel(item.request_id, 'Volunteer cancelled assignment'); if (r.ok) setSelected(null); return r; }, 'Unable to cancel.')}
                  />
                </>
              )}

              {isEnRoute && (
                <ActionButton
                  variant="primary"
                  label={busy ? 'UPDATING…' : 'I HAVE ARRIVED AT SCENE'}
                  disabled={busy}
                  color={colors.LOW}
                  onPress={() => run(() => arrived(item.request_id), 'Unable to update status.')}
                />
              )}

              {isArrived && (
                <ActionButton
                  variant="primary"
                  label={busy ? 'COMPLETING…' : 'MARK AS COMPLETED'}
                  disabled={busy}
                  color={colors.LOW}
                  onPress={() => run(async () => { const r = await complete(item.match_id); if (r.ok) setSelected(null); return r; }, 'Unable to complete request. Please try again.')}
                />
              )}

              {item.requester_phone ? (
                <ActionButton
                  variant="primary"
                  label={`CALL CITIZEN (${item.requester_phone})`}
                  color={colors.navy}
                  onPress={() => Linking.openURL(`tel:${item.requester_phone}`).catch(() => {})}
                />
              ) : null}

              <ActionButton
                variant="primary"
                label="SHOW ROUTE ON MAP"
                color={colors.route}
                onPress={() => navigate('Map', { requestId: item.request_id })}
              />
            </View>
          )}
          <View style={{ marginTop: 10 }}><ActionButton variant="primary" label="BACK TO LIST" color={colors.navy} onPress={() => { setSelected(null); setMsg(''); }} /></View>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Header title="My Requests" subtitle="Requests assigned to you" />
      <ScrollView contentContainerStyle={s.body}>
        <Segmented options={[['active', `Active (${reqs.assigned.length})`], ['done', `Completed (${reqs.stats.completed})`]]} value={tab} onChange={setTab} />
        <ErrorText>{error ? `${error} Showing the last data received.` : ''}</ErrorText>
        {loading ? <Text style={s.hint}>Loading…</Text> : list.length === 0 ? (
          <Card><Text style={s.hint}>{tab === 'active' ? 'No requests are assigned to you right now.' : 'You have not completed any requests yet.'}</Text></Card>
        ) : list.map((r) => (
          <RequestCard key={r.match_id} item={r} onPress={() => setSelected(r.match_id)} highlight={r.priority === 'CRITICAL' || r.priority === 'HIGH'}>
            <ActionButton variant="primary" label="VIEW DETAILS" color={colors.primary} onPress={() => setSelected(r.match_id)} />
          </RequestCard>
        ))}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  body: { padding: 16, paddingBottom: 40 },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  type: { fontFamily: fonts.extrabold, fontSize: 20, color: colors.text },
  value: { fontFamily: fonts.semibold, fontSize: 15, color: colors.text, marginBottom: 12 },
  hint: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted, lineHeight: 19 },
});
