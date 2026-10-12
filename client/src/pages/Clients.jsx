import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Plus, Building2, Phone, Mail, KeyRound, Inbox, Pencil, MessageCircle } from 'lucide-react';
import api from '../lib/api';
import useFetch from '../lib/useFetch';
import { useAuth, useLive } from '../context/AuthContext';
import { useProjects } from '../lib/directory';
import { OrbitRing, PageLoader, Empty, Modal, Field, ColorPicker, Avatar, UserPicker, Segmented } from '../components/ui';
import { PROJECT_STATUS, ago, PRIORITY } from '../lib/format';
import { useDirectory } from '../lib/directory';

function ClientForm({ open, onClose, client, onSaved }) {
  const [f, setF] = useState({});
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e?.target ? e.target.value : e }));
  useEffect(() => {
    if (open) setF(client || { name: '', company: '', email: '', phone: '', whatsapp: '', industry: '', city: '', notes: '', color: '#3DE0F2' });
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async (e) => {
    e.preventDefault();
    try {
      const { data } = client ? await api.patch(`/clients/${client.id}`, { name: f.name, company: f.company, email: f.email, phone: f.phone, whatsapp: f.whatsapp, industry: f.industry, city: f.city, status: f.status, notes: f.notes, color: f.color }) : await api.post('/clients', f);
      toast.success(client ? 'Client saved' : 'Client added'); onSaved?.(data); onClose();
    } catch (err) { toast.error(err.message); }
  };
  return (
    <Modal open={open} onClose={onClose} title={client ? 'Edit client' : 'New client'}
      footer={<><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button form="cf" className="btn-primary">{client ? 'Save client' : 'Add client'}</button></>}>
      <form id="cf" onSubmit={save} className="grid gap-4 sm:grid-cols-2">
        <Field label="Client / brand name"><input className="input" required value={f.name || ''} onChange={set('name')} /></Field>
        <Field label="Company"><input className="input" value={f.company || ''} onChange={set('company')} /></Field>
        <Field label="Email"><input type="email" className="input" value={f.email || ''} onChange={set('email')} /></Field>
        <Field label="Phone"><input className="input" value={f.phone || ''} onChange={set('phone')} /></Field>
        <Field label="WhatsApp for updates" hint="Gets request updates if the client has no portal login"><input className="input" value={f.whatsapp || ''} onChange={set('whatsapp')} /></Field>
        <Field label="Industry"><input className="input" value={f.industry || ''} onChange={set('industry')} placeholder="Healthcare, FMCG…" /></Field>
        <Field label="City"><input className="input" value={f.city || ''} onChange={set('city')} /></Field>
        <Field label="Status"><select className="input" value={f.status || 'active'} onChange={set('status')}><option value="active">Active</option><option value="paused">Paused</option><option value="archived">Archived</option></select></Field>
        <Field label="Notes" className="sm:col-span-2"><textarea className="input" value={f.notes || ''} onChange={set('notes')} /></Field>
        <Field label="Colour" className="sm:col-span-2"><ColorPicker value={f.color} onChange={set('color')} /></Field>
      </form>
    </Modal>
  );
}

export default function Clients() {
  const { can } = useAuth();
  const { data, loading, reload } = useFetch('/clients');
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between"><h1 className="text-2xl font-semibold">Clients</h1>{can('clients.manage') && <button type="button" className="btn-primary" onClick={() => setOpen(true)}><Plus size={16} />New client</button>}</div>
      {loading ? <PageLoader /> : !data.length ? <div className="panel"><Empty icon={Building2} title="No clients yet" body="Add a client, then give them a portal login so they can follow progress." /></div> : (
        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {data.map((c) => (
            <Link key={c.id} to={`/clients/${c.id}`} className="panel flex items-center gap-4 p-5 transition hover:border-cobalt/40">
              <OrbitRing value={c.progress} size={64} color={c.color} />
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-lg font-semibold">{c.name}</h3>
                <div className="text-xs text-muted">{[c.industry, c.city].filter(Boolean).join(', ') || 'Client'}</div>
                <div className="mt-2 flex gap-4 text-xs text-muted"><span>{c.activeProjects} active projects</span>{c.openRequests > 0 && <span className="text-amber">{c.openRequests} open requests</span>}</div>
              </div>
            </Link>
          ))}
        </div>
      )}
      <ClientForm open={open} onClose={() => setOpen(false)} onSaved={reload} />
    </div>
  );
}

