import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import { startOfMonth, format } from 'date-fns';
import {
  ArrowLeft, LayoutDashboard, List, Columns3, CalendarRange, CalendarDays, Zap, FileText, History, Plus, Pencil, MoreHorizontal,
  LayoutTemplate, Flag, Check, Trash2, Play, CircleCheckBig, Sparkles, Clock, Wallet, Users, AlertTriangle, Diamond,
} from 'lucide-react';
import api, { download } from '../lib/api';
import useFetch from '../lib/useFetch';
import { useAuth, useLive } from '../context/AuthContext';
import { refreshProjects } from '../lib/directory';
import {
  PageLoader, Tabs, Panel, HealthBadge, OrbitRing, Bar, Avatar, AvatarStack, Empty, Modal, Field, Menu, confirm, Spinner,
} from '../components/ui';
import { BurndownChart, StatusDonut, PriorityBars } from '../components/Charts';
import TaskExplorer from '../components/TaskExplorer';
import Gantt from '../components/Gantt';
import Pipeline from '../components/Pipeline';
import MonthCalendar from '../components/MonthCalendar';
import { useAskAi, useComposer, useOpenTask } from '../components/Layout';
import { ActivityFeed } from './Dashboard';
import { ProjectForm } from './Projects';
import { STATUS, money, fmtDate, minutes, ago, toDateInput } from '../lib/format';

const SEV = { critical: '#E5484D', warning: '#C76A00', info: '#3D5AFE' };

