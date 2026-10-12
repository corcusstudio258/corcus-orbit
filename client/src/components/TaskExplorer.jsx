import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import clsx from 'clsx';
import { endOfMonth, endOfWeek, format, startOfMonth, startOfWeek, addWeeks } from 'date-fns';
import { Columns3, List, Search, CheckSquare, SlidersHorizontal, X, CalendarRange } from 'lucide-react';
import api from '../lib/api';
import { useLive, useAuth } from '../context/AuthContext';
import { useDirectory, useProjects } from '../lib/directory';
import { PRIORITY, STATUS, STATUS_ORDER } from '../lib/format';
import { Segmented, PageLoader, Empty, Toggle } from './ui';
import { Kanban, TaskTable, GROUP_OPTIONS } from './TaskViews';
import { useComposer } from './Layout';

const saved = (k, d) => { try { return localStorage.getItem(k) || d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };

/**
 * Filterable task list/board.
 * fixed: query params always applied (e.g. { assignee: 'me' } or { projectId: 3 })
 */
const FILTER_KEYS = ['q', 'projectId', 'assignee', 'priority', 'due', 'status', 'from', 'to'];
const BLANK = { q: '', projectId: '', assignee: '', priority: '', due: '', status: '', from: '', to: '', showDone: false };
const DUE_LABEL = { overdue: 'Overdue', today: 'Due today', week: 'Next 7 days', none: 'No due date' };

export default function TaskExplorer({ fixed = {}, storageKey = 'tasks', defaultView = 'list', defaultGroup = 'status', composeDefaults = {}, sections, onAddSection, extraFilters, syncUrl = false }) {
  const [params, setParams] = useSearchParams();
  const { can } = useAuth();
  const people = useDirectory();
  const projects = useProjects();
  const compose = useComposer();
  const [view, setView] = useState(() => saved(`orbit:view:${storageKey}`, defaultView));
  const [groupBy, setGroupBy] = useState(() => saved(`orbit:group:${storageKey}`, defaultGroup));
  const [f, setF] = useState(() => {
    if (!syncUrl) return BLANK;
    const init = { ...BLANK };
    FILTER_KEYS.forEach((k) => { if (params.get(k)) init[k] = params.get(k); });
    if (params.get('showDone') === '1') init.showDone = true;
    return init;
  });
  const [tasks, setTasks] = useState(null);
  const [filtersOpen, setFiltersOpen] = useState(() => syncUrl && FILTER_KEYS.some((k) => k !== 'q' && params.get(k)));
  useEffect(() => {
    if (!syncUrl) return;
    const next = new URLSearchParams(params);
    FILTER_KEYS.forEach((k) => { if (f[k]) next.set(k, f[k]); else next.delete(k); });
    if (f.showDone) next.set('showDone', '1'); else next.delete('showDone');
    if (next.toString() !== params.toString()) setParams(next, { replace: true });
  }, [f]); // eslint-disable-line react-hooks/exhaustive-deps

  const query = useMemo(() => {
    const p = new URLSearchParams();
    Object.entries({ ...f, ...fixed }).forEach(([k, v]) => { if (v !== '' && v != null && !['showDone', 'from', 'to'].includes(k)) p.set(k, v); });
    if (f.from) p.set('from', new Date(`${f.from}T00:00:00`).toISOString());
    if (f.to) p.set('to', new Date(`${f.to}T23:59:59`).toISOString());
    const flat = p.get('assignee') || p.get('q') || p.get('due') || p.get('status') || f.from || f.to || fixed.sprintId !== undefined;
    if (view === 'list' && !flat) p.set('parentId', 'root');
    if (!f.showDone && view === 'list' && !String(f.status).includes('done')) p.set('hideDone', '1');
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
  const activeFilters = ['projectId', 'assignee', 'priority', 'due', 'status', 'from', 'to'].filter((k) => f[k]).length;
  const statuses = f.status ? f.status.split(',') : [];
  const toggleStatus = (st) => setF((x) => { const cur = x.status ? x.status.split(',') : []; const n = cur.includes(st) ? cur.filter((y) => y !== st) : [...cur, st]; return { ...x, status: n.join(',') }; });
  const range = (kind) => {
    const now = new Date(); const d = (x) => format(x, 'yyyy-MM-dd');
    const r2 = { today: [now, now], week: [startOfWeek(now, { weekStartsOn: 1 }), endOfWeek(now, { weekStartsOn: 1 })], next: [startOfWeek(addWeeks(now, 1), { weekStartsOn: 1 }), endOfWeek(addWeeks(now, 1), { weekStartsOn: 1 })], month: [startOfMonth(now), endOfMonth(now)] }[kind];
    setF((x) => ({ ...x, due: '', from: d(r2[0]), to: d(r2[1]) }));
  };
  const chips = [
    ...statuses.map((st) => ({ k: `s-${st}`, label: STATUS[st]?.label || st, color: STATUS[st]?.color, clear: () => toggleStatus(st) })),
    f.due && { k: 'due', label: DUE_LABEL[f.due], clear: () => setF((x) => ({ ...x, due: '' })) },
    (f.from || f.to) && { k: 'range', label: `Due ${f.from ? format(new Date(`${f.from}T12:00`), 'd MMM') : 'any'} to ${f.to ? format(new Date(`${f.to}T12:00`), 'd MMM') : 'any'}`, clear: () => setF((x) => ({ ...x, from: '', to: '' })) },
    f.priority && { k: 'p', label: `${PRIORITY[f.priority]?.label} priority`, clear: () => setF((x) => ({ ...x, priority: '' })) },
    f.projectId && { k: 'pr', label: projects.find((p) => String(p.id) === String(f.projectId))?.name || 'Project', clear: () => setF((x) => ({ ...x, projectId: '' })) },
    f.assignee && { k: 'a', label: f.assignee === 'me' ? 'Assigned to me' : f.assignee === 'none' ? 'Unassigned' : people.find((p) => String(p.id) === String(f.assignee))?.name || 'Person', clear: () => setF((x) => ({ ...x, assignee: '' })) },
  ].filter(Boolean);

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
      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5">
        {STATUS_ORDER.map((st) => {
          const on = statuses.includes(st);
          return (
            <button key={st} type="button" onClick={() => toggleStatus(st)} className={clsx('inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition', on ? 'border-transparent text-white' : 'border-line bg-surface text-muted hover:text-ink')} style={on ? { background: STATUS[st].color } : undefined}>
              {!on && <span className="h-2 w-2 rounded-full" style={{ background: STATUS[st].color }} />}{STATUS[st].label}
            </button>
          );
        })}
        <span className="mx-1 w-px shrink-0 bg-line" />
        {Object.entries(DUE_LABEL).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setF((x) => ({ ...x, due: x.due === k ? '' : k, from: '', to: '' }))} className={clsx('shrink-0 rounded-full border px-3 py-1 text-xs font-semibold transition', f.due === k ? 'border-ink bg-ink text-surface' : 'border-line bg-surface text-muted hover:text-ink')}>{l}</button>
        ))}
      </div>
      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {chips.map((c) => <span key={c.k} className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-2.5 py-1 text-xs font-semibold text-ink">{c.color && <span className="h-2 w-2 rounded-full" style={{ background: c.color }} />}{c.label}<button type="button" onClick={c.clear} className="rounded-full p-0.5 hover:bg-ink/10" aria-label={`Remove ${c.label}`}><X size={11} /></button></span>)}
          <button type="button" className="text-xs font-semibold text-muted hover:text-ink" onClick={() => setF({ ...BLANK, q: f.q })}>Clear all</button>
          {tasks && <span className="ml-auto text-xs text-muted">{tasks.length} task{tasks.length === 1 ? '' : 's'}</span>}
        </div>
      )}
      {filtersOpen && (
        <div className="panel flex flex-wrap items-end gap-3 p-3">
          {fixed.projectId === undefined && (
            <label className="block"><span className="label">Project</span>
              <select className="input !w-auto" value={f.projectId} onChange={set('projectId')}><option value="">All projects</option><option value="none">No project</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
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
            <select className="input !w-auto" value={f.due} onChange={(e) => setF((x) => ({ ...x, due: e.target.value, from: '', to: '' }))}><option value="">Any time</option><option value="overdue">Overdue</option><option value="today">Due today</option><option value="week">Next 7 days</option><option value="none">No due date</option></select>
          </label>
          <div className="block">
            <span className="label flex items-center gap-1"><CalendarRange size={12} />Due between</span>
            <div className="flex items-center gap-1.5">
              <input type="date" className="input !w-auto" value={f.from} onChange={(e) => setF((x) => ({ ...x, from: e.target.value, due: '' }))} aria-label="From" />
              <span className="text-xs text-muted">and</span>
              <input type="date" className="input !w-auto" value={f.to} min={f.from || undefined} onChange={(e) => setF((x) => ({ ...x, to: e.target.value, due: '' }))} aria-label="To" />
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1">{[['today', 'Today'], ['week', 'This week'], ['next', 'Next week'], ['month', 'This month']].map(([k, l]) => <button key={k} type="button" className="rounded-md bg-sunken px-2 py-0.5 text-[11px] font-semibold text-muted hover:text-ink" onClick={() => range(k)}>{l}</button>)}</div>
          </div>
          {view === 'list' && <div className="w-44 pb-2"><Toggle checked={f.showDone} onChange={(v) => setF((s) => ({ ...s, showDone: v }))} label="Show done" /></div>}
          <button type="button" className="btn-soft btn-sm mb-1" onClick={() => setF(BLANK)}>Clear</button>
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
