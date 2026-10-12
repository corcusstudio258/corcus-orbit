import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import { ChevronRight, GitBranch, MessageSquare, Paperclip, ListChecks, Plus, ShieldCheck, Eye, Ban, Repeat, X, Archive } from 'lucide-react';
import api from '../lib/api';
import { STATUS, STATUS_ORDER, BOARD_STATUSES, PRIORITY, PRIORITY_ORDER } from '../lib/format';
import { AvatarStack, Avatar, DueBadge, PriorityFlag, StatusPill, Bar, Spinner, UserPicker } from './ui';
import { useComposer } from './Layout';
import { useAuth } from '../context/AuthContext';
import { useDirectory } from '../lib/directory';
import { changeStatus } from './TaskPanel';

export { changeStatus };

function useOpen() {
  const [params, setParams] = useSearchParams();
  return (id) => { const p = new URLSearchParams(params); p.set('task', id); setParams(p); };
}

function Meta({ t }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
      {t.subtaskCount > 0 && <span className="inline-flex items-center gap-1" title="Subtasks done"><GitBranch size={12} />{t.subtaskDone}/{t.subtaskCount}</span>}
      {t.checklistTotal > 0 && <span className="inline-flex items-center gap-1" title="Checklist"><ListChecks size={12} />{t.checklistDone}/{t.checklistTotal}</span>}
      {t.commentCount > 0 && <span className="inline-flex items-center gap-1"><MessageSquare size={12} />{t.commentCount}</span>}
      {t.fileCount > 0 && <span className="inline-flex items-center gap-1"><Paperclip size={12} />{t.fileCount}</span>}
      {t.openBlockers > 0 && <span className="inline-flex items-center gap-1 text-ember" title="Waiting on other tasks"><Ban size={12} />Waiting</span>}
      {t.recurrence && <span className="inline-flex items-center gap-1 text-teal" title="Repeats"><Repeat size={12} /></span>}
      {t.clientVisible && <span className="inline-flex items-center gap-1 text-cobalt" title="Visible in client portal"><Eye size={12} /></span>}
      {t.approvalStatus === 'pending' && <span className="inline-flex items-center gap-1 text-violet" title="Waiting for approval"><ShieldCheck size={12} />Approval</span>}
      {t.storyPoints ? <span className="rounded bg-sunken px-1 font-semibold">{t.storyPoints} pt</span> : null}
    </div>
  );
}

