import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useData } from '../context/DataContext';
import { colors } from '../theme';
import HomeScreen from '../screens/HomeScreen';
import MapScreen from '../screens/MapScreen';
import ReportScreen from '../screens/ReportScreen';
import HelpScreen from '../screens/HelpScreen';
import AlertsScreen from '../screens/AlertsScreen';

const TABS = [
  { key: 'Home', icon: '🏠', Screen: HomeScreen },
  { key: 'Map', icon: '🗺️', Screen: MapScreen },
  { key: 'Report', icon: '📢', Screen: ReportScreen },
  { key: 'Help', icon: '🆘', Screen: HelpScreen },
  { key: 'Alerts', icon: '🚨', Screen: AlertsScreen },
];

// Lightweight bottom-tab navigator (no extra dependency). All screens stay
// mounted so form state survives tab switches.
export default function AppNavigator() {
  const [active, setActive] = useState('Home');
  const { alerts } = useData();

  return (
    <View style={styles.root}>
      <View style={{ flex: 1 }}>
        {TABS.map(({ key, Screen }) => (
          <View key={key} style={[StyleSheet.absoluteFill, active !== key && { display: 'none' }]}>
            <Screen navigate={setActive} />
          </View>
        ))}
      </View>
      <View style={styles.bar}>
        {TABS.map((t) => (
          <Pressable key={t.key} style={styles.tab} onPress={() => setActive(t.key)}>
            <View>
              <Text style={[styles.icon, active !== t.key && { opacity: 0.5 }]}>{t.icon}</Text>
              {t.key === 'Alerts' && alerts.length > 0 && <View style={styles.badge}><Text style={styles.badgeText}>{alerts.length}</Text></View>}
            </View>
            <Text style={[styles.label, active === t.key && styles.labelOn]}>{t.key}</Text>
            {active === t.key && <View style={styles.dot} />}
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  bar: { flexDirection: 'row', backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 8, paddingBottom: 22 },
  tab: { flex: 1, alignItems: 'center', gap: 2 },
  icon: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 22 },
  label: { fontSize: 12, fontFamily: 'PlusJakartaSans_600SemiBold', color: colors.muted },
  labelOn: { color: colors.primary, fontFamily: 'PlusJakartaSans_800ExtraBold' },
  dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.primary },
  badge: { position: 'absolute', top: -4, right: -10, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: colors.HIGH, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  badgeText: { color: '#fff', fontSize: 11, fontFamily: 'PlusJakartaSans_800ExtraBold' },
});
