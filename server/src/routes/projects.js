const router = require('express').Router();
const { Op } = require('sequelize');
const {
  Project, Client, User, Task, Milestone, ProjectMember, Activity, TimeLog, Section, Sprint, Template, Document, TaskDependency,
} = require('../models');
const { requirePerm, staffOnly } = require('../middleware/auth');
const { visibleProjectIds } = require('../services/access');
const { projectProgress } = require('../services/progress');
const { notify, activity } = require('../services/notify');
const { computeHealth } = require('../services/health');
const { applyStructure } = require('../services/structure');
const socket = require('../services/socket');

router.use(staffOnly);

const memberAttrs = ['id', 'name', 'color', 'designation'];
const wrap = (f) => (req, res) => f(req, res).catch((e) => {
  if (!e.status) console.error(e);
  res.status(e.status || 500).json({ error: e.message });
});
const DAY = 864e5;
const dayKey = (d) => new Date(d).toISOString().slice(0, 10);

async function canManage(req, projectOrId) {
  const p = typeof projectOrId === 'object' ? projectOrId : await Project.findByPk(projectOrId, { attributes: ['id', 'ownerId'] });
  if (!p) return false;
  return req.can('projects.manage') || p.ownerId === req.user.id;
}

async function ensureVisible(req, id) {
  const ids = await visibleProjectIds(req);
  if (ids && !ids.includes(Number(id))) { const e = new Error('Project not found or not shared with you.'); e.status = 404; throw e; }
}

async function summarize(projects) {
  const ids = projects.map((p) => p.id);
  const tasks = ids.length ? await Task.findAll({ where: { projectId: ids, archived: false }, attributes: ['id', 'projectId', 'parentId', 'status', 'dueDate'], raw: true }) : [];
  const health = ids.length ? await computeHealth({ projectIds: ids }) : { projects: [] };
  const now = new Date();
  return projects.map((p) => {
    const own = tasks.filter((t) => t.projectId === p.id);
    const counts = { backlog: 0, todo: 0, in_progress: 0, review: 0, blocked: 0, done: 0 };
    own.forEach((t) => { counts[t.status] = (counts[t.status] || 0) + 1; });
    const h = health.projects.find((x) => x.id === p.id);
    return {
      ...(p.toJSON ? p.toJSON() : p),
      progress: projectProgress(own), taskCount: own.length, counts,
      overdue: own.filter((t) => t.status !== 'done' && t.dueDate && new Date(t.dueDate) < now).length,
      health: h ? { score: h.score, state: h.state, expected: h.expected } : { score: 100, state: p.status === 'completed' ? 'done' : 'on_track' },
      daysLeft: p.dueDate ? Math.ceil((new Date(p.dueDate) - now) / DAY) : null,
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
  await ensureVisible(req, req.params.id);
  const p = await Project.findByPk(req.params.id, {
    include: [Client, { model: User, as: 'owner', attributes: memberAttrs },
      { model: User, as: 'members', attributes: memberAttrs, through: { attributes: ['role'] } },
      { model: Milestone }, { model: Section }],
    order: [[Milestone, 'order', 'ASC'], [Milestone, 'dueDate', 'ASC'], [Section, 'order', 'ASC']],
  });
  if (!p) return res.status(404).json({ error: 'Project not found.' });
  const [summary] = await summarize([p]);
  const tasks = await Task.findAll({ where: { projectId: p.id, archived: false }, attributes: ['id', 'parentId', 'status', 'dueDate', 'createdAt', 'completedAt', 'milestoneId', 'priority', 'estimateHours'], raw: true });

  // Workload inside this project
  const open = await Task.findAll({ where: { projectId: p.id, status: { [Op.ne]: 'done' }, archived: false }, attributes: ['id', 'dueDate', 'estimateHours'],
    include: [{ model: User, as: 'assignees', attributes: ['id', 'name', 'color'], through: { attributes: [] } }] });
  const load = {};
  open.forEach((t) => t.assignees.forEach((a) => {
    load[a.id] = load[a.id] || { user: a, open: 0, overdue: 0, hours: 0 };
    load[a.id].open += 1; load[a.id].hours += t.estimateHours || 0;
    if (t.dueDate && new Date(t.dueDate) < new Date()) load[a.id].overdue += 1;
  }));
  const minutes = tasks.length ? await TimeLog.sum('minutes', { where: { taskId: tasks.map((t) => t.id) } }) : 0;
  summary.Milestones = summary.Milestones.map((m) => {
    const mt = tasks.filter((t) => t.milestoneId === m.id);
    return { ...m, taskCount: mt.length, progress: m.done ? 100 : projectProgress(mt) };
  });

  // Burndown: open tasks at end of each day across the last 21 days (or since start)
  const startDay = new Date(Math.max(new Date(p.startDate || p.createdAt).getTime(), Date.now() - 20 * DAY));
  const days = [];
  for (let d = new Date(startDay); d <= new Date(); d = new Date(d.getTime() + DAY)) days.push(dayKey(d));
  const burndown = days.map((day) => {
    const end = new Date(`${day}T23:59:59`);
    return {
      day,
      remaining: tasks.filter((t) => new Date(t.createdAt) <= end && (!t.completedAt || new Date(t.completedAt) > end)).length,
      done: tasks.filter((t) => t.completedAt && dayKey(t.completedAt) === day).length,
    };
  });
  const first = Math.max(tasks.length, ...burndown.map((b) => b.remaining), 0);
  const span = p.dueDate ? Math.max(1, Math.ceil((new Date(p.dueDate) - startDay) / DAY)) : burndown.length;
  burndown.forEach((b, i) => { b.ideal = Math.max(0, Math.round(first - (first / span) * i)); });

  const recent = await Activity.findAll({ where: { projectId: p.id }, order: [['createdAt', 'DESC']], limit: 40,
    include: [{ model: User, as: 'actor', attributes: ['id', 'name', 'color'] }] });
  const health = await computeHealth({ projectIds: [p.id] });
  const activeSprint = await Sprint.findOne({ where: { projectId: p.id, status: 'active' } });
  const docCount = await Document.count({ where: { projectId: p.id } });
  res.json({
    ...summary, workload: Object.values(load), minutesLogged: minutes || 0, activity: recent, burndown,
    alerts: health.alerts, activeSprint, docCount,
    priorities: ['urgent', 'high', 'medium', 'low'].map((k) => ({ priority: k, count: tasks.filter((t) => t.priority === k && t.status !== 'done').length })),
    canManage: await canManage(req, p),
  });
}));

async function setMembers(project, memberIds, ownerId) {
  const ids = [...new Set([...(memberIds || []).map(Number), ownerId].filter(Boolean))];
  await project.setMembers(ids);
  if (ownerId) await ProjectMember.update({ role: 'lead' }, { where: { projectId: project.id, userId: ownerId } });
  return ids;
}

async function uniqueCode(raw) {
  const base = String(raw || 'PRJ').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5) || 'PRJ';
  let code = base; let i = 2;
  while (await Project.findOne({ where: { code } })) code = `${base.slice(0, 4)}${i++}`;
  return code;
}

