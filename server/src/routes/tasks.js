const router = require('express').Router();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const { Op, fn, col } = require('sequelize');
const {
  sequelize, Task, Project, User, Role, TaskAssignee, ChecklistItem, Comment, Attachment, TimeLog, Activity, Milestone,
} = require('../models');
const { staffOnly } = require('../middleware/auth');
const { taskScope, canSeeTask, canEditTask } = require('../services/access');
const { taskProgressMap } = require('../services/progress');
const { notify, activity } = require('../services/notify');
const socket = require('../services/socket');

const STATUS_LABEL = { todo: 'To do', in_progress: 'In progress', review: 'In review', done: 'Done', blocked: 'Blocked' };
const STATUSES = Object.keys(STATUS_LABEL);
const PRIORITIES = ['low', 'medium', 'high', 'urgent'];
const MAX_DEPTH = 6;

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
  { model: Project, attributes: ['id', 'name', 'code', 'color', 'clientId', 'ownerId'] },
];

// ---------- helpers ----------

/** Adds subtask counts, comment counts, checklist counts and rolled-up progress to a list of tasks. */
async function decorate(tasks) {
  if (!tasks.length) return [];
  const ids = tasks.map((t) => t.id);
  const projectIds = [...new Set(tasks.map((t) => t.projectId).filter(Boolean))];
  // Pull every task in the same projects (light columns) so progress can roll up through deep trees.
  const family = await Task.findAll({
    where: projectIds.length ? { [Op.or]: [{ projectId: projectIds }, { id: ids }] } : { id: ids },
    attributes: ['id', 'parentId', 'status'], raw: true,
  });
  const progress = taskProgressMap(family);
  const subCounts = {}; const subDone = {};
  family.forEach((t) => {
    if (!t.parentId) return;
    subCounts[t.parentId] = (subCounts[t.parentId] || 0) + 1;
    if (t.status === 'done') subDone[t.parentId] = (subDone[t.parentId] || 0) + 1;
  });
  const comments = await Comment.findAll({ where: { taskId: ids }, attributes: ['taskId', [fn('COUNT', col('id')), 'n']], group: ['taskId'], raw: true });
  const checks = await ChecklistItem.findAll({ where: { taskId: ids }, attributes: ['taskId', 'done'], raw: true });
  const files = await Attachment.findAll({ where: { taskId: ids }, attributes: ['taskId', [fn('COUNT', col('id')), 'n']], group: ['taskId'], raw: true });
  const cMap = Object.fromEntries(comments.map((c) => [c.taskId, Number(c.n)]));
  const fMap = Object.fromEntries(files.map((c) => [c.taskId, Number(c.n)]));
  return tasks.map((t) => {
    const j = t.toJSON ? t.toJSON() : t;
    const ck = checks.filter((c) => c.taskId === j.id);
    return {
      ...j,
      progress: progress.get(j.id) ?? 0,
      subtaskCount: subCounts[j.id] || 0,
      subtaskDone: subDone[j.id] || 0,
      commentCount: cMap[j.id] || 0,
      fileCount: fMap[j.id] || 0,
      checklistTotal: ck.length,
      checklistDone: ck.filter((c) => c.done).length,
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
  return [...ids].filter(Boolean);
}

async function canApprove(req, task) {
  if (req.can('tasks.approve')) return true;
  // Creators can approve, but nobody signs off their own assigned work.
  const assigneeIds = (await TaskAssignee.findAll({ where: { taskId: task.id }, raw: true })).map((a) => a.userId);
  if (task.createdById === req.user.id && !assigneeIds.includes(req.user.id)) return true;
  if (task.projectId) {
    const p = await Project.findByPk(task.projectId, { attributes: ['ownerId'] });
    if (p?.ownerId === req.user.id) return true;
  }
  return false;
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

/** Shared by the API, client-request conversion and the seed script. */
async function createTask(req, data) {
  const title = String(data.title || '').trim();
  if (!title) { const e = new Error('Give the task a title.'); e.status = 400; throw e; }
  let projectId = data.projectId ? Number(data.projectId) : null;
  let depth = 0;
  let parent = null;
  if (data.parentId) {
    parent = await Task.findByPk(data.parentId);
    if (!parent) { const e = new Error('Parent task not found.'); e.status = 404; throw e; }
    projectId = parent.projectId; // subtasks always live in the parent's project
    depth = parent.depth + 1;
    if (depth > MAX_DEPTH) { const e = new Error(`Tasks can be nested up to ${MAX_DEPTH} levels deep.`); e.status = 400; throw e; }
  }
  let assigneeIds = (data.assigneeIds || []).map(Number).filter(Boolean);
  if (assigneeIds.some((id) => id !== req.user.id) && !req.can('tasks.assign')) {
    assigneeIds = assigneeIds.filter((id) => id === req.user.id);
  }

  const task = await sequelize.transaction(async (tx) => {
    let key = null;
    if (projectId) {
      const project = await Project.findByPk(projectId, { transaction: tx });
      if (!project) { const e = new Error('Project not found.'); e.status = 404; throw e; }
      project.taskCounter += 1;
      await project.save({ transaction: tx });
      key = `${project.code}-${project.taskCounter}`;
    }
    const maxPos = await Task.max('position', { where: { parentId: parent ? parent.id : null, status: data.status || 'todo' }, transaction: tx });
    const t = await Task.create({
      key, title, description: data.description || '', projectId, parentId: parent ? parent.id : null, depth,
      status: STATUSES.includes(data.status) ? data.status : 'todo',
      priority: PRIORITIES.includes(data.priority) ? data.priority : 'medium',
      startDate: data.startDate || null, dueDate: data.dueDate || null, estimateHours: data.estimateHours || null,
      clientVisible: data.clientVisible ?? (parent ? parent.clientVisible : false),
      requiresApproval: !!data.requiresApproval, tags: data.tags || [], milestoneId: data.milestoneId || null,
      createdById: req.user.id, position: (maxPos || 0) + 1000,
    }, { transaction: tx });
    if (!key) { t.key = `T-${t.id}`; await t.save({ transaction: tx }); }
    if (assigneeIds.length) await t.setAssignees(assigneeIds, { transaction: tx });
    if (Array.isArray(data.checklist)) {
      await ChecklistItem.bulkCreate(data.checklist.filter(Boolean).map((text, i) => ({ taskId: t.id, text, position: i })), { transaction: tx });
    }
    return t;
  });

  await activity({ actorId: req.user.id, action: 'task.created', summary: `created ${parent ? 'subtask' : 'task'} ${task.key} "${task.title}"`,
    taskId: task.id, projectId, clientVisible: task.clientVisible });
  if (assigneeIds.length) {
    await notify({ userIds: assigneeIds, type: 'task_assigned', exclude: req.user.id,
      title: `${req.user.name} assigned you ${task.key}`,
      body: `${task.title}${task.dueDate ? ` — due ${new Date(task.dueDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}` : ''}`,
      link: `/tasks/${task.id}` });
  }
  broadcast(task, 'created');
  return task;
}

const wrap = (fnc) => (req, res) => fnc(req, res).catch((e) => res.status(e.status || 500).json({ error: e.message || 'Something went wrong.' }));

router.use(staffOnly);

// ---------- list ----------
router.get('/', wrap(async (req, res) => {
  const q = req.query;
  const and = [await taskScope(req)];
  if (q.projectId) and.push({ projectId: q.projectId === 'none' ? null : q.projectId });
  if (q.status) and.push({ status: String(q.status).split(',') });
  if (q.priority) and.push({ priority: String(q.priority).split(',') });
  if (q.parentId === 'root') and.push({ parentId: null });
  else if (q.parentId) and.push({ parentId: q.parentId });
  if (q.q) and.push({ [Op.or]: [{ title: { [Op.like]: `%${q.q}%` } }, { key: { [Op.like]: `%${q.q}%` } }] });
  if (q.from) and.push({ dueDate: { [Op.gte]: new Date(q.from) } });
  if (q.to) and.push({ dueDate: { [Op.lte]: new Date(q.to) } });
  if (q.approval) and.push({ approvalStatus: q.approval });
  const now = new Date();
  if (q.due === 'overdue') and.push({ dueDate: { [Op.lt]: now } }, { status: { [Op.ne]: 'done' } });
  if (q.due === 'today') {
    const end = new Date(); end.setHours(23, 59, 59, 999);
    and.push({ dueDate: { [Op.lte]: end } }, { status: { [Op.ne]: 'done' } });
  }
  if (q.due === 'week') and.push({ dueDate: { [Op.lte]: new Date(Date.now() + 7 * 864e5) } }, { status: { [Op.ne]: 'done' } });
  if (q.hideDone === '1') and.push({ status: { [Op.ne]: 'done' } });

  const assigneeFilter = q.assignee === 'me' ? req.user.id : q.assignee ? Number(q.assignee) : null;
  if (assigneeFilter) {
    const rows = await TaskAssignee.findAll({ where: { userId: assigneeFilter }, attributes: ['taskId'], raw: true });
    and.push({ id: rows.map((r) => r.taskId) });
  }
  const tasks = await Task.findAll({
    where: { [Op.and]: and }, include: listIncludes,
    order: [['position', 'ASC'], ['createdAt', 'DESC']], limit: Math.min(Number(q.limit) || 500, 1000),
  });
  res.json(await decorate(tasks));
}));

// ---------- bulk update ----------
router.patch('/bulk', wrap(async (req, res) => {
  const { ids = [], status, priority, assigneeId, dueDate } = req.body;
  const tasks = await Task.findAll({ where: { id: ids } });
  let changed = 0;
  for (const t of tasks) {
    if (!(await canEditTask(req, t))) continue;
    if (status && STATUSES.includes(status)) {
      t.status = status;
      t.completedAt = status === 'done' ? new Date() : null;
    }
    if (priority && PRIORITIES.includes(priority)) t.priority = priority;
    if (dueDate !== undefined) t.dueDate = dueDate || null;
    await t.save();
    if (assigneeId && req.can('tasks.assign')) await t.addAssignee(Number(assigneeId));
    broadcast(t); changed += 1;
  }
  await activity({ actorId: req.user.id, action: 'task.bulk', summary: `bulk-updated ${changed} tasks` });
  res.json({ changed });
}));

// ---------- timer (registered before /:id) ----------
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
      { model: ChecklistItem, as: 'checklist' },
      { model: Comment, include: [{ model: User, as: 'author', attributes: userAttrs, include: [{ model: Role, attributes: ['isClientRole', 'name'] }] }] },
      { model: Attachment, include: [{ model: User, as: 'uploader', attributes: ['id', 'name'] }] },
      { model: TimeLog, include: [{ model: User, attributes: ['id', 'name', 'color'] }] },
    ],
    order: [[{ model: ChecklistItem, as: 'checklist' }, 'position', 'ASC'], [Comment, 'createdAt', 'ASC']],
  });
  if (!task || !(await canSeeTask(req, task))) return res.status(404).json({ error: 'Task not found or not shared with you.' });

  // Breadcrumb up to the root
  const breadcrumb = [];
  let cur = task.parentId ? await Task.findByPk(task.parentId, { attributes: ['id', 'key', 'title', 'parentId'] }) : null;
  while (cur) {
    breadcrumb.unshift({ id: cur.id, key: cur.key, title: cur.title });
    cur = cur.parentId ? await Task.findByPk(cur.parentId, { attributes: ['id', 'key', 'title', 'parentId'] }) : null;
  }
  // Every descendant, so the UI can render the whole tree
  const descIds = await collectDescendants(task.id);
  const descendants = descIds.length ? await decorate(await Task.findAll({ where: { id: descIds }, include: listIncludes, order: [['position', 'ASC']] })) : [];
  const history = await Activity.findAll({ where: { taskId: task.id }, include: [{ model: User, as: 'actor', attributes: ['id', 'name', 'color'] }],
    order: [['createdAt', 'DESC']], limit: 50 });
  const [decorated] = await decorate([task]);
  res.json({
    ...decorated, breadcrumb, descendants, history,
    canEdit: await canEditTask(req, task), canApprove: await canApprove(req, task),
    canDelete: req.can('tasks.delete') || task.createdById === req.user.id,
  });
}));

