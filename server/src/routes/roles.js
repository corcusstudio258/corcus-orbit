const router = require('express').Router();
const { fn, col } = require('sequelize');
const { Role, User } = require('../models');
const { requirePerm, staffOnly } = require('../middleware/auth');
const { ALL } = require('../config/permissions');

const slugify = (s) => String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const isTop = (req) => req.user.Role.level <= 1;

router.use(staffOnly);

router.get('/', async (req, res) => {
  const roles = await Role.findAll({ order: [['level', 'ASC'], ['name', 'ASC']] });
  const counts = await User.findAll({ attributes: ['roleId', [fn('COUNT', col('id')), 'n']], group: ['roleId'], raw: true });
  const byRole = Object.fromEntries(counts.map((c) => [c.roleId, Number(c.n)]));
  res.json(roles.map((r) => ({ ...r.toJSON(), userCount: byRole[r.id] || 0 })));
});

function validate(req, body) {
  const myLevel = req.user.Role.level;
  const level = Number(body.level);
  if (!body.name) return 'Give the role a name.';
  if (!Number.isFinite(level) || level < 1 || level > 98) return 'Level must be between 1 and 98.';
  if (!isTop(req) && level <= myLevel) return 'You can only create roles below your own level.';
  const perms = (body.permissions || []).filter((p) => ALL.includes(p));
  if (!isTop(req) && perms.some((p) => !req.perms.has(p))) return "You can't grant permissions you don't have.";
  return null;
}

router.post('/', requirePerm('roles.manage'), async (req, res) => {
  const err = validate(req, req.body);
  if (err) return res.status(400).json({ error: err });
  let slug = slugify(req.body.name); let i = 1;
  while (await Role.findOne({ where: { slug } })) slug = `${slugify(req.body.name)}-${++i}`;
  const role = await Role.create({
    name: req.body.name, slug, description: req.body.description, level: Number(req.body.level),
    color: req.body.color || '#3DE0F2', permissions: (req.body.permissions || []).filter((p) => ALL.includes(p)),
  });
  res.status(201).json(role);
});

router.patch('/:id', requirePerm('roles.manage'), async (req, res) => {
  const role = await Role.findByPk(req.params.id);
  if (!role) return res.status(404).json({ error: 'Role not found.' });
  if (role.isSystem) {
    // System roles: only cosmetic changes.
    await role.update({ description: req.body.description ?? role.description, color: req.body.color ?? role.color });
    return res.json(role);
  }
  if (!isTop(req) && role.level <= req.user.Role.level) return res.status(403).json({ error: 'You can only edit roles below your own level.' });
  const body = { ...role.toJSON(), ...req.body };
  const err = validate(req, body);
  if (err) return res.status(400).json({ error: err });
  await role.update({
    name: body.name, description: body.description, level: Number(body.level), color: body.color,
    permissions: (body.permissions || []).filter((p) => ALL.includes(p)),
  });
  res.json(role);
});

router.delete('/:id', requirePerm('roles.manage'), async (req, res) => {
  const role = await Role.findByPk(req.params.id);
  if (!role) return res.status(404).json({ error: 'Role not found.' });
  if (role.isSystem) return res.status(400).json({ error: 'Built-in roles can’t be deleted.' });
  const n = await User.count({ where: { roleId: role.id } });
  if (n) return res.status(400).json({ error: `Move the ${n} people in this role to another role first.` });
  await role.destroy();
  res.json({ ok: true });
});

module.exports = router;
