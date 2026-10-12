import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import { Plus, FolderKanban, Search, Sparkles, LayoutTemplate, FilePlus2, ArrowLeft } from 'lucide-react';
import api from '../lib/api';
import useFetch from '../lib/useFetch';
import { useAuth, useLive } from '../context/AuthContext';
import { useDirectory, invalidate, useAiStatus, refreshProjects } from '../lib/directory';
import { AvatarStack, PageLoader, Empty, Modal, Field, UserPicker, ColorPicker, Toggle, Bar, Segmented, PageHeader, HealthBadge, Spinner } from '../components/ui';
import { PROJECT_STATUS, STATUS, money, fmtDate } from '../lib/format';

const ICONS = ['🚀', '🪔', '✨', '☀️', '🎯', '🎨', '🖥️', '📅', '🎬', '🛒', '🏥', '🏗️', '📣', '🌱', '🛰️'];

function PlanPreview({ plan }) {
  return (
    <div className="max-h-[46vh] space-y-4 overflow-y-auto rounded-xl border border-line p-4">
      {plan.summary && <p className="text-sm text-muted">{plan.summary}</p>}
      <div className="flex flex-wrap gap-1.5">{plan.milestones?.map((m) => <span key={m.title} className="chip bg-brand-soft text-ink">◆ {m.title}, day {m.offsetDays}</span>)}</div>
      {plan.sections?.map((s) => {
        const ts = plan.tasks.filter((t) => t.section === s.name);
        if (!ts.length) return null;
        return (
          <div key={s.name}>
            <div className="mb-1 text-xs font-semibold text-muted">{s.name}</div>
            <ul className="space-y-1">{ts.map((t, i) => (
              <li key={i} className="rounded-lg bg-sunken/60 px-3 py-1.5 text-sm"><span className="font-medium">{t.title}</span><span className="ml-2 text-xs text-faint">day {t.offsetDays}{t.estimateHours ? `, ${t.estimateHours}h` : ''}</span>
                {t.subtasks?.length > 0 && <ul className="mt-1 space-y-0.5 pl-4 text-xs text-muted">{t.subtasks.map((st, j) => <li key={j}>↳ {st.title}</li>)}</ul>}
              </li>
            ))}</ul>
          </div>
        );
      })}
    </div>
  );
}

