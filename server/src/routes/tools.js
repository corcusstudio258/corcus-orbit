// Tools: automations, templates, import/export and global search.
const router = require('express').Router();
const { Op } = require('sequelize');
const {
  Automation, Template, Project, Task, User, Role, Client, Document, Section, TaskAssignee, Milestone, Activity, Attendance, PointEntry, Comment,
} = require('../models');
const { staffOnly, requirePerm } = require('../middleware/auth');
const { TRIGGERS, ACTIONS, handle } = require('../services/automations');
const { snapshotProject, countTasks } = require('../services/structure');
const { taskScope, visibleProjectIds } = require('../services/access');
const { STATUS_LABEL } = require('../services/taskFactory');

router.use(staffOnly);
const wrap = (f) => (req, res) => f(req, res).catch((e) => {
  if (!e.status) console.error(e);
  res.status(e.status || 500).json({ error: e.message });
});
const canAutomate = (req) => req.can('settings.manage') || req.can('projects.manage');

// ---------- automations ----------
router.get('/automations', wrap(async (req, res) => {
  const rows = await Automation.findAll({ include: [{ model: User, as: 'creator', attributes: ['id', 'name'] }], order: [['active', 'DESC'], ['createdAt', 'DESC']] });
  res.json({ rules: rows, triggers: TRIGGERS, actions: ACTIONS, canEdit: canAutomate(req) });
}));

function cleanRule(b) {
  if (!b.name?.trim()) return [null, 'Name the automation.'];
  if (!TRIGGERS[b.trigger]) return [null, 'Pick when the automation should run.'];
  const actions = (b.actions || []).filter((a) => ACTIONS[a?.type]);
  if (!actions.length) return [null, 'Add at least one action.'];
  const conditions = Object.fromEntries(Object.entries(b.conditions || {}).filter(([k, v]) => ['status', 'fromStatus', 'priority', 'projectId', 'tag'].includes(k) && v !== '' && v != null && v !== 0));
  return [{ name: b.name.trim().slice(0, 120), description: b.description || '', trigger: b.trigger, conditions, actions, active: b.active !== false }, null];
}

router.post('/automations', wrap(async (req, res) => {
  if (!canAutomate(req)) return res.status(403).json({ error: 'Only admins and project managers can create automations.' });
  const [data, err] = cleanRule(req.body);
  if (err) return res.status(400).json({ error: err });
  res.status(201).json(await Automation.create({ ...data, createdById: req.user.id }));
}));

router.patch('/automations/:id', wrap(async (req, res) => {
  if (!canAutomate(req)) return res.status(403).json({ error: 'Only admins and project managers can edit automations.' });
  const a = await Automation.findByPk(req.params.id);
  if (!a) return res.status(404).json({ error: 'Automation not found.' });
  if (Object.keys(req.body).length === 1 && req.body.active !== undefined) { a.active = !!req.body.active; await a.save(); return res.json(a); }
  const [data, err] = cleanRule({ ...a.toJSON(), ...req.body });
  if (err) return res.status(400).json({ error: err });
  await a.update(data);
  res.json(a);
}));

router.delete('/automations/:id', wrap(async (req, res) => {
  if (!canAutomate(req)) return res.status(403).json({ error: 'Only admins and project managers can delete automations.' });
  await Automation.destroy({ where: { id: req.params.id } });
  res.json({ ok: true });
}));

router.post('/automations/:id/test', wrap(async (req, res) => {
  if (!canAutomate(req)) return res.status(403).json({ error: 'Not allowed.' });
  const a = await Automation.findByPk(req.params.id);
  const task = await Task.findOne({ where: req.body.taskKey ? { key: String(req.body.taskKey).toUpperCase() } : { id: req.body.taskId } });
  if (!a || !task) return res.status(404).json({ error: 'Pick a task to test on.' });
  const before = a.runs;
  await handle(a.trigger, { task, from: req.body.from || 'todo', to: a.conditions?.status || task.status, actor: { id: req.user.id, name: req.user.name } });
  await a.reload();
  res.json({ ran: a.runs > before, message: a.runs > before ? `Ran on ${task.key}.` : `Conditions didn't match ${task.key}, so nothing happened.` });
}));

// ---------- templates ----------
router.get('/templates', wrap(async (req, res) => {
  const rows = await Template.findAll({ include: [{ model: User, as: 'creator', attributes: ['id', 'name'] }], order: [['isSystem', 'DESC'], ['uses', 'DESC'], ['name', 'ASC']] });
  res.json(rows.map((t) => ({ ...t.toJSON(), taskCount: countTasks(t.structure), sectionCount: t.structure?.sections?.length || 0, milestoneCount: t.structure?.milestones?.length || 0 })));
}));

