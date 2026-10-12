const router = require('express').Router();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const { Op, fn, col } = require('sequelize');
const {
  sequelize, Task, Project, User, Role, TaskAssignee, ChecklistItem, Comment, Attachment, TimeLog, Activity, Milestone,
  Section, Sprint, TaskDependency, TaskWatcher,
} = require('../models');
const { staffOnly } = require('../middleware/auth');
const { taskScope, canSeeTask, canEditTask } = require('../services/access');
const { taskProgressMap } = require('../services/progress');
const { notify, activity } = require('../services/notify');
const { emit } = require('../services/events');
const { createTaskRecord, STATUS_LABEL, STATUSES, PRIORITIES } = require('../services/taskFactory');
const socket = require('../services/socket');

const UPLOAD_DIR = path.resolve(__dirname, '../..', process.env.UPLOAD_DIR || './uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: 25 * 1024 * 1024 },
});

const userAttrs = ['id', 'name', 'color', 'designation', 'email'];
const listIncludes = [
  { model: User, as: 'assignees', attributes: userAttrs, through: { attributes: [] } },
  { model: Project, attributes: ['id', 'name', 'code', 'color', 'icon', 'clientId', 'ownerId'] },
  { model: Section, attributes: ['id', 'name', 'color'] },
];
const short = (d) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

// ---------- helpers ----------

/** Adds subtask/comment/checklist/file counts, blockers and rolled-up progress to a list of tasks. */
async function decorate(tasks) {
  if (!tasks.length) return [];
  const ids = tasks.map((t) => t.id);
  const projectIds = [...new Set(tasks.map((t) => t.projectId).filter(Boolean))];
  const family = await Task.findAll({
    where: projectIds.length ? { [Op.or]: [{ projectId: projectIds }, { id: ids }] } : { id: ids },
    attributes: ['id', 'parentId', 'status'], raw: true,
  });
  const progress = taskProgressMap(family);
  const statusById = new Map(family.map((t) => [t.id, t.status]));
  const subCounts = {}; const subDone = {};
  family.forEach((t) => {
    if (!t.parentId) return;
    subCounts[t.parentId] = (subCounts[t.parentId] || 0) + 1;
    if (t.status === 'done') subDone[t.parentId] = (subDone[t.parentId] || 0) + 1;
  });
  const [comments, checks, files, deps] = await Promise.all([
    Comment.findAll({ where: { taskId: ids }, attributes: ['taskId', [fn('COUNT', col('id')), 'n']], group: ['taskId'], raw: true }),
    ChecklistItem.findAll({ where: { taskId: ids }, attributes: ['taskId', 'done'], raw: true }),
    Attachment.findAll({ where: { taskId: ids }, attributes: ['taskId', [fn('COUNT', col('id')), 'n']], group: ['taskId'], raw: true }),
    TaskDependency.findAll({ where: { taskId: ids }, raw: true }),
  ]);
  const blockerIds = [...new Set(deps.map((d) => d.blockerId).filter((id) => !statusById.has(id)))];
  if (blockerIds.length) (await Task.findAll({ where: { id: blockerIds }, attributes: ['id', 'status'], raw: true })).forEach((t) => statusById.set(t.id, t.status));
  const cMap = Object.fromEntries(comments.map((c) => [c.taskId, Number(c.n)]));
  const fMap = Object.fromEntries(files.map((c) => [c.taskId, Number(c.n)]));
  return tasks.map((t) => {
    const j = t.toJSON ? t.toJSON() : t;
    const ck = checks.filter((c) => c.taskId === j.id);
    const myDeps = deps.filter((d) => d.taskId === j.id);
    return {
      ...j,
      progress: progress.get(j.id) ?? 0,
      subtaskCount: subCounts[j.id] || 0,
      subtaskDone: subDone[j.id] || 0,
      commentCount: cMap[j.id] || 0,
      fileCount: fMap[j.id] || 0,
      checklistTotal: ck.length,
      checklistDone: ck.filter((c) => c.done).length,
      blockerCount: myDeps.length,
      openBlockers: myDeps.filter((d) => statusById.get(d.blockerId) !== 'done').length,
    };
  });
}

async function collectDescendants(rootId) {
  const all = await Task.findAll({ attributes: ['id', 'parentId'], raw: true });
  const out = []; const stack = [rootId];
  while (stack.length) {
    const id = stack.pop();
    all.filter((t) => t.parentId === id).forEach((t) => { out.push(t.id); stack.push(t.id); });
  }
  return out;
}

async function approversFor(task) {
  const ids = new Set([task.createdById]);
  if (task.projectId) {
    const p = await Project.findByPk(task.projectId, { attributes: ['ownerId'] });
    if (p?.ownerId) ids.add(p.ownerId);
  }
  const assignees = await task.getAssignees({ attributes: ['id', 'reportsToId'] });
  assignees.forEach((a) => a.reportsToId && ids.add(a.reportsToId));
  assignees.forEach((a) => ids.delete(a.id)); // nobody approves their own work
  return [...ids].filter(Boolean);
}