function PortalLogin({ client, onSaved }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: '', email: '', password: '', phone: '' });
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  const save = async (e) => {
    e.preventDefault();
    try { await api.post(`/clients/${client.id}/portal-users`, f); toast.success('Portal login created. Share the email and password with your client.'); setOpen(false); setF({ name: '', email: '', password: '', phone: '' }); onSaved(); } catch (err) { toast.error(err.message); }
  };
  const toggle = async (u) => { await api.patch(`/clients/${client.id}/portal-users/${u.id}`, { isActive: !u.isActive }); onSaved(); };
  return (
    <section className="panel p-5">
      <div className="mb-3 flex items-center justify-between"><h2 className="flex items-center gap-2 font-semibold"><KeyRound size={16} className="text-cobalt" />Portal logins</h2><button type="button" className="btn-ghost btn-sm" onClick={() => setOpen(true)}><Plus size={13} />Add login</button></div>
      <ul className="divide-y divide-line/60">
        {client.portalUsers.map((u) => (
          <li key={u.id} className="flex items-center gap-3 py-2.5 text-sm">
            <Avatar user={{ ...u, color: client.color }} size={28} />
            <div className="min-w-0 flex-1"><div className="truncate font-medium">{u.name}</div><div className="truncate text-xs text-muted">{u.email}{u.lastSeenAt ? `, seen ${ago(u.lastSeenAt)}` : ', never signed in'}</div></div>
            <button type="button" onClick={() => toggle(u)} className={`btn-sm ${u.isActive ? 'btn-ghost' : 'btn-danger'}`}>{u.isActive ? 'Active' : 'Disabled'}</button>
          </li>
        ))}
        {!client.portalUsers.length && <li className="py-3 text-sm text-muted">No logins yet. Add one so the client can see progress and approve work.</li>}
      </ul>
      <Modal open={open} onClose={() => setOpen(false)} title={`Portal login for ${client.name}`} width="max-w-md"
        footer={<><button type="button" className="btn-ghost" onClick={() => setOpen(false)}>Cancel</button><button form="pl" className="btn-primary">Create login</button></>}>
        <form id="pl" onSubmit={save} className="space-y-3">
          <Field label="Name"><input className="input" required value={f.name} onChange={set('name')} /></Field>
          <Field label="Email"><input type="email" className="input" required value={f.email} onChange={set('email')} /></Field>
          <Field label="WhatsApp" hint="Gets progress updates and approvals on WhatsApp"><input className="input" value={f.phone} onChange={set('phone')} /></Field>
          <Field label="Password" hint="At least 8 characters"><input className="input" required minLength={8} value={f.password} onChange={set('password')} /></Field>
        </form>
      </Modal>
    </section>
  );
}

export function ClientDetail() {
  const { id } = useParams();
  const { can } = useAuth();
  const { data: c, loading, reload } = useFetch(`/clients/${id}`);
  const [edit, setEdit] = useState(false);
  useLive(['request:changed', 'project:changed'], reload, [id]);
  if (loading || !c) return <PageLoader />;
  return (
    <div className="space-y-5">
      <section className="panel flex flex-wrap items-center gap-5 p-6">
        <span className="grid h-16 w-16 place-items-center rounded-2xl font-display text-2xl font-semibold text-white" style={{ background: c.color }}>{c.name[0]}</span>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold">{c.name}</h1>
          <div className="mt-1 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted">
            {c.company && <span>{c.company}</span>}{c.industry && <span>{c.industry}</span>}
            {c.email && <span className="inline-flex items-center gap-1"><Mail size={13} />{c.email}</span>}
            {c.phone && <span className="inline-flex items-center gap-1"><Phone size={13} />{c.phone}</span>}
            {c.whatsapp && <span className="inline-flex items-center gap-1 text-leaf"><MessageCircle size={13} />{c.whatsapp}</span>}
          </div>
          {c.notes && <p className="mt-2 max-w-2xl text-sm text-muted">{c.notes}</p>}
        </div>
        {can('clients.manage') && <button type="button" className="btn-ghost" onClick={() => setEdit(true)}><Pencil size={15} />Edit</button>}
      </section>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <section className="panel p-5">
          <h2 className="mb-4 font-semibold">Projects</h2>
          <div className="space-y-3">
            {c.Projects.map((p) => (
              <Link key={p.id} to={`/projects/${p.id}`} className="flex items-center gap-4 rounded-xl border border-line bg-sunken/50 p-3 hover:border-cobalt/40">
                <OrbitRing value={p.progress} size={50} color={p.color} />
                <div className="flex-1"><div className="font-medium">{p.name}</div><div className="text-xs text-muted">{PROJECT_STATUS[p.status]}, lead {p.owner?.name || '—'}</div></div>
              </Link>
            ))}
            {!c.Projects.length && <p className="text-sm text-muted">No projects for this client yet.</p>}
          </div>
        </section>
        <div className="space-y-5">
          {can('clients.manage') && <PortalLogin client={c} onSaved={reload} />}
          <section className="panel p-5">
            <h2 className="mb-3 flex items-center gap-2 font-semibold"><Inbox size={16} className="text-amber" />Requests</h2>
            <ul className="space-y-2 text-sm">
              {c.requests.map((r) => <li key={r.id} className="flex items-center justify-between gap-3"><span className="truncate">{r.title}</span><span className="text-xs text-muted">{r.status}</span></li>)}
              {!c.requests.length && <li className="text-muted">No requests yet.</li>}
            </ul>
            <Link to="/requests" className="link mt-3 inline-block text-sm">Open the request inbox</Link>
          </section>
        </div>
      </div>
      <ClientForm open={edit} onClose={() => setEdit(false)} client={c} onSaved={reload} />
    </div>
  );
}

