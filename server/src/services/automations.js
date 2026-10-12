// Rule engine: "When <trigger> [and conditions] then <actions>".
const { Automation, Task, User, Project, Comment, Section, TaskAssignee, TaskWatcher } = require('../models');
const { notify, activity } = require('./notify');
const whatsapp = require('./whatsapp');
const settings = require('./settings');
const socket = require('./socket');
const { STATUS_LABEL } = require('./taskFactory');

const TRIGGERS = {
  'task.created': 'A task is created',
  'task.status': 'A task changes status',
  'task.priority': 'A task changes priority',
  'task.assigned': 'Someone is assigned to a task',
  'task.overdue': 'A task becomes overdue',
  'task.comment': 'Someone comments on a task',
};

const ACTIONS = {
  notify: 'Send an in-app notification',
  whatsapp: 'Send a WhatsApp message',
  set_status: 'Change the status',
  set_priority: 'Change the priority',
  assign: 'Assign someone',
  comment: 'Add a comment',
  points: 'Award reward points',
  move_section: 'Move to a section',
};

function fill(template, ctx) {
  return String(template || '').replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, path) => {
    const v = path.split('.').reduce((o, k) => (o == null ? o : o[k]), ctx);
    return v == null ? '' : String(v);
  });
}

function matches(rule, payload) {
  const c = rule.conditions || {};
  const t = payload.task;
  if (c.projectId && Number(c.projectId) !== Number(t.projectId)) return false;
  if (c.priority && c.priority !== t.priority) return false;
  if (c.status && c.status !== (payload.to ?? t.status)) return false;
  if (c.fromStatus && c.fromStatus !== payload.from) return false;
  if (c.tag && !(t.tags || []).map((x) => x.toLowerCase()).includes(String(c.tag).toLowerCase())) return false;
  return true;
}

async function recipients(target, task, extra = {}) {
  const ids = new Set();
  const assignees = (await TaskAssignee.findAll({ where: { taskId: task.id }, raw: true })).map((a) => a.userId);
  if (target === 'assignees') assignees.forEach((i) => ids.add(i));
  if (target === 'creator') ids.add(task.createdById);
  if (target === 'managers') {
    const people = await User.findAll({ where: { id: assignees }, attributes: ['reportsToId'], raw: true });
    people.forEach((p) => p.reportsToId && ids.add(p.reportsToId));
  }
  if (target === 'project_owner' && task.projectId) {
    const p = await Project.findByPk(task.projectId, { attributes: ['ownerId'] });
    if (p?.ownerId) ids.add(p.ownerId);
  }
  if (target === 'watchers') (await TaskWatcher.findAll({ where: { taskId: task.id }, raw: true })).forEach((w) => ids.add(w.userId));
  if (target === 'user' && extra.userId) ids.add(Number(extra.userId));
  return [...ids].filter(Boolean);
}

async function runAction(action, task, ctx, rule) {
  const message = fill(action.message || '{{task.key}}: {{task.title}}', ctx);
  switch (action.type) {
    case 'notify': {
      const ids = await recipients(action.to || 'assignees', task, action);
      await notify({ userIds: ids, type: 'task_status', title: fill(action.title || rule.name, ctx), body: message, link: `/tasks/${task.id}` });
      break;
    }
    case 'whatsapp': {
      const cfg = await settings.get('whatsapp');
      const company = await settings.get('company');
      if (!cfg.enabled) break;
      const ids = action.to === 'phone' ? [] : await recipients(action.to || 'assignees', task, action);
      const phones = action.to === 'phone' ? [action.phone] : (await User.findAll({ where: { id: ids }, attributes: ['phone'], raw: true })).map((u) => u.phone);
      for (const ph of phones.filter(Boolean)) await whatsapp.send(ph, `*${company.name}*\n${message}`);
      break;
    }
    case 'set_status':
      if (STATUS_LABEL[action.status] && task.status !== action.status) {
        task.status = action.status;
        task.completedAt = action.status === 'done' ? new Date() : null;
        await task.save();
      }
      break;
    case 'set_priority':
      if (['low', 'medium', 'high', 'urgent'].includes(action.priority)) { task.priority = action.priority; await task.save(); }
      break;
    case 'assign':
      if (action.userId) {
        await task.addAssignee(Number(action.userId));
        await notify({ userIds: [Number(action.userId)], type: 'task_assigned', title: `Auto-assigned: ${task.key}`, body: task.title, link: `/tasks/${task.id}` });
      }
      break;
    case 'comment':
      await Comment.create({ taskId: task.id, userId: rule.createdById, body: `🤖 ${message}`, internal: true });
      break;
    case 'points': {
      const { award } = require('./points');
      const ids = await recipients(action.to || 'assignees', task, action);
      for (const id of ids) await award(id, Number(action.points) || 5, 'bonus', `Automation: ${rule.name}`, null);
      break;
    }
    case 'move_section':
      if (task.projectId && action.sectionName) {
        const sec = await Section.findOne({ where: { projectId: task.projectId, name: action.sectionName } });
        if (sec) { task.sectionId = sec.id; await task.save(); }
      }
      break;
    default:
  }
}

async function handle(trigger, payload) {
  if (payload.viaAutomation) return;
  const rules = await Automation.findAll({ where: { trigger, active: true } });
  if (!rules.length) return;
  const task = await Task.findByPk(payload.task.id);
  if (!task) return;
  const project = task.projectId ? await Project.findByPk(task.projectId, { attributes: ['id', 'name', 'code'] }) : null;
  const ctx = {
    task: { ...task.toJSON(), status: STATUS_LABEL[task.status] }, project: project?.toJSON() || { name: 'Personal' },
    actor: payload.actor || { name: 'Someone' }, from: STATUS_LABEL[payload.from] || payload.from || '', to: STATUS_LABEL[payload.to] || payload.to || '',
  };
  for (const rule of rules) {
    if (!matches(rule, { ...payload, task })) continue;
    try {
      for (const action of rule.actions || []) await runAction(action, task, ctx, rule);
      rule.runs += 1; rule.lastRunAt = new Date(); await rule.save();
      await activity({ actorId: rule.createdById, action: 'automation.run', summary: `automation "${rule.name}" ran on ${task.key}`, taskId: task.id, projectId: task.projectId, meta: { automationId: rule.id } });
    } catch (e) { console.error('[automation]', rule.name, e.message); }
  }
  socket.toStaff('task:changed', { id: task.id, projectId: task.projectId, parentId: task.parentId, kind: 'updated' });
}

function register(on) {
  Object.keys(TRIGGERS).forEach((t) => on(t, (p) => handle(t, p)));
}

const DEFAULT_RULES = [
  { name: 'Tell the manager when urgent work is created', trigger: 'task.created', conditions: { priority: 'urgent' },
    actions: [{ type: 'notify', to: 'managers', title: 'Urgent task: {{task.key}}', message: '{{actor.name}} created "{{task.title}}" in {{project.name}}' }] },
  { name: 'Nudge the manager when a task goes overdue', trigger: 'task.overdue', conditions: {},
    actions: [{ type: 'notify', to: 'managers', title: 'Overdue: {{task.key}}', message: '"{{task.title}}" in {{project.name}} is past its due date' }] },
  { name: 'Bonus points for closing urgent work', trigger: 'task.status', conditions: { status: 'done', priority: 'urgent' },
    actions: [{ type: 'points', to: 'assignees', points: 5 }] },
];

module.exports = { register, handle, TRIGGERS, ACTIONS, DEFAULT_RULES, fill };
