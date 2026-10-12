const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { Client, Project, User, Role, Task, ClientRequest, ClientFile } = require('../models');
const profile = require('../services/clientProfile');
const settings = require('../services/settings');
const mailer = require('../services/mailer');
const { requirePerm, staffOnly } = require('../middleware/auth');
const { projectProgress } = require('../services/progress');
const { notify, activity, whatsappDirect } = require('../services/notify');
const { createTask } = require('./tasks');
const socket = require('../services/socket');

router.use(staffOnly);

router.get('/', requirePerm('clients.view', 'clients.manage'), async (req, res) => {
  const clients = await Client.findAll({ order: [['name', 'ASC']], include: [{ model: Project, attributes: ['id', 'status'] }] });
  const tasks = await Task.findAll({ attributes: ['id', 'projectId', 'parentId', 'status'], raw: true });
  const openReq = await ClientRequest.findAll({ where: { status: 'open' }, attributes: ['clientId'], raw: true });
  res.json(clients.map((c) => {
    const pids = new Set(c.Projects.map((p) => p.id));
    const own = tasks.filter((t) => pids.has(t.projectId));
    const { secrets, ...json } = c.toJSON();
    return {
      ...json, hasSecrets: !!secrets, projectCount: c.Projects.length,
      activeProjects: c.Projects.filter((p) => p.status === 'active').length,
      progress: projectProgress(own), openRequests: openReq.filter((r) => r.clientId === c.id).length,
    };
  }));
});

router.get('/:id', requirePerm('clients.view', 'clients.manage'), async (req, res) => {
  const client = await Client.findByPk(req.params.id, {
    include: [
      { model: Project, include: [{ model: User, as: 'owner', attributes: ['id', 'name', 'color'] }] },
      { model: User, as: 'portalUsers', attributes: ['id', 'name', 'email', 'phone', 'isActive', 'lastSeenAt'] },
    ],
  });
  if (!client) return res.status(404).json({ error: 'Client not found.' });
  const pids = client.Projects.map((p) => p.id);
  const tasks = await Task.findAll({ where: { projectId: pids }, attributes: ['id', 'projectId', 'parentId', 'status'], raw: true });
  const requests = await ClientRequest.findAll({ where: { clientId: client.id }, order: [['createdAt', 'DESC']],
    include: [{ model: User, as: 'requester', attributes: ['id', 'name'] }, { model: Project, attributes: ['id', 'name'] },
      { model: Task, attributes: ['id', 'key', 'status'] }] });
  const json = client.toJSON();
  const withSecrets = await Client.scope('withSecrets').findByPk(client.id, { attributes: ['id', 'secrets'] });
  json.Projects = json.Projects.map((p) => ({ ...p, progress: projectProgress(tasks.filter((t) => t.projectId === p.id)) }));
  const files = await ClientFile.findAll({ where: { clientId: client.id }, order: [['createdAt', 'DESC']], include: [{ model: User, as: 'uploader', attributes: ['id', 'name'] }] });
  const form = await settings.get('onboarding');
  delete json.secrets;
  res.json({ ...json, requests, files, hasSecrets: !!withSecrets?.secrets, questions: form.questions.map(({ id, label, type, section }) => ({ id, label, type, section })) });
});

// Approve a client who signed up from the portal.
router.post('/:id/approve', requirePerm('clients.manage'), async (req, res) => {
  const c = await Client.findByPk(req.params.id);
  if (!c) return res.status(404).json({ error: 'Client not found.' });
  c.status = 'active'; c.approvedAt = new Date(); await c.save();
  const users = await User.findAll({ where: { clientId: c.id } });
  for (const u of users) { u.isActive = true; await u.save(); }
  const company = (await settings.get('company')).name;
  await notify({ userIds: users.map((u) => u.id), type: 'client_update', title: `Your ${company} portal is ready`, body: 'Sign in to follow your projects.', link: '/portal' });
  if (await mailer.ready()) {
    const origin = req.headers.origin || process.env.APP_URL || '';
    for (const u of users) mailer.send({ to: u.email, subject: `Your ${company} portal is ready`, html: await mailer.layout(`Welcome, ${u.name.split(' ')[0]}`, '<p>Your account is approved. Sign in to follow progress, review work and share files with the team.</p>', origin ? { url: `${origin}/login`, label: 'Open your portal' } : null) }).catch(() => {});
  }
  await activity({ actorId: req.user.id, action: 'client.approved_signup', summary: `approved the portal sign-up for ${c.name}` });
  res.json(c);
});

router.get('/:id/secrets', requirePerm('clients.manage'), async (req, res) => {
  const c = await Client.scope('withSecrets').findByPk(req.params.id);
  if (!c) return res.status(404).json({ error: 'Client not found.' });
  await activity({ actorId: req.user.id, action: 'client.secrets_viewed', summary: `viewed saved credentials for ${c.name}` });
  res.json(profile.decrypt(c.secrets));
});

