import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import clsx from 'clsx';
import { ChevronRight, Plus, CalendarRange, UserCheck, PenLine, Bell } from 'lucide-react';
import { isToday, isPast, differenceInCalendarDays } from 'date-fns';
import api from '../lib/api';
import { useLive } from '../context/AuthContext';
import { PageHeader, Tabs, PageLoader, Empty, DueBadge, PriorityFlag, StatusPill, Avatar } from '../components/ui';
import TaskExplorer from '../components/TaskExplorer';
import { useComposer, useOpenTask } from '../components/Layout';
import { changeStatus } from '../components/TaskViews';

const BUCKETS = [
  { key: 'overdue', label: 'Overdue', color: '#E5484D' },
  { key: 'today', label: 'Today', color: '#F08C00' },
  { key: 'week', label: 'Next 7 days', color: '#3D5AFE' },
  { key: 'later', label: 'Later', color: '#8B5CF6' },
  { key: 'none', label: 'No due date', color: '#8D94B3' },
];
const bucketOf = (t) => {
  if (!t.dueDate) return 'none';
  const d = new Date(t.dueDate);
  if (isPast(d) && !isToday(d)) return 'overdue';
  if (isPast(d) || isToday(d)) return isToday(d) ? 'today' : 'overdue';
  return differenceInCalendarDays(d, new Date()) <= 7 ? 'week' : 'later';
};

function Agenda() {
  const [tasks, setTasks] = useState(null);
  const [closed, setClosed] = useState({});
  const openTask = useOpenTask();
  const compose = useComposer();
  const load = () => api.get('/tasks?assignee=me&hideDone=1').then((r) => setTasks(r.data));
  useEffect(() => { load(); }, []);
  useLive('task:changed', load);
  useEffect(() => { const h = () => load(); window.addEventListener('orbit:task-created', h); return () => window.removeEventListener('orbit:task-created', h); }, []);
  const groups = useMemo(() => BUCKETS.map((b) => ({ ...b, tasks: (tasks || []).filter((t) => bucketOf(t) === b.key).sort((a, c) => new Date(a.dueDate || 0) - new Date(c.dueDate || 0)) })), [tasks]);
  if (!tasks) return <PageLoader />;
  if (!tasks.length) return <div className="panel"><Empty icon={UserCheck} title="Nothing assigned to you" body="When someone gives you a task it shows up here, sorted by when it's due." action={<button type="button" className="btn-primary" onClick={() => compose()}>Add a task for yourself</button>} /></div>;
  const done = async (t) => { setTasks((ts) => ts.filter((x) => x.id !== t.id)); await changeStatus(t, 'done').catch(() => load()); };
  return (
    <div className="space-y-4">
      {groups.filter((g) => g.tasks.length).map((g) => (
        <section key={g.key} className="panel overflow-hidden">
          <button type="button" onClick={() => setClosed((c) => ({ ...c, [g.key]: !c[g.key] }))} className="flex w-full items-center gap-2 px-4 py-3 text-left">
            <ChevronRight size={16} className={clsx('text-muted transition', !closed[g.key] && 'rotate-90')} />
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: g.color }} />
            <span className="font-display font-semibold">{g.label}</span><span className="text-sm text-muted">{g.tasks.length}</span>
          </button>
          {!closed[g.key] && (
            <ul className="border-t border-line">
              {g.tasks.map((t) => (
                <li key={t.id} className="group flex items-center gap-3 border-b border-line/70 px-4 py-2.5 last:border-0 hover:bg-sunken/50">
                  <button type="button" onClick={() => done(t)} className="grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 border-line text-transparent transition hover:border-leaf hover:text-leaf" aria-label={`Complete ${t.key}`}>✓</button>
                  <button type="button" onClick={() => openTask(t.id)} className="min-w-0 flex-1 text-left">
                    <span className="block truncate text-sm font-medium">{t.title}</span>
                    <span className="flex items-center gap-2 text-xs text-faint">{t.key}{t.Project && <span className="inline-flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full" style={{ background: t.Project.color }} />{t.Project.name}</span>}{t.parentId ? <span>subtask</span> : null}</span>
                  </button>
                  <PriorityFlag priority={t.priority} />
                  <span className="hidden w-32 sm:block"><DueBadge date={t.dueDate} compact /></span>
                  <span className="hidden md:block"><StatusPill status={t.status} small /></span>
                  <span className="hidden lg:flex">{t.assignees.filter((a) => a).slice(0, 3).map((a) => <Avatar key={a.id} user={a} size={20} ring />)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}

export default function MyTasks() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'agenda';
  const compose = useComposer();
  const setTab = (t) => { const p = new URLSearchParams(params); p.set('tab', t); setParams(p); };
  return (
    <div>
      <PageHeader title="My tasks" subtitle="Everything on your plate, at any level of a task tree." actions={<button type="button" className="btn-primary" onClick={() => compose()}><Plus size={16} />New task</button>} />
      <div className="mb-4"><Tabs value={tab} onChange={setTab} tabs={[
        { value: 'agenda', label: 'Agenda', icon: CalendarRange },
        { value: 'assigned', label: 'All assigned', icon: UserCheck },
        { value: 'created', label: 'Created by me', icon: PenLine },
        { value: 'watching', label: 'Watching', icon: Bell },
      ]} /></div>
      {tab === 'agenda' && <Agenda />}
      {tab === 'assigned' && <TaskExplorer fixed={{ assignee: 'me' }} storageKey="mine" defaultGroup="project" />}
      {tab === 'created' && <TaskExplorer fixed={{ createdBy: 'me' }} storageKey="created" defaultGroup="status" />}
      {tab === 'watching' && <TaskExplorer fixed={{ watching: 'me' }} storageKey="watching" defaultGroup="project" />}
    </div>
  );
}
