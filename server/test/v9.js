// v9 checks: project members only see their own tasks, team load / activity need a permission,
// and the client <-> team comment thread on the task description.
const BASE = process.env.API || 'http://localhost:5000/api';
let pass = 0; let fail = 0;
const ok = (c, m, x) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗', m, x !== undefined ? JSON.stringify(x).slice(0, 400) : ''); } };
async function call(token, method, p, body) {
  const isForm = body instanceof FormData;
  const r = await fetch(BASE + p, { method, headers: { ...(isForm ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? (isForm ? body : JSON.stringify(body)) : undefined });
  const t = await r.text(); let data; try { data = JSON.parse(t); } catch { data = t; }
  return { status: r.status, data };
}
const login = async (email, password = 'Orbit@123') => (await call(null, 'POST', '/auth/login', { email, password })).data.token;
const fd = (o) => { const f = new FormData(); Object.entries(o).forEach(([k, v]) => f.append(k, v)); return f; };

(async () => {
  const admin = await login('admin@corcus.in');
  const client = await login('client@kasaar.in');
  const roles = (await call(admin, 'GET', '/roles')).data;
  const exec = roles.find((r) => r.slug === 'executive'); const lead = roles.find((r) => r.slug === 'team-lead');
  ok(lead.permissions.includes('activity.view') && !exec.permissions.includes('activity.view'), 'leads can see team load and activity, executives cannot');
  const A = (await call(admin, 'POST', '/users', { name: 'Member A', email: 'member.a@corcus.in', password: 'Memb#2026x', roleId: exec.id })).data;
  const B = (await call(admin, 'POST', '/users', { name: 'Member B', email: 'member.b@corcus.in', password: 'Memb#2026x', roleId: exec.id })).data;
  const at = await login('member.a@corcus.in', 'Memb#2026x'); const bt = await login('member.b@corcus.in', 'Memb#2026x');
  const P = (await call(admin, 'POST', '/projects', { name: 'Scoped', code: 'SCP' })).data;
  await call(admin, 'PATCH', `/projects/${P.id}`, { memberIds: [A.id, B.id] });
  const ta = (await call(admin, 'POST', '/tasks', { title: 'For A', projectId: P.id, assigneeIds: [A.id] })).data;
  const tb = (await call(admin, 'POST', '/tasks', { title: 'For B', projectId: P.id, assigneeIds: [B.id], dueDate: new Date(Date.now() + 864e5).toISOString() })).data;
  const tn = (await call(admin, 'POST', '/tasks', { title: 'Nobody yet', projectId: P.id })).data;

  console.log('Project members see only their tasks');
  ok((await call(at, 'GET', '/projects')).data.some((p) => p.id === P.id), 'member still sees the project');
  const listA = (await call(at, 'GET', `/tasks?projectId=${P.id}`)).data;
  ok(listA.length === 1 && listA[0].id === ta.id, 'member sees only the task given to them', listA.map((t) => t.title));
  ok((await call(at, 'GET', `/tasks/${tb.id}`)).status === 404 && (await call(at, 'GET', `/tasks/${tn.id}`)).status === 404, 'other tasks in the project stay closed');
  const tl = (await call(at, 'GET', `/projects/${P.id}/timeline`)).data;
  ok(!tl.tasks.some((t) => t.id === tb.id), 'timeline hides them too');
  const mine = (await call(at, 'POST', '/tasks', { title: 'A made this', projectId: P.id })).data;
  ok((await call(at, 'GET', `/tasks/${mine.id}`)).status === 200, 'member sees tasks they create');
  await call(admin, 'PATCH', `/projects/${P.id}`, { ownerId: B.id });
  ok((await call(bt, 'GET', `/tasks?projectId=${P.id}`)).data.length === 4, 'the project lead sees every task in it');

  console.log('Team load and activity');
  const pa = (await call(at, 'GET', `/projects/${P.id}`)).data;
  ok(pa.canSeeInsights === false && pa.workload.length === 0 && pa.activity.length === 0, 'executive gets no team load or project activity');
  const padm = (await call(admin, 'GET', `/projects/${P.id}`)).data;
  ok(padm.canSeeInsights === true && padm.workload.length > 0 && padm.activity.length > 0, 'admin sees both');
  const feed = (await call(at, 'GET', '/activity')).data;
  ok(feed.length > 0 && feed.every((a) => a.actorId === A.id), 'activity log shows only their own actions', feed.map((a) => a.actorId));
  ok((await call(at, 'GET', '/dashboard')).data.activity.every((a) => a.actorId === A.id), 'dashboard activity too');
  await call(admin, 'PATCH', `/roles/${exec.id}`, { permissions: [...exec.permissions, 'activity.view'] });
  ok((await call(at, 'GET', `/projects/${P.id}`)).data.canSeeInsights === true, 'giving the role the permission turns them on');
  await call(admin, 'PATCH', `/roles/${exec.id}`, { permissions: exec.permissions });

  console.log('Comments on the description');
  const KAS = (await call(admin, 'GET', '/projects')).data.find((p) => p.code === 'KAS');
  const mgr = await login('manager@corcus.in');
  const t = (await call(mgr, 'POST', '/tasks', { title: 'Post copy', projectId: KAS.id, clientVisible: true, assigneeIds: [A.id], description: 'Copy: Thekua for Chhath' })).data;
  await call(admin, 'PATCH', `/projects/${KAS.id}`, { memberIds: [...(await call(admin, 'GET', `/projects/${KAS.id}`)).data.members.map((m) => m.id), A.id] });
  const c1 = await call(client, 'POST', `/portal/tasks/${t.id}/comments`, fd({ body: 'Can we add "homemade" before thekua?', kind: 'brief' }));
  ok(c1.status === 201 && c1.data.kind === 'brief', 'client comments on the description');
  const an = (await call(at, 'GET', '/notifications')).data;
  ok(JSON.stringify(an).includes('Client comment on the description'), 'the assigned member is notified');
  const d = (await call(at, 'GET', `/tasks/${t.id}`)).data;
  ok(d.Comments.some((c) => c.kind === 'brief' && c.body.includes('homemade')), 'assigned member sees the comment on the task');
  const r = await call(at, 'POST', `/tasks/${t.id}/comments`, fd({ body: 'Done, updated the copy.', kind: 'brief', internal: 'false' }));
  ok(r.status === 201 && r.data.kind === 'brief' && r.data.internal === false, 'team replies in the same thread');
  const pc = (await call(client, 'GET', `/portal/tasks/${t.id}`)).data.comments.filter((c) => c.kind === 'brief');
  ok(pc.length === 2, 'client sees the whole thread', pc.length);
  await call(mgr, 'PATCH', `/tasks/${t.id}`, { descClientVisible: false });
  ok((await call(client, 'POST', `/portal/tasks/${t.id}/comments`, fd({ body: 'x', kind: 'brief' }))).status === 400, 'no description comments when it is hidden');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
