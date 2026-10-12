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
  const aiCfg = JSON.parse(JSON.stringify(await settings.get('ai')));
  const envKey = !aiCfg.apiKey && !!process.env.GEMINI_API_KEY;
  aiCfg.apiKey = mask(aiCfg.apiKey);
  res.json({ company, whatsapp: wa, ai: { ...aiCfg, envKey } });
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
  const allowed = ['name', 'tagline', 'accent', 'workStart', 'timezone', 'graceMinutes', 'dailyCapacity', 'currency'];
  const v = Object.fromEntries(Object.entries(req.body).filter(([k]) => allowed.includes(k)));
  res.json(await settings.set('company', v));
});
settingsRouter.patch('/whatsapp', requirePerm('settings.manage'), async (req, res) => {
  const body = JSON.parse(JSON.stringify(req.body || {}));
  // Keep the saved token when the masked placeholder is sent back.
  if (body.meta && (body.meta.token === undefined || String(body.meta.token).startsWith('••'))) delete body.meta.token;
  const saved = JSON.parse(JSON.stringify(await settings.set('whatsapp', body)));
  saved.meta.token = mask(saved.meta.token);
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

module.exports = { notifications: [auth, notifications], activity: [auth, activity], settings: [auth, settingsRouter], files };
