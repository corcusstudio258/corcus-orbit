const router = require('express').Router();
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { User, Role, Client } = require('../models');
const { auth, signToken } = require('../middleware/auth');
const { DEFAULT_ROLES, PERMISSIONS } = require('../config/permissions');
const settings = require('../services/settings');

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 40, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many sign-in attempts. Try again in a few minutes.' } });

async function ensureRoles() {
  for (const r of DEFAULT_ROLES) {
    const [role] = await Role.findOrCreate({ where: { slug: r.slug }, defaults: r });
    if (r.isSystem) { role.permissions = r.permissions; await role.save(); }
  }
}

async function mePayload(userId) {
  const user = await User.findByPk(userId, { include: [Role, Client, { model: User, as: 'manager', attributes: ['id', 'name'] }] });
  const company = await settings.get('company');
  return { user, permissions: user.Role?.permissions || [], isClient: !!user.Role?.isClientRole, company };
}

router.get('/status', async (req, res) => {
  const count = await User.count();
  const company = await settings.get('company');
  res.json({ needsSetup: count === 0, company: { name: company.name, tagline: company.tagline } });
});

// First-run: create the company workspace and its first admin.
router.post('/setup', async (req, res) => {
  if (await User.count()) return res.status(400).json({ error: 'This workspace is already set up. Sign in instead.' });
  const { companyName, name, email, password, phone } = req.body;
  if (!name || !email || !password || password.length < 8) {
    return res.status(400).json({ error: 'Name, email and a password of at least 8 characters are required.' });
  }
  await ensureRoles();
  if (companyName) await settings.set('company', { name: companyName });
  const admin = await Role.findOne({ where: { slug: 'admin' } });
  const user = await User.create({
    name, email: email.toLowerCase().trim(), phone, designation: 'Founder', roleId: admin.id,
    passwordHash: await bcrypt.hash(password, 10), color: '#3D5AFE',
  });
  await require('../config/defaults').ensureDefaults();
  res.json({ token: signToken(user), ...(await mePayload(user.id)) });
});

router.post('/login', limiter, async (req, res) => {
  const { email, password } = req.body;
  const user = await User.scope('withPassword').findOne({ where: { email: String(email || '').toLowerCase().trim() } });
  if (user && !user.isActive && String(user.invitePurpose || '').startsWith('invite')) return res.status(403).json({ error: 'Your invite is waiting. Open the link we sent to your email or WhatsApp to set your password.' });
  if (!user || !(await bcrypt.compare(password || '', user.passwordHash))) {
    return res.status(401).json({ error: 'Email or password is incorrect.' });
  }
  if (!user.isActive) {
    if (String(user.invitePurpose || '').startsWith('invite')) return res.status(403).json({ error: 'Your invite is waiting. Open the link we sent to your email or WhatsApp to set your password.' });
    if (user.Client?.status === 'pending' || (await Client.findByPk(user.clientId || 0))?.status === 'pending') return res.status(403).json({ error: 'Thanks for signing up. We will email you as soon as your account is approved.' });
    return res.status(403).json({ error: 'Your account has been deactivated. Contact your admin.' });
  }
  res.json({ token: signToken(user), ...(await mePayload(user.id)) });
});

router.get('/me', auth, async (req, res) => res.json(await mePayload(req.user.id)));

router.patch('/me', auth, async (req, res) => {
  const { name, phone, whatsappOptIn, notifyPrefs, currentPassword, newPassword } = req.body;
  const user = await User.scope('withPassword').findByPk(req.user.id);
  if (name !== undefined) user.name = name;
  if (phone !== undefined) user.phone = phone;
  if (whatsappOptIn !== undefined) user.whatsappOptIn = !!whatsappOptIn;
  if (notifyPrefs) user.notifyPrefs = { ...user.notifyPrefs, ...notifyPrefs };
  if (newPassword) {
    if (newPassword.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters.' });
    if (!(await bcrypt.compare(currentPassword || '', user.passwordHash))) {
      return res.status(400).json({ error: 'Current password is incorrect.' });
    }
    user.passwordHash = await bcrypt.hash(newPassword, 10);
  }
  await user.save();
  res.json(await mePayload(user.id));
});

router.get('/permissions', auth, (req, res) => res.json(PERMISSIONS));

// ---------- invites and password resets ----------
const invites = require('../services/invites');
const firebase = require('../services/firebase');
const tokenLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many attempts. Try again in a few minutes.' } });

router.get('/token', tokenLimiter, async (req, res) => {
  const u = await invites.find(req.query.token);
  if (!u || (req.query.email && u.email !== String(req.query.email).toLowerCase())) return res.status(404).json({ error: 'This link has expired or was already used. Ask for a new one.' });
  const company = await settings.get('company');
  const [purpose, via] = String(u.invitePurpose || 'reset').split('|');
  res.json({ purpose, name: u.name, email: u.email, firebase: via === 'fb', company: { name: company.name } });
});

router.post('/accept', tokenLimiter, async (req, res) => {
  const { token, password, oobCode } = req.body;
  const u = await invites.find(token);
  if (!u) return res.status(404).json({ error: 'This link has expired or was already used. Ask for a new one.' });
  if (!password || password.length < 8) return res.status(400).json({ error: 'Use at least 8 characters.' });
  if (String(u.invitePurpose || '').endsWith('|fb')) {
    if (!oobCode) return res.status(400).json({ error: 'Open this page from the link in your email.' });
    try { await firebase.verify(u.email, oobCode); } catch (e) { return res.status(400).json({ error: e.message }); }
  }
  const full = await User.scope('withPassword').findByPk(u.id);
  full.passwordHash = await bcrypt.hash(password, 10);
  full.isActive = true; full.inviteToken = null; full.inviteExpires = null; full.invitePurpose = null;
  await full.save();
  res.json({ token: signToken(full), ...(await mePayload(full.id)) });
});

router.post('/forgot', tokenLimiter, async (req, res) => {
  const email = String(req.body.email || '').toLowerCase().trim();
  const u = email && await User.findOne({ where: { email } });
  if (u && u.isActive) { try { await invites.issue(req, u, 'reset'); } catch (e) { console.error('[forgot]', e.message); } }
  res.json({ ok: true, message: 'If that email has an account, a reset link is on its way (email or WhatsApp).' });
});

module.exports = { router, ensureRoles };
