import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useData } from '../context/DataContext';

export default function ConnectionBanner() {
  const { source, loading } = useData();
  if (loading || source === 'live') return null;
  return (
    <View style={styles.box}>
      <Text style={styles.icon}>⚠️</Text>
      <View style={{ flex: 1 }}>
        <Text style={styles.t1}>Unable to connect to live data.</Text>
        <Text style={styles.t2}>Showing latest available information.</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FEF3C7', borderRadius: 14, padding: 12, marginBottom: 14, borderWidth: 1, borderColor: '#FCD34D' },
  icon: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 18, marginRight: 10 },
  t1: { fontSize: 14, fontFamily: 'PlusJakartaSans_700Bold', color: '#78350F' },
  t2: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 13, color: '#92400E' },
});
