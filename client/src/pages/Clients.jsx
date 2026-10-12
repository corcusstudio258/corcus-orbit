import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Plus, Building2, Phone, Mail, KeyRound, Inbox, Pencil, MessageCircle, CheckCircle2, Hourglass, Eye, EyeOff, Upload, Trash2, Download, FileText, ClipboardList } from 'lucide-react';
import api, { clientFileUrl } from '../lib/api';
import useFetch from '../lib/useFetch';
import { useAuth, useLive } from '../context/AuthContext';
import { useProjects } from '../lib/directory';
import { OrbitRing, PageLoader, Empty, Modal, Field, ColorPicker, Avatar, UserPicker, Segmented } from '../components/ui';
import { PROJECT_STATUS, ago, PRIORITY, bytes } from '../lib/format';
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

export function ClientLogo({ c, size = 64 }) {
  if (c.logo) return <span className="grid shrink-0 place-items-center overflow-hidden rounded-2xl border border-line bg-surface" style={{ width: size, height: size }}><img src={clientFileUrl(c.logo, true)} alt={`${c.name} logo`} className="h-full w-full object-contain p-1.5" /></span>;
  return <span className="grid shrink-0 place-items-center rounded-2xl font-display font-semibold text-white" style={{ width: size, height: size, background: c.color, fontSize: size * 0.4 }}>{c.name[0]}</span>;
}

async function approve(c, reload) {
  try { await api.post(`/clients/${c.id}/approve`); toast.success(`${c.name} is approved. They can sign in now.`); reload(); } catch (e) { toast.error(e.message); }
}

