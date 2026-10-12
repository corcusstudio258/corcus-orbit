const { Setting } = require('../models');

const DEFAULTS = {
  company: {
    name: 'Corcus Studio',
    tagline: 'Team workspace',
    accent: '#3DE0F2',
    workStart: '10:00',
    timezone: 'Asia/Kolkata',
  },
  ai: {
    enabled: true,
    provider: 'gemini',
    apiKey: process.env.GEMINI_API_KEY || '',
    model: process.env.GEMINI_MODEL || 'gemini-3.8-flash',
    features: { brief: true, assistant: true, reports: true },
  },
  whatsapp: {
    enabled: false,
    provider: process.env.WA_PROVIDER || 'log', // log | meta | custom
    defaultCountryCode: '91',
    meta: {
      token: process.env.WA_META_TOKEN || '',
      phoneNumberId: process.env.WA_META_PHONE_ID || '',
      apiVersion: 'v21.0',
      mode: 'template', // template | text
      templateName: 'task_update',
      templateLang: 'en',
    },
    corcus: {
      // chat.corcus.in (com.bot white-label). Paste the values from the panel's API settings.
      baseUrl: 'https://chat.corcus.in',
      path: '/api/v1/whatsapp/send',
      token: '',
      phoneNumberId: '',
      bodyTemplate: '{"phone_number_id":"{{phoneNumberId}}","phone":"{{phone}}","message":"{{message}}"}',
    },
    custom: {
      url: '',
      method: 'POST',
      headers: '{"Content-Type":"application/json"}',
      bodyTemplate: '{"phone":"{{phone}}","message":"{{message}}"}',
    },
    events: {
      assigned: true, status: true, comment: true, due: true, overdue: true,
      approval: true, client_update: true, client_request: true, meeting: true, chat: false,
    },
  },
  email: {
    enabled: false,
    host: process.env.SMTP_HOST || '',
    port: Number(process.env.SMTP_PORT || 465),
    secure: true,
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || '',
  },
  firebase: {
    enabled: false,
    apiKey: process.env.FIREBASE_API_KEY || '',
    projectId: process.env.FIREBASE_PROJECT_ID || '',
  },
  zoom: {
    enabled: false,
    accountId: process.env.ZOOM_ACCOUNT_ID || '',
    clientId: process.env.ZOOM_CLIENT_ID || '',
    clientSecret: process.env.ZOOM_CLIENT_SECRET || '',
    defaultDuration: 30,
  },
  onboarding: {
    allowSignup: true,
    autoApprove: false,
    welcome: 'Tell us about your business so we can set up your workspace.',
    questions: [
      { id: 'business_name', label: 'Business name', type: 'text', required: true, maps: 'name' },
      { id: 'category', label: 'Business category', type: 'text', required: true, maps: 'industry' },
      { id: 'mobile', label: 'Business mobile number', type: 'tel', required: true, maps: 'phone' },
      { id: 'whatsapp', label: 'Business WhatsApp number', type: 'tel', required: true, maps: 'whatsapp' },
      { id: 'email', label: 'Business email', type: 'email', required: true, maps: 'email' },
      { id: 'location', label: 'Business location (Google Maps link)', type: 'text', required: false },
      { id: 'address', label: 'Address', type: 'textarea', required: false, maps: 'city' },
      { id: 'hours', label: 'Working hours', type: 'text', required: false },
      { id: 'facebook', label: 'Facebook page', type: 'choice', options: ['Exists', 'Does not exist'], required: true },
      { id: 'facebook_link', label: 'Facebook page link', type: 'url', required: false, showIf: { id: 'facebook', is: 'Exists' } },
      { id: 'instagram', label: 'Instagram profile', type: 'choice', options: ['Exists', 'Does not exist'], required: true },
      { id: 'instagram_id', label: 'Instagram username', type: 'text', required: false, showIf: { id: 'instagram', is: 'Exists' } },
      { id: 'instagram_password', label: 'Instagram password', type: 'secret', required: false, showIf: { id: 'instagram', is: 'Exists' }, hint: 'Stored encrypted. Only admins can view it. Adding us as a partner in Meta Business Suite is safer.' },
      { id: 'youtube', label: 'YouTube channel', type: 'choice', options: ['Exists', 'Does not exist'], required: true },
      { id: 'linkedin', label: 'LinkedIn page', type: 'choice', options: ['Exists', 'Does not exist'], required: true },
    ],
  },
};

const cache = new Map();

function merge(base, extra) {
  if (Array.isArray(base) || typeof base !== 'object' || base === null) return extra ?? base;
  const out = { ...base };
  for (const k of Object.keys(extra || {})) {
    out[k] = typeof base[k] === 'object' && base[k] !== null && !Array.isArray(base[k])
      ? merge(base[k], extra[k]) : extra[k];
  }
  return out;
}

async function get(key) {
  if (cache.has(key)) return cache.get(key);
  const row = await Setting.findOne({ where: { key } });
  const value = merge(DEFAULTS[key] || {}, row?.value || {});
  cache.set(key, value);
  return value;
}

async function set(key, value) {
  const current = await get(key);
  const next = merge(current, value);
  const [row] = await Setting.findOrCreate({ where: { key }, defaults: { value: next } });
  row.value = next;
  await row.save();
  cache.set(key, next);
  return next;
}

async function reload(key) { cache.delete(key); return get(key); }

module.exports = { get, set, reload, DEFAULTS };
