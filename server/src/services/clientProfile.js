// Client onboarding answers, encrypted credentials, logo and document files.
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { secret } = require('../middleware/auth');
const settings = require('./settings');

const UPLOAD_DIR = path.resolve(__dirname, '../..', process.env.UPLOAD_DIR || './uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({ destination: UPLOAD_DIR, filename: (q, f, cb) => cb(null, `c-${Date.now()}-${crypto.randomBytes(8).toString('hex')}${path.extname(f.originalname).toLowerCase()}`) }),
  limits: { fileSize: 25 * 1024 * 1024, files: 12 },
});

const key = () => crypto.createHash('sha256').update(`client-secrets:${secret()}`).digest();
function encrypt(obj) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return `v1:${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${data.toString('base64')}`;
}
function decrypt(str) {
  if (!str) return {};
  try {
    const [, iv, tag, data] = String(str).split(':');
    const d = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
    d.setAuthTag(Buffer.from(tag, 'base64'));
    return JSON.parse(Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8'));
  } catch { return {}; }
}

/** Validate answers against the onboarding form. Returns { answers, secrets, mapped, error }. */
async function readAnswers(raw, { partial = false } = {}) {
  const form = await settings.get('onboarding');
  let input = raw;
  if (typeof raw === 'string') { try { input = JSON.parse(raw); } catch { input = {}; } }
  input = input || {};
  const answers = {}; const secrets = {}; const mapped = {};
  for (const q of form.questions) {
    if (q.type === 'file') continue;
    const shown = !q.showIf || String(input[q.showIf.id] ?? '') === q.showIf.is;
    let v = input[q.id];
    if (Array.isArray(v)) v = v.map(String).filter(Boolean).slice(0, 20);
    else if (v !== undefined && v !== null) v = String(v).trim().slice(0, 4000);
    const empty = v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length);
    if (!partial && shown && q.required && empty) return { error: `Please answer: ${q.label}` };
    if (empty || !shown) continue;
    if (q.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return { error: `${q.label} doesn't look like an email.` };
    if (q.type === 'secret') { secrets[q.id] = v; continue; }
    answers[q.id] = v;
    if (q.maps && !Array.isArray(v)) mapped[q.maps] = v.slice(0, 250);
  }
  return { answers, secrets, mapped };
}

/** Public view of the form (no internal mapping keys). */
async function publicForm() {
  const form = await settings.get('onboarding');
  const company = await settings.get('company');
  return { allowSignup: form.allowSignup !== false, welcome: form.welcome, company: { name: company.name },
    questions: form.questions.map(({ maps, ...q }) => q) };
}

/** Store uploaded files for a client. category: logo | brand | document | other */
async function saveFiles(client, files, category, userId) {
  const { ClientFile } = require('../models');
  const rows = [];
  for (const f of files || []) {
    if (category === 'logo' && !/^image\//.test(f.mimetype)) { const e = new Error('The logo has to be an image (PNG, JPG, SVG or WebP).'); e.status = 400; throw e; }
    rows.push(await ClientFile.create({ clientId: client.id, originalName: f.originalname, fileName: f.filename, mime: f.mimetype, size: f.size, category, userId }));
  }
  if (category === 'logo' && rows.length) { client.logo = String(rows[rows.length - 1].id); await client.save(); }
  return rows;
}

async function removeFile(client, fileId) {
  const { ClientFile } = require('../models');
  const f = await ClientFile.findOne({ where: { id: fileId, clientId: client.id } });
  if (!f) { const e = new Error('File not found.'); e.status = 404; throw e; }
  fs.promises.unlink(path.join(UPLOAD_DIR, f.fileName)).catch(() => {});
  if (client.logo === String(f.id)) { client.logo = null; await client.save(); }
  await f.destroy();
}

module.exports = { upload, encrypt, decrypt, readAnswers, publicForm, saveFiles, removeFile, UPLOAD_DIR };
