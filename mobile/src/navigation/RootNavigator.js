// Auth gate. The role shown here always comes from the backend (login / GET /auth/me), never from the client.
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { DataProvider } from '../context/DataContext';
import { ResponseProvider } from '../context/ResponseContext';
import { colors, palette } from '../theme';
import LaunchScreen from '../components/Launch';
import { FadeIn } from '../components/motion';
import LoginScreen from '../screens/auth/LoginScreen';
import RegisterScreen from '../screens/auth/RegisterScreen';
import ForgotPasswordScreen from '../screens/auth/ForgotPasswordScreen';
import AppNavigator from './AppNavigator';
import AdminNavigator from './AdminNavigator';
import VolunteerNavigator from './VolunteerNavigator';

export default function RootNavigator() {
  const { status, user } = useAuth();
  const [mode, setMode] = useState('login');
  const [message, setMessage] = useState('');
  useEffect(() => { if (status === 'in') setMode('login'); }, [status]); // after logout, always land on Login

  if (status === 'loading') {
    return <LaunchScreen />;
  }
  if (status === 'out') {
    // each auth screen eases in (sliding from the side it came from) so switching between them feels continuous
    const wrap = (key, node, from) => <View style={{ flex: 1, backgroundColor: palette.ink }}><View pointerEvents="none" style={{ position: 'absolute', top: -90, right: -70, width: 280, height: 280, borderRadius: 140, backgroundColor: 'rgba(34,211,238,0.10)' }} /><View pointerEvents="none" style={{ position: 'absolute', bottom: -120, left: -90, width: 300, height: 300, borderRadius: 150, backgroundColor: 'rgba(21,101,255,0.12)' }} /><FadeIn key={key} from={from} distance={18} duration={260} style={{ flex: 1 }}>{node}</FadeIn></View>;
    if (mode === 'forgot') return wrap('forgot', <ForgotPasswordScreen goLogin={(msg) => { setMessage(msg || ''); setMode('login'); }} />, 'left');
    return mode === 'login'
      ? wrap('login', <LoginScreen goRegister={() => setMode('register')} goForgot={() => { setMessage(''); setMode('forgot'); }} message={message} />, 'down')
      : wrap('register', <RegisterScreen goLogin={() => setMode('login')} />, 'left');
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