router.post('/', requirePerm('projects.manage'), wrap(async (req, res) => {
  const b = req.body;
  if (!b.name) return res.status(400).json({ error: 'Give the project a name.' });
  if (b.code) {
    const code = String(b.code).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
    if (await Project.findOne({ where: { code } })) return res.status(400).json({ error: `The code ${code} is already used by another project.` });
  }
  const code = await uniqueCode(b.code || b.name);
  const p = await Project.create({
    name: b.name, code, description: b.description, clientId: b.clientId || null, ownerId: b.ownerId || req.user.id,
    status: b.status || 'active', priority: b.priority || 'medium', startDate: b.startDate || dayKey(new Date()), dueDate: b.dueDate || null,
    color: b.color || '#3D5AFE', icon: b.icon || null, clientVisible: b.clientVisible !== false,
    budget: Number(b.budget) || 0, spent: Number(b.spent) || 0, currency: b.currency || 'INR',
  });
  const members = await setMembers(p, b.memberIds, p.ownerId);
  if (Array.isArray(b.milestones)) {
    await Milestone.bulkCreate(b.milestones.filter((m) => m.title).map((m, i) => ({ title: m.title, dueDate: m.dueDate || null, projectId: p.id, order: i })));
  }
  let applied = null;
  if (b.templateId) {
    const tpl = await Template.findByPk(b.templateId);
    if (tpl) { applied = await applyStructure(p, tpl.structure, req.user.id, { startDate: p.startDate, clientVisible: !!p.clientId }); tpl.uses += 1; await tpl.save(); }
  } else if (b.plan) {
    applied = await applyStructure(p, b.plan, req.user.id, { startDate: p.startDate, clientVisible: !!p.clientId });
  }
  await notify({ userIds: members, type: 'task_assigned', exclude: req.user.id, title: `You were added to ${p.name}`,
    body: `Project lead: ${(await User.findByPk(p.ownerId))?.name || req.user.name}`, link: `/projects/${p.id}` });
  await activity({ actorId: req.user.id, action: 'project.created', summary: `created project ${p.name}${applied ? ` with ${applied.created} tasks` : ''}`, projectId: p.id, clientVisible: true });
  socket.toStaff('project:changed', { id: p.id });
  res.status(201).json({ ...p.toJSON(), applied });
}));

