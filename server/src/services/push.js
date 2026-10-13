// Browser (Web Push) notifications. VAPID keys are made once and kept in Settings,
// or come from VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY.
const webpush = require('web-push');
const { Setting, PushSubscription } = require('../models');

const KEY = 'push:vapid';
let cached = null;

async function vapid() {
  if (cached) return cached;
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    cached = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  } else {
    let row = await Setting.findOne({ where: { key: KEY } });
    if (!row) row = await Setting.create({ key: KEY, value: webpush.generateVAPIDKeys() });
    cached = row.value;
  }
  const subject = process.env.VAPID_SUBJECT || (process.env.APP_URL?.startsWith('https://') ? process.env.APP_URL : 'mailto:hello@corcus.in');
  webpush.setVapidDetails(subject, cached.publicKey, cached.privateKey);
  return cached;
}

async function publicKey() { return (await vapid()).publicKey; }

async function subscribe(userId, sub, userAgent = '') {
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) { const e = new Error('That browser subscription is incomplete.'); e.status = 400; throw e; }
  const endpoint = String(sub.endpoint).slice(0, 700);
  const [row] = await PushSubscription.findOrCreate({ where: { endpoint }, defaults: { userId, keys: sub.keys, userAgent: String(userAgent).slice(0, 250) } });
  if (row.userId !== userId || JSON.stringify(row.keys) !== JSON.stringify(sub.keys)) await row.update({ userId, keys: sub.keys, userAgent: String(userAgent).slice(0, 250) });
  return row;
}

async function unsubscribe(userId, endpoint) {
  await PushSubscription.destroy({ where: { userId, endpoint: String(endpoint || '').slice(0, 700) } });
}

/** Send to every browser the user turned on. Dead subscriptions are removed. Returns how many were delivered. */
async function sendToUser(userId, { title, body = '', link = '/', tag }) {
  const subs = await PushSubscription.findAll({ where: { userId } });
  if (!subs.length) return 0;
  await vapid();
  const payload = JSON.stringify({ title, body, url: link || '/', tag: tag || undefined });
  let sent = 0;
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, payload, { TTL: 6 * 3600, urgency: 'high' });
      sent += 1; s.update({ lastUsedAt: new Date() }).catch(() => {});
    } catch (e) {
      if ([404, 410].includes(e.statusCode)) await s.destroy().catch(() => {});
      else console.warn('[push]', e.statusCode || '', e.body || e.message);
    }
  }));
  return sent;
}

module.exports = { publicKey, subscribe, unsubscribe, sendToUser };
