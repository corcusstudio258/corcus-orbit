const router = require('express').Router();
const { Op } = require('sequelize');
const { Task, Project, User, AiInsight, Meeting, TaskAssignee } = require('../models');
const { staffOnly } = require('../middleware/auth');
const ai = require('../services/ai');
const ctxs = require('../services/aiContext');
const { computeHealth } = require('../services/health');
const { visibleProjectIds, canEditTask } = require('../services/access');
const { STATUS_LABEL, PRIORITIES } = require('../services/taskFactory');
const settings = require('../services/settings');
const { TRIGGERS, ACTIONS } = require('../services/automations');
const { S } = ai;

router.use(staffOnly);

const wrap = (f) => (req, res) => f(req, res).catch((e) => {
  if (!(e instanceof ai.AiError) && !e.status) console.error('[ai]', e);
  res.status(e.status || 500).json({ error: e.message, code: e.code });
});

const PRIORITY = S.enum(['low', 'medium', 'high', 'urgent'], 'Task priority');
const STATUS = S.enum(Object.keys(STATUS_LABEL), 'Task status');

/** "2026-10-14" → 18:00 IST that day; "2026-10-14T11:30" → that time IST. */
function parseDue(v, { endOfDay = true } = {}) {
  if (!v) return null;
  const s = String(v).trim();
  let d;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) d = new Date(`${s}T${endOfDay ? '18:00' : '10:00'}:00+05:30`);
  else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(s)) d = new Date(`${s.length === 16 ? `${s}:00` : s}+05:30`);
  else d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function company() { return (await settings.get('company')).name; }

async function resolveProject(req, codeOrId) {
  if (!codeOrId) return null;
  const pids = await visibleProjectIds(req);
  const where = /^\d+$/.test(String(codeOrId)) ? { id: Number(codeOrId) } : { code: String(codeOrId).toUpperCase() };
  const p = await Project.findOne({ where: { ...where, ...(pids ? { id: pids } : {}) } });
  return p || null;
}

async function validUserIds(ids) {
  const clean = [...new Set((ids || []).map(Number).filter(Boolean))];
  if (!clean.length) return [];
  return (await User.findAll({ where: { id: clean, isActive: true, clientId: null }, attributes: ['id'], raw: true })).map((u) => u.id);
}

async function cached(userId, kind, scope, maxAgeMs) {
  const row = await AiInsight.findOne({ where: { userId, kind, scope, createdAt: { [Op.gte]: new Date(Date.now() - maxAgeMs) } }, order: [['createdAt', 'DESC']] });
  return row;
}

const TASK_DRAFT = S.obj({
  title: S.str('Short imperative task title, max 90 characters'),
  description: S.str('Useful details, links or acceptance criteria in plain text. Empty if none.'),
  projectCode: S.str('Code of the matching project from the list. Every task must belong to a project; pick the closest match, or empty only if truly unclear'),
  assigneeIds: S.arr(S.int('Team member id'), 'Ids from the team list. Empty if nobody was named.'),
  due: S.str('Due date as YYYY-MM-DD or YYYY-MM-DDTHH:mm (IST). Empty if not mentioned.'),
  startDate: S.str('Start date as YYYY-MM-DD, empty if not mentioned'),
  priority: PRIORITY,
  tags: S.arr(S.str('lowercase tag'), 'Up to 4 short tags'),
  checklist: S.arr(S.str('checklist step'), 'Concrete steps if the request lists them'),
  subtasks: S.arr(S.str('subtask title'), 'Separate deliverables that deserve their own subtask'),
  estimateHours: S.num('Rough effort in hours, 0 if unclear'),
}, ['title', 'priority']);

// ---------- status ----------
router.get('/status', wrap(async (req, res) => res.json(req.can('ai.use') ? await ai.status() : { enabled: false, ready: false, blocked: true })));
router.use((req, res, next) => (req.can('ai.use') || ['/brief', '/health'].includes(req.path) ? next() : res.status(403).json({ error: 'Your role does not include Orbit AI. Ask an admin to switch it on in Roles & access.' })));