export function TaskCard({ t, onDragStart, onDropBefore, showProject = true }) {
  const open = useOpen();
  const [over, setOver] = useState(false);
  return (
    <div draggable={!!onDragStart} onDragStart={onDragStart}
      onDragOver={onDropBefore ? (e) => { e.preventDefault(); e.stopPropagation(); setOver(true); } : undefined}
      onDragLeave={() => setOver(false)}
      onDrop={onDropBefore ? (e) => { e.stopPropagation(); setOver(false); onDropBefore(e); } : undefined}
      onClick={() => open(t.id)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && open(t.id)}
      className={clsx('group cursor-pointer rounded-xl border bg-surface p-3 transition hover:shadow-lift', over ? 'border-cobalt border-t-4' : 'border-line hover:border-faint')}>
      <div className="mb-1.5 flex items-center gap-2 text-[11px] font-semibold text-faint">
        {showProject && t.Project && <span className="h-2 w-2 rounded-full" style={{ background: t.Project.color }} />}
        <span>{t.key}</span>
        {t.depth > 0 && <span className="rounded bg-sunken px-1">L{t.depth + 1}</span>}
        <span className="ml-auto"><PriorityFlag priority={t.priority} /></span>
      </div>
      <div className={clsx('text-sm font-semibold leading-snug', t.status === 'done' && 'text-muted line-through decoration-faint')}>{t.title}</div>
      {(t.tags || []).length > 0 && <div className="mt-1.5 flex flex-wrap gap-1">{t.tags.slice(0, 3).map((g) => <span key={g} className="rounded-md bg-sunken px-1.5 py-0.5 text-[10px] font-medium text-muted">#{g}</span>)}</div>}
      {t.subtaskCount > 0 && <div className="mt-2.5 flex items-center gap-2"><Bar value={t.progress} height={4} /><span className="text-[11px] text-muted">{t.progress}%</span></div>}
      <div className="mt-2"><Meta t={t} /></div>
      <div className="mt-2.5 flex items-center justify-between gap-2">
        <DueBadge date={t.dueDate} done={t.status === 'done'} compact />
        <AvatarStack users={t.assignees} size={22} emptyLabel="" />
      </div>
    </div>
  );
}

const GROUPERS = {
  status: { label: 'Status', keyOf: (t) => t.status, columns: () => BOARD_STATUSES.map((s) => ({ key: s, label: STATUS[s].label, color: STATUS[s].color })) },
  priority: { label: 'Priority', keyOf: (t) => t.priority, columns: () => PRIORITY_ORDER.map((p) => ({ key: p, label: PRIORITY[p].label, color: PRIORITY[p].color })) },
  section: { label: 'Section', keyOf: (t) => t.sectionId || 'none', columns: (ctx) => [...(ctx.sections || []).map((s) => ({ key: s.id, label: s.name, color: s.color })), { key: 'none', label: 'No section', color: '#8D94B3' }] },
  assignee: { label: 'Assignee', keyOf: (t) => t.assignees?.[0]?.id || 'none', columns: (ctx, tasks) => {
    const seen = new Map();
    tasks.forEach((t) => t.assignees?.[0] && seen.set(t.assignees[0].id, t.assignees[0]));
    return [...[...seen.values()].map((u) => ({ key: u.id, label: u.name, color: u.color, user: u })), { key: 'none', label: 'Unassigned', color: '#8D94B3' }];
  } },
  project: { label: 'Project', keyOf: (t) => t.Project?.id || 'none', columns: (ctx, tasks) => {
    const seen = new Map();
    tasks.forEach((t) => t.Project && seen.set(t.Project.id, t.Project));
    return [...[...seen.values()].map((p) => ({ key: p.id, label: p.name, color: p.color })), { key: 'none', label: 'Personal', color: '#8D94B3' }];
  } },
};
export const GROUP_OPTIONS = (hasSections, hasProject) => Object.entries(GROUPERS).filter(([k]) => (k !== 'section' || hasSections) && (k !== 'project' || !hasProject)).map(([value, g]) => ({ value, label: g.label }));

export function Kanban({ tasks, setTasks, groupBy = 'status', sections = [], defaults = {}, onAddSection, reload }) {
  const [overCol, setOverCol] = useState(null);
  const compose = useComposer();
  const { can } = useAuth();
  const g = GROUPERS[groupBy] || GROUPERS.status;
  const columns = g.columns({ sections }, tasks);
  const [adding, setAdding] = useState(false);
  const [newSec, setNewSec] = useState('');

  const move = async (id, colKey, beforeId) => {
    const t = tasks.find((x) => x.id === id);
    if (!t) return;
    const colTasks = tasks.filter((x) => String(g.keyOf(x)) === String(colKey) && x.id !== id);
    const idx = beforeId ? colTasks.findIndex((x) => x.id === beforeId) : colTasks.length;
    const after = idx > 0 ? colTasks[idx - 1] : null;
    const before = beforeId ? colTasks[idx] : null;
    const same = String(g.keyOf(t)) === String(colKey);
    // optimistic
    setTasks((ts) => {
      const patch = groupBy === 'status' ? { status: colKey } : groupBy === 'section' ? { sectionId: colKey === 'none' ? null : colKey } : groupBy === 'priority' ? { priority: colKey } : {};
      const moved = { ...t, ...patch, position: before && after ? (before.position + after.position) / 2 : before ? before.position - 1 : after ? after.position + 1 : t.position };
      return ts.map((x) => (x.id === id ? moved : x)).sort((a, b) => a.position - b.position);
    });
    try {
      if (groupBy === 'status' || groupBy === 'section') {
        const { data } = await api.post('/tasks/reorder', {
          id, beforeId: before?.id, afterId: after?.id,
          ...(groupBy === 'status' && !same ? { status: colKey } : {}),
          ...(groupBy === 'section' && !same ? { sectionId: colKey === 'none' ? null : colKey } : {}),
        });
        if (data.notice) toast(data.notice, { icon: '⚠️' });
        setTasks((ts) => ts.map((x) => (x.id === id ? { ...x, ...data } : x)));
      } else if (groupBy === 'priority' && !same) {
        await api.patch(`/tasks/${id}`, { priority: colKey });
      } else if (groupBy === 'assignee' && !same) {
        if (!can('tasks.assign')) throw new Error("Your role can't reassign tasks.");
        await api.patch(`/tasks/${id}`, { assigneeIds: colKey === 'none' ? [] : [Number(colKey)] });
        reload?.();
      }
    } catch (err) { toast.error(err.message); reload?.(); }
  };

  const addSection = async (e) => {
    e.preventDefault();
    if (!newSec.trim()) return;
    try { await onAddSection(newSec.trim()); setNewSec(''); setAdding(false); } catch (err) { toast.error(err.message); }
  };

  return (
    <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
      {columns.map((c) => {
        const col = tasks.filter((t) => String(g.keyOf(t)) === String(c.key));
        if (groupBy === 'status' && c.key === 'backlog' && !col.length && tasks.length > 0 && !defaults.projectId) return null;
        return (
          <div key={c.key} onDragOver={(e) => { e.preventDefault(); setOverCol(c.key); }} onDragLeave={() => setOverCol(null)}
            onDrop={(e) => { e.preventDefault(); setOverCol(null); move(Number(e.dataTransfer.getData('text/task')), c.key); }}
            className={clsx('flex w-[288px] shrink-0 flex-col rounded-2xl p-2 transition', overCol === c.key ? 'bg-cobalt/10 ring-2 ring-cobalt/30' : 'bg-sunken/70')}>
            <div className="mb-2 flex items-center gap-2 px-1.5 pt-1">
              {c.user ? <Avatar user={c.user} size={20} /> : <span className="h-2.5 w-2.5 rounded-full" style={{ background: c.color }} />}
              <span className="truncate text-sm font-semibold">{c.label}</span>
              <span className="rounded-full bg-surface px-1.5 text-xs font-semibold text-muted">{col.length}</span>
              {can('tasks.create') && <button type="button" className="ml-auto rounded-md p-1 text-muted hover:bg-surface hover:text-ink" aria-label={`Add task to ${c.label}`}
                onClick={() => compose({ ...defaults, ...(groupBy === 'status' ? { status: c.key } : {}), ...(groupBy === 'section' && c.key !== 'none' ? { sectionId: c.key } : {}), ...(groupBy === 'priority' ? { priority: c.key } : {}), ...(groupBy === 'assignee' && c.key !== 'none' ? { assigneeIds: [Number(c.key)] } : {}) }, (nt) => setTasks((ts) => [...ts, nt]))}><Plus size={15} /></button>}
            </div>
            <div className="flex min-h-[90px] flex-1 flex-col gap-2">
              {col.map((t) => (
                <TaskCard key={t.id} t={t} showProject={!defaults.projectId}
                  onDragStart={(e) => e.dataTransfer.setData('text/task', String(t.id))}
                  onDropBefore={(e) => move(Number(e.dataTransfer.getData('text/task')), c.key, t.id)} />
              ))}
              {!col.length && <div className="grid flex-1 place-items-center rounded-xl border-2 border-dashed border-line py-6 text-xs text-faint">Drop tasks here</div>}
            </div>
          </div>
        );
      })}
      {groupBy === 'section' && onAddSection && (
        <div className="w-[260px] shrink-0">
          {adding ? (
            <form onSubmit={addSection} className="rounded-2xl bg-sunken/70 p-2"><input autoFocus className="input" placeholder="Section name" value={newSec} onChange={(e) => setNewSec(e.target.value)} onBlur={() => !newSec && setAdding(false)} /></form>
          ) : <button type="button" onClick={() => setAdding(true)} className="flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-line py-3 text-sm font-semibold text-muted hover:border-faint hover:text-ink"><Plus size={16} />Add section</button>}
        </div>
      )}
    </div>
  );
}

/** Expandable table rows (subtasks load lazily, any depth). */
function Row({ t, level = 0, onChanged, showProject, selected, onSelect }) {
  const [open, setOpen] = useState(false);
  const [kids, setKids] = useState(null);
  const [busy, setBusy] = useState(false);
  const openTask = useOpen();
  const toggle = async () => {
    if (!open && !kids) { setBusy(true); try { setKids((await api.get(`/tasks?parentId=${t.id}`)).data); } finally { setBusy(false); } }
    setOpen((o) => !o);
  };
  const setStatus = async (e) => { try { const u = await changeStatus(t, e.target.value); onChanged?.(u); } catch (err) { toast.error(err.message); } };
  return (
    <>
      <tr className={clsx('group border-b border-line/70 transition hover:bg-sunken/50', selected && 'bg-brand-soft/40')}>
        <td className="w-8 py-2 pl-3">{onSelect && level === 0 && <input type="checkbox" className="h-4 w-4 accent-[#0F1535]" checked={!!selected} onChange={() => onSelect(t.id)} aria-label={`Select ${t.key}`} />}</td>
        <td className="py-2 pr-2">
          <div className="flex items-center gap-1.5" style={{ paddingLeft: level * 22 }}>
            {t.subtaskCount > 0 ? (
              <button type="button" onClick={toggle} className="grid h-6 w-6 place-items-center rounded-md text-muted hover:bg-sunken" aria-label={open ? 'Collapse' : 'Expand'}>
                {busy ? <Spinner size={13} /> : <ChevronRight size={15} className={clsx('transition', open && 'rotate-90')} />}
              </button>
            ) : <span className="w-6">{level > 0 && <span className="ml-2.5 block h-3 w-2 rounded-bl border-b border-l border-line" />}</span>}
            <button type="button" onClick={() => openTask(t.id)} className="min-w-0 text-left">
              <span className="mr-2 text-xs font-semibold text-faint">{t.key}</span>
              <span className={clsx('text-sm font-medium', t.status === 'done' && 'text-muted line-through decoration-faint')}>{t.title}</span>
              <div className="mt-0.5"><Meta t={t} /></div>
            </button>
          </div>
        </td>
        {showProject && <td className="hidden px-2 text-xs text-muted xl:table-cell">{t.Project ? <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: t.Project.color }} />{t.Project.name}</span> : 'Personal'}</td>}
        <td className="hidden px-2 md:table-cell"><AvatarStack users={t.assignees} size={22} /></td>
        <td className="hidden px-2 sm:table-cell"><DueBadge date={t.dueDate} done={t.status === 'done'} compact /></td>
        <td className="hidden px-2 lg:table-cell"><PriorityFlag priority={t.priority} showLabel /></td>
        <td className="hidden w-28 px-2 lg:table-cell">{t.subtaskCount > 0 ? <div className="flex items-center gap-2"><Bar value={t.progress} height={4} /><span className="text-[11px] text-muted">{t.progress}%</span></div> : null}</td>
        <td className="px-2 pr-3">
          <label className="relative inline-block cursor-pointer">
            <span className="sr-only">Status</span>
            <StatusPill status={t.status} />
            <select value={t.status} onChange={setStatus} className="absolute inset-0 cursor-pointer opacity-0">
              {STATUS_ORDER.map((s) => <option key={s} value={s}>{STATUS[s].label}</option>)}
            </select>
          </label>
        </td>
      </tr>
      {open && kids?.map((k) => <Row key={k.id} t={k} level={level + 1} showProject={showProject} onChanged={(u) => setKids((ks) => ks.map((x) => (x.id === u.id ? { ...x, ...u } : x)))} />)}
    </>
  );
}

function QuickAdd({ defaults, onAdd, colSpan }) {
  const [v, setV] = useState('');
  const { can, user } = useAuth();
  if (!can('tasks.create')) return null;
  const add = async (e) => {
    e.preventDefault();
    if (!v.trim()) return;
    try { const { data } = await api.post('/tasks', { title: v, ...defaults, assigneeIds: defaults.assigneeIds || [user.id] }); onAdd(data); setV(''); } catch (err) { toast.error(err.message); }
  };
  return (
    <tr className="border-b border-line/70"><td colSpan={colSpan} className="py-1.5 pl-12">
      <form onSubmit={add} className="flex items-center gap-2"><Plus size={14} className="text-faint" /><input value={v} onChange={(e) => setV(e.target.value)} placeholder="Add a task and press Enter" className="w-full bg-transparent py-1 text-sm outline-none placeholder:text-faint" /></form>
    </td></tr>
  );
}

function BulkBar({ ids, clear, done }) {
  const people = useDirectory();
  const { can } = useAuth();
  const [who, setWho] = useState(null);
  const run = async (body, msg) => {
    try { const { data } = await api.patch('/tasks/bulk', { ids, ...body }); toast.success(`${msg} ${data.changed} tasks`); clear(); done(); } catch (e) { toast.error(e.message); }
  };
  return (
    <div className="sticky bottom-4 z-20 mx-auto mt-3 flex w-fit flex-wrap items-center gap-2 rounded-2xl bg-night px-3 py-2 text-white shadow-pop">
      <span className="px-2 text-sm font-semibold">{ids.length} selected</span>
      <select className="rounded-lg bg-white/10 px-2 py-1.5 text-xs" value="" onChange={(e) => e.target.value && run({ status: e.target.value }, 'Moved')}>
        <option value="">Set status</option>{STATUS_ORDER.map((s) => <option key={s} value={s} className="text-ink">{STATUS[s].label}</option>)}
      </select>
      <select className="rounded-lg bg-white/10 px-2 py-1.5 text-xs" value="" onChange={(e) => e.target.value && run({ priority: e.target.value }, 'Updated')}>
        <option value="">Set priority</option>{PRIORITY_ORDER.map((p) => <option key={p} value={p} className="text-ink">{PRIORITY[p].label}</option>)}
      </select>
      {can('tasks.assign') && <div className="w-44 text-ink"><UserPicker compact multiple={false} users={people} value={who} onChange={(v) => { setWho(v); if (v) run({ assigneeId: v }, 'Assigned'); }} placeholder="Add assignee" /></div>}
      <input type="date" className="rounded-lg bg-white/10 px-2 py-1 text-xs [color-scheme:dark]" onChange={(e) => e.target.value && run({ dueDate: new Date(`${e.target.value}T18:00`).toISOString() }, 'Rescheduled')} aria-label="Set due date" />
      <button type="button" className="inline-flex items-center gap-1 rounded-lg bg-white/10 px-2 py-1.5 text-xs hover:bg-white/20" onClick={() => run({ archived: true }, 'Archived')}><Archive size={13} />Archive</button>
      <button type="button" onClick={clear} className="rounded-lg p-1.5 hover:bg-white/10" aria-label="Clear selection"><X size={15} /></button>
    </div>
  );
}

export function TaskTable({ tasks, setTasks, showProject = true, groupBy, sections = [], defaults = {}, reload }) {
  const [sel, setSel] = useState([]);
  const [collapsed, setCollapsed] = useState({});
  const g = groupBy ? GROUPERS[groupBy] : null;
  const groups = useMemo(() => {
    if (!g) return [{ key: 'all', label: null, tasks }];
    return g.columns({ sections }, tasks).map((c) => ({ ...c, tasks: tasks.filter((t) => String(g.keyOf(t)) === String(c.key)) })).filter((c) => c.tasks.length || groupBy === 'section');
  }, [g, tasks, sections, groupBy]);
  const colSpan = showProject ? 8 : 7;
  const toggleSel = (id) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const patchDefaults = (c) => ({ ...defaults, ...(groupBy === 'status' ? { status: c.key } : {}), ...(groupBy === 'section' && c.key !== 'none' ? { sectionId: c.key } : {}), ...(groupBy === 'priority' ? { priority: c.key } : {}) });
  return (
    <>
      <div className="panel overflow-x-auto">
        <table className="w-full min-w-[620px] text-left">
          <thead>
            <tr className="border-b border-line text-xs text-muted">
              <th className="w-8 py-2.5 pl-3"><input type="checkbox" className="h-4 w-4 accent-[#0F1535]" checked={sel.length > 0 && sel.length === tasks.length} onChange={() => setSel(sel.length === tasks.length ? [] : tasks.map((t) => t.id))} aria-label="Select all" /></th>
              <th className="py-2.5 font-semibold">Task</th>
              {showProject && <th className="hidden px-2 font-semibold xl:table-cell">Project</th>}
              <th className="hidden px-2 font-semibold md:table-cell">People</th>
              <th className="hidden px-2 font-semibold sm:table-cell">Due</th>
              <th className="hidden px-2 font-semibold lg:table-cell">Priority</th>
              <th className="hidden px-2 font-semibold lg:table-cell">Progress</th>
              <th className="px-2 pr-3 font-semibold">Status</th>
            </tr>
          </thead>
          {groups.map((grp) => (
            <tbody key={grp.key}>
              {grp.label && (
                <tr className="bg-sunken/50"><td colSpan={colSpan} className="px-3 py-2">
                  <button type="button" onClick={() => setCollapsed((c) => ({ ...c, [grp.key]: !c[grp.key] }))} className="flex items-center gap-2 text-sm font-semibold">
                    <ChevronRight size={15} className={clsx('text-muted transition', !collapsed[grp.key] && 'rotate-90')} />
                    {grp.user ? <Avatar user={grp.user} size={18} /> : <span className="h-2.5 w-2.5 rounded-full" style={{ background: grp.color }} />}{grp.label}<span className="text-xs font-normal text-muted">{grp.tasks.length}</span>
                  </button>
                </td></tr>
              )}
              {!collapsed[grp.key] && grp.tasks.map((t) => <Row key={t.id} t={t} showProject={showProject} selected={sel.includes(t.id)} onSelect={toggleSel} onChanged={(u) => setTasks((ts) => ts.map((x) => (x.id === u.id ? { ...x, ...u } : x)))} />)}
              {!collapsed[grp.key] && grp.label && groupBy !== 'assignee' && groupBy !== 'project' && <QuickAdd defaults={patchDefaults(grp)} colSpan={colSpan} onAdd={(nt) => setTasks((ts) => [...ts, nt])} />}
            </tbody>
          ))}
          {!groups.length && <tbody><tr><td colSpan={colSpan} className="py-10 text-center text-sm text-muted">No tasks.</td></tr></tbody>}
        </table>
      </div>
      {sel.length > 0 && <BulkBar ids={sel} clear={() => setSel([])} done={() => reload?.()} />}
    </>
  );
}

