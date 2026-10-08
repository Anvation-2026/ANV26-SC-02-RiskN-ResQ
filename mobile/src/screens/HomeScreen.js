import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Feather from '@expo/vector-icons/Feather';
import Header from '../components/Header';
import RiskCard from '../components/RiskCard';
import AlertCard from '../components/AlertCard';
import ActionButton from '../components/ActionButton';
import ConnectionBanner from '../components/ConnectionBanner';
import { useData } from '../context/DataContext';
import { colors, radius, riskColor, shadow } from '../theme';
import { USER } from '../services/geo';

const TEXT = {
  LOW: ['LOW FLOOD RISK', 'Conditions are normal. No active flood risk reported.'],
  MEDIUM: ['MODERATE FLOOD RISK', 'Moderate rainfall detected. Monitor local alerts.'],
  HIGH: ['HIGH FLOOD RISK', 'Elevated runoff and waterlogging reported along corridors.'],
  CRITICAL: ['CRITICAL FLOOD RISK', 'Heavy rainfall and multiple incident reports indicate severe flood risk.'],
};

const Row = ({ label, value, color }) => (
  <View style={styles.row}>
    <Text style={styles.rl}>{label}</Text>
    <Text style={[styles.rv, color && { color }]} numberOfLines={1}>{value}</Text>
  </View>
);

export default function HomeScreen({ navigate }) {
  const insets = useSafeAreaInsets();
  const { risk, alerts, blocked, source } = useData();
  const [title, body] = risk ? TEXT[risk.level] || TEXT.LOW : ['', ''];
  const topAlert = alerts && alerts.length > 0 ? alerts[0] : null;

  return (
    <View style={styles.container}>
      <Header
        title="RiskNResQ"
        subtitle="Disaster Early Warning Network"
        right={
          <View style={[styles.pill, { backgroundColor: source === 'live' ? '#16A34A' : '#F59E0B' }]}>
            <Text style={styles.pillText}>{source === 'live' ? '● LIVE' : '● DEMO'}</Text>
          </View>
        }
      >
        <View style={styles.locationRow}>
          <Feather name="map-pin" size={13} color="#38BDF8" style={{ marginRight: 5 }} />
          <Text style={styles.locLabel}>Current Location:</Text>
          <Text style={styles.loc}>{USER.label}</Text>
        </View>
      </Header>

      <ScrollView
        contentContainerStyle={[styles.body, { paddingBottom: Math.max(insets.bottom, 16) + 85 }]}
        showsVerticalScrollIndicator={false}
      >
        <ConnectionBanner />
        <RiskCard risk={risk} />

        {topAlert ? (
          <AlertCard
            alert={topAlert}
            road={blocked.length ? blocked.map((r) => r.name).join(', ') : undefined}
            onViewRoute={() => navigate('Map')}
          />
        ) : risk && risk.level !== 'LOW' ? (
          <View style={[styles.status, { borderLeftColor: riskColor(risk.level) }]}>
            <View style={styles.statusHeader}>
              <Feather
                name={risk.level === 'CRITICAL' || risk.level === 'HIGH' ? 'alert-octagon' : 'alert-circle'}
                size={16}
                color={riskColor(risk.level)}
                style={{ marginRight: 6 }}
              />
              <Text style={[styles.statusTitle, { color: riskColor(risk.level) }]}>{title}</Text>
            </View>
            <Text style={styles.statusBody}>{body}</Text>
          </View>
        ) : null}

        <View style={styles.gridContainer}>
          <View style={styles.gridRow}>
            <ActionButton
              iconName="map"
              label="Live Map"
              color={colors.primary}
              onPress={() => navigate('Map')}
            />
            <ActionButton
              iconName="navigation"
              label="Alternative Route"
              color="#0284C7"
              onPress={() => navigate('Map')}
            />
          </View>
          <View style={styles.gridRow}>
            <ActionButton
              iconName="alert-triangle"
              label="Report Incident"
              color="#D97706"
              onPress={() => navigate('Report')}
            />
            <ActionButton
              iconName="life-buoy"
              label="Request Help"
              color="#DC2626"
              onPress={() => navigate('Help')}
            />
          </View>
        </View>

        <View style={styles.info}>
          <Row label="Affected Area" value={risk && risk.level !== 'LOW' ? risk.zone : 'None'} />
          <View style={styles.sep} />
          <Row
            label="Blocked Road"
            value={blocked.length ? blocked.map((r) => r.name).join(', ') : 'None reported'}
            color={blocked.length ? colors.HIGH : undefined}
          />
        </View>

      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  locLabel: {
    color: '#94A3B8',
    fontFamily: 'PlusJakartaSans_500Medium',
    fontSize: 12,
    marginRight: 4,
  },
  loc: {
    color: '#F8FAFC',
    fontSize: 13,
    fontFamily: 'PlusJakartaSans_700Bold',
  },
  body: {
    padding: 14,
    gap: 12,
  },
  pill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  pillText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontFamily: 'PlusJakartaSans_800ExtraBold',
    letterSpacing: 0.5,
  },
  status: {
    backgroundColor: colors.card,
    borderRadius: radius.card,
    borderLeftWidth: 5,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    ...shadow,
  },
  statusHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  statusTitle: {
    fontSize: 14,
    fontFamily: 'PlusJakartaSans_800ExtraBold',
    letterSpacing: 0.4,
  },
  statusBody: {
    fontFamily: 'PlusJakartaSans_500Medium',
    fontSize: 13,
    lineHeight: 18,
    color: colors.text,
  },
  gridContainer: {
    gap: 10,
  },
  gridRow: {
    flexDirection: 'row',
    gap: 10,
  },
  info: {
    backgroundColor: colors.card,
    borderRadius: radius.card,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    ...shadow,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  rl: {
    fontSize: 13,
    color: colors.muted,
    fontFamily: 'PlusJakartaSans_600SemiBold',
  },
  rv: {
    fontSize: 14,
    fontFamily: 'PlusJakartaSans_800ExtraBold',
    color: colors.text,
    flexShrink: 1,
    textAlign: 'right',
  },
  sep: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: 10,
  },
});
