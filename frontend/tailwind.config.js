/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{html,ts}'],
  // dark mode is driven by `<html data-theme="dark">` (set by ThemeService)
  darkMode: ['variant', '[data-theme="dark"] &'],
  theme: {
    extend: {
      colors: {
        // ── PRIMARY · INDIGO (the only saturated brand color) ──
        indigo: {
          50:  '#EEF0FF',
          100: '#DDE1FF',
          200: '#BEC4FF',
          300: '#9099FF',
          400: '#6E73F5',
          500: '#5B5BE8',
          600: '#4A47D6',
          700: '#3B36B0',
          800: '#2A267A',
          900: '#1A1846',
        },
        // ── NEUTRAL · SLATE ──────────────────────────────────────
        slate: {
          50:  '#F8FAFC',
          100: '#F1F5F9',
          200: '#E2E8F0',
          300: '#CBD5E1',
          400: '#94A3B8',
          500: '#64748B',
          600: '#475569',
          700: '#334155',
          800: '#1E293B',
          900: '#0F172A',
          950: '#050816',
        },
        // Saffron kept only for the logo tile / brand moments
        saffron: {
          50:  '#FFFCF3',
          100: '#FBF4D6',
          200: '#F6E796',
          300: '#F1DC5C',
          400: '#E8C547',
          500: '#C9A227',
        },

        // ── Legacy aliases — remapped so existing `bg-ink-*` /
        //    `text-teal-*` / `bg-paper` utilities adopt the new
        //    indigo+slate system without per-file edits. ──────────
        ink: {
          100: '#F1F5F9',
          200: '#E2E8F0',
          300: '#CBD5E1',
          400: '#94A3B8',
          500: '#64748B',
          600: '#475569',
          700: '#334155',
          800: '#0F172A',
          900: '#050816',
        },
        teal: {
          300: '#9099FF',
          500: '#5B5BE8',
          600: '#4A47D6',
          700: '#3B36B0',
        },
        henna: { 500: '#EF4444' },
        sage:  { 500: '#10B981' },
        gold:  { 500: '#F59E0B' },
        paper:     'var(--bg)',
        'paper-2': 'var(--bg-subtle)',

        // ── M3 semantic tokens — CSS variables so they flip with
        //    `data-theme`. Everything that uses `bg-surface`,
        //    `text-on-surface`, `border-outline*` adapts to the
        //    active mode automatically. ───────────────────────────
        surface: {
          DEFAULT:   'var(--bg)',
          dim:       'var(--bg-subtle)',
          bright:    'var(--bg-elevated)',
          container: {
            DEFAULT: 'var(--bg-elevated)',
            low:     'var(--bg-subtle)',
            high:    'var(--bg-subtle)',
            highest: 'var(--accent-soft)',
            lowest:  'var(--bg-elevated)',
          },
          variant: 'var(--border)',
          tint:    'var(--accent)',
        },
        primary: {
          DEFAULT:   'var(--accent)',
          container: 'var(--accent-soft)',
          fixed: { DEFAULT: '#5B5BE8', dim: '#4A47D6' },
        },
        'on-primary': {
          DEFAULT:   '#FFFFFF',
          container: 'var(--accent)',
          fixed: { DEFAULT: '#FFFFFF', variant: '#EEF0FF' },
        },
        secondary: {
          DEFAULT:   'var(--accent)',
          container: 'var(--accent-soft)',
          fixed: { DEFAULT: '#5B5BE8', dim: '#4A47D6' },
        },
        'on-secondary': {
          DEFAULT:   '#FFFFFF',
          container: 'var(--accent)',
          fixed: { DEFAULT: '#FFFFFF', variant: '#EEF0FF' },
        },
        tertiary: {
          DEFAULT:   '#F59E0B',
          container: '#FFFBEB',
          fixed: { DEFAULT: '#F59E0B', dim: '#B45309' },
        },
        'on-tertiary': {
          DEFAULT:   '#FFFFFF',
          container: '#78350F',
          fixed: { DEFAULT: '#78350F', variant: '#92400E' },
        },
        error: {
          DEFAULT:   '#EF4444',
          container: '#FEF2F2',
        },
        'on-error': {
          DEFAULT:   '#FFFFFF',
          container: '#7F1D1D',
        },
        'on-surface': {
          DEFAULT:  'var(--text)',
          variant:  'var(--text-muted)',
        },
        'on-background': 'var(--text)',
        outline: {
          DEFAULT: 'var(--border-strong)',
          variant: 'var(--border)',
        },
        inverse: {
          surface:       'var(--slate-900)',
          'on-surface':  '#F1F5F9',
          primary:       '#5B5BE8',
        },
        background: 'var(--bg)',
      },
      fontFamily: {
        // One typeface, everywhere: Inter
        display:  ['Inter', 'system-ui', 'sans-serif'],
        headline: ['Inter', 'system-ui', 'sans-serif'],
        body:     ['Inter', 'system-ui', 'sans-serif'],
        label:    ['Inter', 'system-ui', 'sans-serif'],
        sans:     ['Inter', 'system-ui', 'sans-serif'],
        mono:     ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        DEFAULT: '6px',
        sm:  '6px',
        md:  '8px',
        lg:  '12px',
        xl:  '16px',
        '2xl': '20px',
      },
      boxShadow: {
        soft: 'var(--shadow-soft)',
        card: 'var(--shadow-card)',
        glow: 'var(--shadow-soft)',
        'glow-sm': 'var(--shadow-soft)',
        ambient: 'var(--shadow-card)',
      },
      backgroundImage: {
        'gradient-primary': 'linear-gradient(135deg, #5B5BE8 0%, #3B36B0 100%)',
        'gradient-cta':     'linear-gradient(135deg, #5B5BE8 0%, #4A47D6 100%)',
        'gradient-saffron': 'linear-gradient(135deg, #F1DC5C 0%, #E8C547 100%)',
      },
    },
  },
  plugins: [],
};