// ---------- Ask Orbit (assistant) ----------
router.post('/ask', wrap(async (req, res) => {
  const messages = (req.body.messages || []).slice(-12);
  const last = messages.pop();
  if (!last?.text?.trim()) return res.status(400).json({ error: 'Ask a question first.' });
  const ctx = await ctxs.workspaceContext(req, { projectId: req.body.projectId });
  const system = `You are Orbit, the AI teammate inside ${await company()}'s work management app (a creative & digital marketing agency in Patna, India).
${ctx.now}
You are talking to ${ctx.me.name} (${ctx.me.role}).
Rules:
- Use ONLY the workspace data below. If something isn't in the data, say so plainly. Never invent tasks, people or numbers.
- Keep answers short and scannable: markdown, bold for task keys, bullet lists for lists. Mention task keys like **KAS-12** so the user can open them.
- Match the user's language (English, Hindi or Hinglish).
- When the user asks you to create, assign, reschedule, reprioritise or change status of tasks, propose it in "actions" (the user confirms with one click). Don't claim it's done. Use team ids for assignees and project codes for projects.
- Suggest up to 3 short follow-up questions.

WORKSPACE DATA (JSON):
${JSON.stringify(ctx)}`;
  const schema = S.obj({
    reply: S.str('Markdown answer to show the user'),
    actions: S.arr(S.obj({
      type: S.enum(['create_task', 'update_task'], 'What to do'),
      label: S.str('One-line human summary of the action, e.g. "Create KAS task: Diwali reel, Rahul, due Fri"'),
      taskKey: S.str('For update_task: the key of the task to change'),
      task: TASK_DRAFT,
      changes: S.obj({ status: STATUS, priority: PRIORITY, due: S.str('YYYY-MM-DD or YYYY-MM-DDTHH:mm'), assigneeIds: S.arr(S.int('team id'), 'Full new assignee list') }, []),
    }, ['type', 'label']), 'Proposed changes, empty when none were asked for'),
    followUps: S.arr(S.str('short follow-up question'), 'Up to 3'),
  }, ['reply']);
  const out = await ai.generate({ system, prompt: last.text, history: messages, schema, temperature: 0.3 });
  res.json({ reply: out.reply || '', actions: (out.actions || []).slice(0, 8), followUps: (out.followUps || []).slice(0, 3) });
}));

// Execute one confirmed assistant action with the user's own permissions.
router.post('/execute', wrap(async (req, res) => {
  const a = req.body.action || {};
  const { createTask, applyStatus } = require('./tasks');
  if (a.type === 'create_task') {
    if (!req.can('tasks.create')) return res.status(403).json({ error: "Your role can't create tasks." });
    const t = a.task || {};
    const project = await resolveProject(req, t.projectCode || t.projectId || a.projectId);
    if (!project) return res.status(400).json({ error: 'Which project should this task go in? Every task belongs to a project. Add the project name and try again.' });
    const task = await createTask(req, {
      title: t.title, description: t.description, projectId: project?.id || null, priority: PRIORITIES.includes(t.priority) ? t.priority : 'medium',
      dueDate: parseDue(t.due), startDate: t.startDate || null, assigneeIds: await validUserIds(t.assigneeIds), tags: t.tags || [],
      checklist: t.checklist || [], estimateHours: t.estimateHours || null, clientVisible: false,
    });
    for (const st of (t.subtasks || []).slice(0, 15)) await createTask(req, { title: st, parentId: task.id, assigneeIds: await validUserIds(t.assigneeIds) }, { silent: true });
    return res.json({ ok: true, message: `Created ${task.key}`, taskId: task.id, key: task.key });
  }
  if (a.type === 'update_task') {
    const task = await Task.findOne({ where: { key: String(a.taskKey || '').toUpperCase() } });
    if (!task) return res.status(404).json({ error: `Couldn't find ${a.taskKey}.` });
    if (!(await canEditTask(req, task))) return res.status(403).json({ error: `You can't edit ${task.key}.` });
    const c = a.changes || {};
    if (c.priority && PRIORITIES.includes(c.priority)) task.priority = c.priority;
    if (c.due) { const d = parseDue(c.due); if (d) { task.dueDate = d; task.reminderSentAt = null; task.overdueNotifiedAt = null; } }
    await task.save();
    if (Array.isArray(c.assigneeIds) && c.assigneeIds.length) {
      if (!req.can('tasks.assign')) return res.status(403).json({ error: "Your role can't assign tasks." });
      await task.setAssignees(await validUserIds(c.assigneeIds));
    }
    let notice = null;
    if (c.status && STATUS_LABEL[c.status]) ({ notice } = await applyStatus(req, task, c.status));
    require('../services/socket').toStaff('task:changed', { id: task.id, projectId: task.projectId, kind: 'updated' });
    return res.json({ ok: true, message: notice || `Updated ${task.key}`, taskId: task.id, key: task.key });
  }
  res.status(400).json({ error: 'Unknown action.' });
}));

