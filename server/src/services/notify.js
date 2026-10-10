const { Notification, User, Activity, Project } = require('../models');
const whatsapp = require('./whatsapp');
const settings = require('./settings');
const socket = require('./socket');

// Maps a notification type to the user preference + WhatsApp event toggle it belongs to.
const TYPE_MAP = {
  task_assigned: ['assigned', 'assigned'],
  task_status: ['status', 'status'],
  task_comment: ['comment', 'comment'],
  task_mention: ['comment', 'comment'],
  task_due: ['due', 'due'],
  task_overdue: ['due', 'overdue'],
  approval_request: ['approval', 'approval'],
  approval_result: ['approval', 'approval'],
  client_update: ['status', 'client_update'],
  client_request: ['approval', 'client_request'],
};

/**
 * Create in-app notifications (+ realtime push + WhatsApp) for a set of users.
 * @param {object} o
 * @param {number[]} o.userIds
 * @param {string} o.type
 * @param {string} o.title
 * @param {string} [o.body]
 * @param {string} [o.link]   app path, e.g. /tasks/12
 * @param {number} [o.exclude] user id that should not be notified (the actor)
 */
async function notify({ userIds, type, title, body = '', link = '', exclude }) {
  const ids = [...new Set((userIds || []).filter((id) => id && id !== exclude))];
  if (!ids.length) return;
  const [cfg, company] = await Promise.all([settings.get('whatsapp'), settings.get('company')]);
  const users = await User.findAll({ where: { id: ids, isActive: true } });
  const [prefKey, eventKey] = TYPE_MAP[type] || ['status', 'status'];
  const appUrl = (process.env.APP_URL || '').replace(/\/$/, '');

  for (const u of users) {
    const n = await Notification.create({ userId: u.id, type, title, body, link });
    socket.toUser(u.id, 'notification', n.toJSON());

    const wantsWA = cfg.enabled && cfg.events?.[eventKey] !== false && u.whatsappOptIn && u.phone
      && (u.notifyPrefs?.[prefKey] !== false);
    if (wantsWA) {
      const text = [`*${company.name}*`, title, body, link && appUrl ? `${appUrl}${link}` : ''].filter(Boolean).join('\n');
      // Don't block the request on the WhatsApp API.
      whatsapp.send(u.phone, text).then((status) => n.update({ whatsappStatus: status })).catch(() => {});
    }
  }
}

/** Send straight to a phone number (e.g. a client's WhatsApp that has no portal login). */
async function whatsappDirect(phone, title, body, eventKey) {
  const [cfg, company] = await Promise.all([settings.get('whatsapp'), settings.get('company')]);
  if (!cfg.enabled || !phone || cfg.events?.[eventKey] === false) return 'skipped';
  return whatsapp.send(phone, [`*${company.name}*`, title, body].filter(Boolean).join('\n'));
}

async function activity({ actorId, action, summary, taskId, projectId, clientVisible = false, meta = {} }) {
  const a = await Activity.create({ actorId, action, summary, taskId, projectId, clientVisible, meta });
  const payload = { ...a.toJSON() };
  socket.toStaff('activity', payload);
  if (clientVisible && projectId) {
    const p = await Project.findByPk(projectId, { attributes: ['clientId'] });
    if (p?.clientId) socket.toClient(p.clientId, 'activity', payload);
  }
  return a;
}

module.exports = { notify, activity, whatsappDirect };
