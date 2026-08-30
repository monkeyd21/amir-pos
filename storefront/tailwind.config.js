/**
 * Storefront design tokens.
 *
 * Deliberately NOT the ERP's palette: `frontend/tailwind.config.js` is a dark
 * navy admin theme for staff at a till. This is a shopfront for parents buying
 * clothes for their children, and it follows the conventional Indian D2C
 * register the reference site uses — square corners, warm neutrals, one strong
 * accent. See docs/ecommerce/design/.
 */
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#1c1a19',
        body: '#4a423b',
        muted: '#8c8279',
        line: '#ece6df',
        rule: '#ddd4ca',
        sand: '#faf6f2',
        shell: '#f4ece5',
        brand: { DEFAULT: '#7c2d4a', dark: '#63213a' },
        gold: '#b98c3f',
        ok: '#1f7a5c',
      },
      fontFamily: {
        display: ['var(--font-display)', 'Georgia', 'serif'],
        sans: ['var(--font-body)', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        // The reference theme sets --buttons-radius: 0. Square is the register.
        DEFAULT: '0px',
        none: '0px',
      },
      maxWidth: { shell: '1280px' },
    },
  },
  plugins: [],
};
