// constants/Theme.ts

export const Theme = {
  colors: {
    primary: '#2C7A4B',
    primaryDark: '#1F5A38',
    secondary: '#84B59F',
    accent: '#059669',
    lightBg: '#F0F7F3',
    card: '#FAFCFB',
    white: '#FFFFFF',
    text: '#1F2937',
    textMuted: '#6B7280',
    textLight: '#9CA3AF',
    // 补全 index.tsx 中用到的颜色
    danger: '#B85042',  
    warning: '#D97706',
    info: '#3B82F6',    
    bg: '#0a1a0f',      // 对应你 root style 的背景色
    codeBg: '#0F1813',
    codeText: '#E5F1E8',
    divider: '#E5E7EB',
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 20,
    xxl: 24,
  },
};

export type ThemeType = typeof Theme;
