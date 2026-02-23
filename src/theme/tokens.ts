export const colors = {
  background: '#09090B',
  surface: '#18181B',
  surfaceLight: '#1C1C21',
  border: '#2A2A30',
  primary: '#7C5CFC',
  primaryLight: '#9B85FF',
  primaryDim: '#5A47D9',
  accent: '#FF6B6B',
  success: '#52C77C',
  warning: '#FFB74D',
  error: '#F05252',
  text: '#F5F5F5',
  textSecondary: '#A1A1A6',
  textMuted: '#6B6B72',
  white: '#FFFFFF',
  black: '#000000',
  overlay: 'rgba(0,0,0,0.6)',
  primaryPlaceholder: 'rgba(124, 92, 252, 0.45)',
  successBg: 'rgba(82, 199, 124, 0.08)',
  errorBg: 'rgba(240, 82, 82, 0.08)',
  borderSubtle: '#1F1F25',
  primaryMuted: 'rgba(124, 92, 252, 0.12)',
  primaryBorderSubtle: 'rgba(124, 92, 252, 0.2)',
};

export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const fontSize = {
  xs: 11,
  sm: 13,
  md: 15,
  lg: 18,
  xl: 22,
  xxl: 28,
  title: 34,
  hero: 42,
} as const;

export const fontWeight = {
  regular: '400' as const,
  medium: '500' as const,
  semibold: '600' as const,
  bold: '700' as const,
};

export const layout = {
  screenPaddingH: 20,
  cardGap: 12,
  cardPadding: 16,
  sectionGap: 32,
  inputHeight: 48,
  buttonHeight: 50,
  buttonHeightSm: 40,
  touchMin: 44,
} as const;

export const borderRadius = {
  sm: 6,
  md: 10,
  lg: 16,
  xl: 24,
  full: 9999,
} as const;