async function canApprove(req, task) {
  const assigneeIds = (await TaskAssignee.findAll({ where: { taskId: task.id }, raw: true })).map((a) => a.userId);
  if (assigneeIds.includes(req.user.id) && !req.can('tasks.edit_all')) return false;
  if (req.can('tasks.approve')) return true;
  if (task.createdById === req.user.id) return true;
  if (task.projectId) {
    const p = await Project.findByPk(task.projectId, { attributes: ['ownerId'] });
    if (p?.ownerId === req.user.id) return true;
  }
  return false;
}

async function watcherIds(taskId) {
  return (await TaskWatcher.findAll({ where: { taskId }, raw: true })).map((w) => w.userId);
}

async function notifyClientIfVisible(task, title, body) {
  if (!task.clientVisible || !task.projectId) return;
  const p = await Project.findByPk(task.projectId);
  if (!p?.clientId || !p.clientVisible) return;
  socket.toClient(p.clientId, 'task:changed', { id: task.id, projectId: task.projectId });
  const portalUsers = await User.findAll({ where: { clientId: p.clientId, isActive: true }, attributes: ['id'] });
  await notify({ userIds: portalUsers.map((u) => u.id), type: 'client_update', title, body, link: `/portal/projects/${p.id}` });
}

const broadcast = (task, kind = 'updated') => socket.toStaff('task:changed', { id: task.id, projectId: task.projectId, parentId: task.parentId, kind });
const actorOf = (req) => ({ id: req.user.id, name: req.user.name });

/** Create + notify. Shared by the API, client requests, AI actions and templates. */
async function createTask(req, data, { silent = false } = {}) {
  let assigneeIds = (data.assigneeIds || []).map(Number).filter(Boolean);
  if (assigneeIds.some((id) => id !== req.user.id) && !req.can('tasks.assign')) assigneeIds = assigneeIds.filter((id) => id === req.user.id);
  const task = await createTaskRecord({ ...data, assigneeIds }, req.user.id);
  await TaskWatcher.findOrCreate({ where: { taskId: task.id, userId: req.user.id } });
  await activity({ actorId: req.user.id, action: 'task.created', summary: `created ${task.parentId ? 'subtask' : 'task'} ${task.key} "${task.title}"`,
    taskId: task.id, projectId: task.projectId, clientVisible: task.clientVisible });
  if (assigneeIds.length && !silent) {
    await notify({ userIds: assigneeIds, type: 'task_assigned', exclude: req.user.id,
      title: `${req.user.name} assigned you ${task.key}`,
      body: `${task.title}${task.dueDate ? `, due ${short(task.dueDate)}` : ''}`,
      link: `/tasks/${task.id}` });
  }
  emit('task.created', { task, actor: actorOf(req) });
  if (assigneeIds.length) emit('task.assigned', { task, added: assigneeIds, actor: actorOf(req) });
  broadcast(task, 'created');
  return task;
}

/** Apply a status change with approval gate, timestamps, notifications and events. Returns a notice or null. */
async function applyStatus(req, task, wanted, { notifyPeople = true } = {}) {
  if (!STATUSES.includes(wanted) || wanted === task.status) return { changed: false, notice: null };
  const from = task.status;
  let next = wanted;
  let notice = null;
  if (next === 'done' && task.requiresApproval && task.approvalStatus !== 'approved' && !(await canApprove(req, task))) {
    next = 'review';
    notice = 'This task needs approval, so it was sent for review.';
  }
  if (['in_progress', 'done'].includes(next)) {
    const blockers = await task.getBlockers({ attributes: ['key', 'status'] });
    const open = blockers.filter((b) => b.status !== 'done');
    if (open.length) notice = `Heads up: still waiting on ${open.map((b) => b.key).join(', ')}.`;
  }
  task.status = next;
  task.completedAt = next === 'done' ? new Date() : null;
  if (next === 'in_progress' && !task.startedAt) task.startedAt = new Date();
  if (next === 'review' && task.requiresApproval) task.approvalStatus = 'pending';
  if (!['review', 'done'].includes(next) && task.approvalStatus === 'pending') task.approvalStatus = 'none';
  await task.save();

  const assigneeIds = (await task.getAssignees({ attributes: ['id'] })).map((a) => a.id);
  await activity({ actorId: req.user.id, action: 'task.status', summary: `moved ${task.key} to ${STATUS_LABEL[task.status]}`,
    taskId: task.id, projectId: task.projectId, clientVisible: task.clientVisible, meta: { from, to: task.status } });
  if (notifyPeople) {
    await notify({ userIds: [...assigneeIds, task.createdById, ...(await watcherIds(task.id))], type: 'task_status', exclude: req.user.id,
      title: `${task.key} is now ${STATUS_LABEL[task.status]}`, body: `${task.title}, updated by ${req.user.name}`, link: `/tasks/${task.id}` });
  }
  if (task.status === 'review' && task.approvalStatus === 'pending') {
    await notify({ userIds: await approversFor(task), type: 'approval_request', exclude: req.user.id,
      title: `Approval needed: ${task.key}`, body: `${req.user.name} sent "${task.title}" for review`, link: `/tasks/${task.id}` });
  }
  if (['done', 'review'].includes(task.status)) {
    await notifyClientIfVisible(task, `${task.title} is ${task.status === 'done' ? 'complete' : 'ready for your review'}`, 'Open your portal to see the details.');
  }
  if (task.status === 'done' && task.parentId) {
    const open = await Task.count({ where: { parentId: task.parentId, status: { [Op.ne]: 'done' } } });
    if (!open) {
      const parent = await Task.findByPk(task.parentId);
      const pa = (await parent.getAssignees({ attributes: ['id'] })).map((a) => a.id);
      await notify({ userIds: [...pa, parent.createdById], type: 'task_status', exclude: req.user.id,
        title: `All subtasks of ${parent.key} are done`, body: parent.title, link: `/tasks/${parent.id}` });
    }
  }
  emit('task.status', { task, from, to: task.status, actor: actorOf(req) });
  return { changed: true, notice };
}

