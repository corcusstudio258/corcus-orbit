// Rule-based project health + risk alerts. Works with no AI key; AI uses its output as context.
const { Op } = require('sequelize');
const { Project, Task, Activity, User, Client } = require('../models');
const { projectProgress } = require('./progress');

const DAY = 864e5;

async function computeHealth({ projectIds = null } = {}) {
  const where = { status: { [Op.in]: ['active', 'planning', 'on_hold'] } };
  if (projectIds) where.id = projectIds;
  const projects = await Project.findAll({ where, include: [{ model: Client, attributes: ['id', 'name'] }] });
  const ids = projects.map((p) => p.id);
  const tasks = ids.length ? await Task.findAll({ where: { projectId: ids, archived: false }, attributes: ['id', 'projectId', 'parentId', 'status', 'dueDate', 'priority', 'updatedAt'], raw: true }) : [];
  const weekAgo = new Date(Date.now() - 7 * DAY);
  const recent = ids.length ? await Activity.findAll({ where: { projectId: ids, createdAt: { [Op.gte]: weekAgo } }, attributes: ['projectId'], raw: true }) : [];
  const now = new Date();
  const alerts = [];
  const out = projects.map((p) => {
    const own = tasks.filter((t) => t.projectId === p.id);
    const open = own.filter((t) => t.status !== 'done');
    const overdue = open.filter((t) => t.dueDate && new Date(t.dueDate) < now);
    const blocked = open.filter((t) => t.status === 'blocked');
    const progress = projectProgress(own);
    let expected = null;
    if (p.startDate && p.dueDate) {
      const span = new Date(p.dueDate) - new Date(p.startDate);
      expected = span > 0 ? Math.min(100, Math.max(0, Math.round(((now - new Date(p.startDate)) / span) * 100))) : 100;
    }
    const daysLeft = p.dueDate ? Math.ceil((new Date(p.dueDate) - now) / DAY) : null;
    const activeThisWeek = recent.some((a) => a.projectId === p.id);
    const overdueRatio = open.length ? overdue.length / open.length : 0;

    let score = 100;
    score -= Math.round(overdueRatio * 40);
    if (!activeThisWeek && open.length) score -= 10;
    if (expected != null && expected > progress) score -= Math.min(30, Math.round((expected - progress) / 2));
    score -= Math.min(15, blocked.length * 5);
    if (p.budget > 0 && p.spent > p.budget) score -= 15;
    score = Math.max(0, Math.min(100, score));
    let state = score >= 75 ? 'on_track' : score >= 50 ? 'at_risk' : 'off_track';
    if (p.healthOverride) state = p.healthOverride;

    const base = { projectId: p.id, project: p.name };
    if (overdue.length >= 2 && overdueRatio >= 0.5) alerts.push({ ...base, severity: 'critical', kind: 'overdue', title: `${Math.round(overdueRatio * 100)}% of open work is overdue in ${p.name}`, detail: `${overdue.length} of ${open.length} open tasks are past due.`, suggestion: 'Reassign or reschedule the overdue tasks today.' });
    else if (overdue.length && overdueRatio >= 0.25) alerts.push({ ...base, severity: 'warning', kind: 'overdue', title: `Overdue work is building up in ${p.name}`, detail: `${overdue.length} of ${open.length} open tasks are past due.`, suggestion: 'Review due dates in the next stand-up.' });
    if (!activeThisWeek && open.length) alerts.push({ ...base, severity: 'warning', kind: 'stalled', title: `${p.name} has gone quiet`, detail: `${open.length} open tasks and no updates in 7 days.`, suggestion: 'Check in with the team and unblock work.' });
    if (daysLeft != null && daysLeft < 0 && progress < 100) alerts.push({ ...base, severity: 'critical', kind: 'deadline', title: `${p.name} is past its deadline`, detail: `${progress}% done, deadline was ${Math.abs(daysLeft)} days ago.`, suggestion: 'Agree a new date with the client or cut scope.' });
    else if (daysLeft != null && daysLeft <= 7 && progress < 70) alerts.push({ ...base, severity: 'warning', kind: 'deadline', title: `${daysLeft} days left on ${p.name}, ${progress}% done`, detail: `Deadline ${new Date(p.dueDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}.`, suggestion: 'Prioritise the remaining tasks or renegotiate the date.' });
    if (expected != null && expected - progress >= 25) alerts.push({ ...base, severity: 'warning', kind: 'behind', title: `${p.name} is behind schedule`, detail: `${progress}% done where the timeline expects about ${expected}%.`, suggestion: 'Add capacity or move the deadline.' });
    if (blocked.length) alerts.push({ ...base, severity: 'warning', kind: 'blocked', title: `${blocked.length} blocked task${blocked.length > 1 ? 's' : ''} in ${p.name}`, detail: 'Blocked work stops everything behind it.', suggestion: 'Clear the blockers first.' });
    if (p.budget > 0 && p.spent > p.budget) alerts.push({ ...base, severity: 'critical', kind: 'budget', title: `${p.name} is over budget`, detail: `Spent ${Math.round(p.spent)} of ${Math.round(p.budget)} ${p.currency}.`, suggestion: 'Review scope and billing with the client.' });
    else if (p.budget > 0 && p.spent > p.budget * 0.9) alerts.push({ ...base, severity: 'warning', kind: 'budget', title: `${p.name} has used ${Math.round((p.spent / p.budget) * 100)}% of its budget`, detail: `Spent ${Math.round(p.spent)} of ${Math.round(p.budget)} ${p.currency}.`, suggestion: 'Watch remaining hours closely.' });

    return {
      id: p.id, name: p.name, code: p.code, color: p.color, icon: p.icon, client: p.Client?.name || null, status: p.status,
      progress, expected, score, state, total: own.length, open: open.length, overdue: overdue.length, blocked: blocked.length,
      daysLeft, dueDate: p.dueDate, budget: p.budget, spent: p.spent, currency: p.currency, activeThisWeek,
    };
  });

  // People risks
  if (!projectIds) {
    const openTasks = await Task.findAll({ where: { status: { [Op.ne]: 'done' }, archived: false }, attributes: ['id', 'dueDate'], include: [{ model: User, as: 'assignees', attributes: ['id', 'name'], through: { attributes: [] } }] });
    const per = {};
    openTasks.forEach((t) => t.assignees.forEach((a) => {
      per[a.id] = per[a.id] || { name: a.name, open: 0, overdue: 0 };
      per[a.id].open += 1;
      if (t.dueDate && new Date(t.dueDate) < now) per[a.id].overdue += 1;
    }));
    Object.entries(per).forEach(([userId, v]) => {
      if (v.overdue >= 3) alerts.push({ userId: Number(userId), person: v.name, severity: 'warning', kind: 'person_overdue', title: `${v.name} has ${v.overdue} overdue tasks`, detail: 'Their overdue pile is growing.', suggestion: 'Reschedule or share the load.' });
      if (v.open >= 15) alerts.push({ userId: Number(userId), person: v.name, severity: 'warning', kind: 'overloaded', title: `${v.name} is carrying ${v.open} open tasks`, detail: 'That is more than one person can move this week.', suggestion: 'Rebalance work across the team.' });
    });
  }
  const order = { critical: 0, warning: 1, info: 2 };
  alerts.sort((a, b) => order[a.severity] - order[b.severity]);
  return { projects: out.sort((a, b) => a.score - b.score), alerts };
}

module.exports = { computeHealth };
