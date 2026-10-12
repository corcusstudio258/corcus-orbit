// v4 checks: clickable dashboard counts, task filters + date range, due times, project quick edit/delete,
// automation recipes, templates, client review requests, media compression and review-data retention.
// Run against a freshly seeded server: node test/v4.js
const sharp = require('sharp');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BASE = process.env.API || 'http://localhost:5000/api';
let pass = 0; let fail = 0;
const ok = (cond, msg, extra) => { if (cond) { pass++; console.log('  ✓', msg); } else { fail++; console.log('  ✗', msg, extra !== undefined ? JSON.stringify(extra).slice(0, 300) : ''); } };
async function call(token, method, p, body) {
  const isForm = body instanceof FormData;
  const r = await fetch(BASE + p, { method, headers: { ...(isForm ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}), Origin: 'http://localhost:5173' }, body: body ? (isForm ? body : JSON.stringify(body)) : undefined });
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: r.status, data };
}
const login = async (email, password = 'Orbit@123') => (await call(null, 'POST', '/auth/login', { email, password })).data.token;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function bigJpeg() {
  const w = 3200; const h = 2000;
  const raw = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 3; raw[i] = (x * 7) & 255; raw[i + 1] = (y * 3) & 255; raw[i + 2] = ((x ^ y) * 5) & 255; }
  return sharp(raw, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 100 }).toBuffer();
}
function bigVideo() {
  const ff = require('ffmpeg-static');
  const out = path.join(os.tmpdir(), `orbit-test-${Date.now()}.mov`);
  const r = spawnSync(ff, ['-y', '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30', '-t', '3', '-c:v', 'mjpeg', '-q:v', '2', out], { stdio: 'ignore' });
  if (r.status !== 0) return null;
  const buf = fs.readFileSync(out); fs.unlinkSync(out); return buf;
}

