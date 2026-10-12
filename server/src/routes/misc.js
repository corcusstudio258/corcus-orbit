// Notifications, settings, activity feed and authenticated file downloads.
const express = require('express');
const path = require('path');
const jwt = require('jsonwebtoken');
const { Op } = require('sequelize');
const { Notification, Activity, User, Project, Task, Attachment, WhatsAppLog } = require('../models');
const { auth, requirePerm, staffOnly, secret, loadUser } = require('../middleware/auth');
const { visibleProjectIds, canSeeTask } = require('../services/access');
const settings = require('../services/settings');
const whatsapp = require('../services/whatsapp');

const notifications = express.Router();
notifications.get('/', async (req, res) => {
  const where = { userId: req.user.id };
  if (req.query.unread === '1') where.read = false;
  const [items, unread] = await Promise.all([
    Notification.findAll({ where, order: [['createdAt', 'DESC']], limit: Math.min(Number(req.query.limit) || 50, 200) }),
    Notification.count({ where: { userId: req.user.id, read: false } }),
  ]);
  res.json({ items, unread });
});
notifications.post('/read', async (req, res) => {
  const where = { userId: req.user.id };
  if (Array.isArray(req.body.ids) && req.body.ids.length) where.id = req.body.ids;
  await Notification.update({ read: true }, { where });
  res.json({ ok: true });
});

const activity = express.Router();
activity.get('/', staffOnly, async (req, res) => {
  const pids = await visibleProjectIds(req);
  const where = pids ? { [Op.or]: [{ projectId: pids }, { actorId: req.user.id }] } : {};
  if (req.query.projectId) where.projectId = req.query.projectId;
  if (req.query.userId) where.actorId = req.query.userId;
  const before = req.query.before ? { createdAt: { [Op.lt]: new Date(req.query.before) } } : {};
  res.json(await Activity.findAll({ where: { ...where, ...before }, order: [['createdAt', 'DESC']], limit: 60,
    include: [{ model: User, as: 'actor', attributes: ['id', 'name', 'color'] }, { model: Project, attributes: ['id', 'name', 'color'] },
      { model: Task, attributes: ['id', 'key', 'title'] }] }));
});

