import React from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Card, Label } from './ui';
import { useT } from '../i18n';
import { colors, fonts } from '../theme';

// Built into the app (no network needed), so the advice and the emergency numbers still open when the connection drops.
const CONTACTS = ['112', '108', '101', '100'];

export default function SafetyGuide() {
  const t = useT();
  return (
    <View style={{ marginTop: 6 }}>
      <Card>
        <Label>{t('alerts.safety').toUpperCase()}</Label>
        {[1, 2, 3, 4, 5].map((n) => (
          <View key={n} style={s.row}><Text style={s.num}>{n}</Text><Text style={s.tip}>{t(`safety.${n}`)}</Text></View>
        ))}
      </Card>
      <Card>
        <Label>{t('alerts.contacts').toUpperCase()}</Label>
        <View style={s.contacts}>
          {CONTACTS.map((n) => (
            <Pressable key={n} onPress={() => Linking.openURL(`tel:${n}`).catch(() => {})} accessibilityRole="button" accessibilityLabel={`${t(`contact.${n}`)} ${n}`} style={s.contact}>
              <Text style={s.number}>{n}</Text>
              <Text style={s.cname}>{t(`contact.${n}`)}</Text>
            </Pressable>
          ))}
        </View>
      </Card>
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', gap: 10, marginTop: 8 },
  num: { fontFamily: fonts.extrabold, fontSize: 13, color: colors.primary, width: 16 },
  tip: { flex: 1, fontFamily: fonts.medium, fontSize: 14, color: colors.text, lineHeight: 20 },
  contacts: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  contact: { minWidth: '45%', flexGrow: 1, backgroundColor: '#FEF2F2', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#FECACA' },
  number: { fontFamily: fonts.extrabold, fontSize: 22, color: colors.HIGH },
  cname: { fontFamily: fonts.semibold, fontSize: 12, color: colors.text, marginTop: 2 },
});
