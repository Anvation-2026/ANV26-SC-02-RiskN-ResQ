import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Card, ErrorText, Pill, SmallButton, statusColor, Timeline } from './ui';
import { PriorityBadge } from './RequestCards';
import { AnimatedNumber } from './motion';
import usePolling from '../hooks/usePolling';
import { getHelpRequests, getMatches, trackRequest, cancelHelpRequest } from '../services/accountApi';
import { useT } from '../i18n';
import { prettyResource } from '../integration/volunteerAdapter';
import { timeAgo } from '../services/geo';
import { colors, fonts } from '../theme';

const STATUS_TEXT = {
  OPEN: 'WAITING FOR A VOLUNTEER',
  MATCHED: 'VOLUNTEER ASSIGNED',
  ACCEPTED: 'VOLUNTEER ACCEPTED',
  EN_ROUTE: 'VOLUNTEER EN ROUTE',
  ARRIVED: 'VOLUNTEER ARRIVED',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
};

// The signed-in user's own help requests, read from the database (the server only returns the caller's own).
const STEPS = ['REQUESTED', 'MATCHED', 'ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'COMPLETED'];
const EVENT_TEXT = { REQUESTED: 'Request sent', MATCHED: 'Volunteer found', ACCEPTED: 'Volunteer accepted', EN_ROUTE: 'Volunteer on the way', ARRIVED: 'Volunteer arrived', COMPLETED: 'Completed', PROPOSED: 'Volunteer proposed' };

// Live progress of one request: timeline, the volunteer's distance and ETA. Mounted only while the card is open.
function Tracking({ id }) {
  const t = useT();
  const { data, error } = usePolling(() => trackRequest(id), 8000);
  if (error && !data) return <ErrorText>{error}</ErrorText>;
  if (!data) return <Text style={s.hint}>Loading…</Text>;
  const v = data.volunteer;
  const eta = t('help.eta', { m: '\u0000' }).split('\u0000'); // keeps the translated sentence around an animated number
  return (
    <View style={{ marginTop: 10 }}>
      {v && (
        <View style={s.vol}>
          <Text style={s.volName}>{v.name}</Text>
          {v.eta_minutes != null ? <Text style={s.eta}>{eta[0]}<AnimatedNumber value={v.eta_minutes} style={s.eta} />{eta[1]} · {v.distance_km} km</Text> : null}
          {v.phone ? <Text style={s.hint}>Phone: {v.phone}</Text> : null}
        </View>
      )}
      <Text style={s.tl}>{t('help.timeline').toUpperCase()}</Text>
      <Timeline items={STEPS.map((ev, i) => {
        const hit = data.timeline.find((e) => e.event === ev);
        const firstMissing = STEPS.findIndex((x) => !data.timeline.some((e) => e.event === x));
        return { key: ev, title: EVENT_TEXT[ev], detail: hit && hit.detail && ev !== 'REQUESTED' ? hit.detail : undefined, time: hit ? timeAgo(hit.at) : undefined,
                 state: hit ? 'done' : i === firstMissing ? 'current' : 'todo' };
      })} />
    </View>
  );
}

export default function MyHelpRequests({ navigate }) {
  const t = useT();
  const [open, setOpen] = useState(null);
  const reqs = usePolling(getHelpRequests, 8000);
  const matches = usePolling(getMatches, 8000);
  const [cancellingId, setCancellingId] = useState(null);

  const list = Array.isArray(reqs.data) ? reqs.data.slice(0, 8) : [];
  const matchFor = (id) => (Array.isArray(matches.data) ? matches.data.find((m) => m.help_request_id === id && m.status !== 'CANCELLED') : null);

  const onCancel = async (id) => {
    setCancellingId(id);
    try {
      await cancelHelpRequest(id, 'User cancelled from requests list');
      if (reqs.reload) await reqs.reload();
      if (matches.reload) await matches.reload();
    } catch (e) {
      /* ignore */
    } finally {
      setCancellingId(null);
    }
  };

  return (
    <View style={{ marginTop: 22 }}>
      <Text style={s.title}>{t('help.mine')}</Text>
      <ErrorText>{reqs.error}</ErrorText>
      {reqs.loading ? <Text style={s.hint}>Loading…</Text> : list.length === 0 ? (
        <Card><Text style={s.hint}>You have not made any help requests yet.</Text></Card>
      ) : list.map((r) => {
        const m = matchFor(r.id);
        const status = r.status === 'MATCHED' && m?.status ? (STATUS_TEXT[m.status] || m.status) : (STATUS_TEXT[r.status] || r.status);
        const isActive = r.status !== 'COMPLETED' && r.status !== 'CANCELLED';

        return (
          <Pressable key={r.id} onPress={() => setOpen(open === r.id ? null : r.id)} accessibilityRole="button" accessibilityLabel={`${prettyResource(r.type)} request ${r.id}`} accessibilityState={{ expanded: open === r.id }}>
          <Card>
            <View style={s.top}><Text style={s.type}>{prettyResource(r.type)} · #{r.id}</Text><PriorityBadge priority={r.priority} /></View>
            <View style={{ marginTop: 8, alignSelf: 'flex-start' }}><Pill text={status} color={statusColor(r.status === 'COMPLETED' ? 'COMPLETED' : isActive ? 'MATCHED' : 'OPEN')} /></View>
            {m && m.volunteer_name ? <Text style={s.hint}>Volunteer: {m.volunteer_name}</Text> : null}
            <Text style={s.hint}>Requested {timeAgo(r.created_at)}</Text>
            {open === r.id ? <Tracking id={r.id} /> : <Text style={s.more}>Tap for progress</Text>}
            {isActive && (
              <View style={s.actions}>
                {navigate && (
                  <SmallButton label="Track Live" color={colors.route} onPress={() => navigate('Tracking', { requestId: r.id })} />
                )}
                <SmallButton
                  label={cancellingId === r.id ? 'Cancelling…' : 'Cancel'}
                  outline
                  disabled={cancellingId === r.id}
                  onPress={() => onCancel(r.id)}
                />
              </View>
            )}
          </Card>
          </Pressable>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  title: { fontFamily: fonts.extrabold, fontSize: 16, color: colors.text, marginBottom: 10 },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  type: { fontFamily: fonts.bold, fontSize: 15, color: colors.text, flexShrink: 1 },
  vol: { backgroundColor: '#EFF6FF', borderRadius: 12, padding: 12, marginBottom: 10 },
  volName: { fontFamily: fonts.bold, fontSize: 15, color: colors.text },
  eta: { fontFamily: fonts.bold, fontSize: 14, color: colors.primary, marginTop: 4 },
  tl: { fontFamily: fonts.bold, fontSize: 11, letterSpacing: 0.6, color: colors.muted, marginBottom: 6 },
  event: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#CBD5E1' },
  eventText: { flex: 1, fontFamily: fonts.medium, fontSize: 13, color: colors.text },
  eventTime: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted },
  more: { fontFamily: fonts.semibold, fontSize: 12, color: colors.primary, marginTop: 8 },
  hint: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted, marginTop: 6, lineHeight: 19 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 12 },
});
