// v5 checks: team-lead visibility (projects only when added), team view via reports, points privacy.
const BASE = process.env.API || 'http://localhost:5000/api';
let pass = 0; let fail = 0;
const ok = (c, m, x) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗', m, x !== undefined ? JSON.stringify(x).slice(0, 300) : ''); } };
async function call(token, method, p, body) {
  const r = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let data; try { data = JSON.parse(t); } catch { data = t; }
  return { status: r.status, data };
}
const login = async (email, password = 'Orbit@123') => (await call(null, 'POST', '/auth/login', { email, password })).data.token;

(async () => {
  const admin = await login('admin@corcus.in');
  const roles = (await call(admin, 'GET', '/roles')).data;
  const lead = roles.find((r) => r.slug === 'team-lead'); const exec = roles.find((r) => r.slug === 'executive');
  ok(lead.permissions.includes('tasks.view_team') && !lead.permissions.includes('projects.view_all'), 'team lead sees own team, not every project');
  const L = (await call(admin, 'POST', '/users', { name: 'Lead Test', email: 'lead.t@corcus.in', password: 'Lead#2026x', roleId: lead.id })).data;
  const E = (await call(admin, 'POST', '/users', { name: 'Exec Test', email: 'exec.t@corcus.in', password: 'Exec#2026x', roleId: exec.id, reportsToId: L.id })).data;
  const E2 = (await call(admin, 'POST', '/users', { name: 'Exec Two', email: 'exec2.t@corcus.in', password: 'Exec#2026x', roleId: exec.id })).data;
  const lt = await login('lead.t@corcus.in', 'Lead#2026x'); const et = await login('exec.t@corcus.in', 'Exec#2026x'); const e2t = await login('exec2.t@corcus.in', 'Exec#2026x');

  console.log('Projects and tasks');
  let mine = (await call(lt, 'GET', '/projects')).data;
  ok(Array.isArray(mine) && mine.length === 0, 'lead added to no project sees no projects', mine.map?.((p) => p.name));
  const P1 = (await call(admin, 'POST', '/projects', { name: 'Lead project', code: 'LDP' })).data;
  const P2 = (await call(admin, 'POST', '/projects', { name: 'Exec project', code: 'EXP' })).data;
  const P3 = (await call(admin, 'POST', '/projects', { name: 'Other project', code: 'OTP' })).data;
  const t3 = (await call(admin, 'POST', '/tasks', { title: 'Task for lead elsewhere', projectId: P3.id, assigneeIds: [L.id] })).data;
  mine = (await call(lt, 'GET', '/projects')).data;
  ok(!mine.some((p) => p.id === P3.id), 'an assigned task does not open the whole project');
  ok((await call(lt, 'GET', `/tasks/${t3.id}`)).status === 200, 'but the lead can open that task');
  ok((await call(lt, 'GET', `/projects/${P3.id}`)).status === 404, 'and the project page stays closed');
  await call(admin, 'PATCH', `/projects/${P1.id}`, { memberIds: [L.id] });
  await call(admin, 'PATCH', `/projects/${P2.id}`, { memberIds: [E.id] });
  mine = (await call(lt, 'GET', '/projects')).data;
  ok(mine.some((p) => p.id === P1.id) && mine.some((p) => p.id === P2.id) && !mine.some((p) => p.id === P3.id), 'lead sees projects they or their reports were added to', mine.map((p) => p.name));
  const em = (await call(et, 'GET', '/projects')).data;
  ok(em.length === 1 && em[0].id === P2.id, 'executive sees only their own project', em.map((p) => p.name));
  const t2 = (await call(admin, 'POST', '/tasks', { title: 'Report task', projectId: P2.id, assigneeIds: [E.id] })).data;
  ok((await call(lt, 'GET', `/tasks/${t2.id}`)).status === 200, 'lead can see a report’s task');
  ok((await call(e2t, 'GET', `/tasks/${t2.id}`)).status === 404, 'other executives cannot');
  const all = (await call(lt, 'GET', '/tasks')).data;
  ok(!all.some((t) => [P3.id].includes(t.projectId) && t.id !== t3.id), 'task list holds no other tasks from unshared projects');

  console.log('Points');
  ok((await call(lt, 'GET', `/people/rewards/me?userId=${E2.id}`)).status === 403, 'lead cannot open someone else’s points');
  ok((await call(lt, 'GET', `/people/rewards/me?userId=${E.id}`)).status === 200, 'lead can see a report’s points');
  ok((await call(e2t, 'GET', `/people/rewards/me?userId=${L.id}`)).status === 403, 'executive cannot see others’ points');
  for (let i = 0; i < 3; i++) await call(admin, 'POST', '/people/rewards/kudos', { userId: E2.id, points: 50, reason: 'Great work' });
  const board = (await call(e2t, 'GET', '/people/rewards/leaderboard')).data;
  const me = board.find((b) => b.user.id === E2.id); const other = board.find((b) => b.user.id !== E2.id);
  ok(me && me.points === 150 && (!other || other.points === null), 'leaderboard shows only your own points', { me, other });
  ok((await call(admin, 'GET', '/people/rewards/leaderboard')).data.every((b) => typeof b.points === 'number'), 'admins see everyone’s points');
  for (let i = 0; i < 3; i++) await call(e2t, 'POST', '/people/rewards/kudos', { userId: E.id, points: 50, reason: 'Thanks' });
  const fourth = await call(e2t, 'POST', '/people/rewards/kudos', { userId: E.id, points: 10, reason: 'Thanks again' });
  ok(fourth.status === 429, 'kudos limited to 3 a day for non-managers');
  const ep = (await call(et, 'GET', '/people/rewards/me')).data;
  ok(ep.month === 30, 'non-managers give at most 10 points per kudos', ep.month);
  const wl = (await call(et, 'GET', '/people/workload')).data;
  ok(wl.people.length === 1 && wl.people[0].user.id === E.id, 'executive workload shows only themselves', wl.people.length);
  const wll = (await call(lt, 'GET', '/people/workload')).data;
  ok(wll.people.length === 2, 'lead workload shows them and their report', wll.people.map((p) => p.user.name));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
