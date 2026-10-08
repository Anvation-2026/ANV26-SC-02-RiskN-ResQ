import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Feather from '@expo/vector-icons/Feather';
import { colors, fonts } from '../theme';

// Bottom-tab shell used by the admin app. All tabs stay mounted so forms keep their state.
export default function TabShell({ tabs, badges = {}, onTabChange }) {
  const [active, setActiveRaw] = useState(tabs[0].key);
  const [params, setParams] = useState({});
  const setActive = (k, p) => { setParams((cur) => ({ ...cur, [k]: p })); setActiveRaw(k); if (onTabChange) onTabChange(k); };
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ flex: 1 }}>
        {tabs.map(({ key, Screen }) => (
          <View key={key} style={[StyleSheet.absoluteFill, active !== key && { display: 'none' }]}>
            <Screen navigate={setActive} active={active === key} params={params[key]} />
          </View>
        ))}
      </View>
      <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 10) }]}>
        {tabs.map((t) => (
          <Pressable key={t.key} style={styles.tab} onPress={() => setActive(t.key)} hitSlop={6}>
            <View>
              <Feather name={t.icon} size={20} color={active === t.key ? colors.primary : '#94A3B8'} />
              {badges[t.key] > 0 && <View style={styles.badge}><Text style={styles.badgeText}>{badges[t.key] > 9 ? '9+' : badges[t.key]}</Text></View>}
            </View>
            <Text style={[styles.label, active === t.key && { color: colors.primary, fontFamily: fonts.bold }]}>{t.label}</Text>
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
  tab: { flex: 1, alignItems: 'center', gap: 3 },
  label: { fontFamily: fonts.medium, fontSize: 11, color: '#94A3B8' },
});
