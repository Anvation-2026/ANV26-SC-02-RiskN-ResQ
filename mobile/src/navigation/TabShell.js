import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Feather from '@expo/vector-icons/Feather';
import { colors, fonts } from '../theme';

// Bottom-tab shell used by the admin app. All tabs stay mounted so forms keep their state.
export default function TabShell({ tabs }) {
  const [active, setActive] = useState(tabs[0].key);
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ flex: 1 }}>
        {tabs.map(({ key, Screen }) => (
          <View key={key} style={[StyleSheet.absoluteFill, active !== key && { display: 'none' }]}>
            <Screen navigate={setActive} />
          </View>
        ))}
      </View>
      <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 10) }]}>
        {tabs.map((t) => (
          <Pressable key={t.key} style={styles.tab} onPress={() => setActive(t.key)} hitSlop={6}>
            <Feather name={t.icon} size={20} color={active === t.key ? colors.primary : '#94A3B8'} />
            <Text style={[styles.label, active === t.key && { color: colors.primary, fontFamily: fonts.bold }]}>{t.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 8 },
  tab: { flex: 1, alignItems: 'center', gap: 3 },
  label: { fontFamily: fonts.medium, fontSize: 11, color: '#94A3B8' },
});
