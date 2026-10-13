// v6 checks: project bulk import / export, sample file from pipeline stages, dates and times.
const BASE = process.env.API || 'http://localhost:5000/api';
let pass = 0; let fail = 0;
const ok = (c, m, x) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗', m, x !== undefined ? JSON.stringify(x).slice(0, 400) : ''); } };
async function call(token, method, p, body) {
  const r = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let data; try { data = JSON.parse(t); } catch { data = t; }
  return { status: r.status, data, type: r.headers.get('content-type') };
}
const login = async (email, password = 'Orbit@123') => (await call(null, 'POST', '/auth/login', { email, password })).data.token;
const csvRows = (t) => t.replace(/^﻿/, '').split(/\r?\n/).map((l) => l.match(/("([^"]|"")*")/g).map((c) => c.slice(1, -1).replace(/""/g, '"')));

(async () => {
  const admin = await login('admin@corcus.in');
  const P = (await call(admin, 'POST', '/projects', { name: 'Bulk test', code: 'BLK' })).data;
  for (const name of ['Brief', 'Design', 'Publish']) await call(admin, 'POST', `/projects/${P.id}/sections`, { name });

  console.log('Sample file');
  const s = await call(admin, 'GET', `/tools/projects/${P.id}/sample.csv`);
  ok(s.status === 200 && /text\/csv/.test(s.type), 'sample downloads as CSV');
  const sr = csvRows(s.data);
  ok(sr[0].includes('Stage') && sr[0].includes('Due date') && sr[0].includes('Due time') && sr[0].includes('Start date'), 'sample has stage, date and time columns', sr[0]);
  const stageCol = sr[0].indexOf('Stage');
  ok(['Brief', 'Design', 'Publish'].every((n) => sr.slice(1).some((r) => r[stageCol] === n)), 'one example per pipeline stage');
  ok(sr.slice(1).every((r) => /^\d{4}-\d{2}-\d{2}$/.test(r[sr[0].indexOf('Due date')])), 'sample dates are filled from today');

  console.log('Importing the sample as-is');
  const head = sr[0];
  const map = { Key: 'key', Title: 'title', Description: 'description', Stage: 'stage', Status: 'status', Priority: 'priority', Assignees: 'assignee', 'Start date': 'start', 'Due date': 'due', 'Due time': 'due_time', 'Estimate hours': 'estimate', 'Story points': 'points', Tags: 'tags', 'Parent task': 'parent', 'Client visible': 'client_visible' };
  const toRows = (rows) => rows.map((r) => Object.fromEntries(head.map((h, i) => [map[h], r[i]]).filter(([k]) => k)));
  const dry = (await call(admin, 'POST', '/tools/import/tasks', { projectId: P.id, rows: toRows(sr.slice(1)), dryRun: true })).data;
  ok(dry.dryRun && dry.created === sr.length - 1 && !dry.errors.length, 'check run counts rows without saving', dry);
  ok(((await call(admin, 'GET', `/tasks?projectId=${P.id}`)).data.length || 0) === 0, 'check run saved nothing');
  const imp = (await call(admin, 'POST', '/tools/import/tasks', { projectId: P.id, rows: toRows(sr.slice(1)) })).data;
  ok(imp.created === sr.length - 1 && !imp.errors.length, 'sample imports cleanly', imp);

  console.log('Dates, times, stages, subtasks');
  const r2 = (await call(admin, 'POST', '/tools/import/tasks', { projectId: P.id, rows: [
    { title: 'Indian date and PM time', due: '15/11/2026', due_time: '6:30 PM', start: '10/11/2026', stage: 'Design', status: 'In progress', assignee: 'admin@corcus.in', client_visible: 'yes', estimate: '3', points: '5' },
    { title: 'Child row', parent: 'Indian date and PM time', due: '16 Nov 2026', due_time: '09:15' },
    { title: 'Date with time in one cell', due: '2026-11-20 11:45' },
    { title: 'Brand new stage', stage: 'QA' },
    { title: 'Bad date', due: '31/02/2026' },
    { title: 'Bad time', due: '2026-11-20', due_time: '25:00' },
    { title: '' },
  ] })).data;
  ok(r2.created === 4 && r2.errors.length === 3, 'good rows import, bad ones are reported', r2);
  ok(r2.newStages.includes('QA'), 'unknown stage becomes a new stage');
  const list = (await call(admin, 'GET', `/tasks?projectId=${P.id}&subtasks=1`)).data;
  const all = Array.isArray(list) ? list : list.tasks || [];
  const t1 = all.find((t) => t.title === 'Indian date and PM time');
  const full = (await call(admin, 'GET', `/tasks/${t1.id}`)).data;
  ok(new Date(full.dueDate).toISOString() === '2026-11-15T13:00:00.000Z', 'DD/MM/YYYY + 6:30 PM becomes 6:30 PM India time', full.dueDate);
  ok(full.startDate === '2026-11-10' && full.status === 'in_progress' && full.clientVisible === true && full.storyPoints === 5, 'start date, status, client visibility and points set', [full.startDate, full.status, full.clientVisible, full.storyPoints]);
  ok(full.Section?.name === 'Design' || full.sectionId, 'stage applied');
  const kids = all.filter((k) => k.parentId === t1.id);
  ok(kids.some((k) => k.title === 'Child row'), 'parent column makes a subtask', kids.map((k) => k.title));

  console.log('Export and round-trip update');
  const ex = await call(admin, 'GET', `/tools/projects/${P.id}/tasks.csv`);
  const er = csvRows(ex.data);
  ok(er[0].includes('Key') && er[0].includes('Created at') && er[0].includes('Completed at'), 'export has key and timestamps', er[0]);
  const row = er.find((r) => r[1] === 'Indian date and PM time');
  ok(row && row[er[0].indexOf('Due date')] === '2026-11-15' && row[er[0].indexOf('Due time')] === '18:30', 'export splits due date and time in India time', row);
  const up = (await call(admin, 'POST', '/tools/import/tasks', { projectId: P.id, rows: [{ key: row[0], title: 'Renamed in sheet', due: '2026-11-18', due_time: '10:00', status: 'Done' }] })).data;
  ok(up.updated === 1 && up.created === 0, 'a row with a key updates that task', up);
  const after = (await call(admin, 'GET', `/tasks/${t1.id}`)).data;
  ok(after.title === 'Renamed in sheet' && after.status === 'done' && new Date(after.dueDate).toISOString() === '2026-11-18T04:30:00.000Z' && after.storyPoints === 5, 'update changes only the filled cells', [after.title, after.status, after.dueDate, after.storyPoints]);

  console.log('Access');
  const roles = (await call(admin, 'GET', '/roles')).data;
  const exec = roles.find((r) => r.slug === 'executive');
  await call(admin, 'POST', '/users', { name: 'Bulk Outsider', email: 'bulk.out@corcus.in', password: 'Bulk#2026x', roleId: exec.id });
  const out = await login('bulk.out@corcus.in', 'Bulk#2026x');
  ok((await call(out, 'GET', `/tools/projects/${P.id}/sample.csv`)).status === 404, 'non-members cannot download the sample');
  ok((await call(out, 'GET', `/tools/projects/${P.id}/tasks.csv`)).status === 404, 'or export the project');
  ok((await call(out, 'POST', '/tools/import/tasks', { projectId: P.id, rows: [{ title: 'x' }] })).status === 404, 'or import into it');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
