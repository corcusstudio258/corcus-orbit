const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { Op } = require('sequelize');
const { User, Role, Task, TimeLog, Client } = require('../models');
const { requirePerm, staffOnly } = require('../middleware/auth');
const { subordinateIds } = require('../services/access');
const { onlineIds } = require('../services/socket');

router.use(staffOnly);

const staffWhere = { '$Role.isClientRole$': false };

// Lightweight list used by pickers (assignees etc). Every staff member can see this.
router.get('/directory', async (req, res) => {
  const users = await User.findAll({
    where: { isActive: true, ...staffWhere }, include: [{ model: Role, attributes: ['id', 'name', 'color', 'level'] }],
    attributes: ['id', 'name', 'email', 'designation', 'color', 'reportsToId'], order: [['name', 'ASC']],
  });
  res.json(users);
});

router.get('/', requirePerm('users.view', 'users.manage'), async (req, res) => {
  const where = { ...staffWhere };
  if (req.query.q) where[Op.or] = [{ name: { [Op.like]: `%${req.query.q}%` } }, { email: { [Op.like]: `%${req.query.q}%` } }];
  if (req.query.active !== 'all') where.isActive = true;
  const users = await User.findAll({
    where, include: [Role, { model: User, as: 'manager', attributes: ['id', 'name'] }], order: [['name', 'ASC']],
  });
  // Open task counts per user
  const open = await Task.findAll({
    where: { status: { [Op.ne]: 'done' } }, attributes: ['id', 'dueDate'],
    include: [{ model: User, as: 'assignees', attributes: ['id'], through: { attributes: [] } }],
  });
  const load = {};
  const now = new Date();
  open.forEach((t) => t.assignees.forEach((a) => {
    load[a.id] = load[a.id] || { open: 0, overdue: 0 };
    load[a.id].open += 1;
    if (t.dueDate && new Date(t.dueDate) < now) load[a.id].overdue += 1;
  }));
  const online = new Set(onlineIds());
  res.json(users.map((u) => ({ ...u.toJSON(), load: load[u.id] || { open: 0, overdue: 0 }, online: online.has(u.id) })));
});

router.get('/:id', requirePerm('users.view', 'users.manage'), async (req, res) => {
  const user = await User.findByPk(req.params.id, { include: [Role, { model: User, as: 'manager', attributes: ['id', 'name'] },
    { model: User, as: 'reports', attributes: ['id', 'name', 'designation', 'color'] }] });
  if (!user) return res.status(404).json({ error: 'Person not found.' });
  const since = new Date(Date.now() - 30 * 864e5);
  const logs = await TimeLog.findAll({ where: { userId: user.id, startedAt: { [Op.gte]: since } }, raw: true });
  const minutes30d = logs.reduce((s, l) => s + (l.minutes || 0), 0);
  const done30d = await Task.count({ where: { status: 'done', completedAt: { [Op.gte]: since } },
    include: [{ model: User, as: 'assignees', where: { id: user.id }, attributes: [], through: { attributes: [] } }] });
  res.json({ ...user.toJSON(), stats: { minutes30d, done30d } });
});

function canAssignRole(req, role) {
  if (!role) return 'Pick a role.';
  if (role.isClientRole) return 'Client logins are created from the Clients page.';
  if (req.user.Role.level <= 1) return null;
  if (role.level <= req.user.Role.level) return 'You can only add people in roles below your own.';
  return null;
}

router.post('/', requirePerm('users.manage'), async (req, res) => {
  const { name, email, password, phone, designation, department, roleId, reportsToId, color } = req.body;
  if (!name || !email || !password || password.length < 8) {
    return res.status(400).json({ error: 'Name, email and a password of at least 8 characters are required.' });
  }
  const role = await Role.findByPk(roleId);
  const err = canAssignRole(req, role);
  if (err) return res.status(400).json({ error: err });
  if (await User.findOne({ where: { email: email.toLowerCase().trim() } })) {
    return res.status(400).json({ error: 'Someone already uses this email.' });
  }
  const user = await User.create({
    name, email: email.toLowerCase().trim(), phone, designation, department, roleId,
    reportsToId: reportsToId || null, color: color || '#3DE0F2', passwordHash: await bcrypt.hash(password, 10),
  });
  res.status(201).json(await User.findByPk(user.id, { include: [Role] }));
});

