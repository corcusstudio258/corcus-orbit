// Workspace reviewers: people (any role) who are added as reviewers on every task, or on the
// tasks of chosen projects. Rows they get this way are marked `auto` so the list can be synced.
const { Op } = require('sequelize');
const settings = require('./settings');
const { Task, TaskReviewer, User, Role } = require('../models');

async function config() {
  const c = await settings.get('reviewers');
  return { userIds: (c.userIds || []).map(Number).filter(Boolean), projectIds: (c.projectIds || []).map(Number).filter(Boolean) };
}
const inScope = (cfg, projectId) => !!projectId && cfg.userIds.length > 0 && (!cfg.projectIds.length || cfg.projectIds.includes(Number(projectId)));

/** Adds the workspace reviewers to a new task. Called inside task creation. */
async function applyToTask(task, { transaction } = {}) {
  const cfg = await config();
  if (!inScope(cfg, task.projectId)) return [];
  const have = (await TaskReviewer.findAll({ where: { taskId: task.id }, transaction, raw: true })).map((r) => r.userId);
  const add = cfg.userIds.filter((id) => !have.includes(id));
  if (add.length) await TaskReviewer.bulkCreate(add.map((userId) => ({ taskId: task.id, userId, auto: true })), { transaction });
  if (!task.requiresApproval) { task.requiresApproval = true; await task.save({ transaction }); }
  return add;
}

/**
 * Brings every open task in line with the list: adds missing workspace reviewers and removes
 * ones that were added automatically but are no longer on the list or in scope.
 * Done tasks keep their history. Returns { tasks, added, removed, perUser }.
 */
async function sync() {
  const cfg = await config();
  const open = await Task.findAll({ where: { status: { [Op.ne]: 'done' }, archived: false, projectId: { [Op.ne]: null } }, attributes: ['id', 'projectId'], raw: true });
  const openIds = open.map((t) => t.id);
  const scoped = open.filter((t) => inScope(cfg, t.projectId)).map((t) => t.id);
  const scopedSet = new Set(scoped);
  let removed = 0;
  if (openIds.length) {
    const autos = await TaskReviewer.findAll({ where: { auto: true, taskId: openIds }, raw: true });
    const drop = autos.filter((r) => !cfg.userIds.includes(r.userId) || !scopedSet.has(r.taskId));
    for (const r of drop) { await TaskReviewer.destroy({ where: { taskId: r.taskId, userId: r.userId } }); removed += 1; }
  }
  const perUser = {};
  let added = 0;
  if (scoped.length && cfg.userIds.length) {
    const have = await TaskReviewer.findAll({ where: { taskId: scoped }, raw: true });
    const key = new Set(have.map((r) => `${r.taskId}:${r.userId}`));
    const rows = [];
    for (const taskId of scoped) for (const userId of cfg.userIds) if (!key.has(`${taskId}:${userId}`)) { rows.push({ taskId, userId, auto: true }); perUser[userId] = (perUser[userId] || 0) + 1; }
    for (let i = 0; i < rows.length; i += 500) await TaskReviewer.bulkCreate(rows.slice(i, i + 500));
    added = rows.length;
    await Task.update({ requiresApproval: true }, { where: { id: scoped, requiresApproval: false } });
  }
  return { tasks: scoped.length, added, removed, perUser };
}

/** Only active staff can review. */
async function cleanUserIds(ids) {
  const want = [...new Set((ids || []).map(Number).filter(Boolean))];
  if (!want.length) return [];
  const users = await User.findAll({ where: { id: want, isActive: true }, include: [{ model: Role, attributes: ['isClientRole'] }] });
  return users.filter((u) => !u.Role?.isClientRole).map((u) => u.id);
}

module.exports = { config, applyToTask, sync, cleanUserIds, inScope };
