// Client portal API — everything here is scoped to the signed-in client's own projects
// and only to tasks/comments/files the team has marked as visible to the client.
const router = require('express').Router();
const { Op } = require('sequelize');
const { Project, Task, Milestone, Activity, User, Role, Comment, Attachment, ClientRequest, Client } = require('../models');
const { clientOnly } = require('../middleware/auth');
const { projectProgress, taskProgressMap } = require('../services/progress');
const { notify, activity } = require('../services/notify');
const socket = require('../services/socket');

router.use(clientOnly);
const wrap = (f) => (req, res) => f(req, res).catch((e) => res.status(e.status || 500).json({ error: e.message }));

const projectWhere = (req) => ({ clientId: req.user.clientId, clientVisible: true, status: { [Op.ne]: 'archived' } });
const teamAttrs = ['id', 'name', 'color', 'designation'];

/** Safe shape of a task for clients. */
const clean = (t, progress) => ({
  id: t.id, key: t.key, title: t.title, description: t.description, status: t.status, priority: t.priority,
  dueDate: t.dueDate, startDate: t.startDate, completedAt: t.completedAt, parentId: t.parentId, depth: t.depth,
  milestoneId: t.milestoneId, requiresApproval: t.requiresApproval, progress: progress?.get(t.id) ?? 0,
  assignees: (t.assignees || []).map((a) => ({ id: a.id, name: a.name, color: a.color })), updatedAt: t.updatedAt,
});

router.get('/overview', wrap(async (req, res) => {
  const client = await Client.findByPk(req.user.clientId);
  const projects = await Project.findAll({ where: projectWhere(req), order: [['updatedAt', 'DESC']],
    include: [{ model: User, as: 'owner', attributes: teamAttrs }, { model: Milestone }] });
  const ids = projects.map((p) => p.id);
  const all = await Task.findAll({ where: { projectId: ids }, attributes: ['id', 'projectId', 'parentId', 'status'], raw: true });
  const visible = await Task.findAll({ where: { projectId: ids, clientVisible: true },
    include: [{ model: User, as: 'assignees', attributes: teamAttrs, through: { attributes: [] } }, { model: Project, attributes: ['id', 'name', 'color'] }],
    order: [['updatedAt', 'DESC']] });
  const pm = taskProgressMap(all);
  const awaiting = visible.filter((t) => t.status === 'review');
  const upcoming = visible.filter((t) => t.status !== 'done' && t.dueDate).sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate)).slice(0, 6);
  const feed = await Activity.findAll({ where: { projectId: ids, clientVisible: true }, order: [['createdAt', 'DESC']], limit: 20,
    include: [{ model: User, as: 'actor', attributes: ['id', 'name', 'color'] }, { model: Project, attributes: ['id', 'name', 'color'] }] });
  res.json({
    client,
    projects: projects.map((p) => {
      const own = all.filter((t) => t.projectId === p.id);
      return { id: p.id, name: p.name, code: p.code, color: p.color, status: p.status, description: p.description,
        startDate: p.startDate, dueDate: p.dueDate, owner: p.owner, progress: projectProgress(own),
        milestones: p.Milestones.sort((a, b) => a.order - b.order),
        visibleTasks: visible.filter((t) => t.projectId === p.id).length,
        doneTasks: visible.filter((t) => t.projectId === p.id && t.status === 'done').length };
    }),
    awaitingReview: awaiting.map((t) => ({ ...clean(t, pm), project: t.Project })),
    upcoming: upcoming.map((t) => ({ ...clean(t, pm), project: t.Project })),
    activity: feed,
    openRequests: await ClientRequest.count({ where: { clientId: req.user.clientId, status: 'open' } }),
  });
}));