router.post('/', wrap(async (req, res) => {
  if (!req.can('tasks.create')) return res.status(403).json({ error: "Your role can't create tasks." });
  const task = await createTask(req, req.body);
  const full = await Task.findByPk(task.id, { include: listIncludes });
  res.status(201).json((await decorate([full]))[0]);
}));

// ---------- update ----------
router.patch('/:id', wrap(async (req, res) => {
  const task = await Task.findByPk(req.params.id, { include: [{ model: User, as: 'assignees', attributes: ['id'], through: { attributes: [] } }] });
  if (!task) return res.status(404).json({ error: 'Task not found.' });
  if (!(await canEditTask(req, task))) return res.status(403).json({ error: "You can't edit this task." });
  const b = req.body;
  const before = { status: task.status, assignees: task.assignees.map((a) => a.id), clientVisible: task.clientVisible };
  const changes = [];

  ['title', 'description', 'startDate', 'dueDate', 'estimateHours', 'tags', 'milestoneId', 'position', 'clientVisible', 'requiresApproval']
    .forEach((k) => {
      if (b[k] === undefined) return;
      const v = (['startDate', 'dueDate', 'milestoneId', 'estimateHours'].includes(k) && b[k] === '') ? null : b[k];
      if (JSON.stringify(task[k]) !== JSON.stringify(v)) { task[k] = v; if (k !== 'position') changes.push(k); }
    });
  if (b.dueDate !== undefined) { task.reminderSentAt = null; task.overdueNotifiedAt = null; }
  if (b.priority && PRIORITIES.includes(b.priority) && b.priority !== task.priority) { task.priority = b.priority; changes.push('priority'); }

  let statusMsg = null;
  if (b.status && STATUSES.includes(b.status) && b.status !== task.status) {
    let next = b.status;
    // Approval gate: tasks that need sign-off go to review instead of done.
    if (next === 'done' && task.requiresApproval && task.approvalStatus !== 'approved' && !(await canApprove(req, task))) {
      next = 'review';
      statusMsg = 'This task needs approval, so it was sent for review.';
    }
    task.status = next;
    task.completedAt = next === 'done' ? new Date() : null;
    if (next === 'review' && task.requiresApproval) task.approvalStatus = 'pending';
    if (next !== 'review' && next !== 'done' && task.approvalStatus === 'pending') task.approvalStatus = 'none';
    changes.push('status');
  }
  if (b.projectId !== undefined && !task.parentId && Number(b.projectId || 0) !== Number(task.projectId || 0)) {
    task.projectId = b.projectId || null;
    changes.push('project');
  }
  await task.save();

  // Assignees
  let added = [];
  if (Array.isArray(b.assigneeIds)) {
    const next = b.assigneeIds.map(Number);
    const differsFromSelf = next.some((id) => id !== req.user.id) || before.assignees.some((id) => id !== req.user.id);
    if (differsFromSelf && !req.can('tasks.assign')) return res.status(403).json({ error: "Your role can't assign tasks to others." });
    await task.setAssignees(next);
    added = next.filter((id) => !before.assignees.includes(id));
    if (added.length || before.assignees.some((id) => !next.includes(id))) changes.push('assignees');
  }

  // Side effects
  const assigneeIds = (await task.getAssignees({ attributes: ['id'] })).map((a) => a.id);
  if (changes.includes('status')) {
    await activity({ actorId: req.user.id, action: 'task.status', summary: `moved ${task.key} to ${STATUS_LABEL[task.status]}`,
      taskId: task.id, projectId: task.projectId, clientVisible: task.clientVisible, meta: { from: before.status, to: task.status } });
    await notify({ userIds: [...assigneeIds, task.createdById], type: 'task_status', exclude: req.user.id,
      title: `${task.key} is now ${STATUS_LABEL[task.status]}`, body: `${task.title} — updated by ${req.user.name}`, link: `/tasks/${task.id}` });
    if (task.status === 'review' && task.approvalStatus === 'pending') {
      await notify({ userIds: await approversFor(task), type: 'approval_request', exclude: req.user.id,
        title: `Approval needed: ${task.key}`, body: `${req.user.name} sent "${task.title}" for review`, link: `/tasks/${task.id}` });
    }
    if (['done', 'review'].includes(task.status)) {
      await notifyClientIfVisible(task, `${task.title} is ${task.status === 'done' ? 'complete' : 'ready for review'}`, 'Open your portal to see the details.');
    }
    // When the last subtask closes, tell the owner of the parent.
    if (task.status === 'done' && task.parentId) {
      const open = await Task.count({ where: { parentId: task.parentId, status: { [Op.ne]: 'done' } } });
      if (!open) {
        const parent = await Task.findByPk(task.parentId);
        const pa = (await parent.getAssignees({ attributes: ['id'] })).map((a) => a.id);
        await notify({ userIds: [...pa, parent.createdById], type: 'task_status', exclude: req.user.id,
          title: `All subtasks of ${parent.key} are done`, body: parent.title, link: `/tasks/${parent.id}` });
      }
    }
  }
  if (added.length) {
    await notify({ userIds: added, type: 'task_assigned', exclude: req.user.id, title: `${req.user.name} assigned you ${task.key}`,
      body: task.title, link: `/tasks/${task.id}` });
    await activity({ actorId: req.user.id, action: 'task.assigned', summary: `updated assignees on ${task.key}`, taskId: task.id, projectId: task.projectId });
  }
  const other = changes.filter((c) => !['status', 'assignees'].includes(c));
  if (other.length) {
    await activity({ actorId: req.user.id, action: 'task.updated', summary: `changed ${other.join(', ')} on ${task.key}`, taskId: task.id, projectId: task.projectId });
  }
  broadcast(task);
  const full = await Task.findByPk(task.id, { include: listIncludes });
  res.json({ ...(await decorate([full]))[0], notice: statusMsg });
}));

