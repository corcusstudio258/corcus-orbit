// Client portal API — everything here is scoped to the signed-in client's own projects
// and only to tasks/comments/files the team has marked as visible to the client.
const router = require('express').Router();
const { Op } = require('sequelize');
const { Project, Task, Milestone, Activity, User, Role, Comment, Attachment, ClientRequest, Client, Document, Meeting, ClientFile } = require('../models');
const profile = require('../services/clientProfile');
const settings = require('../services/settings');
const { clientOnly } = require('../middleware/auth');
const { projectProgress, taskProgressMap } = require('../services/progress');
const { notify, activity } = require('../services/notify');
const socket = require('../services/socket');
const { emit } = require('../services/events');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const media = require('../services/media');
const UPLOAD_DIR = path.resolve(__dirname, '../..', process.env.UPLOAD_DIR || './uploads');
const imageUpload = multer({
  storage: multer.diskStorage({ destination: UPLOAD_DIR, filename: (q, f, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${path.extname(f.originalname).toLowerCase()}`) }),
  limits: { fileSize: 15 * 1024 * 1024 }, fileFilter: (q, f, cb) => cb(null, /^image\//.test(f.mimetype)),
});
const commentInclude = [
  { model: User, as: 'author', attributes: ['id', 'name', 'color', 'designation'], include: [{ model: Role, attributes: ['isClientRole'] }] },
  { model: Attachment, as: 'images', attributes: ['id', 'originalName', 'mime', 'size'] },
];

router.use(clientOnly);
const wrap = (f) => (req, res) => f(req, res).catch((e) => res.status(e.status || 500).json({ error: e.message }));

const projectWhere = (req) => ({ clientId: req.user.clientId, clientVisible: true, status: { [Op.ne]: 'archived' } });
const teamAttrs = ['id', 'name', 'color', 'designation'];

/** Safe shape of a task for clients. */
const clean = (t, progress) => ({
  id: t.id, key: t.key, title: t.title, description: t.descClientVisible === false ? '' : t.description, status: t.status, priority: t.priority,
  descReviewStatus: t.descClientVisible === false ? 'none' : t.descReviewStatus, descReviewNote: t.descReviewNote, descReviewedAt: t.descReviewedAt,
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
  const briefs = visible.filter((t) => t.descReviewStatus === 'requested' && t.descClientVisible !== false && String(t.description || '').trim());
  const upcoming = visible.filter((t) => t.status !== 'done' && t.dueDate).sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate)).slice(0, 6);
  const feed = await Activity.findAll({ where: { projectId: ids, clientVisible: true }, order: [['createdAt', 'DESC']], limit: 20,
    include: [{ model: User, as: 'actor', attributes: ['id', 'name', 'color'] }, { model: Project, attributes: ['id', 'name', 'color'] }] });
  const clientJson = client.toJSON(); delete clientJson.secrets;
  const reviewFiles = visible.length ? await Attachment.findAll({ where: { taskId: visible.map((t) => t.id), clientVisible: true, commentId: null, clientReviewStatus: ['requested', 'none'] }, order: [['createdAt', 'DESC']], limit: 12 }) : [];
  res.json({
    client: clientJson,
    reviewFiles: reviewFiles.map((f) => { const t = visible.find((x) => x.id === f.taskId); return { id: f.id, name: f.originalName, mime: f.mime, createdAt: f.createdAt, task: { id: t.id, key: t.key, title: t.title }, project: t.Project }; }),
    projects: projects.map((p) => {
      const own = all.filter((t) => t.projectId === p.id);
      return { id: p.id, name: p.name, code: p.code, color: p.color, status: p.status, description: p.description,
        startDate: p.startDate, dueDate: p.dueDate, owner: p.owner, progress: projectProgress(own),
        milestones: p.Milestones.sort((a, b) => a.order - b.order),
        visibleTasks: visible.filter((t) => t.projectId === p.id).length,
        doneTasks: visible.filter((t) => t.projectId === p.id && t.status === 'done').length };
    }),
    awaitingReview: awaiting.map((t) => ({ ...clean(t, pm), project: t.Project })),
    briefs: briefs.map((t) => ({ ...clean(t, pm), project: t.Project })),
    upcoming: upcoming.map((t) => ({ ...clean(t, pm), project: t.Project })),
    activity: feed,
    openRequests: await ClientRequest.count({ where: { clientId: req.user.clientId, status: 'open' } }),
    meetings: await Meeting.findAll({ where: { clientId: req.user.clientId, inviteClient: true, startAt: { [Op.gte]: new Date(Date.now() - 3600e3) } },
      attributes: ['id', 'title', 'agenda', 'startAt', 'endAt', 'link', 'location'], order: [['startAt', 'ASC']], limit: 5 }),
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
    docs: await Document.findAll({ where: { projectId: p.id, clientVisible: true, visibility: 'workspace' }, attributes: ['id', 'title', 'icon', 'updatedAt'], order: [['updatedAt', 'DESC']] }),
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
  const comments = await Comment.findAll({ where: { taskId: t.id, internal: false }, order: [['createdAt', 'ASC']], include: commentInclude });
  const files = await Attachment.findAll({ where: { taskId: t.id, clientVisible: true, commentId: null } });
  res.json({ ...clean(t, pm), project: { id: t.Project.id, name: t.Project.name, color: t.Project.color },
    subtasks: subs.map((s) => clean(s, pm)), comments,
    files: files.map((f) => ({ id: f.id, name: f.originalName, originalName: f.originalName, size: f.size, mime: f.mime, createdAt: f.createdAt, reviewStatus: f.clientReviewStatus === 'requested' || f.clientReviewStatus === 'none' ? 'pending' : f.clientReviewStatus, clientReviewStatus: f.clientReviewStatus, forReview: f.forReview })) });
}));

router.post('/tasks/:id/comments', imageUpload.array('images', 6), wrap(async (req, res) => {
  const t = await visibleTask(req, req.params.id);
  if (!t) return res.status(404).json({ error: 'Task not found.' });
  const files = req.files || [];
  const body = String(req.body.body || '').trim();
  if (!body && !files.length) return res.status(400).json({ error: 'Write a message or add an image first.' });
  let target = null;
  if (req.body.attachmentId) {
    target = await Attachment.findOne({ where: { id: req.body.attachmentId, taskId: t.id, clientVisible: true } });
    if (!target) return res.status(400).json({ error: 'That file is not shared with you.' });
  }
  const n = (v) => (v === undefined || v === '' || v === null ? null : Number(v));
  const brief = !target && req.body.kind === 'brief';
  if (brief && (t.descClientVisible === false || !String(t.description || '').trim())) return res.status(400).json({ error: 'There are no details to comment on.' });
  const c = await Comment.create({ taskId: t.id, userId: req.user.id, body, internal: false, kind: target ? 'review' : brief ? 'brief' : 'comment', attachmentId: target?.id || null,
    pinX: n(req.body.pinX), pinY: n(req.body.pinY), pinTime: n(req.body.pinTime) });
  if (files.length) await media.compressAll(await Attachment.bulkCreate(files.map((f) => ({ taskId: t.id, commentId: c.id, userId: req.user.id, originalName: f.originalname, fileName: f.filename, mime: f.mimetype, size: f.size, clientVisible: true, forReview: false }))), UPLOAD_DIR);
  if (target && target.clientReviewStatus !== 'changes') { target.clientReviewStatus = 'changes'; target.clientReviewedAt = new Date(); await target.save(); }
  emit('task.client_comment', { task: t, actor: { id: req.user.id, name: req.user.name } });
  await notify({ userIds: [...t.assignees.map((a) => a.id), t.createdById, t.Project.ownerId], type: 'task_comment',
    title: brief ? `Client comment on the description of ${t.key}` : `Client message on ${t.key}`, body: `${req.user.name}: ${body.slice(0, 200)}`, link: `/tasks/${t.id}` });
  await activity({ actorId: req.user.id, action: 'client.comment', summary: `left a message on ${t.key}`, taskId: t.id, projectId: t.projectId, clientVisible: true });
  socket.toStaff('task:changed', { id: t.id, projectId: t.projectId });
  res.status(201).json(await Comment.findByPk(c.id, { include: commentInclude }));
}));

// Client approves one file or asks for changes on it.
router.post('/files/:aid/review', wrap(async (req, res) => {
  const a = await Attachment.findByPk(req.params.aid);
  const t = a && a.clientVisible ? await visibleTask(req, a.taskId) : null;
  if (!t) return res.status(404).json({ error: 'File not found.' });
  const approve = req.body.decision === 'approve';
  a.clientReviewStatus = approve ? 'approved' : 'changes'; a.clientReviewedAt = new Date(); await a.save();
  const note = String(req.body.note || '').trim();
  if (note || !approve) await Comment.create({ taskId: t.id, userId: req.user.id, internal: false, kind: 'review', attachmentId: a.id, body: note || 'Changes requested on this file.' });
  await notify({ userIds: [...t.assignees.map((x) => x.id), t.createdById, t.Project.ownerId], type: 'approval_result',
    title: approve ? `Client approved ${a.originalName}` : `Client wants changes to ${a.originalName}`, body: note || `${t.key} ${t.title}`, link: `/tasks/${t.id}?tab=review` });
  await activity({ actorId: req.user.id, action: approve ? 'client.file_approved' : 'client.file_changes', summary: `${approve ? 'approved' : 'asked for changes on'} ${a.originalName} (${t.key})`, taskId: t.id, projectId: t.projectId, clientVisible: true });
  socket.toStaff('task:changed', { id: t.id, projectId: t.projectId });
  emit('task.client_review', { task: t, decision: approve ? 'approve' : 'changes', note, file: { name: a.originalName }, actor: { id: req.user.id, name: req.user.name } });
  res.json({ ok: true, clientReviewStatus: a.clientReviewStatus });
}));

// Client approves the task description (brief, caption, script) or asks for changes to it.
router.post('/tasks/:id/description-review', wrap(async (req, res) => {
  const t = await visibleTask(req, req.params.id);
  if (!t || t.descClientVisible === false || !String(t.description || '').trim()) return res.status(404).json({ error: 'Nothing to review here.' });
  const approve = req.body.decision === 'approve';
  const note = String(req.body.note || '').trim().slice(0, 4000);
  if (!approve && !note) return res.status(400).json({ error: 'Tell the team what to change.' });
  t.descReviewStatus = approve ? 'approved' : 'changes'; t.descReviewNote = note || null; t.descReviewedAt = new Date();
  await t.save();
  await Comment.create({ taskId: t.id, userId: req.user.id, internal: false, kind: 'brief',
    body: approve ? `Approved the description${note ? `: ${note}` : '.'}` : `Requested changes: ${note}` });
  await notify({ userIds: [...t.assignees.map((a) => a.id), t.createdById, t.Project.ownerId], type: 'approval_result',
    title: approve ? `Client approved the description of ${t.key}` : `Client wants changes to the description of ${t.key}`, body: note || t.title, link: `/tasks/${t.id}` });
  await activity({ actorId: req.user.id, action: approve ? 'client.desc_approved' : 'client.desc_changes',
    summary: approve ? `approved the description of ${t.key}` : `asked for changes to the description of ${t.key}`, taskId: t.id, projectId: t.projectId, clientVisible: true });
  socket.toStaff('task:changed', { id: t.id, projectId: t.projectId });
  res.json({ ok: true, descReviewStatus: t.descReviewStatus });
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
  emit('task.client_review', { task: t, decision: approve ? 'approve' : 'changes', note, actor: { id: req.user.id, name: req.user.name } });
  socket.toStaff('task:changed', { id: t.id, projectId: t.projectId });
  res.json({ ok: true, status: t.status });
}));

// ---------- business profile, logo and documents ----------
router.get('/profile', wrap(async (req, res) => {
  const c = await Client.scope('withSecrets').findByPk(req.user.clientId);
  const files = await ClientFile.findAll({ where: { clientId: c.id }, order: [['createdAt', 'DESC']], include: [{ model: User, as: 'uploader', attributes: ['id', 'name'] }] });
  const form = await profile.publicForm();
  const savedSecrets = Object.keys(profile.decrypt(c.secrets));
  const prefill = {};
  (await settings.get('onboarding')).questions.forEach((q) => { if (q.maps && c[q.maps]) prefill[q.id] = c[q.maps]; });
  res.json({ client: { id: c.id, name: c.name, email: c.email, phone: c.phone, whatsapp: c.whatsapp, industry: c.industry, city: c.city, website: c.website, logo: c.logo, color: c.color, status: c.status },
    answers: { ...prefill, ...(c.onboarding || {}) }, savedSecrets, questions: form.questions, files });
}));

router.patch('/profile', wrap(async (req, res) => {
  const c = await Client.scope('withSecrets').findByPk(req.user.clientId);
  let incoming = req.body.answers || {};
  if (typeof incoming === 'string') { try { incoming = JSON.parse(incoming); } catch { incoming = {}; } }
  const { answers, secrets, mapped, error } = await profile.readAnswers({ ...(c.onboarding || {}), ...incoming }, { partial: true });
  if (error) return res.status(400).json({ error });
  c.onboarding = { ...(c.onboarding || {}), ...answers };
  if (Object.keys(secrets).length) c.secrets = profile.encrypt({ ...profile.decrypt(c.secrets), ...secrets });
  ['name', 'email', 'phone', 'whatsapp', 'industry', 'city', 'website'].forEach((k) => { if (mapped[k]) c[k] = mapped[k]; });
  if (req.body.website !== undefined) c.website = String(req.body.website).slice(0, 250);
  await c.save();
  socket.toStaff('client:changed', { id: c.id });
  res.json({ ok: true });
}));

router.post('/files', profile.upload.array('files', 10), wrap(async (req, res) => {
  const c = await Client.findByPk(req.user.clientId);
  const category = ['logo', 'brand', 'document', 'other'].includes(req.body.category) ? req.body.category : 'document';
  const rows = await profile.saveFiles(c, req.files, category, req.user.id);
  const staff = (await User.findAll({ where: { isActive: true }, include: [Role] })).filter((u) => !u.Role?.isClientRole && (u.Role?.permissions || []).some((p) => ['clients.manage', 'clients.view'].includes(p)));
  await notify({ userIds: staff.map((u) => u.id), type: 'client_request', title: `${c.name} uploaded ${category === 'logo' ? 'a new logo' : `${rows.length} file${rows.length > 1 ? 's' : ''}`}`, body: rows.map((r) => r.originalName).join(', '), link: `/clients/${c.id}` });
  res.status(201).json(rows);
}));

router.delete('/files/:fid', wrap(async (req, res) => {
  const c = await Client.findByPk(req.user.clientId);
  const f = await ClientFile.findOne({ where: { id: req.params.fid, clientId: c.id } });
  if (!f || f.userId !== req.user.id) return res.status(403).json({ error: 'You can only remove files you uploaded.' });
  await profile.removeFile(c, f.id);
  res.json({ ok: true });
}));

router.get('/docs/:id', wrap(async (req, res) => {
  const d = await Document.findByPk(req.params.id, { include: [{ model: Project, attributes: ['id', 'name', 'clientId', 'clientVisible'] }] });
  if (!d || !d.clientVisible || d.visibility !== 'workspace' || d.Project?.clientId !== req.user.clientId || !d.Project.clientVisible) return res.status(404).json({ error: 'Document not found.' });
  res.json({ id: d.id, title: d.title, icon: d.icon, content: d.content, updatedAt: d.updatedAt, project: { id: d.Project.id, name: d.Project.name } });
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
