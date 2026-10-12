const router = require('express').Router();
const { Op } = require('sequelize');
const { Meeting, MeetingAttendee, User, Project, Client } = require('../models');
const { staffOnly } = require('../middleware/auth');
const { notify, activity } = require('../services/notify');
const socket = require('../services/socket');
const zoom = require('../services/zoom');
const mailer = require('../services/mailer');
const settings = require('../services/settings');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const cleanEmails = (list) => [...new Set((Array.isArray(list) ? list : String(list || '').split(/[,;\s]+/)).map((e) => String(e).trim().toLowerCase()).filter((e) => EMAIL_RE.test(e)))].slice(0, 50);
const icsDate = (d) => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const icsEsc = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, (m) => `\\${m}`);

function ics(m, method, organizerEmail, attendees) {
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Orbit//Meetings//EN', `METHOD:${method}`, 'BEGIN:VEVENT',
    `UID:orbit-meeting-${m.id}@orbit`, `DTSTAMP:${icsDate(new Date())}`, `DTSTART:${icsDate(m.startAt)}`, `DTEND:${icsDate(m.endAt)}`,
    `SUMMARY:${icsEsc(m.title)}`, `DESCRIPTION:${icsEsc(`${m.agenda || ''}${m.link ? `\nJoin: ${m.link}` : ''}${m.zoomPassword ? `\nPasscode: ${m.zoomPassword}` : ''}`)}`,
    `LOCATION:${icsEsc(m.link || m.location || '')}`, `SEQUENCE:${Math.floor(Date.now() / 1000)}`, method === 'CANCEL' ? 'STATUS:CANCELLED' : 'STATUS:CONFIRMED',
    organizerEmail ? `ORGANIZER:mailto:${organizerEmail}` : '', ...attendees.map((e) => `ATTENDEE;RSVP=TRUE:mailto:${e}`), 'END:VEVENT', 'END:VCALENDAR'].filter(Boolean).join('\r\n');
}

/** Email the invite (with a calendar file) to team attendees and guests. Never throws. */
async function emailInvite(m, kind = 'REQUEST') {
  try {
    if (!(await mailer.ready())) return { sent: 0, reason: 'Email is not set up' };
    const full = await Meeting.findByPk(m.id, { include });
    const team = full.attendees.map((a) => a.email).filter(Boolean);
    const to = [...new Set([...team, ...(full.guestEmails || [])])];
    if (!to.length) return { sent: 0 };
    const company = (await settings.get('company')).name;
    const subject = kind === 'CANCEL' ? `Cancelled: ${full.title}` : `${kind === 'UPDATE' ? 'Updated: ' : 'Invitation: '}${full.title} (${when(full.startAt)})`;
    const html = await mailer.layout(kind === 'CANCEL' ? `${full.title} is cancelled` : full.title,
      `<p><b>${when(full.startAt)}</b>, ${Math.round((new Date(full.endAt) - new Date(full.startAt)) / 60000)} minutes</p>${full.agenda ? `<p style="white-space:pre-wrap">${String(full.agenda).replace(/</g, '&lt;')}</p>` : ''}${full.location ? `<p>Location: ${String(full.location).replace(/</g, '&lt;')}</p>` : ''}${full.zoomPassword ? `<p>Zoom passcode: <b>${full.zoomPassword}</b></p>` : ''}<p style="color:#8D94B3;font-size:13px">Organised by ${full.organizer?.name || company}. The calendar file is attached.</p>`,
      kind !== 'CANCEL' && full.link ? { url: full.link, label: full.provider === 'zoom' ? 'Join Zoom meeting' : 'Join meeting' } : null);
    await mailer.send({ to, subject, html, text: `${full.title}\n${when(full.startAt)}\n${full.link || full.location || ''}`,
      attachments: [{ filename: 'invite.ics', content: ics(full, kind === 'CANCEL' ? 'CANCEL' : 'REQUEST', null, to), contentType: `text/calendar; method=${kind === 'CANCEL' ? 'CANCEL' : 'REQUEST'}` }] });
    full.emailedAt = new Date(); await full.save();
    return { sent: to.length };
  } catch (e) { console.error('[meeting email]', e.message); return { sent: 0, reason: e.message }; }
}

router.use(staffOnly);
const wrap = (f) => (req, res) => f(req, res).catch((e) => {
  if (!e.status) console.error(e);
  res.status(e.status || 500).json({ error: e.message });
});
const userAttrs = ['id', 'name', 'color', 'designation', 'email'];
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

