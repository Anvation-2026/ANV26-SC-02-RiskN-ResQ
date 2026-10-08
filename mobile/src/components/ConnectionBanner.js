import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { useData } from '../context/DataContext';

export default function ConnectionBanner() {
  const { source, loading } = useData();
  if (loading || source === 'live') return null;

  return (
    <View style={styles.box}>
      <Feather name="wifi-off" size={15} color="#B45309" style={{ marginRight: 8 }} />
      <View style={{ flex: 1 }}>
        <Text style={styles.t1}>Unable to connect to the server.</Text>
        <Text style={styles.t2}>Showing the last data received. Reports and requests cannot be sent until you are back online.</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF3C7',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#FCD34D',
  },
  t1: {
    fontSize: 12,
    fontFamily: 'PlusJakartaSans_700Bold',
    color: '#78350F',
  },
  t2: {
    fontFamily: 'PlusJakartaSans_500Medium',
    fontSize: 12,
    color: '#92400E',
    marginTop: 1,
  },
});