export function ProjectForm({ open, onClose, project, onSaved, initialTemplateId }) {
  const people = useDirectory();
  const ai = useAiStatus();
  const [clients, setClients] = useState([]);
  const [templates, setTemplates] = useState([]);
  const { can } = useAuth();
  const blank = { name: '', code: '', description: '', clientId: '', ownerId: '', memberIds: [], status: 'active', startDate: new Date().toISOString().slice(0, 10), dueDate: '', color: '#3D5AFE', icon: '🚀', clientVisible: true, budget: '', spent: '', currency: 'INR', stages: 'Brief, In progress', pipeline: { review: true, done: true, archive: true } };
  const [f, setF] = useState(blank);
  const [mode, setMode] = useState('blank'); // blank | template | ai
  const [step, setStep] = useState(project ? 'details' : 'choose');
  const [templateId, setTemplateId] = useState(null);
  const [brief, setBrief] = useState('');
  const [plan, setPlan] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    if (can('clients.view', 'clients.manage')) api.get('/clients').then((r) => setClients(r.data)).catch(() => {});
    api.get('/tools/templates').then((r) => setTemplates(r.data)).catch(() => {});
    setF(project ? { ...blank, ...project, memberIds: (project.members || []).map((m) => m.id), clientId: project.clientId || '', ownerId: project.ownerId || '', budget: project.budget || '', spent: project.spent || '' } : blank);
    if (initialTemplateId && !project) { setStep('details'); setMode('template'); setTemplateId(initialTemplateId); } else { setStep(project ? 'details' : 'choose'); setMode('blank'); setTemplateId(null); }
    setPlan(null); setBrief('');
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e?.target ? e.target.value : e }));

  const makePlan = async () => {
    if (!brief.trim()) return toast.error('Describe the project first.');
    setBusy(true);
    try {
      const client = clients.find((c) => String(c.id) === String(f.clientId));
      const { data } = await api.post('/ai/plan', { brief, name: f.name, startDate: f.startDate, dueDate: f.dueDate, clientName: client?.name });
      setPlan(data);
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  const save = async (e) => {
    e?.preventDefault();
    if (!f.name.trim()) return toast.error('Give the project a name.');
    setBusy(true);
    try {
      const body = { ...f, stages: String(f.stages || '').split(',').map((x) => x.trim()).filter(Boolean), clientId: f.clientId || null, ownerId: f.ownerId || null, startDate: f.startDate || null, dueDate: f.dueDate || null, budget: Number(f.budget) || 0, spent: Number(f.spent) || 0,
        ...(mode === 'template' && templateId ? { templateId } : {}), ...(mode === 'ai' && plan ? { plan } : {}) };
      const { data } = project ? await api.patch(`/projects/${project.id}`, body) : await api.post('/projects', body);
      invalidate('projects'); refreshProjects();
      toast.success(project ? 'Project saved' : `Project created${data.applied ? ` with ${data.applied.created} tasks` : ''}`);
      onSaved?.(data); onClose();
    } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };

  const choose = (
    <div className="grid gap-3 sm:grid-cols-3">
      {[
        { m: 'blank', icon: FilePlus2, t: 'Blank project', d: 'Start empty and add tasks as you go.' },
        { m: 'template', icon: LayoutTemplate, t: 'From a template', d: 'Social calendar, Meta ads launch, website build and more.' },
        { m: 'ai', icon: Sparkles, t: 'Plan with AI', d: ai.ready ? 'Describe it, Gemini drafts sections, milestones and tasks.' : 'Needs a Gemini key in Settings.', disabled: !ai.ready },
      ].map((o) => (
        <button key={o.m} type="button" disabled={o.disabled} onClick={() => { setMode(o.m); setStep(o.m === 'template' ? 'template' : 'details'); }}
          className={clsx('rounded-2xl border p-4 text-left transition disabled:opacity-50', o.m === 'ai' ? 'border-violet/30 hover:bg-violet/5' : 'border-line hover:bg-sunken/60')}>
          <o.icon size={22} className={o.m === 'ai' ? 'text-violet' : 'text-ink'} />
          <div className="mt-3 font-semibold">{o.t}</div><div className="mt-1 text-xs text-muted">{o.d}</div>
        </button>
      ))}
    </div>
  );

  const templatePick = (
    <div>
      <div className="grid max-h-[55vh] gap-2 overflow-y-auto sm:grid-cols-2">
        {templates.map((t) => (
          <button key={t.id} type="button" onClick={() => { setTemplateId(t.id); setF((s) => ({ ...s, icon: t.icon, name: s.name || t.name })); setStep('details'); }}
            className="flex items-start gap-3 rounded-xl border border-line p-3 text-left hover:bg-sunken/60">
            <span className="text-2xl">{t.icon}</span>
            <span className="min-w-0"><span className="block font-semibold">{t.name}</span><span className="line-clamp-2 text-xs text-muted">{t.description}</span><span className="mt-1 block text-[11px] text-faint">{t.taskCount} tasks, {t.milestoneCount} milestones</span></span>
          </button>
        ))}
      </div>
    </div>
  );

  const details = (
    <form id="pf" onSubmit={save} className="space-y-4">
      {mode === 'template' && templateId && <div className="flex items-center gap-2 rounded-xl bg-brand-soft/60 px-3 py-2 text-sm"><LayoutTemplate size={15} />Using template <b>{templates.find((t) => t.id === templateId)?.name}</b>. Dates count from the start date.</div>}
      <div className="flex gap-3">
        <div><span className="label">Icon</span>
          <select className="input !w-16 text-center text-lg" value={f.icon || ''} onChange={set('icon')} aria-label="Icon">{ICONS.map((i) => <option key={i} value={i}>{i}</option>)}</select>
        </div>
        <Field label="Project name" className="flex-1"><input className="input" required value={f.name} onChange={set('name')} placeholder="Kasaar Diwali campaign" /></Field>
        {!project && <Field label="Code" hint="KAS-12 style keys"><input className="input w-24 uppercase" maxLength={5} value={f.code} onChange={set('code')} placeholder="KAS" /></Field>}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Client"><select className="input" value={f.clientId} onChange={set('clientId')}><option value="">Internal (no client)</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
        <Field label="Project lead"><UserPicker multiple={false} users={people} value={f.ownerId ? Number(f.ownerId) : null} onChange={set('ownerId')} placeholder="You" /></Field>
        <Field label="Team" className="sm:col-span-2"><UserPicker users={people} value={f.memberIds} onChange={set('memberIds')} /></Field>
        <Field label="Start"><input type="date" className="input" value={f.startDate || ''} onChange={set('startDate')} /></Field>
        <Field label="Deadline"><input type="date" className="input" value={f.dueDate || ''} onChange={set('dueDate')} /></Field>
        <Field label="Status"><select className="input" value={f.status} onChange={set('status')}>{Object.entries(PROJECT_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Budget (₹)"><input type="number" min="0" className="input" value={f.budget} onChange={set('budget')} /></Field>
          <Field label="Spent (₹)"><input type="number" min="0" className="input" value={f.spent} onChange={set('spent')} /></Field>
        </div>
        <Field label="Description" className="sm:col-span-2"><textarea className="input min-h-[64px]" value={f.description || ''} onChange={set('description')} /></Field>
        <Field label="Colour" className="sm:col-span-2"><ColorPicker value={f.color} onChange={set('color')} /></Field>
        {project && (
          <Field label="Health" hint="Leave on automatic unless you know better than the numbers." className="sm:col-span-2">
            <select className="input" value={f.healthOverride || ''} onChange={set('healthOverride')}><option value="">Automatic</option><option value="on_track">On track</option><option value="at_risk">At risk</option><option value="off_track">Off track</option></select>
          </Field>
        )}
      </div>
      <Toggle checked={f.clientVisible} onChange={set('clientVisible')} label="Show this project in the client portal" hint="Only tasks you mark as shared appear there." />
      {!project && mode === 'blank' && (
        <div className="space-y-3 rounded-xl border border-line p-4">
          <Field label="Pipeline stages" hint="Comma separated, in order. You can change them any time."><input className="input" value={f.stages} onChange={set('stages')} placeholder="Brief, Design, Shoot, Edit" /></Field>
          <div className="flex flex-wrap items-center gap-2 text-xs"><span className="text-muted">Then:</span>
            {[['review', 'In review'], ['done', 'Completed'], ['archive', 'Archive']].map(([k, l]) => (
              <button key={k} type="button" onClick={() => setF((s2) => ({ ...s2, pipeline: { ...s2.pipeline, [k]: !s2.pipeline[k] } }))} className={clsx('rounded-full border px-3 py-1 font-semibold transition', f.pipeline[k] ? 'border-ink bg-ink text-surface' : 'border-line text-muted line-through')}>{l}</button>
            ))}
          </div>
        </div>
      )}
      {mode === 'ai' && (
        <div className="space-y-3 rounded-xl border border-violet/25 bg-violet/5 p-4">
          <Field label="What's the project about?"><textarea className="input min-h-[90px]" value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="Launch campaign for a new thekua flavour: 30 days of Instagram, 2 reels a week, Meta ads with ₹50k budget, influencer collabs in Patna and Ranchi." /></Field>
          <button type="button" className="btn-ai" onClick={makePlan} disabled={busy}>{busy ? <Spinner size={14} className="text-violet" /> : <Sparkles size={15} />}{plan ? 'Draft again' : 'Draft the plan'}</button>
          {plan && <PlanPreview plan={plan} />}
        </div>
      )}
    </form>
  );

  const footer = step === 'details'
    ? <>{!project && <button type="button" className="btn-ghost mr-auto" onClick={() => setStep(mode === 'template' ? 'template' : 'choose')}><ArrowLeft size={15} />Back</button>}<button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button form="pf" className="btn-primary" disabled={busy || (mode === 'ai' && !plan)}>{project ? 'Save project' : mode === 'ai' ? 'Create with this plan' : 'Create project'}</button></>
    : <><button type="button" className="btn-ghost" onClick={step === 'template' ? () => setStep('choose') : onClose}>{step === 'template' ? 'Back' : 'Cancel'}</button></>;

  return (
    <Modal open={open} onClose={onClose} title={project ? 'Edit project' : step === 'choose' ? 'New project' : step === 'template' ? 'Pick a template' : mode === 'ai' ? 'Plan a project with AI' : 'Project details'} width="max-w-2xl" footer={footer}>
      {step === 'choose' ? choose : step === 'template' ? templatePick : details}
    </Modal>
  );
}

export default function Projects() {
  const { can } = useAuth();
  const [status, setStatus] = useState('active,planning,on_hold');
  const [health, setHealth] = useState('');
  const [q, setQ] = useState('');
  const { data, loading, reload } = useFetch(`/projects?status=${status}`);
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  useLive(['project:changed', 'task:changed'], reload);
  const list = (data || []).filter((p) => (!health || p.health?.state === health) && (!q || `${p.name} ${p.code} ${p.Client?.name || ''}`.toLowerCase().includes(q.toLowerCase())));
  const counts = { on_track: 0, at_risk: 0, off_track: 0 };
  (data || []).forEach((p) => { if (counts[p.health?.state] != null) counts[p.health.state] += 1; });

  return (
    <div>
      <PageHeader title="Projects" subtitle={data ? `${data.length} projects, ${data.reduce((s, p) => s + p.overdue, 0)} overdue tasks across them` : ' '}
        actions={can('projects.manage') && <button type="button" className="btn-primary" onClick={() => setOpen(true)}><Plus size={16} />New project</button>} />
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Segmented value={status} onChange={setStatus} options={[{ value: 'active,planning,on_hold', label: 'Running' }, { value: 'completed', label: 'Completed' }, { value: 'archived', label: 'Archived' }]} />
        <Segmented value={health} onChange={setHealth} options={[{ value: '', label: 'All' }, { value: 'on_track', label: 'On track', count: counts.on_track }, { value: 'at_risk', label: 'At risk', count: counts.at_risk }, { value: 'off_track', label: 'Off track', count: counts.off_track }]} />
        <div className="relative ml-auto w-full sm:w-64">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input className="input pl-9" placeholder="Search projects" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      {loading ? <PageLoader /> : !list.length ? (
        <div className="panel"><Empty icon={FolderKanban} title="No projects here" body="Projects group the work for a client or an internal goal." action={can('projects.manage') && <button type="button" className="btn-primary" onClick={() => setOpen(true)}>New project</button>} /></div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {list.map((p) => {
            const total = p.taskCount || 0;
            const over = p.budget > 0 ? Math.round((p.spent / p.budget) * 100) : null;
            return (
              <Link key={p.id} to={`/projects/${p.id}`} className="group panel flex flex-col overflow-hidden transition hover:shadow-lift">
                <div className="relative h-2" style={{ background: p.color }} />
                <div className="flex flex-1 flex-col p-5">
                  <div className="flex items-start gap-3">
                    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl text-xl" style={{ background: `${p.color}1F` }}>{p.icon || '📁'}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-xs text-muted"><span className="font-semibold">{p.code}</span><span className="truncate">{p.Client?.name || 'Internal'}</span></div>
                      <h3 className="mt-0.5 truncate text-lg font-semibold group-hover:underline">{p.name}</h3>
                    </div>
                    <HealthBadge state={p.health?.state} />
                  </div>
                  {p.description && <p className="mt-3 line-clamp-2 text-sm text-muted">{p.description}</p>}
                  <div className="mt-4 flex items-center gap-3"><Bar value={p.progress} color={p.color} height={6} /><span className="font-display text-sm font-semibold">{p.progress}%</span></div>
                  <div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-sunken" title="Tasks by status">
                    {['done', 'review', 'in_progress', 'todo', 'backlog', 'blocked'].map((s) => p.counts[s] ? <div key={s} style={{ width: `${(p.counts[s] / total) * 100}%`, background: STATUS[s].color }} /> : null)}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5 text-[11px] font-semibold">
                    <span className="chip bg-leaf/10 text-leaf">{p.counts.done} done</span>
                    <span className="chip bg-cobalt/10 text-cobalt">{p.counts.in_progress} in progress</span>
                    <span className="chip bg-sunken text-muted">{(p.counts.todo || 0) + (p.counts.backlog || 0)} to do</span>
                    {p.overdue > 0 && <span className="chip bg-ember/10 text-ember">{p.overdue} overdue</span>}
                  </div>
                  {over != null && (
                    <div className="mt-4">
                      <div className="mb-1 flex justify-between text-xs"><span className="text-muted">Budget</span><span className={over > 100 ? 'font-semibold text-ember' : 'text-muted'}>{money(p.spent, p.currency)} of {money(p.budget, p.currency)}</span></div>
                      <Bar value={over} color={over > 100 ? 'rgb(var(--c-ember))' : over > 85 ? 'rgb(var(--c-amber))' : 'rgb(var(--c-leaf))'} height={4} />
                    </div>
                  )}
                  <div className="mt-auto flex items-center justify-between pt-4 text-xs text-muted">
                    <AvatarStack users={p.members} max={4} size={26} emptyLabel="No team yet" />
                    {p.dueDate ? <span className={clsx('rounded-lg px-2 py-1 font-semibold', p.daysLeft < 0 ? 'bg-ember/10 text-ember' : p.daysLeft <= 7 ? 'bg-amber/10 text-amber' : 'bg-sunken')}>{p.daysLeft < 0 ? `${-p.daysLeft}d late` : `${p.daysLeft}d left`}, {fmtDate(p.dueDate, 'd MMM')}</span> : <span className="rounded-lg bg-sunken px-2 py-1">No deadline</span>}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
      <ProjectForm open={open} onClose={() => setOpen(false)} onSaved={(p) => nav(`/projects/${p.id}`)} />
    </div>
  );
}
