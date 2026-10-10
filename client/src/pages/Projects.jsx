import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Plus, FolderKanban, Pencil, Check, Trash2, Flag, Eye } from 'lucide-react';
import api from '../lib/api';
import useFetch from '../lib/useFetch';
import { useAuth, useLive } from '../context/AuthContext';
import { useDirectory, invalidate } from '../lib/directory';
import { OrbitRing, AvatarStack, Avatar, PageLoader, Empty, Modal, Field, UserPicker, ColorPicker, Toggle, Bar, Segmented } from '../components/ui';
import TaskExplorer from '../components/TaskExplorer';
import { ActivityFeed } from './Dashboard';
import { PROJECT_STATUS, fmtDate, minutes, STATUS, STATUS_ORDER } from '../lib/format';

export function ProjectForm({ open, onClose, project, onSaved }) {
  const people = useDirectory();
  const [clients, setClients] = useState([]);
  const { can } = useAuth();
  const blank = { name: '', code: '', description: '', clientId: '', ownerId: '', memberIds: [], status: 'active', startDate: '', dueDate: '', color: '#3DE0F2', clientVisible: true, milestones: [] };
  const [f, setF] = useState(blank);
  useEffect(() => {
    if (!open) return;
    if (can('clients.view', 'clients.manage')) api.get('/clients').then((r) => setClients(r.data)).catch(() => {});
    setF(project ? { ...blank, ...project, memberIds: (project.members || []).map((m) => m.id), clientId: project.clientId || '', ownerId: project.ownerId || '' } : blank);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e?.target ? e.target.value : e }));
  const save = async (e) => {
    e.preventDefault();
    try {
      const body = { ...f, clientId: f.clientId || null, ownerId: f.ownerId || null, startDate: f.startDate || null, dueDate: f.dueDate || null };
      const { data } = project ? await api.patch(`/projects/${project.id}`, body) : await api.post('/projects', body);
      invalidate('projects'); toast.success(project ? 'Project saved' : 'Project created'); onSaved?.(data); onClose();
    } catch (err) { toast.error(err.message); }
  };
  return (
    <Modal open={open} onClose={onClose} title={project ? 'Edit project' : 'New project'} width="max-w-2xl"
      footer={<><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button form="pf" className="btn-primary">{project ? 'Save project' : 'Create project'}</button></>}>
      <form id="pf" onSubmit={save} className="grid gap-4 sm:grid-cols-2">
        <Field label="Project name" className="sm:col-span-2"><input className="input" required value={f.name} onChange={set('name')} placeholder="Kasaar Diwali campaign" /></Field>
        {!project && <Field label="Short code" hint="Used in task keys, e.g. KAS-12. Up to 5 letters."><input className="input uppercase" maxLength={5} value={f.code} onChange={set('code')} placeholder="KAS" /></Field>}
        <Field label="Client">
          <select className="input" value={f.clientId} onChange={set('clientId')}><option value="">Internal (no client)</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        </Field>
        <Field label="Project lead"><UserPicker multiple={false} users={people} value={f.ownerId ? Number(f.ownerId) : null} onChange={set('ownerId')} placeholder="Pick a lead" /></Field>
        <Field label="Team"><UserPicker users={people} value={f.memberIds} onChange={set('memberIds')} /></Field>
        <Field label="Status"><select className="input" value={f.status} onChange={set('status')}>{Object.entries(PROJECT_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="Start"><input type="date" className="input" value={f.startDate || ''} onChange={set('startDate')} /></Field>
        <Field label="Deadline"><input type="date" className="input" value={f.dueDate || ''} onChange={set('dueDate')} /></Field>
        <Field label="Description" className="sm:col-span-2"><textarea className="input min-h-[70px]" value={f.description || ''} onChange={set('description')} /></Field>
        <Field label="Colour" className="sm:col-span-2"><ColorPicker value={f.color} onChange={set('color')} /></Field>
        {!project && (
          <div className="sm:col-span-2">
            <span className="label">Milestones</span>
            {f.milestones.map((m, i) => (
              <div key={i} className="mb-2 flex gap-2">
                <input className="input" placeholder="Milestone" value={m.title} onChange={(e) => setF((s) => ({ ...s, milestones: s.milestones.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)) }))} />
                <input type="date" className="input !w-44" value={m.dueDate || ''} onChange={(e) => setF((s) => ({ ...s, milestones: s.milestones.map((x, j) => (j === i ? { ...x, dueDate: e.target.value } : x)) }))} />
              </div>
            ))}
            <button type="button" className="btn-ghost btn-sm" onClick={() => setF((s) => ({ ...s, milestones: [...s.milestones, { title: '', dueDate: '' }] }))}><Plus size={13} />Add milestone</button>
          </div>
        )}
        <div className="sm:col-span-2"><Toggle checked={f.clientVisible} onChange={set('clientVisible')} label="Show this project in the client portal" hint="Only tasks you mark as shared appear there." /></div>
      </form>
    </Modal>
  );
}