// ---------- natural language → task draft ----------
router.post('/parse-task', wrap(async (req, res) => {
  const text = String(req.body.text || '').trim();
  if (!text) return res.status(400).json({ error: 'Describe the task first.' });
  const team = await ctxs.team();
  const pids = await visibleProjectIds(req);
  const projects = await Project.findAll({ where: { ...(pids ? { id: pids } : {}), status: { [Op.notIn]: ['archived', 'completed'] } }, attributes: ['id', 'code', 'name'] });
  const hint = req.body.projectId ? (await Project.findByPk(req.body.projectId, { attributes: ['code'] }))?.code : null;
  const out = await ai.generate({
    system: `Turn a quick note into a well-formed task for an agency task manager. ${ctxs.nowLine()} Resolve relative dates ("kal" = tomorrow, "parso" = day after tomorrow, "Friday", "next week" = next Monday). Default due time 6 PM. Only use team ids and project codes from the lists. ${hint ? `Default project: ${hint}.` : ''}
TEAM: ${JSON.stringify(team.map(({ id, name, designation }) => ({ id, name, designation })))}
PROJECTS: ${JSON.stringify(projects.map((p) => ({ code: p.code, name: p.name })))}`,
    prompt: text, schema: TASK_DRAFT, temperature: 0.2,
  });
  const project = await resolveProject(req, out.projectCode || hint);
  const due = parseDue(out.due);
  res.json({
    title: out.title, description: out.description || '', projectId: project?.id || req.body.projectId || '', priority: PRIORITIES.includes(out.priority) ? out.priority : 'medium',
    assigneeIds: await validUserIds(out.assigneeIds), dueDate: due ? due.toISOString() : '', startDate: out.startDate || '', tags: out.tags || [],
    checklist: out.checklist || [], subtasks: out.subtasks || [], estimateHours: out.estimateHours || '',
  });
}));

// ---------- break a task into subtasks ----------
router.post('/breakdown', wrap(async (req, res) => {
  const task = await Task.findByPk(req.body.taskId, { include: [{ model: Project, attributes: ['name'] }] });
  if (!task) return res.status(404).json({ error: 'Task not found.' });
  const existing = await Task.findAll({ where: { parentId: task.id }, attributes: ['title'], raw: true });
  const out = await ai.generate({
    system: `You are a senior project manager at a creative & digital marketing agency. Break work into clear, independently assignable subtasks (3 to 8), each a concrete deliverable with a verb-first title. ${ctxs.nowLine()}`,
    prompt: `Task: ${task.key} "${task.title}"\nProject: ${task.Project?.name || 'Personal'}\nDescription: ${task.description || '(none)'}\nDue: ${task.dueDate ? new Date(task.dueDate).toISOString().slice(0, 10) : 'not set'}\nAlready has subtasks: ${existing.map((e) => e.title).join('; ') || 'none'}\nExtra guidance: ${req.body.hint || 'none'}`,
    schema: S.obj({ subtasks: S.arr(S.obj({ title: S.str('verb-first subtask title'), estimateHours: S.num('effort hours'), priority: PRIORITY, daysBeforeParentDue: S.int('how many days before the parent due date this should be done, 0 if same day') }, ['title']), '3 to 8 subtasks') }, ['subtasks']),
    temperature: 0.4,
  });
  res.json({ subtasks: (out.subtasks || []).slice(0, 10).map((s) => {
    let due = null;
    if (task.dueDate) { due = new Date(task.dueDate); due.setDate(due.getDate() - Math.max(0, Number(s.daysBeforeParentDue) || 0)); }
    return { title: s.title, estimateHours: s.estimateHours || null, priority: PRIORITIES.includes(s.priority) ? s.priority : task.priority, dueDate: due };
  }) });
}));

