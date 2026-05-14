import type { Config } from 'tailwindcss';

export default {
  content: ['./src/**/*.{ts,tsx,html}'],
  theme: {
    extend: {
      colors: {
        brand: {
          primary: '#1A73E8',
          'primary-light': '#E8F0FE',
          'primary-dark': '#1967D2',
        },
        status: {
          connected: '#34A853',
          disconnected: '#DC2626',
          warning: '#F9AB00',
          info: '#1A73E8',
        },
        pro: {
          'gradient-start': '#1A73E8',
          'gradient-end': '#7C3AED',
          locked: '#9CA3AF',
        },
        panel: '#FAFAFA',
        'card-border': '#E0E0E0',
        'log-bg': '#1E1E1E',
        'log-ts': '#8AB4F8',
        'log-tool': '#FDD663',
        'log-meta': '#81C995',
        'log-text': '#E8EAED',
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
        DEFAULT: '6px',
        md: '6px',
        lg: '10px',
      },
    },
  },
  plugins: [],
} satisfies Config;
