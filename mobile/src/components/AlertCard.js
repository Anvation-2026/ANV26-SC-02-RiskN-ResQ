import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, radius, riskColor, shadow } from '../theme';
import { timeAgo } from '../services/geo';
import ActionButton from './ActionButton';

const Field = ({ label, value }) => (
  <View style={styles.field}>
    <Text style={styles.fl}>{label}</Text>
    <Text style={styles.fv}>{value}</Text>
  </View>
);

export default function AlertCard({ alert, road, onViewRoute }) {
  const c = riskColor(alert.severity);
  return (
    <View style={[styles.card, { borderLeftColor: c }]}>
      <Text style={[styles.title, { color: c }]}>🚨 {alert.severity} FLOOD RISK</Text>
      <Text style={styles.msg}>{alert.message}</Text>
      <View style={styles.fields}>
        <Field label="Affected Area" value={alert.zone} />
        <Field label="Affected Road" value={road || 'None reported'} />
        <Field label="Updated" value={timeAgo(alert.createdAt)} />
      </View>
      {onViewRoute ? <ActionButton variant="primary" label="VIEW ALTERNATIVE ROUTE" color={c} onPress={onViewRoute} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: radius.card, borderLeftWidth: 8, padding: 18, marginBottom: 14, ...shadow },
  title: { fontSize: 19, fontFamily: 'PlusJakartaSans_800ExtraBold', marginBottom: 8 },
  msg: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 15, lineHeight: 22, color: colors.text, marginBottom: 14 },
  fields: { backgroundColor: colors.bg, borderRadius: 14, padding: 12, marginBottom: 16, gap: 10 },
  field: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  fl: { fontSize: 13, color: colors.muted, fontFamily: 'PlusJakartaSans_600SemiBold' },
  fv: { fontSize: 15, color: colors.text, fontFamily: 'PlusJakartaSans_700Bold', flexShrink: 1, textAlign: 'right' },
});
