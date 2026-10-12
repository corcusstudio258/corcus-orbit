/** @type {import('tailwindcss').Config} */
const v = (name) => `rgb(var(--c-${name}) / <alpha-value>)`;

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        canvas: v('canvas'),
        surface: v('surface'),
        sunken: v('sunken'),
        line: v('line'),
        ink: v('ink'),
        muted: v('muted'),
        faint: v('faint'),
        brand: { DEFAULT: v('brand'), ink: v('brand-ink'), soft: v('brand-soft') },
        night: { DEFAULT: v('night'), 2: v('night-2'), line: v('night-line') },
        cobalt: v('cobalt'),
        violet: v('violet'),
        leaf: v('leaf'),
        amber: v('amber'),
        ember: v('ember'),
        teal: v('teal'),
        // legacy aliases so older screens map onto the new palette
        space: { DEFAULT: v('canvas'), deep: v('sunken'), 2: v('surface'), 3: v('sunken') },
        star: v('ink'),
        mist: v('muted'),
        signal: v('cobalt'),
        nebula: v('violet'),
        mint: v('leaf'),
        flare: v('amber'),
        rose: v('ember'),
      },
      fontFamily: {
        display: ['"Bricolage Grotesque Variable"', 'Bricolage Grotesque', 'system-ui', 'sans-serif'],
        sans: ['"Figtree Variable"', 'Figtree', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        panel: '0 1px 0 rgb(var(--c-ink) / 0.03)',
        lift: '0 12px 32px -16px rgb(var(--c-ink) / 0.28)',
        pop: '0 24px 60px -20px rgb(var(--c-ink) / 0.35)',
        glow: '0 0 0 3px rgb(var(--c-brand) / 0.35)',
      },
      borderRadius: { xl2: '1.125rem' },
      keyframes: {
        'slide-in': { from: { transform: 'translateX(24px)', opacity: '0' }, to: { transform: 'none', opacity: '1' } },
        rise: { from: { transform: 'translateY(6px)', opacity: '0' }, to: { transform: 'none', opacity: '1' } },
      },
      animation: { 'slide-in': 'slide-in .22s cubic-bezier(.2,.8,.2,1)', rise: 'rise .25s ease-out both' },
    },
  },
  plugins: [],
};
