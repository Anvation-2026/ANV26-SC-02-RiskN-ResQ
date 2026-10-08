import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Header from '../components/Header';
import RiskCard from '../components/RiskCard';
import ActionButton from '../components/ActionButton';
import ConnectionBanner from '../components/ConnectionBanner';
import DemoPanel from '../components/DemoPanel';
import { useData } from '../context/DataContext';
import { colors, radius, riskColor, shadow } from '../theme';
import { USER } from '../services/geo';

const TEXT = {
  LOW: ['✅ LOW FLOOD RISK', 'Conditions are normal. No significant flood risk detected in your area.'],
  MEDIUM: ['⚠️ MODERATE FLOOD RISK', 'Moderate rainfall detected. Stay informed and monitor updates.'],
  HIGH: ['🚨 HIGH FLOOD RISK', 'Heavy rainfall and multiple incident reports indicate elevated flood risk in your area.'],
  CRITICAL: ['🚨 CRITICAL FLOOD RISK', 'Heavy rainfall and multiple incident reports indicate severe flood risk in your area. Follow official guidance.'],
};

const Row = ({ label, value, color }) => (
  <View style={styles.row}>
    <Text style={styles.rl}>{label}</Text>
    <Text style={[styles.rv, color && { color }]}>{value}</Text>
  </View>
);

export default function HomeScreen({ navigate }) {
  const { risk, blocked, source } = useData();
  const [title, body] = risk ? TEXT[risk.level] || TEXT.LOW : ['', ''];

  return (
    <View style={{ flex: 1 }}>
      <Header
        title="RiskN ResQ"
        right={<View style={[styles.pill, { backgroundColor: source === 'live' ? '#16A34A' : '#F59E0B' }]}><Text style={styles.pillText}>{source === 'live' ? '● LIVE' : '● DEMO DATA'}</Text></View>}
      >
        <Text style={styles.locLabel}>📍 Current Location</Text>
        <Text style={styles.loc}>{USER.label}</Text>
      </Header>
      <ScrollView contentContainerStyle={styles.body}>
        <ConnectionBanner />
        <RiskCard risk={risk} />
        {risk && (
          <View style={[styles.status, { borderLeftColor: riskColor(risk.level) }]}>
            <Text style={[styles.statusTitle, { color: riskColor(risk.level) }]}>{title}</Text>
            <Text style={styles.statusBody}>{body}</Text>
          </View>
        )}
        <View style={styles.grid}>
          <ActionButton icon="🗺️" label="Live Map" onPress={() => navigate('Map')} />
          <ActionButton icon="🛣️" label="Alternative Route" onPress={() => navigate('Map')} />
          <ActionButton icon="📢" label="Report Incident" onPress={() => navigate('Report')} />
          <ActionButton icon="🆘" label="Request Help" onPress={() => navigate('Help')} />
        </View>
        <View style={styles.info}>
          <Row label="Affected Area" value={risk && risk.level !== 'LOW' ? risk.zone : 'None'} />
          <View style={styles.sep} />
          <Row label="Blocked Road" value={blocked.length ? blocked.map((r) => r.name).join(', ') : 'None reported'} color={blocked.length ? colors.HIGH : undefined} />
        </View>
        <DemoPanel />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, paddingBottom: 32, gap: 14 },
  pill: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  pillText: { color: '#fff', fontSize: 11, fontFamily: 'PlusJakartaSans_800ExtraBold' },
  locLabel: { color: '#B6C4DB', fontFamily: 'PlusJakartaSans_400Regular', fontSize: 13, marginTop: 14 },
  loc: { color: '#fff', fontSize: 20, fontFamily: 'PlusJakartaSans_700Bold' },
  status: { backgroundColor: colors.card, borderRadius: radius.card, borderLeftWidth: 8, padding: 16, ...shadow },
  statusTitle: { fontSize: 18, fontFamily: 'PlusJakartaSans_800ExtraBold', marginBottom: 4 },
  statusBody: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 15, lineHeight: 22, color: colors.text },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  info: { backgroundColor: colors.card, borderRadius: radius.card, padding: 16, ...shadow },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  rl: { fontSize: 14, color: colors.muted, fontFamily: 'PlusJakartaSans_600SemiBold' },
  rv: { fontSize: 17, fontFamily: 'PlusJakartaSans_800ExtraBold', color: colors.text, flexShrink: 1, textAlign: 'right' },
  sep: { height: 1, backgroundColor: colors.border, marginVertical: 12 },
});
