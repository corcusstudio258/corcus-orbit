// v10 checks: workspace reviewers synced onto tasks, their alerts, and no activity feed in the client portal.
const crypto = require('crypto');
const BASE = process.env.API || 'http://localhost:5000/api';
const MOCK = 'http://localhost:5098'; const PUSH = 'https://localhost:5097';
let pass = 0; let fail = 0;
const ok = (c, m, x) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗', m, x !== undefined ? JSON.stringify(x).slice(0, 400) : ''); } };
async function call(token, method, p, body) {
  const r = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let data; try { data = JSON.parse(t); } catch { data = t; }
  return { status: r.status, data };
}
const login = async (email, password = 'Orbit@123') => (await call(null, 'POST', '/auth/login', { email, password })).data.token;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fakeSub = (path) => { const e = crypto.createECDH('prime256v1'); e.generateKeys(); return { endpoint: `${PUSH}/push/${path}`, keys: { p256dh: e.getPublicKey().toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') } }; };
const pushes = async (path) => (await (await fetch(`${MOCK}/_log`)).json()).filter((l) => l.path === `/push/${path}`).length;

(async () => {
  const admin = await login('admin@corcus.in');
  const mgr = await login('manager@corcus.in');
  const client = await login('client@kasaar.in');
  const roles = (await call(admin, 'GET', '/roles')).data;
  const exec = roles.find((r) => r.slug === 'executive');
  const R1 = (await call(admin, 'POST', '/users', { name: 'Rev One', email: 'rev.one@corcus.in', password: 'Revw#2026x', roleId: exec.id })).data;
  const R2 = (await call(admin, 'POST', '/users', { name: 'Rev Two', email: 'rev.two@corcus.in', password: 'Revw#2026x', roleId: exec.id })).data;
  const r1 = await login('rev.one@corcus.in', 'Revw#2026x');
  await call(r1, 'POST', '/push/subscribe', { subscription: fakeSub('rev-one') });
  const projects = (await call(admin, 'GET', '/projects')).data;
  const KAS = projects.find((p) => p.code === 'KAS'); const other = projects.find((p) => p.code !== 'KAS');
  const clientUser = (await call(admin, 'GET', '/users')).data.find?.((u) => u.email === 'client@kasaar.in');

  console.log('Workspace reviewers');
  ok((await call(mgr, 'GET', '/roles/reviewers')).status === 403, 'only people who manage roles can change reviewers');
  const before = await pushes('rev-one');
  const put = (await call(admin, 'PUT', '/roles/reviewers', { userIds: [R1.id, R2.id, clientUser?.id].filter(Boolean), projectIds: [] })).data;
  ok(put.userIds.length === 2 && !put.userIds.includes(clientUser?.id), 'two reviewers saved; client logins are left out', put.userIds);
  ok(put.added > 0 && put.tasks > 0, `added to every open task (${put.added} rows over ${put.tasks} tasks)`);
  const open = (await call(admin, 'GET', `/tasks?projectId=${KAS.id}&hideDone=1`)).data;
  ok(open.length > 0 && open.every((t) => t.reviewers.some((r) => r.id === R1.id) && t.reviewers.some((r) => r.id === R2.id)), 'reviewer names show on each open task');
  const done = (await call(admin, 'GET', `/tasks?projectId=${KAS.id}&status=done`)).data;
  ok(done.every((t) => !t.reviewers.some((r) => r.id === R1.id)), 'finished tasks are left alone');
  const n1 = (await call(r1, 'GET', '/notifications')).data;
  ok(JSON.stringify(n1).includes('made you a reviewer'), 'reviewer is told once, not per task');
  await sleep(400);
  ok((await pushes('rev-one')) > before, 'and gets a browser notification');
  const fresh = (await call(mgr, 'POST', '/tasks', { title: 'Brand new task', projectId: KAS.id })).data;
  const fd = (await call(mgr, 'GET', `/tasks/${fresh.id}`)).data;
  ok(fd.reviewers.map((r) => r.id).sort().join() === [R1.id, R2.id].sort().join() && fd.requiresApproval, 'new tasks get the reviewers automatically');
  ok((await call(r1, 'GET', `/tasks/${fresh.id}`)).data.canApprove === true, 'reviewer can open and approve it');
  const p0 = await pushes('rev-one');
  await call(mgr, 'PATCH', `/tasks/${fresh.id}`, { status: 'done' });
  await sleep(400);
  const n2 = (await call(r1, 'GET', '/notifications')).data;
  ok(JSON.stringify(n2).includes(`Approval needed: ${fresh.key}`) && (await pushes('rev-one')) > p0, 'when it is ready, the reviewer gets an alert (in-app, WhatsApp channel, browser)');
  const manual = (await call(mgr, 'POST', '/tasks', { title: 'Hand-picked reviewer', projectId: other.id, reviewerIds: [(await call(mgr, 'GET', '/auth/me')).data.user?.id || 2] })).data;

  console.log('Changing the list');
  const scoped = (await call(admin, 'PUT', '/roles/reviewers', { userIds: [R1.id], projectIds: [KAS.id] })).data;
  ok(scoped.removed > 0, `R2 and out-of-scope rows removed (${scoped.removed})`);
  const otherOpen = (await call(admin, 'GET', `/tasks?projectId=${other.id}&hideDone=1`)).data;
  ok(otherOpen.every((t) => !t.reviewers.some((r) => r.id === R1.id)), 'tasks in other projects lose the automatic reviewer');
  const keptManual = (await call(admin, 'GET', `/tasks/${manual.id}`)).data;
  ok(keptManual.reviewers.length === 1 && !keptManual.reviewers.some((r) => r.id === R1.id), 'a hand-picked reviewer is kept');
  const kasOpen = (await call(admin, 'GET', `/tasks?projectId=${KAS.id}&hideDone=1`)).data;
  ok(kasOpen.every((t) => t.reviewers.some((r) => r.id === R1.id) && !t.reviewers.some((r) => r.id === R2.id)), 'KAS tasks keep R1 only');
  const otherNew = (await call(mgr, 'POST', '/tasks', { title: 'Outside scope', projectId: other.id })).data;
  ok(!(await call(mgr, 'GET', `/tasks/${otherNew.id}`)).data.reviewers.length, 'new tasks outside the chosen projects get none');
  ok(!(await call(admin, 'PUT', '/roles/reviewers', { userIds: [], projectIds: [] })).data.userIds.length, 'list can be cleared');

  console.log('Client portal');
  const ov = (await call(client, 'GET', '/portal/overview')).data;
  ok(Array.isArray(ov.activity) && ov.activity.length === 0, 'overview sends no activity to the client');
  const pp = (await call(client, 'GET', `/portal/projects/${KAS.id}`)).data;
  ok(Array.isArray(pp.activity) && pp.activity.length === 0, 'project page sends none either');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
