import { Platform, StatusBar } from 'react-native';

export const colors = {
  navy: '#0B1F3A',
  navy2: '#13305A',
  bg: '#F3F5F9',
  card: '#FFFFFF',
  text: '#0F172A',
  muted: '#64748B',
  border: '#E2E8F0',
  primary: '#1A73E8',
  route: '#1A73E8',
  LOW: '#16A34A',
  MEDIUM: '#F59E0B',
  HIGH: '#DC2626',
  CRITICAL: '#7F1D1D',
};

export const riskColor = (level) => colors[level] || colors.LOW;

export const radius = { card: 20, button: 14, pill: 999 };
export const shadow = { boxShadow: '0 4px 14px rgba(15,23,42,0.08)' };

export const topInset = Platform.select({
  ios: 56,
  android: (StatusBar.currentHeight || 24) + 8,
  default: 20,
});

export const type = {
  h1: { fontSize: 24, fontFamily: 'PlusJakartaSans_800ExtraBold', color: colors.text },
  h2: { fontSize: 18, fontFamily: 'PlusJakartaSans_700Bold', color: colors.text },
  body: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 15, lineHeight: 22, color: colors.text },
  muted: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 13, color: colors.muted },
  label: { fontSize: 12, fontFamily: 'PlusJakartaSans_700Bold', letterSpacing: 0.8, color: colors.muted },
};