router.get('/templates/:id', wrap(async (req, res) => {
  const t = await Template.findByPk(req.params.id);
  if (!t) return res.status(404).json({ error: 'Template not found.' });
  res.json({ ...t.toJSON(), taskCount: countTasks(t.structure) });
}));

router.post('/templates', requirePerm('projects.manage'), wrap(async (req, res) => {
  const b = req.body;
  let structure = b.structure;
  if (b.fromProjectId) {
    const p = await Project.findByPk(b.fromProjectId);
    if (!p) return res.status(404).json({ error: 'Project not found.' });
    structure = await snapshotProject(p);
  }
  if (!b.name?.trim()) return res.status(400).json({ error: 'Name the template.' });
  if (!structure?.tasks?.length) return res.status(400).json({ error: 'A template needs at least one task.' });
  const t = await Template.create({ name: b.name.trim(), description: b.description || '', category: b.category || 'General', icon: b.icon || '📦', structure, createdById: req.user.id });
  res.status(201).json(t);
}));

router.patch('/templates/:id', requirePerm('projects.manage'), wrap(async (req, res) => {
  const t = await Template.findByPk(req.params.id);
  if (!t) return res.status(404).json({ error: 'Template not found.' });
  ['name', 'description', 'category', 'icon', 'structure'].forEach((k) => { if (req.body[k] !== undefined) t[k] = req.body[k]; });
  await t.save();
  res.json(t);
}));

router.delete('/templates/:id', requirePerm('projects.manage'), wrap(async (req, res) => {
  const t = await Template.findByPk(req.params.id);
  if (!t) return res.status(404).json({ error: 'Template not found.' });
  if (t.isSystem && !req.can('settings.manage')) return res.status(403).json({ error: 'Built-in templates can only be removed by an admin.' });
  await t.destroy();
  res.json({ ok: true });
}));

// ---------- import / export ----------
const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
const fmt = (d) => (d ? new Date(d).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : '');

router.get('/export/tasks.csv', wrap(async (req, res) => {
  const and = [await taskScope(req)];
  if (req.query.projectId) and.push({ projectId: req.query.projectId });
  const tasks = await Task.findAll({ where: { [Op.and]: and }, include: [{ model: User, as: 'assignees', attributes: ['name', 'email'], through: { attributes: [] } }, { model: Project, attributes: ['name', 'code'] }, { model: Section, attributes: ['name'] }], order: [['projectId', 'ASC'], ['position', 'ASC']] });
  const keyById = Object.fromEntries(tasks.map((t) => [t.id, t.key]));
  const head = ['Key', 'Title', 'Project', 'Section', 'Parent', 'Status', 'Priority', 'Assignees', 'Assignee emails', 'Start', 'Due', 'Completed', 'Estimate h', 'Story points', 'Tags', 'Description'];
  const rows = tasks.map((t) => [t.key, t.title, t.Project?.name || 'Personal', t.Section?.name, keyById[t.parentId] || '', STATUS_LABEL[t.status], t.priority,
    t.assignees.map((a) => a.name).join('; '), t.assignees.map((a) => a.email).join('; '), t.startDate, fmt(t.dueDate), fmt(t.completedAt), t.estimateHours, t.storyPoints, (t.tags || []).join('; '), t.description]);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="orbit-tasks.csv"');
  res.send(`﻿${[head, ...rows].map((r) => r.map(esc).join(',')).join('\n')}`);
}));

router.get('/export/projects.csv', wrap(async (req, res) => {
  const pids = await visibleProjectIds(req);
  const ps = await Project.findAll({ where: pids ? { id: pids } : {}, include: [{ model: Client, attributes: ['name'] }, { model: User, as: 'owner', attributes: ['name'] }] });
  const head = ['Code', 'Name', 'Client', 'Lead', 'Status', 'Start', 'Due', 'Budget', 'Spent', 'Currency'];
  const rows = ps.map((p) => [p.code, p.name, p.Client?.name, p.owner?.name, p.status, p.startDate, p.dueDate, p.budget, p.spent, p.currency]);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="orbit-projects.csv"');
  res.send(`﻿${[head, ...rows].map((r) => r.map(esc).join(',')).join('\n')}`);
}));

