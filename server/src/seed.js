/**
 * npm run seed        -> creates the default roles only (first admin is created on the setup screen)
 * npm run seed:demo   -> wipes the database and loads a demo workspace with people, clients, projects and task trees
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const bcrypt = require('bcryptjs');
const models = require('./models');
const { ensureRoles } = require('./routes/auth');
const settings = require('./services/settings');

const { sequelize, Role, User, Client, Project, Milestone, Task, Comment, ChecklistItem, TimeLog, Activity, ClientRequest, ProjectMember } = models;

const DAY = 864e5;
const d = (days, hour = 18) => { const x = new Date(Date.now() + days * DAY); x.setHours(hour, 0, 0, 0); return x; };
const dateOnly = (days) => new Date(Date.now() + days * DAY).toISOString().slice(0, 10);

async function demo() {
  await sequelize.sync({ force: true });
  await ensureRoles();
  await settings.set('company', { name: 'Corcus Studio', tagline: 'Creative & growth studio, Patna' });
  const roles = Object.fromEntries((await Role.findAll()).map((r) => [r.slug, r]));
  const pw = await bcrypt.hash('Orbit@123', 10);
  const mk = (o) => User.create({ passwordHash: pw, ...o });

  const admin = await mk({ name: 'Aman Verma', email: 'admin@corcus.in', roleId: roles.admin.id, designation: 'Founder', department: 'Leadership', color: '#8F7BFF', phone: '9000000001' });
  const mgr = await mk({ name: 'Riya Sinha', email: 'manager@corcus.in', roleId: roles.manager.id, designation: 'Account Manager', department: 'Client Services', color: '#3DE0F2', reportsToId: admin.id, phone: '9000000002' });
  const mgr2 = await mk({ name: 'Kunal Raj', email: 'kunal@corcus.in', roleId: roles.manager.id, designation: 'Tech Manager', department: 'Development', color: '#5BE3A6', reportsToId: admin.id });
  const lead = await mk({ name: 'Sneha Kumari', email: 'lead@corcus.in', roleId: roles['team-lead'].id, designation: 'Creative Lead', department: 'Creative', color: '#FFB648', reportsToId: mgr.id });
  const e1 = await mk({ name: 'Rahul Kumar', email: 'rahul@corcus.in', roleId: roles.executive.id, designation: 'Graphic Designer', department: 'Creative', color: '#FF7A90', reportsToId: lead.id });
  const e2 = await mk({ name: 'Priya Singh', email: 'priya@corcus.in', roleId: roles.executive.id, designation: 'Content Writer', department: 'Creative', color: '#B8A6FF', reportsToId: lead.id });
  const e3 = await mk({ name: 'Ankit Mishra', email: 'ankit@corcus.in', roleId: roles.executive.id, designation: 'Performance Marketer', department: 'Ads', color: '#62D2FF', reportsToId: mgr.id });
  const e4 = await mk({ name: 'Vikash Yadav', email: 'vikash@corcus.in', roleId: roles.executive.id, designation: 'Full-stack Developer', department: 'Development', color: '#7EF0C9', reportsToId: mgr2.id });

  const c1 = await Client.create({ name: 'Kasaar', company: 'Kasaar Foods', industry: 'FMCG', city: 'Patna', email: 'hello@kasaar.in', whatsapp: '9000000101', color: '#FFB648' });
  const c2 = await Client.create({ name: 'Advance Skin & Hair Clinic', company: 'Advance Clinic', industry: 'Healthcare', city: 'Patna', color: '#FF7A90' });
  const c3 = await Client.create({ name: 'SunRuf', company: 'SunRuf Solar', industry: 'Solar energy', city: 'Patna', color: '#5BE3A6' });
  await User.create({ name: 'Kasaar Team', email: 'client@kasaar.in', passwordHash: pw, roleId: roles.client.id, clientId: c1.id, color: c1.color, designation: 'Kasaar Foods' });

  const fakeReq = (u) => ({ user: u, can: () => true });
  const { createTask } = require('./routes/tasks');
  const T = async (u, data, extra = {}) => {
    const t = await createTask(fakeReq(u), data);
    if (Object.keys(extra).length) await t.update(extra);
    return t;
  };

  // ---------- Project 1: Kasaar Diwali campaign ----------
  const p1 = await Project.create({ name: 'Kasaar Diwali Campaign', code: 'KAS', clientId: c1.id, ownerId: mgr.id, status: 'active', priority: 'high',
    startDate: dateOnly(-12), dueDate: dateOnly(14), color: '#FFB648', description: 'Festive social + Meta ads push for thekua gift boxes.' });
  await p1.setMembers([mgr.id, lead.id, e1.id, e2.id, e3.id]);
  const m1 = await Milestone.create({ projectId: p1.id, title: 'Creative kit approved', dueDate: dateOnly(-2), done: true, order: 0 });
  const m2 = await Milestone.create({ projectId: p1.id, title: 'Ads live', dueDate: dateOnly(4), order: 1 });
  const m3 = await Milestone.create({ projectId: p1.id, title: 'Campaign wrap report', dueDate: dateOnly(14), order: 2 });

  const k1 = await T(mgr, { title: 'Diwali content calendar (October)', projectId: p1.id, assigneeIds: [lead.id], priority: 'high', dueDate: d(-3), clientVisible: true, milestoneId: m1.id }, { status: 'done', completedAt: d(-3) });
  const k1a = await T(lead, { title: 'Write 20 post captions in Hinglish', parentId: k1.id, assigneeIds: [e2.id], dueDate: d(-5) }, { status: 'done', completedAt: d(-5) });
  await T(lead, { title: 'Design 12 static posts', parentId: k1.id, assigneeIds: [e1.id], dueDate: d(-4) }, { status: 'done', completedAt: d(-4) });
  void k1a;

  const k2 = await T(mgr, { title: 'Festive gift-box reels', projectId: p1.id, assigneeIds: [lead.id, e1.id], priority: 'high', dueDate: d(2), clientVisible: true, requiresApproval: true, milestoneId: m2.id,
    description: 'Three 20–30s reels showing the gift box unboxing, the thekua making process and a family moment.' }, { status: 'in_progress' });
  const k2a = await T(lead, { title: 'Reel scripts (3)', parentId: k2.id, assigneeIds: [e2.id], dueDate: d(-1), clientVisible: true }, { status: 'done', completedAt: d(-1) });
  const k2b = await T(lead, { title: 'Shoot & edit', parentId: k2.id, assigneeIds: [e1.id], dueDate: d(1), clientVisible: true }, { status: 'in_progress' });
  await T(e1, { title: 'Unboxing reel edit', parentId: k2b.id, assigneeIds: [e1.id], dueDate: d(0, 20) }, { status: 'review', approvalStatus: 'pending' });
  await T(e1, { title: 'Process reel edit', parentId: k2b.id, assigneeIds: [e1.id], dueDate: d(1) }, { status: 'in_progress' });
  await T(e1, { title: 'Family moment reel edit', parentId: k2b.id, assigneeIds: [e1.id], dueDate: d(1) });
  await T(lead, { title: 'Music licensing check', parentId: k2.id, assigneeIds: [lead.id], dueDate: d(1) });
  void k2a;

  const k3 = await T(mgr, { title: 'Meta ads: Diwali sales campaign', projectId: p1.id, assigneeIds: [e3.id], priority: 'urgent', dueDate: d(4), clientVisible: true, milestoneId: m2.id,
    checklist: ['Pixel + CAPI events verified', 'Audience: Patna + Bihar 25-55', 'Budget split 70/30 prospecting/retargeting', 'UTM on every ad'] });
  await T(e3, { title: 'Build audiences & lookalikes', parentId: k3.id, assigneeIds: [e3.id], dueDate: d(1) }, { status: 'in_progress' });
  await T(e3, { title: 'Ad copy variants (6)', parentId: k3.id, assigneeIds: [e2.id], dueDate: d(-1) }, { status: 'blocked' });
  await T(mgr, { title: 'Wrap-up performance report', projectId: p1.id, assigneeIds: [e3.id], dueDate: d(14), clientVisible: true, milestoneId: m3.id });

  // ---------- Project 2: Clinic monthly social ----------
  const p2 = await Project.create({ name: 'Advance Clinic — November social', code: 'ADV', clientId: c2.id, ownerId: mgr.id, status: 'active',
    startDate: dateOnly(-3), dueDate: dateOnly(25), color: '#FF7A90', description: 'Monthly Instagram calendar, reels and story set for the dermatology clinic.' });
  await p2.setMembers([mgr.id, lead.id, e1.id, e2.id]);
  const a1 = await T(mgr, { title: 'November content calendar', projectId: p2.id, assigneeIds: [lead.id], dueDate: d(3), clientVisible: true, requiresApproval: true }, { status: 'review', approvalStatus: 'pending' });
  await T(lead, { title: 'Topic research: winter skincare myths', parentId: a1.id, assigneeIds: [e2.id], dueDate: d(-1) }, { status: 'done', completedAt: d(-1) });
  await T(lead, { title: 'Calendar sheet with captions', parentId: a1.id, assigneeIds: [e2.id], dueDate: d(2) }, { status: 'done', completedAt: d(0) });
  await T(mgr, { title: 'Doctor talking-head reel shoot', projectId: p2.id, assigneeIds: [e1.id], dueDate: d(-2), priority: 'high' });
  await T(mgr, { title: 'Before/after carousel templates', projectId: p2.id, assigneeIds: [e1.id], dueDate: d(6) });

  // ---------- Project 3: SunRuf website ----------
  const p3 = await Project.create({ name: 'SunRuf website rebuild', code: 'SUN', clientId: c3.id, ownerId: mgr2.id, status: 'active', priority: 'medium',
    startDate: dateOnly(-30), dueDate: dateOnly(5), color: '#5BE3A6', description: 'PHP + MySQL rebuild with admin panel and lead forms.' });
  await p3.setMembers([mgr2.id, e4.id]);
  await Milestone.create({ projectId: p3.id, title: 'Design sign-off', dueDate: dateOnly(-20), done: true, order: 0 });
  await Milestone.create({ projectId: p3.id, title: 'Go live', dueDate: dateOnly(5), order: 1 });
  const s1 = await T(mgr2, { title: 'Admin panel', projectId: p3.id, assigneeIds: [e4.id], dueDate: d(1), clientVisible: true }, { status: 'in_progress' });
  await T(e4, { title: 'Leads table with CSV export', parentId: s1.id, assigneeIds: [e4.id], dueDate: d(-2) }, { status: 'done', completedAt: d(-2) });
  await T(e4, { title: 'Project gallery manager', parentId: s1.id, assigneeIds: [e4.id], dueDate: d(1) }, { status: 'in_progress' });
  await T(mgr2, { title: 'Subsidy calculator page', projectId: p3.id, assigneeIds: [e4.id], dueDate: d(-1), clientVisible: true }, { status: 'review' });
  await T(mgr2, { title: 'Deploy to Hostinger + SSL', projectId: p3.id, assigneeIds: [e4.id], dueDate: d(4), clientVisible: true });

  // ---------- Internal (no client) ----------
  const p4 = await Project.create({ name: 'Corcus internal', code: 'COR', ownerId: admin.id, status: 'active', color: '#8F7BFF', clientVisible: false });
  await p4.setMembers([admin.id, mgr.id, mgr2.id, lead.id]);
  await T(admin, { title: 'Q4 hiring plan', projectId: p4.id, assigneeIds: [mgr.id, mgr2.id], dueDate: d(7) });
  await T(admin, { title: 'Agency portfolio page refresh', projectId: p4.id, assigneeIds: [lead.id], dueDate: d(10), priority: 'low' });

  await ProjectMember.update({ role: 'lead' }, { where: { userId: [mgr.id, mgr2.id, admin.id] } });

  // Conversation + time logs
  await Comment.create({ taskId: k2.id, userId: lead.id, body: 'Scripts are locked. Shooting the unboxing reel today with the new box.', internal: false });
  await Comment.create({ taskId: k2.id, userId: mgr.id, body: 'Keep the family reel under 25s, the last one dropped off at 18s.', internal: true });
  await Comment.create({ taskId: k3.id, userId: e3.id, body: 'Waiting on final ad copy before I can publish the prospecting set.', internal: true });
  const allTasks = await Task.findAll();
  for (const t of allTasks.slice(0, 14)) {
    await TimeLog.create({ taskId: t.id, userId: e1.id, startedAt: d(-(t.id % 6), 11), endedAt: d(-(t.id % 6), 13), minutes: 30 + (t.id * 17) % 150, note: 'Work session' });
  }
  // Spread "created" dates so the trend chart has shape
  const qi = sequelize.getQueryInterface().queryGenerator;
  for (const t of allTasks) {
    await sequelize.query(`UPDATE ${qi.quoteTable('Tasks')} SET ${qi.quoteIdentifier('createdAt')} = :c WHERE id = :id`, { replacements: { c: d(-(t.id % 13), 10), id: t.id } });
  }

  await ClientRequest.create({ clientId: c1.id, projectId: p1.id, title: 'Add a Chhath special post', description: 'Can we add one post for Chhath Puja with the gift box?', priority: 'high' });
  await Activity.create({ actorId: mgr.id, action: 'project.created', summary: 'created project Kasaar Diwali Campaign', projectId: p1.id, clientVisible: true });

  console.log('\nDemo workspace ready. Every account uses the password  Orbit@123\n');
  console.log('  Admin      admin@corcus.in');
  console.log('  Manager    manager@corcus.in');
  console.log('  Team lead  lead@corcus.in');
  console.log('  Executive  rahul@corcus.in');
  console.log('  Client     client@kasaar.in   (client portal)\n');
}

async function basic() {
  await sequelize.sync();
  await ensureRoles();
  console.log('Roles are ready. Open the app to create the first admin.');
}

(process.argv.includes('--demo') ? demo() : basic())
  .then(() => process.exit(0))
  .catch((e) => { console.error(e); process.exit(1); });
