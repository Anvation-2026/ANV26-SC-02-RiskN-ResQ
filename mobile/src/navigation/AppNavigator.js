import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Feather from '@expo/vector-icons/Feather';
import { useData } from '../context/DataContext';
import { colors } from '../theme';
import HomeScreen from '../screens/HomeScreen';
import MapScreen from '../screens/MapScreen';
import ReportScreen from '../screens/ReportScreen';
import HelpScreen from '../screens/HelpScreen';
import AlertsScreen from '../screens/AlertsScreen';

const TABS = [
  { key: 'Home', label: 'Home', icon: 'home', Screen: HomeScreen },
  { key: 'Map', label: 'Map', icon: 'map', Screen: MapScreen },
  { key: 'Report', label: 'Report', icon: 'alert-triangle', Screen: ReportScreen },
  { key: 'Help', label: 'Help', icon: 'life-buoy', Screen: HelpScreen },
  { key: 'Alerts', label: 'Alerts', icon: 'bell', Screen: AlertsScreen },
];

export default function AppNavigator() {
  const [active, setActive] = useState('Home');
  const insets = useSafeAreaInsets();
  const { alerts } = useData();

  const bottomPadding = Math.max(insets.bottom, 10);

  return (
    <View style={styles.root}>
      <View style={styles.screenContainer}>
        {TABS.map(({ key, Screen }) => (
          <View key={key} style={[StyleSheet.absoluteFill, active !== key && styles.hiddenScreen]}>
            <Screen navigate={setActive} />
          </View>
        ))}
      </View>

      <View style={[styles.bar, { paddingBottom: bottomPadding }]}>
        {TABS.map((t) => {
          const isActive = active === t.key;
          const activeColor = colors.primary;
          const inactiveColor = '#94A3B8';

          return (
            <Pressable
              key={t.key}
              style={styles.tab}
              onPress={() => setActive(t.key)}
              hitSlop={6}
            >
              <View style={styles.iconContainer}>
                <Feather
                  name={t.icon}
                  size={20}
                  color={isActive ? activeColor : inactiveColor}
                />
                {t.key === 'Alerts' && alerts.length > 0 && (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>
                      {alerts.length > 9 ? '9+' : alerts.length}
                    </Text>
                  </View>
                )}
              </View>
              <Text
                style={[
                  styles.label,
                  isActive ? styles.labelOn : styles.labelOff,
                ]}
              >
                {t.label}
              </Text>
              {isActive && <View style={styles.activeDot} />}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  screenContainer: {
    flex: 1,
  },
  hiddenScreen: {
    display: 'none',
  },
  bar: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    paddingTop: 8,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 8,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 2,
  },
  iconContainer: {
    position: 'relative',
    width: 28,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontSize: 11,
    marginTop: 2,
  },
  labelOff: {
    color: '#64748B',
    fontFamily: 'PlusJakartaSans_600SemiBold',
  },
  labelOn: {
    color: colors.primary,
    fontFamily: 'PlusJakartaSans_800ExtraBold',
  },
  activeDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.primary,
    marginTop: 2,
  },
  badge: {
    position: 'absolute',
    top: -3,
    right: -6,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.HIGH,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontFamily: 'PlusJakartaSans_800ExtraBold',
    lineHeight: 11,
  },
});