router.get('/projects/:id', wrap(async (req, res) => {
  const p = await Project.findOne({ where: { ...projectWhere(req), id: req.params.id },
    include: [{ model: User, as: 'owner', attributes: teamAttrs }, { model: User, as: 'members', attributes: teamAttrs, through: { attributes: [] } }, { model: Milestone }] });
  if (!p) return res.status(404).json({ error: 'Project not found.' });
  const all = await Task.findAll({ where: { projectId: p.id }, attributes: ['id', 'parentId', 'status', 'milestoneId'], raw: true });
  const pm = taskProgressMap(all);
  const tasks = await Task.findAll({ where: { projectId: p.id, clientVisible: true },
    include: [{ model: User, as: 'assignees', attributes: teamAttrs, through: { attributes: [] } }], order: [['position', 'ASC']] });
  const files = await Attachment.findAll({ where: { taskId: tasks.map((t) => t.id), clientVisible: true }, order: [['createdAt', 'DESC']],
    include: [{ model: User, as: 'uploader', attributes: ['id', 'name'] }] });
  const feed = await Activity.findAll({ where: { projectId: p.id, clientVisible: true }, order: [['createdAt', 'DESC']], limit: 40,
    include: [{ model: User, as: 'actor', attributes: ['id', 'name', 'color'] }] });
  res.json({
    id: p.id, name: p.name, code: p.code, color: p.color, status: p.status, description: p.description, startDate: p.startDate, dueDate: p.dueDate,
    owner: p.owner, team: p.members, progress: projectProgress(all),
    milestones: p.Milestones.sort((a, b) => a.order - b.order).map((m) => {
      const mt = all.filter((t) => t.milestoneId === m.id);
      return { ...m.toJSON(), progress: m.done ? 100 : projectProgress(mt) };
    }),
    tasks: tasks.map((t) => clean(t, pm)),
    files: files.map((f) => ({ id: f.id, name: f.originalName, size: f.size, mime: f.mime, createdAt: f.createdAt, taskId: f.taskId, by: f.uploader?.name })),
    activity: feed,
  });
}));

async function visibleTask(req, id) {
  const t = await Task.findByPk(id, { include: [{ model: Project }, { model: User, as: 'assignees', attributes: teamAttrs, through: { attributes: [] } }] });
  if (!t || !t.clientVisible || t.Project?.clientId !== req.user.clientId || !t.Project.clientVisible) return null;
  return t;
}

router.get('/tasks/:id', wrap(async (req, res) => {
  const t = await visibleTask(req, req.params.id);
  if (!t) return res.status(404).json({ error: 'Task not found.' });
  const all = await Task.findAll({ where: { projectId: t.projectId }, attributes: ['id', 'parentId', 'status'], raw: true });
  const pm = taskProgressMap(all);
  const subs = await Task.findAll({ where: { parentId: t.id, clientVisible: true }, include: [{ model: User, as: 'assignees', attributes: teamAttrs, through: { attributes: [] } }] });
  const comments = await Comment.findAll({ where: { taskId: t.id, internal: false }, order: [['createdAt', 'ASC']],
    include: [{ model: User, as: 'author', attributes: teamAttrs, include: [{ model: Role, attributes: ['isClientRole'] }] }] });
  const files = await Attachment.findAll({ where: { taskId: t.id, clientVisible: true } });
  res.json({ ...clean(t, pm), project: { id: t.Project.id, name: t.Project.name, color: t.Project.color },
    subtasks: subs.map((s) => clean(s, pm)), comments,
    files: files.map((f) => ({ id: f.id, name: f.originalName, size: f.size, mime: f.mime, createdAt: f.createdAt })) });
}));

