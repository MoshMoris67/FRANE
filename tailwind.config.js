/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    // Squarer, more architectural corners across the whole product (pills/avatars still use rounded-full)
    borderRadius: { none: '0', sm: '2px', DEFAULT: '3px', md: '3px', lg: '4px', xl: '6px', '2xl': '8px', full: '9999px' },
    extend: {
      fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'], display: ['"Barlow Condensed"', 'Inter', 'sans-serif'] },
      colors: {
        // warm concrete neutrals
        charcoal: { 950: '#101213', 900: '#181a1c', 800: '#212427', 700: '#2c3033', 600: '#3a3f43' },
        slate2: { 50: '#f6f5f2', 100: '#edebe6', 200: '#dedbd3', 300: '#c4c0b6', 400: '#9d988d', 500: '#756f64', 600: '#57534b', 700: '#3e3b36' },
        // muted brand orange — an accent, not a background
        brand: { 50: '#faf3ec', 100: '#f3e1cf', 400: '#dc9355', 500: '#c8651f', 600: '#ae561a', 700: '#8c4414' },
        ok: { 500: '#3f8a63', 600: '#2f7250' },
        bad: { 500: '#c2452d', 600: '#a53720' },
      },
      boxShadow: { card: 'none', pop: '0 12px 32px -8px rgba(16,18,19,.28)' },
    },
  },
  plugins: [],
}
