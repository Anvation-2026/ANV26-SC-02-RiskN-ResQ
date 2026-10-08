import React from 'react';
import { View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  useFonts,
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
} from '@expo-google-fonts/plus-jakarta-sans';
import { DataProvider } from './src/context/DataContext';
import { ResponseProvider } from './src/context/ResponseContext';
import AppNavigator from './src/navigation/AppNavigator';

export default function App() {
  const [loaded, error] = useFonts({
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
    PlusJakartaSans_800ExtraBold,
  });

  if (!loaded && !error) {
    return <View style={{ flex: 1, backgroundColor: '#0B1F33' }} />;
  }

  return (
    <SafeAreaProvider>
      <DataProvider>
        <ResponseProvider>
          <View style={{ flex: 1, backgroundColor: '#0B1F33' }}>
            <StatusBar style="light" />
            <AppNavigator />
          </View>
        </ResponseProvider>
      </DataProvider>
    </SafeAreaProvider>
  );
}