export default function Projects() {
  const { can } = useAuth();
  const [status, setStatus] = useState('active,planning,on_hold');
  const { data, loading, reload } = useFetch(`/projects?status=${status}`);
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  useLive(['project:changed', 'task:changed'], reload);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Projects</h1>
        <div className="flex items-center gap-2">
          <Segmented value={status} onChange={setStatus} options={[{ value: 'active,planning,on_hold', label: 'Running' }, { value: 'completed', label: 'Completed' }, { value: 'archived', label: 'Archived' }]} />
          {can('projects.manage') && <button type="button" className="btn-primary" onClick={() => setOpen(true)}><Plus size={16} />New project</button>}
        </div>
      </div>
      {loading ? <PageLoader /> : !data.length ? (
        <div className="panel"><Empty icon={FolderKanban} title="No projects here" body="Projects group tasks for a client or an internal goal." action={can('projects.manage') && <button type="button" className="btn-primary" onClick={() => setOpen(true)}>New project</button>} /></div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {data.map((p) => (
            <Link key={p.id} to={`/projects/${p.id}`} className="panel group flex flex-col p-5 transition hover:border-signal/40">
              <div className="flex items-start gap-4">
                <OrbitRing value={p.progress} size={72} color={p.color} />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold text-mist">{p.code} — {p.Client?.name || 'Internal'}</div>
                  <h3 className="mt-0.5 truncate text-lg font-semibold">{p.name}</h3>
                  <div className="mt-1 text-xs text-mist">{PROJECT_STATUS[p.status]}{p.dueDate && `, due ${fmtDate(p.dueDate, 'd MMM')}`}</div>
                </div>
              </div>
              <div className="mt-5 flex h-2 overflow-hidden rounded-full bg-white/[0.05]" title="Tasks by status">
                {STATUS_ORDER.map((s) => p.counts[s] ? <div key={s} style={{ width: `${(p.counts[s] / p.taskCount) * 100}%`, background: STATUS[s].color }} /> : null)}
              </div>
              <div className="mt-4 flex items-center justify-between text-xs text-mist">
                <span>{p.taskCount} tasks{p.overdue ? <span className="text-rose">, {p.overdue} overdue</span> : ''}</span>
                <AvatarStack users={p.members} max={4} size={24} />
              </div>
            </Link>
          ))}
        </div>
      )}
      <ProjectForm open={open} onClose={() => setOpen(false)} onSaved={(p) => nav(`/projects/${p.id}`)} />
    </div>
  );
}

