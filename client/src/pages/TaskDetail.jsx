import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import {
  ChevronRight, Plus, Trash2, Paperclip, Play, Square, Eye, EyeOff, ShieldCheck, Check, X, Lock, Globe, Clock, GitBranch, Send, Download,
} from 'lucide-react';
import api, { fileUrl } from '../lib/api';
import { useAuth, useLive } from '../context/AuthContext';
import { useDirectory } from '../lib/directory';
import { STATUS, STATUS_ORDER, PRIORITY, ago, minutes, bytes, toLocalInput, fmtDate } from '../lib/format';
import { OrbitRing, Avatar, AvatarStack, StatusPill, PriorityFlag, DueBadge, PageLoader, UserPicker, Toggle, Bar, Modal } from '../components/ui';
import { useComposer } from '../components/Layout';
import { changeStatus } from '../components/TaskViews';

function Editable({ value, onSave, multiline, className, placeholder, disabled }) {
  const [v, setV] = useState(value || '');
  const [editing, setEditing] = useState(false);
  useEffect(() => setV(value || ''), [value]);
  const commit = () => { setEditing(false); if (v !== (value || '')) onSave(v); };
  if (disabled) return <div className={clsx(className, 'whitespace-pre-wrap')}>{value || <span className="text-mist">{placeholder}</span>}</div>;
  if (!editing) {
    return (
      <button type="button" onClick={() => setEditing(true)} className={clsx(className, 'block w-full whitespace-pre-wrap rounded-lg text-left hover:bg-white/[0.03]')}>
        {value || <span className="text-mist">{placeholder}</span>}
      </button>
    );
  }
  return multiline
    ? <textarea autoFocus className="input min-h-[140px]" value={v} onChange={(e) => setV(e.target.value)} onBlur={commit} />
    : <input autoFocus className={clsx('input', className)} value={v} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} />;
}

/** Renders the whole subtree under a task, with inline status + add. */
function SubtaskTree({ root, items, onStatus, canCreate }) {
  const byParent = {};
  items.forEach((t) => { (byParent[t.parentId] = byParent[t.parentId] || []).push(t); });
  const compose = useComposer();
  const render = (parentId, level) => (byParent[parentId] || []).map((t) => (
    <div key={t.id}>
      <div className="group flex items-center gap-2 rounded-lg py-1.5 pr-2 hover:bg-white/[0.03]" style={{ paddingLeft: level * 20 + 4 }}>
        {level > 0 && <span className="h-3 w-2.5 shrink-0 rounded-bl border-b border-l border-line" />}
        <button type="button" onClick={() => onStatus(t, t.status === 'done' ? 'todo' : 'done')} aria-label={t.status === 'done' ? 'Mark not done' : 'Mark done'}
          className={clsx('grid h-[18px] w-[18px] shrink-0 place-items-center rounded-md border transition', t.status === 'done' ? 'border-mint bg-mint text-space' : 'border-mist/50 hover:border-signal')}>
          {t.status === 'done' && <Check size={12} strokeWidth={3} />}
        </button>
        <Link to={`/tasks/${t.id}`} className="min-w-0 flex-1 truncate text-sm">
          <span className="mr-2 text-xs text-mist">{t.key}</span>
          <span className={clsx(t.status === 'done' && 'text-mist line-through decoration-mist/40')}>{t.title}</span>
        </Link>
        {t.subtaskCount > 0 && <span className="text-[11px] text-mist">{t.progress}%</span>}
        <span className="hidden sm:block"><DueBadge date={t.dueDate} done={t.status === 'done'} /></span>
        <AvatarStack users={t.assignees} size={20} max={2} />
        <span className="hidden md:block"><StatusPill status={t.status} small /></span>
        {canCreate && <button type="button" title="Add a subtask under this" onClick={() => compose({ parentId: t.id, parentTitle: t.title })}
          className="rounded p-1 text-mist opacity-0 hover:text-signal group-hover:opacity-100"><Plus size={14} /></button>}
      </div>
      {render(t.id, level + 1)}
    </div>
  ));
  return <div>{render(root.id, 0)}</div>;
}

