const router = require('express').Router();
const { Op } = require('sequelize');
const { Meeting, MeetingAttendee, User, Project, Client } = require('../models');
const { staffOnly } = require('../middleware/auth');
const { notify, activity } = require('../services/notify');
const socket = require('../services/socket');

router.use(staffOnly);
const wrap = (f) => (req, res) => f(req, res).catch((e) => {
  if (!e.status) console.error(e);
  res.status(e.status || 500).json({ error: e.message });
});
const userAttrs = ['id', 'name', 'color', 'designation'];
const when = (d) => new Date(d).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const include = [
  { model: User, as: 'organizer', attributes: userAttrs },
  { model: User, as: 'attendees', attributes: userAttrs, through: { attributes: ['response'] } },
  { model: Project, attributes: ['id', 'name', 'color', 'code'] },
  { model: Client, attributes: ['id', 'name'] },
];

async function canEdit(req, m) { return m.organizerId === req.user.id || req.can('settings.manage') || req.can('projects.manage'); }

router.get('/', wrap(async (req, res) => {
  const where = {};
  if (req.query.from) where.startAt = { [Op.gte]: new Date(req.query.from) };
  if (req.query.to) where.endAt = { ...(where.endAt || {}), [Op.lte]: new Date(req.query.to) };
  if (req.query.projectId) where.projectId = req.query.projectId;
  let meetings = await Meeting.findAll({ where, include, order: [['startAt', req.query.order === 'desc' ? 'DESC' : 'ASC']], limit: 300 });
  if (req.query.scope !== 'all' || !req.can('dashboard.team')) {
    meetings = meetings.filter((m) => m.organizerId === req.user.id || m.attendees.some((a) => a.id === req.user.id));
  }
  res.json(meetings);
}));

router.get('/:id', wrap(async (req, res) => {
  const m = await Meeting.findByPk(req.params.id, { include });
  if (!m) return res.status(404).json({ error: 'Meeting not found.' });
  res.json({ ...m.toJSON(), canEdit: await canEdit(req, m) });
}));

function validate(b) {
  if (!b.title?.trim()) return 'Give the meeting a title.';
  if (!b.startAt || !b.endAt) return 'Pick a start and end time.';
  if (new Date(b.endAt) <= new Date(b.startAt)) return 'The meeting has to end after it starts.';
  return null;
}

router.post('/', wrap(async (req, res) => {
  const b = req.body;
  const err = validate(b);
  if (err) return res.status(400).json({ error: err });
  const m = await Meeting.create({
    title: b.title.trim(), agenda: b.agenda || '', startAt: b.startAt, endAt: b.endAt, link: b.link || '', location: b.location || '',
    projectId: b.projectId || null, clientId: b.clientId || null, inviteClient: !!b.inviteClient, organizerId: req.user.id,
  });
  const ids = [...new Set([req.user.id, ...(b.attendeeIds || []).map(Number)])];
  await m.setAttendees(ids);
  await MeetingAttendee.update({ response: 'yes' }, { where: { meetingId: m.id, userId: req.user.id } });
  if (m.inviteClient && m.clientId) {
    const portal = await User.findAll({ where: { clientId: m.clientId, isActive: true }, attributes: ['id'] });
    await notify({ userIds: portal.map((u) => u.id), type: 'meeting', title: `Meeting invite: ${m.title}`, body: `${when(m.startAt)}${m.link ? `\n${m.link}` : ''}`, link: '/portal' });
  }
  await notify({ userIds: ids, exclude: req.user.id, type: 'meeting', title: `${req.user.name} invited you: ${m.title}`, body: `${when(m.startAt)}${m.link ? `\nJoin: ${m.link}` : ''}`, link: `/meetings?id=${m.id}` });
  await activity({ actorId: req.user.id, action: 'meeting.created', summary: `scheduled "${m.title}" for ${when(m.startAt)}`, projectId: m.projectId });
  socket.toUsers(ids, 'meeting:changed', { id: m.id });
  res.status(201).json(await Meeting.findByPk(m.id, { include }));
}));