router.patch('/:id', wrap(async (req, res) => {
  const p = await Project.findByPk(req.params.id);
  if (!p) return res.status(404).json({ error: 'Project not found.' });
  if (!(await canManage(req, p))) return res.status(403).json({ error: "You can't edit this project." });
  const b = req.body;
  const prevStatus = p.status;
  ['name', 'description', 'clientId', 'ownerId', 'status', 'priority', 'startDate', 'dueDate', 'color', 'icon', 'clientVisible',
    'budget', 'spent', 'currency', 'healthOverride'].forEach((k) => {
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

// Apply a template or an AI plan into an existing project
router.post('/:id/apply', wrap(async (req, res) => {
  const p = await Project.findByPk(req.params.id);
  if (!p || !(await canManage(req, p))) return res.status(403).json({ error: "You can't edit this project." });
  let structure = req.body.plan;
  if (req.body.templateId) {
    const tpl = await Template.findByPk(req.body.templateId);
    if (!tpl) return res.status(404).json({ error: 'Template not found.' });
    structure = tpl.structure; tpl.uses += 1; await tpl.save();
  }
  if (!structure) return res.status(400).json({ error: 'Nothing to add.' });
  const applied = await applyStructure(p, structure, req.user.id, { startDate: req.body.startDate || new Date(), clientVisible: !!p.clientId });
  await activity({ actorId: req.user.id, action: 'project.plan', summary: `added ${applied.created} tasks to ${p.name}`, projectId: p.id });
  socket.toStaff('project:changed', { id: p.id });
  socket.toStaff('task:changed', { projectId: p.id, kind: 'created' });
  res.json(applied);
}));

// ---------- milestones ----------
router.post('/:id/milestones', wrap(async (req, res) => {
  if (!(await canManage(req, req.params.id))) return res.status(403).json({ error: "You can't edit this project." });
  const n = await Milestone.count({ where: { projectId: req.params.id } });
  const m = await Milestone.create({ projectId: req.params.id, title: req.body.title, dueDate: req.body.dueDate || null, order: n });
  res.status(201).json(m);
}));

router.patch('/milestones/:mid', wrap(async (req, res) => {
  const m = await Milestone.findByPk(req.params.mid, { include: [Project] });
  if (!m || !(await canManage(req, m.Project))) return res.status(403).json({ error: "You can't edit this milestone." });
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
  if (!m || !(await canManage(req, m.Project))) return res.status(403).json({ error: "You can't edit this milestone." });
  await Task.update({ milestoneId: null }, { where: { milestoneId: m.id } });
  await m.destroy();
  res.json({ ok: true });
}));

// ---------- sections (board columns / groups) ----------
router.post('/:id/sections', wrap(async (req, res) => {
  await ensureVisible(req, req.params.id);
  if (!req.can('tasks.create')) return res.status(403).json({ error: "Your role can't change the board." });
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Name the section.' });
  const n = await Section.count({ where: { projectId: req.params.id } });
  const s = await Section.create({ projectId: req.params.id, name, color: req.body.color || '#5E6787', order: n });
  socket.toStaff('project:changed', { id: Number(req.params.id) });
  res.status(201).json(s);
}));

router.patch('/sections/:sid', wrap(async (req, res) => {
  const s = await Section.findByPk(req.params.sid);
  if (!s) return res.status(404).json({ error: 'Section not found.' });
  await ensureVisible(req, s.projectId);
  ['name', 'color', 'order'].forEach((k) => { if (req.body[k] !== undefined) s[k] = req.body[k]; });
  await s.save();
  socket.toStaff('project:changed', { id: s.projectId });
  res.json(s);
}));

router.post('/:id/sections/reorder', wrap(async (req, res) => {
  await ensureVisible(req, req.params.id);
  const ids = (req.body.ids || []).map(Number);
  for (let i = 0; i < ids.length; i += 1) await Section.update({ order: i }, { where: { id: ids[i], projectId: req.params.id } });
  socket.toStaff('project:changed', { id: Number(req.params.id) });
  res.json({ ok: true });
}));

router.delete('/sections/:sid', wrap(async (req, res) => {
  const s = await Section.findByPk(req.params.sid);
  if (!s) return res.status(404).json({ error: 'Section not found.' });
  if (!(await canManage(req, s.projectId))) return res.status(403).json({ error: 'Only the project lead can delete sections.' });
  await Task.update({ sectionId: null }, { where: { sectionId: s.id } });
  await s.destroy();
  socket.toStaff('project:changed', { id: s.projectId });
  res.json({ ok: true });
}));

// ---------- sprints ----------
async function sprintStats(sprintIds) {
  const tasks = await Task.findAll({ where: { sprintId: sprintIds, archived: false }, attributes: ['id', 'sprintId', 'status', 'storyPoints', 'completedAt', 'dueDate'], raw: true });
  const out = {};
  sprintIds.forEach((id) => {
    const own = tasks.filter((t) => t.sprintId === id);
    const pts = (ts) => ts.reduce((s, t) => s + (t.storyPoints || 0), 0);
    out[id] = { tasks: own.length, done: own.filter((t) => t.status === 'done').length, points: pts(own), pointsDone: pts(own.filter((t) => t.status === 'done')) };
  });
  return { out, tasks };
}

router.get('/:id/sprints', wrap(async (req, res) => {
  await ensureVisible(req, req.params.id);
  const sprints = await Sprint.findAll({ where: { projectId: req.params.id }, order: [['startDate', 'ASC'], ['id', 'ASC']] });
  const { out } = await sprintStats(sprints.map((s) => s.id));
  res.json(sprints.map((s) => ({ ...s.toJSON(), stats: out[s.id] })));
}));

router.post('/:id/sprints', wrap(async (req, res) => {
  await ensureVisible(req, req.params.id);
  if (!req.can('tasks.create')) return res.status(403).json({ error: "Your role can't plan sprints." });
  const n = await Sprint.count({ where: { projectId: req.params.id } });
  const start = req.body.startDate || dayKey(new Date());
  const end = req.body.endDate || dayKey(new Date(new Date(start).getTime() + 13 * DAY));
  const s = await Sprint.create({ projectId: req.params.id, name: req.body.name || `Sprint ${n + 1}`, goal: req.body.goal || '', startDate: start, endDate: end });
  await activity({ actorId: req.user.id, action: 'sprint.created', summary: `planned ${s.name}`, projectId: s.projectId });
  socket.toStaff('project:changed', { id: s.projectId });
  res.status(201).json(s);
}));

router.patch('/sprints/:sid', wrap(async (req, res) => {
  const s = await Sprint.findByPk(req.params.sid);
  if (!s) return res.status(404).json({ error: 'Sprint not found.' });
  await ensureVisible(req, s.projectId);
  ['name', 'goal', 'startDate', 'endDate'].forEach((k) => { if (req.body[k] !== undefined) s[k] = req.body[k]; });
  await s.save();
  socket.toStaff('project:changed', { id: s.projectId });
  res.json(s);
}));

router.post('/sprints/:sid/start', wrap(async (req, res) => {
  const s = await Sprint.findByPk(req.params.sid);
  if (!s) return res.status(404).json({ error: 'Sprint not found.' });
  if (!(await canManage(req, s.projectId)) && !req.can('tasks.approve')) return res.status(403).json({ error: 'Only the project lead can start a sprint.' });
  const active = await Sprint.findOne({ where: { projectId: s.projectId, status: 'active' } });
  if (active && active.id !== s.id) return res.status(400).json({ error: `${active.name} is still running. Complete it first.` });
  s.status = 'active'; if (!s.startDate) s.startDate = dayKey(new Date()); await s.save();
  const ids = (await Task.findAll({ where: { sprintId: s.id }, attributes: ['id'], include: [{ model: User, as: 'assignees', attributes: ['id'], through: { attributes: [] } }] }))
    .flatMap((t) => t.assignees.map((a) => a.id));
  await notify({ userIds: [...new Set(ids)], type: 'task_status', exclude: req.user.id, title: `${s.name} has started`, body: s.goal || `Ends ${new Date(s.endDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`, link: `/projects/${s.projectId}?view=sprints` });
  await activity({ actorId: req.user.id, action: 'sprint.started', summary: `started ${s.name}`, projectId: s.projectId });
  socket.toStaff('project:changed', { id: s.projectId });
  res.json(s);
}));

router.post('/sprints/:sid/complete', wrap(async (req, res) => {
  const s = await Sprint.findByPk(req.params.sid);
  if (!s) return res.status(404).json({ error: 'Sprint not found.' });
  if (!(await canManage(req, s.projectId)) && !req.can('tasks.approve')) return res.status(403).json({ error: 'Only the project lead can complete a sprint.' });
  const { out } = await sprintStats([s.id]);
  const unfinished = await Task.findAll({ where: { sprintId: s.id, status: { [Op.ne]: 'done' } } });
  let moveTo = null;
  if (req.body.moveTo === 'next') {
    moveTo = await Sprint.findOne({ where: { projectId: s.projectId, status: 'planned', id: { [Op.ne]: s.id } }, order: [['startDate', 'ASC']] });
    if (!moveTo) moveTo = await Sprint.create({ projectId: s.projectId, name: `Sprint ${(await Sprint.count({ where: { projectId: s.projectId } })) + 1}`, startDate: dayKey(new Date()), endDate: dayKey(new Date(Date.now() + 13 * DAY)) });
  }
  await Task.update({ sprintId: moveTo ? moveTo.id : null }, { where: { id: unfinished.map((t) => t.id) } });
  s.status = 'completed'; s.completedAt = new Date(); s.snapshot = { ...out[s.id], carriedOver: unfinished.length }; await s.save();
  await activity({ actorId: req.user.id, action: 'sprint.completed', summary: `completed ${s.name}: ${out[s.id].done}/${out[s.id].tasks} tasks, ${out[s.id].pointsDone} points`, projectId: s.projectId });
  socket.toStaff('project:changed', { id: s.projectId });
  socket.toStaff('task:changed', { projectId: s.projectId, kind: 'updated' });
  res.json({ sprint: s, carriedOver: unfinished.length, movedTo: moveTo?.name || 'Backlog' });
}));

router.delete('/sprints/:sid', wrap(async (req, res) => {
  const s = await Sprint.findByPk(req.params.sid);
  if (!s) return res.status(404).json({ error: 'Sprint not found.' });
  if (!(await canManage(req, s.projectId))) return res.status(403).json({ error: 'Only the project lead can delete sprints.' });
  await Task.update({ sprintId: null }, { where: { sprintId: s.id } });
  await s.destroy();
  socket.toStaff('project:changed', { id: s.projectId });
  res.json({ ok: true });
}));

router.get('/sprints/:sid/burndown', wrap(async (req, res) => {
  const s = await Sprint.findByPk(req.params.sid);
  if (!s) return res.status(404).json({ error: 'Sprint not found.' });
  await ensureVisible(req, s.projectId);
  const { tasks } = await sprintStats([s.id]);
  const total = tasks.reduce((n, t) => n + (t.storyPoints || 1), 0);
  const start = new Date(s.startDate); const end = new Date(s.endDate);
  const span = Math.max(1, Math.round((end - start) / DAY));
  const out = [];
  for (let i = 0; i <= span; i += 1) {
    const d = new Date(start.getTime() + i * DAY);
    const eod = new Date(`${dayKey(d)}T23:59:59`);
    const done = tasks.filter((t) => t.completedAt && new Date(t.completedAt) <= eod).reduce((n, t) => n + (t.storyPoints || 1), 0);
    out.push({ day: dayKey(d), ideal: Math.round(total - (total / span) * i), remaining: d <= new Date() ? total - done : null });
  }
  res.json({ total, points: out });
}));

// ---------- timeline (Gantt) ----------
router.get('/:id/timeline', wrap(async (req, res) => {
  await ensureVisible(req, req.params.id);
  const tasks = await Task.findAll({
    where: { projectId: req.params.id, archived: false, [Op.or]: [{ dueDate: { [Op.ne]: null } }, { startDate: { [Op.ne]: null } }] },
    attributes: ['id', 'key', 'title', 'status', 'priority', 'startDate', 'dueDate', 'parentId', 'depth', 'sectionId', 'createdAt', 'position'],
    include: [{ model: User, as: 'assignees', attributes: ['id', 'name', 'color'], through: { attributes: [] } }],
    order: [['position', 'ASC']],
  });
  const ids = tasks.map((t) => t.id);
  const deps = ids.length ? await TaskDependency.findAll({ where: { taskId: ids }, raw: true }) : [];
  const milestones = await Milestone.findAll({ where: { projectId: req.params.id }, order: [['dueDate', 'ASC']] });
  res.json({ tasks, dependencies: deps.map((d) => ({ taskId: d.taskId, blockerId: d.blockerId })), milestones });
}));

module.exports = router;