const wrap = (fnc) => (req, res) => fnc(req, res).catch((e) => {
  if (!e.status) console.error(e);
  res.status(e.status || 500).json({ error: e.message || 'Something went wrong.' });
});

router.use(staffOnly);

// ---------- list ----------
router.get('/', wrap(async (req, res) => {
  const q = req.query;
  const and = [await taskScope(req)];
  if (q.archived !== '1') and.push({ archived: false });
  if (q.projectId) and.push({ projectId: q.projectId === 'none' ? null : q.projectId });
  if (q.status) and.push({ status: String(q.status).split(',') });
  if (q.priority) and.push({ priority: String(q.priority).split(',') });
  if (q.sectionId) and.push({ sectionId: q.sectionId === 'none' ? null : q.sectionId });
  if (q.sprintId) and.push({ sprintId: q.sprintId === 'none' ? null : q.sprintId });
  if (q.parentId === 'root') and.push({ parentId: null });
  else if (q.parentId) and.push({ parentId: q.parentId });
  if (q.q) and.push({ [Op.or]: [{ title: { [Op.like]: `%${q.q}%` } }, { key: { [Op.like]: `%${q.q}%` } }] });
  if (q.tag) and.push({ tags: { [Op.like]: `%"${String(q.tag).replace(/["%]/g, '')}"%` } });
  if (q.from) and.push({ dueDate: { [Op.gte]: new Date(q.from) } });
  if (q.to) and.push({ dueDate: { [Op.lte]: new Date(q.to) } });
  if (q.approval) and.push({ approvalStatus: q.approval });
  if (q.createdBy === 'me') and.push({ createdById: req.user.id });
  if (q.watching === 'me') {
    const rows = await TaskWatcher.findAll({ where: { userId: req.user.id }, raw: true });
    and.push({ id: rows.map((r) => r.taskId) });
  }
  const now = new Date();
  if (q.due === 'overdue') and.push({ dueDate: { [Op.lt]: now } }, { status: { [Op.ne]: 'done' } });
  if (q.due === 'today') {
    const end = new Date(); end.setHours(23, 59, 59, 999);
    and.push({ dueDate: { [Op.lte]: end } }, { status: { [Op.ne]: 'done' } });
  }
  if (q.due === 'week') and.push({ dueDate: { [Op.lte]: new Date(Date.now() + 7 * 864e5) } }, { status: { [Op.ne]: 'done' } });
  if (q.due === 'none') and.push({ dueDate: null });
  if (q.hideDone === '1') and.push({ status: { [Op.ne]: 'done' } });
  if (q.doneSince) and.push({ status: 'done', completedAt: { [Op.gte]: new Date(q.doneSince) } });

  const assigneeFilter = q.assignee === 'me' ? req.user.id : q.assignee ? Number(q.assignee) : null;
  if (assigneeFilter) {
    const rows = await TaskAssignee.findAll({ where: { userId: assigneeFilter }, attributes: ['taskId'], raw: true });
    and.push({ id: rows.map((r) => r.taskId) });
  }
  if (q.assignee === 'none') {
    const rows = await TaskAssignee.findAll({ attributes: ['taskId'], raw: true });
    and.push({ id: { [Op.notIn]: rows.map((r) => r.taskId).concat([0]) } });
  }
  const tasks = await Task.findAll({
    where: { [Op.and]: and }, include: listIncludes,
    order: [['position', 'ASC'], ['createdAt', 'DESC']], limit: Math.min(Number(q.limit) || 600, 2000),
  });
  res.json(await decorate(tasks));
}));

