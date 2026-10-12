const cron = require('node-cron');
const { Op } = require('sequelize');
const { Task, User } = require('../models');
const { notify } = require('../services/notify');
const { emit } = require('../services/events');

const fmt = (d) => new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });

/** Tasks due in the next 24h that haven't had a reminder yet. */
async function dueSoon() {
  const now = new Date();
  const tasks = await Task.findAll({
    where: { status: { [Op.notIn]: ['done'] }, reminderSentAt: null, dueDate: { [Op.between]: [now, new Date(Date.now() + 24 * 3600e3)] } },
    include: [{ model: User, as: 'assignees', attributes: ['id'], through: { attributes: [] } }],
  });
  for (const t of tasks) {
    await notify({ userIds: t.assignees.map((a) => a.id), type: 'task_due', title: `Due soon: ${t.key}`,
      body: `${t.title} — due ${fmt(t.dueDate)}`, link: `/tasks/${t.id}` });
    t.reminderSentAt = now; await t.save();
  }
  return tasks.length;
}

/** Overdue tasks: tell assignees and their managers, at most once a day per task. */
async function overdue() {
  const now = new Date();
  const dayAgo = new Date(Date.now() - 20 * 3600e3);
  const tasks = await Task.findAll({
    where: { status: { [Op.ne]: 'done' }, dueDate: { [Op.lt]: now },
      [Op.or]: [{ overdueNotifiedAt: null }, { overdueNotifiedAt: { [Op.lt]: dayAgo } }] },
    include: [{ model: User, as: 'assignees', attributes: ['id', 'reportsToId'], through: { attributes: [] } }],
  });
  for (const t of tasks) {
    const people = t.assignees.map((a) => a.id);
    const managers = t.assignees.map((a) => a.reportsToId).filter(Boolean);
    await notify({ userIds: people, type: 'task_overdue', title: `Overdue: ${t.key}`, body: `${t.title} was due ${fmt(t.dueDate)}`, link: `/tasks/${t.id}` });
    await notify({ userIds: managers.filter((m) => !people.includes(m)), type: 'task_overdue', title: `Team task overdue: ${t.key}`,
      body: `${t.title} was due ${fmt(t.dueDate)}`, link: `/tasks/${t.id}` });
    const firstTime = !t.overdueNotifiedAt;
    t.overdueNotifiedAt = now; await t.save();
    if (firstTime) emit('task.overdue', { task: t, actor: { name: 'Orbit' } });
  }
  return tasks.length;
}

function start() {
  const tz = process.env.TZ_NAME || 'Asia/Kolkata';
  cron.schedule('*/15 * * * *', () => dueSoon().catch((e) => console.error('[reminders] due soon', e.message)), { timezone: tz });
  // Overdue nudges once a day at 10:05, during working hours
  cron.schedule('5 10 * * *', () => overdue().catch((e) => console.error('[reminders] overdue', e.message)), { timezone: tz });
  // Meeting reminders, 15 minutes before
  cron.schedule('*/5 * * * *', () => require('../routes/meetings').sendReminders().catch((e) => console.error('[reminders] meetings', e.message)), { timezone: tz });
}

module.exports = { start, dueSoon, overdue };
