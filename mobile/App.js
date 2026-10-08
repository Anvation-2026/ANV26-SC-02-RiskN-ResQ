import React from 'react';
import { View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useFonts, PlusJakartaSans_400Regular, PlusJakartaSans_500Medium, PlusJakartaSans_600SemiBold, PlusJakartaSans_700Bold, PlusJakartaSans_800ExtraBold } from '@expo-google-fonts/plus-jakarta-sans';
import { DataProvider } from './src/context/DataContext';
import AppNavigator from './src/navigation/AppNavigator';

export default function App() {
  // Google Font: Plus Jakarta Sans. Render anyway if loading fails so the app never blocks.
  const [loaded, error] = useFonts({ PlusJakartaSans_400Regular, PlusJakartaSans_500Medium, PlusJakartaSans_600SemiBold, PlusJakartaSans_700Bold, PlusJakartaSans_800ExtraBold });
  if (!loaded && !error) return <View style={{ flex: 1, backgroundColor: '#0B1F3A' }} />;
  return (
    <DataProvider>
      <View style={{ flex: 1 }}>
        <StatusBar style="light" />
        <AppNavigator />
      </View>
    </DataProvider>
  );
}
