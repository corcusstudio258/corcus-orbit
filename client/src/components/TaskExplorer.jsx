import { useEffect, useMemo, useState } from 'react';
import { Columns3, List, Search, CheckSquare, SlidersHorizontal } from 'lucide-react';
import api from '../lib/api';
import { useLive, useAuth } from '../context/AuthContext';
import { useDirectory, useProjects } from '../lib/directory';
import { PRIORITY } from '../lib/format';
import { Segmented, PageLoader, Empty, Toggle } from './ui';
import { Kanban, TaskTable, GROUP_OPTIONS } from './TaskViews';
import { useComposer } from './Layout';

const saved = (k, d) => { try { return localStorage.getItem(k) || d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };

/**
 * Filterable task list/board.
 * fixed: query params always applied (e.g. { assignee: 'me' } or { projectId: 3 })
 */
export default function TaskExplorer({ fixed = {}, storageKey = 'tasks', defaultView = 'list', defaultGroup = 'status', composeDefaults = {}, sections, onAddSection, extraFilters }) {
  const { can } = useAuth();
  const people = useDirectory();
  const projects = useProjects();
  const compose = useComposer();
  const [view, setView] = useState(() => saved(`orbit:view:${storageKey}`, defaultView));
  const [groupBy, setGroupBy] = useState(() => saved(`orbit:group:${storageKey}`, defaultGroup));
  const [f, setF] = useState({ q: '', projectId: '', assignee: '', priority: '', due: '', showDone: false });
  const [tasks, setTasks] = useState(null);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    Object.entries({ ...f, ...fixed }).forEach(([k, v]) => { if (v !== '' && v != null && k !== 'showDone') p.set(k, v); });
    const flat = p.get('assignee') || p.get('q') || p.get('due') || fixed.sprintId !== undefined;
    if (view === 'list' && !flat) p.set('parentId', 'root');
    if (!f.showDone && view === 'list') p.set('hideDone', '1');
    return p.toString();
  }, [f, fixed, view]);

  const load = () => api.get(`/tasks?${query}`).then((r) => setTasks(r.data.sort((a, b) => a.position - b.position))).catch(() => setTasks([]));
  useEffect(() => { load(); }, [query]); // eslint-disable-line react-hooks/exhaustive-deps
  useLive('task:changed', load, [query]);
  useEffect(() => { const h = () => load(); window.addEventListener('orbit:task-created', h); return () => window.removeEventListener('orbit:task-created', h); }, [query]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e?.target ? e.target.value : e }));
  const changeView = (v) => { setView(v); save(`orbit:view:${storageKey}`, v); };
  const changeGroup = (g) => { setGroupBy(g); save(`orbit:group:${storageKey}`, g); };
  const groupOptions = GROUP_OPTIONS(!!sections?.length || !!onAddSection, fixed.projectId !== undefined);
  const activeFilters = ['projectId', 'assignee', 'priority', 'due'].filter((k) => f[k]).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[180px] flex-1 sm:max-w-xs">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input className="input pl-9" placeholder="Filter tasks" value={f.q} onChange={set('q')} />
        </div>
        <button type="button" onClick={() => setFiltersOpen((o) => !o)} className={activeFilters ? 'btn-ink' : 'btn-ghost'}><SlidersHorizontal size={15} />Filters{activeFilters ? ` (${activeFilters})` : ''}</button>
        {extraFilters}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-xs font-semibold text-muted">Group
            <select className="input !w-auto !py-1.5 text-xs" value={groupOptions.some((o) => o.value === groupBy) ? groupBy : 'status'} onChange={(e) => changeGroup(e.target.value)}>
              {view === 'list' && <option value="">None</option>}
              {groupOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <Segmented value={view} onChange={changeView} options={[{ value: 'list', label: 'List', icon: List }, { value: 'board', label: 'Board', icon: Columns3 }]} />
        </div>
      </div>
      {filtersOpen && (
        <div className="panel flex flex-wrap items-end gap-3 p-3">
          {fixed.projectId === undefined && (
            <label className="block"><span className="label">Project</span>
              <select className="input !w-auto" value={f.projectId} onChange={set('projectId')}><option value="">All projects</option><option value="none">Personal</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
            </label>
          )}
          {fixed.assignee === undefined && (
            <label className="block"><span className="label">Assignee</span>
              <select className="input !w-auto" value={f.assignee} onChange={set('assignee')}><option value="">Everyone</option><option value="me">Me</option><option value="none">Unassigned</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
            </label>
          )}
          <label className="block"><span className="label">Priority</span>
            <select className="input !w-auto" value={f.priority} onChange={set('priority')}><option value="">Any</option>{Object.entries(PRIORITY).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
          </label>
          <label className="block"><span className="label">Due</span>
            <select className="input !w-auto" value={f.due} onChange={set('due')}><option value="">Any time</option><option value="overdue">Overdue</option><option value="today">Due today</option><option value="week">Next 7 days</option><option value="none">No due date</option></select>
          </label>
          {view === 'list' && <div className="w-44 pb-2"><Toggle checked={f.showDone} onChange={(v) => setF((s) => ({ ...s, showDone: v }))} label="Show done" /></div>}
          <button type="button" className="btn-soft btn-sm mb-1" onClick={() => setF({ q: '', projectId: '', assignee: '', priority: '', due: '', showDone: false })}>Clear</button>
        </div>
      )}

      {!tasks ? <PageLoader /> : !tasks.length && view === 'list' ? (
        <div className="panel"><Empty icon={CheckSquare} title="Nothing here yet" body="No tasks match. Clear a filter, or add the first one."
          action={can('tasks.create') && <button type="button" className="btn-primary" onClick={() => compose({ ...composeDefaults })}>New task</button>} /></div>
      ) : view === 'board'
        ? <Kanban tasks={tasks} setTasks={setTasks} groupBy={groupOptions.some((o) => o.value === groupBy) ? groupBy || 'status' : 'status'} sections={sections} defaults={composeDefaults} onAddSection={onAddSection} reload={load} />
        : <TaskTable tasks={tasks} setTasks={setTasks} showProject={fixed.projectId === undefined} groupBy={groupBy} sections={sections} defaults={composeDefaults} reload={load} />}
    </div>
  );
}
