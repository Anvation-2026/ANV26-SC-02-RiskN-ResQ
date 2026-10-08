import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Feather from '@expo/vector-icons/Feather';
import Header from '../components/Header';
import AlertCard from '../components/AlertCard';
import ConnectionBanner from '../components/ConnectionBanner';
import { useData } from '../context/DataContext';
import { colors, radius, shadow } from '../theme';

export default function AlertsScreen({ navigate }) {
  const insets = useSafeAreaInsets();
  const { alerts, blocked, loading } = useData();
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
        {loading ? (
          <Text style={styles.muted}>Loading telemetry alerts...</Text>
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
            <View style={styles.emptyIconBg}>
              <Feather name="shield" size={32} color={colors.LOW} />
            </View>
            <Text style={styles.eTitle}>No Active Alerts</Text>
            <Text style={styles.muted}>
              Your sector is currently clear. You will receive an immediate push alert if local flood risk escalates.
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
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
