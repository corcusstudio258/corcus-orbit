// Rewards: points ledger + badges. Everything here is idempotent per (user, kind, refId).
const { Op, fn, col } = require('sequelize');
const { PointEntry, UserBadge, Task, User, TaskAssignee, Attendance, Comment } = require('../models');
const { notify } = require('./notify');

const BADGES = [
  { code: 'first_task', icon: '⚡', name: 'First spark', desc: 'Complete your first task' },
  { code: 'ten_tasks', icon: '🔥', name: 'On a roll', desc: 'Complete 10 tasks' },
  { code: 'fifty_tasks', icon: '🚀', name: 'Lift-off', desc: 'Complete 50 tasks' },
  { code: 'century', icon: '🏆', name: 'Centurion', desc: 'Complete 100 tasks' },
  { code: 'speed_demon', icon: '💨', name: 'Speed demon', desc: 'Complete 5 tasks in one day' },
  { code: 'on_time_hero', icon: '🎯', name: 'Deadline keeper', desc: 'Finish 10 tasks on or before their due date' },
  { code: 'early_bird', icon: '🌅', name: 'Early bird', desc: 'Punch in on time 10 times' },
  { code: 'streak_5', icon: '📅', name: 'Five-day streak', desc: 'Punch in 5 working days in a row' },
  { code: 'team_player', icon: '🤝', name: 'Team player', desc: 'Post 25 comments that help the team' },
  { code: 'urgent_fixer', icon: '🧯', name: 'Firefighter', desc: 'Close 5 urgent tasks' },
];
const BADGE_MAP = Object.fromEntries(BADGES.map((b) => [b.code, b]));

async function award(userId, points, kind, reason, refId = null) {
  if (!userId || !points) return null;
  if (refId != null) {
    const exists = await PointEntry.findOne({ where: { userId, kind, refId } });
    if (exists) return null;
  }
  return PointEntry.create({ userId, points, kind, reason, refId });
}

async function giveBadge(userId, code) {
  const has = await UserBadge.findOne({ where: { userId, code } });
  if (has) return false;
  await UserBadge.create({ userId, code });
  const b = BADGE_MAP[code];
  await award(userId, 25, 'badge', `Badge: ${b.name}`, null);
  await notify({ userIds: [userId], type: 'task_status', title: `${b.icon} New badge: ${b.name}`, body: b.desc, link: '/rewards' });
  return true;
}

async function doneTaskIds(userId) {
  const rows = await TaskAssignee.findAll({ where: { userId }, attributes: ['taskId'], raw: true });
  return rows.map((r) => r.taskId);
}

async function checkTaskBadges(userId) {
  const ids = await doneTaskIds(userId);
  const done = await Task.findAll({ where: { id: ids, status: 'done' }, attributes: ['id', 'completedAt', 'dueDate', 'priority'], raw: true });
  const n = done.length;
  if (n >= 1) await giveBadge(userId, 'first_task');
  if (n >= 10) await giveBadge(userId, 'ten_tasks');
  if (n >= 50) await giveBadge(userId, 'fifty_tasks');
  if (n >= 100) await giveBadge(userId, 'century');
  const today = new Date().toDateString();
  if (done.filter((t) => t.completedAt && new Date(t.completedAt).toDateString() === today).length >= 5) await giveBadge(userId, 'speed_demon');
  if (done.filter((t) => t.dueDate && t.completedAt && new Date(t.completedAt) <= new Date(t.dueDate)).length >= 10) await giveBadge(userId, 'on_time_hero');
  if (done.filter((t) => t.priority === 'urgent').length >= 5) await giveBadge(userId, 'urgent_fixer');
}

