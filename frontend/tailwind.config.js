/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{html,ts}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // ── Brand palette (use these names directly when possible) ──
        paper: '#FBF6E6',
        'paper-2': '#F5EDD0',
        saffron: {
          50: '#FFFCF3',
          100: '#FBF4D6',
          200: '#F6E796',
          300: '#F1DC5C',
          400: '#E8C547',
          500: '#C9A227',
        },
        ink: {
          100: '#EFF1F8',
          200: '#DDE2EE',
          300: '#BFC6DC',
          400: '#8A95B5',
          500: '#5A6A95',
          600: '#3C4A75',
          700: '#1F2B52',
          800: '#14213D',
          900: '#0F1A36',
        },
        teal: {
          300: '#8BD2DF',
          500: '#3CAEC7',
          600: '#2A8FA8',
          700: '#1F6E83',
        },
        henna: { 500: '#C25E3F' },
        sage:  { 500: '#7BA088' },
        gold:  { 500: '#B8923A' },

        // ── M3 token aliases — kept so existing components inherit the
        //    new palette automatically (every bg-surface / text-on-surface
        //    in the app rewires through these). ───────────────────────
        surface: {
          DEFAULT: '#FBF6E6',           // paper
          dim:     '#F5EDD0',           // paper-2
          bright:  '#FFFFFF',
          container: {
            DEFAULT: '#FFFFFF',          // card / panel
            low:     '#FBF4D6',          // saffron-100 tinted card
            high:    '#F5EDD0',          // paper-2 elevated
            highest: '#F1DC5C',          // saffron-300 attention
            lowest:  '#FFFFFF',
          },
          variant: '#DDE2EE',            // ink-200
          tint:    '#3CAEC7',            // teal-500
        },
        primary: {
          DEFAULT: '#3CAEC7',            // teal-500
          container: '#1F6E83',          // teal-700
          fixed: { DEFAULT: '#8BD2DF', dim: '#3CAEC7' },
        },
        'on-primary': {
          DEFAULT: '#FFFFFF',
          container: '#FFFFFF',
          fixed: { DEFAULT: '#0F1A36', variant: '#14213D' },
        },
        secondary: {
          DEFAULT: '#F1DC5C',            // saffron-300
          container: '#FBF4D6',          // saffron-100
          fixed: { DEFAULT: '#F1DC5C', dim: '#E8C547' },
        },
        'on-secondary': {
          DEFAULT: '#14213D',
          container: '#1F2B52',
          fixed: { DEFAULT: '#0F1A36', variant: '#14213D' },
        },
        tertiary: {
          DEFAULT: '#C25E3F',            // henna
          container: '#FBE3D6',
          fixed: { DEFAULT: '#C25E3F', dim: '#913E22' },
        },
        'on-tertiary': {
          DEFAULT: '#FFFFFF',
          container: '#5A2A18',
          fixed: { DEFAULT: '#5A2A18', variant: '#913E22' },
        },
        error: {
          DEFAULT: '#C25E3F',            // henna doubles as danger
          container: '#F5D5C7',
        },
        'on-error': {
          DEFAULT: '#FFFFFF',
          container: '#5A2A18',
        },
        'on-surface': {
          DEFAULT: '#14213D',            // ink-800
          variant: '#5A6A95',            // ink-500
        },
        'on-background': '#14213D',
        outline: {
          DEFAULT: '#BFC6DC',            // ink-300
          variant: '#DDE2EE',            // ink-200
        },
        inverse: {
          surface:    '#14213D',
          'on-surface': '#FBF4D6',
          primary:    '#3CAEC7',
        },
        background: '#FBF6E6',           // paper
      },
      fontFamily: {
        // Brand fonts
        display: ['Archivo', 'system-ui', 'sans-serif'],
        headline: ['Archivo', 'system-ui', 'sans-serif'],
        body:     ['Plus Jakarta Sans', 'system-ui', 'sans-serif'],
        label:    ['Plus Jakarta Sans', 'system-ui', 'sans-serif'],
        mono:     ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        DEFAULT: '0.375rem',
        lg:  '0.625rem',                 // 10px (brand --r-md)
        xl:  '1rem',                     // 16px (brand --r-lg)
        '2xl': '1.375rem',               // 22px (brand --r-xl)
      },
      boxShadow: {
        // Brand soft + card shadows (replaces blue glow)
        soft: '0 1px 0 rgba(20,33,61,0.04), 0 6px 18px -10px rgba(20,33,61,0.18)',
        card: '0 1px 0 rgba(20,33,61,0.05), 0 14px 40px -20px rgba(20,33,61,0.30)',
        glow: '0 1px 0 rgba(20,33,61,0.04), 0 6px 18px -10px rgba(20,33,61,0.18)',
        'glow-sm': '0 1px 0 rgba(20,33,61,0.04), 0 4px 12px -6px rgba(20,33,61,0.15)',
        ambient: '0 14px 40px -20px rgba(20,33,61,0.30)',
      },
      backgroundImage: {
        'gradient-primary': 'linear-gradient(135deg, #14213D 0%, #1F2B52 100%)',
        'gradient-cta':     'linear-gradient(135deg, #3CAEC7 0%, #1F6E83 100%)',
        'gradient-saffron': 'linear-gradient(135deg, #F1DC5C 0%, #E8C547 100%)',
      },
    },
  },
  plugins: [],
};