// ---------- write a description ----------
router.post('/describe', wrap(async (req, res) => {
  const task = await Task.findByPk(req.body.taskId, { include: [{ model: Project, attributes: ['name'] }] });
  if (!task) return res.status(404).json({ error: 'Task not found.' });
  const out = await ai.generate({
    system: 'Write a crisp brief for a task at a creative & marketing agency: 2-4 sentences of context and goal, then acceptance criteria. Plain text, no markdown headings.',
    prompt: `Task: ${task.title}\nProject: ${task.Project?.name || 'Personal'}\nCurrent notes: ${task.description || '(none)'}\nGuidance: ${req.body.hint || 'none'}`,
    schema: S.obj({ description: S.str('The brief'), checklist: S.arr(S.str('acceptance criterion'), '3-6 checks') }, ['description']),
  });
  res.json(out);
}));

// ---------- dashboard brief ----------
router.get('/brief', wrap(async (req, res) => {
  if (req.query.refresh !== '1') {
    const hit = await cached(req.user.id, 'brief', 'me', 4 * 3600e3);
    if (hit) return res.json({ ...hit.content, source: hit.source, at: hit.createdAt });
  }
  const cfg = await ai.config();
  let content; let source = 'gemini';
  if (cfg.ready) {
    try {
      const ctx = await ctxs.workspaceContext(req);
      content = await ai.generate({
        system: `You are an operations lead writing a morning brief for ${ctx.me.name} (${ctx.me.role}) at ${await company()}. ${ctx.now} Be specific: name task keys, projects and people. No fluff, no greetings.`,
        prompt: `Workspace data:\n${JSON.stringify(ctx)}\n\nWrite the brief.`,
        schema: S.obj({
          summary: S.str('One sentence: the single most important thing today'),
          highlights: S.arr(S.str('fact-based observation, max 20 words'), '2-4 highlights'),
          recommendations: S.arr(S.str('specific action, max 20 words'), '2-4 actions'),
          focusTaskKey: S.str('Key of the one task to start with'),
        }, ['summary', 'highlights', 'recommendations']),
        temperature: 0.3,
      });
    } catch (e) { content = null; source = 'rules'; }
  }
  if (!content) { content = await ctxs.ruleBrief(req); source = 'rules'; }
  const row = await AiInsight.create({ userId: req.user.id, kind: 'brief', scope: 'me', content, source });
  res.json({ ...content, source, at: row.createdAt });
}));

// ---------- standup ----------
router.post('/standup', wrap(async (req, res) => {
  const userId = req.body.userId && req.can('dashboard.team') ? Number(req.body.userId) : req.user.id;
  const base = await ctxs.ruleStandup(req, userId);
  const cfg = await ai.config();
  if (!cfg.ready) return res.json(base);
  try {
    const ids = (await TaskAssignee.findAll({ where: { userId }, raw: true })).map((r) => r.taskId);
    const tasks = await Task.findAll({ where: { id: ids, archived: false, [Op.or]: [{ status: { [Op.ne]: 'done' } }, { completedAt: { [Op.gte]: new Date(Date.now() - 2 * 864e5) } }] }, include: [{ model: Project, attributes: ['code'] }], limit: 60 });
    const out = await ai.generate({
      system: `Write a daily standup update for a teammate at ${await company()}. ${ctxs.nowLine()} Three short sections. Each bullet names the task key. Keep it human, not robotic.`,
      prompt: JSON.stringify(tasks.map((t) => ({ key: t.key, title: t.title, status: STATUS_LABEL[t.status], due: t.dueDate, completedAt: t.completedAt, priority: t.priority, project: t.Project?.code }))),
      schema: S.obj({ yesterday: S.arr(S.str('done item')), today: S.arr(S.str('planned item')), blockers: S.arr(S.str('blocker')), text: S.str('WhatsApp-ready standup using *bold* headings and • bullets') }, ['yesterday', 'today', 'blockers', 'text']),
    });
    res.json({ ...out, source: 'gemini' });
  } catch { res.json(base); }
}));

