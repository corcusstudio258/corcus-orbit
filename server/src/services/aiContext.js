// Builds compact, permission-aware workspace snapshots for prompts, plus rule-based fallbacks
// so briefs, standups and reports still work without an AI key.
const { Op } = require('sequelize');
const { Task, Project, User, Role, Client, TaskAssignee, TimeLog } = require('../models');
const { taskScope, visibleProjectIds } = require('./access');
const { computeHealth } = require('./health');
const { projectProgress } = require('./progress');
const { STATUS_LABEL } = require('./taskFactory');

const DAY = 864e5;
const TZ = 'Asia/Kolkata';
const fmt = (d) => (d ? new Date(d).toLocaleString('en-IN', { timeZone: TZ, day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : null);
const isoDay = (d) => new Date(d).toLocaleDateString('en-CA', { timeZone: TZ });

function nowLine() {
  const d = new Date();
  return `Today is ${d.toLocaleDateString('en-IN', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}, ${d.toLocaleTimeString('en-IN', { timeZone: TZ, hour: 'numeric', minute: '2-digit' })} IST (${isoDay(d)}).`;
}

async function team() {
  const users = await User.findAll({ where: { isActive: true }, include: [{ model: Role, attributes: ['name', 'isClientRole', 'level'] }], attributes: ['id', 'name', 'designation', 'department', 'reportsToId'] });
  return users.filter((u) => !u.Role?.isClientRole).map((u) => ({ id: u.id, name: u.name, role: u.Role?.name, designation: u.designation, department: u.department, reportsTo: u.reportsToId }));
}

async function visibleTasks(req, { projectId, limit = 160 } = {}) {
  const and = [await taskScope(req), { archived: false }];
  if (projectId) and.push({ projectId });
  const tasks = await Task.findAll({
    where: { [Op.and]: and },
    attributes: ['id', 'key', 'title', 'status', 'priority', 'dueDate', 'projectId', 'parentId', 'completedAt', 'createdAt', 'updatedAt', 'estimateHours', 'storyPoints'],
    include: [{ model: User, as: 'assignees', attributes: ['id', 'name'], through: { attributes: [] } }, { model: Project, attributes: ['code', 'name'] }],
    order: [['updatedAt', 'DESC']], limit: 800,
  });
  const me = req.user.id;
  const now = Date.now();
  const score = (t) => {
    let s = 0;
    if (t.assignees.some((a) => a.id === me)) s += 50;
    if (t.status !== 'done' && t.dueDate && new Date(t.dueDate) < now) s += 40;
    if (t.priority === 'urgent') s += 25; else if (t.priority === 'high') s += 12;
    if (t.status === 'done') s -= 30;
    if (t.dueDate && new Date(t.dueDate) - now < 3 * DAY) s += 10;
    return s;
  };
  return tasks.sort((a, b) => score(b) - score(a)).slice(0, limit);
}

const taskLine = (t) => ({
  id: t.id, key: t.key, title: t.title, status: STATUS_LABEL[t.status], priority: t.priority,
  due: t.dueDate ? fmt(t.dueDate) : null, overdue: t.status !== 'done' && t.dueDate && new Date(t.dueDate) < Date.now(),
  project: t.Project?.code || 'personal', assignees: t.assignees.map((a) => a.name), subtask: !!t.parentId,
});

/** Everything the assistant needs to answer questions about the workspace. */
async function workspaceContext(req, { projectId } = {}) {
  const pids = await visibleProjectIds(req);
  const projects = await Project.findAll({ where: { ...(pids ? { id: pids } : {}), status: { [Op.ne]: 'archived' } }, include: [{ model: Client, attributes: ['name'] }, { model: User, as: 'owner', attributes: ['name'] }] });
  const health = await computeHealth({ projectIds: projects.map((p) => p.id) });
  const tasks = await visibleTasks(req, { projectId });
  return {
    now: nowLine(),
    me: { id: req.user.id, name: req.user.name, role: req.user.Role?.name },
    team: await team(),
    projects: projects.map((p) => {
      const h = health.projects.find((x) => x.id === p.id);
      return { id: p.id, code: p.code, name: p.name, client: p.Client?.name || 'internal', lead: p.owner?.name, status: p.status, due: p.dueDate, progress: h?.progress, health: h?.state, overdue: h?.overdue, open: h?.open };
    }),
    alerts: health.alerts.slice(0, 12).map((a) => `${a.severity}: ${a.title}`),
    tasks: tasks.map(taskLine),
  };
}

/** Data pack for reports and standups. */
async function periodData(req, { from, to, projectIds, userIds } = {}) {
  const start = from ? new Date(from) : new Date(Date.now() - 7 * DAY);
  const end = to ? new Date(`${String(to).slice(0, 10)}T23:59:59`) : new Date();
  const and = [await taskScope(req), { archived: false }];
  if (projectIds?.length) and.push({ projectId: projectIds });
  if (userIds?.length) {
    const rows = await TaskAssignee.findAll({ where: { userId: userIds }, raw: true });
    and.push({ id: rows.map((r) => r.taskId) });
  }
  const tasks = await Task.findAll({
    where: { [Op.and]: and },
    attributes: ['id', 'key', 'title', 'status', 'priority', 'dueDate', 'completedAt', 'createdAt', 'projectId', 'parentId', 'estimateHours'],
    include: [{ model: User, as: 'assignees', attributes: ['id', 'name'], through: { attributes: [] } }, { model: Project, attributes: ['id', 'code', 'name'] }],
  });
  const inRange = (d) => d && new Date(d) >= start && new Date(d) <= end;
  const completed = tasks.filter((t) => t.status === 'done' && inRange(t.completedAt));
  const created = tasks.filter((t) => inRange(t.createdAt));
  const open = tasks.filter((t) => t.status !== 'done');
  const overdue = open.filter((t) => t.dueDate && new Date(t.dueDate) < new Date());
  const logs = await TimeLog.findAll({ where: { taskId: tasks.map((t) => t.id), startedAt: { [Op.between]: [start, end] } }, include: [{ model: User, attributes: ['id', 'name'] }] });
  const minutesBy = {};
  logs.forEach((l) => { const n = l.User?.name || 'Someone'; minutesBy[n] = (minutesBy[n] || 0) + (l.minutes || 0); });
  const people = {};
  tasks.forEach((t) => t.assignees.forEach((a) => {
    people[a.name] = people[a.name] || { done: 0, open: 0, overdue: 0 };
    if (completed.includes(t)) people[a.name].done += 1;
    if (t.status !== 'done') people[a.name].open += 1;
    if (overdue.includes(t)) people[a.name].overdue += 1;
  }));
  const byProject = {};
  tasks.forEach((t) => { const k = t.Project?.name || 'Personal'; byProject[k] = byProject[k] || []; byProject[k].push({ id: t.id, parentId: t.parentId, status: t.status }); });
  return {
    period: { from: isoDay(start), to: isoDay(end) },
    totals: { created: created.length, completed: completed.length, open: open.length, overdue: overdue.length, inReview: open.filter((t) => t.status === 'review').length, blocked: open.filter((t) => t.status === 'blocked').length,
      completionRate: created.length ? Math.round((completed.length / Math.max(created.length, completed.length)) * 100) : (completed.length ? 100 : 0),
      hoursLogged: Math.round(Object.values(minutesBy).reduce((a, b) => a + b, 0) / 6) / 10 },
    priority: ['urgent', 'high', 'medium', 'low'].map((p) => ({ priority: p, open: open.filter((t) => t.priority === p).length })),
    completed: completed.slice(0, 60).map(taskLine),
    overdue: overdue.slice(0, 40).map(taskLine),
    upcoming: open.filter((t) => t.dueDate && new Date(t.dueDate) >= new Date() && new Date(t.dueDate) < new Date(Date.now() + 7 * DAY)).slice(0, 30).map(taskLine),
    people: Object.entries(people).map(([name, v]) => ({ name, ...v, hours: Math.round((minutesBy[name] || 0) / 6) / 10 })),
    projects: Object.entries(byProject).map(([name, ts]) => ({ name, progress: projectProgress(ts), tasks: ts.length })),
  };
}

// ---------- rule-based fallbacks ----------

async function ruleBrief(req) {
  const ctx = await workspaceContext(req);
  const mine = ctx.tasks.filter((t) => t.assignees.includes(req.user.name) && t.status !== 'Done');
  const overdue = mine.filter((t) => t.overdue);
  const urgent = mine.filter((t) => ['urgent', 'high'].includes(t.priority));
  const crit = ctx.alerts.filter((a) => a.startsWith('critical'));
  const highlights = [];
  if (overdue.length) highlights.push(`${overdue.length} of your tasks are overdue, starting with ${overdue[0].key} "${overdue[0].title}".`);
  if (urgent.length) highlights.push(`${urgent.length} high-priority tasks are on your plate.`);
  if (crit.length) highlights.push(crit[0].replace(/^critical: /, ''));
  if (!highlights.length) highlights.push('Nothing is on fire. A good day to get ahead on next week.');
  const recommendations = [];
  if (overdue.length) recommendations.push(`Clear or reschedule ${overdue.slice(0, 3).map((t) => t.key).join(', ')} before picking up new work.`);
  const atRisk = ctx.projects.filter((p) => p.health && p.health !== 'on_track');
  if (atRisk.length) recommendations.push(`Check in on ${atRisk.slice(0, 2).map((p) => p.name).join(' and ')}, which ${atRisk.length > 1 ? 'are' : 'is'} slipping.`);
  if (urgent.length) recommendations.push(`Block focus time for ${urgent[0].key}.`);
  if (!recommendations.length) recommendations.push('Review the backlog and plan tomorrow.');
  return { summary: highlights[0], highlights, recommendations, source: 'rules' };
}

async function ruleStandup(req, userId) {
  const user = userId ? await User.findByPk(userId) : req.user;
  const ids = (await TaskAssignee.findAll({ where: { userId: user.id }, raw: true })).map((r) => r.taskId);
  const since = new Date(Date.now() - 1.2 * DAY);
  const tasks = await Task.findAll({ where: { id: ids, archived: false }, attributes: ['id', 'key', 'title', 'status', 'dueDate', 'completedAt', 'priority'] });
  const yesterday = tasks.filter((t) => t.status === 'done' && t.completedAt && new Date(t.completedAt) >= since).map((t) => `${t.key} ${t.title}`);
  const inProgress = tasks.filter((t) => t.status === 'in_progress');
  const dueSoon = tasks.filter((t) => t.status !== 'done' && t.dueDate && new Date(t.dueDate) < new Date(Date.now() + 1.5 * DAY));
  const today = [...new Map([...inProgress, ...dueSoon].map((t) => [t.id, t])).values()].slice(0, 6).map((t) => `${t.key} ${t.title}`);
  const blockers = tasks.filter((t) => t.status === 'blocked').map((t) => `${t.key} ${t.title} is blocked`);
  const text = [`*Standup: ${user.name}*`, '', '*Done*', ...(yesterday.length ? yesterday.map((x) => `• ${x}`) : ['• Nothing closed yet']),
    '', '*Today*', ...(today.length ? today.map((x) => `• ${x}`) : ['• Planning and reviews']), '', '*Blockers*', ...(blockers.length ? blockers.map((x) => `• ${x}`) : ['• None'])].join('\n');
  return { yesterday, today, blockers, text, source: 'rules' };
}

function ruleReport(type, data, title) {
  const t = data.totals;
  const lines = [`# ${title}`, `${data.period.from} to ${data.period.to}`, '', '## Summary',
    `${t.completed} tasks completed and ${t.created} created. ${t.open} still open, ${t.overdue} overdue, ${t.inReview} waiting for review. ${t.hoursLogged} hours logged.`, ''];
  if (data.completed.length) lines.push('## Completed', ...data.completed.slice(0, 25).map((x) => `- ${x.key} ${x.title} (${x.project})`), '');
  if (data.overdue.length) lines.push('## Overdue', ...data.overdue.slice(0, 20).map((x) => `- ${x.key} ${x.title}, due ${x.due} (${x.assignees.join(', ') || 'unassigned'})`), '');
  if (data.upcoming.length) lines.push('## Coming up this week', ...data.upcoming.slice(0, 15).map((x) => `- ${x.key} ${x.title}, due ${x.due}`), '');
  if (type !== 'client' && data.people.length) lines.push('## Team', '| Person | Done | Open | Overdue | Hours |', '|---|---|---|---|---|', ...data.people.map((p) => `| ${p.name} | ${p.done} | ${p.open} | ${p.overdue} | ${p.hours} |`), '');
  if (data.projects.length) lines.push('## Projects', ...data.projects.map((p) => `- ${p.name}: ${p.progress}% complete`), '');
  return lines.join('\n');
}

module.exports = { workspaceContext, periodData, team, nowLine, isoDay, ruleBrief, ruleStandup, ruleReport, visibleTasks, taskLine };
