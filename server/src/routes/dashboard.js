const router = require('express').Router();
const { Op } = require('sequelize');
const { Task, User, Role, Project, Activity, ClientRequest, TimeLog, Meeting, TaskAssignee } = require('../models');
const { staffOnly } = require('../middleware/auth');
const { taskScope, visibleProjectIds } = require('../services/access');
const { computeHealth } = require('../services/health');
const { decorate, listIncludes, canApprove } = require('./tasks');

router.use(staffOnly);

const DAY = 864e5;
const TZ = 'Asia/Kolkata';
const dayKey = (d) => new Date(d).toLocaleDateString('en-CA', { timeZone: TZ });
const startOfToday = () => { const d = new Date(new Date().toLocaleDateString('en-CA', { timeZone: TZ }) + 'T00:00:00+05:30'); return d; };

router.get('/', async (req, res) => {
  try {
    const me = req.user.id;
    const now = new Date();
    const today0 = startOfToday();
    const today1 = new Date(today0.getTime() + DAY - 1);
    const team = req.can('dashboard.team');

    // Everything the user is allowed to see (whole company for managers with view_all)
    const scope = await taskScope(req);
    const all = await Task.findAll({ where: { [Op.and]: [scope, { archived: false }] }, attributes: ['id', 'key', 'title', 'status', 'priority', 'dueDate', 'createdAt', 'completedAt', 'projectId', 'parentId', 'updatedAt'], raw: true });
    const open = all.filter((t) => t.status !== 'done');
    const overdue = open.filter((t) => t.dueDate && new Date(t.dueDate) < now);

    // My tasks
    const myIds = new Set((await TaskAssignee.findAll({ where: { userId: me }, raw: true })).map((r) => r.taskId));
    const mineOpen = await Task.findAll({ where: { id: [...myIds], status: { [Op.ne]: 'done' }, archived: false }, include: listIncludes });
    const sortedMine = mineOpen.sort((a, b) => (a.dueDate ? new Date(a.dueDate) : Infinity) - (b.dueDate ? new Date(b.dueDate) : Infinity));
    const prioRank = { urgent: 0, high: 1, medium: 2, low: 3 };
    const focusTask = [...mineOpen].sort((a, b) => {
      const ao = a.dueDate && new Date(a.dueDate) < now ? 0 : 1; const bo = b.dueDate && new Date(b.dueDate) < now ? 0 : 1;
      if (ao !== bo) return ao - bo;
      const at = a.dueDate && new Date(a.dueDate) <= today1 ? 0 : 1; const bt = b.dueDate && new Date(b.dueDate) <= today1 ? 0 : 1;
      if (at !== bt) return at - bt;
      if (prioRank[a.priority] !== prioRank[b.priority]) return prioRank[a.priority] - prioRank[b.priority];
      return (a.dueDate ? new Date(a.dueDate) : Infinity) - (b.dueDate ? new Date(b.dueDate) : Infinity);
    })[0];
    let focus = null;
    if (focusTask) {
      const isOver = focusTask.dueDate && new Date(focusTask.dueDate) < now;
      const isToday = focusTask.dueDate && new Date(focusTask.dueDate) <= today1;
      focus = {
        task: (await decorate([focusTask]))[0],
        reason: isOver ? 'This is overdue and may be holding others up. Finish it or agree a new date.'
          : isToday ? 'Due today. Get it moving before anything new.'
            : focusTask.priority === 'urgent' || focusTask.priority === 'high' ? `It's ${focusTask.priority} priority and next on your list.` : "It's the next thing due on your list.",
        kind: isOver ? 'overdue' : isToday ? 'today' : 'next',
      };
    }

    const pendingApprovals = await Task.findAll({ where: { approvalStatus: 'pending', status: 'review', archived: false }, include: listIncludes });
    const myApprovals = [];
    for (const t of pendingApprovals) if (await canApprove(req, t)) myApprovals.push(t);

    // 14-day velocity + burndown
    const days = [...Array(14)].map((_, i) => dayKey(now.getTime() - (13 - i) * DAY));
    const velocity = days.map((d) => ({ day: d, created: all.filter((t) => dayKey(t.createdAt) === d).length, completed: all.filter((t) => t.completedAt && dayKey(t.completedAt) === d).length }));
    const burndown = days.map((d) => {
      const end = new Date(`${d}T23:59:59+05:30`);
      return { day: d, remaining: all.filter((t) => new Date(t.createdAt) <= end && (!t.completedAt || new Date(t.completedAt) > end)).length };
    });
    const b0 = burndown[0]?.remaining || 0;
    burndown.forEach((b, i) => { b.ideal = Math.max(0, Math.round(b0 - (b0 / 13) * i)); });
    const createdSum = velocity.reduce((s, v) => s + v.created, 0);
    const completedSum = velocity.reduce((s, v) => s + v.completed, 0);

    const statusMix = ['backlog', 'todo', 'in_progress', 'review', 'blocked', 'done'].map((s) => ({ status: s, count: all.filter((t) => t.status === s).length }));
    const prioritySplit = ['urgent', 'high', 'medium', 'low'].map((p) => ({ priority: p, count: open.filter((t) => t.priority === p).length }));

    // Projects + health
    const pids = await visibleProjectIds(req);
    const health = await computeHealth(pids ? { projectIds: pids } : {});
    const lastMonth = new Date(now.getTime() - 30 * DAY);
    const projectsRunning = health.projects.filter((p) => p.status === 'active').length;
    const projectsNewThisMonth = await Project.count({ where: { ...(pids ? { id: pids } : {}), createdAt: { [Op.gte]: lastMonth } } });
    const roadmap = health.projects.filter((p) => p.dueDate).sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate)).slice(0, 8);

    // Team pulse
    let pulse = [];
    if (team) {
      const staff = await User.findAll({ where: { isActive: true }, include: [{ model: Role, attributes: ['name', 'isClientRole'] }], attributes: ['id', 'name', 'color', 'designation', 'lastSeenAt'] });
      const openWithPeople = await Task.findAll({ where: { status: { [Op.ne]: 'done' }, archived: false }, attributes: ['id', 'dueDate', 'priority'], include: [{ model: User, as: 'assignees', attributes: ['id'], through: { attributes: [] } }] });
      const weekAgo = new Date(now.getTime() - 7 * DAY);
      const doneWeek = await Task.findAll({ where: { status: 'done', completedAt: { [Op.gte]: weekAgo } }, attributes: ['id'], include: [{ model: User, as: 'assignees', attributes: ['id'], through: { attributes: [] } }] });
      pulse = staff.filter((u) => !u.Role?.isClientRole).map((u) => {
        const ts = openWithPeople.filter((t) => t.assignees.some((a) => a.id === u.id));
        const n = ts.length;
        return { id: u.id, name: u.name, color: u.color, role: u.Role?.name, designation: u.designation, open: n,
          overdue: ts.filter((t) => t.dueDate && new Date(t.dueDate) < now).length, urgent: ts.filter((t) => ['urgent', 'high'].includes(t.priority)).length,
          doneWeek: doneWeek.filter((t) => t.assignees.some((a) => a.id === u.id)).length, load: n >= 10 ? 'high' : n >= 5 ? 'medium' : 'low' };
      }).sort((a, b) => b.open - a.open);
    }

    const wins = await Task.findAll({ where: { [Op.and]: [scope, { status: 'done', completedAt: { [Op.gte]: today0 } }] }, attributes: ['id', 'key', 'title', 'completedAt'], include: [{ model: User, as: 'assignees', attributes: ['id', 'name', 'color'], through: { attributes: [] } }], order: [['completedAt', 'DESC']], limit: 8 });
    const minutesToday = (await TimeLog.sum('minutes', { where: { userId: me, startedAt: { [Op.gte]: today0 } } })) || 0;
    const meetingsToday = await Meeting.findAll({ where: { startAt: { [Op.between]: [today0, today1] } }, include: [{ model: User, as: 'attendees', attributes: ['id'], through: { attributes: [] } }], order: [['startAt', 'ASC']] });
    const myMeetings = meetingsToday.filter((m) => m.organizerId === me || m.attendees.some((a) => a.id === me)).map((m) => ({ id: m.id, title: m.title, startAt: m.startAt, endAt: m.endAt, link: m.link }));

    const actWhere = pids ? { [Op.or]: [{ projectId: pids }, { actorId: me }] } : {};
    const recent = await Activity.findAll({ where: actWhere, order: [['createdAt', 'DESC']], limit: 25,
      include: [{ model: User, as: 'actor', attributes: ['id', 'name', 'color'] }, { model: Project, attributes: ['id', 'name', 'color'] }] });

    res.json({
      scope: team ? 'team' : 'mine',
      hero: {
        active: all.filter((t) => t.status === 'in_progress').length,
        pending: all.filter((t) => ['todo', 'backlog'].includes(t.status)).length,
        review: all.filter((t) => t.status === 'review').length,
        completed: all.filter((t) => t.status === 'done').length,
        urgentMine: mineOpen.filter((t) => t.priority === 'urgent' || (t.dueDate && new Date(t.dueDate) < now)).length,
      },
      kpis: {
        activeProjects: projectsRunning, totalProjects: health.projects.length, newProjects: projectsNewThisMonth,
        totalTasks: all.length, inProgress: all.filter((t) => t.status === 'in_progress').length,
        completionRate: all.length ? Math.round((all.filter((t) => t.status === 'done').length / all.length) * 100) : 0,
        done: all.filter((t) => t.status === 'done').length,
        overdue: overdue.length, overdueUrgent: overdue.filter((t) => t.priority === 'urgent').length,
        clientRequests: team ? await ClientRequest.count({ where: { status: 'open' } }) : 0,
      },
      velocity, velocityFlag: createdSum > completedSum * 1.25 && createdSum - completedSum >= 3 ? 'Adding work faster than closing it' : completedSum > createdSum ? 'Closing more than you add' : null,
      burndown, statusMix, prioritySplit, pulse,
      personal: {
        open: mineOpen.length,
        dueToday: mineOpen.filter((t) => t.dueDate && new Date(t.dueDate) >= today0 && new Date(t.dueDate) <= today1).length,
        overdue: mineOpen.filter((t) => t.dueDate && new Date(t.dueDate) < now).length,
        minutesToday,
        tasks: await decorate(sortedMine.slice(0, 10)),
        approvals: await decorate(myApprovals.slice(0, 8)),
        meetings: myMeetings,
      },
      focus, wins, roadmap,
      risks: health.alerts.slice(0, 6),
      projects: health.projects.slice(0, 8).map((p) => ({ id: p.id, name: p.name, color: p.color, icon: p.icon, open: p.open, progress: p.progress, state: p.state, score: p.score })),
      health: health.projects,
      activity: recent,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
