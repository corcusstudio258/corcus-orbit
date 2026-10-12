/**
 * WhatsApp sender with three providers:
 *  - log    : nothing is sent, messages are written to the WhatsApp log (safe default / testing)
 *  - meta   : official WhatsApp Cloud API (graph.facebook.com). Use "template" mode for
 *             business-initiated messages; "text" only works inside a 24h customer-service window.
 *  - custom : any HTTP API (e.g. your own WhatsApp panel / BSP). URL, headers and body are templates
 *             where {{phone}} and {{message}} are replaced.
 */
const settings = require('./settings');
const { WhatsAppLog } = require('../models');

function normalizePhone(raw, cc = '91') {
  if (!raw) return null;
  let d = String(raw).replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  if (d.length === 10) d = cc + d;
  return d.length >= 11 ? d : null;
}

const jsonEscape = (s) => JSON.stringify(String(s)).slice(1, -1);

async function sendMeta(cfg, phone, message) {
  const { token, phoneNumberId, apiVersion, mode, templateName, templateLang } = cfg.meta;
  if (!token || !phoneNumberId) throw new Error('Meta token or phone number ID is missing');
  const url = `https://graph.facebook.com/${apiVersion || 'v21.0'}/${phoneNumberId}/messages`;
  const body = mode === 'text'
    ? { messaging_product: 'whatsapp', to: phone, type: 'text', text: { body: message, preview_url: true } }
    : {
      messaging_product: 'whatsapp', to: phone, type: 'template',
      template: {
        name: templateName, language: { code: templateLang || 'en' },
        // Template variables can't contain new lines or tabs, so flatten the message.
        components: [{ type: 'body', parameters: [{ type: 'text', text: message.replace(/\s*\n+\s*/g, ' | ').slice(0, 1000) }] }],
      },
    };
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error?.message || `Meta API returned ${r.status}`);
  return data;
}

async function sendCustom(cfg, phone, message) {
  const { url, method, headers, bodyTemplate } = cfg.custom;
  if (!url) throw new Error('Custom API URL is missing');
  const fill = (t) => String(t || '').replaceAll('{{phone}}', phone).replaceAll('{{message}}', jsonEscape(message));
  let parsedHeaders = {};
  try { parsedHeaders = JSON.parse(headers || '{}'); } catch { throw new Error('Custom headers must be valid JSON'); }
  const finalUrl = url.replaceAll('{{phone}}', phone).replaceAll('{{message}}', encodeURIComponent(message));
  const opts = { method: method || 'POST', headers: parsedHeaders };
  if ((method || 'POST') !== 'GET') opts.body = fill(bodyTemplate);
  const r = await fetch(finalUrl, opts);
  const text = await r.text();
  if (!r.ok) throw new Error(`Custom API returned ${r.status}: ${text.slice(0, 200)}`);
  return text;
}

async function sendCorcus(cfg, phone, message) {
  const c = cfg.corcus || {};
  if (!c.token) throw new Error('chat.corcus.in API token is missing');
  const url = `${String(c.baseUrl || 'https://chat.corcus.in').replace(/\/$/, '')}${c.path?.startsWith('/') ? c.path : `/${c.path || ''}`}`;
  const body = String(c.bodyTemplate || '{"phone":"{{phone}}","message":"{{message}}"}')
    .replaceAll('{{phone}}', phone).replaceAll('{{message}}', jsonEscape(message)).replaceAll('{{phoneNumberId}}', jsonEscape(c.phoneNumberId || ''));
  const r = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${c.token}`, 'Content-Type': 'application/json', Accept: 'application/json' }, body });
  const text = await r.text();
  if (!r.ok) throw new Error(`chat.corcus.in returned ${r.status}: ${text.slice(0, 200)}`);
  return text;
}

/** Send one message. Never throws — returns 'sent' | 'failed' | 'skipped' | 'logged'. */
async function send(rawPhone, message, { force = false } = {}) {
  const cfg = await settings.get('whatsapp');
  const phone = normalizePhone(rawPhone, cfg.defaultCountryCode);
  if (!phone) return 'skipped';
  if (!cfg.enabled && !force) return 'skipped';
  const provider = cfg.provider || 'log';
  try {
    if (provider === 'meta') await sendMeta(cfg, phone, message);
    else if (provider === 'custom') await sendCustom(cfg, phone, message);
    else if (provider === 'corcus') await sendCorcus(cfg, phone, message);
    await WhatsAppLog.create({ to: phone, message, status: provider === 'log' ? 'logged' : 'sent', provider });
    return provider === 'log' ? 'logged' : 'sent';
  } catch (e) {
    await WhatsAppLog.create({ to: phone, message, status: 'failed', provider, error: e.message });
    return 'failed';
  }
}

module.exports = { send, normalizePhone };
