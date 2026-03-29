import type { Config } from 'tailwindcss';

export default {
  content: ['./src/**/*.{ts,tsx,html}'],
  theme: {
    extend: {
      colors: {
        brand: {
          primary: '#2563EB',
          'primary-light': '#DBEAFE',
          'primary-dark': '#1D4ED8',
        },
        status: {
          connected: '#16A34A',
          disconnected: '#DC2626',
          warning: '#D97706',
          info: '#2563EB',
        },
        pro: {
          'gradient-start': '#2563EB',
          'gradient-end': '#7C3AED',
          locked: '#9CA3AF',
        },
      },
      fontSize: {
        xs: ['11px', { lineHeight: '1.35' }],
        sm: ['12px', { lineHeight: '1.35' }],
        base: ['14px', { lineHeight: '1.5' }],
        lg: ['16px', { lineHeight: '1.25' }],
        xl: ['18px', { lineHeight: '1.25' }],
      },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
      },
      spacing: {
        '1': '4px',
        '2': '8px',
        '3': '12px',
        '4': '16px',
        '6': '24px',
        '8': '32px',
      },
      borderRadius: {
        DEFAULT: '4px',
        md: '4px',
      },
    },
  },
  plugins: [],
} satisfies Config;
