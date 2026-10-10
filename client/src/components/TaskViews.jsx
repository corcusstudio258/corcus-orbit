import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import { ChevronRight, GitBranch, MessageSquare, Paperclip, ListChecks, Plus, ShieldCheck, Eye } from 'lucide-react';
import api from '../lib/api';
import { STATUS, STATUS_ORDER } from '../lib/format';
import { AvatarStack, DueBadge, PriorityFlag, StatusPill, Bar, Spinner } from './ui';
import { useComposer } from './Layout';
import { useAuth } from '../context/AuthContext';

export async function changeStatus(task, status) {
  const { data } = await api.patch(`/tasks/${task.id}`, { status });
  if (data.notice) toast(data.notice, { icon: '🛡️' });
  return data;
}

function Meta({ t }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-mist">
      {t.subtaskCount > 0 && <span className="inline-flex items-center gap-1" title="Subtasks done"><GitBranch size={12} />{t.subtaskDone}/{t.subtaskCount}</span>}
      {t.checklistTotal > 0 && <span className="inline-flex items-center gap-1" title="Checklist"><ListChecks size={12} />{t.checklistDone}/{t.checklistTotal}</span>}
      {t.commentCount > 0 && <span className="inline-flex items-center gap-1"><MessageSquare size={12} />{t.commentCount}</span>}
      {t.fileCount > 0 && <span className="inline-flex items-center gap-1"><Paperclip size={12} />{t.fileCount}</span>}
      {t.clientVisible && <span className="inline-flex items-center gap-1 text-signal/80" title="Visible in client portal"><Eye size={12} />Client</span>}
      {t.approvalStatus === 'pending' && <span className="inline-flex items-center gap-1 text-nebula" title="Waiting for approval"><ShieldCheck size={12} />Approval</span>}
    </div>
  );
}

export function TaskCard({ t, draggable, onDragStart }) {
  return (
    <Link to={`/tasks/${t.id}`} draggable={draggable} onDragStart={onDragStart}
      className="group block rounded-xl border border-line bg-space-2/80 p-3 transition hover:border-signal/40 hover:bg-space-3/70">
      <div className="mb-1.5 flex items-center gap-2 text-[11px] font-semibold text-mist">
        {t.Project && <span className="h-2 w-2 rounded-full" style={{ background: t.Project.color }} />}
        <span>{t.key}</span>
        {t.depth > 0 && <span className="rounded bg-white/[0.06] px-1">Level {t.depth + 1}</span>}
        <span className="ml-auto"><PriorityFlag priority={t.priority} /></span>
      </div>
      <div className="text-sm font-semibold leading-snug group-hover:text-star">{t.title}</div>
      {t.subtaskCount > 0 && <div className="mt-2.5 flex items-center gap-2"><Bar value={t.progress} /><span className="text-[11px] text-mist">{t.progress}%</span></div>}
      <div className="mt-2.5"><Meta t={t} /></div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <DueBadge date={t.dueDate} done={t.status === 'done'} />
        <AvatarStack users={t.assignees} size={22} />
      </div>
    </Link>
  );
}

