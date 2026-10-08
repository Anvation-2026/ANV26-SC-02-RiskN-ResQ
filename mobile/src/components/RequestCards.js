import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { Card, Pill, statusColor } from './ui';
import { formatDistance } from '../features/disaster-response/utils/distance';
import { prettyResource } from '../integration/volunteerAdapter';
import { timeAgo } from '../services/geo';
import { colors, fonts } from '../theme';

export const PRIORITY_COLOR = { CRITICAL: '#7F1D1D', HIGH: colors.HIGH, MEDIUM: '#D97706', LOW: colors.LOW };

export const PriorityBadge = ({ priority }) => (
  <View style={[s.badge, { backgroundColor: PRIORITY_COLOR[priority] || colors.muted }]}>
    {(priority === 'CRITICAL' || priority === 'HIGH') && <Feather name="alert-triangle" size={11} color="#fff" style={{ marginRight: 4 }} />}
    <Text style={s.badgeText}>{priority}</Text>
  </View>
);

export const Fact = ({ icon, children }) => (
  <View style={s.fact}>
    <Feather name={icon} size={13} color={colors.muted} />
    <Text style={s.factText} numberOfLines={2}>{children}</Text>
  </View>
);

const statusLabel = (item) => (item.match_status === 'MATCHED' || item.match_status === 'PROPOSED' ? 'ASSIGNED' : item.match_status || item.status);

// One request as a card. `children` are the action buttons.
export function RequestCard({ item, onPress, highlight, children }) {
  const status = item.match_status ? statusLabel(item) : 'OPEN';
  return (
    <Card style={highlight ? s.highlight : undefined}>
      <Pressable onPress={onPress} disabled={!onPress}>
        <View style={s.top}>
          <Text style={s.type}>{prettyResource(item.type)}</Text>
          <PriorityBadge priority={item.priority} />
        </View>
        <View style={s.facts}>
          {item.distance_km != null && <Fact icon="navigation">{formatDistance(item.distance_km)} away</Fact>}
          {item.zone ? <Fact icon="map-pin">{item.zone}</Fact> : null}
          <Fact icon="clock">{timeAgo(item.created_at)}</Fact>
        </View>
        <View style={{ marginTop: 8 }}><Pill text={status} color={statusColor(status === 'ASSIGNED' ? 'MATCHED' : status)} /></View>
      </Pressable>
      {children ? <View style={s.actions}>{children}</View> : null}
    </Card>
  );
}

const s = StyleSheet.create({
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  type: { fontFamily: fonts.extrabold, fontSize: 17, color: colors.text, flexShrink: 1 },
  badge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  badgeText: { color: '#fff', fontSize: 11, fontFamily: fonts.extrabold, letterSpacing: 0.4 },
  facts: { marginTop: 10, gap: 6 },
  fact: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  factText: { fontFamily: fonts.medium, fontSize: 13, color: colors.muted, flexShrink: 1 },
  actions: { marginTop: 12, gap: 8 },
  highlight: { borderLeftWidth: 5, borderLeftColor: colors.HIGH },
});
