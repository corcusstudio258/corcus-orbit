// Low-level task creation shared by the API, AI actions, templates, recurrence and automations.
const { sequelize, Task, Project, ChecklistItem, Section } = require('../models');

const STATUS_LABEL = { backlog: 'Backlog', todo: 'To do', in_progress: 'In progress', review: 'In review', blocked: 'Blocked', done: 'Done' };
const STATUSES = Object.keys(STATUS_LABEL);
const PRIORITIES = ['low', 'medium', 'high', 'urgent'];
const MAX_DEPTH = 6;

const fail = (status, message) => { const e = new Error(message); e.status = status; return e; };

/**
 * Creates one task row (plus checklist + assignees). Does not notify anyone.
 * @param {object} data      task fields
 * @param {number} actorId   creator user id
 * @param {object} [opts]    { transaction }
 */
async function createTaskRecord(data, actorId, opts = {}) {
  const title = String(data.title || '').trim().slice(0, 250);
  if (!title) throw fail(400, 'Give the task a title.');
  let projectId = data.projectId ? Number(data.projectId) : null;
  let depth = 0;
  let parent = null;
  const run = async (tx) => {
    if (data.parentId) {
      parent = await Task.findByPk(data.parentId, { transaction: tx });
      if (!parent) throw fail(404, 'Parent task not found.');
      projectId = parent.projectId;
      depth = parent.depth + 1;
      if (depth > MAX_DEPTH) throw fail(400, `Tasks can be nested up to ${MAX_DEPTH + 1} levels deep.`);
    }
    let key = null;
    let sectionId = data.sectionId || (parent ? parent.sectionId : null) || null;
    if (projectId) {
      const project = await Project.findByPk(projectId, { transaction: tx });
      if (!project) throw fail(404, 'Project not found.');
      project.taskCounter += 1;
      await project.save({ transaction: tx });
      key = `${project.code}-${project.taskCounter}`;
      if (data.sectionName && !sectionId) {
        const sec = await Section.findOne({ where: { projectId, name: data.sectionName }, transaction: tx });
        sectionId = sec?.id || null;
      }
      if (!sectionId) {
        const first = await Section.findOne({ where: { projectId }, order: [['order', 'ASC'], ['id', 'ASC']], transaction: tx });
        sectionId = first?.id || null;
      }
    }
    const status = STATUSES.includes(data.status) ? data.status : 'todo';
    const maxPos = await Task.max('position', { where: { parentId: parent ? parent.id : null, status }, transaction: tx });
    const t = await Task.create({
      key, title, description: data.description || '', projectId, parentId: parent ? parent.id : null, depth,
      status, priority: PRIORITIES.includes(data.priority) ? data.priority : 'medium',
      startDate: data.startDate || null, dueDate: data.dueDate || null, estimateHours: data.estimateHours || null,
      storyPoints: data.storyPoints || null, sectionId, sprintId: data.sprintId || null,
      clientVisible: data.clientVisible ?? (parent ? parent.clientVisible : false),
      requiresApproval: !!data.requiresApproval, tags: data.tags || [], links: data.links || [],
      milestoneId: data.milestoneId || null, recurrence: data.recurrence || null,
      createdById: actorId, position: (maxPos || 0) + 1000,
      startedAt: status === 'in_progress' ? new Date() : null, completedAt: status === 'done' ? new Date() : null,
    }, { transaction: tx });
    if (!key) { t.key = `T-${t.id}`; await t.save({ transaction: tx }); }
    const assigneeIds = (data.assigneeIds || []).map(Number).filter(Boolean);
    if (assigneeIds.length) await t.setAssignees([...new Set(assigneeIds)], { transaction: tx });
    if (t.projectId) await require('./reviewers').applyToTask(t, { transaction: tx }); // workspace reviewers
    if (Array.isArray(data.checklist) && data.checklist.length) {
      await ChecklistItem.bulkCreate(data.checklist.filter(Boolean).map((text, i) => ({ taskId: t.id, text: String(text).slice(0, 250), position: i })), { transaction: tx });
    }
    return t;
  };
  if (opts.transaction) return run(opts.transaction);
  return sequelize.transaction(run);
}

/** Next due date for a recurring task. */
function nextOccurrence(from, rule) {
  const base = new Date(from || Date.now());
  const n = Math.max(1, Number(rule?.interval) || 1);
  const d = new Date(base);
  if (rule?.freq === 'daily') d.setDate(d.getDate() + n);
  else if (rule?.freq === 'monthly') d.setMonth(d.getMonth() + n);
  else if (rule?.freq === 'weekly') {
    const days = (rule.days || []).map(Number).filter((x) => x >= 0 && x <= 6).sort();
    if (!days.length) d.setDate(d.getDate() + 7 * n);
    else {
      // next listed weekday after `base`
      for (let i = 1; i <= 7 * n; i += 1) {
        const c = new Date(base); c.setDate(c.getDate() + i);
        if (days.includes(c.getDay())) return c;
      }
      d.setDate(d.getDate() + 7 * n);
    }
  } else return null;
  return d;
}

module.exports = { createTaskRecord, nextOccurrence, STATUS_LABEL, STATUSES, PRIORITIES, MAX_DEPTH, fail };