/** Called when a task moves to done. */
async function onTaskDone(task) {
  const assignees = (await TaskAssignee.findAll({ where: { taskId: task.id }, raw: true })).map((a) => a.userId);
  const completedAt = task.completedAt ? new Date(task.completedAt) : new Date();
  for (const userId of assignees) {
    const base = { urgent: 20, high: 15, medium: 10, low: 8 }[task.priority] || 10;
    await award(userId, base, 'task_done', `Completed ${task.key}`, task.id);
    if (task.dueDate) {
      const due = new Date(task.dueDate);
      if (completedAt <= due) await award(userId, 5, 'on_time', `On time: ${task.key}`, task.id);
      if (due - completedAt >= 24 * 3600e3) await award(userId, 5, 'early', `Finished early: ${task.key}`, task.id);
    }
    await checkTaskBadges(userId);
  }
}

async function onAttendance(userId, record) {
  if (record.status === 'present' || record.status === 'remote') {
    await award(userId, 2, 'attendance', 'Punched in on time', record.id);
    const onTime = await Attendance.count({ where: { userId, status: ['present', 'remote'] } });
    if (onTime >= 10) await giveBadge(userId, 'early_bird');
  } else if (record.status === 'late') {
    await award(userId, 1, 'attendance', 'Punched in', record.id);
  }
  // streak: last 5 working days present
  const recent = await Attendance.findAll({ where: { userId }, order: [['date', 'DESC']], limit: 10, raw: true });
  let streak = 0;
  const d = new Date(record.date);
  for (let i = 0; i < 14 && streak < 5; i += 1) {
    const day = d.getDay();
    const key = d.toISOString().slice(0, 10);
    if (day !== 0) {
      if (recent.some((r) => r.date === key && r.inAt)) streak += 1; else break;
    }
    d.setDate(d.getDate() - 1);
  }
  if (streak >= 5) {
    await giveBadge(userId, 'streak_5');
    // at most one streak bonus per calendar week
    const dt = new Date(record.date);
    const weekKey = dt.getFullYear() * 100 + Math.ceil(((dt - new Date(dt.getFullYear(), 0, 1)) / 864e5 + 1) / 7);
    await award(userId, 10, 'streak', '5-day attendance streak', weekKey);
  }
}

async function onComment(userId) {
  const n = await Comment.count({ where: { userId } });
  if (n >= 25) await giveBadge(userId, 'team_player');
}

async function summary(userId) {
  const lifetime = (await PointEntry.sum('points', { where: { userId } })) || 0;
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  const month = (await PointEntry.sum('points', { where: { userId, createdAt: { [Op.gte]: monthStart } } })) || 0;
  const badges = await UserBadge.findAll({ where: { userId }, order: [['createdAt', 'DESC']], raw: true });
  const history = await PointEntry.findAll({ where: { userId }, order: [['createdAt', 'DESC']], limit: 40, raw: true });
  return { lifetime, month, badges: badges.map((b) => ({ ...BADGE_MAP[b.code], code: b.code, earnedAt: b.createdAt })), history };
}

async function leaderboard(period = 'month') {
  const where = {};
  if (period !== 'all') {
    const since = new Date();
    if (period === 'week') since.setDate(since.getDate() - 7); else { since.setDate(1); since.setHours(0, 0, 0, 0); }
    where.createdAt = { [Op.gte]: since };
  }
  const rows = await PointEntry.findAll({ where, attributes: ['userId', [fn('SUM', col('points')), 'points']], group: ['userId'], raw: true });
  const users = await User.findAll({ where: { id: rows.map((r) => r.userId), isActive: true }, attributes: ['id', 'name', 'color', 'designation'] });
  const badgeCounts = await UserBadge.findAll({ attributes: ['userId', [fn('COUNT', col('id')), 'n']], group: ['userId'], raw: true });
  return rows.map((r) => {
    const u = users.find((x) => x.id === r.userId);
    return u ? { user: u, points: Number(r.points), badges: Number(badgeCounts.find((b) => b.userId === r.userId)?.n || 0) } : null;
  }).filter(Boolean).sort((a, b) => b.points - a.points);
}

module.exports = { BADGES, award, giveBadge, onTaskDone, onAttendance, onComment, summary, leaderboard };
