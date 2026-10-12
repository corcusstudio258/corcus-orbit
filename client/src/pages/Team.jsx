import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Plus, Network, LayoutGrid, Pencil, MessageCircle, Mail, Send, Copy, KeyRound, Clock3 } from 'lucide-react';
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
        <Field label={person ? 'New password' : 'Password'} hint={person ? 'Leave blank to keep the current one' : 'At least 8 characters'}><div className="flex gap-2"><input className="input font-mono" required={!person} minLength={8} value={f.password} onChange={set('password')} /><button type="button" className="btn-ghost shrink-0" onClick={() => { const c = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'; const a = new Uint32Array(10); crypto.getRandomValues(a); setF((s) => ({ ...s, password: `${[...a].map((n) => c[n % c.length]).join('')}@${10 + (a[0] % 90)}` })); }}>Generate</button></div></Field>
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

const VIA = { firebase: 'Firebase email', email: 'email', whatsapp: 'WhatsApp' };
function SentResult({ result, name, onClose }) {
  if (!result) return null;
  const share = () => { navigator.clipboard?.writeText(result.link); toast.success('Link copied'); };
  return (
    <Modal open onClose={onClose} title={result.via.length ? 'Invite sent' : 'Share the link yourself'} width="max-w-md" footer={<button type="button" className="btn-primary" onClick={onClose}>Done</button>}>
      <div className="space-y-3 text-sm">
        {result.via.length ? <p>{name} got the link by {result.via.map((v) => VIA[v]).join(' and ')}.</p> : <p>Email and WhatsApp aren't set up yet, so send {name} this link yourself. It works once.</p>}
        {result.errors?.length > 0 && <p className="rounded-xl bg-amber/10 px-3 py-2 text-xs text-amber">{result.errors.join(' ')}</p>}
        <div className="flex gap-2"><input readOnly className="input font-mono text-xs" value={result.link} onFocus={(e) => e.target.select()} /><button type="button" className="btn-ghost shrink-0" onClick={share}><Copy size={14} />Copy</button></div>
        <a className="btn-ghost w-full" target="_blank" rel="noreferrer" href={`https://wa.me/?text=${encodeURIComponent(`Join us on Orbit: ${result.link}`)}`}><MessageCircle size={14} />Share on WhatsApp</a>
      </div>
    </Modal>
  );
}

function InviteForm({ open, onClose, roles, people, onSaved }) {
  const { user } = useAuth();
  const blank = { name: '', email: '', phone: '', designation: '', roleId: '', reportsToId: null };
  const [f, setF] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  useEffect(() => { if (open) setF(blank); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e?.target ? e.target.value : e }));
  const assignable = roles.filter((r) => !r.isClientRole && (user.Role.level <= 1 || r.level > user.Role.level));
  const send = async (e) => {
    e.preventDefault(); setBusy(true);
    try { const { data } = await api.post('/users/invite', { ...f, roleId: Number(f.roleId) }); invalidate('people'); onSaved(); onClose(); setResult({ ...data, name: f.name }); } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };
  return (
    <>
      <Modal open={open} onClose={onClose} title="Invite by email" subtitle="They get a link to set their own password. Sent through Firebase or your email, plus WhatsApp if you add a number."
        footer={<><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button form="inv" className="btn-primary" disabled={busy}><Send size={14} />{busy ? 'Sending' : 'Send invite'}</button></>}>
        <form id="inv" onSubmit={send} className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name"><input className="input" required value={f.name} onChange={set('name')} /></Field>
          <Field label="Email"><input type="email" className="input" required value={f.email} onChange={set('email')} /></Field>
          <Field label="WhatsApp number" hint="Optional. The invite goes here too."><input className="input" value={f.phone} onChange={set('phone')} placeholder="91 98765 43210" /></Field>
          <Field label="Designation"><input className="input" value={f.designation} onChange={set('designation')} placeholder="Video editor" /></Field>
          <Field label="Role"><select className="input" required value={f.roleId} onChange={set('roleId')}><option value="">Pick a role</option>{assignable.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
          <Field label="Reports to"><UserPicker multiple={false} users={people} value={f.reportsToId} onChange={set('reportsToId')} placeholder="Nobody (top level)" /></Field>
        </form>
      </Modal>
      <SentResult result={result} name={result?.name} onClose={() => setResult(null)} />
    </>
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
  const [invite, setInvite] = useState(false);
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
          {can('users.manage') && <button type="button" className="btn-ghost" onClick={() => setForm({ open: true, person: null })}><Plus size={16} />Add with password</button>}
          {can('users.invite', 'users.manage') && <button type="button" className="btn-primary" onClick={() => setInvite(true)}><Mail size={16} />Invite by email</button>}
        </div>
      </div>
      {view === 'org' ? (
        <section className="panel overflow-x-auto p-5"><ul className="space-y-3">{roots.map((r) => <OrgNode key={r.id} person={r} byManager={byManager} onOpen={(p) => nav(`/team/${p.id}`)} />)}</ul></section>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {data.map((u) => (
            <button type="button" key={u.id} onClick={() => nav(`/team/${u.id}`)} className={`panel p-5 text-left transition hover:border-cobalt/40 ${!u.isActive && !String(u.invitePurpose || '').startsWith('invite') ? 'opacity-50' : ''}`}>
              <div className="flex items-center gap-3">
                <Avatar user={u} size={44} online={u.online} />
                <div className="min-w-0"><div className="truncate font-semibold">{u.name}</div><div className="truncate text-xs text-muted">{u.designation || '—'}</div></div>
              </div>
              <div className="mt-4 flex items-center justify-between text-xs">
                <span className="chip" style={{ color: u.Role?.color, background: `${u.Role?.color}1A` }}>{u.Role?.name}</span>
                <span className="text-muted">{u.load.open} open{u.load.overdue ? <span className="text-ember">, {u.load.overdue} late</span> : ''}</span>
              </div>
              <div className="mt-2 truncate text-[11px] text-muted">{u.manager ? `Reports to ${u.manager.name}` : 'Top level'}{!u.isActive && !String(u.invitePurpose || '').startsWith('invite') && ', deactivated'}</div>
              {String(u.invitePurpose || '').startsWith('invite') && <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-amber/10 px-2 py-0.5 text-[11px] font-semibold text-amber"><Clock3 size={11} />Invite pending</span>}
            </button>
          ))}
        </div>
      )}
      <PersonForm open={form.open} onClose={() => setForm({ open: false, person: null })} person={form.person} roles={roles} people={active} onSaved={reload} />
      <InviteForm open={invite} onClose={() => setInvite(false)} roles={roles} people={active} onSaved={reload} />
    </div>
  );
}

function PersonPage({ id, form, setForm, roles, people, reload }) {
  const { can } = useAuth();
  const { data: u, loading, reload: r2 } = useFetch(`/users/${id}`);
  const [result, setResult] = useState(null);
  if (loading || !u) return <PageLoader />;
  const pending = String(u.invitePurpose || '').startsWith('invite');
  const sendLink = async (kind) => { try { const { data } = await api.post(`/users/${u.id}/${kind === 'invite' ? 'invite' : 'reset-link'}`); setResult(data); r2(); } catch (err) { toast.error(err.message); } };
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
        <div className="flex flex-wrap gap-2">
          {pending && can('users.invite', 'users.manage') && <button type="button" className="btn-primary" onClick={() => sendLink('invite')}><Send size={15} />Resend invite</button>}
          {!pending && can('users.manage') && <button type="button" className="btn-ghost" onClick={() => sendLink('reset')}><KeyRound size={15} />Send password reset</button>}
          {can('users.manage') && <button type="button" className="btn-ghost" onClick={() => setForm({ open: true, person: u })}><Pencil size={15} />Edit</button>}
        </div>
      </section>
      {pending && <p className="rounded-xl bg-amber/10 px-4 py-2.5 text-sm text-amber">Invited {u.invitedAt ? ago(u.invitedAt) : ''}. {u.name.split(' ')[0]} hasn't set a password yet.</p>}
      <SentResult result={result} name={u.name} onClose={() => setResult(null)} />
      <h2 className="text-lg font-semibold">Their tasks</h2>
      <TaskExplorer fixed={{ assignee: u.id }} storageKey="person" />
      <PersonForm open={form.open} onClose={() => setForm({ open: false, person: null })} person={form.person} roles={roles} people={people} onSaved={() => { reload(); r2(); }} />
    </div>
  );
}
