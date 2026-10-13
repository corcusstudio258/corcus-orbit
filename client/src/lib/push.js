// Browser notifications: service worker + Web Push subscription for this browser.
import api from './api';

export const pushSupported = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
export const isIosWithoutInstall = () => /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.matchMedia('(display-mode: standalone)').matches;
export const permission = () => (pushSupported() ? Notification.permission : 'unsupported');

const toKey = (b64) => {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
};

async function registration() {
  return navigator.serviceWorker.register('/sw.js', { scope: '/' }).then(() => navigator.serviceWorker.ready);
}

/** Current state for this browser: 'on' | 'off' | 'blocked' | 'unsupported'. */
export async function pushState() {
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  if (Notification.permission !== 'granted') return 'off';
  const reg = await navigator.serviceWorker.getRegistration('/');
  const sub = reg && await reg.pushManager.getSubscription();
  return sub ? 'on' : 'off';
}

/** Ask permission (must be called from a click) and register this browser. */
export async function enablePush() {
  if (!pushSupported()) throw new Error(isIosWithoutInstall() ? 'On iPhone, first add Orbit to your Home Screen (Share > Add to Home Screen), then turn this on there.' : "This browser doesn't support notifications.");
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error(perm === 'denied' ? 'Notifications are blocked. Allow them from the lock icon next to the address bar.' : 'Notifications were not allowed.');
  const reg = await registration();
  const { data } = await api.get('/push/key');
  let sub = await reg.pushManager.getSubscription();
  if (sub && sub.options?.applicationServerKey) {
    const cur = btoa(String.fromCharCode(...new Uint8Array(sub.options.applicationServerKey))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    if (cur !== data.publicKey) { await sub.unsubscribe(); sub = null; }
  }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKey(data.publicKey) });
  await api.post('/push/subscribe', { subscription: sub.toJSON() });
  return 'on';
}

export async function disablePush() {
  const reg = await navigator.serviceWorker.getRegistration('/');
  const sub = reg && await reg.pushManager.getSubscription();
  if (sub) { await api.post('/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {}); await sub.unsubscribe(); }
  return 'off';
}

/** On app start: if this browser already allowed notifications, make sure the server knows it (keys can rotate). */
export async function syncPush() {
  try {
    if (!pushSupported() || Notification.permission !== 'granted') return;
    const reg = await registration();
    const sub = await reg.pushManager.getSubscription();
    if (sub) await api.post('/push/subscribe', { subscription: sub.toJSON() });
  } catch { /* ignore */ }
}
