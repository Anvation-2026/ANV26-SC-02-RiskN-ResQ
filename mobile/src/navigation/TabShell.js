import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Feather from '@expo/vector-icons/Feather';
import { ScreenFade, TabIcon } from '../components/motion';
import { colors, fonts, TAB_COLOR } from '../theme';
import AIAssistantModal from '../components/AIAssistantModal';
import AIAssistantFAB from '../components/AIAssistantFAB';

// Bottom-tab shell used by the admin and volunteer apps. All tabs stay mounted so forms keep their state.
export default function TabShell({ tabs, badges = {}, onTabChange }) {
  const [active, setActiveRaw] = useState(tabs[0].key);
  const [params, setParams] = useState({});
  const [aiVisible, setAiVisible] = useState(false);
  const setActive = (k, p) => {
    if (k === 'AI' || k === 'Assistant') {
      setAiVisible(true);
      return;
    }
    setParams((cur) => ({ ...cur, [k]: p }));
    setActiveRaw(k);
    if (onTabChange) onTabChange(k);
  };
  const insets = useSafeAreaInsets();
  const bottomPadding = Math.max(insets.bottom, 10);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ flex: 1 }}>
        {tabs.map(({ key, Screen }) => (
          <View key={key} style={[StyleSheet.absoluteFill, active !== key && { display: 'none' }]}>
            <ScreenFade active={active === key}><Screen navigate={setActive} active={active === key} params={params[key]} openAI={() => setAiVisible(true)} /></ScreenFade>
          </View>
        ))}
      </View>

      <AIAssistantFAB
        onPress={() => setAiVisible(true)}
        bottom={bottomPadding + 56}
      />

      <AIAssistantModal
        visible={aiVisible}
        onClose={() => setAiVisible(false)}
        onNavigate={setActive}
      />

      <View style={[styles.bar, { paddingBottom: bottomPadding }]}>
        {tabs.map((t) => (
          <Pressable key={t.key} style={styles.tab} onPress={() => setActive(t.key)} hitSlop={6} accessibilityRole="tab" accessibilityLabel={t.label} accessibilityState={{ selected: active === t.key }} aria-selected={active === t.key}>
            <TabIcon active={active === t.key} color={TAB_COLOR[t.key] || colors.primary} badge={badges[t.key] || 0} compact={tabs.length > 6}>
              <Feather name={t.icon} size={20} color={active === t.key ? (TAB_COLOR[t.key] || colors.primary) : '#94A3B8'} />
            </TabIcon>
            <Text style={[styles.label, active === t.key && { color: TAB_COLOR[t.key] || colors.primary, fontFamily: fonts.bold }]}>{t.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { position: 'absolute', top: -6, right: -10, minWidth: 16, height: 16, borderRadius: 8, backgroundColor: colors.HIGH, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  badgeText: { color: '#fff', fontSize: 10, fontFamily: fonts.extrabold },
  bar: { flexDirection: 'row', backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 8 },
  tab: { flex: 1, alignItems: 'center', gap: 2, minHeight: 48 },
  label: { fontFamily: fonts.medium, fontSize: 11, color: '#94A3B8' },
});
