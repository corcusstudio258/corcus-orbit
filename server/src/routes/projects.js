const router = require('express').Router();
const { Op } = require('sequelize');
const { Project, Client, User, Task, Milestone, ProjectMember, Activity, TimeLog } = require('../models');
const { requirePerm, staffOnly } = require('../middleware/auth');
const { visibleProjectIds } = require('../services/access');
const { projectProgress } = require('../services/progress');
const { notify, activity } = require('../services/notify');
const socket = require('../services/socket');

router.use(staffOnly);

const memberAttrs = ['id', 'name', 'color', 'designation'];
const wrap = (f) => (req, res) => f(req, res).catch((e) => res.status(e.status || 500).json({ error: e.message }));

async function summarize(projects) {
  const ids = projects.map((p) => p.id);
  const tasks = await Task.findAll({ where: { projectId: ids }, attributes: ['id', 'projectId', 'parentId', 'status', 'dueDate'], raw: true });
  const now = new Date();
  return projects.map((p) => {
    const own = tasks.filter((t) => t.projectId === p.id);
    const counts = { todo: 0, in_progress: 0, review: 0, done: 0, blocked: 0 };
    own.forEach((t) => { counts[t.status] = (counts[t.status] || 0) + 1; });
    return {
      ...(p.toJSON ? p.toJSON() : p),
      progress: projectProgress(own), taskCount: own.length, counts,
      overdue: own.filter((t) => t.status !== 'done' && t.dueDate && new Date(t.dueDate) < now).length,
    };
  });
}

router.get('/', wrap(async (req, res) => {
  const ids = await visibleProjectIds(req);
  const where = {};
  if (ids) where.id = ids;
  if (req.query.status) where.status = req.query.status.split(',');
  else if (req.query.archived !== '1') where.status = { [Op.ne]: 'archived' };
  if (req.query.clientId) where.clientId = req.query.clientId;
  const projects = await Project.findAll({
    where, order: [['updatedAt', 'DESC']],
    include: [{ model: Client, attributes: ['id', 'name', 'color'] }, { model: User, as: 'owner', attributes: memberAttrs },
      { model: User, as: 'members', attributes: memberAttrs, through: { attributes: ['role'] } }],
  });
  res.json(await summarize(projects));
}));

router.get('/:id', wrap(async (req, res) => {
  const ids = await visibleProjectIds(req);
  if (ids && !ids.includes(Number(req.params.id))) return res.status(404).json({ error: 'Project not found or not shared with you.' });
  const p = await Project.findByPk(req.params.id, {
    include: [Client, { model: User, as: 'owner', attributes: memberAttrs },
      { model: User, as: 'members', attributes: memberAttrs, through: { attributes: ['role'] } },
      { model: Milestone }],
    order: [[Milestone, 'order', 'ASC'], [Milestone, 'dueDate', 'ASC']],
  });
  if (!p) return res.status(404).json({ error: 'Project not found.' });
  const [summary] = await summarize([p]);
  // Workload: open tasks per member in this project
  const open = await Task.findAll({ where: { projectId: p.id, status: { [Op.ne]: 'done' } }, attributes: ['id'],
    include: [{ model: User, as: 'assignees', attributes: ['id', 'name', 'color'], through: { attributes: [] } }] });
  const load = {};
  open.forEach((t) => t.assignees.forEach((a) => { load[a.id] = load[a.id] || { user: a, open: 0 }; load[a.id].open += 1; }));
  const taskIds = (await Task.findAll({ where: { projectId: p.id }, attributes: ['id'], raw: true })).map((t) => t.id);
  const minutes = taskIds.length ? await TimeLog.sum('minutes', { where: { taskId: taskIds } }) : 0;
  const milestoneTasks = await Task.findAll({ where: { projectId: p.id, milestoneId: { [Op.ne]: null } }, attributes: ['milestoneId', 'status', 'id', 'parentId'], raw: true });
  summary.Milestones = summary.Milestones.map((m) => {
    const mt = milestoneTasks.filter((t) => t.milestoneId === m.id);
    return { ...m, taskCount: mt.length, progress: m.done ? 100 : projectProgress(mt) };
  });
  const recent = await Activity.findAll({ where: { projectId: p.id }, order: [['createdAt', 'DESC']], limit: 30,
    include: [{ model: User, as: 'actor', attributes: ['id', 'name', 'color'] }] });
  res.json({ ...summary, workload: Object.values(load), minutesLogged: minutes || 0, activity: recent,
    canManage: req.can('projects.manage') || p.ownerId === req.user.id });
}));

async function setMembers(project, memberIds, ownerId) {
  const ids = [...new Set([...(memberIds || []).map(Number), ownerId].filter(Boolean))];
  await project.setMembers(ids);
  if (ownerId) await ProjectMember.update({ role: 'lead' }, { where: { projectId: project.id, userId: ownerId } });
  return ids;
}

