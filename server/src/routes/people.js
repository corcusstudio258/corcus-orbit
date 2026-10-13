// People: attendance (punch in/out), workload and rewards.
const router = require('express').Router();
const { Op } = require('sequelize');
const { Attendance, User, Role, Task, TaskAssignee, PointEntry } = require('../models');
const { teamIds } = require('../services/access');
const { staffOnly, requirePerm } = require('../middleware/auth');
const settings = require('../services/settings');
const points = require('../services/points');
const { emit } = require('../services/events');
const { notify } = require('../services/notify');
const socket = require('../services/socket');

router.use(staffOnly);
const wrap = (f) => (req, res) => f(req, res).catch((e) => {
  if (!e.status) console.error(e);
  res.status(e.status || 500).json({ error: e.message });
});
const TZ = 'Asia/Kolkata';
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });
const istMinutes = (d) => { const t = new Date(d).toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }); const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const canSeeTeam = (req) => req.can('dashboard.team') || req.can('users.manage') || req.can('attendance.manage');

// ---------- attendance ----------
router.get('/attendance/today', wrap(async (req, res) => {
  const rec = await Attendance.findOne({ where: { userId: req.user.id, date: today() } });
  const company = await settings.get('company');
  res.json({ record: rec, workStart: company.workStart || '10:00', date: today() });
}));

router.post('/attendance/punch-in', wrap(async (req, res) => {
  const date = today();
  let rec = await Attendance.findOne({ where: { userId: req.user.id, date } });
  if (rec?.inAt && !rec.outAt) return res.status(400).json({ error: "You're already punched in." });
  const company = await settings.get('company');
  const [h, m] = String(company.workStart || '10:00').split(':').map(Number);
  const late = istMinutes(new Date()) > h * 60 + m + Number(company.graceMinutes ?? 15);
  const mode = req.body.mode === 'remote' ? 'remote' : 'office';
  if (rec) { // second session the same day
    const first = !rec.inAt;
    if (first) { rec.inAt = new Date(); rec.mode = mode; rec.status = late ? 'late' : mode === 'remote' ? 'remote' : 'present'; }
    rec.outAt = null; rec.sessionAt = new Date(); rec.note = req.body.note || rec.note; await rec.save();
    if (first) emit('attendance.in', { userId: req.user.id, record: rec });
  } else {
    rec = await Attendance.create({ userId: req.user.id, date, inAt: new Date(), sessionAt: new Date(), mode, status: late ? 'late' : mode === 'remote' ? 'remote' : 'present', note: req.body.note || '' });
    emit('attendance.in', { userId: req.user.id, record: rec });
  }
  socket.toStaff('attendance:changed', { userId: req.user.id });
  res.json(rec);
}));

router.post('/attendance/punch-out', wrap(async (req, res) => {
  const rec = await Attendance.findOne({ where: { userId: req.user.id, date: today() } });
  if (!rec?.inAt || rec.outAt) return res.status(400).json({ error: "You're not punched in." });
  rec.outAt = new Date();
  rec.minutes = (rec.minutes || 0) + Math.max(1, Math.round((rec.outAt - new Date(rec.sessionAt || rec.inAt)) / 60000));
  if (rec.minutes < 4 * 60 && rec.status !== 'remote') rec.status = 'half_day';
  if (req.body.note) rec.note = req.body.note;
  await rec.save();
  socket.toStaff('attendance:changed', { userId: req.user.id });
  res.json(rec);
}));

router.get('/attendance/me', wrap(async (req, res) => {
  const month = req.query.month || today().slice(0, 7);
  const userId = req.query.userId && canSeeTeam(req) ? Number(req.query.userId) : req.user.id;
  const rows = await Attendance.findAll({ where: { userId, date: { [Op.like]: `${month}%` } }, order: [['date', 'ASC']] });
  const count = (s) => rows.filter((r) => r.status === s).length;
  res.json({ month, records: rows, summary: { present: count('present'), late: count('late'), half_day: count('half_day'), remote: count('remote'), leave: count('leave'), absent: count('absent'),
    hours: Math.round(rows.reduce((s, r) => s + (r.minutes || 0), 0) / 6) / 10 } });
}));