// ---------- bulk ----------
router.patch('/bulk', wrap(async (req, res) => {
  const { ids = [], status, priority, assigneeId, dueDate, sectionId, sprintId, archived } = req.body;
  const tasks = await Task.findAll({ where: { id: ids } });
  let changed = 0;
  for (const t of tasks) {
    if (!(await canEditTask(req, t))) continue;
    if (status) await applyStatus(req, t, status, { notifyPeople: false });
    if (priority && PRIORITIES.includes(priority) && priority !== t.priority) { const from = t.priority; t.priority = priority; emit('task.priority', { task: t, from, to: priority, actor: actorOf(req) }); }
    if (dueDate !== undefined) { t.dueDate = dueDate || null; t.reminderSentAt = null; t.overdueNotifiedAt = null; }
    if (sectionId !== undefined) t.sectionId = sectionId || null;
    if (sprintId !== undefined) t.sprintId = sprintId || null;
    if (archived !== undefined) t.archived = !!archived;
    await t.save();
    if (assigneeId && req.can('tasks.assign')) {
      await t.addAssignee(Number(assigneeId));
      emit('task.assigned', { task: t, added: [Number(assigneeId)], actor: actorOf(req) });
    }
    broadcast(t); changed += 1;
  }
  if (assigneeId && changed) {
    await notify({ userIds: [Number(assigneeId)], type: 'task_assigned', exclude: req.user.id, title: `${req.user.name} assigned you ${changed} tasks`, body: tasks.slice(0, 5).map((t) => t.key).join(', '), link: '/my-tasks' });
  }
  await activity({ actorId: req.user.id, action: 'task.bulk', summary: `bulk-updated ${changed} tasks` });
  res.json({ changed });
}));

// ---------- reorder (board drag) ----------
router.post('/reorder', wrap(async (req, res) => {
  const { id, status, sectionId, beforeId, afterId } = req.body;
  const task = await Task.findByPk(id);
  if (!task || !(await canEditTask(req, task))) return res.status(403).json({ error: "You can't move this task." });
  const before = beforeId ? await Task.findByPk(beforeId, { attributes: ['position'] }) : null;
  const after = afterId ? await Task.findByPk(afterId, { attributes: ['position'] }) : null;
  if (before && after) task.position = (before.position + after.position) / 2;
  else if (before) task.position = before.position + 1000;
  else if (after) task.position = after.position - 1000;
  if (sectionId !== undefined) task.sectionId = sectionId || null;
  await task.save();
  let notice = null;
  if (status && status !== task.status) ({ notice } = await applyStatus(req, task, status));
  broadcast(task);
  const full = await Task.findByPk(task.id, { include: listIncludes });
  res.json({ ...(await decorate([full]))[0], notice });
}));

// ---------- timer (before /:id) ----------
router.get('/timer/active', wrap(async (req, res) => {
  const log = await TimeLog.findOne({ where: { userId: req.user.id, endedAt: null }, include: [{ model: Task, attributes: ['id', 'key', 'title'] }] });
  res.json(log);
}));

router.post('/timer/stop', wrap(async (req, res) => {
  const log = await TimeLog.findOne({ where: { userId: req.user.id, endedAt: null } });
  if (!log) return res.json(null);
  log.endedAt = new Date();
  log.minutes = Math.max(1, Math.round((log.endedAt - new Date(log.startedAt)) / 60000));
  if (req.body?.note) log.note = req.body.note;
  await log.save();
  res.json(log);
}));

// ---------- detail ----------
router.get('/:id', wrap(async (req, res) => {
  const task = await Task.findByPk(req.params.id, {
    include: [
      ...listIncludes,
      { model: User, as: 'creator', attributes: userAttrs },
      { model: Milestone, attributes: ['id', 'title'] },
      { model: Sprint, attributes: ['id', 'name', 'status'] },
      { model: ChecklistItem, as: 'checklist' },
      { model: Comment, include: [{ model: User, as: 'author', attributes: userAttrs, include: [{ model: Role, attributes: ['isClientRole', 'name'] }] }] },
      { model: Attachment, include: [{ model: User, as: 'uploader', attributes: ['id', 'name'] }] },
      { model: TimeLog, include: [{ model: User, attributes: ['id', 'name', 'color'] }] },
      { model: Task, as: 'blockers', attributes: ['id', 'key', 'title', 'status', 'dueDate'], through: { attributes: [] } },
      { model: Task, as: 'blocking', attributes: ['id', 'key', 'title', 'status', 'dueDate'], through: { attributes: [] } },
      { model: User, as: 'watchers', attributes: ['id', 'name', 'color'], through: { attributes: [] } },
    ],
    order: [[{ model: ChecklistItem, as: 'checklist' }, 'position', 'ASC'], [Comment, 'createdAt', 'ASC']],
  });
  if (!task || !(await canSeeTask(req, task))) return res.status(404).json({ error: 'Task not found or not shared with you.' });

  const breadcrumb = [];
  let cur = task.parentId ? await Task.findByPk(task.parentId, { attributes: ['id', 'key', 'title', 'parentId'] }) : null;
  while (cur) {
    breadcrumb.unshift({ id: cur.id, key: cur.key, title: cur.title });
    cur = cur.parentId ? await Task.findByPk(cur.parentId, { attributes: ['id', 'key', 'title', 'parentId'] }) : null;
  }
  const descIds = await collectDescendants(task.id);
  const descendants = descIds.length ? await decorate(await Task.findAll({ where: { id: descIds }, include: listIncludes, order: [['position', 'ASC']] })) : [];
  const history = await Activity.findAll({ where: { taskId: task.id }, include: [{ model: User, as: 'actor', attributes: ['id', 'name', 'color'] }],
    order: [['createdAt', 'DESC']], limit: 60 });
  const [decorated] = await decorate([task]);
  res.json({
    ...decorated, breadcrumb, descendants, history,
    watching: task.watchers.some((w) => w.id === req.user.id),
    canEdit: await canEditTask(req, task), canApprove: await canApprove(req, task),
    canDelete: req.can('tasks.delete') || task.createdById === req.user.id,
  });
}));

