import { Platform, StatusBar } from 'react-native';

export const colors = {
  navy: '#0B1F33',
  navy2: '#132E4A',
  bg: '#F8FAFC',
  card: '#FFFFFF',
  text: '#0F172A',
  muted: '#64748B',
  border: '#E2E8F0',
  primary: '#1565FF',
  route: '#1565FF',
  LOW: '#16A34A',
  MEDIUM: '#F59E0B',
  MODERATE: '#F59E0B',
  HIGH: '#DC2626',
  CRITICAL: '#DC2626',
};

export const riskColor = (level) => colors[level] || colors.LOW;

export const radius = { card: 18, button: 14, pill: 999 };
export const shadow = {
  shadowColor: '#0F172A',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.06,
  shadowRadius: 8,
  elevation: 2,
};

export const topInset = Platform.select({
  ios: 48,
  android: (StatusBar.currentHeight || 24) + 6,
  default: 20,
});

export const type = {
  h1: { fontSize: 24, fontFamily: 'PlusJakartaSans_800ExtraBold', color: colors.text },
  h2: { fontSize: 18, fontFamily: 'PlusJakartaSans_700Bold', color: colors.text },
  body: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 15, lineHeight: 22, color: colors.text },
  muted: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 13, color: colors.muted },
  label: { fontSize: 12, fontFamily: 'PlusJakartaSans_700Bold', letterSpacing: 0.8, color: colors.muted },
};
