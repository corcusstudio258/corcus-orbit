// v8 checks: client feedback on the task description, 150 MB video uploads with compression,
// and deleting review videos (with their pinned notes).
const fs = require('fs'); const os = require('os'); const path = require('path');
const { spawnSync } = require('child_process');
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function video(seconds) {
  const ff = require('ffmpeg-static');
  const out = path.join(os.tmpdir(), `orbit-v8-${Date.now()}.mov`);
  spawnSync(ff, ['-y', '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30', '-t', String(seconds), '-c:v', 'mjpeg', '-q:v', '2', out], { stdio: 'ignore' });
  const buf = fs.readFileSync(out); fs.unlinkSync(out); return buf;
}
const form = (buf, name, type) => { const f = new FormData(); f.append('files', new Blob([buf], { type }), name); f.append('clientVisible', 'true'); return f; };

(async () => {
  const admin = await login('admin@corcus.in');
  const mgr = await login('manager@corcus.in');
  const client = await login('client@kasaar.in');
  const KAS = (await call(admin, 'GET', '/projects')).data.find((p) => p.code === 'KAS');
  const t = (await call(mgr, 'POST', '/tasks', { title: 'Diwali reel caption', projectId: KAS.id, clientVisible: true, description: 'Caption: *Is Diwali, gift thekua.* Order on kasaar.in' })).data;

  console.log('Client feedback on the description');
  let pt = (await call(client, 'GET', `/portal/tasks/${t.id}`)).data;
  ok(pt.description.includes('thekua') && pt.descReviewStatus === 'none', 'client can read the description');
  await call(mgr, 'PATCH', `/tasks/${t.id}`, { descClientVisible: false });
  pt = (await call(client, 'GET', `/portal/tasks/${t.id}`)).data;
  ok(pt.description === '', 'team can hide the description from the client');
  ok((await call(client, 'POST', `/portal/tasks/${t.id}/description-review`, { decision: 'approve' })).status === 404, 'hidden description cannot be reviewed');
  const hiddenTask = (await call(mgr, 'POST', '/tasks', { title: 'Internal only', projectId: KAS.id, description: 'x' })).data;
  ok((await call(mgr, 'PATCH', `/tasks/${hiddenTask.id}`, { descReviewStatus: 'requested' })).status === 400, 'asking needs the task shared with the client');
  const ask = (await call(mgr, 'PATCH', `/tasks/${t.id}`, { descReviewStatus: 'requested' })).data;
  ok(ask.descReviewStatus === 'requested' && ask.descClientVisible === true, 'asking for feedback shares the description again');
  const ov = (await call(client, 'GET', '/portal/overview')).data;
  ok(ov.briefs.some((b) => b.id === t.id), 'it shows in the client’s review list');
  ok((await call(client, 'POST', `/portal/tasks/${t.id}/description-review`, { decision: 'changes' })).status === 400, 'changes need a note');
  const ch = (await call(client, 'POST', `/portal/tasks/${t.id}/description-review`, { decision: 'changes', note: 'Say "festive gift box" instead' })).data;
  ok(ch.descReviewStatus === 'changes', 'client asks for changes');
  let d = (await call(mgr, 'GET', `/tasks/${t.id}`)).data;
  ok(d.descReviewStatus === 'changes' && d.descReviewNote.includes('festive') && d.Comments.some((c) => c.kind === 'brief' && c.body.includes('Requested changes')), 'team sees the note on the task and in comments');
  const mn = (await call(mgr, 'GET', '/notifications')).data;
  ok(JSON.stringify(mn).includes('wants changes to the description'), 'team is notified');
  await call(mgr, 'PATCH', `/tasks/${t.id}`, { description: 'Caption: Festive gift box of thekua. Order on kasaar.in' });
  d = (await call(mgr, 'GET', `/tasks/${t.id}`)).data;
  ok(d.descReviewStatus === 'requested', 'editing after feedback asks the client again');
  const ap = (await call(client, 'POST', `/portal/tasks/${t.id}/description-review`, { decision: 'approve' })).data;
  ok(ap.descReviewStatus === 'approved' && !(await call(client, 'GET', '/portal/overview')).data.briefs.some((b) => b.id === t.id), 'client approves and it leaves the list');

  console.log('Big video uploads');
  const vid = video(9);
  ok(vid.length > 26 * 1024 * 1024, `test video is over 25 MB (${Math.round(vid.length / 1048576)} MB)`);
  const up = await call(mgr, 'POST', `/tasks/${t.id}/attachments`, form(vid, 'reel-master.mov', 'video/quicktime'));
  ok(up.status === 201 && up.data[0].size === vid.length, 'video over 25 MB is accepted', up.data.error || up.status);
  const big = await call(mgr, 'POST', `/tasks/${t.id}/attachments`, form(Buffer.alloc(26 * 1024 * 1024, 1), 'huge.jpg', 'image/jpeg'));
  ok(big.status === 413 && /25 MB/.test(big.data.error), 'images over 25 MB are refused with a clear message', big.data);
  const huge = await call(mgr, 'POST', `/tasks/${t.id}/attachments`, form(Buffer.alloc(151 * 1024 * 1024, 1), 'too-long.mp4', 'video/mp4'));
  ok(huge.status === 413 && /150 MB/.test(huge.data.error), 'videos over 150 MB are refused with a clear message', huge.data);
  let file = null;
  for (let i = 0; i < 60; i++) {
    file = (await call(mgr, 'GET', `/tasks/${t.id}`)).data.Attachments.find((a) => a.id === up.data[0].id);
    if (file.compression !== 'pending') break;
    await sleep(1000);
  }
  ok(file.compression === 'done' && file.size < file.originalSize / 2 && file.mime === 'video/mp4', 'video is compressed after upload', { size: file.size, originalSize: file.originalSize, c: file.compression });

  console.log('Deleting review videos');
  const fd = new FormData(); fd.append('body', 'Cut the first second'); fd.append('attachmentId', String(file.id)); fd.append('pinX', '0.5'); fd.append('pinY', '0.5'); fd.append('pinTime', '1');
  await call(client, 'POST', `/portal/tasks/${t.id}/comments`, fd);
  const roles = (await call(admin, 'GET', '/roles')).data;
  ok(roles.find((r) => r.slug === 'team-lead').permissions.includes('files.delete') && !roles.find((r) => r.slug === 'executive').permissions.includes('files.delete'), 'new "delete files" permission: leads yes, executives no');
  const exec = roles.find((r) => r.slug === 'executive');
  await call(admin, 'POST', '/users', { name: 'Exec Files', email: 'exec.files@corcus.in', password: 'Exec#2026x', roleId: exec.id });
  const et = await login('exec.files@corcus.in', 'Exec#2026x');
  await call(admin, 'PATCH', `/projects/${KAS.id}`, { memberIds: [...new Set([...(await call(admin, 'GET', `/projects/${KAS.id}`)).data.members.map((m) => m.id), (await call(et, 'GET', '/auth/me')).data.user?.id || (await call(et, 'GET', '/auth/me')).data.id])] });
  ok((await call(et, 'GET', `/tasks/${t.id}`)).status === 404, 'an executive who is not on the task cannot even open it');
  ok((await call(et, 'DELETE', `/tasks/attachments/${file.id}`)).status === 403, 'and the server refuses it');
  ok((await call(mgr, 'GET', `/tasks/${t.id}`)).data.canDeleteFiles === true, 'the manager can');
  const del = await call(mgr, 'DELETE', `/tasks/attachments/${file.id}`);
  ok(del.status === 200 && del.data.notesRemoved === 1, 'review video deleted with its pinned note', del.data);
  const after = (await call(mgr, 'GET', `/tasks/${t.id}`)).data;
  ok(!after.Attachments.some((a) => a.id === file.id) && !after.Comments.some((c) => c.attachmentId === file.id), 'gone from the task');
  ok(!(await call(client, 'GET', `/portal/tasks/${t.id}`)).data.files.some((f) => f.id === file.id), 'and from the client portal');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
