import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'react-native';
import { symbols } from '../assets';
import Header from '../components/Header';
import AlertCard from '../components/AlertCard';
import ConnectionBanner from '../components/ConnectionBanner';
import { useData } from '../context/DataContext';
import { colors, radius, shadow } from '../theme';

export default function AlertsScreen({ navigate }) {
  const insets = useSafeAreaInsets();
  const { alerts, blocked, loading, source, backendError } = useData();
  const urgentCount = alerts.filter((a) => a.severity === 'HIGH' || a.severity === 'CRITICAL').length;
  const road = blocked.length ? blocked.map((r) => r.name).join(', ') : null;

  return (
    <View style={styles.root}>
      <Header title="Alerts" subtitle="Active Municipal Warnings & Hazard Notices" />
      <ScrollView
        contentContainerStyle={[
          styles.body,
          { paddingBottom: Math.max(insets.bottom, 16) + 85 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <ConnectionBanner />
        {!loading && alerts.length > 0 ? (
          <Text style={[styles.summary, urgentCount > 0 && { color: colors.HIGH }]}>
            {alerts.length} active alert{alerts.length > 1 ? 's' : ''}
            {urgentCount > 0 ? ` · ${urgentCount} high or critical` : ''}
          </Text>
        ) : null}
        {loading ? (
          <Text style={styles.muted}>Loading alerts...</Text>
        ) : alerts.length ? (
          alerts.map((a) => (
            <AlertCard
              key={a.id}
              alert={a}
              road={road}
              onViewRoute={() => navigate('Map')}
            />
          ))
        ) : (
          <View style={styles.empty}>
            <Image source={symbols.bell} style={styles.emptySymbol} />
            <Text style={styles.eTitle}>No Active Alerts</Text>
            <Text style={styles.muted}>
              No active alerts for your area right now. New alerts appear here automatically when flood risk rises.
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  summary: { fontFamily: 'PlusJakartaSans_800ExtraBold', fontSize: 13, color: colors.muted, marginBottom: 10 },
  emptySymbol: { width: 64, height: 64, borderRadius: 16, marginBottom: 10 },
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  body: {
    padding: 14,
  },
  empty: {
    backgroundColor: colors.card,
    borderRadius: radius.card,
    padding: 24,
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginTop: 10,
    ...shadow,
  },
  emptyIconBg: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#DCFCE7',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  eTitle: {
    fontSize: 18,
    fontFamily: 'PlusJakartaSans_800ExtraBold',
    color: colors.text,
  },
  muted: {
    fontFamily: 'PlusJakartaSans_500Medium',
    fontSize: 13,
    color: colors.muted,
    textAlign: 'center',
    lineHeight: 18,
  },
});