// ---- Settings ----
const mask = (s) => (s ? `${'•'.repeat(8)}${String(s).slice(-4)}` : '');
const settingsRouter = express.Router();
settingsRouter.use(staffOnly);
settingsRouter.get('/', async (req, res) => {
  const company = await settings.get('company');
  if (!req.can('settings.manage')) return res.json({ company });
  const wa = JSON.parse(JSON.stringify(await settings.get('whatsapp')));
  wa.meta.token = mask(wa.meta.token);
  if (wa.corcus) wa.corcus.token = mask(wa.corcus.token);
  const em = JSON.parse(JSON.stringify(await settings.get('email'))); em.pass = mask(em.pass);
  const fb = JSON.parse(JSON.stringify(await settings.get('firebase'))); fb.apiKey = mask(fb.apiKey);
  const zm = JSON.parse(JSON.stringify(await settings.get('zoom'))); zm.clientSecret = mask(zm.clientSecret);
  const onboarding = await settings.get('onboarding');
  const aiCfg = JSON.parse(JSON.stringify(await settings.get('ai')));
  const envKey = !aiCfg.apiKey && !!process.env.GEMINI_API_KEY;
  aiCfg.apiKey = mask(aiCfg.apiKey);
  res.json({ company, whatsapp: wa, ai: { ...aiCfg, envKey }, email: em, firebase: fb, zoom: zm, onboarding });
});
settingsRouter.patch('/ai', requirePerm('settings.manage'), async (req, res) => {
  const body = { ...req.body };
  if (body.apiKey === undefined || String(body.apiKey).startsWith('••')) delete body.apiKey;
  if (body.apiKey) body.apiKey = String(body.apiKey).trim();
  const saved = JSON.parse(JSON.stringify(await settings.set('ai', body)));
  saved.apiKey = mask(saved.apiKey);
  res.json(saved);
});
settingsRouter.post('/ai/test', requirePerm('settings.manage'), async (req, res) => {
  const ai = require('../services/ai');
  try {
    const text = await ai.generate({ prompt: 'Reply with exactly: Orbit AI is connected.', temperature: 0, maxTokens: 30 });
    res.json({ ok: true, reply: text, ...(await ai.status()) });
  } catch (e) { res.status(e.status || 500).json({ ok: false, error: e.message }); }
});
settingsRouter.patch('/company', requirePerm('settings.manage'), async (req, res) => {
  const allowed = ['name', 'tagline', 'accent', 'workStart', 'timezone', 'graceMinutes', 'dailyCapacity', 'currency', 'reviewRetentionDays'];
  const v = Object.fromEntries(Object.entries(req.body).filter(([k]) => allowed.includes(k)));
  if (v.reviewRetentionDays !== undefined) v.reviewRetentionDays = Math.max(0, Math.min(3650, Math.round(Number(v.reviewRetentionDays) || 0)));
  res.json(await settings.set('company', v));
});
const SECRET_FIELD = { email: 'pass', firebase: 'apiKey', zoom: 'clientSecret' };
for (const key of Object.keys(SECRET_FIELD)) {
  settingsRouter.patch(`/${key}`, requirePerm('settings.manage'), async (req, res) => {
    const body = { ...req.body };
    const sf = SECRET_FIELD[key];
    if (body[sf] === undefined || String(body[sf]).startsWith('••')) delete body[sf];
    if (typeof body[sf] === 'string') body[sf] = body[sf].trim();
    const saved = JSON.parse(JSON.stringify(await settings.set(key, body)));
    saved[sf] = mask(saved[sf]);
    res.json(saved);
  });
}
settingsRouter.post('/email/test', requirePerm('settings.manage'), async (req, res) => {
  try {
    await require('../services/mailer').send({ to: req.body.to || req.user.email, subject: 'Orbit test email', text: 'Email sending from Orbit works.', html: '<p>Email sending from <b>Orbit</b> works.</p>' }, { force: true });
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
settingsRouter.post('/zoom/test', requirePerm('settings.manage'), async (req, res) => {
  try { res.json({ ok: true, ...(await require('../services/zoom').test()) }); } catch (e) { res.status(400).json({ error: e.message }); }
});
settingsRouter.post('/firebase/test', requirePerm('settings.manage'), async (req, res) => {
  try { await require('../services/firebase').sendLink(req.body.to || req.user.email, `${process.env.APP_URL || req.headers.origin || ''}/login`, { force: true }); res.json({ ok: true }); } catch (e) { res.status(400).json({ error: e.message }); }
});
settingsRouter.put('/onboarding', requirePerm('settings.manage'), async (req, res) => {
  const b = req.body || {};
  const qs = (Array.isArray(b.questions) ? b.questions : []).filter((q) => q && String(q.label || '').trim()).slice(0, 60).map((q, i) => ({
    id: String(q.id || `q${i}_${Date.now().toString(36)}`).replace(/[^\w-]/g, '').slice(0, 40), label: String(q.label).trim().slice(0, 200),
    type: ['text', 'textarea', 'email', 'tel', 'url', 'choice', 'multi', 'date', 'secret', 'file'].includes(q.type) ? q.type : 'text',
    required: !!q.required, options: Array.isArray(q.options) ? q.options.map(String).filter(Boolean).slice(0, 20) : undefined,
    hint: q.hint ? String(q.hint).slice(0, 300) : undefined, maps: q.maps || undefined, section: q.section ? String(q.section).slice(0, 80) : undefined,
    showIf: q.showIf?.id ? { id: String(q.showIf.id), is: String(q.showIf.is || '') } : undefined,
  }));
  const row = await require('../models').Setting.findOne({ where: { key: 'onboarding' } });
  const next = { allowSignup: b.allowSignup !== false, autoApprove: !!b.autoApprove, welcome: String(b.welcome || '').slice(0, 500), questions: qs };
  // Replace (not merge) so removed questions really go away.
  if (row) { row.value = next; await row.save(); } else await require('../models').Setting.create({ key: 'onboarding', value: next });
  await settings.reload('onboarding');
  res.json(await settings.get('onboarding'));
});
settingsRouter.patch('/whatsapp', requirePerm('settings.manage'), async (req, res) => {
  const body = JSON.parse(JSON.stringify(req.body || {}));
  // Keep the saved token when the masked placeholder is sent back.
  if (body.meta && (body.meta.token === undefined || String(body.meta.token).startsWith('••'))) delete body.meta.token;
  if (body.corcus && (body.corcus.token === undefined || String(body.corcus.token).startsWith('••'))) delete body.corcus.token;
  const saved = JSON.parse(JSON.stringify(await settings.set('whatsapp', body)));
  saved.meta.token = mask(saved.meta.token);
  if (saved.corcus) saved.corcus.token = mask(saved.corcus.token);
  res.json(saved);
});
settingsRouter.post('/whatsapp/test', requirePerm('settings.manage'), async (req, res) => {
  const company = await settings.get('company');
  const phone = req.body.phone || req.user.phone;
  if (!phone) return res.status(400).json({ error: 'Enter a phone number to send the test to.' });
  const status = await whatsapp.send(phone, `*${company.name}*\nTest message from your task workspace. WhatsApp notifications are working.`, { force: true });
  const last = await WhatsAppLog.findOne({ order: [['id', 'DESC']] });
  res.json({ status, error: status === 'failed' ? last?.error : null });
});
settingsRouter.get('/whatsapp/logs', requirePerm('settings.manage'), async (req, res) => {
  res.json(await WhatsAppLog.findAll({ order: [['createdAt', 'DESC']], limit: 100 }));
});

// ---- File download (token in query so plain links work) ----
const files = express.Router();
files.get('/:id', async (req, res) => {
  try {
    const { id } = jwt.verify(req.query.t || '', secret());
    const user = await loadUser(id);
    if (!user) return res.status(401).send('Sign in again to download this file.');
    const a = await Attachment.findByPk(req.params.id);
    if (!a) return res.status(404).send('File not found.');
    const task = await Task.findByPk(a.taskId);
    const fakeReq = { user, isClient: !!user.Role?.isClientRole, perms: new Set(user.Role?.permissions || []) };
    fakeReq.can = (p) => fakeReq.perms.has(p);
    if (!(await canSeeTask(fakeReq, task)) || (fakeReq.isClient && !a.clientVisible)) return res.status(404).send('File not found.');
    const dir = path.resolve(__dirname, '../..', process.env.UPLOAD_DIR || './uploads');
    res.download(path.join(dir, a.fileName), a.originalName);
  } catch {
    res.status(401).send('This download link has expired. Open the task again.');
  }
});

// Client logos and documents (token in query so <img> and plain links work).
const clientFiles = express.Router();
clientFiles.get('/:id', async (req, res) => {
  try {
    const { id } = jwt.verify(req.query.t || '', secret());
    const user = await loadUser(id);
    if (!user) return res.status(401).send('Sign in again to open this file.');
    const f = await require('../models').ClientFile.findByPk(req.params.id);
    if (!f) return res.status(404).send('File not found.');
    const isClient = !!user.Role?.isClientRole;
    const perms = user.Role?.permissions || [];
    if (isClient ? user.clientId !== f.clientId : !(perms.includes('clients.view') || perms.includes('clients.manage') || perms.includes('projects.view_all'))) return res.status(404).send('File not found.');
    const dir = path.resolve(__dirname, '../..', process.env.UPLOAD_DIR || './uploads');
    if (req.query.inline) return res.sendFile(path.join(dir, f.fileName), { headers: { 'Content-Type': f.mime || 'application/octet-stream' } });
    res.download(path.join(dir, f.fileName), f.originalName);
  } catch {
    res.status(401).send('This link has expired. Open it again from Orbit.');
  }
});

module.exports = { notifications: [auth, notifications], activity: [auth, activity], settings: [auth, settingsRouter], files, clientFiles };
