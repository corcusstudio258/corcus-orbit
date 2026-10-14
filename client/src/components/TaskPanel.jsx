import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import {
  ChevronRight, Plus, Trash2, Paperclip, Play, Square, Eye, EyeOff, ShieldCheck, Check, X, Lock, Globe, Clock, GitBranch, Download,
  Bell, BellOff, MoreHorizontal, Archive, Copy, Maximize2, Link2, Sparkles, Repeat, Hash, Ban, Send, UserCheck, MessageSquareWarning,
} from 'lucide-react';
import api, { fileUrl } from '../lib/api';
import { useAuth, useLive } from '../context/AuthContext';
import { useDirectory, useAiStatus } from '../lib/directory';
import { STATUS, PRIORITY, ago, minutes, bytes, fmtDate } from '../lib/format';
import { OrbitRing, Avatar, AvatarStack, StatusPill, DueBadge, PageLoader, UserPicker, Toggle, Bar, Modal, Menu, Markdown, Spinner, Tabs, confirm, DueInput } from './ui';
import { useComposer } from './Layout';
import { celebrate, pointOf } from './Celebrate';
import { CommentThread, ReviewBoard, BriefThread, toFormData } from './Review';

export async function changeStatus(task, status, at) {
  const { data } = await api.patch(`/tasks/${task.id}`, { status });
  if (data.notice) toast(data.notice, { icon: '⚠️' });
  if (data.status !== task.status && ['review', 'done'].includes(data.status)) celebrate(data.status, at);
  return data;
}

function Editable({ value, onSave, multiline, className, placeholder, disabled, markdown }) {
  const [v, setV] = useState(value || '');
  const [editing, setEditing] = useState(false);
  useEffect(() => setV(value || ''), [value]);
  const commit = () => { setEditing(false); if (v !== (value || '')) onSave(v); };
  if (!editing) {
    const content = value ? (markdown ? <Markdown>{value}</Markdown> : value) : <span className="text-faint">{placeholder}</span>;
    if (disabled) return <div className={clsx(className, 'whitespace-pre-wrap')}>{content}</div>;
    return <div role="button" tabIndex={0} onClick={() => setEditing(true)} onKeyDown={(e) => e.key === 'Enter' && setEditing(true)} className={clsx(className, 'cursor-text whitespace-pre-wrap rounded-lg transition hover:bg-sunken/70')}>{content}</div>;
  }
  return multiline
    ? <textarea autoFocus className="input min-h-[160px] font-sans" value={v} onChange={(e) => setV(e.target.value)} onBlur={commit} />
    : <input autoFocus className={clsx('input', className)} value={v} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setV(value || ''); setEditing(false); } }} />;
}

function StatusStepper({ status, onChange, disabled }) {
  const flow = ['backlog', 'todo', 'in_progress', 'review', 'done'];
  const idx = flow.indexOf(status);
  return (
    <div className="grid grid-cols-5 gap-1 rounded-xl bg-sunken p-1">
      {flow.map((s, i) => (
        <button key={s} type="button" disabled={disabled} onClick={(e) => onChange(s, e)}
          className={clsx('rounded-lg px-1 py-1.5 text-[11px] font-semibold transition sm:text-xs', s === status ? 'text-white' : i < idx ? 'text-ink' : 'text-faint hover:text-ink')}
          style={s === status ? { background: STATUS[s].color } : i < idx ? { background: `${STATUS[s].color}22` } : undefined}>{STATUS[s].label}</button>
      ))}
    </div>
  );
}

function SubtaskTree({ root, items, onStatus, canCreate, onOpen }) {
  const byParent = {};
  items.forEach((t) => { (byParent[t.parentId] = byParent[t.parentId] || []).push(t); });
  const compose = useComposer();
  const render = (parentId, level) => (byParent[parentId] || []).map((t) => (
    <div key={t.id}>
      <div className="group flex items-center gap-2 rounded-lg py-1.5 pr-2 hover:bg-sunken/70" style={{ paddingLeft: level * 20 + 4 }}>
        {level > 0 && <span className="h-3 w-2.5 shrink-0 rounded-bl border-b border-l border-line" />}
        <button type="button" onClick={() => onStatus(t, t.status === 'done' ? 'todo' : 'done')} aria-label={t.status === 'done' ? 'Mark not done' : 'Mark done'}
          className={clsx('grid h-[18px] w-[18px] shrink-0 place-items-center rounded-md border-2 transition', t.status === 'done' ? 'border-leaf bg-leaf text-white' : 'border-line hover:border-leaf')}>
          {t.status === 'done' && <Check size={11} strokeWidth={3} />}
        </button>
        <button type="button" onClick={() => onOpen(t.id)} className="min-w-0 flex-1 truncate text-left text-sm">
          <span className="mr-2 text-xs text-faint">{t.key}</span>
          <span className={clsx(t.status === 'done' && 'text-faint line-through')}>{t.title}</span>
        </button>
        {t.subtaskCount > 0 && <span className="text-[11px] text-muted">{t.progress}%</span>}
        <span className="hidden sm:block"><DueBadge date={t.dueDate} done={t.status === 'done'} compact /></span>
        <AvatarStack users={t.assignees} size={20} max={2} emptyLabel="" />
        <span className="hidden md:block"><StatusPill status={t.status} small /></span>
        {canCreate && <button type="button" title="Add a subtask under this" onClick={() => compose({ parentId: t.id, parentTitle: t.title, assigneeIds: t.assignees.map((a) => a.id) })}
          className="rounded p-1 text-muted opacity-0 hover:text-cobalt group-hover:opacity-100"><Plus size={14} /></button>}
      </div>
      {render(t.id, level + 1)}
    </div>
  ));
  return <div>{render(root.id, 0)}</div>;
}