// ---------- reports ----------
const REPORT_TITLES = { weekly: 'Weekly summary', daily: 'Daily standup report', client: 'Client progress report', sprint: 'Sprint retrospective', team: 'Team performance', custom: 'Custom report' };

router.post('/report', wrap(async (req, res) => {
  const { type = 'weekly', from, to, projectIds = [], userIds = [], sections = [], instructions = '' } = req.body;
  const data = await ctxs.periodData(req, { from, to, projectIds: projectIds.map(Number), userIds: userIds.map(Number) });
  const title = `${REPORT_TITLES[type] || 'Report'}${projectIds.length === 1 ? `: ${(await Project.findByPk(projectIds[0]))?.name || ''}` : ''}`;
  let markdown = ctxs.ruleReport(type, data, title);
  let source = 'rules';
  const cfg = await ai.config();
  if (cfg.ready) {
    try {
      const audience = type === 'client' ? 'the client. Friendly, confident, outcome-focused; never blame team members or show internal numbers like hours per person.' : 'the agency team and its managers. Direct and specific.';
      markdown = await ai.generate({
        system: `You write ${REPORT_TITLES[type] || 'reports'} for ${await company()}. Audience: ${audience} Output GitHub-flavoured markdown with a # title, short summary paragraph, then sections. Use only the data provided. ${ctxs.nowLine()}`,
        prompt: `Title: ${title}\nInclude sections: ${sections.join(', ') || 'whatever is most useful'}\nExtra instructions: ${instructions || 'none'}\nDATA:\n${JSON.stringify(data)}`,
        temperature: 0.4, maxTokens: 6000,
      });
      source = 'gemini';
    } catch (e) { /* keep rule-based */ }
  }
  const row = await AiInsight.create({ userId: req.user.id, kind: 'report', scope: type, content: { title, type, markdown, period: data.period, totals: data.totals }, source });
  res.json({ id: row.id, title, type, markdown, period: data.period, totals: data.totals, source });
}));

router.get('/reports', wrap(async (req, res) => {
  const rows = await AiInsight.findAll({ where: { userId: req.user.id, kind: 'report' }, order: [['createdAt', 'DESC']], limit: 30 });
  res.json(rows.map((r) => ({ id: r.id, title: r.content?.title, type: r.scope, period: r.content?.period, source: r.source, createdAt: r.createdAt })));
}));
router.get('/reports/:id', wrap(async (req, res) => {
  const r = await AiInsight.findOne({ where: { id: req.params.id, userId: req.user.id, kind: 'report' } });
  if (!r) return res.status(404).json({ error: 'Report not found.' });
  res.json({ id: r.id, ...r.content, source: r.source, createdAt: r.createdAt });
}));
router.delete('/reports/:id', wrap(async (req, res) => {
  await AiInsight.destroy({ where: { id: req.params.id, userId: req.user.id, kind: 'report' } });
  res.json({ ok: true });
}));

