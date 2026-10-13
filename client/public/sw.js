/* Orbit service worker: shows browser notifications pushed by the server. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: 'Orbit', body: event.data && event.data.text() }; }
  event.waitUntil((async () => {
    // If Orbit is open and in front, the in-app toast already shows it.
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (wins.some((w) => w.focused && w.visibilityState === 'visible') && data.tag !== 'orbit-test') return;
    await self.registration.showNotification(data.title || 'Orbit', {
      body: data.body || '', icon: '/orbit.svg', badge: '/orbit.svg',
      tag: data.tag, renotify: !!data.tag, data: { url: data.url || '/' },
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const win = wins.find((w) => w.url.startsWith(self.location.origin));
    if (win) { await win.focus(); if ('navigate' in win) return win.navigate(url); return undefined; }
    return self.clients.openWindow(url);
  })());
});
