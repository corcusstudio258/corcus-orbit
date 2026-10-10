const { Op } = require('sequelize');
const { User, ProjectMember, Project, TaskAssignee, Task } = require('../models');

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

/** Project ids a staff user can see. null = all. */
async function visibleProjectIds(req) {
  if (req.can('projects.view_all') || req.can('tasks.view_all')) return null;
  const team = [req.user.id, ...(await subordinateIds(req.user.id))];
  const member = await ProjectMember.findAll({ where: { userId: team }, attributes: ['projectId'], raw: true });
  const owned = await Project.findAll({ where: { ownerId: team }, attributes: ['id'], raw: true });
  const assigned = await Task.findAll({
    attributes: ['projectId'], raw: true,
    include: [{ model: User, as: 'assignees', where: { id: team }, attributes: [], through: { attributes: [] } }],
  });
  return [...new Set([...member.map((m) => m.projectId), ...owned.map((p) => p.id),
    ...assigned.map((t) => t.projectId)].filter(Boolean))];
}

/**
 * Sequelize where-clause for tasks a staff user can see.
 * Rules: view_all → everything. Otherwise: tasks in projects they (or their reports) belong to,
 * tasks they created, or tasks assigned to them or anyone who reports to them.
 */
async function taskScope(req) {
  if (req.can('tasks.view_all')) return {};
  const team = [req.user.id, ...(await subordinateIds(req.user.id))];
  const assigned = await TaskAssignee.findAll({ where: { userId: team }, attributes: ['taskId'], raw: true });
  const member = await ProjectMember.findAll({ where: { userId: team }, attributes: ['projectId'], raw: true });
  return {
    [Op.or]: [
      { id: assigned.map((a) => a.taskId) },
      { createdById: team },
      { projectId: member.map((m) => m.projectId) },
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
  const subs = await subordinateIds(req.user.id);
  return assignees.some((id) => subs.includes(id));
}

module.exports = { subordinateIds, visibleProjectIds, taskScope, canSeeTask, canEditTask };