router.post('/:id/files', requirePerm('clients.manage'), profile.upload.array('files', 10), async (req, res) => {
  const c = await Client.findByPk(req.params.id);
  if (!c) return res.status(404).json({ error: 'Client not found.' });
  try { res.status(201).json(await profile.saveFiles(c, req.files, ['logo', 'brand', 'document', 'other'].includes(req.body.category) ? req.body.category : 'document', req.user.id)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

router.delete('/:id/files/:fid', requirePerm('clients.manage'), async (req, res) => {
  const c = await Client.findByPk(req.params.id);
  if (!c) return res.status(404).json({ error: 'Client not found.' });
  try { await profile.removeFile(c, req.params.fid); res.json({ ok: true }); } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

router.post('/', requirePerm('clients.manage'), async (req, res) => {
  if (!req.body.name) return res.status(400).json({ error: 'Client name is required.' });
  const c = await Client.create(req.body);
  res.status(201).json(c);
});

router.patch('/:id', requirePerm('clients.manage'), async (req, res) => {
  const c = await Client.findByPk(req.params.id);
  if (!c) return res.status(404).json({ error: 'Client not found.' });
  const { secrets, id, ...rest } = req.body;
  await c.update(rest);
  const out = c.toJSON(); delete out.secrets;
  res.json(out);
});

// ---- Portal logins for a client ----
router.post('/:id/portal-users', requirePerm('clients.manage'), async (req, res) => {
  const client = await Client.findByPk(req.params.id);
  if (!client) return res.status(404).json({ error: 'Client not found.' });
  const { name, email, password, phone } = req.body;
  if (!name || !email || !password || password.length < 8) {
    return res.status(400).json({ error: 'Name, email and a password of at least 8 characters are required.' });
  }
  if (await User.findOne({ where: { email: email.toLowerCase().trim() } })) {
    return res.status(400).json({ error: 'Someone already uses this email.' });
  }
  const role = await Role.findOne({ where: { slug: 'client' } });
  const u = await User.create({ name, email: email.toLowerCase().trim(), phone, roleId: role.id, clientId: client.id,
    passwordHash: await bcrypt.hash(password, 10), color: client.color, designation: client.company || client.name });
  res.status(201).json(u);
});

router.patch('/:id/portal-users/:userId', requirePerm('clients.manage'), async (req, res) => {
  const u = await User.findOne({ where: { id: req.params.userId, clientId: req.params.id } });
  if (!u) return res.status(404).json({ error: 'Portal login not found.' });
  const { name, phone, isActive, password } = req.body;
  if (name !== undefined) u.name = name;
  if (phone !== undefined) u.phone = phone;
  if (isActive !== undefined) u.isActive = !!isActive;
  if (password) {
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    u.passwordHash = await bcrypt.hash(password, 10);
  }
  await u.save();
  res.json(u);
});

// ---- Client requests (raised from the portal) ----
router.get('/requests/all', requirePerm('clients.view', 'clients.manage'), async (req, res) => {
  const where = req.query.status ? { status: req.query.status } : {};
  res.json(await ClientRequest.findAll({ where, order: [['createdAt', 'DESC']],
    include: [Client, { model: Project, attributes: ['id', 'name', 'code'] }, { model: User, as: 'requester', attributes: ['id', 'name'] },
      { model: Task, attributes: ['id', 'key', 'status'] }] }));
});

router.patch('/requests/:rid', requirePerm('clients.manage', 'projects.manage'), async (req, res) => {
  const r = await ClientRequest.findByPk(req.params.rid, { include: [Client, Project] });
  if (!r) return res.status(404).json({ error: 'Request not found.' });
  const { status, response, convert, assigneeIds, dueDate } = req.body;
  if (convert) {
    const projectId = req.body.projectId || r.projectId;
    if (!projectId) return res.status(400).json({ error: 'Pick a project to create the task in.' });
    const task = await createTask(req, {
      title: r.title, description: r.description, priority: r.priority, projectId, assigneeIds, dueDate,
      clientVisible: true, tags: ['client-request'],
    });
    r.taskId = task.id; r.status = 'accepted';
  }
  if (status) r.status = status;
  if (response !== undefined) r.response = response;
  await r.save();
  const label = { accepted: 'accepted', declined: 'declined', done: 'completed' }[r.status] || r.status;
  if (r.userId) {
    await notify({ userIds: [r.userId], type: 'client_update', title: `Your request "${r.title}" was ${label}`,
      body: r.response || '', link: '/portal/requests', exclude: req.user.id });
  } else if (r.Client?.whatsapp) {
    await whatsappDirect(r.Client.whatsapp, `Your request "${r.title}" was ${label}`, r.response || '', 'client_update');
  }
  socket.toClient(r.clientId, 'request:changed', { id: r.id });
  await activity({ actorId: req.user.id, action: 'request.updated', summary: `${label} client request "${r.title}"`,
    projectId: r.projectId, taskId: r.taskId, clientVisible: true });
  res.json(r);
});

module.exports = router;
