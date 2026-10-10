import { useEffect, useMemo, useState } from 'react';
import { Columns3, List, Search, CheckSquare } from 'lucide-react';
import api from '../lib/api';
import { useLive, useAuth } from '../context/AuthContext';
import { useDirectory, useProjects } from '../lib/directory';
import { PRIORITY } from '../lib/format';
import { Segmented, PageLoader, Empty } from './ui';
import { Kanban, TaskTable } from './TaskViews';
import { useComposer } from './Layout';

const saved = (k, d) => { try { return localStorage.getItem(k) || d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };

/**
 * Filterable task list/board.
 * fixed: query params that are always applied (e.g. { assignee: 'me' } or { projectId: 3 })
 */
export default function TaskExplorer({ fixed = {}, storageKey = 'tasks', defaultView = 'list', composeDefaults = {} }) {
  const { can } = useAuth();
  const people = useDirectory();
  const projects = useProjects();
  const compose = useComposer();
  const [view, setView] = useState(() => saved(`orbit:view:${storageKey}`, defaultView));
  const [f, setF] = useState({ q: '', projectId: '', assignee: '', priority: '', due: '', hideDone: '1' });
  const [tasks, setTasks] = useState(null);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    Object.entries({ ...f, ...fixed }).forEach(([k, v]) => v !== '' && v != null && p.set(k, v));
    // In list view show top-level tasks as trees, unless we're looking at one person's work.
    if (view === 'list' && !p.get('assignee') && !p.get('q') && !p.get('due')) p.set('parentId', 'root');
    if (view === 'board') p.delete('hideDone');
    return p.toString();
  }, [f, fixed, view]);

  const load = () => api.get(`/tasks?${query}`).then((r) => setTasks(r.data)).catch(() => setTasks([]));
  useEffect(() => { load(); }, [query]); // eslint-disable-line react-hooks/exhaustive-deps
  useLive('task:changed', load, [query]);
  useEffect(() => { const h = () => load(); window.addEventListener('orbit:task-created', h); return () => window.removeEventListener('orbit:task-created', h); }, [query]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  const changeView = (v) => { setView(v); save(`orbit:view:${storageKey}`, v); };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[180px] flex-1 sm:max-w-xs">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mist" />
          <input className="input pl-9" placeholder="Filter tasks" value={f.q} onChange={set('q')} />
        </div>
        {fixed.projectId === undefined && (
          <select className="input !w-auto" value={f.projectId} onChange={set('projectId')} aria-label="Project">
            <option value="">All projects</option><option value="none">Personal</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
        {fixed.assignee === undefined && (
          <select className="input !w-auto" value={f.assignee} onChange={set('assignee')} aria-label="Assignee">
            <option value="">Everyone</option><option value="me">Assigned to me</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
        <select className="input !w-auto" value={f.priority} onChange={set('priority')} aria-label="Priority">
          <option value="">Any priority</option>
          {Object.entries(PRIORITY).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <select className="input !w-auto" value={f.due} onChange={set('due')} aria-label="Due">
          <option value="">Any due date</option><option value="overdue">Overdue</option><option value="today">Due today</option><option value="week">Due this week</option>
        </select>
        {view === 'list' && (
          <label className="flex items-center gap-2 px-1 text-xs text-mist">
            <input type="checkbox" className="accent-[#3DE0F2]" checked={f.hideDone === '1'} onChange={(e) => setF((s) => ({ ...s, hideDone: e.target.checked ? '1' : '' }))} />Hide done
          </label>
        )}
        <div className="ml-auto"><Segmented value={view} onChange={changeView} options={[{ value: 'list', label: 'List', icon: List }, { value: 'board', label: 'Board', icon: Columns3 }]} /></div>
      </div>

      {!tasks ? <PageLoader /> : !tasks.length && view === 'list' ? (
        <div className="panel"><Empty icon={CheckSquare} title="No tasks here" body="Nothing matches these filters. Clear a filter or create a task."
          action={can('tasks.create') && <button type="button" className="btn-primary" onClick={() => compose({ ...composeDefaults })}>New task</button>} /></div>
      ) : view === 'board'
        ? <Kanban tasks={tasks} setTasks={setTasks} defaults={composeDefaults} />
        : <TaskTable tasks={tasks} setTasks={setTasks} showProject={fixed.projectId === undefined} />}
    </div>
  );
}