router.post('/', wrap(async (req, res) => {
  if (!req.can('tasks.create')) return res.status(403).json({ error: "Your role can't create tasks." });
  const task = await createTask(req, req.body);
  if (Array.isArray(req.body.subtasks)) {
    for (const st of req.body.subtasks.filter((s) => s && (s.title || typeof s === 'string'))) {
      const sub = typeof st === 'string' ? { title: st } : st;
      await createTask(req, { ...sub, parentId: task.id, assigneeIds: sub.assigneeIds || req.body.assigneeIds, clientVisible: task.clientVisible }, { silent: true });
    }
  }
  const full = await Task.findByPk(task.id, { include: listIncludes });
  res.status(201).json((await decorate([full]))[0]);
}));

// ---------- update ----------
router.patch('/:id', wrap(async (req, res) => {
  const task = await Task.findByPk(req.params.id, { include: [{ model: User, as: 'assignees', attributes: ['id'], through: { attributes: [] } }] });
  if (!task) return res.status(404).json({ error: 'Task not found.' });
  if (!(await canEditTask(req, task))) return res.status(403).json({ error: "You can't edit this task." });
  const b = req.body;
  const beforeAssignees = task.assignees.map((a) => a.id);
  const changes = [];
  const nullable = ['startDate', 'dueDate', 'milestoneId', 'estimateHours', 'sectionId', 'sprintId', 'storyPoints'];
  ['title', 'description', 'startDate', 'dueDate', 'estimateHours', 'tags', 'links', 'milestoneId', 'position', 'clientVisible',
    'requiresApproval', 'sectionId', 'sprintId', 'storyPoints', 'recurrence', 'archived']
    .forEach((k) => {
      if (b[k] === undefined) return;
      const v = (nullable.includes(k) && (b[k] === '' || b[k] === null)) ? null : b[k];
      if (JSON.stringify(task[k]) !== JSON.stringify(v)) { task[k] = v; if (k !== 'position') changes.push(k); }
    });
  if (b.dueDate !== undefined) { task.reminderSentAt = null; task.overdueNotifiedAt = null; }
  let priorityFrom = null;
  if (b.priority && PRIORITIES.includes(b.priority) && b.priority !== task.priority) { priorityFrom = task.priority; task.priority = b.priority; changes.push('priority'); }
  if (b.projectId !== undefined && !task.parentId && Number(b.projectId || 0) !== Number(task.projectId || 0)) {
    task.projectId = b.projectId || null; task.sectionId = null; task.sprintId = null;
    changes.push('project');
  }
  await task.save();

  let notice = null;
  if (b.status && b.status !== task.status) ({ notice } = await applyStatus(req, task, b.status));

  let added = [];
  if (Array.isArray(b.assigneeIds)) {
    const next = [...new Set(b.assigneeIds.map(Number))];
    const differsFromSelf = next.some((id) => id !== req.user.id) || beforeAssignees.some((id) => id !== req.user.id);
    if (differsFromSelf && !req.can('tasks.assign')) return res.status(403).json({ error: "Your role can't assign tasks to others." });
    await task.setAssignees(next);
    added = next.filter((id) => !beforeAssignees.includes(id));
    if (added.length || beforeAssignees.some((id) => !next.includes(id))) changes.push('assignees');
  }
  if (added.length) {
    await notify({ userIds: added, type: 'task_assigned', exclude: req.user.id, title: `${req.user.name} assigned you ${task.key}`,
      body: `${task.title}${task.dueDate ? `, due ${short(task.dueDate)}` : ''}`, link: `/tasks/${task.id}` });
    await activity({ actorId: req.user.id, action: 'task.assigned', summary: `updated assignees on ${task.key}`, taskId: task.id, projectId: task.projectId });
    emit('task.assigned', { task, added, actor: actorOf(req) });
  }
  if (priorityFrom) emit('task.priority', { task, from: priorityFrom, to: task.priority, actor: actorOf(req) });
  const other = changes.filter((c) => !['assignees'].includes(c));
  if (other.length) {
    const label = other.map((c) => ({ dueDate: 'due date', startDate: 'start date', estimateHours: 'estimate', sectionId: 'section', sprintId: 'sprint', storyPoints: 'story points', clientVisible: 'client visibility', requiresApproval: 'approval rule', milestoneId: 'milestone' }[c] || c));
    await activity({ actorId: req.user.id, action: 'task.updated', summary: `changed ${label.join(', ')} on ${task.key}`, taskId: task.id, projectId: task.projectId });
  }
  broadcast(task);
  const full = await Task.findByPk(task.id, { include: listIncludes });
  res.json({ ...(await decorate([full]))[0], notice });
}));