router.post('/', requirePerm('projects.manage'), wrap(async (req, res) => {
  const b = req.body;
  if (!b.name) return res.status(400).json({ error: 'Give the project a name.' });
  const code = String(b.code || b.name).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5) || 'PRJ';
  if (await Project.findOne({ where: { code } })) return res.status(400).json({ error: `The code ${code} is already used by another project.` });
  const p = await Project.create({
    name: b.name, code, description: b.description, clientId: b.clientId || null, ownerId: b.ownerId || req.user.id,
    status: b.status || 'active', priority: b.priority || 'medium', startDate: b.startDate || null, dueDate: b.dueDate || null,
    color: b.color || '#3DE0F2', clientVisible: b.clientVisible !== false,
  });
  const members = await setMembers(p, b.memberIds, p.ownerId);
  if (Array.isArray(b.milestones)) {
    await Milestone.bulkCreate(b.milestones.filter((m) => m.title).map((m, i) => ({ ...m, projectId: p.id, order: i })));
  }
  await notify({ userIds: members, type: 'task_assigned', exclude: req.user.id, title: `You were added to ${p.name}`,
    body: `Project lead: ${(await User.findByPk(p.ownerId))?.name || req.user.name}`, link: `/projects/${p.id}` });
  await activity({ actorId: req.user.id, action: 'project.created', summary: `created project ${p.name}`, projectId: p.id, clientVisible: true });
  socket.toStaff('project:changed', { id: p.id });
  res.status(201).json(p);
}));

router.patch('/:id', wrap(async (req, res) => {
  const p = await Project.findByPk(req.params.id);
  if (!p) return res.status(404).json({ error: 'Project not found.' });
  if (!req.can('projects.manage') && p.ownerId !== req.user.id) return res.status(403).json({ error: "You can't edit this project." });
  const b = req.body;
  const prevStatus = p.status;
  ['name', 'description', 'clientId', 'ownerId', 'status', 'priority', 'startDate', 'dueDate', 'color', 'clientVisible'].forEach((k) => {
    if (b[k] !== undefined) p[k] = b[k] === '' ? null : b[k];
  });
  await p.save();
  if (b.memberIds) {
    const before = (await ProjectMember.findAll({ where: { projectId: p.id }, raw: true })).map((m) => m.userId);
    const after = await setMembers(p, b.memberIds, p.ownerId);
    const added = after.filter((id) => !before.includes(id));
    await notify({ userIds: added, type: 'task_assigned', exclude: req.user.id, title: `You were added to ${p.name}`, body: '', link: `/projects/${p.id}` });
  }
  if (b.status && b.status !== prevStatus) {
    await activity({ actorId: req.user.id, action: 'project.status', summary: `marked ${p.name} as ${b.status.replace('_', ' ')}`, projectId: p.id, clientVisible: true });
    if (p.clientId) socket.toClient(p.clientId, 'project:changed', { id: p.id });
  }
  socket.toStaff('project:changed', { id: p.id });
  res.json(p);
}));

router.post('/:id/milestones', wrap(async (req, res) => {
  const p = await Project.findByPk(req.params.id);
  if (!p || (!req.can('projects.manage') && p.ownerId !== req.user.id)) return res.status(403).json({ error: "You can't edit this project." });
  const n = await Milestone.count({ where: { projectId: p.id } });
  const m = await Milestone.create({ projectId: p.id, title: req.body.title, dueDate: req.body.dueDate || null, order: n });
  res.status(201).json(m);
}));

router.patch('/milestones/:mid', wrap(async (req, res) => {
  const m = await Milestone.findByPk(req.params.mid, { include: [Project] });
  if (!m || (!req.can('projects.manage') && m.Project.ownerId !== req.user.id)) return res.status(403).json({ error: "You can't edit this milestone." });
  const wasDone = m.done;
  ['title', 'dueDate', 'done', 'order'].forEach((k) => { if (req.body[k] !== undefined) m[k] = req.body[k]; });
  await m.save();
  if (!wasDone && m.done) {
    await activity({ actorId: req.user.id, action: 'milestone.done', summary: `reached milestone "${m.title}" in ${m.Project.name}`, projectId: m.projectId, clientVisible: true });
    const portal = m.Project.clientId ? await User.findAll({ where: { clientId: m.Project.clientId, isActive: true }, attributes: ['id'] }) : [];
    await notify({ userIds: portal.map((u) => u.id), type: 'client_update', title: `Milestone reached: ${m.title}`, body: m.Project.name, link: `/portal/projects/${m.projectId}` });
  }
  res.json(m);
}));

router.delete('/milestones/:mid', wrap(async (req, res) => {
  const m = await Milestone.findByPk(req.params.mid, { include: [Project] });
  if (!m || (!req.can('projects.manage') && m.Project.ownerId !== req.user.id)) return res.status(403).json({ error: "You can't edit this milestone." });
  await Task.update({ milestoneId: null }, { where: { milestoneId: m.id } });
  await m.destroy();
  res.json({ ok: true });
}));

module.exports = router;
