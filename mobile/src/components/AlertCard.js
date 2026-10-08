import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { colors, radius, riskColor, shadow } from '../theme';
import { timeAgo } from '../services/geo';
import ActionButton from './ActionButton';

const Field = ({ label, value }) => (
  <View style={styles.field}>
    <Text style={styles.fl}>{label}</Text>
    <Text style={styles.fv} numberOfLines={2}>{value}</Text>
  </View>
);

export default function AlertCard({ alert, road, onViewRoute }) {
  const level = alert.severity === 'MODERATE' ? 'MEDIUM' : alert.severity;
  const c = riskColor(alert.severity);
  const urgent = level === 'HIGH' || level === 'CRITICAL';
  const area = alert.affected_zone || alert.zone || 'Monitored area';
  const roadText = alert.affected_road || road || 'None reported';
  const when = timeAgo(alert.created_at || alert.createdAt);

  return (
    <View style={[styles.card, { borderLeftColor: c }, urgent && { backgroundColor: c + '0D', borderColor: c + '55' }]}>
      <View style={styles.headerRow}>
        <Feather name={urgent ? 'alert-octagon' : 'alert-circle'} size={16} color={c} style={{ marginRight: 6 }} />
        <Text style={[styles.title, { color: c }]}>{level} FLOOD RISK</Text>
        {alert.drill ? (
          <View style={styles.drill}><Text style={styles.drillText}>SIMULATED</Text></View>
        ) : null}
      </View>

      <Text style={styles.msg}>{alert.message}</Text>

      <View style={styles.fields}>
        {alert.reason ? <Field label="Reason" value={alert.reason} /> : null}
        <Field label="Affected Area" value={area} />
        <Field label="Affected Road" value={roadText} />
        <Field label="Updated" value={when} />
      </View>

      {onViewRoute ? (
        <ActionButton
          variant="primary"
          label="VIEW ALTERNATIVE ROUTE"
          color={c}
          onPress={onViewRoute}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  drill: { marginLeft: 8, backgroundColor: '#EDE9FE', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  drillText: { color: '#6D28D9', fontSize: 10, fontFamily: 'PlusJakartaSans_800ExtraBold', letterSpacing: 0.6 },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.card,
    borderLeftWidth: 5,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    ...shadow,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  title: {
    fontSize: 15,
    fontFamily: 'PlusJakartaSans_800ExtraBold',
    letterSpacing: 0.4,
  },
  msg: {
    fontFamily: 'PlusJakartaSans_500Medium',
    fontSize: 13,
    lineHeight: 18,
    color: colors.text,
    marginBottom: 10,
  },
  fields: {
    backgroundColor: colors.bg,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 12,
    gap: 6,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  field: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  fl: {
    fontSize: 12,
    color: colors.muted,
    fontFamily: 'PlusJakartaSans_600SemiBold',
  },
  fv: {
    fontSize: 13,
    color: colors.text,
    fontFamily: 'PlusJakartaSans_700Bold',
    flexShrink: 1,
    textAlign: 'right',
  },
});
