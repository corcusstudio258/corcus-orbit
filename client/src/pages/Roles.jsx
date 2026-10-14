import { Fragment, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import { Plus, ShieldCheck, Copy, Trash2, Lock, Check, Minus, Users, Eye, Layers, Table2, Search, UserCheck, MessageCircle, BellRing } from 'lucide-react';
import api from '../lib/api';
import useFetch from '../lib/useFetch';
import { useAuth } from '../context/AuthContext';
import { PageHeader, PageLoader, Field, ColorPicker, Segmented, Avatar, confirm, Empty, UserPicker, Spinner } from '../components/ui';
import { useDirectory, useProjects } from '../lib/directory';

const GROUP_ORDER = ['Visibility', 'Tasks', 'Projects', 'Clients', 'People', 'Workspace'];

function summary(perms) {
  const has = (k) => perms.includes(k);
  return [
    has('tasks.view_all') ? 'Sees every task' : 'Sees own tasks and their reports’ tasks',
    has('projects.view_all') ? 'all projects' : 'only projects they are on',
    has('projects.manage') ? 'runs projects' : null,
    has('tasks.approve') ? 'approves work' : null,
    has('clients.manage') ? 'manages clients' : has('clients.view') ? 'sees clients' : null,
    has('users.manage') ? 'manages people' : has('users.invite') ? 'invites people' : null,
    has('settings.manage') ? 'controls settings' : null,
  ].filter(Boolean).join(', ');
}

function Editor({ role, perms, onSaved, onDelete, onDuplicate, myLevel, isTop }) {
  const [f, setF] = useState(role);
  const [q, setQ] = useState('');
  const { data: users } = useFetch(role.id ? '/users?active=all' : null, [role.id]);
  useEffect(() => setF(role), [role]);
  const locked = role.isSystem && role.slug === 'admin';
  const cosmeticOnly = role.isSystem;
  const below = isTop || !role.id || role.level > myLevel;
  const groups = GROUP_ORDER.map((g) => ({ g, items: perms.filter((p) => p.group === g && (!q || `${p.label} ${p.hint}`.toLowerCase().includes(q.toLowerCase()))) })).filter((x) => x.items.length);
  const toggle = (k) => setF((s) => ({ ...s, permissions: s.permissions.includes(k) ? s.permissions.filter((x) => x !== k) : [...s.permissions, k] }));
  const setGroup = (items, on) => setF((s) => ({ ...s, permissions: on ? [...new Set([...s.permissions, ...items.map((i) => i.key)])] : s.permissions.filter((k) => !items.some((i) => i.key === k)) }));
  const dirty = JSON.stringify(f) !== JSON.stringify(role);
  const save = async () => {
    try {
      const body = { name: f.name, description: f.description, level: Number(f.level), color: f.color, permissions: f.permissions };
      const { data } = role.id ? await api.patch(`/roles/${role.id}`, body) : await api.post('/roles', body);
      toast.success('Role saved'); onSaved(data);
    } catch (err) { toast.error(err.message); }
  };
  const members = (users || []).filter((u) => u.roleId === role.id);

  return (
    <div className="space-y-5">
      <section className="panel p-5">
        <div className="flex flex-wrap items-start gap-4">
          <span className="grid h-12 w-12 place-items-center rounded-2xl font-display text-lg font-bold text-white" style={{ background: f.color }}>{f.level}</span>
          <div className="min-w-0 flex-1">
            <input className="w-full bg-transparent font-display text-2xl font-semibold outline-none disabled:opacity-100" value={f.name} disabled={cosmeticOnly || !below} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Role name" />
            <input className="mt-1 w-full bg-transparent text-sm text-muted outline-none" value={f.description || ''} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="What this role is for" disabled={!below} />
            <p className="mt-2 text-xs text-muted">{summary(f.permissions)}.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {role.id && !role.isClientRole && <button type="button" className="btn-ghost btn-sm" onClick={() => onDuplicate(f)}><Copy size={13} />Duplicate</button>}
            {role.id && !role.isSystem && below && <button type="button" className="btn-ghost btn-sm text-ember" onClick={() => onDelete(role)}><Trash2 size={13} />Delete</button>}
          </div>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-[160px_1fr]">
          <Field label="Level" hint="1 is the top. People can only manage roles below their own level.">
            <input type="number" min={isTop ? 1 : myLevel + 1} max={98} className="input" value={f.level} disabled={cosmeticOnly || !below} onChange={(e) => setF({ ...f, level: e.target.value })} />
          </Field>
          <Field label="Colour"><ColorPicker value={f.color} onChange={(c) => setF({ ...f, color: c })} /></Field>
        </div>
      </section>

      {role.isClientRole ? (
        <section className="panel p-5 text-sm text-muted"><Lock size={15} className="mb-2 text-faint" />Client logins only see the client portal: their own projects, tasks the team shares with them, files to review and their requests. There is nothing to switch on here.</section>
      ) : (
        <section className="panel p-5">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <h2 className="section-title">What people in this role can do</h2>
            <span className="text-xs text-muted">{f.permissions.length} of {perms.length} on</span>
            <div className="relative ml-auto w-full sm:w-56"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" /><input className="input !py-1.5 pl-8 text-sm" placeholder="Find a permission" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          </div>
          {locked && <p className="mb-4 flex items-center gap-2 rounded-xl bg-sunken px-3 py-2 text-xs text-muted"><Lock size={13} />Admin always has every permission.</p>}
          <div className="space-y-5">
            {groups.map(({ g, items }) => {
              const onCount = items.filter((i) => f.permissions.includes(i.key)).length;
              return (
                <div key={g}>
                  <div className="mb-2 flex items-center gap-2">
                    <h3 className="text-sm font-semibold">{g}</h3><span className="text-xs text-faint">{onCount}/{items.length}</span>
                    {!locked && below && <div className="ml-auto flex gap-1 text-xs"><button type="button" className="rounded-md px-2 py-0.5 font-semibold text-muted hover:bg-sunken hover:text-ink" onClick={() => setGroup(items, true)}>All</button><button type="button" className="rounded-md px-2 py-0.5 font-semibold text-muted hover:bg-sunken hover:text-ink" onClick={() => setGroup(items, false)}>None</button></div>}
                  </div>
                  <div className="grid gap-2 md:grid-cols-2">
                    {items.map((p) => {
                      const on = f.permissions.includes(p.key);
                      return (
                        <button key={p.key} type="button" disabled={locked || !below} onClick={() => toggle(p.key)}
                          className={clsx('flex items-start gap-3 rounded-xl border p-3 text-left transition disabled:cursor-not-allowed', on ? 'border-ink/20 bg-brand-soft/40' : 'border-line hover:border-faint')}>
                          <span className={clsx('mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border-2 transition', on ? 'border-ink bg-ink text-brand' : 'border-line')}>{on && <Check size={12} strokeWidth={3} />}</span>
                          <span className="min-w-0"><span className="block text-sm font-semibold">{p.label}</span><span className="block text-xs text-muted">{p.hint}</span></span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {role.id && (
        <section className="panel p-5">
          <h2 className="section-title mb-3 flex items-center gap-2"><Users size={15} className="text-muted" />People in this role <span className="text-sm font-normal text-muted">{members.length}</span></h2>
          {members.length ? <div className="flex flex-wrap gap-2">{members.map((u) => <span key={u.id} className={clsx('inline-flex items-center gap-2 rounded-full border border-line py-1 pl-1 pr-3 text-sm', !u.isActive && 'opacity-50')}><Avatar user={u} size={22} />{u.name}</span>)}</div> : <p className="text-sm text-muted">Nobody yet.</p>}
        </section>
      )}

      {(dirty || !role.id) && below && (
        <div className="sticky bottom-4 z-20 flex justify-end">
          <div className="flex items-center gap-2 rounded-2xl bg-night px-3 py-2 shadow-pop">
            <span className="px-2 text-sm text-white/80">{role.id ? 'Unsaved changes' : 'New role'}</span>
            {role.id && <button type="button" className="rounded-lg px-3 py-1.5 text-sm text-white/80 hover:bg-white/10" onClick={() => setF(role)}>Discard</button>}
            <button type="button" className="btn-primary btn-sm" onClick={save}>Save role</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Matrix({ roles, perms }) {
  const staff = roles.filter((r) => !r.isClientRole);
  return (
    <div className="panel overflow-x-auto">
      <table className="w-full min-w-[720px] text-sm">
        <thead><tr className="border-b border-line">
          <th className="sticky left-0 bg-surface px-4 py-3 text-left text-xs font-semibold text-muted">Permission</th>
          {staff.map((r) => <th key={r.id} className="px-3 py-3 text-center"><span className="inline-flex items-center gap-1.5 text-xs font-semibold"><span className="h-2.5 w-2.5 rounded-full" style={{ background: r.color }} />{r.name}</span></th>)}
        </tr></thead>
        <tbody>
          {GROUP_ORDER.map((g) => (
            <Fragment key={g}>
              <tr className="bg-sunken/60"><td colSpan={staff.length + 1} className="sticky left-0 px-4 py-1.5 text-xs font-semibold text-muted">{g}</td></tr>
              {perms.filter((p) => p.group === g).map((p) => (
                <tr key={p.key} className="border-b border-line/60">
                  <td className="sticky left-0 bg-surface px-4 py-2" title={p.hint}>{p.label}</td>
                  {staff.map((r) => <td key={r.id} className="px-3 py-2 text-center">{r.permissions.includes(p.key) ? <Check size={16} className="mx-auto text-leaf" strokeWidth={3} /> : <Minus size={14} className="mx-auto text-line" />}</td>)}
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Workspace reviewers: people from any role who are added as reviewer on every task (or chosen projects). */
function Reviewers() {
  const { data, reload } = useFetch('/roles/reviewers');
  const people = useDirectory();
  const projects = useProjects();
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (data && !f) setF({ userIds: data.userIds, scope: data.projectIds.length ? 'some' : 'all', projectIds: data.projectIds }); }, [data]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!f) return <PageLoader />;
  const save = async () => {
    if (f.scope === 'some' && !f.projectIds.length) { toast.error('Pick at least one project, or choose every project.'); return; }
    setBusy(true);
    try {
      const { data: r } = await api.put('/roles/reviewers', { userIds: f.userIds, projectIds: f.scope === 'some' ? f.projectIds : [] });
      toast.success(r.userIds.length ? `Saved. ${r.added ? `Added to ${r.added} open task${r.added > 1 ? 's' : ''}` : 'Open tasks already up to date'}${r.removed ? `, removed from ${r.removed}` : ''}.` : `Reviewers cleared${r.removed ? ` from ${r.removed} open tasks` : ''}.`);
      reload();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  const chosen = people.filter((p) => f.userIds.includes(p.id));
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
      <section className="panel space-y-5 p-5">
        <div>
          <h2 className="flex items-center gap-2 font-semibold"><UserCheck size={18} className="text-violet" />Reviewers</h2>
          <p className="mt-1 text-sm text-muted">Pick people from any role. They keep their own role and are added as reviewer on tasks automatically, so their names show on each task.</p>
        </div>
        <Field label="Reviewers" hint="You can pick more than one. Anyone on the team can be a reviewer.">
          <UserPicker users={people} value={f.userIds} onChange={(ids) => setF((s) => ({ ...s, userIds: ids }))} placeholder="Pick reviewers" />
        </Field>
        {chosen.length > 0 && (
          <ul className="flex flex-wrap gap-2">{chosen.map((u) => <li key={u.id} className="inline-flex items-center gap-2 rounded-full border border-line py-1 pl-1 pr-3 text-sm"><Avatar user={u} size={22} />{u.name}<span className="text-xs text-muted">{u.Role?.name || u.designation}</span></li>)}</ul>
        )}
        <Field label="Review tasks in">
          <Segmented value={f.scope} onChange={(v) => setF((s) => ({ ...s, scope: v }))} options={[{ value: 'all', label: 'Every project' }, { value: 'some', label: 'Chosen projects' }]} />
        </Field>
        {f.scope === 'some' && (
          <div className="grid max-h-64 gap-1.5 overflow-y-auto rounded-xl border border-line p-2 sm:grid-cols-2">
            {projects.filter((p) => p.status !== 'archived').map((p) => (
              <label key={p.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-sunken">
                <input type="checkbox" className="h-4 w-4 accent-[#0F1535]" checked={f.projectIds.includes(p.id)} onChange={() => setF((s) => ({ ...s, projectIds: s.projectIds.includes(p.id) ? s.projectIds.filter((x) => x !== p.id) : [...s.projectIds, p.id] }))} />
                <span className="h-2 w-2 rounded-full" style={{ background: p.color }} /><span className="truncate">{p.name}</span>
              </label>
            ))}
          </div>
        )}
        <button type="button" className="btn-primary" disabled={busy} onClick={save}>{busy && <Spinner size={14} className="text-ink" />}Save and update tasks</button>
      </section>
      <aside className="panel space-y-3 self-start p-5 text-sm">
        <h3 className="font-semibold">What reviewers get</h3>
        <p className="flex gap-2"><Check size={15} className="mt-0.5 shrink-0 text-leaf" />Added to every open task in scope, and to new tasks as they are created.</p>
        <p className="flex gap-2"><Check size={15} className="mt-0.5 shrink-0 text-leaf" />When a task is marked done it goes to review, and they approve it or send it back.</p>
        <p className="flex gap-2"><MessageCircle size={15} className="mt-0.5 shrink-0 text-leaf" />A WhatsApp message when a task needs their review (if their number is saved and WhatsApp alerts are on).</p>
        <p className="flex gap-2"><BellRing size={15} className="mt-0.5 shrink-0 text-leaf" />A browser notification too, once they turn it on in Settings.</p>
        <p className="text-xs text-muted">Removing someone here takes them off open tasks they were added to automatically. Finished tasks keep their history.</p>
      </aside>
    </div>
  );
}

export default function Roles() {
  const { user } = useAuth();
  const { data: roles, reload } = useFetch('/roles');
  const { data: perms } = useFetch('/auth/permissions');
  const [sel, setSel] = useState(null);
  const [draft, setDraft] = useState(null);
  const [view, setView] = useState('edit');
  const myLevel = user.Role?.level ?? 99;
  const isTop = myLevel <= 1;
  useEffect(() => { if (roles && !sel && !draft) setSel(roles.find((r) => r.slug === 'manager')?.id || roles[0]?.id); }, [roles]); // eslint-disable-line react-hooks/exhaustive-deps
  const current = useMemo(() => draft || roles?.find((r) => r.id === sel), [draft, roles, sel]);
  if (!roles || !perms) return <PageLoader />;

  const newRole = (base) => { setDraft({ name: base ? `${base.name} copy` : 'New role', description: base?.description || '', level: Math.max(myLevel + 1, base?.level || 5), color: base?.color || '#0EA5B7', permissions: base ? [...base.permissions] : ['tasks.create', 'users.view', 'ai.use'] }); setView('edit'); };
  const remove = async (r) => {
    if (!(await confirm({ title: `Delete the ${r.name} role?`, body: 'Move its people to another role first.', danger: true, confirmLabel: 'Delete role' }))) return;
    try { await api.delete(`/roles/${r.id}`); setSel(null); reload(); } catch (err) { toast.error(err.message); }
  };

  return (
    <div>
      <PageHeader title="Roles & access" subtitle="Who can see and do what. Levels set the reporting ladder: people manage only the roles below them."
        actions={<><Segmented value={view} onChange={setView} options={[{ value: 'edit', label: 'Roles', icon: Layers }, { value: 'matrix', label: 'Compare', icon: Table2 }, { value: 'reviewers', label: 'Reviewers', icon: UserCheck }]} /><button type="button" className="btn-primary" onClick={() => newRole()}><Plus size={16} />New role</button></>} />
      {view === 'reviewers' ? <Reviewers /> : view === 'matrix' ? <Matrix roles={roles} perms={perms} /> : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
          <aside className="space-y-2">
            <p className="px-1 text-xs font-semibold text-muted">Top of the ladder</p>
            <ol className="relative space-y-2 before:absolute before:bottom-6 before:left-[22px] before:top-6 before:w-0.5 before:bg-line">
              {roles.map((r) => (
                <li key={r.id}>
                  <button type="button" onClick={() => { setDraft(null); setSel(r.id); }} className={clsx('relative flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition', !draft && sel === r.id ? 'border-ink bg-surface shadow-lift' : 'border-line bg-surface hover:border-faint')}>
                    <span className="relative grid h-7 w-7 shrink-0 place-items-center rounded-lg font-display text-xs font-bold text-white" style={{ background: r.color }}>{r.isClientRole ? <Eye size={13} /> : r.level}</span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5 text-sm font-semibold">{r.name}{r.isSystem && <Lock size={11} className="text-faint" />}</span>
                      <span className="block truncate text-xs text-muted">{r.isClientRole ? 'Client portal only' : `${r.permissions.length} permissions`}</span>
                    </span>
                    <span className="chip bg-sunken text-muted"><Users size={10} />{r.userCount}</span>
                  </button>
                </li>
              ))}
              {draft && <li><div className="flex items-center gap-3 rounded-2xl border-2 border-dashed border-ink p-3 text-sm font-semibold"><ShieldCheck size={16} />{draft.name}</div></li>}
            </ol>
            <p className="px-1 text-xs text-muted">Bottom of the ladder</p>
            <button type="button" onClick={() => setView('reviewers')} className="mt-3 flex w-full items-center gap-3 rounded-2xl border border-dashed border-violet/50 bg-violet/5 p-3 text-left transition hover:border-violet">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-violet text-white"><UserCheck size={14} /></span>
              <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">Reviewers</span><span className="block truncate text-xs text-muted">On top of any role. Added to tasks automatically.</span></span>
            </button>
          </aside>
          {current ? (
            <Editor key={current.id || 'new'} role={current} perms={perms} myLevel={myLevel} isTop={isTop}
              onSaved={(r) => { setDraft(null); setSel(r.id); reload(); }} onDelete={remove} onDuplicate={(r) => newRole(r)} />
          ) : <div className="panel"><Empty icon={ShieldCheck} title="Pick a role" /></div>}
        </div>
      )}
    </div>
  );
}
