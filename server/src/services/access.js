const { Op } = require('sequelize');
const { User, ProjectMember, Project, TaskAssignee, TaskReviewer, Task } = require('../models');

/** Everyone who reports to this user, directly or through others. */
async function subordinateIds(userId) {
  const all = await User.findAll({ attributes: ['id', 'reportsToId'], raw: true });
  const byManager = new Map();
  all.forEach((u) => {
    if (!byManager.has(u.reportsToId)) byManager.set(u.reportsToId, []);
    byManager.get(u.reportsToId).push(u.id);
  });
  const out = []; const stack = [userId]; const seen = new Set([userId]);
  while (stack.length) {
    for (const child of byManager.get(stack.pop()) || []) {
      if (!seen.has(child)) { seen.add(child); out.push(child); stack.push(child); }
    }
  }
  return out;
}

/** The people whose work this user may see: themselves, plus their reports when allowed. */
async function teamIds(req) {
  return req.can('tasks.view_team') ? [req.user.id, ...(await subordinateIds(req.user.id))] : [req.user.id];
}

/**
 * Project ids a staff user can see. null = all.
 * Only projects they own or were added to (as member or lead); with tasks.view_team also those of
 * people who report to them. Being assigned a task does NOT open the whole project.
 */
async function visibleProjectIds(req) {
  if (req.can('projects.view_all')) return null;
  const team = await teamIds(req);
  const member = await ProjectMember.findAll({ where: { userId: team }, attributes: ['projectId'], raw: true });
  const owned = await Project.findAll({ where: { ownerId: team }, attributes: ['id'], raw: true });
  return [...new Set([...member.map((m) => m.projectId), ...owned.map((p) => p.id)].filter(Boolean))];
}

/**
 * Sequelize where-clause for tasks a staff user can see.
 * view_all → everything. Otherwise: tasks in projects they can see, tasks they created,
 * and tasks assigned to them (or, with tasks.view_team, to anyone who reports to them).
 */
async function taskScope(req) {
  if (req.can('tasks.view_all')) return {};
  const team = await teamIds(req);
  const assigned = await TaskAssignee.findAll({ where: { userId: team }, attributes: ['taskId'], raw: true });
  // "See every project" lists all projects but doesn't open every task, so use membership here.
  const member = await ProjectMember.findAll({ where: { userId: team }, attributes: ['projectId'], raw: true });
  const owned = await Project.findAll({ where: { ownerId: team }, attributes: ['id'], raw: true });
  const reviewing = await TaskReviewer.findAll({ where: { userId: req.user.id }, attributes: ['taskId'], raw: true });
  return {
    [Op.or]: [
      { id: [...assigned.map((a) => a.taskId), ...reviewing.map((r) => r.taskId)] },
      { createdById: team },
      { projectId: [...new Set([...member.map((m) => m.projectId), ...owned.map((p) => p.id)])] },
    ],
  };
}

async function canSeeTask(req, task) {
  if (req.isClient) {
    if (!task.clientVisible) return false;
    const p = await Project.findByPk(task.projectId, { attributes: ['clientId', 'clientVisible'] });
    return !!p && p.clientId === req.user.clientId && p.clientVisible;
  }
  if (req.can('tasks.view_all')) return true;
  const scope = await taskScope(req);
  return !!(await Task.count({ where: { [Op.and]: [{ id: task.id }, scope] } }));
}

/** Edit rights: edit_all, the creator, an assignee, or the manager (any level) of an assignee. */
async function canEditTask(req, task) {
  if (req.isClient) return false;
  if (req.can('tasks.edit_all')) return true;
  if (task.createdById === req.user.id) return true;
  const assignees = (await TaskAssignee.findAll({ where: { taskId: task.id }, raw: true })).map((a) => a.userId);
  if (assignees.includes(req.user.id)) return true;
  if (!req.can('tasks.view_team')) return false;
  const subs = await subordinateIds(req.user.id);
  return assignees.some((id) => subs.includes(id));
}

module.exports = { subordinateIds, teamIds, visibleProjectIds, taskScope, canSeeTask, canEditTask };