router.get('/attendance/team', wrap(async (req, res) => {
  if (!canSeeTeam(req)) return res.status(403).json({ error: 'Only managers can see team attendance.' });
  const date = req.query.date || today();
  const staff = await User.findAll({ where: { isActive: true }, include: [{ model: Role, attributes: ['name', 'isClientRole'] }], attributes: ['id', 'name', 'color', 'designation', 'department'] });
  const people = staff.filter((u) => !u.Role?.isClientRole);
  const rows = await Attendance.findAll({ where: { date, userId: people.map((p) => p.id) } });
  const month = date.slice(0, 7);
  const monthRows = await Attendance.findAll({ where: { date: { [Op.like]: `${month}%` }, userId: people.map((p) => p.id) }, raw: true });
  res.json({
    date,
    people: people.map((p) => {
      const r = rows.find((x) => x.userId === p.id);
      const mine = monthRows.filter((x) => x.userId === p.id);
      return { user: p, record: r || null, status: r ? (r.inAt && !r.outAt ? 'in' : r.status) : 'not_in',
        month: { present: mine.filter((x) => ['present', 'remote'].includes(x.status)).length, late: mine.filter((x) => x.status === 'late').length, leave: mine.filter((x) => x.status === 'leave').length, hours: Math.round(mine.reduce((s, x) => s + (x.minutes || 0), 0) / 6) / 10 } };
    }),
  });
}));

router.post('/attendance/mark', requirePerm('attendance.manage'), wrap(async (req, res) => {
  const { userId, date, status, note } = req.body;
  if (!['present', 'late', 'half_day', 'absent', 'remote', 'leave'].includes(status)) return res.status(400).json({ error: 'Pick a valid status.' });
  const [rec] = await Attendance.findOrCreate({ where: { userId, date }, defaults: { status } });
  rec.status = status; if (note !== undefined) rec.note = note; await rec.save();
  if (Number(userId) !== req.user.id) await notify({ userIds: [Number(userId)], type: 'task_status', title: `Attendance for ${date} marked ${status.replace('_', ' ')}`, body: note || `By ${req.user.name}`, link: '/attendance' });
  socket.toStaff('attendance:changed', { userId: Number(userId) });
  res.json(rec);
}));

