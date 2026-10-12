// Wires domain events to rewards, recurrence, dependency alerts and automations.
const { on } = require('./events');
const { Task, TaskAssignee, ChecklistItem } = require('../models');
const { notify, activity } = require('./notify');
const socket = require('./socket');
const points = require('./points');
const automations = require('./automations');
const { createTaskRecord, nextOccurrence } = require('./taskFactory');

async function spawnNextOccurrence(task) {
  if (!task.recurrence?.freq) return;
  const next = nextOccurrence(task.dueDate || task.completedAt || new Date(), task.recurrence);
  if (!next) return;
  if (task.recurrence.until && next > new Date(task.recurrence.until)) return;
  const assigneeIds = (await TaskAssignee.findAll({ where: { taskId: task.id }, raw: true })).map((a) => a.userId);
  const checklist = (await ChecklistItem.findAll({ where: { taskId: task.id }, order: [['position', 'ASC']], raw: true })).map((c) => c.text);
  let startDate = null;
  if (task.startDate && task.dueDate) {
    const span = new Date(task.dueDate) - new Date(task.startDate);
    startDate = new Date(next.getTime() - span).toISOString().slice(0, 10);
  }
  const copy = await createTaskRecord({
    title: task.title, description: task.description, projectId: task.projectId, parentId: task.parentId, priority: task.priority,
    dueDate: next, startDate, estimateHours: task.estimateHours, storyPoints: task.storyPoints, sectionId: task.sectionId,
    clientVisible: task.clientVisible, requiresApproval: task.requiresApproval, tags: task.tags, links: task.links,
    milestoneId: null, recurrence: task.recurrence, assigneeIds, checklist,
  }, task.createdById);
  // only the newest copy carries the rule
  await Task.update({ recurrence: null }, { where: { id: task.id } });
  await activity({ actorId: task.createdById, action: 'task.recurring', summary: `scheduled the next ${task.key} as ${copy.key}`, taskId: copy.id, projectId: copy.projectId });
  await notify({ userIds: assigneeIds, type: 'task_assigned', title: `Next round: ${copy.key}`, body: `${copy.title}, due ${next.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`, link: `/tasks/${copy.id}` });
  socket.toStaff('task:changed', { id: copy.id, projectId: copy.projectId, kind: 'created' });
}

async function announceUnblocked(task) {
  const dependents = await task.getBlocking({ attributes: ['id', 'key', 'title', 'status'] });
  for (const d of dependents) {
    const blockers = await d.getBlockers({ attributes: ['id', 'status'] });
    if (blockers.every((b) => b.status === 'done') && d.status !== 'done') {
      const ids = (await TaskAssignee.findAll({ where: { taskId: d.id }, raw: true })).map((a) => a.userId);
      await notify({ userIds: ids, type: 'task_status', title: `Unblocked: ${d.key}`, body: `${task.key} is done, so you can start "${d.title}"`, link: `/tasks/${d.id}` });
    }
  }
}

let registered = false;
function register() {
  if (registered) return;
  registered = true;
  on('task.status', async ({ task, to }) => {
    if (to !== 'done') return;
    const fresh = await Task.findByPk(task.id);
    if (!fresh) return;
    await points.onTaskDone(fresh);
    await announceUnblocked(fresh);
    await spawnNextOccurrence(fresh);
  });
  on('task.comment', async ({ actor }) => { if (actor?.id) await points.onComment(actor.id); });
  on('attendance.in', async ({ userId, record }) => points.onAttendance(userId, record));
  automations.register(on);
}

module.exports = { register, spawnNextOccurrence };
