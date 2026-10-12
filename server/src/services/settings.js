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

module.exports = { get, set, DEFAULTS };