export function ProjectDetail() {
  const { id } = useParams();
  const { data: p, loading, reload } = useFetch(`/projects/${id}`);
  const [tab, setTab] = useState('tasks');
  const [edit, setEdit] = useState(false);
  const [ms, setMs] = useState({ title: '', dueDate: '' });
  useLive(['task:changed', 'project:changed'], reload, [id]);
  if (loading || !p) return <PageLoader />;
  if (p.error) return <div className="panel p-10 text-center text-mist">{p.error}</div>;

  const addMilestone = async (e) => {
    e.preventDefault(); if (!ms.title) return;
    await api.post(`/projects/${p.id}/milestones`, ms); setMs({ title: '', dueDate: '' }); reload();
  };
  const toggleMs = async (m) => { await api.patch(`/projects/milestones/${m.id}`, { done: !m.done }); reload(); };
  const delMs = async (m) => { if (window.confirm(`Remove milestone “${m.title}”?`)) { await api.delete(`/projects/milestones/${m.id}`); reload(); } };

  return (
    <div className="space-y-5">
      <section className="panel relative overflow-hidden p-5 sm:p-6">
        <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full opacity-20 blur-3xl" style={{ background: p.color }} />
        <div className="relative flex flex-wrap items-center gap-6">
          <OrbitRing value={p.progress} size={104} stroke={7} color={p.color} sub="complete" />
          <div className="min-w-0 flex-1">
            <div className="text-xs font-semibold text-mist">{p.code} — {p.Client ? <Link className="hover:text-star" to={`/clients/${p.Client.id}`}>{p.Client.name}</Link> : 'Internal'}</div>
            <h1 className="mt-1 text-2xl font-semibold sm:text-3xl">{p.name}</h1>
            {p.description && <p className="mt-1 max-w-2xl text-sm text-mist">{p.description}</p>}
            <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
              <span className="inline-flex items-center gap-2"><Avatar user={p.owner} size={22} />{p.owner?.name}<span className="text-xs text-mist">lead</span></span>
              <span className="text-mist">{PROJECT_STATUS[p.status]}</span>
              {p.dueDate && <span className="text-mist">Deadline {fmtDate(p.dueDate)}</span>}
              <span className="text-mist">{minutes(p.minutesLogged)} logged</span>
              {p.clientVisible && p.Client && <span className="inline-flex items-center gap-1 text-signal"><Eye size={14} />Visible to client</span>}
            </div>
          </div>
          {p.canManage && <button type="button" className="btn-ghost" onClick={() => setEdit(true)}><Pencil size={15} />Edit</button>}
        </div>
      </section>

      <div className="flex flex-wrap gap-1">
        {[['tasks', 'Tasks'], ['milestones', `Milestones (${p.Milestones.length})`], ['team', `Team (${p.members.length})`], ['activity', 'Activity']].map(([k, l]) => (
          <button type="button" key={k} onClick={() => setTab(k)} className={`tab ${tab === k ? 'tab-active' : ''}`}>{l}</button>
        ))}
      </div>

      {tab === 'tasks' && <TaskExplorer fixed={{ projectId: p.id }} storageKey={`project-${p.id}`} defaultView="board" composeDefaults={{ projectId: p.id, clientVisible: !!p.Client }} />}

      {tab === 'milestones' && (
        <section className="panel p-5">
          <ol className="relative space-y-5 border-l border-line pl-6">
            {p.Milestones.map((m) => (
              <li key={m.id} className="relative">
                <button type="button" onClick={() => p.canManage && toggleMs(m)} aria-label={m.done ? 'Mark not reached' : 'Mark reached'}
                  className={`absolute -left-[33px] top-0.5 grid h-5 w-5 place-items-center rounded-full border-2 ${m.done ? 'border-mint bg-mint text-space' : 'border-mist/60 bg-space'}`}>{m.done && <Check size={12} strokeWidth={3} />}</button>
                <div className="flex flex-wrap items-center gap-3">
                  <span className={`font-semibold ${m.done ? 'text-mist' : ''}`}>{m.title}</span>
                  <span className="text-xs text-mist">{m.dueDate ? fmtDate(m.dueDate) : 'No date'}</span>
                  <span className="text-xs text-mist">{m.taskCount} tasks</span>
                  {p.canManage && <button type="button" onClick={() => delMs(m)} className="ml-auto text-mist hover:text-rose" aria-label="Remove milestone"><Trash2 size={14} /></button>}
                </div>
                <Bar value={m.progress} color={m.done ? '#5BE3A6' : p.color} className="mt-2 max-w-md" />
              </li>
            ))}
            {!p.Milestones.length && <li className="text-sm text-mist">Milestones mark the big moments clients care about. They show in the client portal.</li>}
          </ol>
          {p.canManage && (
            <form onSubmit={addMilestone} className="mt-6 flex flex-wrap gap-2">
              <Flag size={16} className="mt-2.5 text-mist" />
              <input className="input flex-1" placeholder="New milestone" value={ms.title} onChange={(e) => setMs((s) => ({ ...s, title: e.target.value }))} />
              <input type="date" className="input !w-44" value={ms.dueDate} onChange={(e) => setMs((s) => ({ ...s, dueDate: e.target.value }))} />
              <button className="btn-primary">Add</button>
            </form>
          )}
        </section>
      )}

      {tab === 'team' && (
        <section className="panel divide-y divide-line/60">
          {p.members.map((m) => {
            const w = p.workload.find((x) => x.user.id === m.id);
            return (
              <div key={m.id} className="flex items-center gap-3 p-4">
                <Avatar user={m} size={34} />
                <div className="flex-1"><div className="font-medium">{m.name}{m.ProjectMember?.role === 'lead' && <span className="ml-2 chip bg-signal/15 text-signal">Lead</span>}</div><div className="text-xs text-mist">{m.designation}</div></div>
                <span className="text-sm text-mist">{w?.open || 0} open tasks</span>
              </div>
            );
          })}
        </section>
      )}

      {tab === 'activity' && <section className="panel p-5"><ActivityFeed items={p.activity} /></section>}

      <ProjectForm open={edit} onClose={() => setEdit(false)} project={p} onSaved={reload} />
    </div>
  );
}