(async () => {
  const admin = await login('admin@corcus.in');
  const mgr = await login('manager@corcus.in');
  const client = await login('client@kasaar.in');
  const projects = (await call(admin, 'GET', '/projects')).data;
  const KAS = projects.find((p) => p.code === 'KAS');

  console.log('Dashboard counts and task filters');
  const dash = (await call(mgr, 'GET', '/dashboard')).data;
  ok(dash.hero && ['active', 'pending', 'review', 'completed'].every((k) => typeof dash.hero[k] === 'number'), 'hero carries my status counts', dash.hero);
  const mine = (await call(mgr, 'GET', '/tasks?assignee=me&status=in_progress')).data;
  ok(Array.isArray(mine) && mine.every((t) => t.status === 'in_progress'), 'status filter');
  const multi = (await call(mgr, 'GET', `/tasks?projectId=${KAS.id}&status=backlog,todo`)).data;
  ok(multi.every((t) => ['backlog', 'todo'].includes(t.status)), 'multi-status filter');
  const due = new Date(); due.setDate(due.getDate() + 3); due.setHours(15, 30, 0, 0);
  const timed = (await call(mgr, 'POST', '/tasks', { title: 'Timed task', projectId: KAS.id, dueDate: due.toISOString() })).data;
  ok(new Date(timed.dueDate).getTime() === due.getTime(), 'due date keeps its time', timed.dueDate);
  const from = new Date(due); from.setHours(0, 0, 0, 0); const to = new Date(due); to.setHours(23, 59, 59, 999);
  const ranged = (await call(mgr, 'GET', `/tasks?from=${from.toISOString()}&to=${to.toISOString()}`)).data;
  ok(ranged.some((t) => t.id === timed.id) && ranged.every((t) => new Date(t.dueDate) >= from && new Date(t.dueDate) <= to), 'date range filter');

  console.log('Project quick edit and delete');
  const np = (await call(admin, 'POST', '/projects', { name: 'Throwaway', code: 'THR' })).data;
  ok(np.id, 'project created without budget fields', np);
  const ren = await call(admin, 'PATCH', `/projects/${np.id}`, { name: 'Throwaway 2', status: 'on_hold' });
  ok(ren.data.name === 'Throwaway 2' && ren.data.status === 'on_hold', 'quick edit name and status', ren.data);
  const tt = (await call(admin, 'POST', '/tasks', { title: 'Doomed task', projectId: np.id })).data;
  const badDel = await call(admin, 'DELETE', `/projects/${np.id}`, { confirm: 'nope' });
  ok(badDel.status === 400, 'delete needs the project name typed', badDel.data);
  const del = await call(admin, 'DELETE', `/projects/${np.id}`, { confirm: 'Throwaway 2' });
  ok(del.status === 200 && del.data.tasks === 1, 'project deleted with its tasks', del.data);
  ok((await call(admin, 'GET', `/tasks/${tt.id}`)).status === 404, 'its tasks are gone');

  console.log('Automations and templates');
  const au = (await call(admin, 'GET', '/tools/automations')).data;
  ok(au.recipes.length >= 12 && au.triggers['task.client_review'] && au.actions.create_subtask, 'more triggers, actions and recipes', au.recipes.length);
  const rec = await call(admin, 'POST', '/tools/automations/recipe', { key: au.recipes[0].key, projectId: KAS.id });
  ok(rec.status === 201 && rec.data.conditions.projectId === KAS.id, 'add a recipe for one project', rec.data);
  const tpl = await call(admin, 'POST', '/tools/templates', { name: 'Reel sprint', category: 'Social', icon: '🎬', structure: { stages: ['Script', 'Shoot', 'Edit'], milestones: [{ title: 'Delivered', day: 7 }], tasks: [{ title: 'Write script', stage: 'Script', day: 1, priority: 'high', subtasks: ['Hook', 'CTA'] }, { title: 'Edit reel', stage: 'Edit', day: 5 }] } });
  ok(tpl.status === 201 && tpl.data.structure.tasks.length === 2, 'create a custom template', tpl.data);
  const used = await call(admin, 'POST', '/projects', { name: 'Template run', code: 'TPR', templateId: tpl.data.id });
  const usedTasks = (await call(admin, 'GET', `/tasks?projectId=${used.data.id}`)).data;
  ok(usedTasks.some((t) => t.title === 'Write script'), 'template builds the project', usedTasks.map((t) => t.title));

  console.log('Client review requests');
  const kasTask = (await call(mgr, 'GET', `/tasks?projectId=${KAS.id}`)).data.find((x) => x.clientVisible);
  const up = new FormData(); up.append('files', new Blob([await bigJpeg()], { type: 'image/jpeg' }), 'poster.jpg'); up.append('clientVisible', 'false');
  const att = (await call(mgr, 'POST', `/tasks/${kasTask.id}/attachments`, up)).data[0];
  ok(att.compression === 'done' && att.originalSize > att.size, 'large image compressed on upload', { size: att.size, originalSize: att.originalSize, compression: att.compression });
  const meta = await sharp(Buffer.from(await (await fetch(`${BASE.replace(/\/api$/, '')}/api/files/${att.id}?t=${mgr}`)).arrayBuffer())).metadata();
  ok(Math.max(meta.width, meta.height) <= 2560, 'compressed image capped at 2560px', meta.width);
  let ov = (await call(client, 'GET', '/portal/overview')).data;
  ok(!ov.reviewFiles.some((f) => f.id === att.id), 'team-only file not in the client list');
  const ask = await call(mgr, 'PATCH', `/tasks/attachments/${att.id}`, { clientReviewStatus: 'requested' });
  ok(ask.data.clientReviewStatus === 'requested' && ask.data.clientVisible === true, 'staff asks the client to review', ask.data);
  ov = (await call(client, 'GET', '/portal/overview')).data;
  ok(ov.reviewFiles.some((f) => f.id === att.id), 'client now sees it to review');
  const verdict = await call(client, 'POST', `/portal/files/${att.id}/review`, { decision: 'changes', note: 'Swap the photo' });
  ok(verdict.data.clientReviewStatus === 'changes', 'client asks for changes');
  const det = (await call(mgr, 'GET', `/tasks/${kasTask.id}`)).data;
  const seen = det.Attachments.find((a) => a.id === att.id);
  ok(seen.clientReviewStatus === 'changes' && seen.clientReviewedAt && seen.reviewStatus !== 'changes', 'staff see the client verdict apart from the team one', seen);
  const internal = (await call(mgr, 'GET', `/tasks?projectId=${KAS.id}`)).data.find((x) => !x.clientVisible);
  if (internal) {
    const up3 = new FormData(); up3.append('files', new Blob([Buffer.from('x')], { type: 'text/plain' }), 'n.txt');
    const a3 = (await call(mgr, 'POST', `/tasks/${internal.id}/attachments`, up3)).data[0];
    ok((await call(mgr, 'PATCH', `/tasks/attachments/${a3.id}`, { clientReviewStatus: 'requested' })).status === 400, 'cannot ask for client review on a team-only task');
  }

  console.log('Video compression');
  const vid = bigVideo();
  if (!vid) ok(false, 'could not make a test video');
  else {
    const vf = new FormData(); vf.append('files', new Blob([vid], { type: 'video/quicktime' }), 'cut.mov');
    const va = (await call(mgr, 'POST', `/tasks/${kasTask.id}/attachments`, vf)).data[0];
    ok(va.compression === 'pending', 'video queued for compression', va.compression);
    let v = va;
    for (let i = 0; i < 60 && v.compression === 'pending'; i++) { await sleep(1000); v = (await call(mgr, 'GET', `/tasks/${kasTask.id}`)).data.Attachments.find((a) => a.id === va.id); }
    ok(v.compression === 'done' && v.mime === 'video/mp4' && v.size < v.originalSize && v.originalName === 'cut.mp4', 'video transcoded to a smaller mp4', { size: v.size, originalSize: v.originalSize, c: v.compression });
    const vr = await fetch(`${BASE}/files/${v.id}?t=${mgr}`);
    ok(vr.status === 200 && Number(vr.headers.get('content-length')) === v.size, 'compressed video downloads');
  }

  console.log('Review data retention');
  const set = await call(admin, 'PATCH', '/settings/company', { reviewRetentionDays: 30 });
  ok(set.data.reviewRetentionDays === 30, 'retention setting saved', set.data);
  const pinned = new FormData(); pinned.append('body', 'Crop tighter'); pinned.append('attachmentId', String(att.id)); pinned.append('pinX', '0.3'); pinned.append('pinY', '0.3');
  await call(mgr, 'POST', `/tasks/${kasTask.id}/comments`, pinned);
  const doc = new FormData(); doc.append('files', new Blob([Buffer.from('%PDF-1.4 keep')], { type: 'application/pdf' }), 'contract.pdf');
  const keep = (await call(mgr, 'POST', `/tasks/${kasTask.id}/attachments`, doc)).data[0];
  const early = await call(admin, 'POST', `/projects/${KAS.id}/purge-review`);
  ok(early.status === 400, 'only completed projects can be cleared');
  await call(admin, 'PATCH', `/projects/${KAS.id}`, { status: 'completed' });
  const pd = (await call(admin, 'GET', `/projects/${KAS.id}`)).data;
  const days = Math.round((new Date(pd.reviewPurgeOn) - new Date(pd.completedAt)) / 864e5);
  ok(pd.completedAt && days === 30, 'completed project shows when review data goes', { on: pd.reviewPurgeOn, at: pd.completedAt });
  // The daily job, run as if 31 days had passed
  const retention = require('../src/services/retention');
  const none = await retention.purgeExpired();
  ok(!none.some((r) => r.projectId === KAS.id), 'nothing removed before 30 days');
  const ran = await retention.purgeExpired({ now: new Date(Date.now() + 31 * 864e5) });
  const mineRun = ran.find((r) => r.projectId === KAS.id);
  ok(mineRun && mineRun.files >= 2 && mineRun.comments >= 1, 'review data removed after 30 days', ran);
  const after = (await call(mgr, 'GET', `/tasks/${kasTask.id}`)).data;
  ok(!after.Attachments.some((a) => a.id === att.id) && !after.Comments.some((c) => c.kind === 'review'), 'reviewed media and pins are gone');
  ok(after.Attachments.some((a) => a.id === keep.id), 'documents are kept');
  const pd2 = (await call(admin, 'GET', `/projects/${KAS.id}`)).data;
  ok(pd2.reviewPurgedAt && !pd2.reviewPurgeOn, 'project records the clean-up');
  await call(admin, 'PATCH', `/projects/${KAS.id}`, { status: 'active' });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
