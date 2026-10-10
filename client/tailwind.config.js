/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        space: { DEFAULT: '#0E1433', deep: '#090D24', 2: '#141B42', 3: '#1B2453' },
        line: 'rgba(150,168,255,0.14)',
        star: '#E8ECFF',
        mist: '#8D96C4',
        signal: '#3DE0F2',
        nebula: '#8F7BFF',
        mint: '#5BE3A6',
        flare: '#FFB648',
        rose: '#FF7A90',
      },
      fontFamily: {
        display: ['Sora', 'system-ui', 'sans-serif'],
        sans: ['Manrope', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(61,224,242,.35), 0 0 24px -4px rgba(61,224,242,.45)',
        panel: '0 18px 40px -24px rgba(3,6,24,.9)',
      },
    },
  },
  plugins: [],
};
