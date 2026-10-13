// Tools: automations, templates, import/export and global search.
const router = require('express').Router();
const { Op } = require('sequelize');
const {
  Automation, Template, Project, Task, User, Role, Client, Document, Section, TaskAssignee, Milestone, Activity, Attendance, PointEntry, Comment,
} = require('../models');
const { staffOnly, requirePerm } = require('../middleware/auth');
const { TRIGGERS, ACTIONS, RECIPES, handle } = require('../services/automations');
const { snapshotProject, countTasks } = require('../services/structure');
const { taskScope, visibleProjectIds } = require('../services/access');
const { STATUS_LABEL } = require('../services/taskFactory');

router.use(staffOnly);
const wrap = (f) => (req, res) => f(req, res).catch((e) => {
  if (!e.status) console.error(e);
  res.status(e.status || 500).json({ error: e.message });
});
const canAutomate = (req) => req.can('settings.manage') || req.can('automations.manage');

// ---------- automations ----------
router.get('/automations', wrap(async (req, res) => {
  const rows = await Automation.findAll({ include: [{ model: User, as: 'creator', attributes: ['id', 'name'] }], order: [['active', 'DESC'], ['createdAt', 'DESC']] });
  res.json({ rules: rows, triggers: TRIGGERS, actions: ACTIONS, recipes: RECIPES, canEdit: canAutomate(req) });
}));

function cleanRule(b) {
  if (!b.name?.trim()) return [null, 'Name the automation.'];
  if (!TRIGGERS[b.trigger]) return [null, 'Pick when the automation should run.'];
  const actions = (b.actions || []).filter((a) => ACTIONS[a?.type]);
  if (!actions.length) return [null, 'Add at least one action.'];
  const conditions = Object.fromEntries(Object.entries(b.conditions || {}).filter(([k, v]) => ['status', 'fromStatus', 'priority', 'projectId', 'tag', 'decision', 'clientVisible'].includes(k) && v !== '' && v != null && v !== 0));
  return [{ name: b.name.trim().slice(0, 120), description: b.description || '', trigger: b.trigger, conditions, actions, active: b.active !== false }, null];
}

router.post('/automations/recipe', wrap(async (req, res) => {
  if (!canAutomate(req)) return res.status(403).json({ error: 'Only admins and project managers can create automations.' });
  const r = RECIPES.find((x) => x.key === req.body.key);
  if (!r) return res.status(404).json({ error: 'Recipe not found.' });
  const { key, group, ...rule } = r;
  const conditions = { ...rule.conditions, ...(req.body.projectId ? { projectId: Number(req.body.projectId) } : {}) };
  res.status(201).json(await Automation.create({ ...rule, conditions, active: true, createdById: req.user.id }));
}));

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

router.post('/templates', requirePerm('projects.manage', 'templates.manage'), wrap(async (req, res) => {
  const b = req.body;
  let structure = b.structure;
  if (b.fromProjectId) {
    const p = await Project.findByPk(b.fromProjectId);
    if (!p) return res.status(404).json({ error: 'Project not found.' });
    structure = await snapshotProject(p);
  }
  if (!b.name?.trim()) return res.status(400).json({ error: 'Name the template.' });
  if (!structure?.sections?.length && !structure?.tasks?.length) return res.status(400).json({ error: 'A template needs at least one stage.' });
  structure = { sections: [], milestones: [], tasks: [], ...structure };
  const t = await Template.create({ name: b.name.trim(), description: b.description || '', category: b.category || 'General', icon: b.icon || '📦', structure, createdById: req.user.id });
  res.status(201).json(t);
}));

router.patch('/templates/:id', requirePerm('templates.manage'), wrap(async (req, res) => {
  const t = await Template.findByPk(req.params.id);
  if (!t) return res.status(404).json({ error: 'Template not found.' });
  ['name', 'description', 'category', 'icon', 'structure'].forEach((k) => { if (req.body[k] !== undefined) t[k] = req.body[k]; });
  await t.save();
  res.json(t);
}));

