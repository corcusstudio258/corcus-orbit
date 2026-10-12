/**
 * npm run seed        -> creates the default roles only (first admin is created on the setup screen)
 * npm run seed:demo   -> wipes the database and loads a demo workspace with people, clients, projects, chat, meetings and more
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const bcrypt = require('bcryptjs');
const models = require('./models');
const { ensureRoles } = require('./routes/auth');
const settings = require('./services/settings');
const { ensureDefaults } = require('./config/defaults');
const points = require('./services/points');

const {
  sequelize, Role, User, Client, Project, Milestone, Task, Comment, TimeLog, Activity, ClientRequest, ProjectMember,
  Section, Sprint, TaskDependency, Channel, ChannelMember, Message, Meeting, MeetingAttendee, Document, Attendance, Setting,
} = models;

const DAY = 864e5;
const d = (days, hour = 18) => { const x = new Date(Date.now() + days * DAY); x.setHours(hour, 0, 0, 0); return x; };
const dateOnly = (days) => new Date(Date.now() + days * DAY).toISOString().slice(0, 10);

async function demo() {
  await sequelize.sync({ force: true });
  await Setting.create({ key: 'schemaVersion', value: require('./config/migrate').SCHEMA_VERSION });
  await ensureRoles();
  await settings.set('company', { name: 'Corcus Studio', tagline: 'Creative & growth studio, Patna' });
  const roles = Object.fromEntries((await Role.findAll()).map((r) => [r.slug, r]));
  const pw = await bcrypt.hash('Orbit@123', 10);
  const mk = (o) => User.create({ passwordHash: pw, ...o });

  const admin = await mk({ name: 'Aman Verma', email: 'admin@corcus.in', roleId: roles.admin.id, designation: 'Founder', department: 'Leadership', color: '#3D5AFE', phone: '9000000001' });
  const mgr = await mk({ name: 'Riya Sinha', email: 'manager@corcus.in', roleId: roles.manager.id, designation: 'Account Manager', department: 'Client Services', color: '#8B5CF6', reportsToId: admin.id, phone: '9000000002' });
  const mgr2 = await mk({ name: 'Kunal Raj', email: 'kunal@corcus.in', roleId: roles.manager.id, designation: 'Tech Manager', department: 'Development', color: '#0EA5B7', reportsToId: admin.id });
  const lead = await mk({ name: 'Sneha Kumari', email: 'lead@corcus.in', roleId: roles['team-lead'].id, designation: 'Creative Lead', department: 'Creative', color: '#F08C00', reportsToId: mgr.id });
  const e1 = await mk({ name: 'Rahul Kumar', email: 'rahul@corcus.in', roleId: roles.executive.id, designation: 'Graphic Designer', department: 'Creative', color: '#E5484D', reportsToId: lead.id });
  const e2 = await mk({ name: 'Priya Singh', email: 'priya@corcus.in', roleId: roles.executive.id, designation: 'Content Writer', department: 'Creative', color: '#D946EF', reportsToId: lead.id });
  const e3 = await mk({ name: 'Ankit Mishra', email: 'ankit@corcus.in', roleId: roles.executive.id, designation: 'Performance Marketer', department: 'Ads', color: '#1FA971', reportsToId: mgr.id });
  const e4 = await mk({ name: 'Vikash Yadav', email: 'vikash@corcus.in', roleId: roles.executive.id, designation: 'Full-stack Developer', department: 'Development', color: '#64748B', reportsToId: mgr2.id });
  const staff = [admin, mgr, mgr2, lead, e1, e2, e3, e4];

  const c1 = await Client.create({ name: 'Kasaar', company: 'Kasaar Foods', industry: 'FMCG', city: 'Patna', email: 'hello@kasaar.in', whatsapp: '9000000101', color: '#F08C00' });
  const c2 = await Client.create({ name: 'Advance Skin & Hair Clinic', company: 'Advance Clinic', industry: 'Healthcare', city: 'Patna', color: '#E5484D' });
  const c3 = await Client.create({ name: 'SunRuf', company: 'SunRuf Solar', industry: 'Solar energy', city: 'Patna', color: '#1FA971' });
  await User.create({ name: 'Kasaar Team', email: 'client@kasaar.in', passwordHash: pw, roleId: roles.client.id, clientId: c1.id, color: c1.color, designation: 'Kasaar Foods' });
  await ensureDefaults();

  const fakeReq = (u) => ({ user: u, can: () => true });
  const { createTask } = require('./routes/tasks');
  const T = async (u, data, extra = {}) => {
    const t = await createTask(fakeReq(u), data, { silent: true });
    if (Object.keys(extra).length) await t.update(extra);
    return t;
  };

  // ---------- Project 1: Kasaar Diwali campaign ----------
  const p1 = await Project.create({ name: 'Kasaar Diwali Campaign', code: 'KAS', clientId: c1.id, ownerId: mgr.id, status: 'active', priority: 'high', icon: '🪔',
    startDate: dateOnly(-12), dueDate: dateOnly(14), color: '#F08C00', description: 'Festive social + Meta ads push for thekua gift boxes.', budget: 180000, spent: 112000 });
  await p1.setMembers([mgr.id, lead.id, e1.id, e2.id, e3.id]);
  const secs = {};
  for (const [i, [name, color]] of [['Planning', '#3D5AFE'], ['Creative', '#E5484D'], ['Ads', '#1FA971'], ['Reporting', '#8B5CF6']].entries()) {
    secs[name] = await Section.create({ projectId: p1.id, name, color, order: i });
  }
  const m1 = await Milestone.create({ projectId: p1.id, title: 'Creative kit approved', dueDate: dateOnly(-2), done: true, order: 0 });
  const m2 = await Milestone.create({ projectId: p1.id, title: 'Ads live', dueDate: dateOnly(4), order: 1 });
  const m3 = await Milestone.create({ projectId: p1.id, title: 'Campaign wrap report', dueDate: dateOnly(14), order: 2 });

  const k1 = await T(mgr, { title: 'Diwali content calendar (October)', projectId: p1.id, sectionId: secs.Planning.id, assigneeIds: [lead.id], priority: 'high', startDate: dateOnly(-10), dueDate: d(-3), clientVisible: true, milestoneId: m1.id, estimateHours: 6, tags: ['calendar'] }, { status: 'done', completedAt: d(-3) });
  await T(lead, { title: 'Write 20 post captions in Hinglish', parentId: k1.id, assigneeIds: [e2.id], dueDate: d(-5), estimateHours: 5 }, { status: 'done', completedAt: d(-5) });
  await T(lead, { title: 'Design 12 static posts', parentId: k1.id, assigneeIds: [e1.id], dueDate: d(-4), estimateHours: 12 }, { status: 'done', completedAt: d(-4) });

  const k2 = await T(mgr, { title: 'Festive gift-box reels', projectId: p1.id, sectionId: secs.Creative.id, assigneeIds: [lead.id, e1.id], priority: 'high', startDate: dateOnly(-4), dueDate: d(2), clientVisible: true, requiresApproval: true, milestoneId: m2.id, estimateHours: 16, tags: ['reel', 'festive'],
    description: 'Three 20–30s reels showing the gift box unboxing, the thekua making process and a family moment.' }, { status: 'in_progress', startedAt: d(-4) });
  await T(lead, { title: 'Reel scripts (3)', parentId: k2.id, assigneeIds: [e2.id], dueDate: d(-1), clientVisible: true, estimateHours: 3 }, { status: 'done', completedAt: d(-1) });
  const k2b = await T(lead, { title: 'Shoot & edit', parentId: k2.id, assigneeIds: [e1.id], dueDate: d(1), clientVisible: true, estimateHours: 10 }, { status: 'in_progress' });
  await T(e1, { title: 'Unboxing reel edit', parentId: k2b.id, assigneeIds: [e1.id], dueDate: d(0, 20), estimateHours: 3 }, { status: 'review', approvalStatus: 'pending' });
  await T(e1, { title: 'Process reel edit', parentId: k2b.id, assigneeIds: [e1.id], dueDate: d(1), estimateHours: 3 }, { status: 'in_progress' });
  await T(e1, { title: 'Family moment reel edit', parentId: k2b.id, assigneeIds: [e1.id], dueDate: d(1), estimateHours: 3 });
  await T(lead, { title: 'Music licensing check', parentId: k2.id, assigneeIds: [lead.id], dueDate: d(1), estimateHours: 1 });

  const copy = await T(e3, { title: 'Ad copy variants (6)', projectId: p1.id, sectionId: secs.Ads.id, assigneeIds: [e2.id], priority: 'high', dueDate: d(-1), estimateHours: 3, tags: ['ads'] }, { status: 'blocked' });
  const k3 = await T(mgr, { title: 'Meta ads: Diwali sales campaign', projectId: p1.id, sectionId: secs.Ads.id, assigneeIds: [e3.id], priority: 'urgent', startDate: dateOnly(-1), dueDate: d(4), clientVisible: true, milestoneId: m2.id, estimateHours: 8, tags: ['ads', 'meta'],
    checklist: ['Pixel + CAPI events verified', 'Audience: Patna + Bihar 25-55', 'Budget split 70/30 prospecting/retargeting', 'UTM on every ad'] });
  await T(e3, { title: 'Build audiences & lookalikes', parentId: k3.id, assigneeIds: [e3.id], dueDate: d(1), estimateHours: 3 }, { status: 'in_progress' });
  await TaskDependency.create({ taskId: k3.id, blockerId: copy.id });
  await T(mgr, { title: 'Weekly ads report to Kasaar', projectId: p1.id, sectionId: secs.Reporting.id, assigneeIds: [e3.id], dueDate: d(3, 17), estimateHours: 2, recurrence: { freq: 'weekly', interval: 1, days: [1] }, tags: ['report'] });
  await T(mgr, { title: 'Wrap-up performance report', projectId: p1.id, sectionId: secs.Reporting.id, assigneeIds: [e3.id], dueDate: d(14), clientVisible: true, milestoneId: m3.id, estimateHours: 4 });
  await T(mgr, { title: 'Chhath Puja special post', projectId: p1.id, sectionId: secs.Planning.id, assigneeIds: [], priority: 'medium' }, { status: 'backlog' });

  // ---------- Project 2: Clinic monthly social ----------
  const p2 = await Project.create({ name: 'Advance Clinic: November social', code: 'ADV', clientId: c2.id, ownerId: mgr.id, status: 'active', icon: '✨',
    startDate: dateOnly(-3), dueDate: dateOnly(25), color: '#E5484D', description: 'Monthly Instagram calendar, reels and story set for the dermatology clinic.', budget: 45000, spent: 9000 });
  await p2.setMembers([mgr.id, lead.id, e1.id, e2.id]);
  const a1 = await T(mgr, { title: 'November content calendar', projectId: p2.id, assigneeIds: [lead.id], dueDate: d(3), clientVisible: true, requiresApproval: true, estimateHours: 6 }, { status: 'review', approvalStatus: 'pending' });
  await T(lead, { title: 'Topic research: winter skincare myths', parentId: a1.id, assigneeIds: [e2.id], dueDate: d(-1) }, { status: 'done', completedAt: d(-1) });
  await T(lead, { title: 'Calendar sheet with captions', parentId: a1.id, assigneeIds: [e2.id], dueDate: d(2) }, { status: 'done', completedAt: d(0, 11) });
  await T(mgr, { title: 'Doctor talking-head reel shoot', projectId: p2.id, assigneeIds: [e1.id], dueDate: d(-2), priority: 'high', estimateHours: 5 });
  await T(mgr, { title: 'Before/after carousel templates', projectId: p2.id, assigneeIds: [e1.id], dueDate: d(6), estimateHours: 4 });

  // ---------- Project 3: SunRuf website (sprints) ----------
  const p3 = await Project.create({ name: 'SunRuf website rebuild', code: 'SUN', clientId: c3.id, ownerId: mgr2.id, status: 'active', priority: 'medium', icon: '☀️',
    startDate: dateOnly(-30), dueDate: dateOnly(5), color: '#1FA971', description: 'PHP + MySQL rebuild with admin panel and lead forms.', budget: 120000, spent: 98000 });
  await p3.setMembers([mgr2.id, e4.id]);
  await Milestone.create({ projectId: p3.id, title: 'Design sign-off', dueDate: dateOnly(-20), done: true, order: 0 });
  await Milestone.create({ projectId: p3.id, title: 'Go live', dueDate: dateOnly(5), order: 1 });
  const sp1 = await Sprint.create({ projectId: p3.id, name: 'Sprint 1: Foundations', goal: 'Database, auth and page templates', startDate: dateOnly(-28), endDate: dateOnly(-15), status: 'completed', completedAt: d(-15), snapshot: { tasks: 4, done: 4, points: 13, pointsDone: 13, carriedOver: 0 } });
  const sp2 = await Sprint.create({ projectId: p3.id, name: 'Sprint 2: Admin & launch', goal: 'Admin panel, calculator and go-live', startDate: dateOnly(-6), endDate: dateOnly(7), status: 'active' });
  for (const [t, pts] of [['Database schema & migrations', 3], ['Login & roles', 3], ['Home & service pages', 5], ['Contact & WhatsApp forms', 2]]) {
    await T(e4, { title: t, projectId: p3.id, assigneeIds: [e4.id], sprintId: sp1.id, storyPoints: pts, dueDate: d(-16) }, { status: 'done', completedAt: d(-17 + pts) });
  }
  const s1 = await T(mgr2, { title: 'Admin panel', projectId: p3.id, assigneeIds: [e4.id], dueDate: d(1), clientVisible: true, sprintId: sp2.id, storyPoints: 8, startDate: dateOnly(-5), estimateHours: 20 }, { status: 'in_progress' });
  await T(e4, { title: 'Leads table with CSV export', parentId: s1.id, assigneeIds: [e4.id], dueDate: d(-2) }, { status: 'done', completedAt: d(-2) });
  await T(e4, { title: 'Project gallery manager', parentId: s1.id, assigneeIds: [e4.id], dueDate: d(1) }, { status: 'in_progress' });
  await T(mgr2, { title: 'Subsidy calculator page', projectId: p3.id, assigneeIds: [e4.id], dueDate: d(-1), clientVisible: true, sprintId: sp2.id, storyPoints: 5, startDate: dateOnly(-4), estimateHours: 8 }, { status: 'review' });
  const deploy = await T(mgr2, { title: 'Deploy to Hostinger + SSL', projectId: p3.id, assigneeIds: [e4.id], dueDate: d(4), clientVisible: true, sprintId: sp2.id, storyPoints: 3, startDate: dateOnly(3), estimateHours: 3 });
  await TaskDependency.create({ taskId: deploy.id, blockerId: s1.id });
  await T(mgr2, { title: 'SEO meta & sitemap', projectId: p3.id, assigneeIds: [e4.id], sprintId: null, storyPoints: 2 }, { status: 'backlog' });

  // ---------- Internal ----------
  const p4 = await Project.create({ name: 'Corcus internal', code: 'COR', ownerId: admin.id, status: 'active', color: '#3D5AFE', icon: '🛰️', clientVisible: false });
  await p4.setMembers([admin.id, mgr.id, mgr2.id, lead.id]);
  await T(admin, { title: 'Q4 hiring plan', projectId: p4.id, assigneeIds: [mgr.id, mgr2.id], dueDate: d(7) });
  await T(admin, { title: 'Agency portfolio page refresh', projectId: p4.id, assigneeIds: [lead.id], dueDate: d(10), priority: 'low' });
  await T(admin, { title: 'Monthly invoices to all clients', projectId: p4.id, assigneeIds: [admin.id], dueDate: d(18), priority: 'high', recurrence: { freq: 'monthly', interval: 1 } });

  await ProjectMember.update({ role: 'lead' }, { where: { userId: [mgr.id, mgr2.id, admin.id] } });

  // Conversation + time logs
  await Comment.create({ taskId: k2.id, userId: lead.id, body: 'Scripts are locked. Shooting the unboxing reel today with the new box.', internal: false });
  await Comment.create({ taskId: k2.id, userId: mgr.id, body: 'Keep the family reel under 25s, the last one dropped off at 18s.', internal: true });
  await Comment.create({ taskId: k3.id, userId: e3.id, body: 'Waiting on final ad copy before I can publish the prospecting set.', internal: true });
  const allTasks = await Task.findAll();
  for (const t of allTasks.slice(0, 18)) {
    const who = staff[(t.id % 5) + 3];
    await TimeLog.create({ taskId: t.id, userId: who.id, startedAt: d(-(t.id % 6), 11), endedAt: d(-(t.id % 6), 13), minutes: 30 + (t.id * 17) % 150, note: 'Work session' });
  }
  const qi = sequelize.getQueryInterface().queryGenerator;
  for (const t of allTasks) {
    await sequelize.query(`UPDATE ${qi.quoteTable('Tasks')} SET ${qi.quoteIdentifier('createdAt')} = :c WHERE id = :id AND ${qi.quoteIdentifier('createdAt')} > :c`, { replacements: { c: d(-(t.id % 13), 10), id: t.id } });
  }

  await ClientRequest.create({ clientId: c1.id, projectId: p1.id, title: 'Add a Chhath special post', description: 'Can we add one post for Chhath Puja with the gift box?', priority: 'high' });
  await Activity.create({ actorId: mgr.id, action: 'project.created', summary: 'created project Kasaar Diwali Campaign', projectId: p1.id, clientVisible: true });

  // ---------- Chat ----------
  const general = await Channel.findOne({ where: { name: 'general' } });
  const creative = await Channel.create({ name: 'creative', description: 'Designs, reels and copy reviews', kind: 'channel', createdById: lead.id });
  const ads = await Channel.create({ name: 'ads-war-room', description: 'Meta ads live numbers', kind: 'channel', isPrivate: true, createdById: mgr.id });
  await ads.setMembers([mgr.id, e3.id, admin.id]);
  const msgs = [
    [general, admin, 'Good morning team ☀️ Diwali week is our busiest. Please keep task statuses updated so clients see live progress in the portal.', -1],
    [general, mgr, 'Kasaar reels are due Thursday. @Sneha can we review the unboxing cut after lunch?', -1],
    [general, lead, 'Yes, 2:30 works. Rahul is finishing the colour grade.', -1],
    [creative, e1, 'Uploaded the unboxing reel v2 to KAS task. Feedback welcome!', 0],
    [creative, e2, 'Captions for clinic carousel are in the doc. Hinglish version too.', 0],
    [ads, e3, 'Prospecting CPM ₹92, CTR 1.8%. Waiting on copy to launch set B.', 0],
  ];
  for (const [ch, u, body, day] of msgs) {
    const m = await Message.create({ channelId: ch.id, userId: u.id, body });
    await sequelize.query(`UPDATE ${qi.quoteTable('Messages')} SET ${qi.quoteIdentifier('createdAt')} = :c WHERE id = :id`, { replacements: { c: d(day, 10 + (m.id % 8)), id: m.id } });
    ch.lastMessageAt = d(day, 10 + (m.id % 8)); await ch.save();
  }
  const dm = await Channel.create({ kind: 'dm', dmKey: [mgr.id, e1.id].sort((a, b) => a - b).join(':'), isPrivate: true, createdById: mgr.id, lastMessageAt: new Date() });
  await dm.setMembers([mgr.id, e1.id]);
  await Message.create({ channelId: dm.id, userId: mgr.id, body: 'Rahul, can you send me the reel export by 6?' });
  for (const u of staff) await ChannelMember.findOrCreate({ where: { channelId: general.id, userId: u.id } });

  // ---------- Meetings ----------
  const meet = async (o, attendees) => { const m = await Meeting.create(o); await m.setAttendees(attendees.map((u) => u.id)); await MeetingAttendee.update({ response: 'yes' }, { where: { meetingId: m.id } }); return m; };
  await meet({ title: 'Daily stand-up', agenda: 'Yesterday, today, blockers', startAt: d(0, 10), endAt: new Date(d(0, 10).getTime() + 15 * 60000), link: 'https://meet.google.com/abc-defg-hij', organizerId: mgr.id }, [mgr, lead, e1, e2, e3]);
  await meet({ title: 'Kasaar: reel review with client', agenda: 'Walk through the three reels and lock music', startAt: d(1, 15), endAt: d(1, 16), link: 'https://meet.google.com/kas-reel-rev', projectId: p1.id, clientId: c1.id, inviteClient: true, organizerId: mgr.id }, [mgr, lead, e1]);
  await meet({ title: 'SunRuf go-live checklist', startAt: d(3, 12), endAt: new Date(d(3, 12).getTime() + 30 * 60000), location: 'Corcus office, Boring Road', projectId: p3.id, organizerId: mgr2.id }, [mgr2, e4, admin]);
  await meet({ title: 'Monthly review', agenda: 'Client health, hiring, cash flow', startAt: d(-3, 17), endAt: d(-3, 18), organizerId: admin.id,
    notes: 'Kasaar happy with calendar. SunRuf go-live slipping by a few days, Kunal to confirm. Need one more designer by November. Riya to share hiring JD.' }, [admin, mgr, mgr2]);

  // ---------- Documents ----------
  await Document.create({ title: 'Kasaar brand voice', icon: '🪔', projectId: p1.id, visibility: 'workspace', clientVisible: true, createdById: lead.id, updatedById: lead.id,
    content: '# Kasaar brand voice\n\nWarm, nostalgic and proudly Bihari.\n\n## Do\n- Talk about *maa ke haath ka swaad*\n- Use Hinglish in captions\n- Show real hands and real kitchens\n\n## Don\'t\n- Over-polished studio looks\n- Discounts in every post\n\n## Hashtags\n`#Kasaar #Thekua #ChhathSpecial #BiharKaSwaad`' });
  await Document.create({ title: 'Reel delivery checklist', icon: '🎬', visibility: 'workspace', pinned: true, createdById: lead.id, updatedById: lead.id,
    content: '# Reel delivery checklist\n\n1. Hook in the first 1.5 seconds\n2. Captions burned in, safe zones respected\n3. Trending or licensed audio only\n4. Export 1080×1920, 30 fps, under 60 MB\n5. Cover frame designed\n6. Upload to the task and mark *In review*' });
  await Document.create({ title: 'My notes', icon: '📝', visibility: 'private', createdById: admin.id, updatedById: admin.id, content: '- Ask Kunal about SunRuf AMC pricing\n- Plan Q1 offsite' });

  // ---------- Attendance (last 12 working days) ----------
  for (let i = 12; i >= 1; i -= 1) {
    const day = new Date(Date.now() - i * DAY);
    if (day.getDay() === 0) continue;
    const date = day.toISOString().slice(0, 10);
    for (const [j, u] of staff.entries()) {
      if ((i + j) % 11 === 0) { await Attendance.create({ userId: u.id, date, status: 'leave', note: 'Planned leave' }); continue; }
      const late = (i * 3 + j) % 7 === 0;
      const inAt = new Date(`${date}T${late ? '10:42' : `09:${String(40 + ((i + j) % 18)).padStart(2, '0')}`}:00+05:30`);
      const outAt = new Date(inAt.getTime() + (8 + ((i + j) % 3) * 0.5) * 3600e3);
      const rec = await Attendance.create({ userId: u.id, date, inAt, outAt, sessionAt: inAt, minutes: Math.round((outAt - inAt) / 60000), status: late ? 'late' : (j === 7 && i % 4 === 0 ? 'remote' : 'present'), mode: j === 7 && i % 4 === 0 ? 'remote' : 'office' });
      await points.award(u.id, late ? 1 : 2, 'attendance', late ? 'Punched in' : 'Punched in on time', rec.id);
    }
  }

  // ---------- Rewards for finished work ----------
  for (const t of await Task.findAll({ where: { status: 'done' } })) await points.onTaskDone(t);
  await points.award(e1.id, 20, 'kudos', 'Kudos from Riya Sinha: brilliant unboxing reel edit', null);
  await points.award(e3.id, 15, 'kudos', 'Kudos from Aman Verma: great CPL on the clinic campaign', null);

  await require('./config/migrate').DATA_STEPS[3](); // every project gets a pipeline
  console.log('\nDemo workspace ready. Every account uses the password  Orbit@123\n');
  console.log('  Admin      admin@corcus.in');
  console.log('  Manager    manager@corcus.in');
  console.log('  Team lead  lead@corcus.in');
  console.log('  Executive  rahul@corcus.in');
  console.log('  Client     client@kasaar.in   (client portal)\n');
}

async function basic() {
  await require('./config/migrate').migrate();
  await ensureRoles();
  console.log('Roles are ready. Open the app to create the first admin.');
}

(process.argv.includes('--demo') ? demo() : basic())
  .then(() => process.exit(0))
  .catch((e) => { console.error(e); process.exit(1); });
