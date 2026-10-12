// Zoom Server-to-Server OAuth: create, update and delete meetings.
const settings = require('./settings');

const OAUTH = () => process.env.ZOOM_OAUTH_URL || 'https://zoom.us/oauth/token';
const API = () => process.env.ZOOM_API_URL || 'https://api.zoom.us/v2';
let token = null;

async function ready() {
  const c = await settings.get('zoom');
  return !!(c.enabled && c.accountId && c.clientId && c.clientSecret);
}

async function getToken() {
  const c = await settings.get('zoom');
  if (!c.accountId || !c.clientId || !c.clientSecret) { const e = new Error('Add the Zoom Account ID, Client ID and Client secret in Settings.'); e.status = 400; throw e; }
  const sig = `${c.accountId}:${c.clientId}`;
  if (token && token.sig === sig && token.exp > Date.now() + 60e3) return token.value;
  const r = await fetch(`${OAUTH()}?grant_type=account_credentials&account_id=${encodeURIComponent(c.accountId)}`, {
    method: 'POST', headers: { Authorization: `Basic ${Buffer.from(`${c.clientId}:${c.clientSecret}`).toString('base64')}` },
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(`Zoom sign-in failed: ${data.reason || data.error || r.status}`); e.status = 400; throw e; }
  token = { sig, value: data.access_token, exp: Date.now() + (data.expires_in || 3600) * 1000 };
  return token.value;
}

async function api(method, path, body) {
  const r = await fetch(`${API()}${path}`, { method, headers: { Authorization: `Bearer ${await getToken()}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  if (r.status === 204) return null;
  const data = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(`Zoom: ${data.message || r.status}`); e.status = 400; throw e; }
  return data;
}

const shape = (m) => ({
  topic: String(m.title || 'Meeting').slice(0, 200), type: 2, start_time: new Date(m.startAt).toISOString(),
  duration: Math.max(5, Math.round((new Date(m.endAt) - new Date(m.startAt)) / 60000)), timezone: 'Asia/Kolkata', agenda: String(m.agenda || '').slice(0, 2000),
  settings: { join_before_host: true, waiting_room: false, mute_upon_entry: true, approval_type: 2 },
});

async function create(m) { const d = await api('POST', '/users/me/meetings', shape(m)); return { id: String(d.id), joinUrl: d.join_url, password: d.password || '' }; }
async function update(zoomId, m) { await api('PATCH', `/meetings/${zoomId}`, shape(m)); }
async function remove(zoomId) { try { await api('DELETE', `/meetings/${zoomId}`); } catch (e) { /* already gone */ } }
async function test() { const me = await api('GET', '/users/me'); return { account: me.email || me.id }; }

module.exports = { ready, create, update, remove, test };