router.delete('/templates/:id', requirePerm('templates.manage'), wrap(async (req, res) => {
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

// ---------- project bulk import / export (round-trip layout) ----------
const { canEditTask } = require('../services/access');

const IST = 'Asia/Kolkata';
const istDate = (d) => (d ? new Date(d).toLocaleDateString('en-CA', { timeZone: IST }) : '');
const istTime = (d) => (d ? new Date(d).toLocaleTimeString('en-GB', { timeZone: IST, hour: '2-digit', minute: '2-digit', hour12: false }) : '');
const istStamp = (d) => (d ? `${istDate(d)} ${istTime(d)}` : '');
const addDays = (n) => istDate(Date.now() + n * 86400000);
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const pad = (n) => String(n).padStart(2, '0');

/** Read a date the way people type it: 2026-10-15, 15/10/2026, 15-10-26, 15 Oct 2026. Returns 'YYYY-MM-DD', null (blank) or false (unreadable). */
function parseDay(v) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (m) return valid(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2], +m[1]);
  m = s.match(/^(\d{1,2})[\s-]+([a-z]{3})[a-z]*[\s,-]+(\d{4})/i);
  if (m && MONTHS.includes(m[2].toLowerCase())) return valid(+m[3], MONTHS.indexOf(m[2].toLowerCase()) + 1, +m[1]);
  m = s.match(/^([a-z]{3})[a-z]*\s+(\d{1,2}),?\s+(\d{4})/i);
  if (m && MONTHS.includes(m[1].toLowerCase())) return valid(+m[3], MONTHS.indexOf(m[1].toLowerCase()) + 1, +m[2]);
  return false;
  function valid(y, mo, d) {
    const dt = new Date(Date.UTC(y, mo - 1, d));
    return dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d ? `${y}-${pad(mo)}-${pad(d)}` : false;
  }
}
/** 18:00, 6 PM, 6:30pm, 18:00:00 -> 'HH:MM'. null if blank, false if unreadable. */
function parseTime(v) {
  const s = String(v ?? '').trim().toLowerCase();
  if (!s) return null;
  const m = s.match(/^(\d{1,2})(?:[:.](\d{2}))?(?::\d{2})?\s*(am|pm)?$/);
  if (!m) return false;
  let h = +m[1]; const min = +(m[2] || 0);
  if (m[3] === 'pm' && h < 12) h += 12;
  if (m[3] === 'am' && h === 12) h = 0;
  return h < 24 && min < 60 ? `${pad(h)}:${pad(min)}` : false;
}
const yes = (v) => ['yes', 'y', 'true', '1', 'visible'].includes(String(v ?? '').trim().toLowerCase());
const blank = (v) => v === undefined || v === null || String(v).trim() === '';

const COLUMNS = ['Key', 'Title', 'Description', 'Stage', 'Status', 'Priority', 'Assignees', 'Start date', 'Due date', 'Due time', 'Estimate hours', 'Story points', 'Tags', 'Parent task', 'Client visible'];
const sendCsv = (res, name, rows) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  res.send(`﻿${rows.map((r) => r.map(esc).join(',')).join('\r\n')}`);
};
async function visibleProject(req) {
  const p = await Project.findByPk(req.params.id, { include: [{ model: Section }] });
  if (!p) return null;
  const ids = await visibleProjectIds(req);
  return !ids || ids.includes(p.id) ? p : null;
}
const stagesOf = (p) => (p.Sections || []).slice().sort((a, b) => a.order - b.order || a.id - b.id);

// Sample file built from this project's own pipeline stages, with dates from today.
router.get('/projects/:id/sample.csv', wrap(async (req, res) => {
  const p = await visibleProject(req);
  if (!p) return res.status(404).json({ error: 'Project not found.' });
  const stages = stagesOf(p).map((s) => s.name);
  if (!stages.length) stages.push('');
  const me = req.user.email || req.user.name;
  const times = ['11:00', '14:30', '18:00', '10:00', '16:00', '12:00'];
  const rows = stages.slice(0, 10).map((st, i) => ['', `Example task ${i + 1}${st ? ` (${st})` : ''}`, `Replace with your own task. Stage must match a pipeline stage${st ? ` like "${st}"` : ''}.`,
    st, i === 0 ? 'To do' : (i === 1 ? 'In progress' : 'To do'), ['high', 'medium', 'medium', 'low'][i % 4], me,
    addDays(i), addDays(i + 2), times[i % times.length], 2 + i, '', i === 0 ? 'example; kickoff' : 'example', '', i === 0 ? 'no' : 'yes']);
  rows.push(['', 'Example subtask', 'Rows with a Parent task become subtasks. Use the parent title from this file or an existing task key.', stages[0], 'To do', 'medium', me,
    addDays(0), addDays(1), '17:30', 1, '', 'example', rows[0][1], 'no']);
  if (p.pipeline?.review !== false) rows.push(['', 'Example: send for client review', 'Status can be To do, In progress, In review, Blocked or Done.', stages[stages.length - 1], 'In review', 'high', me, addDays(3), addDays(5), '6 PM', '', 3, 'example', '', 'yes']);
  sendCsv(res, `${p.code}-sample-import.csv`, [COLUMNS, ...rows]);
}));