// rows: [{ title, description, status, priority, due, start, assignee (name or email; ; separated), section, tags, estimate, parent (title of an earlier row) }]
router.post('/import/tasks', wrap(async (req, res) => {
  if (!req.can('tasks.create')) return res.status(403).json({ error: "Your role can't create tasks." });
  const { projectId, rows = [] } = req.body;
  const project = projectId ? await Project.findByPk(projectId) : null;
  if (projectId && !project) return res.status(404).json({ error: 'Project not found.' });
  if (!rows.length) return res.status(400).json({ error: 'The file has no rows.' });
  if (rows.length > 1000) return res.status(400).json({ error: 'Import up to 1000 rows at a time.' });
  const { createTask } = require('./tasks');
  const people = await User.findAll({ where: { isActive: true }, attributes: ['id', 'name', 'email'] });
  const findPerson = (s) => { const v = String(s || '').trim().toLowerCase(); return people.find((p) => p.email.toLowerCase() === v || p.name.toLowerCase() === v || p.name.toLowerCase().split(' ')[0] === v)?.id; };
  const statusMap = Object.fromEntries(Object.entries(STATUS_LABEL).flatMap(([k, v]) => [[k, k], [v.toLowerCase(), k]]));
  const byTitle = {};
  let created = 0; const errors = [];
  for (const [i, r] of rows.entries()) {
    try {
      if (!String(r.title || '').trim()) { errors.push(`Row ${i + 2}: no title`); continue; }
      let sectionId = null;
      if (project && r.section) { const [sec] = await Section.findOrCreate({ where: { projectId: project.id, name: String(r.section).trim() } }); sectionId = sec.id; }
      const due = r.due ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(r.due) ? `${r.due}T18:00:00+05:30` : r.due) : null;
      const t = await createTask(req, {
        title: r.title, description: r.description || '', projectId: project?.id || null, parentId: byTitle[String(r.parent || '').trim().toLowerCase()] || null,
        status: statusMap[String(r.status || '').toLowerCase()] || 'todo', priority: ['low', 'medium', 'high', 'urgent'].includes(String(r.priority).toLowerCase()) ? String(r.priority).toLowerCase() : 'medium',
        dueDate: due && !Number.isNaN(due.getTime()) ? due : null, startDate: r.start || null, sectionId, estimateHours: Number(r.estimate) || null,
        assigneeIds: String(r.assignee || '').split(/[;,]/).map(findPerson).filter(Boolean), tags: String(r.tags || '').split(/[;,]/).map((x) => x.trim()).filter(Boolean),
      }, { silent: true });
      byTitle[String(r.title).trim().toLowerCase()] = t.id;
      created += 1;
    } catch (e) { errors.push(`Row ${i + 2}: ${e.message}`); }
  }
  res.json({ created, errors: errors.slice(0, 50) });
}));

router.get('/export/backup.json', requirePerm('settings.manage'), wrap(async (req, res) => {
  const dump = {};
  for (const [name, M] of Object.entries({ Project, Task, Section, Milestone, TaskAssignee, Client, Document, Activity, Attendance, PointEntry, Comment, Template, Automation })) {
    dump[name] = await M.findAll({ raw: true });
  }
  dump.User = await User.findAll({ raw: true, attributes: { exclude: ['passwordHash'] } });
  dump.Role = await Role.findAll({ raw: true });
  res.setHeader('Content-Disposition', `attachment; filename="orbit-backup-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json({ exportedAt: new Date(), ...dump });
}));

// ---------- global search (command palette) ----------
router.get('/search', wrap(async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json({ tasks: [], projects: [], people: [], clients: [], docs: [] });
  const like = { [Op.like]: `%${q}%` };
  const pids = await visibleProjectIds(req);
  const [tasks, projects, people, docs] = await Promise.all([
    Task.findAll({ where: { [Op.and]: [await taskScope(req), { archived: false }, { [Op.or]: [{ title: like }, { key: like }] }] }, attributes: ['id', 'key', 'title', 'status', 'priority'], include: [{ model: Project, attributes: ['name', 'color'] }], limit: 8, order: [['updatedAt', 'DESC']] }),
    Project.findAll({ where: { ...(pids ? { id: pids } : {}), [Op.or]: [{ name: like }, { code: like }] }, attributes: ['id', 'name', 'code', 'color', 'icon'], limit: 5 }),
    User.findAll({ where: { isActive: true, clientId: null, [Op.or]: [{ name: like }, { email: like }] }, attributes: ['id', 'name', 'color', 'designation'], limit: 5 }),
    Document.findAll({ where: { [Op.or]: [{ createdById: req.user.id }, { visibility: 'workspace' }], title: like }, attributes: ['id', 'title', 'icon'], limit: 5 }),
  ]);
  const clients = req.can('clients.view') || req.can('clients.manage') ? await Client.findAll({ where: { name: like }, attributes: ['id', 'name', 'color'], limit: 5 }) : [];
  res.json({ tasks, projects, people, clients, docs });
}));

module.exports = router;