function Comments({ task, onPosted }) {
  const { user } = useAuth();
  const people = useDirectory();
  const [body, setBody] = useState('');
  const [shared, setShared] = useState(false);
  const [mentionQ, setMentionQ] = useState(null);
  const [mentions, setMentions] = useState([]);
  const ref = useRef(null);
  const onChange = (e) => {
    const v = e.target.value; setBody(v);
    const m = v.slice(0, e.target.selectionStart).match(/@(\w*)$/);
    setMentionQ(m ? m[1].toLowerCase() : null);
  };
  const pick = (p) => {
    const pos = ref.current.selectionStart;
    const before = body.slice(0, pos).replace(/@(\w*)$/, `@${p.name.split(' ')[0]} `);
    setBody(before + body.slice(pos)); setMentions((m) => [...new Set([...m, p.id])]); setMentionQ(null); ref.current.focus();
  };
  const post = async (e) => {
    e.preventDefault();
    if (!body.trim()) return;
    try {
      const { data } = await api.post(`/tasks/${task.id}/comments`, { body, internal: !shared, mentions });
      setBody(''); setMentions([]); onPosted(data);
    } catch (err) { toast.error(err.message); }
  };
  const matches = mentionQ != null ? people.filter((p) => p.name.toLowerCase().includes(mentionQ)).slice(0, 6) : [];
  return (
    <div>
      <ul className="space-y-4">
        {task.Comments.map((c) => {
          const fromClient = c.author?.Role?.isClientRole;
          return (
            <li key={c.id} className="flex gap-3">
              <Avatar user={c.author} size={30} />
              <div className={clsx('min-w-0 flex-1 rounded-xl border px-3.5 py-2.5', fromClient ? 'border-flare/30 bg-flare/[0.06]' : c.internal ? 'border-line bg-white/[0.02]' : 'border-signal/25 bg-signal/[0.05]')}>
                <div className="mb-1 flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-semibold">{c.author?.name}</span>
                  {fromClient && <span className="chip bg-flare/15 text-flare">Client</span>}
                  {!fromClient && !c.internal && <span className="chip bg-signal/15 text-signal"><Globe size={10} />Shared with client</span>}
                  <span className="text-mist">{ago(c.createdAt)}</span>
                </div>
                <p className="whitespace-pre-wrap text-sm">{c.body}</p>
              </div>
            </li>
          );
        })}
      </ul>
      <form onSubmit={post} className="relative mt-4 flex gap-3">
        <Avatar user={user} size={30} />
        <div className="flex-1">
          <textarea ref={ref} className="input min-h-[70px]" placeholder="Write an update. Type @ to mention someone." value={body} onChange={onChange}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) post(e); }} />
          {matches.length > 0 && (
            <div className="panel absolute z-20 mt-1 w-64 p-1">
              {matches.map((p) => <button type="button" key={p.id} onClick={() => pick(p)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-white/5"><Avatar user={p} size={20} />{p.name}</button>)}
            </div>
          )}
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            {task.clientVisible ? (
              <button type="button" onClick={() => setShared((s) => !s)} className={clsx('chip border', shared ? 'border-signal/40 bg-signal/10 text-signal' : 'border-line text-mist')}>
                {shared ? <><Globe size={11} />Client will see this</> : <><Lock size={11} />Team only</>}
              </button>
            ) : <span className="inline-flex items-center gap-1 text-[11px] text-mist"><Lock size={11} />Team only. This task isn't shared with the client.</span>}
            <button className="btn-primary btn-sm"><Send size={13} />Post</button>
          </div>
        </div>
      </form>
    </div>
  );
}

function Sidebar({ t, patch, people, can }) {
  const [projects, setProjects] = useState(null);
  useEffect(() => { if (t.projectId) api.get(`/projects/${t.projectId}`).then((r) => setProjects(r.data)).catch(() => {}); }, [t.projectId]);
  const row = (label, node) => (<div className="grid grid-cols-[96px_1fr] items-center gap-3 py-2"><span className="text-xs text-mist">{label}</span><div className="min-w-0">{node}</div></div>);
  const assignable = can('tasks.assign') ? people : people.filter((p) => t.assignees.some((a) => a.id === p.id));
  return (
    <div className="divide-y divide-line/60">
      {row('Status', (
        <select disabled={!t.canEdit} className="input !py-1.5" value={t.status} onChange={(e) => patch({ status: e.target.value }, true)}>
          {STATUS_ORDER.map((s) => <option key={s} value={s}>{STATUS[s].label}</option>)}
        </select>
      ))}
      {row('Priority', (
        <select disabled={!t.canEdit} className="input !py-1.5" value={t.priority} onChange={(e) => patch({ priority: e.target.value })}>
          {Object.entries(PRIORITY).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
      ))}
      {row('Assignees', <UserPicker users={assignable} value={t.assignees.map((a) => a.id)} disabled={!t.canEdit || !can('tasks.assign')} onChange={(ids) => patch({ assigneeIds: ids })} placeholder="Unassigned" />)}
      {row('Start', <input type="date" disabled={!t.canEdit} className="input !py-1.5" value={t.startDate || ''} onChange={(e) => patch({ startDate: e.target.value })} />)}
      {row('Due', <input type="datetime-local" disabled={!t.canEdit} className="input !py-1.5" value={toLocalInput(t.dueDate)} onChange={(e) => patch({ dueDate: e.target.value ? new Date(e.target.value).toISOString() : '' })} />)}
      {row('Estimate', <input type="number" min="0" step="0.5" disabled={!t.canEdit} className="input !py-1.5" defaultValue={t.estimateHours || ''} placeholder="hours" onBlur={(e) => Number(e.target.value || 0) !== Number(t.estimateHours || 0) && patch({ estimateHours: e.target.value })} />)}
      {projects?.Milestones?.length > 0 && row('Milestone', (
        <select disabled={!t.canEdit} className="input !py-1.5" value={t.milestoneId || ''} onChange={(e) => patch({ milestoneId: e.target.value })}>
          <option value="">None</option>{projects.Milestones.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
        </select>
      ))}
      {row('Project', t.Project ? <Link to={`/projects/${t.Project.id}`} className="inline-flex items-center gap-2 text-sm hover:underline"><span className="h-2 w-2 rounded-full" style={{ background: t.Project.color }} />{t.Project.name}</Link> : <span className="text-sm text-mist">Personal</span>)}
      {row('Created by', <span className="inline-flex items-center gap-2 text-sm"><Avatar user={t.creator} size={20} />{t.creator?.name}<span className="text-xs text-mist">{ago(t.createdAt)}</span></span>)}
      <div className="space-y-3 py-3">
        <Toggle checked={t.clientVisible} onChange={(v) => t.canEdit && patch({ clientVisible: v })} label="Show in client portal" hint={t.Project?.clientId ? 'Client sees status, progress and shared updates.' : 'This project has no client.'} />
        <Toggle checked={t.requiresApproval} onChange={(v) => t.canEdit && patch({ requiresApproval: v })} label="Needs approval" hint="Done goes to review first." />
      </div>
    </div>
  );
}

export default function TaskDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { can } = useAuth();
  const people = useDirectory();
  const compose = useComposer();
  const [t, setT] = useState(null);
  const [error, setError] = useState(null);
  const [item, setItem] = useState('');
  const [timer, setTimer] = useState(null);
  const [logOpen, setLogOpen] = useState(false);
  const [approveOpen, setApproveOpen] = useState(null);
  const fileRef = useRef(null);

  const load = () => api.get(`/tasks/${id}`).then((r) => { setT(r.data); setError(null); }).catch((e) => setError(e.message));
  const loadTimer = () => api.get('/tasks/timer/active').then((r) => setTimer(r.data)).catch(() => {});
  useEffect(() => { setT(null); load(); loadTimer(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  useLive('task:changed', (d) => { if (!d || d.id === Number(id) || d.parentId || d.kind === 'created') load(); }, [id]);
  useEffect(() => { const h = () => load(); window.addEventListener('orbit:task-created', h); return () => window.removeEventListener('orbit:task-created', h); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <div className="panel p-10 text-center"><p className="text-mist">{error}</p><Link to="/my-tasks" className="link mt-3 inline-block">Back to my tasks</Link></div>;
  if (!t) return <PageLoader />;

  const patch = async (body, status) => {
    try {
      const data = status ? await changeStatus(t, body.status) : (await api.patch(`/tasks/${t.id}`, body)).data;
      if (!status && data.notice) toast(data.notice);
      load();
    } catch (err) { toast.error(err.message); }
  };
  const subStatus = async (s, status) => { try { await changeStatus(s, status); load(); } catch (e) { toast.error(e.message); } };
  const addItem = async (e) => {
    e.preventDefault(); if (!item.trim()) return;
    await api.post(`/tasks/${t.id}/checklist`, { text: item }); setItem(''); load();
  };
  const toggleItem = async (c) => { await api.patch(`/tasks/checklist/${c.id}`, { done: !c.done }); load(); };
  const delItem = async (c) => { await api.delete(`/tasks/checklist/${c.id}`); load(); };
  const upload = async (files, clientVisible = false) => {
    if (!files?.length) return;
    const fd = new FormData(); [...files].forEach((f) => fd.append('files', f)); fd.append('clientVisible', String(clientVisible));
    const tId = toast.loading('Uploading…');
    try { await api.post(`/tasks/${t.id}/attachments`, fd); toast.success('Uploaded', { id: tId }); load(); } catch (e) { toast.error(e.message, { id: tId }); }
  };
  const running = timer && timer.taskId === t.id;
  const toggleTimer = async () => {
    if (running) { const r = await api.post('/tasks/timer/stop'); toast.success(`Logged ${minutes(r.data.minutes)}`); } else { await api.post(`/tasks/${t.id}/timer/start`); toast.success('Timer started'); }
    loadTimer(); load(); window.dispatchEvent(new Event('orbit:timer'));
  };
  const remove = async () => {
    if (!window.confirm(`Delete ${t.key}${t.descendants.length ? ` and its ${t.descendants.length} subtasks` : ''}? This can't be undone.`)) return;
    await api.delete(`/tasks/${t.id}`); toast.success('Task deleted');
    nav(t.parentId ? `/tasks/${t.parentId}` : t.Project ? `/projects/${t.Project.id}` : '/my-tasks');
  };
  const decide = async (decision, note) => {
    try { await api.post(`/tasks/${t.id}/approval`, { decision, note }); setApproveOpen(null); toast.success(decision === 'approve' ? 'Approved' : 'Sent back with changes'); load(); } catch (e) { toast.error(e.message); }
  };
  const totalMinutes = t.TimeLogs.reduce((s, l) => s + (l.minutes || 0), 0);

  return (
    <div className="space-y-5">
      <nav className="flex flex-wrap items-center gap-1 text-xs text-mist" aria-label="Breadcrumb">
        {t.Project ? <Link to={`/projects/${t.Project.id}`} className="hover:text-star">{t.Project.name}</Link> : <Link to="/my-tasks" className="hover:text-star">My tasks</Link>}
        {t.breadcrumb.map((b) => <span key={b.id} className="inline-flex items-center gap-1"><ChevronRight size={12} /><Link to={`/tasks/${b.id}`} className="max-w-[180px] truncate hover:text-star">{b.key} {b.title}</Link></span>)}
        <ChevronRight size={12} /><span className="text-star">{t.key}</span>
      </nav>

      {t.approvalStatus === 'pending' && t.status === 'review' && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-nebula/40 bg-nebula/10 px-4 py-3">
          <ShieldCheck size={18} className="text-nebula" />
          <span className="flex-1 text-sm">This task is waiting for approval.</span>
          {t.canApprove && (<>
            <button type="button" className="btn-ghost btn-sm" onClick={() => setApproveOpen('changes')}><X size={14} />Request changes</button>
            <button type="button" className="btn-primary btn-sm" onClick={() => setApproveOpen('approve')}><Check size={14} />Approve</button>
          </>)}
        </div>
      )}
      {t.approvalStatus === 'changes_requested' && <div className="rounded-2xl border border-flare/40 bg-flare/10 px-4 py-3 text-sm">Changes were requested. See the latest comments, then send it for review again.</div>}

      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <section className="panel p-5 sm:p-6">
            <div className="flex items-start gap-5">
              <OrbitRing value={t.progress} size={76} color={STATUS[t.status]?.color} sub={t.subtaskCount ? `${t.subtaskDone}/${t.subtaskCount}` : undefined} />
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-mist">
                  <span className="font-semibold">{t.key}</span><StatusPill status={t.status} /><PriorityFlag priority={t.priority} showLabel />
                  {t.depth > 0 && <span className="chip bg-white/[0.06] text-mist"><GitBranch size={11} />Level {t.depth + 1}</span>}
                  {t.clientVisible && <span className="chip bg-signal/10 text-signal"><Eye size={11} />In client portal</span>}
                </div>
                <Editable value={t.title} onSave={(v) => patch({ title: v })} disabled={!t.canEdit} className="font-display text-2xl font-semibold" placeholder="Untitled" />
                <div className="mt-2 flex flex-wrap items-center gap-4"><DueBadge date={t.dueDate} done={t.status === 'done'} /><AvatarStack users={t.assignees} /></div>
              </div>
            </div>
            <div className="mt-5 border-t border-line pt-4">
              <span className="label">Description</span>
              <Editable value={t.description} onSave={(v) => patch({ description: v })} multiline disabled={!t.canEdit} className="min-h-[48px] p-2 text-sm leading-relaxed text-star/90" placeholder="Add the brief, links and anything the assignee needs." />
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {t.status !== 'done' && t.canEdit && (
                <button type="button" className="btn-primary btn-sm" onClick={() => patch({ status: t.requiresApproval ? 'review' : 'done' }, true)}>
                  <Check size={14} />{t.requiresApproval ? 'Send for review' : 'Mark done'}
                </button>
              )}
              <button type="button" className={running ? 'btn-danger btn-sm' : 'btn-ghost btn-sm'} onClick={toggleTimer}>{running ? <><Square size={12} fill="currentColor" />Stop timer</> : <><Play size={13} />Start timer</>}</button>
              <button type="button" className="btn-ghost btn-sm" onClick={() => setLogOpen(true)}><Clock size={13} />Log time</button>
              {t.canDelete && <button type="button" className="btn-ghost btn-sm ml-auto !text-rose" onClick={remove}><Trash2 size={13} />Delete</button>}
            </div>
          </section>

          <section className="panel p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="flex items-center gap-2 font-semibold"><GitBranch size={17} className="text-signal" />Subtasks <span className="text-sm font-normal text-mist">{t.descendants.length ? `${t.descendants.filter((d) => d.status === 'done').length} of ${t.descendants.length} done across all levels` : ''}</span></h2>
              {can('tasks.create') && <button type="button" className="btn-ghost btn-sm" onClick={() => compose({ parentId: t.id, parentTitle: t.title, clientVisible: t.clientVisible, assigneeIds: t.assignees.map((a) => a.id) })}><Plus size={14} />Add subtask</button>}
            </div>
            {t.descendants.length ? <SubtaskTree root={t} items={t.descendants} onStatus={subStatus} canCreate={can('tasks.create')} />
              : <p className="text-sm text-mist">Break this into smaller pieces and hand them to different people. Subtasks can have their own subtasks.</p>}
          </section>

          <section className="panel p-5">
            <div className="mb-3 flex items-center justify-between"><h2 className="font-semibold">Checklist</h2>{t.checklistTotal > 0 && <span className="text-xs text-mist">{t.checklistDone}/{t.checklistTotal}</span>}</div>
            {t.checklistTotal > 0 && <Bar value={(t.checklistDone / t.checklistTotal) * 100} color="#5BE3A6" className="mb-3" />}
            <ul className="space-y-1">
              {t.checklist.map((c) => (
                <li key={c.id} className="group flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-white/[0.03]">
                  <button type="button" onClick={() => toggleItem(c)} disabled={!t.canEdit} className={clsx('grid h-[18px] w-[18px] shrink-0 place-items-center rounded-md border', c.done ? 'border-mint bg-mint text-space' : 'border-mist/50')} aria-label="Toggle">{c.done && <Check size={12} strokeWidth={3} />}</button>
                  <span className={clsx('flex-1 text-sm', c.done && 'text-mist line-through')}>{c.text}</span>
                  {t.canEdit && <button type="button" onClick={() => delItem(c)} className="text-mist opacity-0 hover:text-rose group-hover:opacity-100" aria-label="Remove"><X size={14} /></button>}
                </li>
              ))}
            </ul>
            {t.canEdit && <form onSubmit={addItem} className="mt-2 flex items-center gap-2 px-2"><Plus size={14} className="text-mist" /><input value={item} onChange={(e) => setItem(e.target.value)} className="w-full bg-transparent py-1 text-sm outline-none placeholder:text-mist/60" placeholder="Add a step" /></form>}
          </section>

          <section className="panel p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold">Files</h2>
              <button type="button" className="btn-ghost btn-sm" onClick={() => fileRef.current?.click()}><Paperclip size={13} />Attach</button>
              <input ref={fileRef} type="file" multiple hidden onChange={(e) => { upload(e.target.files, false); e.target.value = ''; }} />
            </div>
            <div onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); upload(e.dataTransfer.files); }}
              className="rounded-xl border border-dashed border-line p-3">
              {t.Attachments.length ? (
                <ul className="divide-y divide-line/60">
                  {t.Attachments.map((a) => (
                    <li key={a.id} className="flex items-center gap-3 py-2 text-sm">
                      <Paperclip size={14} className="text-mist" />
                      <a href={fileUrl(a.id)} className="min-w-0 flex-1 truncate hover:underline">{a.originalName}</a>
                      <span className="text-xs text-mist">{bytes(a.size)}</span>
                      {t.clientVisible && (
                        <button type="button" title={a.clientVisible ? 'Shared with client' : 'Team only'} onClick={async () => { await api.patch(`/tasks/attachments/${a.id}`, { clientVisible: !a.clientVisible }); load(); }}
                          className={a.clientVisible ? 'text-signal' : 'text-mist'}>{a.clientVisible ? <Eye size={15} /> : <EyeOff size={15} />}</button>
                      )}
                      <a href={fileUrl(a.id)} className="text-mist hover:text-star" aria-label="Download"><Download size={15} /></a>
                      <button type="button" onClick={async () => { await api.delete(`/tasks/attachments/${a.id}`); load(); }} className="text-mist hover:text-rose" aria-label="Remove file"><Trash2 size={14} /></button>
                    </li>
                  ))}
                </ul>
              ) : <p className="py-4 text-center text-sm text-mist">Drop files here, up to 25 MB each.</p>}
            </div>
          </section>

          <section className="panel p-5">
            <h2 className="mb-4 font-semibold">Conversation</h2>
            <Comments task={t} onPosted={() => load()} />
          </section>
        </div>

        <aside className="space-y-6">
          <section className="panel p-5"><Sidebar t={t} patch={patch} people={people} can={can} /></section>
          <section className="panel p-5">
            <div className="mb-3 flex items-center justify-between"><h2 className="font-semibold">Time</h2><span className="font-display text-lg">{minutes(totalMinutes)}{t.estimateHours ? <span className="text-sm text-mist"> of {t.estimateHours}h</span> : ''}</span></div>
            {t.estimateHours > 0 && <Bar value={(totalMinutes / (t.estimateHours * 60)) * 100} color={totalMinutes > t.estimateHours * 60 ? '#FF7A90' : '#8F7BFF'} className="mb-3" />}
            <ul className="space-y-2 text-sm">
              {t.TimeLogs.slice(-6).reverse().map((l) => (
                <li key={l.id} className="flex items-center gap-2"><Avatar user={l.User} size={20} /><span className="flex-1 truncate text-mist">{l.note || fmtDate(l.startedAt, 'd MMM, h:mm a')}</span><span>{l.endedAt ? minutes(l.minutes) : <span className="text-signal">running</span>}</span></li>
              ))}
              {!t.TimeLogs.length && <li className="text-mist">No time logged yet.</li>}
            </ul>
          </section>
          <section className="panel p-5">
            <h2 className="mb-3 font-semibold">History</h2>
            <ol className="space-y-3 text-sm">
              {t.history.map((h) => (
                <li key={h.id} className="flex gap-2"><Avatar user={h.actor} size={18} /><span><span className="font-medium">{h.actor?.name}</span> <span className="text-mist">{h.summary}</span><span className="block text-[11px] text-mist/70">{ago(h.createdAt)}</span></span></li>
              ))}
            </ol>
          </section>
        </aside>
      </div>

      <LogTime open={logOpen} onClose={() => setLogOpen(false)} taskId={t.id} onDone={load} />
      <Decision open={!!approveOpen} mode={approveOpen} onClose={() => setApproveOpen(null)} onSubmit={decide} />
    </div>
  );
}

function LogTime({ open, onClose, taskId, onDone }) {
  const [m, setM] = useState('30'); const [note, setNote] = useState('');
  const save = async () => {
    try { await api.post(`/tasks/${taskId}/timelogs`, { minutes: Number(m), note }); toast.success('Time logged'); onClose(); onDone(); } catch (e) { toast.error(e.message); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Log time" width="max-w-sm" footer={<><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button type="button" className="btn-primary" onClick={save}>Log time</button></>}>
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">{[15, 30, 60, 90, 120].map((v) => <button type="button" key={v} onClick={() => setM(String(v))} className={clsx('btn-ghost btn-sm', Number(m) === v && '!border-signal/50 !text-signal')}>{minutes(v)}</button>)}</div>
        <input type="number" className="input" value={m} onChange={(e) => setM(e.target.value)} aria-label="Minutes" />
        <input className="input" placeholder="What did you work on? (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
    </Modal>
  );
}

function Decision({ open, mode, onClose, onSubmit }) {
  const [note, setNote] = useState('');
  useEffect(() => setNote(''), [open]);
  return (
    <Modal open={open} onClose={onClose} title={mode === 'approve' ? 'Approve task' : 'Request changes'} width="max-w-md"
      footer={<><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button type="button" className="btn-primary" onClick={() => onSubmit(mode, note)}>{mode === 'approve' ? 'Approve' : 'Send back'}</button></>}>
      <textarea className="input min-h-[100px]" placeholder={mode === 'approve' ? 'Optional note for the assignee' : 'What needs to change?'} value={note} onChange={(e) => setNote(e.target.value)} />
    </Modal>
  );
}