router.delete('/:id', wrap(async (req, res) => {
  const task = await Task.findByPk(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found.' });
  if (!req.can('tasks.delete') && task.createdById !== req.user.id) return res.status(403).json({ error: "You can't delete this task." });
  const ids = [task.id, ...(await collectDescendants(task.id))];
  await sequelize.transaction(async (tx) => {
    for (const M of [ChecklistItem, Comment, Attachment, TimeLog, TaskAssignee, TaskWatcher]) await M.destroy({ where: { taskId: ids }, transaction: tx });
    await TaskDependency.destroy({ where: { [Op.or]: [{ taskId: ids }, { blockerId: ids }] }, transaction: tx });
    await Activity.update({ taskId: null }, { where: { taskId: ids }, transaction: tx });
    await Task.destroy({ where: { id: ids }, transaction: tx });
  });
  await activity({ actorId: req.user.id, action: 'task.deleted', summary: `deleted ${task.key} "${task.title}"${ids.length > 1 ? ` and ${ids.length - 1} subtasks` : ''}`, projectId: task.projectId });
  broadcast(task, 'deleted');
  res.json({ ok: true, deleted: ids.length });
}));

router.post('/:id/duplicate', wrap(async (req, res) => {
  const t = await Task.findByPk(req.params.id, { include: [{ model: ChecklistItem, as: 'checklist' }, { model: User, as: 'assignees', attributes: ['id'], through: { attributes: [] } }] });
  if (!t || !(await canSeeTask(req, t))) return res.status(404).json({ error: 'Task not found.' });
  const copy = await createTask(req, {
    title: `${t.title} (copy)`, description: t.description, projectId: t.projectId, parentId: t.parentId, priority: t.priority,
    startDate: t.startDate, dueDate: t.dueDate, estimateHours: t.estimateHours, storyPoints: t.storyPoints, sectionId: t.sectionId,
    clientVisible: t.clientVisible, requiresApproval: t.requiresApproval, tags: t.tags, links: t.links,
    assigneeIds: t.assignees.map((a) => a.id), checklist: t.checklist.map((c) => c.text),
  }, { silent: true });
  res.status(201).json(copy);
}));

// ---------- approval ----------
router.post('/:id/approval', wrap(async (req, res) => {
  const task = await Task.findByPk(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found.' });
  if (!(await canApprove(req, task))) return res.status(403).json({ error: "You can't approve this task." });
  const approve = req.body.decision === 'approve';
  const from = task.status;
  task.approvalStatus = approve ? 'approved' : 'changes_requested';
  task.status = approve ? 'done' : 'in_progress';
  task.completedAt = approve ? new Date() : null;
  await task.save();
  if (req.body.note) await Comment.create({ taskId: task.id, userId: req.user.id, body: `${approve ? 'Approved' : 'Changes requested'}: ${req.body.note}`, internal: true });
  const assigneeIds = (await task.getAssignees({ attributes: ['id'] })).map((a) => a.id);
  await notify({ userIds: assigneeIds, type: 'approval_result', exclude: req.user.id,
    title: approve ? `${task.key} approved` : `Changes requested on ${task.key}`, body: req.body.note || task.title, link: `/tasks/${task.id}` });
  await activity({ actorId: req.user.id, action: approve ? 'task.approved' : 'task.changes', summary: `${approve ? 'approved' : 'requested changes on'} ${task.key}`,
    taskId: task.id, projectId: task.projectId, clientVisible: task.clientVisible && approve });
  if (approve) await notifyClientIfVisible(task, `${task.title} is complete`, 'Open your portal to see the details.');
  emit('task.status', { task, from, to: task.status, actor: actorOf(req) });
  broadcast(task);
  res.json(task);
}));

// ---------- dependencies ----------
async function dependsOn(taskId, targetId, seen = new Set()) {
  if (taskId === targetId) return true;
  if (seen.has(taskId)) return false;
  seen.add(taskId);
  const rows = await TaskDependency.findAll({ where: { taskId }, raw: true });
  for (const r of rows) if (await dependsOn(r.blockerId, targetId, seen)) return true;
  return false;
}

router.post('/:id/dependencies', wrap(async (req, res) => {
  const task = await Task.findByPk(req.params.id);
  const blocker = await Task.findByPk(req.body.blockerId);
  if (!task || !blocker) return res.status(404).json({ error: 'Task not found.' });
  if (!(await canEditTask(req, task))) return res.status(403).json({ error: "You can't edit this task." });
  if (await dependsOn(blocker.id, task.id)) return res.status(400).json({ error: `That would create a loop: ${blocker.key} already waits on ${task.key}.` });
  await TaskDependency.findOrCreate({ where: { taskId: task.id, blockerId: blocker.id } });
  await activity({ actorId: req.user.id, action: 'task.dependency', summary: `marked ${task.key} as waiting on ${blocker.key}`, taskId: task.id, projectId: task.projectId });
  broadcast(task);
  res.status(201).json({ ok: true });
}));

router.delete('/:id/dependencies/:blockerId', wrap(async (req, res) => {
  const task = await Task.findByPk(req.params.id);
  if (!task || !(await canEditTask(req, task))) return res.status(403).json({ error: "You can't edit this task." });
  await TaskDependency.destroy({ where: { taskId: task.id, blockerId: req.params.blockerId } });
  broadcast(task);
  res.json({ ok: true });
}));

// ---------- watchers ----------
router.post('/:id/watch', wrap(async (req, res) => {
  const task = await Task.findByPk(req.params.id);
  if (!task || !(await canSeeTask(req, task))) return res.status(404).json({ error: 'Task not found.' });
  const userId = req.body.userId && req.can('tasks.assign') ? Number(req.body.userId) : req.user.id;
  await TaskWatcher.findOrCreate({ where: { taskId: task.id, userId } });
  res.json({ ok: true });
}));
router.delete('/:id/watch', wrap(async (req, res) => {
  await TaskWatcher.destroy({ where: { taskId: req.params.id, userId: req.query.userId && req.can('tasks.assign') ? Number(req.query.userId) : req.user.id } });
  res.json({ ok: true });
}));

// ---------- checklist ----------
router.post('/:id/checklist', wrap(async (req, res) => {
  const task = await Task.findByPk(req.params.id);
  if (!task || !(await canEditTask(req, task))) return res.status(403).json({ error: "You can't edit this task." });
  const items = Array.isArray(req.body.items) ? req.body.items : [req.body.text];
  let pos = (await ChecklistItem.max('position', { where: { taskId: task.id } })) || 0;
  const rows = [];
  for (const text of items.filter(Boolean)) { pos += 1; rows.push(await ChecklistItem.create({ taskId: task.id, text: String(text).slice(0, 250), position: pos })); }
  broadcast(task);
  res.status(201).json(rows.length === 1 ? rows[0] : rows);
}));

router.patch('/checklist/:itemId', wrap(async (req, res) => {
  const item = await ChecklistItem.findByPk(req.params.itemId);
  const task = item && await Task.findByPk(item.taskId);
  if (!task || !(await canEditTask(req, task))) return res.status(403).json({ error: "You can't edit this task." });
  if (req.body.text !== undefined) item.text = req.body.text;
  if (req.body.done !== undefined) item.done = !!req.body.done;
  await item.save();
  broadcast(task);
  res.json(item);
}));

router.delete('/checklist/:itemId', wrap(async (req, res) => {
  const item = await ChecklistItem.findByPk(req.params.itemId);
  const task = item && await Task.findByPk(item.taskId);
  if (!task || !(await canEditTask(req, task))) return res.status(403).json({ error: "You can't edit this task." });
  await item.destroy();
  broadcast(task);
  res.json({ ok: true });
}));

// ---------- comments ----------
router.post('/:id/comments', wrap(async (req, res) => {
  const task = await Task.findByPk(req.params.id);
  if (!task || !(await canSeeTask(req, task))) return res.status(404).json({ error: 'Task not found.' });
  const body = String(req.body.body || '').trim();
  if (!body) return res.status(400).json({ error: 'Write something first.' });
  const internal = req.body.internal !== false;
  const c = await Comment.create({ taskId: task.id, userId: req.user.id, body, internal: task.clientVisible ? internal : true });
  await TaskWatcher.findOrCreate({ where: { taskId: task.id, userId: req.user.id } });
  const assigneeIds = (await task.getAssignees({ attributes: ['id'] })).map((a) => a.id);
  const mentions = (req.body.mentions || []).map(Number);
  await notify({ userIds: mentions, type: 'task_mention', exclude: req.user.id, title: `${req.user.name} mentioned you on ${task.key}`,
    body: body.slice(0, 200), link: `/tasks/${task.id}` });
  await notify({ userIds: [...assigneeIds, task.createdById, ...(await watcherIds(task.id))].filter((id) => !mentions.includes(id)), type: 'task_comment', exclude: req.user.id,
    title: `New comment on ${task.key}`, body: `${req.user.name}: ${body.slice(0, 200)}`, link: `/tasks/${task.id}` });
  if (!c.internal) await notifyClientIfVisible(task, `New update on ${task.title}`, body.slice(0, 200));
  await activity({ actorId: req.user.id, action: 'task.comment', summary: `commented on ${task.key}`, taskId: task.id, projectId: task.projectId,
    clientVisible: !c.internal });
  emit('task.comment', { task, comment: c, actor: actorOf(req) });
  broadcast(task);
  const full = await Comment.findByPk(c.id, { include: [{ model: User, as: 'author', attributes: userAttrs, include: [{ model: Role, attributes: ['isClientRole', 'name'] }] }] });
  res.status(201).json(full);
}));

router.delete('/comments/:cid', wrap(async (req, res) => {
  const c = await Comment.findByPk(req.params.cid);
  if (!c) return res.status(404).json({ error: 'Comment not found.' });
  if (c.userId !== req.user.id && !req.can('tasks.edit_all')) return res.status(403).json({ error: 'You can only delete your own comments.' });
  await c.destroy();
  res.json({ ok: true });
}));

// ---------- attachments ----------
router.post('/:id/attachments', upload.array('files', 10), wrap(async (req, res) => {
  const task = await Task.findByPk(req.params.id);
  if (!task || !(await canSeeTask(req, task))) return res.status(404).json({ error: 'Task not found.' });
  const visible = req.body.clientVisible === 'true';
  const rows = await Attachment.bulkCreate((req.files || []).map((f) => ({
    taskId: task.id, userId: req.user.id, originalName: f.originalname, fileName: f.filename, mime: f.mimetype, size: f.size,
    clientVisible: visible && task.clientVisible,
  })));
  await activity({ actorId: req.user.id, action: 'task.file', summary: `attached ${rows.length} file${rows.length > 1 ? 's' : ''} to ${task.key}`,
    taskId: task.id, projectId: task.projectId, clientVisible: visible && task.clientVisible });
  if (visible) await notifyClientIfVisible(task, `New file shared on ${task.title}`, rows.map((r) => r.originalName).join(', '));
  broadcast(task);
  res.status(201).json(rows);
}));

router.patch('/attachments/:aid', wrap(async (req, res) => {
  const a = await Attachment.findByPk(req.params.aid);
  const task = a && await Task.findByPk(a.taskId);
  if (!task || !(await canEditTask(req, task))) return res.status(403).json({ error: "You can't edit this task." });
  a.clientVisible = !!req.body.clientVisible && task.clientVisible;
  await a.save();
  res.json(a);
}));

router.delete('/attachments/:aid', wrap(async (req, res) => {
  const a = await Attachment.findByPk(req.params.aid);
  if (!a) return res.status(404).json({ error: 'File not found.' });
  const task = await Task.findByPk(a.taskId);
  if (a.userId !== req.user.id && !(await canEditTask(req, task))) return res.status(403).json({ error: "You can't remove this file." });
  fs.promises.unlink(path.join(UPLOAD_DIR, a.fileName)).catch(() => {});
  await a.destroy();
  res.json({ ok: true });
}));

// ---------- time tracking ----------
router.post('/:id/timer/start', wrap(async (req, res) => {
  const task = await Task.findByPk(req.params.id);
  if (!task || !(await canSeeTask(req, task))) return res.status(404).json({ error: 'Task not found.' });
  const running = await TimeLog.findOne({ where: { userId: req.user.id, endedAt: null } });
  if (running) {
    running.endedAt = new Date();
    running.minutes = Math.max(1, Math.round((running.endedAt - new Date(running.startedAt)) / 60000));
    await running.save();
  }
  const log = await TimeLog.create({ taskId: task.id, userId: req.user.id, startedAt: new Date() });
  if (['todo', 'backlog'].includes(task.status) && await canEditTask(req, task)) await applyStatus(req, task, 'in_progress', { notifyPeople: false });
  broadcast(task);
  res.status(201).json({ ...log.toJSON(), Task: { id: task.id, key: task.key, title: task.title } });
}));

router.post('/:id/timelogs', wrap(async (req, res) => {
  const task = await Task.findByPk(req.params.id);
  if (!task || !(await canSeeTask(req, task))) return res.status(404).json({ error: 'Task not found.' });
  const minutes = Math.round(Number(req.body.minutes));
  if (!minutes || minutes < 1 || minutes > 24 * 60) return res.status(400).json({ error: 'Enter between 1 minute and 24 hours.' });
  const startedAt = req.body.date ? new Date(req.body.date) : new Date(Date.now() - minutes * 60000);
  const log = await TimeLog.create({ taskId: task.id, userId: req.user.id, minutes, note: req.body.note, startedAt, endedAt: new Date(startedAt.getTime() + minutes * 60000) });
  broadcast(task);
  res.status(201).json(log);
}));

module.exports = { router, createTask, applyStatus, decorate, STATUS_LABEL, listIncludes, canApprove };