// Every task in the project in the same layout, so the file can be edited and imported back.
router.get('/projects/:id/tasks.csv', wrap(async (req, res) => {
  const p = await visibleProject(req);
  if (!p) return res.status(404).json({ error: 'Project not found.' });
  const tasks = await Task.findAll({ where: { [Op.and]: [await taskScope(req), { projectId: p.id }] },
    include: [{ model: User, as: 'assignees', attributes: ['name', 'email'], through: { attributes: [] } }, { model: Section, attributes: ['name'] }, { model: User, as: 'creator', attributes: ['name'] }],
    order: [['parentId', 'ASC'], ['position', 'ASC'], ['id', 'ASC']] });
  const keyById = Object.fromEntries(tasks.map((t) => [t.id, t.key]));
  const extra = ['Created at', 'Created by', 'Started at', 'Completed at', 'Updated at'];
  const rows = tasks.map((t) => [t.key, t.title, t.description, t.Section?.name || '', STATUS_LABEL[t.status], t.priority,
    t.assignees.map((a) => a.email || a.name).join('; '), t.startDate || '', istDate(t.dueDate), istTime(t.dueDate), t.estimateHours ?? '', t.storyPoints ?? '',
    (t.tags || []).join('; '), keyById[t.parentId] || '', t.clientVisible ? 'yes' : 'no',
    istStamp(t.createdAt), t.creator?.name || '', istStamp(t.startedAt), istStamp(t.completedAt), istStamp(t.updatedAt)]);
  sendCsv(res, `${p.code}-tasks-${istDate(new Date())}.csv`, [[...COLUMNS, ...extra], ...rows]);
}));

/*
 * rows: [{ key, title, description, stage|section, status, priority, assignee, start, due, due_time, estimate, points, tags, parent, client_visible }]
 * A row whose key matches a task in the project updates it; other rows create tasks. Blank cells leave a value alone on update.
 * Dates: YYYY-MM-DD, DD/MM/YYYY or 15 Oct 2026. Time: 18:00 or 6 PM, India time. A due date without a time is due at 6 PM.
 */