function Comments({ task, onPosted }) {
  const people = useDirectory();
  const ai = useAiStatus();
  const [shared, setShared] = useState(false);
  const [mentions, setMentions] = useState([]);
  const post = async (v) => {
    await api.post(`/tasks/${task.id}/comments`, toFormData(v, { internal: !shared, mentions }));
    setMentions([]); onPosted();
  };
  const share = task.clientVisible ? (
    <button type="button" onClick={() => setShared((s) => !s)} className={clsx('chip border py-1', shared ? 'border-cobalt/40 bg-cobalt/10 text-cobalt' : 'border-line text-muted')}>
      {shared ? <><Globe size={11} />Client will see this</> : <><Lock size={11} />Team only</>}
    </button>
  ) : <span className="inline-flex items-center gap-1 text-[11px] text-faint"><Lock size={11} />Team only</span>;
  return (
    <CommentThread comments={task.Comments} onPost={post} canShare people={people} onMention={(id) => setMentions((m) => [...new Set([...m, id])])}
      emptyText="No comments yet. Updates here notify the assignees and watchers."
      composerExtra={<>{share}{ai.ready && <span className="text-[11px] text-faint">Tip: Orbit AI can polish client updates from the Overview tab.</span>}</>} />
  );
}

function Dependencies({ task, reload }) {
  const [q, setQ] = useState('');
  const [res, setRes] = useState([]);
  useEffect(() => {
    if (q.trim().length < 2) { setRes([]); return undefined; }
    const t = setTimeout(() => api.get(`/tasks?q=${encodeURIComponent(q)}&limit=8`).then((r) => setRes(r.data.filter((x) => x.id !== task.id))), 180);
    return () => clearTimeout(t);
  }, [q, task.id]);
  const add = async (b) => { try { await api.post(`/tasks/${task.id}/dependencies`, { blockerId: b.id }); setQ(''); setRes([]); reload(); } catch (e) { toast.error(e.message); } };
  const remove = async (b) => { await api.delete(`/tasks/${task.id}/dependencies/${b.id}`); reload(); };
  const Row = ({ t, onRemove }) => (
    <li className="flex items-center gap-3 rounded-lg border border-line bg-surface px-3 py-2 text-sm">
      <span className="h-2 w-2 rounded-full" style={{ background: STATUS[t.status]?.color }} />
      <Link to={`?task=${t.id}`} className="min-w-0 flex-1 truncate hover:underline"><span className="mr-2 text-xs text-faint">{t.key}</span>{t.title}</Link>
      <StatusPill status={t.status} small />
      {onRemove && task.canEdit && <button type="button" onClick={onRemove} className="text-muted hover:text-ember" aria-label="Remove"><X size={14} /></button>}
    </li>
  );
  return (
    <div className="space-y-5">
      <div>
        <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold"><Ban size={15} className="text-ember" />Waiting on</h3>
        <ul className="space-y-1.5">{task.blockers.map((b) => <Row key={b.id} t={b} onRemove={() => remove(b)} />)}</ul>
        {!task.blockers.length && <p className="text-sm text-muted">Nothing. This task can start any time.</p>}
        {task.canEdit && (
          <div className="relative mt-2">
            <input className="input" placeholder="Search a task this one depends on…" value={q} onChange={(e) => setQ(e.target.value)} />
            {res.length > 0 && (
              <div className="absolute z-20 mt-1 w-full rounded-xl border border-line bg-surface p-1 shadow-lift">
                {res.map((t) => <button key={t.id} type="button" onClick={() => add(t)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-sunken"><span className="text-xs text-faint">{t.key}</span><span className="truncate">{t.title}</span></button>)}
              </div>
            )}
          </div>
        )}
      </div>
      <div>
        <h3 className="mb-2 text-sm font-semibold">Holding up</h3>
        <ul className="space-y-1.5">{task.blocking.map((b) => <Row key={b.id} t={b} />)}</ul>
        {!task.blocking.length && <p className="text-sm text-muted">No other task waits on this one.</p>}
      </div>
    </div>
  );
}

function Breakdown({ task, onDone }) {
  const [items, setItems] = useState(null);
  const [busy, setBusy] = useState(false);
  const [sel, setSel] = useState([]);
  const run = async () => {
    setBusy(true);
    try { const { data } = await api.post('/ai/breakdown', { taskId: task.id }); setItems(data.subtasks); setSel(data.subtasks.map((_, i) => i)); } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  const create = async () => {
    setBusy(true);
    try {
      for (const i of sel) {
        const s = items[i];
        await api.post('/tasks', { title: s.title, parentId: task.id, priority: s.priority, estimateHours: s.estimateHours, dueDate: s.dueDate, assigneeIds: task.assignees.map((a) => a.id) });
      }
      toast.success(`Added ${sel.length} subtasks`); setItems(null); onDone();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  if (!items) return <button type="button" className="btn-ai btn-sm" onClick={run} disabled={busy}>{busy ? <Spinner size={13} className="text-violet" /> : <Sparkles size={13} />}Break down with AI</button>;
  return (
    <div className="mt-3 w-full rounded-xl border border-violet/25 bg-violet/5 p-3">
      <p className="mb-2 text-xs font-semibold text-violet">Suggested subtasks</p>
      <ul className="space-y-1">
        {items.map((s, i) => (
          <li key={i}><label className="flex items-center gap-2 rounded-lg px-1 py-1 text-sm hover:bg-surface/60">
            <input type="checkbox" className="accent-[#8B5CF6]" checked={sel.includes(i)} onChange={() => setSel((x) => (x.includes(i) ? x.filter((y) => y !== i) : [...x, i]))} />
            <span className="flex-1">{s.title}</span>{s.estimateHours ? <span className="text-xs text-muted">{s.estimateHours}h</span> : null}
          </label></li>
        ))}
      </ul>
      <div className="mt-2 flex justify-end gap-2"><button type="button" className="btn-ghost btn-sm" onClick={() => setItems(null)}>Discard</button><button type="button" className="btn-ai btn-sm" onClick={create} disabled={busy || !sel.length}>Add {sel.length} subtasks</button></div>
    </div>
  );
}

const DESC_REVIEW = {
  requested: { label: 'Waiting for client feedback', cls: 'bg-cobalt/10 text-cobalt', icon: Send },
  approved: { label: 'Client approved', cls: 'bg-leaf/15 text-leaf', icon: UserCheck },
  changes: { label: 'Client wants changes', cls: 'bg-amber/15 text-amber', icon: MessageSquareWarning },
};
/** Shows whether the client can read the description and lets the team ask for their feedback on it. */
function DescClientBar({ t, patch, reload }) {
  const [open, setOpen] = useState(false);
  const thread = t.Comments.filter((c) => c.kind === 'brief');
  const fromClient = thread.filter((c) => c.author?.Role?.isClientRole).length;
  const st = DESC_REVIEW[t.descReviewStatus];
  const shared = t.descClientVisible !== false;
  return (
    <div className={clsx('mt-2 rounded-xl border px-3 py-2.5', t.descReviewStatus === 'changes' ? 'border-amber/40 bg-amber/5' : 'border-line bg-sunken/40')}>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <button type="button" disabled={!t.canEdit} onClick={() => patch({ descClientVisible: !shared })} className={clsx('chip border py-1', shared ? 'border-cobalt/40 bg-cobalt/10 text-cobalt' : 'border-line text-muted')} title="Who can read this description">
          {shared ? <><Globe size={11} />Client can read this</> : <><Lock size={11} />Team only</>}
        </button>
        {st && shared && <span className={clsx('chip py-1', st.cls)}><st.icon size={11} />{st.label}{t.descReviewedAt && t.descReviewStatus !== 'requested' ? `, ${ago(t.descReviewedAt)}` : ''}</span>}
        <span className="ml-auto flex gap-1.5">
          {t.canEdit && shared && t.descReviewStatus !== 'requested' && <button type="button" className="btn-ghost btn-sm" disabled={!String(t.description || '').trim()} onClick={() => patch({ descReviewStatus: 'requested' })}><Send size={12} />{t.descReviewStatus === 'none' ? 'Ask client for feedback' : 'Ask again'}</button>}
          {t.canEdit && t.descReviewStatus === 'requested' && <button type="button" className="btn-ghost btn-sm" onClick={() => patch({ descReviewStatus: 'none' })}>Withdraw</button>}
        </span>
      </div>
      {t.descReviewStatus === 'changes' && t.descReviewNote && shared && <p className="mt-2 whitespace-pre-wrap text-sm"><b>Client:</b> {t.descReviewNote}</p>}
      {t.descReviewStatus === 'changes' && shared && <p className="mt-1 text-[11px] text-muted">Edit the description and the client is asked to check it again.</p>}
      {shared && (
        <div className="mt-2 border-t border-line/70 pt-2">
          <button type="button" onClick={() => setOpen((o) => !o)} className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted hover:text-ink">
            <ChevronRight size={13} className={clsx('transition', (open || fromClient > 0) && 'rotate-90')} />
            Comments with the client on this description{thread.length ? ` (${thread.length})` : ''}
          </button>
          {(open || fromClient > 0) && (
            <div className="mt-2">
              <BriefThread comments={t.Comments} emptyText="No comments yet. The client can comment on the description from their portal."
                placeholder="Reply to the client about the description" extra={<span className="inline-flex items-center gap-1 text-[11px] text-cobalt"><Globe size={11} />The client sees this</span>}
                onPost={async (v) => { await api.post(`/tasks/${t.id}/comments`, toFormData(v, { kind: 'brief', internal: false })); reload(); }} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function TaskPanel({ id, onClose, inDrawer }) {
  const nav = useNavigate();
  const { can, user } = useAuth();
  const people = useDirectory();
  const ai = useAiStatus();
  const compose = useComposer();
  const [t, setT] = useState(null);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState(() => new URLSearchParams(window.location.search).get('tab') || 'overview');
  const [item, setItem] = useState('');
  const [timer, setTimer] = useState(null);
  const [logOpen, setLogOpen] = useState(false);
  const [decision, setDecision] = useState(null);
  const [writing, setWriting] = useState(false);
  const [link, setLink] = useState('');
  const fileRef = useRef(null);

  const load = () => api.get(`/tasks/${id}`).then((r) => { setT(r.data); setError(null); }).catch((e) => setError(e.message));
  const loadTimer = () => api.get('/tasks/timer/active').then((r) => setTimer(r.data)).catch(() => {});
  useEffect(() => { setT(null); setTab(new URLSearchParams(window.location.search).get('tab') || 'overview'); load(); loadTimer(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  useLive('task:changed', () => load(), [id]);
  useEffect(() => { const h = () => load(); window.addEventListener('orbit:task-created', h); return () => window.removeEventListener('orbit:task-created', h); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const openTask = (tid) => (inDrawer ? nav({ search: `?task=${tid}` }) : nav(`/tasks/${tid}`));

  if (error) return <div className="p-10 text-center"><p className="text-muted">{error}</p>{onClose && <button type="button" className="btn-ghost mt-4" onClick={onClose}>Close</button>}</div>;
  if (!t) return <div className="p-6"><PageLoader /></div>;

  const patch = async (body, isStatus, evt) => {
    try {
      const data = isStatus ? await changeStatus(t, body.status, pointOf(evt)) : (await api.patch(`/tasks/${t.id}`, body)).data;
      if (!isStatus && data.notice) toast(data.notice);
      load();
    } catch (err) { toast.error(err.message); }
  };
  const subStatus = async (s, status) => { try { await changeStatus(s, status); load(); } catch (e) { toast.error(e.message); } };
  const addItem = async (e) => { e.preventDefault(); if (!item.trim()) return; await api.post(`/tasks/${t.id}/checklist`, { text: item }); setItem(''); load(); };
  const toggleItem = async (c) => { await api.patch(`/tasks/checklist/${c.id}`, { done: !c.done }); load(); };
  const delItem = async (c) => { await api.delete(`/tasks/checklist/${c.id}`); load(); };
  const upload = async (files) => {
    const list = [...(files || [])];
    if (!list.length) return;
    const isVid = (f) => /^video\//.test(f.type) || /\.(mp4|mov|m4v|webm|mkv|avi)$/i.test(f.name);
    const big = list.find((f) => f.size > (isVid(f) ? 150 : 25) * 1024 * 1024);
    if (big) { toast.error(`${big.name} is ${bytes(big.size)}. Videos can be up to 150 MB, other files up to 25 MB.`); return; }
    if (list.length > 10) { toast.error('Upload up to 10 files at a time.'); return; }
    const fd = new FormData(); list.forEach((f) => fd.append('files', f)); fd.append('clientVisible', 'false');
    const total = list.reduce((s, f) => s + f.size, 0);
    const tId = toast.loading(`Uploading ${bytes(total)}…`);
    try {
      await api.post(`/tasks/${t.id}/attachments`, fd, {
        timeout: 0,
        onUploadProgress: (e) => { const pct = e.total ? Math.round((e.loaded / e.total) * 100) : 0; toast.loading(pct < 100 ? `Uploading ${pct}% of ${bytes(total)}…` : 'Saving…', { id: tId }); },
      });
      toast.success(list.some(isVid) ? 'Uploaded. The video is being compressed and stays playable meanwhile.' : 'Uploaded', { id: tId, duration: 5000 });
      load();
    } catch (e) { toast.error(e.message, { id: tId }); }
  };
  const canRemoveFile = (a) => t.canDeleteFiles || a.userId === user?.id;
  const removeFile = async (a) => {
    const notes = t.Comments.filter((c) => c.kind === 'review' && c.attachmentId === a.id).length;
    if (!(await confirm({ title: `Delete ${a.originalName}?`, body: `The file is removed for everyone${a.clientVisible ? ', including the client' : ''}${notes ? `, along with its ${notes} review note${notes > 1 ? 's' : ''}` : ''}. This can't be undone.`, confirmLabel: 'Delete', danger: true }))) return false;
    try { await api.delete(`/tasks/attachments/${a.id}`); toast.success('File deleted'); load(); return true; } catch (e) { toast.error(e.message); return false; }
  };
  const running = timer && timer.taskId === t.id;
  const toggleTimer = async () => {
    if (running) { const r = await api.post('/tasks/timer/stop'); toast.success(`Logged ${minutes(r.data.minutes)}`); } else { await api.post(`/tasks/${t.id}/timer/start`); toast.success('Timer started'); }
    loadTimer(); load(); window.dispatchEvent(new Event('orbit:timer'));
  };
  const remove = async () => {
    if (!(await confirm({ title: `Delete ${t.key}?`, body: `This removes the task${t.descendants.length ? ` and its ${t.descendants.length} subtasks` : ''}, comments and files. It can't be undone.`, confirmLabel: 'Delete task', danger: true }))) return;
    await api.delete(`/tasks/${t.id}`); toast.success('Task deleted');
    if (inDrawer) onClose(); else nav(t.Project ? `/projects/${t.Project.id}` : '/my-tasks');
  };
  const duplicate = async () => { const { data } = await api.post(`/tasks/${t.id}/duplicate`); toast.success(`Duplicated as ${data.key}`); openTask(data.id); };
  const toggleWatch = async () => { if (t.watching) await api.delete(`/tasks/${t.id}/watch`); else await api.post(`/tasks/${t.id}/watch`, {}); load(); };
  const decide = async (d, note) => {
    try { await api.post(`/tasks/${t.id}/approval`, { decision: d, note }); setDecision(null); toast.success(d === 'approve' ? 'Approved' : 'Sent back with changes'); load(); } catch (e) { toast.error(e.message); }
  };
  const aiDescribe = async () => {
    setWriting(true);
    try {
      const { data } = await api.post('/ai/describe', { taskId: t.id });
      await api.patch(`/tasks/${t.id}`, { description: data.description });
      if (data.checklist?.length) await api.post(`/tasks/${t.id}/checklist`, { items: data.checklist });
      toast.success('Brief written'); load();
    } catch (e) { toast.error(e.message); } finally { setWriting(false); }
  };
  const addLink = async (e) => { e.preventDefault(); if (!link.trim()) return; await patch({ links: [...(t.links || []), link.trim()] }); setLink(''); };
  const totalMinutes = t.TimeLogs.reduce((s, l) => s + (l.minutes || 0), 0);
  const myReview = t.canApprove && (t.reviewers || []).some((r) => r.id === user?.id);
  const assignable = can('tasks.assign') ? people : people.filter((p) => t.assignees.some((a) => a.id === p.id));

  const detail = (label, node) => (<div className="grid grid-cols-[110px_1fr] items-center gap-3 py-1.5"><span className="text-xs text-muted">{label}</span><div className="min-w-0 text-sm">{node}</div></div>);

  return (
    <div className={clsx(inDrawer ? 'min-h-full' : '')}>
      {/* header */}
      <div className={clsx('sticky top-0 z-10 flex items-center gap-2 border-b border-line bg-canvas/90 px-5 py-3 backdrop-blur', !inDrawer && 'rounded-t-xl2')}>
        <nav className="flex min-w-0 flex-1 flex-wrap items-center gap-1 text-xs text-muted" aria-label="Breadcrumb">
          {t.Project ? <Link to={`/projects/${t.Project.id}`} className="inline-flex items-center gap-1 hover:text-ink"><span className="h-2 w-2 rounded-full" style={{ background: t.Project.color }} />{t.Project.name}</Link> : <span>Personal</span>}
          {t.breadcrumb.map((b) => <span key={b.id} className="inline-flex items-center gap-1"><ChevronRight size={12} /><button type="button" onClick={() => openTask(b.id)} className="max-w-[160px] truncate hover:text-ink">{b.key}</button></span>)}
          <ChevronRight size={12} /><span className="font-semibold text-ink">{t.key}</span>
        </nav>
        <button type="button" onClick={toggleWatch} className={clsx('btn-sm btn', t.watching ? 'bg-brand-soft text-ink' : 'text-muted hover:bg-sunken')} title={t.watching ? 'Stop watching' : 'Get notified about changes'}>
          {t.watching ? <BellOff size={14} /> : <Bell size={14} />}<span className="hidden sm:inline">{t.watching ? 'Watching' : 'Watch'}</span>
        </button>
        <button type="button" className={running ? 'btn-danger btn-sm' : 'btn-ghost btn-sm'} onClick={toggleTimer}>{running ? <><Square size={11} fill="currentColor" />Stop</> : <><Play size={12} />Timer</>}</button>
        <Menu trigger={<button type="button" className="rounded-lg p-1.5 text-muted hover:bg-sunken" aria-label="More"><MoreHorizontal size={18} /></button>} items={[
          inDrawer && { label: 'Open full page', icon: Maximize2, onClick: () => nav(`/tasks/${t.id}`) },
          { label: 'Copy link', icon: Link2, onClick: () => { navigator.clipboard?.writeText(`${location.origin}/tasks/${t.id}`); toast.success('Link copied'); } },
          { label: 'Duplicate', icon: Copy, onClick: duplicate },
          { label: 'Log time manually', icon: Clock, onClick: () => setLogOpen(true) },
          t.canEdit && { label: t.archived ? 'Restore from archive' : 'Archive', icon: Archive, onClick: async () => { try { await api.patch(`/tasks/${t.id}`, { archived: !t.archived }); if (!t.archived) celebrate('archive'); else toast.success('Restored'); load(); } catch (err) { toast.error(err.message); } } },
          t.canDelete && '-',
          t.canDelete && { label: 'Delete task', icon: Trash2, danger: true, onClick: remove },
        ]} />
        {onClose && <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-muted hover:bg-sunken" aria-label="Close"><X size={18} /></button>}
      </div>

      <div className="space-y-5 px-5 py-5">
        {t.approvalStatus === 'pending' && t.status === 'review' && (
          <div className={clsx('flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3', myReview ? 'border-violet bg-violet/10 ring-2 ring-violet/20' : 'border-violet/30 bg-violet/5')}>
            <ShieldCheck size={18} className="text-violet" />
            <span className="flex-1 text-sm">
              {myReview ? <b className="text-violet">This task is waiting for your review.</b> : 'Waiting for approval'}
              {!myReview && t.reviewers?.length > 0 && <> from {t.reviewers.map((r) => r.name.split(' ')[0]).join(', ')}</>}{!myReview && '.'}
            </span>
            {t.canApprove && (<>
              <button type="button" className="btn-ghost btn-sm" onClick={() => setDecision('changes')}><X size={14} />Request changes</button>
              <button type="button" className="btn-primary btn-sm" onClick={() => setDecision('approve')}><Check size={14} />Approve</button>
            </>)}
          </div>
        )}
        {t.approvalStatus === 'changes_requested' && <div className="rounded-xl border border-amber/30 bg-amber/5 px-4 py-3 text-sm">Changes were requested. See comments, then send it for review again.</div>}
        {t.openBlockers > 0 && <div className="flex items-center gap-2 rounded-xl border border-ember/25 bg-ember/5 px-4 py-2.5 text-sm text-ember"><Ban size={15} />Waiting on {t.blockers.filter((b) => b.status !== 'done').map((b) => b.key).join(', ')}</div>}

        <div className="flex items-start gap-4">
          <OrbitRing value={t.progress} size={68} stroke={5} color={STATUS[t.status]?.color} sub={t.subtaskCount ? `${t.subtaskDone}/${t.subtaskCount}` : undefined} />
          <div className="min-w-0 flex-1">
            <Editable value={t.title} onSave={(v) => patch({ title: v })} disabled={!t.canEdit} className="-mx-2 px-2 py-1 font-display text-[22px] font-semibold leading-snug" placeholder="Untitled" />
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <StatusPill status={t.status} />
              <span className="chip" style={{ color: PRIORITY[t.priority].color, background: `${PRIORITY[t.priority].color}17` }}>{PRIORITY[t.priority].label}</span>
              {t.depth > 0 && <span className="chip bg-sunken text-muted"><GitBranch size={11} />Level {t.depth + 1}</span>}
              {t.clientVisible && <span className="chip bg-cobalt/10 text-cobalt"><Eye size={11} />Client can see</span>}
              {t.recurrence && <span className="chip bg-teal/10 text-teal"><Repeat size={11} />Repeats {t.recurrence.freq}</span>}
              {t.Sprint && <span className="chip bg-sunken text-muted">{t.Sprint.name}</span>}
            </div>
          </div>
        </div>

        <StatusStepper status={t.status} disabled={!t.canEdit} onChange={(s, e) => patch({ status: s }, true, e)} />

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block"><span className="label">Assignees</span><UserPicker compact users={assignable} value={t.assignees.map((a) => a.id)} disabled={!t.canEdit || !can('tasks.assign')} onChange={(ids) => patch({ assigneeIds: ids })} placeholder="Unassigned" /></label>
          <div className="block"><span className="label">Due date and time</span><DueInput compact disabled={!t.canEdit} value={t.dueDate || ''} onChange={(v) => patch({ dueDate: v })} /></div>
          <label className="block"><span className="label">Reviewers</span><UserPicker compact users={people} value={(t.reviewers || []).map((a) => a.id)} disabled={!t.canEdit} onChange={(ids) => patch({ reviewerIds: ids })} placeholder="No reviewer" /></label>
          <label className="block"><span className="label">Priority</span>
            <select disabled={!t.canEdit} className="input !py-1.5" value={t.priority} onChange={(e) => patch({ priority: e.target.value })}>{Object.entries(PRIORITY).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
          </label>
        </div>

        <Tabs value={tab} onChange={setTab} tabs={[
          { value: 'overview', label: 'Overview' },
          { value: 'subtasks', label: 'Subtasks', count: t.descendants.length || undefined },
          { value: 'comments', label: 'Comments', count: t.Comments.filter((c) => c.kind !== 'review').length || undefined },
          { value: 'review', label: 'Review', count: t.Comments.filter((c) => c.kind === 'review' && !c.resolved).length || undefined },
          { value: 'time', label: 'Time', count: t.TimeLogs.length || undefined },
          { value: 'depends', label: 'Depends', count: (t.blockers.length + t.blocking.length) || undefined },
          { value: 'files', label: 'Files', count: t.Attachments.filter((a) => !a.commentId).length || undefined },
          { value: 'activity', label: 'Activity' },
        ]} />

        {tab === 'overview' && (
          <div className="space-y-5">
            <div>
              <div className="mb-1.5 flex items-center justify-between"><span className="label !mb-0">Description</span>
                {ai.ready && t.canEdit && <button type="button" className="btn-ai btn-sm" onClick={aiDescribe} disabled={writing}>{writing ? <Spinner size={12} className="text-violet" /> : <Sparkles size={13} />}{t.description ? 'Rewrite brief' : 'Write brief with AI'}</button>}
              </div>
              <Editable value={t.description} onSave={(v) => patch({ description: v })} multiline markdown disabled={!t.canEdit} className="-mx-2 min-h-[56px] px-2 py-1.5 text-sm leading-relaxed" placeholder="Add the brief, links and anything the assignee needs." />
              {t.clientVisible && <DescClientBar t={t} patch={patch} reload={load} />}
            </div>

            <div>
              <div className="mb-1.5 flex items-center justify-between"><span className="label !mb-0">Checklist</span>{t.checklistTotal > 0 && <span className="text-xs text-muted">{t.checklistDone}/{t.checklistTotal}</span>}</div>
              {t.checklistTotal > 0 && <Bar value={(t.checklistDone / t.checklistTotal) * 100} color="rgb(var(--c-leaf))" className="mb-2" height={4} />}
              <ul className="space-y-0.5">
                {t.checklist.map((c) => (
                  <li key={c.id} className="group flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-sunken/70">
                    <button type="button" onClick={() => toggleItem(c)} disabled={!t.canEdit} className={clsx('grid h-[18px] w-[18px] shrink-0 place-items-center rounded-md border-2', c.done ? 'border-leaf bg-leaf text-white' : 'border-line')} aria-label="Toggle">{c.done && <Check size={11} strokeWidth={3} />}</button>
                    <span className={clsx('flex-1 text-sm', c.done && 'text-faint line-through')}>{c.text}</span>
                    {t.canEdit && <button type="button" onClick={() => delItem(c)} className="text-muted opacity-0 hover:text-ember group-hover:opacity-100" aria-label="Remove"><X size={14} /></button>}
                  </li>
                ))}
              </ul>
              {t.canEdit && <form onSubmit={addItem} className="mt-1 flex items-center gap-2 px-2"><Plus size={14} className="text-faint" /><input value={item} onChange={(e) => setItem(e.target.value)} className="w-full bg-transparent py-1 text-sm outline-none placeholder:text-faint" placeholder="Add a step" /></form>}
            </div>

            <div className="rounded-xl border border-line bg-surface px-4 py-2">
              {detail('Start', <input type="date" disabled={!t.canEdit} className="input !py-1" value={t.startDate || ''} onChange={(e) => patch({ startDate: e.target.value })} />)}
              {detail('Estimate', <span className="flex gap-2"><input type="number" min="0" step="0.5" disabled={!t.canEdit} className="input !py-1" defaultValue={t.estimateHours || ''} placeholder="hours" onBlur={(e) => Number(e.target.value || 0) !== Number(t.estimateHours || 0) && patch({ estimateHours: e.target.value })} />
                <input type="number" min="0" disabled={!t.canEdit} className="input !py-1" defaultValue={t.storyPoints || ''} placeholder="points" onBlur={(e) => Number(e.target.value || 0) !== Number(t.storyPoints || 0) && patch({ storyPoints: e.target.value })} /></span>)}
              {t.Section && detail('Section', <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: t.Section.color }} />{t.Section.name}</span>)}
              {t.Milestone && detail('Milestone', t.Milestone.title)}
              {detail('Tags', <span className="flex flex-wrap gap-1">{(t.tags || []).map((g) => <span key={g} className="chip bg-sunken text-muted"><Hash size={10} />{g}</span>)}{!t.tags?.length && <span className="text-faint">None</span>}</span>)}
              {detail('Links', (
                <div className="space-y-1">
                  {(t.links || []).map((l, i) => <div key={i} className="flex items-center gap-2"><a href={l} target="_blank" rel="noreferrer" className="link truncate text-xs">{l}</a>{t.canEdit && <button type="button" className="text-muted hover:text-ember" onClick={() => patch({ links: t.links.filter((_, j) => j !== i) })}><X size={12} /></button>}</div>)}
                  {t.canEdit && <form onSubmit={addLink}><input className="input !py-1 text-xs" placeholder="Paste a Drive, Figma or Canva link" value={link} onChange={(e) => setLink(e.target.value)} /></form>}
                </div>
              ))}
              {detail('Created', <span className="inline-flex items-center gap-2"><Avatar user={t.creator} size={20} />{t.creator?.name}<span className="text-xs text-faint">{ago(t.createdAt)}</span></span>)}
              {t.watchers.length > 0 && detail('Watching', <AvatarStack users={t.watchers} max={6} size={22} />)}
            </div>

            <div className="space-y-3 rounded-xl bg-sunken/60 p-4">
              <Toggle checked={t.clientVisible} disabled={!t.canEdit} onChange={(v) => patch({ clientVisible: v })} label="Show in client portal" hint={t.Project?.clientId ? 'Client sees status, progress and shared updates.' : 'This project has no client.'} />
              <Toggle checked={t.requiresApproval} disabled={!t.canEdit} onChange={(v) => patch({ requiresApproval: v })} label="Needs approval" hint="Done goes to review first." />
            </div>
          </div>
        )}

        {tab === 'subtasks' && (
          <div>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm text-muted">{t.descendants.length ? `${t.descendants.filter((d) => d.status === 'done').length} of ${t.descendants.length} done across all levels` : 'Split this into pieces different people can own.'}</span>
              <div className="flex gap-2">
                {ai.ready && can('tasks.create') && <Breakdown task={t} onDone={load} />}
                {can('tasks.create') && <button type="button" className="btn-ghost btn-sm" onClick={() => compose({ parentId: t.id, parentTitle: t.title, clientVisible: t.clientVisible, assigneeIds: t.assignees.map((a) => a.id) })}><Plus size={14} />Add subtask</button>}
              </div>
            </div>
            {t.descendants.length > 0 && <div className="rounded-xl border border-line bg-surface p-2"><SubtaskTree root={t} items={t.descendants} onStatus={subStatus} canCreate={can('tasks.create')} onOpen={openTask} /></div>}
          </div>
        )}

        {tab === 'comments' && <Comments task={t} onPosted={load} />}
        {tab === 'review' && (
          <ReviewBoard files={t.Attachments.filter((a) => !a.commentId)} comments={t.Comments}
            post={async (fd) => { await api.post(`/tasks/${t.id}/comments`, fd); load(); }}
            setStatus={async (f, status, e) => { try { await api.patch(`/tasks/attachments/${f.id}`, { reviewStatus: status }); if (status === 'approved') celebrate('done', pointOf(e)); load(); } catch (err) { toast.error(err.message); } }}
            resolve={async (c, v) => { try { await api.patch(`/tasks/comments/${c.id}`, { resolved: v }); load(); } catch (err) { toast.error(err.message); } }}
            upload={(files) => upload(files)}
            onDelete={(f) => (canRemoveFile(f) ? removeFile(f) : null)} canDelete={canRemoveFile}
            clientReview={{ enabled: !!t.clientVisible, request: async (f, status) => { try { await api.patch(`/tasks/attachments/${f.id}`, { clientReviewStatus: status }); toast.success(status === 'requested' ? 'Sent to the client for review' : 'Review request withdrawn'); load(); } catch (err) { toast.error(err.message); } } }}
            shareToggle={(f) => t.clientVisible && <button type="button" onClick={async () => { await api.patch(`/tasks/attachments/${f.id}`, { clientVisible: !f.clientVisible }); load(); }} className={clsx('chip border py-1', f.clientVisible ? 'border-cobalt/40 bg-cobalt/10 text-cobalt' : 'border-line text-muted')}>{f.clientVisible ? <><Globe size={11} />Client can review</> : <><Lock size={11} />Team only</>}</button>} />
        )}

        {tab === 'time' && (
          <div className="space-y-4">
            <div className="flex items-end justify-between">
              <div><div className="text-xs text-muted">Logged</div><div className="font-display text-3xl font-semibold">{minutes(totalMinutes)}</div>{t.estimateHours ? <div className="text-xs text-muted">of {t.estimateHours}h estimated</div> : null}</div>
              <div className="flex gap-2"><button type="button" className={running ? 'btn-danger btn-sm' : 'btn-ink btn-sm'} onClick={toggleTimer}>{running ? 'Stop timer' : 'Start timer'}</button><button type="button" className="btn-ghost btn-sm" onClick={() => setLogOpen(true)}>Log time</button></div>
            </div>
            {t.estimateHours > 0 && <Bar value={(totalMinutes / (t.estimateHours * 60)) * 100} color={totalMinutes > t.estimateHours * 60 ? 'rgb(var(--c-ember))' : 'rgb(var(--c-violet))'} />}
            <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
              {[...t.TimeLogs].reverse().map((l) => (
                <li key={l.id} className="flex items-center gap-3 px-3 py-2 text-sm"><Avatar user={l.User} size={22} /><span className="flex-1 truncate text-muted">{l.note || fmtDate(l.startedAt, 'd MMM, h:mm a')}</span><span className="font-semibold">{l.endedAt ? minutes(l.minutes) : <span className="text-cobalt">running</span>}</span></li>
              ))}
              {!t.TimeLogs.length && <li className="px-3 py-4 text-sm text-muted">No time logged yet.</li>}
            </ul>
          </div>
        )}

        {tab === 'depends' && <Dependencies task={t} reload={load} />}

        {tab === 'files' && (
          <div onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); upload(e.dataTransfer.files); }}>
            <div className="mb-3 flex justify-end"><button type="button" className="btn-ghost btn-sm" onClick={() => fileRef.current?.click()}><Paperclip size={13} />Attach files</button></div>
            <input ref={fileRef} type="file" multiple hidden onChange={(e) => { upload(e.target.files); e.target.value = ''; }} />
            {t.Attachments.some((a) => !a.commentId) ? (
              <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
                {t.Attachments.filter((a) => !a.commentId).map((a) => (
                  <li key={a.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                    <Paperclip size={14} className="text-muted" />
                    <a href={fileUrl(a.id)} className="min-w-0 flex-1 truncate hover:underline">{a.originalName}</a>
                    <span className="text-xs text-faint">{bytes(a.size)}</span>
                    {t.clientVisible && <button type="button" title={a.clientVisible ? 'Shared with client' : 'Team only'} onClick={async () => { await api.patch(`/tasks/attachments/${a.id}`, { clientVisible: !a.clientVisible }); load(); }} className={a.clientVisible ? 'text-cobalt' : 'text-faint'}>{a.clientVisible ? <Eye size={15} /> : <EyeOff size={15} />}</button>}
                    <a href={fileUrl(a.id)} className="text-muted hover:text-ink" aria-label="Download"><Download size={15} /></a>
                    {canRemoveFile(a) && <button type="button" onClick={() => removeFile(a)} className="text-muted hover:text-ember" aria-label="Delete file"><Trash2 size={14} /></button>}
                  </li>
                ))}
              </ul>
            ) : <div className="rounded-xl border-2 border-dashed border-line py-10 text-center text-sm text-muted">Drop files here. Videos up to 150 MB (compressed automatically), other files up to 25 MB.</div>}
          </div>
        )}

        {tab === 'activity' && (
          <ol className="relative space-y-4 border-l-2 border-line pl-5">
            {t.history.map((h) => (
              <li key={h.id} className="relative"><span className="absolute -left-[27px] top-0.5"><Avatar user={h.actor} size={16} /></span><p className="text-sm"><span className="font-semibold">{h.actor?.name}</span> <span className="text-muted">{h.summary}</span></p><p className="text-[11px] text-faint">{ago(h.createdAt)}</p></li>
            ))}
          </ol>
        )}
      </div>

      <LogTime open={logOpen} onClose={() => setLogOpen(false)} taskId={t.id} onDone={load} />
      <Decision open={!!decision} mode={decision} onClose={() => setDecision(null)} onSubmit={decide} />
    </div>
  );
}

function LogTime({ open, onClose, taskId, onDone }) {
  const [m, setM] = useState('30'); const [note, setNote] = useState('');
  const save = async () => { try { await api.post(`/tasks/${taskId}/timelogs`, { minutes: Number(m), note }); toast.success('Time logged'); onClose(); onDone(); } catch (e) { toast.error(e.message); } };
  return (
    <Modal open={open} onClose={onClose} title="Log time" width="max-w-sm" footer={<><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button type="button" className="btn-primary" onClick={save}>Log time</button></>}>
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">{[15, 30, 60, 90, 120].map((v) => <button type="button" key={v} onClick={() => setM(String(v))} className={clsx('btn-sm btn', Number(m) === v ? 'bg-ink text-surface' : 'bg-sunken')}>{minutes(v)}</button>)}</div>
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
