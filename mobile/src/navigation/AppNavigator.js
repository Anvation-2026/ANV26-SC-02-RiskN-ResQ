import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Feather from '@expo/vector-icons/Feather';
import { useData } from '../context/DataContext';
import { useT } from '../i18n';
import { ScreenFade, TabIcon } from '../components/motion';
import { colors, TAB_COLOR } from '../theme';
import HomeScreen from '../screens/HomeScreen';
import MapScreen from '../screens/MapScreen';
import ReportScreen from '../screens/ReportScreen';
import HelpScreen from '../screens/HelpScreen';
import AlertsScreen from '../screens/AlertsScreen';
import AccountScreen from '../screens/AccountScreen';
import LiveAssistanceScreen from '../screens/LiveAssistanceScreen';
import AIAssistantModal from '../components/AIAssistantModal';
import AIAssistantFAB from '../components/AIAssistantFAB';

const TABS = [
  { key: 'Home', label: 'Home', icon: 'home', Screen: HomeScreen },
  { key: 'Map', label: 'Map', icon: 'map', Screen: MapScreen },
  { key: 'Report', label: 'Report', icon: 'alert-triangle', Screen: ReportScreen },
  { key: 'Help', label: 'Help', icon: 'life-buoy', Screen: HelpScreen },
  { key: 'Alerts', label: 'Alerts', icon: 'bell', Screen: AlertsScreen },
  { key: 'Account', label: 'Account', icon: 'user', Screen: AccountScreen },
];

export default function AppNavigator() {
  const [active, setActiveRaw] = useState('Home');
  const [params, setParams] = useState({});
  const [aiVisible, setAiVisible] = useState(false);
  const [aiQuestion, setAiQuestion] = useState(null); // a question tapped elsewhere (Home chips), asked as soon as the chat opens
  const openAI = (q) => { setAiQuestion(typeof q === 'string' ? q : null); setAiVisible(true); };
  const insets = useSafeAreaInsets();
  const { alerts } = useData();
  const t18 = useT();

  const navigate = (k, p) => {
    if (k === 'AI' || k === 'Assistant') {
      setAiVisible(true);
      return;
    }
    if (p) setParams((cur) => ({ ...cur, [k]: p }));
    setActiveRaw(k);
  };

  const isTracking = active === 'Tracking' || active === 'LiveAssistance';
  const bottomPadding = Math.max(insets.bottom, 10);

  return (
    <View style={styles.root}>
      <View style={styles.screenContainer}>
        {TABS.map(({ key, Screen }) => (
          <View key={key} style={[StyleSheet.absoluteFill, (active !== key || isTracking) && styles.hiddenScreen]}>
            <ScreenFade active={active === key && !isTracking}>
              <Screen navigate={navigate} params={params[key]} openAI={openAI} />
            </ScreenFade>
          </View>
        ))}
        {isTracking && (
          <View style={StyleSheet.absoluteFill}>
            <LiveAssistanceScreen
              navigate={navigate}
              params={params['Tracking'] || params['LiveAssistance']}
              onBack={() => navigate('Home')}
            />
          </View>
        )}
      </View>

      {!isTracking && (
        <AIAssistantFAB
          onPress={() => setAiVisible(true)}
          bottom={bottomPadding + 56}
        />
      )}

      <AIAssistantModal
        visible={aiVisible}
        initialQuestion={aiQuestion}
        onInitialQuestionSent={() => setAiQuestion(null)}
        onClose={() => setAiVisible(false)}
        onNavigate={navigate}
      />

      <View style={[styles.bar, { paddingBottom: bottomPadding }, isTracking && styles.hiddenScreen]}>
        {TABS.map((t) => {
          const isActive = active === t.key;
          const activeColor = TAB_COLOR[t.key] || colors.primary;
          const inactiveColor = '#94A3B8';

          return (
            <Pressable
              key={t.key}
              style={styles.tab}
              onPress={() => navigate(t.key)}
              hitSlop={6}
              accessibilityRole="tab"
              accessibilityLabel={t18(`tab.${t.key}`)}
              accessibilityState={{ selected: isActive }}
              aria-selected={isActive}
            >
              <TabIcon active={isActive} color={activeColor} badge={t.key === 'Alerts' ? alerts.length : 0}>
                <Feather name={t.icon} size={20} color={isActive ? activeColor : inactiveColor} />
              </TabIcon>
              <Text
                style={[
                  styles.label,
                  isActive ? [styles.labelOn, { color: activeColor }] : styles.labelOff,
                ]}
              >
                {t18(`tab.${t.key}`)}
              </Text>
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
    fontSize: 12,
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
