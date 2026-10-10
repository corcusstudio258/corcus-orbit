const router = require('express').Router();
const { Op } = require('sequelize');
const { Task, User, Role, Project, Activity, ClientRequest, TimeLog, Client } = require('../models');
const { staffOnly } = require('../middleware/auth');
const { taskScope, visibleProjectIds } = require('../services/access');
const { projectProgress } = require('../services/progress');
const { decorate, listIncludes } = require('./tasks');

router.use(staffOnly);

const dayKey = (d) => new Date(d).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

router.get('/', async (req, res) => {
  try {
    const me = req.user.id;
    const now = new Date();
    const endOfToday = new Date(); endOfToday.setHours(23, 59, 59, 999);
    const weekAgo = new Date(Date.now() - 7 * 864e5);

    const mine = await Task.findAll({
      include: [...listIncludes.map((i) => (i.as === 'assignees' ? { ...i, where: { id: me }, required: true } : i))],
      where: { status: { [Op.ne]: 'done' } }, order: [['dueDate', 'ASC']],
    });
    // re-fetch with all assignees (the filtered include only returns me)
    const myTasks = mine.length ? await Task.findAll({ where: { id: mine.map((t) => t.id) }, include: listIncludes }) : [];
    const sorted = myTasks.sort((a, b) => (a.dueDate ? new Date(a.dueDate) : Infinity) - (b.dueDate ? new Date(b.dueDate) : Infinity));

    const doneThisWeek = await Task.count({ where: { status: 'done', completedAt: { [Op.gte]: weekAgo } },
      include: [{ model: User, as: 'assignees', where: { id: me }, attributes: [], through: { attributes: [] } }] });

    // Approvals waiting on me
    const pendingApprovals = await Task.findAll({ where: { approvalStatus: 'pending', status: 'review' },
      include: listIncludes });
    const myApprovals = pendingApprovals.filter((t) => !t.assignees.some((a) => a.id === me) && (req.can('tasks.approve') || t.createdById === me || t.Project?.ownerId === me));

    const minutesToday = (await TimeLog.sum('minutes', { where: { userId: me, startedAt: { [Op.gte]: new Date(new Date().setHours(0, 0, 0, 0)) } } })) || 0;

    const personal = {
      open: sorted.length,
      dueToday: sorted.filter((t) => t.dueDate && new Date(t.dueDate) <= endOfToday && new Date(t.dueDate) >= new Date(new Date().setHours(0, 0, 0, 0))).length,
      overdue: sorted.filter((t) => t.dueDate && new Date(t.dueDate) < now).length,
      doneThisWeek,
      minutesToday,
      tasks: await decorate(sorted.slice(0, 12)),
      approvals: await decorate(myApprovals.slice(0, 10)),
    };

    // Activity the user can see
    const pids = await visibleProjectIds(req);
    const actWhere = pids ? { [Op.or]: [{ projectId: pids }, { actorId: me }] } : {};
    const recent = await Activity.findAll({ where: actWhere, order: [['createdAt', 'DESC']], limit: 25,
      include: [{ model: User, as: 'actor', attributes: ['id', 'name', 'color'] }, { model: Project, attributes: ['id', 'name', 'color'] }] });

    let team = null;
    if (req.can('dashboard.team')) {
      const all = await Task.findAll({ attributes: ['id', 'status', 'dueDate', 'createdAt', 'completedAt', 'priority', 'projectId', 'parentId'], raw: true });
      const open = all.filter((t) => t.status !== 'done');
      const days = [...Array(14)].map((_, i) => dayKey(Date.now() - (13 - i) * 864e5));
      const trend = days.map((d) => ({
        day: d,
        created: all.filter((t) => dayKey(t.createdAt) === d).length,
        completed: all.filter((t) => t.completedAt && dayKey(t.completedAt) === d).length,
      }));
      const status = ['todo', 'in_progress', 'review', 'blocked', 'done'].map((s) => ({ status: s, count: all.filter((t) => t.status === s).length }));

      const staff = await User.findAll({ where: { isActive: true, '$Role.isClientRole$': false }, include: [{ model: Role, attributes: ['name', 'color', 'isClientRole'] }],
        attributes: ['id', 'name', 'color', 'designation'] });
      const openWithPeople = await Task.findAll({ where: { status: { [Op.ne]: 'done' } }, attributes: ['id', 'dueDate', 'priority'],
        include: [{ model: User, as: 'assignees', attributes: ['id'], through: { attributes: [] } }] });
      const doneWeek = await Task.findAll({ where: { status: 'done', completedAt: { [Op.gte]: weekAgo } }, attributes: ['id'],
        include: [{ model: User, as: 'assignees', attributes: ['id'], through: { attributes: [] } }] });
      const workload = staff.map((u) => {
        const ts = openWithPeople.filter((t) => t.assignees.some((a) => a.id === u.id));
        return { id: u.id, name: u.name, color: u.color, role: u.Role?.name, open: ts.length,
          overdue: ts.filter((t) => t.dueDate && new Date(t.dueDate) < now).length,
          urgent: ts.filter((t) => ['urgent', 'high'].includes(t.priority)).length,
          doneWeek: doneWeek.filter((t) => t.assignees.some((a) => a.id === u.id)).length };
      }).sort((a, b) => b.open - a.open);

      const projects = await Project.findAll({ where: { status: { [Op.in]: ['active', 'planning', 'on_hold'] } },
        include: [{ model: Client, attributes: ['id', 'name'] }] });
      const health = projects.map((p) => {
        const own = all.filter((t) => t.projectId === p.id);
        const progress = projectProgress(own);
        let expected = null;
        if (p.startDate && p.dueDate) {
          const span = new Date(p.dueDate) - new Date(p.startDate);
          expected = span > 0 ? Math.min(100, Math.max(0, Math.round(((now - new Date(p.startDate)) / span) * 100))) : 100;
        }
        const overdue = own.filter((t) => t.status !== 'done' && t.dueDate && new Date(t.dueDate) < now).length;
        const state = expected == null ? (overdue > 2 ? 'at_risk' : 'on_track') : progress + 10 >= expected ? 'on_track' : progress + 25 >= expected ? 'at_risk' : 'behind';
        return { id: p.id, name: p.name, code: p.code, color: p.color, client: p.Client?.name, progress, expected, overdue, state, dueDate: p.dueDate, taskCount: own.length };
      }).sort((a, b) => ({ behind: 0, at_risk: 1, on_track: 2 }[a.state] - { behind: 0, at_risk: 1, on_track: 2 }[b.state]));

      team = {
        open: open.length,
        overdue: open.filter((t) => t.dueDate && new Date(t.dueDate) < now).length,
        doneThisWeek: all.filter((t) => t.completedAt && new Date(t.completedAt) >= weekAgo).length,
        inReview: all.filter((t) => t.status === 'review').length,
        clientRequests: await ClientRequest.count({ where: { status: 'open' } }),
        trend, status, workload, health,
      };
    }
    res.json({ personal, team, activity: recent });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