router.get('/attendance/export', requirePerm('attendance.manage'), wrap(async (req, res) => {
  const month = req.query.month || today().slice(0, 7);
  const rows = await Attendance.findAll({ where: { date: { [Op.like]: `${month}%` } }, include: [{ model: User, attributes: ['name', 'email'] }], order: [['date', 'ASC']] });
  const t = (d) => (d ? new Date(d).toLocaleTimeString('en-IN', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }) : '');
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [['Date', 'Name', 'Email', 'Status', 'Mode', 'In', 'Out', 'Hours', 'Note'].join(','),
    ...rows.map((r) => [r.date, r.User?.name, r.User?.email, r.status, r.mode, t(r.inAt), t(r.outAt), (r.minutes / 60).toFixed(1), r.note].map(esc).join(','))].join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="attendance-${month}.csv"`);
  res.send(csv);
}));

// ---------- workload ----------
router.get('/workload', wrap(async (req, res) => {
  const days = Math.min(Number(req.query.days) || 10, 28);
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const dates = [];
  for (let i = 0, d = new Date(start); dates.length < days && i < days * 2; i += 1, d = new Date(d.getTime() + 864e5)) {
    if (d.getDay() !== 0) dates.push(new Date(d)); // skip Sundays
  }
  const staff = await User.findAll({ where: { isActive: true }, include: [{ model: Role, attributes: ['name', 'isClientRole'] }], attributes: ['id', 'name', 'color', 'designation', 'department'] });
  // Whole team for managers; otherwise yourself and (with tasks.view_team) the people who report to you.
  const allowed = req.can('dashboard.team') || req.can('users.manage') ? null : await teamIds(req);
  const people = staff.filter((u) => !u.Role?.isClientRole && (!allowed || allowed.includes(u.id)));
  const rows = await TaskAssignee.findAll({ where: { userId: people.map((p) => p.id) }, raw: true });
  const tasks = await Task.findAll({ where: { id: rows.map((r) => r.taskId), status: { [Op.ne]: 'done' }, archived: false }, attributes: ['id', 'key', 'title', 'startDate', 'dueDate', 'estimateHours', 'priority', 'status'], raw: true });
  const capacity = Number((await settings.get('company')).dailyCapacity || 7);
  const out = people.map((p) => {
    const mine = tasks.filter((t) => rows.some((r) => r.userId === p.id && r.taskId === t.id));
    const perDay = dates.map(() => 0);
    let unscheduled = 0;
    mine.forEach((t) => {
      const hours = Number(t.estimateHours) || 2;
      if (!t.dueDate) { unscheduled += hours; return; }
      const due = new Date(t.dueDate);
      const from = t.startDate ? new Date(t.startDate) : due;
      const span = dates.filter((d) => d >= new Date(from.toDateString()) && d <= due);
      if (!span.length) { if (due < start) perDay[0] += hours; return; } // overdue work lands today
      span.forEach((d) => { perDay[dates.indexOf(d)] += hours / span.length; });
    });
    const overdue = mine.filter((t) => t.dueDate && new Date(t.dueDate) < new Date()).length;
    return { user: p, open: mine.length, overdue, unscheduled: Math.round(unscheduled * 10) / 10,
      days: perDay.map((h) => Math.round(h * 10) / 10), utilisation: Math.round((perDay.reduce((a, b) => a + b, 0) / (capacity * dates.length)) * 100) };
  }).sort((a, b) => b.utilisation - a.utilisation);
  res.json({ dates: dates.map((d) => d.toISOString().slice(0, 10)), capacity, people: out });
}));

// ---------- rewards ----------
// Everyone sees their own points and rank. Full leaderboard numbers and other people's history need
// rewards.view_all (or tasks.view_team for people who report to you).
const canSeePoints = async (req, userId) => userId === req.user.id || req.can('rewards.view_all') || (await teamIds(req)).includes(userId);

router.get('/rewards/me', wrap(async (req, res) => {
  const userId = req.query.userId ? Number(req.query.userId) : req.user.id;
  if (!(await canSeePoints(req, userId))) return res.status(403).json({ error: "You can only see your own points." });
  const s = await points.summary(userId);
  const board = await points.leaderboard('month');
  res.json({ ...s, rank: board.findIndex((b) => b.user.id === userId) + 1 || null, of: board.length, catalog: points.BADGES });
}));
router.get('/rewards/leaderboard', wrap(async (req, res) => {
  const board = await points.leaderboard(req.query.period || 'month');
  if (req.can('rewards.view_all')) return res.json(board);
  const team = await teamIds(req);
  // Names and ranks stay visible for motivation; points only for yourself and your team.
  res.json(board.map((b, i) => (team.includes(b.user.id) ? { ...b, rank: i + 1 } : { user: b.user, rank: i + 1, points: null, badges: b.badges, hidden: true })));
}));
router.post('/rewards/kudos', wrap(async (req, res) => {
  const { userId, points: pts = 10, reason } = req.body;
  if (!userId || Number(userId) === req.user.id) return res.status(400).json({ error: 'Pick a teammate to appreciate.' });
  if (!reason?.trim()) return res.status(400).json({ error: 'Say what they did well.' });
  const manager = req.can('rewards.manage');
  if (!manager) {
    const since = new Date(); since.setHours(0, 0, 0, 0);
    const given = await PointEntry.count({ where: { kind: 'kudos', reason: { [Op.like]: `Kudos from ${req.user.name}:%` }, createdAt: { [Op.gte]: since } } });
    if (given >= 3) return res.status(429).json({ error: 'You can give kudos 3 times a day. Try again tomorrow.' });
  }
  const n = Math.max(1, Math.min(manager ? 100 : 10, Number(pts) || 10));
  await points.award(Number(userId), n, 'kudos', `Kudos from ${req.user.name}: ${reason.slice(0, 140)}`, null);
  await notify({ userIds: [Number(userId)], type: 'kudos', title: `🎉 ${req.user.name} gave you +${n} points`, body: reason.slice(0, 200), link: '/rewards' });
  res.json({ ok: true, points: n });
}));

module.exports = router;