router.post('/import/tasks', wrap(async (req, res) => {
  const { projectId, rows = [], dryRun = false } = req.body;
  const project = projectId ? await Project.findByPk(projectId) : null;
  if (projectId && !project) return res.status(404).json({ error: 'Project not found.' });
  if (project) { const ids = await visibleProjectIds(req); if (ids && !ids.includes(project.id)) return res.status(404).json({ error: 'Project not found.' }); }
  if (!Array.isArray(rows) || !rows.length) return res.status(400).json({ error: 'The file has no rows.' });
  if (rows.length > 1000) return res.status(400).json({ error: 'Import up to 1000 rows at a time.' });
  const { createTask } = require('./tasks');
  const people = await User.findAll({ where: { isActive: true }, attributes: ['id', 'name', 'email'] });
  const findPerson = (s) => { const v = String(s || '').trim().toLowerCase(); return v && people.find((p) => p.email?.toLowerCase() === v || p.name.toLowerCase() === v || p.name.toLowerCase().split(' ')[0] === v)?.id; };
  const statusMap = Object.fromEntries(Object.entries(STATUS_LABEL).flatMap(([k, v]) => [[k, k], [v.toLowerCase(), k], [k.replace('_', ' '), k]]));
  Object.assign(statusMap, { review: 'review', 'in review': 'review', completed: 'done', complete: 'done', open: 'todo', 'to-do': 'todo', 'not started': 'todo', doing: 'in_progress' });
  const existing = project ? await Task.findAll({ where: { projectId: project.id }, attributes: ['id', 'key', 'title'] }) : [];
  const byKey = Object.fromEntries(existing.map((t) => [String(t.key).toUpperCase(), t.id]));
  const byTitle = {};
  const sections = project ? await Section.findAll({ where: { projectId: project.id } }) : [];
  const sectionByName = Object.fromEntries(sections.map((s) => [s.name.trim().toLowerCase(), s]));
  let maxOrder = sections.reduce((m, s) => Math.max(m, s.order || 0), -1);
  let created = 0; let updated = 0; const errors = []; const warnings = []; const newStages = [];

  const stageId = async (name) => {
    const n = String(name || '').trim();
    if (!n || !project) return undefined;
    let s = sectionByName[n.toLowerCase()];
    if (!s) {
      if (dryRun) { if (!newStages.includes(n)) newStages.push(n); return undefined; }
      maxOrder += 1;
      s = await Section.create({ projectId: project.id, name: n.slice(0, 80), order: maxOrder });
      sectionByName[n.toLowerCase()] = s; newStages.push(n);
    }
    return s.id;
  };

  for (const [i, raw] of rows.entries()) {
    const line = `Row ${i + 2}`;
    try {
      const r = { ...raw, stage: raw.stage ?? raw.section };
      const key = String(r.key || '').trim().toUpperCase();
      const targetId = key ? byKey[key] : null;
      if (key && !targetId) warnings.push(`${line}: no task ${key} in this project, so a new task was created`);
      if (!targetId && blank(r.title)) { errors.push(`${line}: no title`); continue; }

      const start = parseDay(r.start);
      if (start === false) { errors.push(`${line}: can't read start date "${r.start}"`); continue; }
      let dueDay = parseDay(r.due); let dueTime = parseTime(r.due_time);
      if (dueDay === false && /T|\d\s+\d/.test(String(r.due))) { const d = new Date(r.due); if (!Number.isNaN(d.getTime())) { dueDay = istDate(d); dueTime = dueTime || istTime(d); } }
      else if (dueDay && !dueTime) { const tm = String(r.due).match(/\s(\d{1,2}[:.]\d{2}(?:\s*[ap]m)?|\d{1,2}\s*[ap]m)$/i); if (tm) dueTime = parseTime(tm[1]); }
      if (dueDay === false) { errors.push(`${line}: can't read due date "${r.due}"`); continue; }
      if (dueTime === false) { errors.push(`${line}: can't read due time "${r.due_time}" (use 18:00 or 6 PM)`); continue; }
      const due = dueDay ? new Date(`${dueDay}T${dueTime || '18:00'}:00+05:30`) : null;
      if (!dueDay && dueTime) warnings.push(`${line}: due time without a due date was ignored`);
      if (start && dueDay && start > dueDay) warnings.push(`${line}: start date is after the due date`);

      const status = blank(r.status) ? undefined : statusMap[String(r.status).trim().toLowerCase()];
      if (!blank(r.status) && !status) warnings.push(`${line}: unknown status "${r.status}", left as To do`);
      const pr = String(r.priority || '').trim().toLowerCase();
      const priority = ['low', 'medium', 'high', 'urgent'].includes(pr) ? pr : undefined;
      const names = String(r.assignee || '').split(/[;,]/).map((x) => x.trim()).filter(Boolean);
      const assigneeIds = names.map(findPerson);
      names.forEach((n, j) => { if (!assigneeIds[j]) warnings.push(`${line}: no teammate called "${n}"`); });
      const tags = blank(r.tags) ? undefined : String(r.tags).split(/[;,]/).map((x) => x.trim()).filter(Boolean);
      const parentRef = String(r.parent || '').trim();
      const parentId = parentRef ? (byKey[parentRef.toUpperCase()] || byTitle[parentRef.toLowerCase()]) : null;
      if (parentRef && !parentId) warnings.push(`${line}: parent "${parentRef}" not found, added as a top-level task`);
      const num = (v) => (blank(v) || Number.isNaN(Number(v)) ? undefined : Number(v));

      if (dryRun) { targetId ? (updated += 1) : (created += 1); if (!targetId) byTitle[String(r.title).trim().toLowerCase()] = -1; await stageId(r.stage); continue; }

      if (targetId) {
        const task = await Task.findByPk(targetId, { include: [{ model: User, as: 'assignees', attributes: ['id'], through: { attributes: [] } }] });
        if (!(await canEditTask(req, task))) { errors.push(`${line}: you can't edit ${key}`); continue; }
        const sid = await stageId(r.stage);
        const patch = { title: blank(r.title) ? undefined : String(r.title).trim(), description: blank(r.description) ? undefined : r.description, priority, tags,
          startDate: start || undefined, dueDate: due || undefined, sectionId: sid, estimateHours: num(r.estimate), storyPoints: num(r.points),
          clientVisible: blank(r.client_visible) ? undefined : yes(r.client_visible) };
        Object.entries(patch).forEach(([k, v]) => { if (v !== undefined) task[k] = v; });
        if (due) { task.reminderSentAt = null; task.overdueNotifiedAt = null; }
        await task.save();
        if (names.length && req.can('tasks.assign')) await task.setAssignees(assigneeIds.filter(Boolean));
        if (status && status !== task.status) await require('./tasks').applyStatus(req, task, status, { notifyPeople: false });
        updated += 1;
      } else {
        if (!req.can('tasks.create')) { errors.push(`${line}: your role can't create tasks`); continue; }
        const t = await createTask(req, {
          title: String(r.title).trim(), description: r.description || '', projectId: project?.id || null, parentId: parentId || null,
          status: status || 'todo', priority: priority || 'medium', dueDate: due, startDate: start || null, sectionId: (await stageId(r.stage)) || null,
          estimateHours: num(r.estimate) ?? null, storyPoints: num(r.points) ?? null, assigneeIds: assigneeIds.filter(Boolean), tags: tags || [],
          ...(blank(r.client_visible) ? {} : { clientVisible: yes(r.client_visible) }),
        }, { silent: true });
        byTitle[String(r.title).trim().toLowerCase()] = t.id;
        byKey[String(t.key).toUpperCase()] = t.id;
        created += 1;
      }
    } catch (e) { errors.push(`${line}: ${e.message}`); }
  }
  res.json({ created, updated, errors: errors.slice(0, 100), warnings: [...new Set(warnings)].slice(0, 100), newStages, dryRun: !!dryRun });
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