// ---------- project planner ----------
router.post('/plan', wrap(async (req, res) => {
  const { brief, name, startDate, dueDate, clientName } = req.body;
  if (!brief?.trim()) return res.status(400).json({ error: 'Describe the project first.' });
  const days = startDate && dueDate ? Math.max(1, Math.round((new Date(dueDate) - new Date(startDate)) / 864e5)) : null;
  const out = await ai.generate({
    system: `You are a senior delivery manager at a creative & digital marketing agency in India (social media, Meta ads, branding, websites). Create a realistic project plan: 3-6 sections (workstreams), 2-5 milestones, 8-25 top-level tasks with subtasks where helpful. Every date is an offset in days from project start. ${days ? `The project runs ${days} days; keep every offset between 0 and ${days}.` : 'Pick a sensible duration.'}`,
    prompt: `Project: ${name || 'Untitled'}\nClient: ${clientName || 'n/a'}\nBrief: ${brief}`,
    schema: S.obj({
      summary: S.str('Two-sentence plan overview'),
      sections: S.arr(S.obj({ name: S.str('workstream name') }, ['name'])),
      milestones: S.arr(S.obj({ title: S.str('milestone'), offsetDays: S.int('days from start') }, ['title', 'offsetDays'])),
      tasks: S.arr(S.obj({
        title: S.str('verb-first task title'), description: S.str('one-line detail'), section: S.str('matching section name'),
        priority: PRIORITY, offsetDays: S.int('due, days from start'), durationDays: S.int('working days needed'),
        estimateHours: S.num('effort hours'), milestone: S.str('milestone title this task completes, or empty'),
        subtasks: S.arr(S.obj({ title: S.str('subtask'), offsetDays: S.int('due, days from start') }, ['title'])),
      }, ['title', 'section', 'priority', 'offsetDays'])),
    }, ['sections', 'milestones', 'tasks']),
    temperature: 0.5, maxTokens: 8000,
  });
  res.json(out);
}));

// ---------- meeting notes → summary + action items ----------
router.post('/meeting-notes', wrap(async (req, res) => {
  const meeting = req.body.meetingId ? await Meeting.findByPk(req.body.meetingId, { include: [{ model: User, as: 'attendees', attributes: ['id', 'name'], through: { attributes: [] } }] }) : null;
  const notes = String(req.body.notes || meeting?.notes || '').trim();
  if (!notes) return res.status(400).json({ error: 'Paste the meeting notes first.' });
  const team = await ctxs.team();
  const out = await ai.generate({
    system: `Summarise agency meeting notes. ${ctxs.nowLine()} Extract decisions and concrete action items with owners (team ids) and due dates when stated. Notes may be in Hinglish.
TEAM: ${JSON.stringify(team.map(({ id, name }) => ({ id, name })))}`,
    prompt: `Meeting: ${meeting?.title || 'Meeting'}\nAttendees: ${meeting?.attendees?.map((a) => a.name).join(', ') || 'n/a'}\nNOTES:\n${notes}`,
    schema: S.obj({
      summary: S.str('3-5 sentence summary'),
      decisions: S.arr(S.str('decision')),
      actionItems: S.arr(S.obj({ title: S.str('verb-first action'), assigneeIds: S.arr(S.int('team id')), due: S.str('YYYY-MM-DD or empty'), priority: PRIORITY }, ['title'])),
    }, ['summary', 'decisions', 'actionItems']),
  });
  out.actionItems = await Promise.all((out.actionItems || []).map(async (a) => ({ ...a, assigneeIds: await validUserIds(a.assigneeIds), dueDate: parseDue(a.due) })));
  if (meeting) { meeting.notes = notes; meeting.aiSummary = out; await meeting.save(); }
  res.json(out);
}));

