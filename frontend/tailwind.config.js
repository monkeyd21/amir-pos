/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{html,ts}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: '#0b1326',
          dim: '#0b1326',
          bright: '#31394d',
          container: {
            DEFAULT: '#171f33',
            low: '#131b2e',
            high: '#222a3d',
            highest: '#2d3449',
            lowest: '#060e20',
          },
          variant: '#2d3449',
          tint: '#bbc3ff',
        },
        primary: {
          DEFAULT: '#bbc3ff',
          container: '#465fff',
          fixed: { DEFAULT: '#dfe0ff', dim: '#bbc3ff' },
        },
        'on-primary': {
          DEFAULT: '#001b96',
          container: '#f9f7ff',
          fixed: { DEFAULT: '#000d5f', variant: '#0029d2' },
        },
        secondary: {
          DEFAULT: '#bbc3ff',
          container: '#384389',
          fixed: { DEFAULT: '#dfe0ff', dim: '#bbc3ff' },
        },
        'on-secondary': {
          DEFAULT: '#1e296e',
          container: '#a9b3ff',
          fixed: { DEFAULT: '#03105a', variant: '#364186' },
        },
        tertiary: {
          DEFAULT: '#ffb695',
          container: '#c14d00',
          fixed: { DEFAULT: '#ffdbcc', dim: '#ffb695' },
        },
        'on-tertiary': {
          DEFAULT: '#571f00',
          container: '#fff6f3',
          fixed: { DEFAULT: '#351000', variant: '#7b2f00' },
        },
        error: {
          DEFAULT: '#ffb4ab',
          container: '#93000a',
        },
        'on-error': {
          DEFAULT: '#690005',
          container: '#ffdad6',
        },
        'on-surface': {
          DEFAULT: '#dae2fd',
          variant: '#c5c5d8',
        },
        'on-background': '#dae2fd',
        outline: {
          DEFAULT: '#8f8fa2',
          variant: '#444656',
        },
        inverse: {
          surface: '#dae2fd',
          'on-surface': '#283044',
          primary: '#2e48eb',
        },
        background: '#0b1326',
      },
      fontFamily: {
        headline: ['Manrope', 'sans-serif'],
        body: ['Inter', 'sans-serif'],
        label: ['Inter', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      borderRadius: {
        DEFAULT: '0.375rem',
        lg: '0.5rem',
        xl: '0.75rem',
        '2xl': '1rem',
      },
      boxShadow: {
        glow: '0 0 40px rgba(70, 95, 255, 0.15)',
        'glow-sm': '0 0 20px rgba(70, 95, 255, 0.1)',
        ambient: '0 8px 40px rgba(0, 0, 0, 0.3)',
      },
      backgroundImage: {
        'gradient-primary': 'linear-gradient(135deg, #465fff 0%, #bbc3ff 100%)',
        'gradient-cta': 'linear-gradient(135deg, #465fff 0%, #384389 100%)',
      },
    },
  },
  plugins: [],
};
