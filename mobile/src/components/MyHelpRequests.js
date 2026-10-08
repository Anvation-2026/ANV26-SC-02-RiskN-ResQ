import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Card, ErrorText, Pill, SmallButton, statusColor } from './ui';
import { PriorityBadge } from './RequestCards';
import usePolling from '../hooks/usePolling';
import { getHelpRequests, getMatches, cancelHelpRequest } from '../services/accountApi';
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
export default function MyHelpRequests({ navigate }) {
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
      <Text style={s.title}>My requests</Text>
      <ErrorText>{reqs.error}</ErrorText>
      {reqs.loading ? <Text style={s.hint}>Loading…</Text> : list.length === 0 ? (
        <Card><Text style={s.hint}>You have not made any help requests yet.</Text></Card>
      ) : list.map((r) => {
        const m = matchFor(r.id);
        const status = r.status === 'MATCHED' && m?.status ? (STATUS_TEXT[m.status] || m.status) : (STATUS_TEXT[r.status] || r.status);
        const isActive = r.status !== 'COMPLETED' && r.status !== 'CANCELLED';

        return (
          <Card key={r.id}>
            <View style={s.top}><Text style={s.type}>{prettyResource(r.type)} · #{r.id}</Text><PriorityBadge priority={r.priority} /></View>
            <View style={{ marginTop: 8, alignSelf: 'flex-start' }}><Pill text={status} color={statusColor(r.status === 'COMPLETED' ? 'COMPLETED' : isActive ? 'MATCHED' : 'OPEN')} /></View>
            {m && m.volunteer_name ? <Text style={s.hint}>Volunteer: {m.volunteer_name}</Text> : null}
            <Text style={s.hint}>Requested {timeAgo(r.created_at)}</Text>

            {isActive && (
              <View style={s.actions}>
                {navigate && (
                  <SmallButton
                    label="Track Live"
                    color={colors.route}
                    onPress={() => navigate('Tracking', { requestId: r.id })}
                  />
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
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  title: { fontFamily: fonts.extrabold, fontSize: 16, color: colors.text, marginBottom: 10 },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  type: { fontFamily: fonts.bold, fontSize: 15, color: colors.text, flexShrink: 1 },
  hint: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted, marginTop: 6, lineHeight: 19 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 12 },
});