router.get('/integrations/status', wrap(async (req, res) => res.json({ zoom: await zoom.ready(), email: await mailer.ready() })));

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
  let zoomInfo = null;
  if (b.provider === 'zoom') {
    try { zoomInfo = await zoom.create({ title: b.title, agenda: b.agenda, startAt: b.startAt, endAt: b.endAt }); } catch (e) { return res.status(e.status || 400).json({ error: e.message }); }
  }
  const m = await Meeting.create({
    title: b.title.trim(), agenda: b.agenda || '', startAt: b.startAt, endAt: b.endAt, link: zoomInfo?.joinUrl || b.link || '', location: b.location || '',
    projectId: b.projectId || null, clientId: b.clientId || null, inviteClient: !!b.inviteClient, organizerId: req.user.id,
    provider: zoomInfo ? 'zoom' : 'link', zoomId: zoomInfo?.id || null, zoomPassword: zoomInfo?.password || null, guestEmails: cleanEmails(b.guestEmails),
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
  const emailed = b.sendEmail === false ? { sent: 0 } : await emailInvite(m, 'REQUEST');
  res.status(201).json({ ...(await Meeting.findByPk(m.id, { include })).toJSON(), emailed });
}));

router.patch('/:id', wrap(async (req, res) => {
  const m = await Meeting.findByPk(req.params.id);
  if (!m) return res.status(404).json({ error: 'Meeting not found.' });
  if (!(await canEdit(req, m))) return res.status(403).json({ error: 'Only the organiser can change this meeting.' });
  const b = req.body;
  const moved = (b.startAt && new Date(b.startAt).getTime() !== new Date(m.startAt).getTime());
  const resized = b.endAt && new Date(b.endAt).getTime() !== new Date(m.endAt).getTime();
  ['title', 'agenda', 'startAt', 'endAt', 'link', 'location', 'projectId', 'clientId', 'notes', 'inviteClient'].forEach((k) => { if (b[k] !== undefined) m[k] = b[k] === '' ? null : b[k]; });
  if (b.guestEmails !== undefined) m.guestEmails = cleanEmails(b.guestEmails);
  const err = validate(m);
  if (err) return res.status(400).json({ error: err });
  if (moved) m.reminderSentAt = null;
  try {
    if (b.provider === 'zoom' && !m.zoomId) { const z = await zoom.create(m); m.zoomId = z.id; m.zoomPassword = z.password; m.link = z.joinUrl; m.provider = 'zoom'; }
    else if (b.provider === 'link' && m.zoomId) { await zoom.remove(m.zoomId); m.zoomId = null; m.zoomPassword = null; m.provider = 'link'; if (b.link !== undefined) m.link = b.link; }
    else if (m.zoomId && (moved || resized || b.title !== undefined || b.agenda !== undefined)) await zoom.update(m.zoomId, m);
  } catch (e) { return res.status(e.status || 400).json({ error: e.message }); }
  await m.save();
  if (Array.isArray(b.attendeeIds)) await m.setAttendees([...new Set([m.organizerId, ...b.attendeeIds.map(Number)])]);
  const ids = (await MeetingAttendee.findAll({ where: { meetingId: m.id }, raw: true })).map((a) => a.userId);
  if (moved) await notify({ userIds: ids, exclude: req.user.id, type: 'meeting', title: `Rescheduled: ${m.title}`, body: `Now ${when(m.startAt)}`, link: `/meetings?id=${m.id}` });
  socket.toUsers(ids, 'meeting:changed', { id: m.id });
  if (moved || resized || b.resend) await emailInvite(m, 'UPDATE');
  res.json(await Meeting.findByPk(m.id, { include }));
}));

router.delete('/:id', wrap(async (req, res) => {
  const m = await Meeting.findByPk(req.params.id);
  if (!m) return res.status(404).json({ error: 'Meeting not found.' });
  if (!(await canEdit(req, m))) return res.status(403).json({ error: 'Only the organiser can cancel this meeting.' });
  const ids = (await MeetingAttendee.findAll({ where: { meetingId: m.id }, raw: true })).map((a) => a.userId);
  if (new Date(m.startAt) > new Date()) await notify({ userIds: ids, exclude: req.user.id, type: 'meeting', title: `Cancelled: ${m.title}`, body: `Was ${when(m.startAt)}`, link: '/meetings' });
  if (new Date(m.startAt) > new Date()) await emailInvite(m, 'CANCEL');
  if (m.zoomId) await zoom.remove(m.zoomId);
  await MeetingAttendee.destroy({ where: { meetingId: m.id } });
  await m.destroy();
  socket.toUsers(ids, 'meeting:changed', { id: m.id });
  res.json({ ok: true });
}));

router.post('/:id/email', wrap(async (req, res) => {
  const m = await Meeting.findByPk(req.params.id);
  if (!m) return res.status(404).json({ error: 'Meeting not found.' });
  if (!(await canEdit(req, m))) return res.status(403).json({ error: 'Only the organiser can send invites.' });
  const r = await emailInvite(m, 'REQUEST');
  if (!r.sent) return res.status(400).json({ error: r.reason || 'Nobody to email. Add guests or attendees with email addresses.' });
  res.json(r);
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