router.delete('/:id', wrap(async (req, res) => {
  const task = await Task.findByPk(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found.' });
  if (!req.can('tasks.delete') && task.createdById !== req.user.id) return res.status(403).json({ error: "You can't delete this task." });
  const ids = [task.id, ...(await collectDescendants(task.id))];
  await sequelize.transaction(async (tx) => {
    for (const M of [ChecklistItem, Comment, Attachment, TimeLog, TaskAssignee]) await M.destroy({ where: { taskId: ids }, transaction: tx });
    await Activity.update({ taskId: null }, { where: { taskId: ids }, transaction: tx });
    await Task.destroy({ where: { id: ids }, transaction: tx });
  });
  await activity({ actorId: req.user.id, action: 'task.deleted', summary: `deleted ${task.key} "${task.title}"${ids.length > 1 ? ` and ${ids.length - 1} subtasks` : ''}`, projectId: task.projectId });
  broadcast(task, 'deleted');
  res.json({ ok: true, deleted: ids.length });
}));

// ---------- approval ----------
router.post('/:id/approval', wrap(async (req, res) => {
  const task = await Task.findByPk(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found.' });
  if (!(await canApprove(req, task))) return res.status(403).json({ error: "You can't approve this task." });
  const approve = req.body.decision === 'approve';
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
  broadcast(task);
  res.json(task);
}));

// ---------- checklist ----------
router.post('/:id/checklist', wrap(async (req, res) => {
  const task = await Task.findByPk(req.params.id);
  if (!task || !(await canEditTask(req, task))) return res.status(403).json({ error: "You can't edit this task." });
  const pos = (await ChecklistItem.max('position', { where: { taskId: task.id } })) || 0;
  const item = await ChecklistItem.create({ taskId: task.id, text: req.body.text, position: pos + 1 });
  broadcast(task);
  res.status(201).json(item);
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
  const assigneeIds = (await task.getAssignees({ attributes: ['id'] })).map((a) => a.id);
  const mentions = (req.body.mentions || []).map(Number);
  await notify({ userIds: mentions, type: 'task_mention', exclude: req.user.id, title: `${req.user.name} mentioned you on ${task.key}`,
    body: body.slice(0, 200), link: `/tasks/${task.id}` });
  await notify({ userIds: [...assigneeIds, task.createdById].filter((id) => !mentions.includes(id)), type: 'task_comment', exclude: req.user.id,
    title: `New comment on ${task.key}`, body: `${req.user.name}: ${body.slice(0, 200)}`, link: `/tasks/${task.id}` });
  if (!c.internal) await notifyClientIfVisible(task, `New update on ${task.title}`, body.slice(0, 200));
  await activity({ actorId: req.user.id, action: 'task.comment', summary: `commented on ${task.key}`, taskId: task.id, projectId: task.projectId,
    clientVisible: !c.internal });
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
  if (task.status === 'todo') { task.status = 'in_progress'; await task.save(); broadcast(task); }
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

module.exports = { router, createTask, decorate, STATUS_LABEL, listIncludes };
