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

// Design tokens. Emergency colours are deliberately few: green = fine/available, amber = watch, orange = high, red = danger.
export const palette = {
  ink: '#0B1220',          // near-black surfaces (hero areas)
  navy: '#0B1F33',
  accent: '#22D3EE',       // electric cyan: highlights and focus on dark surfaces only
  primary: '#1565FF',      // actions
  surface: '#FFFFFF',
  surfaceAlt: '#F1F5F9',
  line: '#E2E8F0',
  glass: 'rgba(255,255,255,0.10)',
  glassBorder: 'rgba(255,255,255,0.18)',
};

// Risk colours. `riskColor` is the bright tone (pills, map, borders); `riskSurface` is a deeper tone of the same hue that keeps
// white text above WCAG AA-large contrast on filled cards. HIGH (orange) and CRITICAL (red) are distinct, as on the map legend.
export const RISK = {
  LOW: { bright: '#16A34A', surface: '#15803D', soft: '#DCFCE7', label: 'LOW' },
  MEDIUM: { bright: '#EAB308', surface: '#A16207', soft: '#FEF9C3', label: 'MEDIUM' },
  HIGH: { bright: '#F97316', surface: '#C2410C', soft: '#FFEDD5', label: 'HIGH' },
  CRITICAL: { bright: '#DC2626', surface: '#B91C1C', soft: '#FEE2E2', label: 'CRITICAL' },
};
const norm = (l) => (l === 'MODERATE' ? 'MEDIUM' : l);
export const riskColor = (level) => (RISK[norm(level)] || RISK.LOW).bright;
export const riskSurface = (level) => (RISK[norm(level)] || RISK.LOW).surface;
export const riskSoft = (level) => (RISK[norm(level)] || RISK.LOW).soft;
export const riskIndex = (level) => ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].indexOf(norm(level));

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

// Plus Jakarta Sans weights (loaded in App.js via @expo-google-fonts)
export const fonts = {
  regular: 'PlusJakartaSans_400Regular',
  medium: 'PlusJakartaSans_500Medium',
  semibold: 'PlusJakartaSans_600SemiBold',
  bold: 'PlusJakartaSans_700Bold',
  extrabold: 'PlusJakartaSans_800ExtraBold',
};

export const type = {
  h1: { fontSize: 24, fontFamily: fonts.extrabold, letterSpacing: -0.3, color: colors.text },
  h2: { fontSize: 18, fontFamily: fonts.bold, color: colors.text },
  body: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 22, color: colors.text },
  muted: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted },
  label: { fontSize: 12, fontFamily: fonts.bold, letterSpacing: 0.8, color: colors.muted },
};
