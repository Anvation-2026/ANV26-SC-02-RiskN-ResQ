import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, topInset } from '../theme';

export default function Header({ title, subtitle, right, children }) {
  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{title}</Text>
          {subtitle ? <Text style={styles.sub}>{subtitle}</Text> : null}
        </View>
        {right}
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: colors.navy, paddingTop: topInset, paddingHorizontal: 20, paddingBottom: 22, borderBottomLeftRadius: 28, borderBottomRightRadius: 28 },
  row: { flexDirection: 'row', alignItems: 'center' },
  title: { color: '#fff', fontSize: 24, fontFamily: 'PlusJakartaSans_800ExtraBold' },
  sub: { color: '#B6C4DB', fontFamily: 'PlusJakartaSans_400Regular', fontSize: 14, marginTop: 2 },
});
