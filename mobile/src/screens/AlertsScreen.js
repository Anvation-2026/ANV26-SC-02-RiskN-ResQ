import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Header from '../components/Header';
import AlertCard from '../components/AlertCard';
import ConnectionBanner from '../components/ConnectionBanner';
import { useData } from '../context/DataContext';
import { colors, radius, shadow } from '../theme';

export default function AlertsScreen({ navigate }) {
  const { alerts, blocked, loading } = useData();
  const road = blocked.length ? blocked.map((r) => r.name).join(', ') : null;

  return (
    <View style={{ flex: 1 }}>
      <Header title="Alerts" subtitle="Active warnings for your area" />
      <ScrollView contentContainerStyle={styles.body}>
        <ConnectionBanner />
        {loading ? (
          <Text style={styles.muted}>Loading alerts...</Text>
        ) : alerts.length ? (
          alerts.map((a) => <AlertCard key={a.id} alert={a} road={road} onViewRoute={() => navigate('Map')} />)
        ) : (
          <View style={styles.empty}>
            <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 44 }}>✅</Text>
            <Text style={styles.eTitle}>No active alerts</Text>
            <Text style={styles.muted}>Your area is currently clear. We'll notify you if flood risk rises.</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, paddingBottom: 32 },
  empty: { backgroundColor: colors.card, borderRadius: radius.card, padding: 30, alignItems: 'center', gap: 8, ...shadow },
  eTitle: { fontSize: 22, fontFamily: 'PlusJakartaSans_800ExtraBold', color: colors.text },
  muted: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 14, color: colors.muted, textAlign: 'center', lineHeight: 20 },
});