router.post('/tasks/:id/comments', wrap(async (req, res) => {
  const t = await visibleTask(req, req.params.id);
  if (!t) return res.status(404).json({ error: 'Task not found.' });
  const body = String(req.body.body || '').trim();
  if (!body) return res.status(400).json({ error: 'Write a message first.' });
  const c = await Comment.create({ taskId: t.id, userId: req.user.id, body, internal: false });
  await notify({ userIds: [...t.assignees.map((a) => a.id), t.createdById, t.Project.ownerId], type: 'task_comment',
    title: `Client message on ${t.key}`, body: `${req.user.name}: ${body.slice(0, 200)}`, link: `/tasks/${t.id}` });
  await activity({ actorId: req.user.id, action: 'client.comment', summary: `left a message on ${t.key}`, taskId: t.id, projectId: t.projectId, clientVisible: true });
  socket.toStaff('task:changed', { id: t.id, projectId: t.projectId });
  res.status(201).json(await Comment.findByPk(c.id, { include: [{ model: User, as: 'author', attributes: teamAttrs, include: [{ model: Role, attributes: ['isClientRole'] }] }] }));
}));

// Client signs off a deliverable (task in review) or asks for changes.
router.post('/tasks/:id/review', wrap(async (req, res) => {
  const t = await visibleTask(req, req.params.id);
  if (!t) return res.status(404).json({ error: 'Task not found.' });
  if (t.status !== 'review') return res.status(400).json({ error: 'This task is not waiting for your review.' });
  const approve = req.body.decision === 'approve';
  t.status = approve ? 'done' : 'in_progress';
  t.approvalStatus = approve ? 'approved' : 'changes_requested';
  t.completedAt = approve ? new Date() : null;
  await t.save();
  const note = String(req.body.note || '').trim();
  await Comment.create({ taskId: t.id, userId: req.user.id, internal: false,
    body: approve ? `Approved by client${note ? `: ${note}` : '.'}` : `Changes requested: ${note || 'see details'}` });
  await notify({ userIds: [...t.assignees.map((a) => a.id), t.createdById, t.Project.ownerId], type: 'approval_result',
    title: approve ? `Client approved ${t.key}` : `Client requested changes on ${t.key}`, body: note || t.title, link: `/tasks/${t.id}` });
  await activity({ actorId: req.user.id, action: approve ? 'client.approved' : 'client.changes',
    summary: approve ? `approved ${t.key} "${t.title}"` : `requested changes on ${t.key} "${t.title}"`, taskId: t.id, projectId: t.projectId, clientVisible: true });
  socket.toStaff('task:changed', { id: t.id, projectId: t.projectId });
  res.json({ ok: true, status: t.status });
}));

router.get('/requests', wrap(async (req, res) => {
  res.json(await ClientRequest.findAll({ where: { clientId: req.user.clientId }, order: [['createdAt', 'DESC']],
    include: [{ model: Project, attributes: ['id', 'name'] }, { model: Task, attributes: ['id', 'key', 'status'] }, { model: User, as: 'requester', attributes: ['id', 'name'] }] }));
}));

router.post('/requests', wrap(async (req, res) => {
  const { title, description, priority, projectId } = req.body;
  if (!title) return res.status(400).json({ error: 'Give your request a short title.' });
  let project = null;
  if (projectId) {
    project = await Project.findOne({ where: { ...projectWhere(req), id: projectId } });
    if (!project) return res.status(400).json({ error: 'Pick one of your projects.' });
  }
  const r = await ClientRequest.create({ title, description, priority: priority || 'medium', projectId: project?.id || null,
    clientId: req.user.clientId, userId: req.user.id });
  // Tell the project owner, or everyone who manages clients.
  let targets = project ? [project.ownerId] : [];
  if (!targets.length) {
    const roles = await Role.findAll();
    const ids = roles.filter((ro) => (ro.permissions || []).includes('clients.manage')).map((ro) => ro.id);
    targets = (await User.findAll({ where: { roleId: ids, isActive: true }, attributes: ['id'] })).map((u) => u.id);
  }
  const client = await Client.findByPk(req.user.clientId);
  await notify({ userIds: targets, type: 'client_request', title: `New request from ${client.name}`, body: title, link: '/requests' });
  await activity({ actorId: req.user.id, action: 'client.request', summary: `raised a request "${title}"`, projectId: project?.id, clientVisible: true });
  socket.toStaff('request:changed', { id: r.id });
  res.status(201).json(r);
}));

module.exports = router;
