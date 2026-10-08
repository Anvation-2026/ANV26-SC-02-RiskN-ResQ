// Auth gate. The role shown here always comes from the backend (login / GET /auth/me), never from the client.
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { DataProvider } from '../context/DataContext';
import { ResponseProvider } from '../context/ResponseContext';
import { colors } from '../theme';
import LoginScreen from '../screens/auth/LoginScreen';
import RegisterScreen from '../screens/auth/RegisterScreen';
import AppNavigator from './AppNavigator';
import AdminNavigator from './AdminNavigator';
import VolunteerNavigator from './VolunteerNavigator';

export default function RootNavigator() {
  const { status, user } = useAuth();
  const [mode, setMode] = useState('login');
  useEffect(() => { if (status === 'in') setMode('login'); }, [status]); // after logout, always land on Login

  if (status === 'loading') {
    return <View style={{ flex: 1, backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color="#fff" /></View>;
  }
  if (status === 'out') {
    return mode === 'login' ? <LoginScreen goRegister={() => setMode('register')} /> : <RegisterScreen goLogin={() => setMode('login')} />;
  }
  if (user.role === 'volunteer') return <VolunteerNavigator />; // dedicated volunteer portal: no user or admin screens

  // user and admin both read risk/alerts/roads; the data providers poll only for signed-in sessions.
  return (
    <DataProvider>
      <ResponseProvider>
        {user.role === 'admin' ? <AdminNavigator /> : <AppNavigator />}
      </ResponseProvider>
    </DataProvider>
  );
}
