const router = require('express').Router();
const { Op } = require('sequelize');
const { Document, User, Project } = require('../models');
const { staffOnly } = require('../middleware/auth');
const { visibleProjectIds } = require('../services/access');
const { activity } = require('../services/notify');
const socket = require('../services/socket');

router.use(staffOnly);
const wrap = (f) => (req, res) => f(req, res).catch((e) => res.status(e.status || 500).json({ error: e.message }));
const include = [
  { model: User, as: 'author', attributes: ['id', 'name', 'color'] },
  { model: User, as: 'editor', attributes: ['id', 'name', 'color'] },
  { model: Project, attributes: ['id', 'name', 'color', 'code'] },
];

async function canSee(req, d) {
  if (d.visibility === 'private') return d.createdById === req.user.id;
  if (d.projectId) {
    const pids = await visibleProjectIds(req);
    return !pids || pids.includes(d.projectId);
  }
  return true;
}
const canEdit = (req, d) => d.createdById === req.user.id || d.visibility === 'workspace' || req.can('settings.manage');

router.get('/', wrap(async (req, res) => {
  const pids = await visibleProjectIds(req);
  const where = { [Op.or]: [{ createdById: req.user.id }, { visibility: 'workspace' }] };
  const and = [where];
  if (req.query.scope === 'mine') and.push({ createdById: req.user.id, visibility: 'private' });
  if (req.query.scope === 'workspace') and.push({ visibility: 'workspace' });
  if (req.query.projectId) and.push({ projectId: req.query.projectId });
  if (req.query.q) and.push({ [Op.or]: [{ title: { [Op.like]: `%${req.query.q}%` } }, { content: { [Op.like]: `%${req.query.q}%` } }] });
  const docs = await Document.findAll({ where: { [Op.and]: and }, include, order: [['pinned', 'DESC'], ['updatedAt', 'DESC']], attributes: { exclude: ['content'] } });
  res.json(docs.filter((d) => !d.projectId || !pids || pids.includes(d.projectId)));
}));

router.get('/:id', wrap(async (req, res) => {
  const d = await Document.findByPk(req.params.id, { include });
  if (!d || !(await canSee(req, d))) return res.status(404).json({ error: 'Document not found.' });
  res.json({ ...d.toJSON(), canEdit: canEdit(req, d), canDelete: d.createdById === req.user.id || req.can('settings.manage') });
}));

router.post('/', wrap(async (req, res) => {
  const b = req.body;
  const d = await Document.create({
    title: String(b.title || 'Untitled').slice(0, 200), content: b.content || '', icon: b.icon || '📄',
    visibility: b.visibility === 'private' ? 'private' : 'workspace', projectId: b.projectId || null, clientVisible: !!b.clientVisible,
    createdById: req.user.id, updatedById: req.user.id,
  });
  if (d.visibility === 'workspace') await activity({ actorId: req.user.id, action: 'doc.created', summary: `created the doc "${d.title}"`, projectId: d.projectId });
  socket.toStaff('doc:changed', { id: d.id });
  res.status(201).json(d);
}));

router.patch('/:id', wrap(async (req, res) => {
  const d = await Document.findByPk(req.params.id);
  if (!d || !(await canSee(req, d))) return res.status(404).json({ error: 'Document not found.' });
  if (!canEdit(req, d)) return res.status(403).json({ error: "You can't edit this document." });
  ['title', 'content', 'icon', 'projectId', 'clientVisible', 'pinned'].forEach((k) => { if (req.body[k] !== undefined) d[k] = req.body[k] === '' ? null : req.body[k]; });
  if (req.body.visibility && d.createdById === req.user.id) d.visibility = req.body.visibility === 'private' ? 'private' : 'workspace';
  d.updatedById = req.user.id;
  await d.save();
  socket.toStaff('doc:changed', { id: d.id, by: req.user.id });
  res.json(d);
}));

router.delete('/:id', wrap(async (req, res) => {
  const d = await Document.findByPk(req.params.id);
  if (!d) return res.status(404).json({ error: 'Document not found.' });
  if (d.createdById !== req.user.id && !req.can('settings.manage')) return res.status(403).json({ error: 'Only the author can delete this document.' });
  await d.destroy();
  socket.toStaff('doc:changed', { id: d.id, deleted: true });
  res.json({ ok: true });
}));

module.exports = router;