// Invite by email (Firebase / SMTP) and WhatsApp. The person sets their own password.
router.post('/invite', requirePerm('users.invite', 'users.manage'), async (req, res) => {
  const { name, email, phone, designation, department, roleId, reportsToId, color } = req.body;
  if (!name || !email) return res.status(400).json({ error: 'Name and email are required.' });
  const role = await Role.findByPk(roleId);
  const err = canAssignRole(req, role);
  if (err) return res.status(400).json({ error: err });
  const clean = email.toLowerCase().trim();
  if (await User.findOne({ where: { email: clean } })) return res.status(400).json({ error: 'Someone already uses this email.' });
  const user = await User.create({
    name, email: clean, phone, designation, department, roleId, reportsToId: reportsToId || null, color: color || '#3D5AFE',
    isActive: false, passwordHash: await bcrypt.hash(require('crypto').randomBytes(24).toString('hex'), 10),
  });
  const sent = await require('../services/invites').issue(req, user, 'invite');
  res.status(201).json({ user: await User.findByPk(user.id, { include: [Role] }), ...sent });
});

router.post('/:id/invite', requirePerm('users.invite', 'users.manage'), async (req, res) => {
  const user = await User.findByPk(req.params.id, { include: [Role] });
  if (!user || user.Role?.isClientRole) return res.status(404).json({ error: 'Person not found.' });
  if (user.isActive) return res.status(400).json({ error: `${user.name} has already joined. Send a password reset instead.` });
  res.json(await require('../services/invites').issue(req, user, 'invite'));
});

router.post('/:id/reset-link', requirePerm('users.manage'), async (req, res) => {
  const user = await User.findByPk(req.params.id);
  if (!user) return res.status(404).json({ error: 'Person not found.' });
  res.json(await require('../services/invites').issue(req, user, 'reset'));
});

router.patch('/:id', requirePerm('users.manage'), async (req, res) => {
  const user = await User.findByPk(req.params.id, { include: [Role] });
  if (!user || user.Role?.isClientRole) return res.status(404).json({ error: 'Person not found.' });
  const top = req.user.Role.level <= 1;
  if (!top && user.Role.level <= req.user.Role.level && user.id !== req.user.id) {
    return res.status(403).json({ error: 'You can only edit people below your level.' });
  }
  const b = req.body;
  if (b.roleId && Number(b.roleId) !== user.roleId) {
    const role = await Role.findByPk(b.roleId);
    const err = canAssignRole(req, role);
    if (err) return res.status(400).json({ error: err });
    if (user.id === req.user.id) return res.status(400).json({ error: "You can't change your own role." });
    user.roleId = role.id;
  }
  if (b.reportsToId !== undefined) {
    const target = b.reportsToId ? Number(b.reportsToId) : null;
    if (target === user.id) return res.status(400).json({ error: "Someone can't report to themselves." });
    if (target && (await subordinateIds(user.id)).includes(target)) {
      return res.status(400).json({ error: 'That would create a reporting loop.' });
    }
    user.reportsToId = target;
  }
  ['name', 'phone', 'designation', 'department', 'color', 'whatsappOptIn'].forEach((k) => { if (b[k] !== undefined) user[k] = b[k]; });
  if (b.email) user.email = b.email.toLowerCase().trim();
  if (b.isActive !== undefined) {
    if (user.id === req.user.id) return res.status(400).json({ error: "You can't deactivate yourself." });
    user.isActive = !!b.isActive;
  }
  if (b.password) {
    if (b.password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    user.passwordHash = await bcrypt.hash(b.password, 10);
  }
  await user.save();
  res.json(await User.findByPk(user.id, { include: [Role, { model: User, as: 'manager', attributes: ['id', 'name'] }] }));
});

module.exports = router;
