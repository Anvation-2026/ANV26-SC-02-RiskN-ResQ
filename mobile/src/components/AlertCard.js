import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { colors, radius, riskColor, shadow } from '../theme';
import { timeAgo } from '../services/geo';
import ActionButton from './ActionButton';

const Field = ({ label, value }) => (
  <View style={styles.field}>
    <Text style={styles.fl}>{label}</Text>
    <Text style={styles.fv} numberOfLines={1}>{value}</Text>
  </View>
);

export default function AlertCard({ alert, road, onViewRoute }) {
  const c = riskColor(alert.severity);

  return (
    <View style={[styles.card, { borderLeftColor: c }]}>
      <View style={styles.headerRow}>
        <Feather name="alert-octagon" size={16} color={c} style={{ marginRight: 6 }} />
        <Text style={[styles.title, { color: c }]}>{alert.severity} FLOOD RISK</Text>
      </View>

      <Text style={styles.msg}>{alert.message}</Text>

      <View style={styles.fields}>
        <Field label="Affected Area" value={alert.zone} />
        <Field label="Corridor" value={road || 'None reported'} />
        <Field label="Telemetry" value={timeAgo(alert.createdAt)} />
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