router.patch('/:id', wrap(async (req, res) => {
  const m = await Meeting.findByPk(req.params.id);
  if (!m) return res.status(404).json({ error: 'Meeting not found.' });
  if (!(await canEdit(req, m))) return res.status(403).json({ error: 'Only the organiser can change this meeting.' });
  const b = req.body;
  const moved = (b.startAt && new Date(b.startAt).getTime() !== new Date(m.startAt).getTime());
  ['title', 'agenda', 'startAt', 'endAt', 'link', 'location', 'projectId', 'clientId', 'notes', 'inviteClient'].forEach((k) => { if (b[k] !== undefined) m[k] = b[k] === '' ? null : b[k]; });
  const err = validate(m);
  if (err) return res.status(400).json({ error: err });
  if (moved) m.reminderSentAt = null;
  await m.save();
  if (Array.isArray(b.attendeeIds)) await m.setAttendees([...new Set([m.organizerId, ...b.attendeeIds.map(Number)])]);
  const ids = (await MeetingAttendee.findAll({ where: { meetingId: m.id }, raw: true })).map((a) => a.userId);
  if (moved) await notify({ userIds: ids, exclude: req.user.id, type: 'meeting', title: `Rescheduled: ${m.title}`, body: `Now ${when(m.startAt)}`, link: `/meetings?id=${m.id}` });
  socket.toUsers(ids, 'meeting:changed', { id: m.id });
  res.json(await Meeting.findByPk(m.id, { include }));
}));

router.delete('/:id', wrap(async (req, res) => {
  const m = await Meeting.findByPk(req.params.id);
  if (!m) return res.status(404).json({ error: 'Meeting not found.' });
  if (!(await canEdit(req, m))) return res.status(403).json({ error: 'Only the organiser can cancel this meeting.' });
  const ids = (await MeetingAttendee.findAll({ where: { meetingId: m.id }, raw: true })).map((a) => a.userId);
  if (new Date(m.startAt) > new Date()) await notify({ userIds: ids, exclude: req.user.id, type: 'meeting', title: `Cancelled: ${m.title}`, body: `Was ${when(m.startAt)}`, link: '/meetings' });
  await MeetingAttendee.destroy({ where: { meetingId: m.id } });
  await m.destroy();
  socket.toUsers(ids, 'meeting:changed', { id: m.id });
  res.json({ ok: true });
}));

router.post('/:id/rsvp', wrap(async (req, res) => {
  const response = ['yes', 'no', 'maybe'].includes(req.body.response) ? req.body.response : 'yes';
  const row = await MeetingAttendee.findOne({ where: { meetingId: req.params.id, userId: req.user.id } });
  if (!row) return res.status(404).json({ error: "You're not invited to this meeting." });
  row.response = response; await row.save();
  const m = await Meeting.findByPk(req.params.id);
  if (m.organizerId !== req.user.id && response === 'no') await notify({ userIds: [m.organizerId], type: 'meeting', title: `${req.user.name} can't make it`, body: m.title, link: `/meetings?id=${m.id}` });
  res.json({ ok: true });
}));

// Turn agreed action items into tasks
router.post('/:id/action-items', wrap(async (req, res) => {
  const m = await Meeting.findByPk(req.params.id);
  if (!m) return res.status(404).json({ error: 'Meeting not found.' });
  if (!req.can('tasks.create')) return res.status(403).json({ error: "Your role can't create tasks." });
  const { createTask } = require('./tasks');
  const created = [];
  for (const it of (req.body.items || []).filter((x) => x?.title)) {
    const t = await createTask(req, {
      title: it.title, projectId: req.body.projectId || m.projectId || null, assigneeIds: it.assigneeIds || [], dueDate: it.dueDate || null,
      priority: it.priority || 'medium', description: `From meeting "${m.title}" on ${when(m.startAt)}`,
    });
    created.push({ id: t.id, key: t.key });
  }
  res.json({ created });
}));

/** Cron: remind attendees 15 minutes before. */
async function sendReminders() {
  const soon = new Date(Date.now() + 16 * 60000);
  const meetings = await Meeting.findAll({ where: { reminderSentAt: null, startAt: { [Op.between]: [new Date(), soon] } }, include: [{ model: User, as: 'attendees', attributes: ['id'], through: { attributes: ['response'] } }] });
  for (const m of meetings) {
    const ids = m.attendees.filter((a) => a.MeetingAttendee?.response !== 'no').map((a) => a.id);
    await notify({ userIds: ids, type: 'meeting_reminder', title: `Starting soon: ${m.title}`, body: `${when(m.startAt)}${m.link ? `\nJoin: ${m.link}` : m.location ? `\n${m.location}` : ''}`, link: `/meetings?id=${m.id}` });
    m.reminderSentAt = new Date(); await m.save();
  }
  return meetings.length;
}

module.exports = { router, sendReminders };
