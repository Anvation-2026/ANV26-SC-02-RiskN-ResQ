import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'react-native';
import { symbols } from '../assets';
import Header from '../components/Header';
import AlertCard from '../components/AlertCard';
import ConnectionBanner from '../components/ConnectionBanner';
import SafetyGuide from '../components/SafetyGuide';
import { FadeIn, staggerDelay } from '../components/motion';
import { SkeletonCard } from '../components/ui';
import { useData } from '../context/DataContext';
import { colors, radius, shadow } from '../theme';
import Feather from '@expo/vector-icons/Feather';
import { timeAgo } from '../services/geo';

export default function AlertsScreen({ navigate }) {
  const insets = useSafeAreaInsets();
  const { alerts, reportNotices, blocked, loading, source, backendError } = useData();
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
          <SkeletonCard lines={3} />
        ) : alerts.length ? (
          alerts.map((a, i) => (
            <FadeIn key={a.id} delay={staggerDelay(i, 60, 300)}>
              <AlertCard alert={a} road={road} onViewRoute={() => navigate('Map', ['HIGH', 'CRITICAL'].includes(String(a.severity).toUpperCase()) ? { escape: Date.now() } : undefined)} />
            </FadeIn>
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
        {reportNotices && reportNotices.length > 0 ? (
          <View style={{ marginTop: 6 }}>
            <Text style={styles.section}>COMMUNITY REPORTS</Text>
            <Text style={styles.sectionNote}>Reports from people nearby. They support the environmental data but are not official alerts.</Text>
            {reportNotices.slice(0, 6).map((r, i) => (
              <FadeIn key={r.id} delay={staggerDelay(i, 50, 250)}>
                <View style={styles.report}>
                  <Feather name="alert-triangle" size={14} color={r.status === 'VERIFIED' ? colors.HIGH : '#D97706'} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.reportTitle}>{String(r.type || 'Incident').replace(/_/g, ' ')}{r.description ? ` · ${r.description}` : ''}</Text>
                    <Text style={styles.reportSub}>
                      {r.status === 'VERIFIED' ? 'Verified by an administrator' : 'Not yet verified'}
                      {r.trustScore != null ? ` · trust ${r.trustScore}/100` : ''} · {timeAgo(r.created_at)}
                    </Text>
                  </View>
                </View>
              </FadeIn>
            ))}
          </View>
        ) : null}
        <SafetyGuide />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { fontFamily: 'PlusJakartaSans_800ExtraBold', fontSize: 12, letterSpacing: 0.8, color: colors.muted, marginTop: 8 },
  sectionNote: { fontFamily: 'PlusJakartaSans_500Medium', fontSize: 12, color: colors.muted, marginTop: 2, marginBottom: 8, lineHeight: 17 },
  report: { flexDirection: 'row', gap: 10, backgroundColor: colors.card, borderRadius: 14, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: '#E2E8F0' },
  reportTitle: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13, color: colors.text },
  reportSub: { fontFamily: 'PlusJakartaSans_500Medium', fontSize: 12, color: colors.muted, marginTop: 2 },
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