function Overview({ p, reload }) {
  const ask = useAskAi();
  const [ms, setMs] = useState({ title: '', dueDate: '' });
  const addMilestone = async (e) => {
    e.preventDefault();
    if (!ms.title.trim()) return;
    try { await api.post(`/projects/${p.id}/milestones`, ms); setMs({ title: '', dueDate: '' }); reload(); } catch (err) { toast.error(err.message); }
  };
  const toggleMs = async (m) => { try { await api.patch(`/projects/milestones/${m.id}`, { done: !m.done }); reload(); } catch (err) { toast.error(err.message); } };
  const delMs = async (m) => { if (await confirm({ title: `Delete milestone "${m.title}"?`, body: 'Tasks linked to it stay, they just lose the link.', danger: true })) { await api.delete(`/projects/milestones/${m.id}`); reload(); } };
  const statusMix = Object.entries(p.counts || {}).map(([status, count]) => ({ status, count }));
  const budgetPct = p.budget > 0 ? Math.round((p.spent / p.budget) * 100) : null;
  const open = p.taskCount - (p.counts?.done || 0);

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
      <div className="space-y-5 xl:col-span-2">
        <section className="panel grid grid-cols-2 divide-line sm:grid-cols-4 sm:divide-x">
          <div className="flex items-center gap-3 px-5 py-4">
            <OrbitRing value={p.progress} size={56} color={p.color} />
            <div><div className="text-xs text-muted">Complete</div><div className="text-sm font-semibold">{p.health?.expected != null ? `Plan says ${p.health.expected}%` : 'No deadline set'}</div></div>
          </div>
          <div className="px-5 py-4"><div className="text-xs text-muted">Open tasks</div><div className="font-display text-[28px] font-semibold leading-none">{open}</div><div className="mt-1 text-xs text-muted">{p.counts?.done || 0} finished</div></div>
          <div className="px-5 py-4"><div className="text-xs text-muted">Overdue</div><div className={clsx('font-display text-[28px] font-semibold leading-none', p.overdue && 'text-ember')}>{p.overdue}</div><div className="mt-1 text-xs text-muted">{p.counts?.blocked || 0} blocked</div></div>
          <div className="px-5 py-4"><div className="text-xs text-muted">Time logged</div><div className="font-display text-[28px] font-semibold leading-none">{minutes(p.minutesLogged)}</div><div className="mt-1 text-xs text-muted">{p.daysLeft == null ? 'Open ended' : p.daysLeft < 0 ? `${-p.daysLeft} days late` : `${p.daysLeft} days left`}</div></div>
        </section>

        {(p.reviewPurgeOn || p.reviewPurgedAt) && (
          <section className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-sunken/50 px-4 py-3 text-sm">
            <Trash2 size={16} className="shrink-0 text-muted" />
            <p className="min-w-0 flex-1 text-muted">{p.reviewPurgedAt
              ? <>Review files and pinned feedback were cleared on <b className="text-ink">{fmtDate(p.reviewPurgedAt)}</b> to save storage.</>
              : <>This project is completed. Review files and pinned feedback will be deleted on <b className="text-ink">{fmtDate(p.reviewPurgeOn)}</b>. Download anything you want to keep.</>}</p>
            {!p.reviewPurgedAt && p.canManage && <button type="button" className="btn-ghost btn-sm" onClick={async () => {
              if (!(await confirm({ title: 'Delete review data now?', body: 'Reviewed images and videos, comment images and pinned feedback on this project are removed for good.', danger: true }))) return;
              try { const { data } = await api.post(`/projects/${p.id}/purge-review`); toast.success(`Removed ${data.files} files`); reload(); } catch (err) { toast.error(err.message); }
            }}>Delete now</button>}
          </section>
        )}

        {p.alerts?.length > 0 && (
          <Panel title="Needs attention" icon={AlertTriangle} action={<button type="button" className="btn-ai btn-sm" onClick={() => ask(`How do I get ${p.name} back on track? Look at its overdue and blocked tasks.`)}><Sparkles size={13} />Ask Orbit</button>}>
            <ul className="space-y-2.5">
              {p.alerts.map((a, i) => (
                <li key={i} className="flex gap-3 rounded-xl border border-line p-3">
                  <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: SEV[a.severity] }} />
                  <div className="min-w-0"><p className="text-sm font-semibold">{a.title}</p><p className="text-xs text-muted">{a.detail} {a.suggestion}</p></div>
                </li>
              ))}
            </ul>
          </Panel>
        )}

        <Panel title="Burndown" subtitle="Open tasks each day against a straight line to the deadline">
          <BurndownChart data={p.burndown} />
        </Panel>

        <div className="grid gap-5 md:grid-cols-2">
          <Panel title="Status mix">{p.taskCount ? <StatusDonut data={statusMix} /> : <p className="py-8 text-center text-sm text-muted">No tasks yet.</p>}</Panel>
          <Panel title="Open by priority"><PriorityBars data={p.priorities} /></Panel>
        </div>
      </div>

      <div className="space-y-5">
        <Panel title="Milestones" icon={Flag} subtitle={`${p.Milestones.filter((m) => m.done).length} of ${p.Milestones.length} reached`}>
          <ol className="relative space-y-3 border-l-2 border-line pl-5">
            {p.Milestones.map((m) => (
              <li key={m.id} className="group relative">
                <button type="button" onClick={() => p.canManage && toggleMs(m)} className={clsx('absolute -left-[29px] top-0.5 grid h-4 w-4 rotate-45 place-items-center rounded-[3px] border-2', m.done ? 'border-leaf bg-leaf' : 'border-line bg-surface')} aria-label={m.done ? 'Mark not reached' : 'Mark reached'}>
                  {m.done && <Check size={9} className="-rotate-45 text-white" strokeWidth={4} />}
                </button>
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className={clsx('text-sm font-semibold', m.done && 'text-muted line-through')}>{m.title}</p>
                    <p className="text-xs text-muted">{m.dueDate ? fmtDate(m.dueDate, 'd MMM') : 'No date'}, {m.taskCount} tasks</p>
                    {!m.done && m.taskCount > 0 && <Bar value={m.progress} className="mt-1.5" height={4} color={p.color} />}
                  </div>
                  {p.canManage && <button type="button" onClick={() => delMs(m)} className="rounded p-1 text-faint opacity-0 hover:text-ember group-hover:opacity-100" aria-label="Delete milestone"><Trash2 size={13} /></button>}
                </div>
              </li>
            ))}
            {!p.Milestones.length && <li className="text-sm text-muted">No milestones yet.</li>}
          </ol>
          {p.canManage && (
            <form onSubmit={addMilestone} className="mt-4 flex gap-2">
              <input className="input flex-1" placeholder="New milestone" value={ms.title} onChange={(e) => setMs({ ...ms, title: e.target.value })} />
              <input type="date" className="input !w-36" value={ms.dueDate} onChange={(e) => setMs({ ...ms, dueDate: e.target.value })} aria-label="Milestone date" />
              <button className="btn-ink btn-sm" aria-label="Add milestone"><Plus size={14} /></button>
            </form>
          )}
        </Panel>

        {budgetPct != null && (
          <Panel title="Budget" icon={Wallet}>
            <div className="flex items-end justify-between"><span className="font-display text-2xl font-semibold">{money(p.spent, p.currency)}</span><span className="text-sm text-muted">of {money(p.budget, p.currency)}</span></div>
            <Bar value={Math.min(100, budgetPct)} className="mt-2" color={budgetPct > 100 ? 'rgb(var(--c-ember))' : budgetPct > 85 ? 'rgb(var(--c-amber))' : 'rgb(var(--c-leaf))'} />
            <p className={clsx('mt-2 text-xs', budgetPct > 100 ? 'font-semibold text-ember' : 'text-muted')}>{budgetPct > 100 ? `${budgetPct - 100}% over budget` : `${100 - budgetPct}% left, ${money(p.budget - p.spent, p.currency)}`}</p>
          </Panel>
        )}

        <Panel title="Team load" icon={Users} subtitle="Open tasks in this project">
          {p.workload.length ? (
            <ul className="space-y-3">
              {p.workload.sort((a, b) => b.open - a.open).map((w) => (
                <li key={w.user.id} className="flex items-center gap-3">
                  <Avatar user={w.user} size={28} />
                  <div className="min-w-0 flex-1">
                    <div className="flex justify-between text-sm"><span className="truncate font-medium">{w.user.name}</span><span className="text-muted">{w.open}{w.hours ? `, ${w.hours}h` : ''}</span></div>
                    <Bar value={(w.open / Math.max(...p.workload.map((x) => x.open))) * 100} height={4} color={w.overdue ? 'rgb(var(--c-ember))' : 'rgb(var(--c-cobalt))'} className="mt-1" />
                    {w.overdue > 0 && <p className="mt-0.5 text-[11px] font-semibold text-ember">{w.overdue} overdue</p>}
                  </div>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-muted">Nobody has open work here.</p>}
        </Panel>

        <Panel title="Recent activity" icon={History}>{p.activity.length ? <ActivityFeed items={p.activity.slice(0, 8)} compact /> : <p className="text-sm text-muted">Quiet so far.</p>}</Panel>
      </div>
    </div>
  );
}

function SprintBurn({ sprint }) {
  const { data } = useFetch(`/projects/sprints/${sprint.id}/burndown`);
  if (!data) return <div className="h-[200px] animate-pulse rounded-xl bg-sunken" />;
  return <BurndownChart data={data.points} height={200} label="Points left" />;
}

function Sprints({ p, reload: reloadProject }) {
  const { data, reload } = useFetch(`/projects/${p.id}/sprints`);
  const [form, setForm] = useState(null);
  const [view, setView] = useState(null);
  useLive(['project:changed', 'task:changed'], reload);
  if (!data) return <PageLoader />;
  const active = data.find((s) => s.status === 'active');
  const planned = data.filter((s) => s.status === 'planned');
  const done = data.filter((s) => s.status === 'completed');
  const selected = view ? data.find((s) => s.id === view) : active || planned[0];

  const save = async () => {
    try {
      if (form.id) await api.patch(`/projects/sprints/${form.id}`, form); else await api.post(`/projects/${p.id}/sprints`, form);
      setForm(null); reload();
    } catch (err) { toast.error(err.message); }
  };
  const start = async (s) => { try { await api.post(`/projects/sprints/${s.id}/start`); toast.success(`${s.name} started`); reload(); reloadProject(); } catch (err) { toast.error(err.message); } };
  const complete = async (s) => {
    const left = s.stats.tasks - s.stats.done;
    const ok = await confirm({ title: `Complete ${s.name}?`, body: left ? `${left} unfinished tasks move to the next sprint.` : 'Every task in it is done.', confirmLabel: 'Complete sprint' });
    if (!ok) return;
    try { const r = await api.post(`/projects/sprints/${s.id}/complete`, { moveTo: 'next' }); toast.success(r.data.carriedOver ? `${r.data.carriedOver} tasks moved to ${r.data.movedTo}` : 'Sprint complete'); reload(); reloadProject(); } catch (err) { toast.error(err.message); }
  };
  const remove = async (s) => { if (await confirm({ title: `Delete ${s.name}?`, body: 'Its tasks go back to the backlog.', danger: true })) { await api.delete(`/projects/sprints/${s.id}`); setView(null); reload(); } };

  const Card = ({ s }) => {
    const pct = s.stats.tasks ? Math.round((s.stats.done / s.stats.tasks) * 100) : 0;
    return (
      <button type="button" onClick={() => setView(s.id)} className={clsx('w-full rounded-xl border p-3 text-left transition', selected?.id === s.id ? 'border-ink bg-surface shadow-lift' : 'border-line bg-surface hover:border-muted')}>
        <div className="flex items-center gap-2">
          <span className={clsx('h-2 w-2 rounded-full', s.status === 'active' ? 'bg-cobalt' : s.status === 'completed' ? 'bg-leaf' : 'bg-faint')} />
          <span className="font-semibold">{s.name}</span>
          <span className="ml-auto text-xs text-muted">{fmtDate(s.startDate, 'd MMM')} to {fmtDate(s.endDate, 'd MMM')}</span>
        </div>
        <div className="mt-2 flex items-center gap-2 text-xs text-muted"><Bar value={pct} height={4} /><span className="shrink-0">{s.stats.done}/{s.stats.tasks}, {s.stats.pointsDone}/{s.stats.points} pts</span></div>
      </button>
    );
  };

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
      <div className="space-y-4">
        <button type="button" className="btn-primary w-full" onClick={() => setForm({ name: `Sprint ${data.length + 1}`, goal: '', startDate: toDateInput(new Date()), endDate: toDateInput(new Date(Date.now() + 13 * 864e5)) })}><Plus size={15} />Plan a sprint</button>
        {active && <div><div className="mb-1.5 text-xs font-semibold text-muted">Running</div><Card s={active} /></div>}
        {planned.length > 0 && <div className="space-y-2"><div className="text-xs font-semibold text-muted">Up next</div>{planned.map((s) => <Card key={s.id} s={s} />)}</div>}
        {done.length > 0 && <div className="space-y-2"><div className="text-xs font-semibold text-muted">Finished</div>{done.slice().reverse().map((s) => <Card key={s.id} s={s} />)}</div>}
      </div>
      {!selected ? (
        <div className="panel"><Empty icon={Zap} title="No sprints yet" body="Sprints are two-week pushes. Plan one, drop tasks into it, and track story points as they burn down." /></div>
      ) : (
        <div className="space-y-5">
          <section className="panel p-5">
            <div className="flex flex-wrap items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2"><h2 className="text-xl font-semibold">{selected.name}</h2><span className={clsx('chip', selected.status === 'active' ? 'bg-cobalt/10 text-cobalt' : selected.status === 'completed' ? 'bg-leaf/10 text-leaf' : 'bg-sunken text-muted')}>{selected.status === 'active' ? 'Running' : selected.status === 'completed' ? 'Finished' : 'Planned'}</span></div>
                <p className="mt-1 text-sm text-muted">{selected.goal || 'No goal written.'}</p>
              </div>
              <div className="flex gap-2">
                {selected.status === 'planned' && <button type="button" className="btn-ink btn-sm" onClick={() => start(selected)}><Play size={13} />Start</button>}
                {selected.status === 'active' && <button type="button" className="btn-primary btn-sm" onClick={() => complete(selected)}><CircleCheckBig size={13} />Complete</button>}
                <Menu trigger={<span className="btn-ghost btn-sm"><MoreHorizontal size={15} /></span>} items={[
                  { label: 'Edit sprint', icon: Pencil, onClick: () => setForm({ ...selected, startDate: toDateInput(selected.startDate), endDate: toDateInput(selected.endDate) }) },
                  { label: 'Delete sprint', icon: Trash2, danger: true, onClick: () => remove(selected) },
                ]} />
              </div>
            </div>
            {selected.status === 'completed' && selected.snapshot && <p className="mt-3 rounded-xl bg-sunken px-3 py-2 text-sm">Finished {selected.snapshot.done} of {selected.snapshot.tasks} tasks and {selected.snapshot.pointsDone} of {selected.snapshot.points} points. {selected.snapshot.carriedOver} carried over.</p>}
            {selected.status !== 'planned' && <div className="mt-4"><SprintBurn sprint={selected} key={selected.id} /></div>}
          </section>
          <TaskExplorer key={selected.id} fixed={{ projectId: p.id, sprintId: selected.id }} storageKey={`sprint-${p.id}`} defaultView="board" composeDefaults={{ projectId: p.id, sprintId: selected.id }} sections={p.Sections} />
        </div>
      )}
      <Modal open={!!form} onClose={() => setForm(null)} title={form?.id ? 'Edit sprint' : 'Plan a sprint'} footer={<><button type="button" className="btn-ghost" onClick={() => setForm(null)}>Cancel</button><button type="button" className="btn-primary" onClick={save}>Save</button></>}>
        {form && (
          <div className="space-y-4">
            <Field label="Name"><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="Goal" hint="One sentence the team can rally around."><input className="input" value={form.goal || ''} onChange={(e) => setForm({ ...form, goal: e.target.value })} placeholder="Ship the Diwali campaign creatives" /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Starts"><input type="date" className="input" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} /></Field>
              <Field label="Ends"><input type="date" className="input" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} /></Field>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function ProjectCalendar({ p }) {
  const [month, setMonth] = useState(startOfMonth(new Date()));
  const [tasks, setTasks] = useState([]);
  const openTask = useOpenTask();
  const compose = useComposer();
  const load = () => api.get(`/tasks?projectId=${p.id}`).then((r) => setTasks(r.data));
  useEffect(() => { load(); }, [p.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useLive('task:changed', load, [p.id]);
  const items = useMemo(() => [
    ...tasks.filter((t) => t.dueDate).map((t) => ({ id: t.id, date: t.dueDate, title: t.title, color: STATUS[t.status]?.color, kind: 'task', done: t.status === 'done' })),
    ...p.Milestones.filter((m) => m.dueDate).map((m) => ({ id: m.id, date: `${String(m.dueDate).slice(0, 10)}T09:00`, title: m.title, color: '#C76A00', kind: 'milestone', done: m.done })),
  ], [tasks, p.Milestones]);
  const drop = async (id, day) => {
    const t = tasks.find((x) => x.id === id); if (!t) return;
    const due = new Date(t.dueDate || day); due.setFullYear(day.getFullYear(), day.getMonth(), day.getDate());
    setTasks((ts) => ts.map((x) => (x.id === id ? { ...x, dueDate: due.toISOString() } : x)));
    try { await api.patch(`/tasks/${id}`, { dueDate: due.toISOString() }); toast.success(`Moved to ${format(day, 'd MMM')}`); } catch (err) { toast.error(err.message); load(); }
  };
  return <MonthCalendar month={month} setMonth={setMonth} items={items} onItemClick={(it) => it.kind === 'task' && openTask(it.id)} onSelectDay={(d) => compose({ projectId: p.id, dueDate: new Date(`${format(d, 'yyyy-MM-dd')}T18:00`).toISOString() })} onDropItem={drop} />;
}

function ProjectDocs({ p }) {
  const { data, reload } = useFetch(`/documents?projectId=${p.id}`);
  const nav = useNavigate();
  const create = async () => {
    try { const r = await api.post('/documents', { title: `${p.name} notes`, projectId: p.id, visibility: 'workspace', icon: '📝', content: '' }); nav(`/docs/${r.data.id}`); } catch (err) { toast.error(err.message); }
  };
  void reload;
  if (!data) return <PageLoader />;
  return (
    <div className="space-y-4">
      <div className="flex justify-end"><button type="button" className="btn-primary" onClick={create}><Plus size={15} />New doc</button></div>
      {!data.length ? <div className="panel"><Empty icon={FileText} title="No docs for this project" body="Briefs, meeting notes, brand guidelines. Keep them next to the work." /></div> : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {data.map((d) => (
            <Link key={d.id} to={`/docs/${d.id}`} className="panel flex gap-3 p-4 transition hover:shadow-lift">
              <span className="text-2xl">{d.icon || '📄'}</span>
              <div className="min-w-0"><p className="truncate font-semibold">{d.title}</p><p className="mt-1 text-xs text-muted">Edited {ago(d.updatedAt)}{d.clientVisible ? ', shared with client' : ''}</p></div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ProjectDetail() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = params.get('view') || 'overview';
  const setTab = (v) => { const n = new URLSearchParams(params); n.set('view', v); setParams(n, { replace: true }); };
  const { data: p, reload, error } = useFetch(`/projects/${id}`);
  const { can } = useAuth();
  const compose = useComposer();
  const ask = useAskAi();
  const nav = useNavigate();
  const [edit, setEdit] = useState(false);
  const [tplOpen, setTplOpen] = useState(false);
  const [saveTpl, setSaveTpl] = useState(null);
  useLive(['project:changed', 'task:changed'], (d) => { if (!d?.id || d.id === Number(id) || d.projectId === Number(id)) reload(); }, [id]);

  if (error && !p?.id) return <div className="panel"><Empty icon={AlertTriangle} title="Can't open this project" body={error} action={<Link to="/projects" className="btn-ghost">Back to projects</Link>} /></div>;
  if (!p?.id) return <PageLoader />;

  const addSection = async (name) => { await api.post(`/projects/${p.id}/sections`, { name }); reload(); };
  const archive = async () => {
    if (!(await confirm({ title: `Archive ${p.name}?`, body: 'It disappears from lists but nothing is deleted. You can restore it from the archived filter.' }))) return;
    await api.patch(`/projects/${p.id}`, { status: 'archived' }); refreshProjects(); nav('/projects');
  };

  return (
    <div>
      <Link to="/projects" className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink"><ArrowLeft size={15} />Projects</Link>
      <header className="relative mb-5 overflow-hidden rounded-3xl border border-line bg-surface">
        <div className="absolute inset-y-0 left-0 w-1.5" style={{ background: p.color }} />
        <div className="pointer-events-none absolute -right-16 -top-24 h-64 w-64 rounded-full opacity-[0.12]" style={{ background: `radial-gradient(circle, ${p.color}, transparent 70%)` }} />
        <div className="relative flex flex-wrap items-start gap-4 p-5 pl-7 sm:p-6 sm:pl-8">
          <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl text-3xl" style={{ background: `${p.color}1F` }}>{p.icon || '📁'}</span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
              <span className="font-semibold text-ink">{p.code}</span>
              {p.Client ? <Link to={`/clients/${p.Client.id}`} className="hover:underline">{p.Client.name}</Link> : <span>Internal</span>}
              <HealthBadge state={p.health?.state} score={p.health?.score} />
              {p.activeSprint && <button type="button" onClick={() => setTab('sprints')} className="chip bg-cobalt/10 text-cobalt"><Zap size={11} />{p.activeSprint.name}</button>}
            </div>
            <h1 className="mt-1 text-[26px] font-semibold leading-tight sm:text-3xl">{p.name}</h1>
            {p.description && <p className="mt-1 max-w-3xl text-sm text-muted">{p.description}</p>}
            <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
              <span className="flex items-center gap-2"><Avatar user={p.owner} size={22} /><span className="text-muted">Lead</span><span className="font-medium">{p.owner?.name}</span></span>
              <AvatarStack users={p.members} max={6} size={24} />
              <span className="flex items-center gap-1.5 text-muted"><CalendarDays size={14} />{fmtDate(p.startDate, 'd MMM')} to {p.dueDate ? fmtDate(p.dueDate, 'd MMM yyyy') : 'open'}</span>
              <span className="flex items-center gap-1.5 text-muted"><Clock size={14} />{minutes(p.minutesLogged)} logged</span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-ai" onClick={() => ask(`Give me a status update on ${p.name}: what's done, what's at risk, and what should happen this week.`, { projectId: p.id })}><Sparkles size={15} />Ask about it</button>
            {can('tasks.create') && <button type="button" className="btn-primary" onClick={() => compose({ projectId: p.id })}><Plus size={16} />Task</button>}
            {p.canManage && (
              <Menu trigger={<span className="btn-ghost"><MoreHorizontal size={16} /></span>} items={[
                { label: 'Edit project', icon: Pencil, onClick: () => setEdit(true) },
                { label: 'Add tasks from a template', icon: LayoutTemplate, onClick: () => setTplOpen(true) },
                { label: 'Save as template', icon: Diamond, onClick: () => setSaveTpl({ name: `${p.name} template`, description: '' }) },
                { label: 'Export tasks (CSV)', icon: FileText, onClick: () => download(`/tools/export/tasks.csv?projectId=${p.id}`, `${p.code}-tasks.csv`).catch((e) => toast.error(e.message)) },
                { label: 'Archive project', icon: Trash2, danger: true, onClick: archive },
              ]} />
            )}
          </div>
        </div>
        <div className="relative h-1.5 bg-sunken"><div className="h-full transition-all" style={{ width: `${p.progress}%`, background: p.color }} /></div>
      </header>

      <div className="mb-5"><Tabs value={tab} onChange={setTab} tabs={[
        { value: 'overview', label: 'Overview', icon: LayoutDashboard },
        { value: 'list', label: 'List', icon: List, count: p.taskCount },
        { value: 'board', label: 'Pipeline', icon: Columns3 },
        { value: 'timeline', label: 'Timeline', icon: CalendarRange },
        { value: 'calendar', label: 'Calendar', icon: CalendarDays },
        { value: 'sprints', label: 'Sprints', icon: Zap },
        { value: 'docs', label: 'Docs', icon: FileText, count: p.docCount || null },
        { value: 'activity', label: 'Activity', icon: History },
      ]} /></div>

      {tab === 'overview' && <Overview p={p} reload={reload} />}
      {tab === 'list' && <TaskExplorer fixed={{ projectId: p.id }} storageKey={`p-list-${p.id}`} defaultView="list" defaultGroup={p.Sections.length ? 'section' : 'status'} composeDefaults={{ projectId: p.id }} sections={p.Sections} onAddSection={addSection} />}
      {tab === 'board' && <Pipeline project={p} reloadProject={reload} />}
      {tab === 'timeline' && <Gantt projectId={p.id} />}
      {tab === 'calendar' && <ProjectCalendar p={p} />}
      {tab === 'sprints' && <Sprints p={p} reload={reload} />}
      {tab === 'docs' && <ProjectDocs p={p} />}
      {tab === 'activity' && <div className="panel p-5">{p.activity.length ? <ActivityFeed items={p.activity} /> : <Empty icon={History} title="No activity yet" />}</div>}

      <ProjectForm open={edit} onClose={() => setEdit(false)} project={p} onSaved={() => { setEdit(false); reload(); refreshProjects(); }} />
      <ApplyTemplate open={tplOpen} onClose={() => setTplOpen(false)} project={p} onDone={reload} />
      <Modal open={!!saveTpl} onClose={() => setSaveTpl(null)} title="Save as template" subtitle="Sections, milestones and the task tree are copied. Dates become offsets from the start."
        footer={<><button type="button" className="btn-ghost" onClick={() => setSaveTpl(null)}>Cancel</button><button type="button" className="btn-primary" onClick={async () => { try { await api.post('/tools/templates', { ...saveTpl, fromProjectId: p.id }); toast.success('Template saved'); setSaveTpl(null); } catch (err) { toast.error(err.message); } }}>Save template</button></>}>
        {saveTpl && <div className="space-y-4"><Field label="Name"><input className="input" value={saveTpl.name} onChange={(e) => setSaveTpl({ ...saveTpl, name: e.target.value })} /></Field><Field label="Description"><textarea className="input" rows={3} value={saveTpl.description} onChange={(e) => setSaveTpl({ ...saveTpl, description: e.target.value })} /></Field></div>}
      </Modal>
    </div>
  );
}

function ApplyTemplate({ open, onClose, project, onDone }) {
  const { data } = useFetch(open ? '/tools/templates' : null);
  const [pick, setPick] = useState(null);
  const [busy, setBusy] = useState(false);
  const [start, setStart] = useState(toDateInput(new Date()));
  const apply = async () => {
    setBusy(true);
    try { const r = await api.post(`/projects/${project.id}/apply`, { templateId: pick, startDate: start }); toast.success(`Added ${r.data.created} tasks`); onClose(); onDone(); } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Add tasks from a template" width="max-w-2xl"
      footer={<><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button type="button" className="btn-primary" disabled={!pick || busy} onClick={apply}>{busy && <Spinner size={14} className="text-ink" />}Add to {project.code}</button></>}>
      {!data ? <PageLoader /> : (
        <div className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-2">
            {data.map((t) => (
              <button key={t.id} type="button" onClick={() => setPick(t.id)} className={clsx('rounded-xl border p-3 text-left transition', pick === t.id ? 'border-ink bg-brand-soft/40' : 'border-line hover:border-muted')}>
                <div className="flex items-center gap-2"><span className="text-lg">{t.icon || '📋'}</span><span className="font-semibold">{t.name}</span></div>
                <p className="mt-1 line-clamp-2 text-xs text-muted">{t.description}</p>
                <p className="mt-1.5 text-[11px] text-faint">{t.taskCount ?? '?'} tasks</p>
              </button>
            ))}
          </div>
          <Field label="Count days from"><input type="date" className="input sm:w-48" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
        </div>
      )}
    </Modal>
  );
}