export function Kanban({ tasks, setTasks, defaults = {} }) {
  const [over, setOver] = useState(null);
  const compose = useComposer();
  const { can } = useAuth();
  const onDrop = async (status, e) => {
    e.preventDefault(); setOver(null);
    const id = Number(e.dataTransfer.getData('text/task'));
    const t = tasks.find((x) => x.id === id);
    if (!t || t.status === status) return;
    setTasks((ts) => ts.map((x) => (x.id === id ? { ...x, status } : x)));
    try {
      const updated = await changeStatus(t, status);
      setTasks((ts) => ts.map((x) => (x.id === id ? { ...x, ...updated } : x)));
    } catch (err) { toast.error(err.message); setTasks((ts) => ts.map((x) => (x.id === id ? t : x))); }
  };
  return (
    <div className="-mx-4 flex gap-4 overflow-x-auto px-4 pb-4 sm:-mx-6 sm:px-6">
      {STATUS_ORDER.map((s) => {
        const col = tasks.filter((t) => t.status === s);
        return (
          <div key={s} onDragOver={(e) => { e.preventDefault(); setOver(s); }} onDragLeave={() => setOver(null)} onDrop={(e) => onDrop(s, e)}
            className={clsx('flex w-[290px] shrink-0 flex-col rounded-2xl border p-2.5 transition', over === s ? 'border-signal/50 bg-signal/[0.05]' : 'border-line bg-space-deep/30')}>
            <div className="mb-2 flex items-center gap-2 px-1.5 py-1">
              <span className="h-2 w-2 rounded-full" style={{ background: STATUS[s].color, boxShadow: `0 0 8px ${STATUS[s].color}` }} />
              <span className="text-sm font-semibold">{STATUS[s].label}</span>
              <span className="text-xs text-mist">{col.length}</span>
              {can('tasks.create') && <button type="button" className="ml-auto rounded-md p-1 text-mist hover:bg-white/5 hover:text-star" aria-label={`Add task to ${STATUS[s].label}`}
                onClick={() => compose({ ...defaults, status: s }, (nt) => setTasks((ts) => [nt, ...ts]))}><Plus size={15} /></button>}
            </div>
            <div className="flex min-h-[80px] flex-col gap-2">
              {col.map((t) => <TaskCard key={t.id} t={t} draggable onDragStart={(e) => e.dataTransfer.setData('text/task', String(t.id))} />)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Table rows that can expand to show subtasks (fetched lazily, any depth). */
function Row({ t, level = 0, onChanged, showProject }) {
  const [open, setOpen] = useState(false);
  const [kids, setKids] = useState(null);
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();
  const toggle = async () => {
    if (!open && !kids) {
      setBusy(true);
      try { setKids((await api.get(`/tasks?parentId=${t.id}`)).data); } finally { setBusy(false); }
    }
    setOpen((o) => !o);
  };
  const setStatus = async (e) => {
    try { const u = await changeStatus(t, e.target.value); onChanged?.(u); } catch (err) { toast.error(err.message); }
  };
  return (
    <>
      <tr className="group border-b border-line/60 transition hover:bg-white/[0.025]">
        <td className="py-2.5 pl-3 pr-2">
          <div className="flex items-center gap-1.5" style={{ paddingLeft: level * 22 }}>
            {t.subtaskCount > 0 ? (
              <button type="button" onClick={toggle} className="grid h-6 w-6 place-items-center rounded-md text-mist hover:bg-white/5" aria-label={open ? 'Collapse' : 'Expand'}>
                {busy ? <Spinner className="!h-3.5 !w-3.5" /> : <ChevronRight size={15} className={clsx('transition', open && 'rotate-90')} />}
              </button>
            ) : <span className="w-6">{level > 0 && <span className="ml-2.5 block h-3 w-2 rounded-bl border-b border-l border-line" />}</span>}
            <button type="button" onClick={() => nav(`/tasks/${t.id}`)} className="min-w-0 text-left">
              <span className="mr-2 text-xs font-semibold text-mist">{t.key}</span>
              <span className={clsx('text-sm font-medium', t.status === 'done' && 'text-mist line-through decoration-mist/40')}>{t.title}</span>
              <div className="mt-0.5"><Meta t={t} /></div>
            </button>
          </div>
        </td>
        {showProject && <td className="hidden px-2 text-xs text-mist xl:table-cell">{t.Project ? <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: t.Project.color }} />{t.Project.name}</span> : 'Personal'}</td>}
        <td className="hidden px-2 md:table-cell"><AvatarStack users={t.assignees} size={22} /></td>
        <td className="hidden px-2 sm:table-cell"><DueBadge date={t.dueDate} done={t.status === 'done'} /></td>
        <td className="hidden px-2 lg:table-cell"><PriorityFlag priority={t.priority} showLabel /></td>
        <td className="hidden w-28 px-2 lg:table-cell">{t.subtaskCount > 0 ? <div className="flex items-center gap-2"><Bar value={t.progress} /><span className="text-[11px] text-mist">{t.progress}%</span></div> : null}</td>
        <td className="px-2 pr-3">
          <label className="relative inline-block">
            <span className="sr-only">Status</span>
            <StatusPill status={t.status} />
            <select value={t.status} onChange={setStatus} className="absolute inset-0 cursor-pointer opacity-0">
              {STATUS_ORDER.map((s) => <option key={s} value={s}>{STATUS[s].label}</option>)}
            </select>
          </label>
        </td>
      </tr>
      {open && kids?.map((k) => <Row key={k.id} t={k} level={level + 1} showProject={showProject}
        onChanged={(u) => setKids((ks) => ks.map((x) => (x.id === u.id ? { ...x, ...u } : x)))} />)}
      {open && <AddSubRow parent={t} level={level + 1} onAdd={(nt) => setKids((ks) => [...(ks || []), nt])} colSpan={showProject ? 7 : 6} />}
    </>
  );
}

function AddSubRow({ parent, level, onAdd, colSpan }) {
  const [v, setV] = useState('');
  const { can } = useAuth();
  if (!can('tasks.create')) return null;
  const add = async (e) => {
    e.preventDefault();
    if (!v.trim()) return;
    try { const { data } = await api.post('/tasks', { title: v, parentId: parent.id, assigneeIds: (parent.assignees || []).map((a) => a.id) }); onAdd(data); setV(''); } catch (err) { toast.error(err.message); }
  };
  return (
    <tr className="border-b border-line/60"><td colSpan={colSpan} className="py-1.5 pl-3">
      <form onSubmit={add} style={{ paddingLeft: level * 22 + 28 }} className="flex items-center gap-2">
        <Plus size={14} className="text-mist" />
        <input value={v} onChange={(e) => setV(e.target.value)} placeholder={`Add a subtask to ${parent.key} and press Enter`} className="w-full bg-transparent py-1 text-sm outline-none placeholder:text-mist/60" />
      </form>
    </td></tr>
  );
}

export function TaskTable({ tasks, setTasks, showProject = true }) {
  return (
    <div className="panel overflow-x-auto">
      <table className="w-full min-w-[560px] text-left">
        <thead>
          <tr className="border-b border-line text-xs text-mist">
            <th className="py-2.5 pl-3 font-semibold">Task</th>
            {showProject && <th className="hidden px-2 font-semibold xl:table-cell">Project</th>}
            <th className="hidden px-2 font-semibold md:table-cell">People</th>
            <th className="hidden px-2 font-semibold sm:table-cell">Due</th>
            <th className="hidden px-2 font-semibold lg:table-cell">Priority</th>
            <th className="hidden px-2 font-semibold lg:table-cell">Progress</th>
            <th className="px-2 pr-3 font-semibold">Status</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((t) => <Row key={t.id} t={t} showProject={showProject} onChanged={(u) => setTasks((ts) => ts.map((x) => (x.id === u.id ? { ...x, ...u } : x)))} />)}
        </tbody>
      </table>
    </div>
  );
}
