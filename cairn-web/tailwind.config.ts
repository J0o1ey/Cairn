import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{vue,ts,tsx,js,jsx}'],
  theme: {
    fontFamily: {
      sans: [
        '-apple-system',
        'BlinkMacSystemFont',
        'PingFang SC',
        'Hiragino Sans GB',
        'Microsoft YaHei',
        'Inter',
        'Segoe UI',
        'sans-serif',
      ],
    },
    extend: {
      colors: {
        // 主色：indigo 调（与原 Cairn 一致，避免大改）
        brand: {
          50: '#eef2ff',
          100: '#e0e7ff',
          200: '#c7d2fe',
          300: '#a5b4fc',
          400: '#818cf8',
          500: '#6366f1',
          600: '#4f46e5',
          700: '#4338ca',
          800: '#3730a3',
          900: '#312e81',
        },
        // 辅色：青绿调，用于品牌渐变与高亮点缀
        accent: {
          50: '#ecfeff',
          100: '#cffafe',
          200: '#a5f3fc',
          300: '#67e8f9',
          400: '#22d3ee',
          500: '#06b6d4',
          600: '#0891b2',
          700: '#0e7490',
          800: '#155e75',
          900: '#164e63',
        },
      },
      boxShadow: {
        card: '0 12px 32px -18px rgba(15,23,42,0.18)',
        'card-hover': '0 18px 40px -20px rgba(15,23,42,0.22)',
      },
      fontSize: {
        '2xs': ['10px', '14px'],
      },
    },
  },
  plugins: [],
} satisfies Config;
