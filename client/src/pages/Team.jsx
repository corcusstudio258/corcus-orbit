import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Plus, Network, LayoutGrid, Pencil, MessageCircle } from 'lucide-react';
import api from '../lib/api';
import useFetch from '../lib/useFetch';
import { useAuth } from '../context/AuthContext';
import { invalidate } from '../lib/directory';
import { Avatar, PageLoader, Modal, Field, ColorPicker, Segmented, UserPicker, Toggle } from '../components/ui';
import { minutes, ago } from '../lib/format';
import TaskExplorer from '../components/TaskExplorer';

function PersonForm({ open, onClose, person, roles, people, onSaved }) {
  const { user } = useAuth();
  const blank = { name: '', email: '', password: '', phone: '', designation: '', department: '', roleId: '', reportsToId: null, color: '#3DE0F2', isActive: true };
  const [f, setF] = useState(blank);
  useEffect(() => { if (open) setF(person ? { ...blank, ...person, password: '' } : blank); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e?.target ? e.target.value : e }));
  const myLevel = user.Role.level;
  const assignable = roles.filter((r) => !r.isClientRole && (myLevel <= 1 || r.level > myLevel));
  const save = async (e) => {
    e.preventDefault();
    const body = { name: f.name, email: f.email, phone: f.phone, designation: f.designation, department: f.department, roleId: Number(f.roleId), reportsToId: f.reportsToId || null, color: f.color };
    if (f.password) body.password = f.password;
    if (person) body.isActive = f.isActive;
    try {
      person ? await api.patch(`/users/${person.id}`, body) : await api.post('/users', body);
      invalidate('people'); toast.success(person ? 'Saved' : `${f.name} added. Share their email and password with them.`); onSaved(); onClose();
    } catch (err) { toast.error(err.message); }
  };
  return (
    <Modal open={open} onClose={onClose} title={person ? `Edit ${person.name}` : 'Add team member'}
      footer={<><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button form="uf" className="btn-primary">{person ? 'Save' : 'Add person'}</button></>}>
      <form id="uf" onSubmit={save} className="grid gap-4 sm:grid-cols-2">
        <Field label="Full name"><input className="input" required value={f.name} onChange={set('name')} /></Field>
        <Field label="Email"><input type="email" className="input" required value={f.email} onChange={set('email')} /></Field>
        <Field label="WhatsApp number" hint="Task alerts go here. Include country code."><input className="input" value={f.phone || ''} onChange={set('phone')} placeholder="91 98765 43210" /></Field>
        <Field label={person ? 'New password' : 'Password'} hint={person ? 'Leave blank to keep the current one' : 'At least 8 characters'}><input className="input" required={!person} minLength={8} value={f.password} onChange={set('password')} /></Field>
        <Field label="Role">
          <select className="input" required value={f.roleId} onChange={set('roleId')}>
            <option value="">Pick a role</option>{assignable.map((r) => <option key={r.id} value={r.id}>{r.name} (level {r.level})</option>)}
          </select>
        </Field>
        <Field label="Reports to"><UserPicker multiple={false} users={people.filter((p) => p.id !== person?.id)} value={f.reportsToId} onChange={set('reportsToId')} placeholder="Nobody (top level)" /></Field>
        <Field label="Designation"><input className="input" value={f.designation || ''} onChange={set('designation')} placeholder="Graphic designer" /></Field>
        <Field label="Department"><input className="input" value={f.department || ''} onChange={set('department')} placeholder="Creative" /></Field>
        <Field label="Colour" className="sm:col-span-2"><ColorPicker value={f.color} onChange={set('color')} /></Field>
        {person && <div className="sm:col-span-2"><Toggle checked={f.isActive} onChange={set('isActive')} label="Active" hint="Deactivated people can't sign in. Their tasks stay." /></div>}
      </form>
    </Modal>
  );
}

function OrgNode({ person, byManager, onOpen }) {
  const kids = byManager[person.id] || [];
  return (
    <li className="relative">
      <button type="button" onClick={() => onOpen(person)} className="flex items-center gap-3 rounded-xl border border-line bg-surface px-3 py-2 text-left transition hover:border-cobalt/40">
        <Avatar user={person} size={30} online={person.online} />
        <span><span className="block text-sm font-semibold">{person.name}</span><span className="block text-[11px]" style={{ color: person.Role?.color }}>{person.Role?.name}<span className="text-muted">{person.designation ? `, ${person.designation}` : ''}</span></span></span>
        <span className="ml-3 text-xs text-muted">{person.load.open} open</span>
      </button>
      {kids.length > 0 && <ul className="ml-6 mt-2 space-y-2 border-l border-line pl-5">{kids.map((k) => <OrgNode key={k.id} person={k} byManager={byManager} onOpen={onOpen} />)}</ul>}
    </li>
  );
}