export function Requests() {
  const [status, setStatus] = useState('open');
  const { data, loading, reload } = useFetch(`/clients/requests/all${status ? `?status=${status}` : ''}`);
  const projects = useProjects();
  const people = useDirectory();
  const [active, setActive] = useState(null);
  const [form, setForm] = useState({ projectId: '', assigneeIds: [], dueDate: '', response: '' });
  useLive('request:changed', reload, [status]);
  const act = async (r, body) => {
    try { await api.patch(`/clients/requests/${r.id}`, body); toast.success('Request updated, client notified'); setActive(null); reload(); } catch (e) { toast.error(e.message); }
  };
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="text-2xl font-semibold">Client requests</h1><p className="text-sm text-muted">Things clients asked for from their portal. Turn them into tasks or reply.</p></div>
        <Segmented value={status} onChange={setStatus} options={[{ value: 'open', label: 'Open' }, { value: 'accepted', label: 'Accepted' }, { value: 'declined', label: 'Declined' }, { value: '', label: 'All' }]} />
      </div>
      {loading ? <PageLoader /> : !data.length ? <div className="panel"><Empty icon={Inbox} title="Inbox zero" body="New client requests appear here and notify the project lead." /></div> : (
        <div className="space-y-3">
          {data.map((r) => (
            <div key={r.id} className="panel flex flex-wrap items-start gap-4 p-4">
              <span className="mt-1 h-2.5 w-2.5 rounded-full" style={{ background: r.Client?.color }} />
              <div className="min-w-0 flex-1">
                <div className="font-semibold">{r.title}</div>
                <div className="text-xs text-muted">{r.Client?.name}{r.Project ? `, ${r.Project.name}` : ''} — {r.requester?.name || 'Client'}, {ago(r.createdAt)} — <span style={{ color: PRIORITY[r.priority]?.color }}>{PRIORITY[r.priority]?.label}</span></div>
                {r.description && <p className="mt-2 text-sm text-ink/85">{r.description}</p>}
                {r.response && <p className="mt-2 text-sm text-muted">Reply: {r.response}</p>}
                {r.Task && <Link to={`/tasks/${r.Task.id}`} className="link mt-2 inline-block text-sm">Task {r.Task.key}</Link>}
              </div>
              {r.status === 'open' && (
                <div className="flex gap-2">
                  <button type="button" className="btn-ghost btn-sm" onClick={() => { const resp = window.prompt('Reason for declining (sent to the client):'); if (resp !== null) act(r, { status: 'declined', response: resp }); }}>Decline</button>
                  <button type="button" className="btn-primary btn-sm" onClick={() => { setActive(r); setForm({ projectId: r.Project?.id || '', assigneeIds: [], dueDate: '', response: '' }); }}>Make it a task</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <Modal open={!!active} onClose={() => setActive(null)} title="Turn request into a task" width="max-w-md"
        footer={<><button type="button" className="btn-ghost" onClick={() => setActive(null)}>Cancel</button><button type="button" className="btn-primary" onClick={() => act(active, { convert: true, ...form, dueDate: form.dueDate ? new Date(form.dueDate).toISOString() : null })}>Create task</button></>}>
        <div className="space-y-3">
          <Field label="Project"><select className="input" value={form.projectId} onChange={(e) => setForm((s) => ({ ...s, projectId: e.target.value }))}><option value="">Pick a project</option>{projects.filter((p) => !active || p.Client?.id === active.Client?.id || !p.Client).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
          <Field label="Assign to"><UserPicker users={people} value={form.assigneeIds} onChange={(v) => setForm((s) => ({ ...s, assigneeIds: v }))} /></Field>
          <Field label="Due"><input type="datetime-local" className="input" value={form.dueDate} onChange={(e) => setForm((s) => ({ ...s, dueDate: e.target.value }))} /></Field>
          <Field label="Reply to client (optional)"><textarea className="input" value={form.response} onChange={(e) => setForm((s) => ({ ...s, response: e.target.value }))} placeholder="Got it, we'll have this ready by Friday." /></Field>
        </div>
      </Modal>
    </div>
  );
}
