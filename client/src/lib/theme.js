import { useEffect, useState } from 'react';

const KEY = 'orbit_theme';
const EVT = 'orbit:theme';
const read = () => { try { return localStorage.getItem(KEY) || 'light'; } catch { return 'light'; } };

function apply(theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  try { localStorage.setItem(KEY, theme); } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent(EVT, { detail: theme }));
}

/** [theme, toggle, set] — every component using it stays in sync. */
export function useTheme() {
  const [theme, setTheme] = useState(read);
  useEffect(() => {
    const h = (e) => setTheme(e.detail);
    window.addEventListener(EVT, h);
    return () => window.removeEventListener(EVT, h);
  }, []);
  const set = (t) => apply(t);
  return [theme, () => set(theme === 'dark' ? 'light' : 'dark'), set];
}