export default function Team() {
  const { can } = useAuth();
  const { id } = useParams();
  const nav = useNavigate();
  const { data, loading, reload } = useFetch('/users?active=all');
  const { data: roles } = useFetch('/roles');
  const [view, setView] = useState('grid');
  const [form, setForm] = useState({ open: false, person: null });
  if (loading || !data || !roles) return <PageLoader />;
  if (id) return <PersonPage id={id} onEdit={(p) => setForm({ open: true, person: p })} form={form} setForm={setForm} roles={roles} people={data} reload={reload} />;

  const active = data.filter((u) => u.isActive);
  const byManager = {};
  active.forEach((u) => { (byManager[u.reportsToId || 0] = byManager[u.reportsToId || 0] || []).push(u); });
  const roots = active.filter((u) => !u.reportsToId || !active.some((x) => x.id === u.reportsToId));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="text-2xl font-semibold">Team</h1><p className="text-sm text-muted">{active.length} people, {data.filter((u) => u.online).length} online now</p></div>
        <div className="flex items-center gap-2">
          <Segmented value={view} onChange={setView} options={[{ value: 'grid', label: 'People', icon: LayoutGrid }, { value: 'org', label: 'Reporting lines', icon: Network }]} />
          {can('users.manage') && <button type="button" className="btn-primary" onClick={() => setForm({ open: true, person: null })}><Plus size={16} />Add person</button>}
        </div>
      </div>
      {view === 'org' ? (
        <section className="panel overflow-x-auto p-5"><ul className="space-y-3">{roots.map((r) => <OrgNode key={r.id} person={r} byManager={byManager} onOpen={(p) => nav(`/team/${p.id}`)} />)}</ul></section>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {data.map((u) => (
            <button type="button" key={u.id} onClick={() => nav(`/team/${u.id}`)} className={`panel p-5 text-left transition hover:border-cobalt/40 ${!u.isActive ? 'opacity-50' : ''}`}>
              <div className="flex items-center gap-3">
                <Avatar user={u} size={44} online={u.online} />
                <div className="min-w-0"><div className="truncate font-semibold">{u.name}</div><div className="truncate text-xs text-muted">{u.designation || '—'}</div></div>
              </div>
              <div className="mt-4 flex items-center justify-between text-xs">
                <span className="chip" style={{ color: u.Role?.color, background: `${u.Role?.color}1A` }}>{u.Role?.name}</span>
                <span className="text-muted">{u.load.open} open{u.load.overdue ? <span className="text-ember">, {u.load.overdue} late</span> : ''}</span>
              </div>
              <div className="mt-2 truncate text-[11px] text-muted">{u.manager ? `Reports to ${u.manager.name}` : 'Top level'}{!u.isActive && ', deactivated'}</div>
            </button>
          ))}
        </div>
      )}
      <PersonForm open={form.open} onClose={() => setForm({ open: false, person: null })} person={form.person} roles={roles} people={active} onSaved={reload} />
    </div>
  );
}

function PersonPage({ id, form, setForm, roles, people, reload }) {
  const { can } = useAuth();
  const { data: u, loading, reload: r2 } = useFetch(`/users/${id}`);
  if (loading || !u) return <PageLoader />;
  return (
    <div className="space-y-5">
      <section className="panel flex flex-wrap items-center gap-5 p-6">
        <Avatar user={u} size={64} />
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold">{u.name}</h1>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
            <span style={{ color: u.Role?.color }}>{u.Role?.name}</span>{u.designation && <span>{u.designation}</span>}{u.department && <span>{u.department}</span>}
            {u.manager && <span>Reports to {u.manager.name}</span>}{u.phone && <span className="inline-flex items-center gap-1 text-leaf"><MessageCircle size={13} />{u.phone}</span>}
            {u.lastSeenAt && <span>Active {ago(u.lastSeenAt)}</span>}
          </div>
          {u.reports?.length > 0 && <div className="mt-2 text-xs text-muted">Leads {u.reports.map((r) => r.name).join(', ')}</div>}
        </div>
        <div className="flex gap-6 text-center">
          <div><div className="font-display text-2xl font-semibold">{u.stats.done30d}</div><div className="text-xs text-muted">done in 30 days</div></div>
          <div><div className="font-display text-2xl font-semibold">{minutes(u.stats.minutes30d)}</div><div className="text-xs text-muted">tracked in 30 days</div></div>
        </div>
        {can('users.manage') && <button type="button" className="btn-ghost" onClick={() => setForm({ open: true, person: u })}><Pencil size={15} />Edit</button>}
      </section>
      <h2 className="text-lg font-semibold">Their tasks</h2>
      <TaskExplorer fixed={{ assignee: u.id }} storageKey="person" />
      <PersonForm open={form.open} onClose={() => setForm({ open: false, person: null })} person={form.person} roles={roles} people={people} onSaved={() => { reload(); r2(); }} />
    </div>
  );
}
