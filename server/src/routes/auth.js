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
  if (!user || !(await bcrypt.compare(password || '', user.passwordHash))) {
    return res.status(401).json({ error: 'Email or password is incorrect.' });
  }
  if (!user.isActive) return res.status(403).json({ error: 'Your account has been deactivated. Contact your admin.' });
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

module.exports = { router, ensureRoles };
