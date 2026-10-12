// Firebase Authentication email links (no service account needed, just the Web API key).
// Used for team invites and password resets: Firebase sends the email, the link comes back
// to Orbit, and Orbit checks the one-time code with Firebase before letting someone set a password.
const settings = require('./settings');

const BASE = () => process.env.FIREBASE_AUTH_BASE || 'https://identitytoolkit.googleapis.com/v1';

async function ready() {
  const c = await settings.get('firebase');
  return !!(c.enabled && c.apiKey);
}

async function call(path, body) {
  const c = await settings.get('firebase');
  if (!c.apiKey) throw new Error('Add the Firebase Web API key in Settings first.');
  const r = await fetch(`${BASE()}/${path}?key=${encodeURIComponent(c.apiKey)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const code = data?.error?.message || `HTTP ${r.status}`;
    const friendly = {
      'INVALID_OOB_CODE': 'This link has already been used or has expired. Ask for a new one.',
      'EXPIRED_OOB_CODE': 'This link has expired. Ask for a new one.',
      'OPERATION_NOT_ALLOWED': 'Turn on “Email link (passwordless sign-in)” under Firebase → Authentication → Sign-in method.',
      'UNAUTHORIZED_DOMAIN': 'Add this site’s domain under Firebase → Authentication → Settings → Authorized domains.',
      'INVALID_CONTINUE_URI': 'The app URL is not valid. Set APP_URL on the server.',
    }[code.split(' ')[0]] || (/API key not valid/i.test(code) ? 'The Firebase API key is not valid.' : `Firebase: ${code}`);
    const e = new Error(friendly); e.status = 400; throw e;
  }
  return data;
}

/** Ask Firebase to email a sign-in link that lands on continueUrl. */
async function sendLink(email, continueUrl, { force = false } = {}) {
  if (!force && !(await ready())) return false;
  await call('accounts:sendOobCode', { requestType: 'EMAIL_SIGNIN', email, continueUrl, canHandleCodeInApp: true });
  return true;
}

/** Confirm the code from the link belongs to this email. */
async function verify(email, oobCode) {
  const data = await call('accounts:signInWithEmailLink', { email, oobCode });
  if (String(data.email || '').toLowerCase() !== String(email).toLowerCase()) { const e = new Error('This link was sent to a different email.'); e.status = 400; throw e; }
  return true;
}

module.exports = { ready, sendLink, verify };
