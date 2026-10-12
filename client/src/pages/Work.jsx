import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import { addDays, endOfMonth, endOfWeek, format, isSameDay, startOfMonth, startOfWeek } from 'date-fns';
import { ArrowLeft, Plus, Video, Diamond, CheckCircle2, History } from 'lucide-react';
import api from '../lib/api';
import { useLive } from '../context/AuthContext';
import { useProjects, useDirectory } from '../lib/directory';
import { PageHeader, PageLoader, Segmented, Avatar, Empty, StatusPill } from '../components/ui';
import TaskExplorer from '../components/TaskExplorer';
import TaskPanel from '../components/TaskPanel';
import MonthCalendar from '../components/MonthCalendar';
import { useComposer, useOpenTask } from '../components/Layout';
import { ActivityFeed } from './Dashboard';
import { STATUS, fmtTime } from '../lib/format';

export function Board() {
  const compose = useComposer();
  return (
    <div>
      <PageHeader title="Board" subtitle="Every task you can see, across projects. Drag cards to change status." actions={<button type="button" className="btn-primary" onClick={() => compose()}><Plus size={16} />New task</button>} />
      <TaskExplorer syncUrl storageKey="board" defaultView="board" defaultGroup="status" />
    </div>
  );
}

export function Calendar() {
  const [month, setMonth] = useState(startOfMonth(new Date()));
  const [show, setShow] = useState('all');
  const [mine, setMine] = useState('all');
  const [sel, setSel] = useState(new Date());
  const [data, setData] = useState(null);
  const projects = useProjects();
  const openTask = useOpenTask();
  const compose = useComposer();
  const nav = useNavigate();
  const from = startOfWeek(startOfMonth(month), { weekStartsOn: 1 });
  const to = addDays(endOfWeek(endOfMonth(month), { weekStartsOn: 1 }), 1);

  const load = async () => {
    const [tasks, meetings, details] = await Promise.all([
      api.get(`/tasks?from=${from.toISOString()}&to=${to.toISOString()}${mine === 'me' ? '&assignee=me' : ''}`).then((r) => r.data),
      api.get(`/meetings?from=${from.toISOString()}&to=${to.toISOString()}`).then((r) => r.data).catch(() => []),
      Promise.all(projects.slice(0, 20).map((p) => api.get(`/projects/${p.id}/timeline`).then((r) => r.data.milestones.map((m) => ({ ...m, project: p }))).catch(() => []))),
    ]);
    setData({ tasks, meetings, milestones: details.flat() });
  };
  useEffect(() => { load(); }, [month, mine, projects.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useLive(['task:changed', 'meeting:changed'], load, [month, mine, projects.length]);

  const items = useMemo(() => {
    if (!data) return [];
    const out = [];
    if (show !== 'meetings') data.tasks.filter((t) => t.dueDate).forEach((t) => out.push({ id: t.id, date: t.dueDate, title: t.title, color: t.Project?.color || STATUS[t.status]?.color, kind: 'task', done: t.status === 'done', t }));
    if (show !== 'tasks') data.meetings.forEach((m) => out.push({ id: m.id, date: m.startAt, title: m.title, color: '#8B5CF6', kind: 'meeting', m }));
    if (show === 'all') data.milestones.filter((m) => m.dueDate).forEach((m) => out.push({ id: m.id, date: `${String(m.dueDate).slice(0, 10)}T09:00`, title: m.title, color: '#C76A00', kind: 'milestone', done: m.done, p: m.project }));
    return out;
  }, [data, show]);
  const day = items.filter((i) => isSameDay(new Date(i.date), sel)).sort((a, b) => new Date(a.date) - new Date(b.date));

  const drop = async (id, d) => {
    const t = data.tasks.find((x) => x.id === id); if (!t) return;
    const due = new Date(t.dueDate || d); due.setFullYear(d.getFullYear(), d.getMonth(), d.getDate());
    setData((s) => ({ ...s, tasks: s.tasks.map((x) => (x.id === id ? { ...x, dueDate: due.toISOString() } : x)) }));
    try { await api.patch(`/tasks/${id}`, { dueDate: due.toISOString() }); toast.success(`Moved to ${format(d, 'd MMM')}`); } catch (err) { toast.error(err.message); load(); }
  };
  const click = (it) => { if (it.kind === 'task') openTask(it.id); else if (it.kind === 'meeting') nav(`/meetings?id=${it.id}`); else nav(`/projects/${it.p.id}`); };

  return (
    <div>
      <PageHeader title="Calendar" subtitle="Deadlines, meetings and milestones in one place. Drag a task to another day to reschedule it." />
      <div className="mb-4 flex flex-wrap gap-2">
        <Segmented value={show} onChange={setShow} options={[{ value: 'all', label: 'Everything' }, { value: 'tasks', label: 'Tasks' }, { value: 'meetings', label: 'Meetings' }]} />
        <Segmented value={mine} onChange={setMine} options={[{ value: 'all', label: 'All I can see' }, { value: 'me', label: 'Assigned to me' }]} />
      </div>
      {!data ? <PageLoader /> : (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
          <MonthCalendar month={month} setMonth={setMonth} items={items} selected={sel} onSelectDay={setSel} onItemClick={click} onDropItem={drop} />
          <aside className="panel h-fit p-5">
            <div className="flex items-center"><h2 className="section-title">{format(sel, 'EEEE, d MMM')}</h2><button type="button" className="btn-ghost btn-sm ml-auto" onClick={() => compose({ dueDate: new Date(`${format(sel, 'yyyy-MM-dd')}T18:00`).toISOString() })}><Plus size={13} />Task</button></div>
            {!day.length ? <p className="py-8 text-center text-sm text-muted">Nothing on this day.</p> : (
              <ul className="mt-3 space-y-2">
                {day.map((it) => (
                  <li key={`${it.kind}${it.id}`}>
                    <button type="button" onClick={() => click(it)} className="flex w-full items-start gap-3 rounded-xl border border-line p-3 text-left hover:border-muted">
                      <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg" style={{ background: `${it.color}1F`, color: it.color }}>{it.kind === 'meeting' ? <Video size={14} /> : it.kind === 'milestone' ? <Diamond size={14} /> : <CheckCircle2 size={14} />}</span>
                      <span className="min-w-0 flex-1">
                        <span className={clsx('block text-sm font-medium', it.done && 'text-muted line-through')}>{it.title}</span>
                        <span className="mt-0.5 block text-xs text-muted">{it.kind === 'meeting' ? `${fmtTime(it.m.startAt)}, ${it.m.attendees.length} people` : it.kind === 'milestone' ? `Milestone in ${it.p.name}` : `${it.t.key}${it.t.Project ? `, ${it.t.Project.name}` : ''}`}</span>
                        {it.kind === 'task' && <span className="mt-1.5 flex items-center gap-2"><StatusPill status={it.t.status} small />{it.t.assignees?.slice(0, 3).map((a) => <Avatar key={a.id} user={a} size={18} />)}</span>}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}

export function ActivityPage() {
  const people = useDirectory();
  const projects = useProjects();
  const [f, setF] = useState({ projectId: '', userId: '' });
  const [items, setItems] = useState(null);
  const [more, setMore] = useState(true);
  const q = (before) => `/activity?${new URLSearchParams(Object.fromEntries(Object.entries({ ...f, before }).filter(([, v]) => v)))}`;
  const load = () => api.get(q()).then((r) => { setItems(r.data); setMore(r.data.length === 60); });
  useEffect(() => { load(); }, [f]); // eslint-disable-line react-hooks/exhaustive-deps
  useLive('activity', load, [f]);
  const older = async () => { const r = await api.get(q(items[items.length - 1].createdAt)); setItems((s) => [...s, ...r.data]); setMore(r.data.length === 60); };
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Activity" subtitle="Everything happening across the work you can see." />
      <div className="mb-4 flex flex-wrap gap-2">
        <select className="input !w-auto" value={f.projectId} onChange={(e) => setF({ ...f, projectId: e.target.value })}><option value="">All projects</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        <select className="input !w-auto" value={f.userId} onChange={(e) => setF({ ...f, userId: e.target.value })}><option value="">Everyone</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
      </div>
      <div className="panel p-6">
        {!items ? <PageLoader /> : !items.length ? <Empty icon={History} title="No activity" /> : <ActivityFeed items={items} />}
        {items && more && items.length > 0 && <div className="mt-6 text-center"><button type="button" className="btn-ghost btn-sm" onClick={older}>Load older</button></div>}
      </div>
    </div>
  );
}

export function TaskPage() {
  const { id } = useParams();
  const nav = useNavigate();
  return (
    <div className="mx-auto max-w-5xl">
      <button type="button" onClick={() => (window.history.length > 1 ? nav(-1) : nav('/my-tasks'))} className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink"><ArrowLeft size={15} />Back</button>
      <div className="panel overflow-hidden"><TaskPanel id={Number(id)} onClose={() => nav('/my-tasks')} /></div>
    </div>
  );
}