export default function Clients() {
  const { can } = useAuth();
  const { data, loading, reload } = useFetch('/clients');
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-semibold">Clients</h1><p className="text-sm text-muted">Clients can also sign up themselves from the sign-in page.</p></div>{can('clients.manage') && <button type="button" className="btn-primary" onClick={() => setOpen(true)}><Plus size={16} />New client</button>}</div>
      {data?.some((c) => c.status === 'pending') && (
        <section className="panel border-amber/40 p-5">
          <h2 className="mb-3 flex items-center gap-2 font-semibold"><Hourglass size={16} className="text-amber" />Waiting for approval</h2>
          <ul className="space-y-2">
            {data.filter((c) => c.status === 'pending').map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface p-3">
                <ClientLogo c={c} size={40} />
                <Link to={`/clients/${c.id}`} className="min-w-0 flex-1"><span className="block truncate font-semibold hover:underline">{c.name}</span><span className="text-xs text-muted">{[c.industry, c.email].filter(Boolean).join(', ')}, signed up {ago(c.createdAt)}</span></Link>
                <Link to={`/clients/${c.id}`} className="btn-ghost btn-sm">Review details</Link>
                {can('clients.manage') && <button type="button" className="btn-primary btn-sm" onClick={() => approve(c, reload)}><CheckCircle2 size={13} />Approve</button>}
              </li>
            ))}
          </ul>
        </section>
      )}
      {loading ? <PageLoader /> : !data.length ? <div className="panel"><Empty icon={Building2} title="No clients yet" body="Add a client, then give them a portal login so they can follow progress." /></div> : (
        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {data.filter((c) => c.status !== 'pending').map((c) => (
            <Link key={c.id} to={`/clients/${c.id}`} className="panel flex items-center gap-4 p-5 transition hover:border-cobalt/40">
              <div className="relative"><OrbitRing value={c.progress} size={64} color={c.color} label={!c.logo} />{c.logo && <span className="absolute inset-[10px] overflow-hidden rounded-full bg-surface"><img src={clientFileUrl(c.logo, true)} alt="" className="h-full w-full object-contain p-1" /></span>}</div>
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

const makePassword = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const a = new Uint32Array(10); crypto.getRandomValues(a);
  return `${[...a].map((n) => chars[n % chars.length]).join('')}@${10 + (a[0] % 90)}`;
};
const shareText = (company, email, password) => `Your ${company || 'Orbit'} client portal login\nLink: ${window.location.origin}\nEmail: ${email}\nPassword: ${password}\nPlease keep this private.`;

function PortalLogin({ client, onSaved }) {
  const { company } = useAuth();
  const [reset, setReset] = useState(null);
  const copy = (email, password) => { navigator.clipboard?.writeText(shareText(company?.name, email, password)); toast.success('Login details copied. Paste them into WhatsApp.'); };
  const doReset = async () => {
    try { await api.patch(`/clients/${client.id}/portal-users/${reset.user.id}`, { password: reset.password }); copy(reset.user.email, reset.password); setReset(null); } catch (err) { toast.error(err.message); }
  };
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: '', email: '', password: makePassword(), phone: '' });
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  const save = async (e) => {
    e.preventDefault();
    try { await api.post(`/clients/${client.id}/portal-users`, f); copy(f.email, f.password); setOpen(false); setF({ name: '', email: '', password: makePassword(), phone: '' }); onSaved(); } catch (err) { toast.error(err.message); }
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
            <button type="button" onClick={() => setReset({ user: u, password: makePassword() })} className="btn-ghost btn-sm">Reset password</button>
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
          <Field label="Password" hint="At least 8 characters. Details are copied for you when you save."><div className="flex gap-2"><input className="input font-mono" required minLength={8} value={f.password} onChange={set('password')} /><button type="button" className="btn-ghost shrink-0" onClick={() => setF((s) => ({ ...s, password: makePassword() }))}>Generate</button></div></Field>
        </form>
      </Modal>
      <Modal open={!!reset} onClose={() => setReset(null)} title={`New password for ${reset?.user.name}`} width="max-w-md"
        footer={<><button type="button" className="btn-ghost" onClick={() => setReset(null)}>Cancel</button><button type="button" className="btn-primary" onClick={doReset}>Save and copy</button></>}>
        {reset && <Field label="Password" hint="Their old password stops working right away."><div className="flex gap-2"><input className="input font-mono" value={reset.password} onChange={(e) => setReset({ ...reset, password: e.target.value })} /><button type="button" className="btn-ghost shrink-0" onClick={() => setReset({ ...reset, password: makePassword() })}>Generate</button></div></Field>}
      </Modal>
    </section>
  );
}

function BusinessProfile({ c, canManage }) {
  const [secrets, setSecrets] = useState(null);
  const answers = c.onboarding || {};
  const rows = (c.questions || []).filter((q) => answers[q.id] !== undefined && q.type !== 'secret');
  if (!rows.length && !c.hasSecrets) return null;
  const reveal = async () => { if (secrets) { setSecrets(null); return; } try { setSecrets((await api.get(`/clients/${c.id}/secrets`)).data); } catch (e) { toast.error(e.message); } };
  return (
    <section className="panel p-5">
      <h2 className="mb-4 flex items-center gap-2 font-semibold"><ClipboardList size={16} className="text-cobalt" />Business profile</h2>
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
        {rows.map((q) => {
          const v = Array.isArray(answers[q.id]) ? answers[q.id].join(', ') : String(answers[q.id]);
          return <div key={q.id} className="min-w-0"><dt className="text-xs text-muted">{q.label}</dt><dd className="break-words text-sm font-medium">{/^https?:\/\//.test(v) ? <a href={v} target="_blank" rel="noreferrer" className="link">{v}</a> : v}</dd></div>;
        })}
      </dl>
      {c.hasSecrets && canManage && (
        <div className="mt-4 rounded-xl border border-line p-3">
          <div className="flex items-center gap-2 text-sm"><KeyRound size={15} className="text-amber" /><span className="font-semibold">Saved credentials</span><span className="text-xs text-muted">Encrypted. Viewing is logged.</span>
            <button type="button" className="btn-ghost btn-sm ml-auto" onClick={reveal}>{secrets ? <><EyeOff size={13} />Hide</> : <><Eye size={13} />Reveal</>}</button></div>
          {secrets && <dl className="mt-3 space-y-1.5">{Object.entries(secrets).map(([k, v]) => <div key={k} className="flex gap-3 text-sm"><dt className="w-40 shrink-0 text-muted">{(c.questions || []).find((q) => q.id === k)?.label || k}</dt><dd className="select-all font-mono">{v}</dd></div>)}</dl>}
        </div>
      )}
    </section>
  );
}

function ClientFiles({ c, reload, canManage }) {
  const ref = useRef(null);
  const [cat, setCat] = useState('document');
  const upload = async (list) => {
    if (!list?.length) return;
    const fd = new FormData(); [...list].forEach((f) => fd.append('files', f)); fd.append('category', cat);
    const t = toast.loading('Uploading');
    try { await api.post(`/clients/${c.id}/files`, fd); toast.success('Uploaded', { id: t }); reload(); } catch (e) { toast.error(e.message, { id: t }); }
  };
  const remove = async (f) => { try { await api.delete(`/clients/${c.id}/files/${f.id}`); reload(); } catch (e) { toast.error(e.message); } };
  const LABEL = { logo: 'Logo', brand: 'Brand', document: 'Document', other: 'Other' };
  return (
    <section className="panel p-5">
      <div className="mb-3 flex items-center gap-2"><h2 className="flex items-center gap-2 font-semibold"><FileText size={16} className="text-violet" />Logo and files</h2>
        {canManage && <div className="ml-auto flex gap-2"><select className="input !w-auto !py-1 text-xs" value={cat} onChange={(e) => setCat(e.target.value)}><option value="logo">Logo</option><option value="brand">Brand</option><option value="document">Document</option><option value="other">Other</option></select><button type="button" className="btn-ghost btn-sm" onClick={() => ref.current?.click()}><Upload size={13} />Upload</button></div>}
        <input ref={ref} type="file" multiple={cat !== 'logo'} accept={cat === 'logo' ? 'image/*' : undefined} hidden onChange={(e) => { upload(e.target.files); e.target.value = ''; }} />
      </div>
      <ul className="space-y-1.5">
        {(c.files || []).map((f) => (
          <li key={f.id} className="flex items-center gap-2.5 rounded-xl px-2 py-1.5 text-sm hover:bg-sunken/60">
            <span className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-lg bg-sunken">{/^image\//.test(f.mime) ? <img src={clientFileUrl(f.id, true)} alt="" className="h-full w-full object-cover" loading="lazy" /> : <FileText size={15} className="text-muted" />}</span>
            <span className="min-w-0 flex-1"><span className="block truncate font-medium">{f.originalName}</span><span className="text-[11px] text-muted">{LABEL[f.category]}{String(c.logo) === String(f.id) ? ' (current logo)' : ''}, {bytes(f.size)}, {f.uploader ? f.uploader.name : 'at sign-up'}</span></span>
            <a href={clientFileUrl(f.id)} className="rounded p-1 text-muted hover:text-ink" aria-label="Download"><Download size={14} /></a>
            {canManage && <button type="button" onClick={() => remove(f)} className="rounded p-1 text-muted hover:text-ember" aria-label="Delete"><Trash2 size={14} /></button>}
          </li>
        ))}
        {!c.files?.length && <li className="py-2 text-sm text-muted">No files yet. Clients can upload their logo and brand files from their portal.</li>}
      </ul>
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
        <ClientLogo c={c} size={64} />
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
        <div className="flex gap-2">
          {c.status === 'pending' && can('clients.manage') && <button type="button" className="btn-primary" onClick={() => approve(c, reload)}><CheckCircle2 size={15} />Approve sign-up</button>}
          {can('clients.manage') && <button type="button" className="btn-ghost" onClick={() => setEdit(true)}><Pencil size={15} />Edit</button>}
        </div>
      </section>
      {c.status === 'pending' && <p className="flex items-center gap-2 rounded-xl bg-amber/10 px-4 py-2.5 text-sm text-amber"><Hourglass size={15} />Signed up from the portal {ago(c.createdAt)}. They can't sign in until you approve.</p>}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="space-y-5">
        <BusinessProfile c={c} canManage={can('clients.manage')} />
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
        </div>
        <div className="space-y-5">
          {can('clients.manage') && <PortalLogin client={c} onSaved={reload} />}
          <ClientFiles c={c} reload={reload} canManage={can('clients.manage')} />
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