// ---------- automation from plain English ----------
router.post('/automation', wrap(async (req, res) => {
  const text = String(req.body.text || '').trim();
  if (!text) return res.status(400).json({ error: 'Describe the rule first.' });
  const team = await ctxs.team();
  const pids = await visibleProjectIds(req);
  const projects = await Project.findAll({ where: pids ? { id: pids } : {}, attributes: ['id', 'code', 'name'] });
  const out = await ai.generate({
    system: `Convert a plain-English workflow rule into a structured automation.
TRIGGERS: ${JSON.stringify(TRIGGERS)}
ACTIONS: ${JSON.stringify(ACTIONS)}
Recipients ("to"): assignees, creator, managers, project_owner, watchers, user (with userId), phone (whatsapp only).
Message templates can use {{task.key}}, {{task.title}}, {{project.name}}, {{actor.name}}, {{from}}, {{to}}.
TEAM: ${JSON.stringify(team.map(({ id, name }) => ({ id, name })))}
PROJECTS: ${JSON.stringify(projects.map((p) => ({ id: p.id, code: p.code, name: p.name })))}`,
    prompt: text,
    schema: S.obj({
      name: S.str('short rule name'), description: S.str('one-sentence description'),
      trigger: S.enum(Object.keys(TRIGGERS), 'when'),
      conditions: S.obj({ status: STATUS, fromStatus: STATUS, priority: PRIORITY, projectId: S.int('project id or 0'), tag: S.str('tag or empty') }, []),
      actions: S.arr(S.obj({
        type: S.enum(Object.keys(ACTIONS), 'action'), to: S.enum(['assignees', 'creator', 'managers', 'project_owner', 'watchers', 'user', 'phone'], 'recipients'),
        userId: S.int('for to=user or assign'), phone: S.str('for whatsapp to=phone'), title: S.str('notification title'), message: S.str('message template'),
        status: STATUS, priority: PRIORITY, points: S.int('reward points'), sectionName: S.str('section to move to'),
      }, ['type'])),
    }, ['name', 'trigger', 'actions']),
    temperature: 0.2,
  });
  const cond = Object.fromEntries(Object.entries(out.conditions || {}).filter(([, v]) => v !== '' && v !== 0 && v != null));
  res.json({ ...out, conditions: cond });
}));

// ---------- project health narrative ----------
router.get('/health', wrap(async (req, res) => {
  const pids = await visibleProjectIds(req);
  const health = await computeHealth(pids ? { projectIds: pids } : {});
  let narrative = null;
  if (req.query.narrative === '1') {
    const hit = req.query.refresh !== '1' ? await cached(req.user.id, 'health', 'all', 6 * 3600e3) : null;
    if (hit) narrative = { ...hit.content, source: hit.source };
    else if ((await ai.config()).ready) {
      try {
        const content = await ai.generate({
          system: `You are a delivery director reviewing portfolio health at ${await company()}. ${ctxs.nowLine()} Be direct and specific.`,
          prompt: JSON.stringify({ projects: health.projects, alerts: health.alerts.slice(0, 20) }),
          schema: S.obj({ summary: S.str('2-3 sentence portfolio read-out'), actions: S.arr(S.str('specific next action naming the project or person'), '3-5 actions') }, ['summary', 'actions']),
        });
        await AiInsight.create({ userId: req.user.id, kind: 'health', scope: 'all', content, source: 'gemini' });
        narrative = { ...content, source: 'gemini' };
      } catch (e) { narrative = { error: e.message }; }
    }
  }
  res.json({ ...health, narrative });
}));

// ---------- writing help (docs, client updates, comments) ----------
router.post('/write', wrap(async (req, res) => {
  const { mode = 'improve', text = '', instruction = '', context = '' } = req.body;
  const modes = {
    draft: 'Write the requested document in clean markdown with headings and lists.',
    improve: 'Improve clarity, structure and tone. Keep the meaning and the language (English/Hinglish). Return markdown.',
    shorten: 'Make it about half as long without losing key facts.',
    client_update: 'Rewrite as a warm, professional progress update to a client. Short paragraphs, no internal jargon.',
    summarize: 'Summarise into 3-6 bullet points.',
    translate_hi: 'Translate into simple Hindi (Devanagari).',
  };
  const out = await ai.generate({
    system: `You are a writing assistant at ${await company()}, a creative & digital marketing agency. ${modes[mode] || modes.improve} Output only the result.`,
    prompt: `${instruction ? `Instruction: ${instruction}\n` : ''}${context ? `Context: ${context}\n` : ''}Text:\n${text || '(empty, write from the instruction)'}`,
    temperature: 0.6, maxTokens: 6000,
  });
  res.json({ text: out });
}));

module.exports = router;
