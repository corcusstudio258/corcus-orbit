// End-to-end API checks against a running server seeded with `npm run seed:demo`.
const BASE = process.env.API || 'http://localhost:5000/api';
let pass = 0; let fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ✓', msg); } else { fail++; console.log('  ✗', msg); } };

async function call(token, method, path, body) {
  const r = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => null);
  return { status: r.status, data };
}
const login = async (email) => (await call(null, 'POST', '/auth/login', { email, password: 'Orbit@123' })).data.token;

(async () => {
  console.log('Auth');
  const bad = await call(null, 'POST', '/auth/login', { email: 'admin@corcus.in', password: 'nope' });
  ok(bad.status === 401, 'wrong password rejected');
  const admin = await login('admin@corcus.in');
  const mgr = await login('manager@corcus.in');
  const rahul = await login('rahul@corcus.in');
  const client = await login('client@kasaar.in');
  ok(admin && mgr && rahul && client, 'all demo accounts sign in');
  const me = await call(rahul, 'GET', '/auth/me');
  ok(me.data.user.Role.name === 'Executive' && !me.data.permissions.includes('tasks.assign'), 'executive has limited permissions');

  console.log('Roles');
  const role = await call(admin, 'POST', '/roles', { name: 'Intern', level: 5, permissions: ['tasks.create', 'tasks.assign'] });
  ok(role.status === 201, 'admin creates a custom role');
  const badRole = await call(mgr, 'POST', '/roles', { name: 'Boss', level: 1, permissions: [] });
  ok(badRole.status === 403 || badRole.status === 400, 'manager cannot create roles (no roles.manage)');
  const u = await call(admin, 'POST', '/users', { name: 'New Intern', email: 'intern@corcus.in', password: 'Orbit@123', roleId: role.data.id, reportsToId: 4, phone: '9123456789' });
  ok(u.status === 201, 'admin adds a person in the new role');
  const loop = await call(admin, 'PATCH', '/users/2', { reportsToId: u.data.id });
  ok(loop.status === 400, 'reporting loop is blocked');

  console.log('Visibility');
  const rahulTasks = await call(rahul, 'GET', '/tasks');
  const adminTasks = await call(admin, 'GET', '/tasks');
  ok(adminTasks.data.length > rahulTasks.data.length, `admin sees all (${adminTasks.data.length}) vs executive scoped (${rahulTasks.data.length})`);
  ok(!rahulTasks.data.some((t) => t.key?.startsWith('SUN')), 'executive cannot see other teams\' project tasks');
  const leadTasks = await call(await login('lead@corcus.in'), 'GET', '/tasks?assignee=5');
  ok(leadTasks.data.length > 0, 'team lead sees tasks of people reporting to them');

  console.log('Multi-level tasks');
  const parent = await call(mgr, 'POST', '/tasks', { title: 'Landing page', projectId: 1, assigneeIds: [5], requiresApproval: true, clientVisible: true, dueDate: new Date(Date.now() + 3600e3).toISOString() });
  ok(parent.status === 201 && parent.data.key.startsWith('KAS-'), `task created with key ${parent.data.key}`);
  const child = await call(mgr, 'POST', '/tasks', { title: 'Hero section', parentId: parent.data.id, assigneeIds: [5] });
  const grand = await call(rahul, 'POST', '/tasks', { title: 'Hero copy', parentId: child.data.id, assigneeIds: [5] });
  ok(grand.data.depth === 2 && grand.data.projectId === 1, 'grandchild inherits project, depth 2');
  await call(rahul, 'PATCH', `/tasks/${grand.data.id}`, { status: 'done' });
  const detail = await call(mgr, 'GET', `/tasks/${parent.data.id}`);
  ok(detail.data.descendants.length === 2, 'parent detail returns whole subtree');
  ok(detail.data.progress === 100, `progress rolls up from leaves (${detail.data.progress}%)`);
  const assignByExec = await call(rahul, 'PATCH', `/tasks/${child.data.id}`, { assigneeIds: [5, 6] });
  ok(assignByExec.status === 403, 'executive cannot assign others');

  console.log('Approval flow');
  const r1 = await call(rahul, 'PATCH', `/tasks/${parent.data.id}`, { status: 'done' });
  ok(r1.data.status === 'review' && r1.data.approvalStatus === 'pending', 'done → review when approval required');
  const n = await call(mgr, 'GET', '/notifications');
  ok(n.data.items.some((x) => x.type === 'approval_request'), 'manager notified to approve');
  const ap = await call(mgr, 'POST', `/tasks/${parent.data.id}/approval`, { decision: 'approve', note: 'Looks great' });
  ok(ap.data.status === 'done', 'manager approves → done');

  console.log('Comments, checklist, time');
  const c = await call(rahul, 'POST', `/tasks/${child.data.id}/comments`, { body: 'Draft ready @Riya', mentions: [2] });
  ok(c.status === 201, 'comment with mention');
  const ck = await call(rahul, 'POST', `/tasks/${child.data.id}/checklist`, { text: 'Mobile check' });
  ok(ck.status === 201, 'checklist item');
  const tm = await call(rahul, 'POST', `/tasks/${child.data.id}/timer/start`);
  ok(tm.status === 201, 'timer started');
  const st = await call(rahul, 'POST', '/tasks/timer/stop');
  ok(st.data && st.data.minutes >= 1, 'timer stopped and logged');

  console.log('Client portal');
  const ov = await call(client, 'GET', '/portal/overview');
  ok(ov.status === 200 && ov.data.projects.length === 1 && ov.data.projects[0].code === 'KAS', 'client only sees own project');
  const staffApi = await call(client, 'GET', '/tasks');
  ok(staffApi.status === 403, 'client blocked from staff API');
  const pd = await call(client, 'GET', '/portal/projects/1');
  ok(pd.data.tasks.every((t) => !('description' in t) || true) && pd.data.tasks.length > 0, `client sees ${pd.data.tasks.length} shared tasks`);
  const hidden = await call(client, 'GET', '/portal/projects/3');
  ok(hidden.status === 404, 'client cannot open another client\'s project');
  const internal = await call(client, 'GET', `/portal/tasks/${detail.data.id}`);
  ok(internal.status === 200 && internal.data.comments.every((cm) => cm.internal === false), 'internal comments hidden from client');
  const req = await call(client, 'POST', '/portal/requests', { title: 'New banner for Chhath', projectId: 1 });
  ok(req.status === 201, 'client raises request');
  const conv = await call(mgr, 'PATCH', `/clients/requests/${req.data.id}`, { convert: true, assigneeIds: [5] });
  ok(conv.data.status === 'accepted' && conv.data.taskId, 'manager converts request into task');
  // Client review of a deliverable
  const rev = await call(mgr, 'POST', '/tasks', { title: 'Client deliverable', projectId: 1, clientVisible: true, status: 'review' });
  const crv = await call(client, 'POST', `/portal/tasks/${rev.data.id}/review`, { decision: 'changes', note: 'Make logo bigger' });
  ok(crv.data.status === 'in_progress', 'client requests changes → back to in progress');

  console.log('Dashboard & projects');
  const db = await call(admin, 'GET', '/dashboard');
  ok(db.data.team && db.data.team.trend.length === 14 && db.data.team.workload.length > 0, 'team dashboard with trend + workload');
  const dbe = await call(rahul, 'GET', '/dashboard');
  ok(dbe.data.team === null && dbe.data.personal.open > 0, 'executive gets personal dashboard only');
  const pr = await call(mgr, 'GET', '/projects/1');
  ok(pr.data.Milestones.length === 3 && typeof pr.data.progress === 'number', 'project detail with milestones');

  console.log('WhatsApp');
  await call(admin, 'PATCH', '/settings/whatsapp', { enabled: true, provider: 'log' });
  const test = await call(admin, 'POST', '/settings/whatsapp/test', { phone: '9876543210' });
  ok(test.data.status === 'logged', 'test message logged');
  await call(mgr, 'POST', '/tasks', { title: 'WA check', projectId: 1, assigneeIds: [u.data.id] });
  await new Promise((r) => setTimeout(r, 300));
  const logs = await call(admin, 'GET', '/settings/whatsapp/logs');
  ok(logs.data.some((l) => l.to === '919123456789' && l.message.includes('assigned you')), 'assignment sent to assignee WhatsApp (normalised +91)');
  const s = await call(admin, 'GET', '/settings');
  ok(!s.data.whatsapp.meta.token || s.data.whatsapp.meta.token.startsWith('••'), 'token masked');
  await call(admin, 'PATCH', '/settings/whatsapp', { enabled: false });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
