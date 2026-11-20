/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'], display: ['"Barlow Condensed"', 'Inter', 'sans-serif'] },
      colors: {
        charcoal: { 950: '#14171a', 900: '#1b1f23', 800: '#252a30', 700: '#323941' },
        slate2: { 50: '#f6f7f8', 100: '#eceef0', 200: '#dde0e4', 300: '#c3c8ce', 400: '#9aa1aa', 500: '#6f7782', 600: '#535b65', 700: '#3d444c' },
        brand: { 50: '#fff4ec', 100: '#ffe4cf', 400: '#f7944d', 500: '#ee7a26', 600: '#d9650f', 700: '#b4510c' },
      },
      boxShadow: { card: '0 1px 2px rgba(20,23,26,.06), 0 1px 1px rgba(20,23,26,.04)' },
    },
  },
  plugins: [],
}
