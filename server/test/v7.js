// v7 checks: task reviewers, the "to review" list, and browser push notifications.
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
const fakeSub = (path) => {
  const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
  return { endpoint: `${PUSH}/push/${path}`, keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') } };
};

(async () => {
  const admin = await login('admin@corcus.in');
  const roles = (await call(admin, 'GET', '/roles')).data;
  const exec = roles.find((r) => r.slug === 'executive');
  const W = (await call(admin, 'POST', '/users', { name: 'Worker Rev', email: 'worker.rev@corcus.in', password: 'Work#2026x', roleId: exec.id })).data;
  const R = (await call(admin, 'POST', '/users', { name: 'Reviewer Rev', email: 'reviewer.rev@corcus.in', password: 'Revw#2026x', roleId: exec.id })).data;
  const O = (await call(admin, 'POST', '/users', { name: 'Other Rev', email: 'other.rev@corcus.in', password: 'Othr#2026x', roleId: exec.id })).data;
  const wt = await login('worker.rev@corcus.in', 'Work#2026x'); const rt = await login('reviewer.rev@corcus.in', 'Revw#2026x'); const ot = await login('other.rev@corcus.in', 'Othr#2026x');
  const P = (await call(admin, 'POST', '/projects', { name: 'Review flow', code: 'REV' })).data;
  await call(admin, 'PATCH', `/projects/${P.id}`, { memberIds: [W.id] });

  console.log('Push subscriptions');
  const key = (await call(rt, 'GET', '/push/key')).data;
  ok(typeof key.publicKey === 'string' && key.publicKey.length > 60 && key.devices === 0, 'server hands out a VAPID public key', key);
  ok((await call(rt, 'GET', '/push/key')).data.publicKey === key.publicKey, 'the key stays the same');
  ok((await call(rt, 'POST', '/push/subscribe', { subscription: { endpoint: 'x' } })).status === 400, 'incomplete subscription refused');
  ok((await call(rt, 'POST', '/push/subscribe', { subscription: fakeSub('reviewer') })).data.ok, 'reviewer turns on browser notifications');
  await call(rt, 'POST', '/push/subscribe', { subscription: fakeSub('gone-reviewer') });
  ok((await call(rt, 'GET', '/push/key')).data.devices === 2, 'two browsers saved');
  const test = await call(rt, 'POST', '/push/test');
  ok(test.status === 200 && test.data.sent === 1, 'test push delivered to the live browser', test.data);
  ok((await call(rt, 'GET', '/push/key')).data.devices === 1, 'expired browser (410) is removed');
  ok((await call(ot, 'POST', '/push/test')).status === 400, 'test without a browser says how to fix it');

  console.log('Reviewers');
  const t = (await call(admin, 'POST', '/tasks', { title: 'Reel edit for review', projectId: P.id, assigneeIds: [W.id], reviewerIds: [R.id], dueDate: new Date(Date.now() - 864e5).toISOString() })).data;
  const d1 = (await call(admin, 'GET', `/tasks/${t.id}`)).data;
  ok(d1.reviewers?.map((r) => r.id).includes(R.id) && d1.requiresApproval, 'reviewer saved and approval switched on', [d1.reviewers, d1.requiresApproval]);
  await sleep(400);
  const log1 = (await (await fetch(`${MOCK}/_log`)).json()).filter((l) => l.path === '/push/reviewer');
  ok(log1.length >= 2 && log1.every((l) => l.encoding === 'aes128gcm'), 'reviewer got an encrypted browser push when added', log1.length);
  const rn = (await call(rt, 'GET', '/notifications')).data;
  ok(JSON.stringify(rn).includes('made you reviewer'), 'reviewer gets an in-app notification');
  ok((await call(rt, 'GET', `/tasks/${t.id}`)).status === 200, 'reviewer can open the task without being in the project');
  ok((await call(ot, 'GET', `/tasks/${t.id}`)).status === 404, 'others still cannot');
  ok((await call(rt, 'GET', `/tasks/${t.id}`)).data.canApprove === true, 'reviewer can approve');
  await call(wt, 'PATCH', `/tasks/${t.id}`, { status: 'done' });
  const d2 = (await call(admin, 'GET', `/tasks/${t.id}`)).data;
  ok(d2.status === 'review' && d2.approvalStatus === 'pending', 'marking done sends it to review');
  const rn2 = (await call(rt, 'GET', '/notifications')).data;
  ok(JSON.stringify(rn2).includes('Approval needed'), 'reviewer is asked to approve');
  const queue = (await call(rt, 'GET', '/tasks?reviewer=me&status=review')).data;
  ok(queue.length === 1 && queue[0].id === t.id && queue[0].reviewers.length === 1, 'task shows in the reviewer’s To review list', queue.map((q) => q.key));
  ok((await call(ot, 'POST', `/tasks/${t.id}/approval`, { decision: 'approve' })).status === 403, 'non-reviewer cannot approve');
  const ap = await call(rt, 'POST', `/tasks/${t.id}/approval`, { decision: 'approve', note: 'Looks good' });
  ok(ap.status === 200 && ap.data.status === 'done', 'reviewer approves and the task is done', ap.data.status);

  console.log('Changing reviewers');
  const t2 = (await call(admin, 'POST', '/tasks', { title: 'Second', projectId: P.id, assigneeIds: [W.id] })).data;
  const p1 = (await call(wt, 'PATCH', `/tasks/${t2.id}`, { reviewerIds: [R.id, O.id] })).data;
  ok(p1.reviewers.length === 2 && p1.requiresApproval, 'assignee can add reviewers from the task');
  const p2 = (await call(wt, 'PATCH', `/tasks/${t2.id}`, { reviewerIds: [O.id] })).data;
  ok(p2.reviewers.length === 1 && p2.reviewers[0].id === O.id, 'and remove one');
  await call(rt, 'PATCH', '/auth/me', { notifyPrefs: { push: false } });
  const before = (await (await fetch(`${MOCK}/_log`)).json()).filter((l) => l.path === '/push/reviewer').length;
  await call(wt, 'PATCH', `/tasks/${t2.id}`, { reviewerIds: [O.id, R.id] });
  await sleep(400);
  const after = (await (await fetch(`${MOCK}/_log`)).json()).filter((l) => l.path === '/push/reviewer').length;
  ok(after === before, 'pausing pop-ups in the profile stops browser pushes', { before, after });
  ok((await call(rt, 'POST', '/push/unsubscribe', { endpoint: `${PUSH}/push/reviewer` })).data.ok && (await call(rt, 'GET', '/push/key')).data.devices === 0, 'turning off removes the browser');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
