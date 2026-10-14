import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import { ImagePlus, Send, X, Check, CheckCircle2, RotateCcw, MessageSquarePlus, FileText, Film, Image as ImageIcon, Globe, Upload, ExternalLink, MousePointerClick, ChevronLeft, ChevronRight, UserCheck, Hourglass, Sparkles, Trash2 } from 'lucide-react';
import { fileUrl } from '../lib/api';
import { Avatar, Spinner, Segmented } from './ui';
import { ago, bytes } from '../lib/format';

const isImage = (f) => /^image\//.test(f?.mime || '');
const isVideo = (f) => /^video\//.test(f?.mime || '');
const clock = (s) => { const n = Math.max(0, Math.floor(s || 0)); return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`; };
const REVIEW = {
  pending: { label: 'Waiting for review', cls: 'bg-sunken text-muted' },
  approved: { label: 'Approved', cls: 'bg-leaf/10 text-leaf' },
  changes: { label: 'Changes requested', cls: 'bg-amber/15 text-amber' },
};
const CLIENT = {
  requested: { label: 'Client is reviewing', cls: 'bg-cobalt/10 text-cobalt', Icon: Hourglass },
  approved: { label: 'Client approved', cls: 'bg-leaf/10 text-leaf', Icon: UserCheck },
  changes: { label: 'Client asked for changes', cls: 'bg-amber/15 text-amber', Icon: RotateCcw },
};

/** Staff-side strip: the client's verdict on a file and the button to ask for one. */
function ClientReviewBar({ file, clientReview }) {
  const [busy, setBusy] = useState(false);
  const st = CLIENT[file.clientReviewStatus];
  const run = async (status) => { setBusy(true); try { await clientReview.request(file, status); } finally { setBusy(false); } };
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-sunken/40 px-3 py-2 text-xs">
      <span className="font-semibold text-muted">Client review</span>
      {st ? <span className={clsx('chip', st.cls)}><st.Icon size={11} />{st.label}{file.clientReviewedAt && file.clientReviewStatus !== 'requested' ? ` · ${ago(file.clientReviewedAt)}` : ''}</span>
        : <span className="text-faint">Not asked yet</span>}
      <div className="ml-auto flex gap-2">
        {!clientReview.enabled ? <span className="text-faint">Share the task with the client to ask for their review.</span>
          : file.clientReviewStatus === 'requested' ? <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => run('none')}>Withdraw</button>
            : <button type="button" className="btn-ink btn-sm" disabled={busy} onClick={() => run('requested')}>{busy ? <Spinner size={12} /> : <UserCheck size={13} />}{st ? 'Ask client again' : 'Ask client to review'}</button>}
      </div>
    </div>
  );
}

// ---------- lightbox ----------
export function Lightbox({ images, index, onClose }) {
  const [i, setI] = useState(index);
  useEffect(() => { setI(index); }, [index]);
  useEffect(() => {
    if (index == null) return undefined;
    const k = (e) => { if (e.key === 'Escape') onClose(); if (e.key === 'ArrowRight') setI((x) => Math.min(images.length - 1, x + 1)); if (e.key === 'ArrowLeft') setI((x) => Math.max(0, x - 1)); };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [index, images.length, onClose]);
  if (index == null || !images[i]) return null;
  return createPortal(
    <div className="fixed inset-0 z-[80] grid place-items-center bg-night/90 p-4" onClick={onClose} role="dialog" aria-modal="true" aria-label="Image preview">
      <img src={fileUrl(images[i].id)} alt={images[i].originalName} className="max-h-[86vh] max-w-full rounded-xl object-contain shadow-pop" onClick={(e) => e.stopPropagation()} />
      <button type="button" className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20" onClick={onClose} aria-label="Close"><X size={20} /></button>
      {images.length > 1 && <>
        <button type="button" className="absolute left-4 top-1/2 rounded-full bg-white/10 p-2 text-white hover:bg-white/20" onClick={(e) => { e.stopPropagation(); setI((x) => Math.max(0, x - 1)); }} aria-label="Previous"><ChevronLeft size={22} /></button>
        <button type="button" className="absolute right-4 top-1/2 rounded-full bg-white/10 p-2 text-white hover:bg-white/20" onClick={(e) => { e.stopPropagation(); setI((x) => Math.min(images.length - 1, x + 1)); }} aria-label="Next"><ChevronRight size={22} /></button>
      </>}
      <p className="absolute bottom-4 text-sm text-white/70">{images[i].originalName}</p>
    </div>, document.body,
  );
}

function Thumbs({ images, onOpen, size = 'md' }) {
  if (!images?.length) return null;
  return (
    <div className={clsx('mt-2 grid gap-1.5', images.length === 1 ? 'grid-cols-1' : 'grid-cols-3')}>
      {images.map((im, i) => (
        <button key={im.id} type="button" onClick={() => onOpen(i)} className={clsx('overflow-hidden rounded-lg border border-line bg-sunken', images.length === 1 ? (size === 'sm' ? 'max-w-[200px]' : 'max-w-[320px]') : 'aspect-square')}>
          <img src={fileUrl(im.id)} alt={im.originalName} loading="lazy" className={clsx('h-full w-full object-cover transition hover:scale-[1.03]', images.length === 1 && 'max-h-60 object-contain')} />
        </button>
      ))}
    </div>
  );
}

// ---------- composer with image paste / drop ----------
export function Composer({ onSubmit, placeholder = 'Write a comment', extra, compact, autoFocus, submitLabel = 'Post', people = [], onMention }) {
  const [body, setBody] = useState('');
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [mentionQ, setMentionQ] = useState(null);
  const ref = useRef(null);
  const pickRef = useRef(null);
  const previews = useMemo(() => files.map((f) => ({ f, url: URL.createObjectURL(f) })), [files]);
  useEffect(() => () => previews.forEach((p) => URL.revokeObjectURL(p.url)), [previews]);
  const addFiles = (list) => {
    const imgs = [...(list || [])].filter((f) => /^image\//.test(f.type));
    if (!imgs.length) return;
    if (imgs.some((f) => f.size > 15e6)) toast.error('Images up to 15 MB each.');
    setFiles((fs) => [...fs, ...imgs.filter((f) => f.size <= 15e6)].slice(0, 6));
  };
  const submit = async (e) => {
    e?.preventDefault();
    if (!body.trim() && !files.length) return;
    setBusy(true);
    try { await onSubmit({ body: body.trim(), files }); setBody(''); setFiles([]); } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };
  const onChange = (e) => {
    const v = e.target.value; setBody(v);
    if (!onMention) return;
    const m = v.slice(0, e.target.selectionStart).match(/@(\w*)$/);
    setMentionQ(m ? m[1].toLowerCase() : null);
  };
  const pick = (p) => {
    const pos = ref.current.selectionStart;
    const before = body.slice(0, pos).replace(/@(\w*)$/, `@${p.name.split(' ')[0]} `);
    setBody(before + body.slice(pos)); onMention?.(p.id); setMentionQ(null); ref.current.focus();
  };
  const matches = mentionQ != null ? people.filter((p) => p.name.toLowerCase().includes(mentionQ)).slice(0, 6) : [];
  return (
    <form onSubmit={submit} className="relative" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { if (e.dataTransfer.files?.length) { e.preventDefault(); addFiles(e.dataTransfer.files); } }}>
      <div className="rounded-xl border border-line bg-surface focus-within:border-cobalt/60 focus-within:ring-4 focus-within:ring-cobalt/10">
        <textarea ref={ref} autoFocus={autoFocus} value={body} onChange={onChange} rows={compact ? 2 : 3} placeholder={placeholder}
          onPaste={(e) => { if (e.clipboardData?.files?.length) { e.preventDefault(); addFiles(e.clipboardData.files); } }}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(); }}
          className="block w-full resize-none rounded-t-xl bg-transparent px-3 py-2.5 text-sm outline-none placeholder:text-faint" />
        {previews.length > 0 && (
          <div className="flex flex-wrap gap-2 px-3 pb-2">
            {previews.map((p, i) => (
              <span key={p.url} className="relative h-16 w-16 overflow-hidden rounded-lg border border-line">
                <img src={p.url} alt="" className="h-full w-full object-cover" />
                <button type="button" onClick={() => setFiles((fs) => fs.filter((_, j) => j !== i))} className="absolute right-0.5 top-0.5 rounded-full bg-night/70 p-0.5 text-white" aria-label="Remove image"><X size={11} /></button>
              </span>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2 border-t border-line/70 px-2 py-1.5">
          <button type="button" className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-semibold text-muted hover:bg-sunken hover:text-ink" onClick={() => pickRef.current?.click()}><ImagePlus size={14} />Image</button>
          <input ref={pickRef} type="file" accept="image/*" multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
          {extra}
          <span className="ml-auto hidden text-[11px] text-faint sm:inline">Paste screenshots, Ctrl+Enter to send</span>
          <button className="btn-primary btn-sm" disabled={busy || (!body.trim() && !files.length)}>{busy ? <Spinner size={13} className="text-ink" /> : <Send size={13} />}{submitLabel}</button>
        </div>
      </div>
      {matches.length > 0 && (
        <div className="absolute bottom-full left-0 z-10 mb-1 w-60 rounded-xl border border-line bg-surface p-1 shadow-lift">
          {matches.map((p) => <button key={p.id} type="button" onMouseDown={(e) => { e.preventDefault(); pick(p); }} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-sunken"><Avatar user={p} size={20} />{p.name}</button>)}
        </div>
      )}
    </form>
  );
}

export function toFormData({ body, files }, fields = {}) {
  const fd = new FormData();
  fd.append('body', body || '');
  Object.entries(fields).forEach(([k, v]) => { if (v !== undefined && v !== null) fd.append(k, Array.isArray(v) ? v.join(',') : String(v)); });
  files.forEach((f) => fd.append('images', f));
  return fd;
}

// ---------- one comment ----------
export function CommentItem({ c, onOpenImage, onJump, label, actions }) {
  const fromClient = c.author?.Role?.isClientRole;
  return (
    <li className="flex gap-3">
      <Avatar user={c.author} size={30} />
      <div className={clsx('min-w-0 flex-1 rounded-xl border px-3.5 py-2.5', c.resolved ? 'border-line bg-sunken/50 opacity-70' : fromClient ? 'border-amber/30 bg-amber/5' : c.internal ? 'border-line bg-surface' : 'border-cobalt/25 bg-cobalt/5')}>
        <div className="mb-1 flex flex-wrap items-center gap-2 text-xs">
          {label}
          <span className="font-semibold">{c.author?.name}</span>
          {fromClient && <span className="chip bg-amber/15 text-amber">Client</span>}
          {c.kind === 'brief' && <span className="chip bg-violet/10 text-violet"><FileText size={10} />On the description</span>}
          {!fromClient && c.internal === false && <span className="chip bg-cobalt/10 text-cobalt"><Globe size={10} />Shared with client</span>}
          {c.pinTime != null && <button type="button" onClick={() => onJump?.(c)} className="chip bg-night text-white hover:bg-night-2">{clock(c.pinTime)}</button>}
          {c.resolved && <span className="chip bg-leaf/10 text-leaf"><Check size={10} />Resolved</span>}
          <span className="text-faint">{ago(c.createdAt)}</span>
          <span className="ml-auto flex gap-1">{actions}</span>
        </div>
        {c.body && <p className="whitespace-pre-wrap break-words text-sm">{c.body}</p>}
        <Thumbs images={c.images} onOpen={(i) => onOpenImage(c.images, i)} />
      </div>
    </li>
  );
}

/** General comment thread (non-review comments). */
export function CommentThread({ comments, onPost, canShare, emptyText, people, composerExtra, onMention }) {
  const [box, setBox] = useState({ images: [], index: null });
  const list = comments.filter((c) => c.kind !== 'review');
  return (
    <div>
      <ul className="space-y-4">
        {list.map((c) => <CommentItem key={c.id} c={c} onOpenImage={(images, index) => setBox({ images, index })} />)}
        {!list.length && <li className="py-2 text-sm text-muted">{emptyText || 'No comments yet.'}</li>}
      </ul>
      <div className="mt-4"><Composer onSubmit={onPost} placeholder={canShare ? 'Write an update. Type @ to mention, paste or drop images.' : 'Write a message. You can paste or drop images.'} extra={composerExtra} people={people} onMention={onMention} /></div>
      <Lightbox images={box.images} index={box.index} onClose={() => setBox({ images: [], index: null })} />
    </div>
  );
}

/** Comments on the task description only (kind 'brief'), shared between the client and the team. */
export function BriefThread({ comments, onPost, placeholder, emptyText, extra }) {
  const [box, setBox] = useState({ images: [], index: null });
  const list = comments.filter((c) => c.kind === 'brief');
  return (
    <div>
      {list.length > 0 ? <ul className="space-y-3">{list.map((c) => <CommentItem key={c.id} c={{ ...c, kind: 'comment' }} onOpenImage={(images, index) => setBox({ images, index })} />)}</ul>
        : emptyText && <p className="text-sm text-muted">{emptyText}</p>}
      {onPost && <div className="mt-3"><Composer compact onSubmit={onPost} placeholder={placeholder || 'Write a comment'} extra={extra} submitLabel="Send" /></div>}
      <Lightbox images={box.images} index={box.index} onClose={() => setBox({ images: [], index: null })} />
    </div>
  );
}

// ---------- visual review ----------
/**
 * files:     reviewable attachments [{ id, originalName, mime, reviewStatus }]
 * comments:  all comments of the task (review ones carry attachmentId + pins)
 * post(fd):  posts a review comment (FormData)
 * setStatus(file, status, note) / resolve(c, bool): optional actions
 * upload(files): optional, staff only
 */
export function ReviewBoard({ files, comments, post, setStatus, resolve, upload, isClient, shareToggle, clientReview, onDelete, canDelete }) {
  const reviewable = files.filter((f) => isImage(f) || isVideo(f) || /pdf/.test(f.mime || ''));
  const [sel, setSel] = useState(reviewable[0]?.id || null);
  const [draft, setDraft] = useState(null); // { x, y, t }
  const [pinMode, setPinMode] = useState(false);
  const [filter, setFilter] = useState('open');
  const [time, setTime] = useState(0);
  const [hover, setHover] = useState(null);
  const [box, setBox] = useState({ images: [], index: null });
  const videoRef = useRef(null);
  const upRef = useRef(null);
  useEffect(() => { if (!reviewable.some((f) => f.id === sel)) setSel(reviewable[0]?.id || null); }, [files.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const file = reviewable.find((f) => f.id === sel);
  const notes = comments.filter((c) => c.kind === 'review' && c.attachmentId === sel).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  const numbered = notes.map((c, i) => ({ ...c, n: i + 1 }));
  const shown = numbered.filter((c) => (filter === 'all' ? true : filter === 'open' ? !c.resolved : c.resolved));
  const openCount = (fid) => comments.filter((c) => c.kind === 'review' && c.attachmentId === fid && !c.resolved).length;

  const placePin = (e) => {
    if (isVideo(file) && !pinMode) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width; const y = (e.clientY - r.top) / r.height;
    const t = isVideo(file) ? videoRef.current?.currentTime ?? 0 : null;
    if (isVideo(file)) videoRef.current?.pause();
    setDraft({ x, y, t }); setPinMode(false);
  };
  const submitDraft = async ({ body, files: imgs }) => {
    await post(toFormData({ body, files: imgs }, { attachmentId: file.id, pinX: draft?.x, pinY: draft?.y, pinTime: draft?.t ?? (isVideo(file) ? videoRef.current?.currentTime : undefined) }));
    setDraft(null);
  };
  const jump = (c) => { if (videoRef.current && c.pinTime != null) { videoRef.current.currentTime = c.pinTime; videoRef.current.pause(); } setHover(c.id); };
  const visiblePins = numbered.filter((c) => c.pinX != null && (filter === 'all' || (filter === 'open' ? !c.resolved : c.resolved)) && (!isVideo(file) || Math.abs((c.pinTime ?? 0) - time) < 1.2));

  if (!reviewable.length) {
    return (
      <div className="rounded-2xl border-2 border-dashed border-line px-6 py-12 text-center">
        <ImageIcon size={26} className="mx-auto text-faint" />
        <p className="mt-3 font-semibold">{isClient ? 'Nothing to review yet' : 'Upload a design, video or PDF to review'}</p>
        <p className="mx-auto mt-1 max-w-sm text-sm text-muted">{isClient ? 'When the team shares work for you to check, it appears here. Click anywhere on it to leave a comment.' : 'Teammates and clients click on the work to leave pinned feedback, then approve or ask for changes.'}</p>
        {upload && <><button type="button" className="btn-primary mt-4" onClick={() => upRef.current?.click()}><Upload size={15} />Upload for review</button><input ref={upRef} type="file" multiple hidden accept="image/*,video/*,application/pdf" onChange={(e) => { upload(e.target.files); e.target.value = ''; }} /></>}
      </div>
    );
  }

  const st = REVIEW[file?.reviewStatus || 'pending'];
  return (
    <div className="space-y-3">
      {/* file strip */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {reviewable.map((f) => (
          <button key={f.id} type="button" onClick={() => { setSel(f.id); setDraft(null); setPinMode(false); }}
            className={clsx('relative flex h-16 w-24 shrink-0 items-center justify-center overflow-hidden rounded-xl border-2 bg-sunken transition', sel === f.id ? 'border-ink' : 'border-transparent hover:border-line')} title={f.originalName}>
            {isImage(f) ? <img src={fileUrl(f.id)} alt="" className="h-full w-full object-cover" loading="lazy" /> : isVideo(f) ? <Film size={20} className="text-muted" /> : <FileText size={20} className="text-muted" />}
            {openCount(f.id) > 0 && <span className="absolute right-1 top-1 grid h-5 min-w-[20px] place-items-center rounded-full bg-amber px-1 text-[10px] font-bold text-white">{openCount(f.id)}</span>}
            {f.reviewStatus === 'approved' && <span className="absolute bottom-1 right-1 rounded-full bg-leaf p-0.5 text-white"><Check size={10} strokeWidth={3} /></span>}
            {!isClient && CLIENT[f.clientReviewStatus] && <span className={clsx('absolute bottom-1 left-1 rounded-full p-0.5', f.clientReviewStatus === 'approved' ? 'bg-leaf text-white' : f.clientReviewStatus === 'changes' ? 'bg-amber text-white' : 'bg-cobalt text-white')} title={CLIENT[f.clientReviewStatus].label}><UserCheck size={10} /></span>}
          </button>
        ))}
        {upload && <><button type="button" onClick={() => upRef.current?.click()} className="grid h-16 w-16 shrink-0 place-items-center rounded-xl border-2 border-dashed border-line text-muted hover:border-faint hover:text-ink" aria-label="Upload more"><Upload size={18} /></button><input ref={upRef} type="file" multiple hidden accept="image/*,video/*,application/pdf" onChange={(e) => { upload(e.target.files); e.target.value = ''; }} /></>}
      </div>

      {file && (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-sm font-semibold" title={file.originalName}>{file.originalName}</span>
              <span className={clsx('chip', st.cls)}>{st.label}</span>
              {shareToggle?.(file)}
              <a href={fileUrl(file.id)} target="_blank" rel="noreferrer" className="btn-ghost btn-sm"><ExternalLink size={13} />Open</a>
              {!isClient && onDelete && canDelete?.(file) && <button type="button" className="btn-ghost btn-sm text-ember hover:bg-ember/10" onClick={() => onDelete(file)} title={`Delete this ${isVideo(file) ? 'video' : 'file'}`}><Trash2 size={13} />Delete</button>}
            </div>
            {!isClient && clientReview && <ClientReviewBar file={file} clientReview={clientReview} />}
            {file.compression === 'pending' && <p className="inline-flex items-center gap-1.5 text-xs text-muted"><Spinner size={11} />Optimising this video to save space. It stays playable meanwhile.</p>}
            {file.compression === 'done' && file.originalSize > 0 && <p className="inline-flex items-center gap-1.5 text-xs text-muted"><Sparkles size={12} className="text-leaf" />Compressed {bytes(file.originalSize)} → {bytes(file.size)} ({Math.round((1 - file.size / file.originalSize) * 100)}% smaller)</p>}
            <div className="relative overflow-hidden rounded-2xl border border-line bg-[repeating-conic-gradient(rgb(var(--c-sunken))_0_25%,rgb(var(--c-surface))_0_50%)] bg-[length:20px_20px]">
              {isImage(file) && (
                <div className="relative mx-auto w-fit cursor-crosshair" onClick={placePin}>
                  <img src={fileUrl(file.id)} alt={file.originalName} className="block max-h-[70vh] max-w-full select-none" draggable={false} />
                  <Pins pins={visiblePins} draft={draft} hover={hover} setHover={setHover} />
                </div>
              )}
              {isVideo(file) && (
                <div className="relative mx-auto w-fit">
                  <video ref={videoRef} src={fileUrl(file.id)} controls className="block max-h-[70vh] max-w-full" onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)} onPlay={() => setDraft(null)} />
                  <div className={clsx('absolute inset-x-0 top-0 bottom-12', pinMode ? 'cursor-crosshair bg-cobalt/5 ring-2 ring-inset ring-cobalt' : 'pointer-events-none')} onClick={placePin}>
                    <Pins pins={visiblePins} draft={draft} hover={hover} setHover={setHover} />
                  </div>
                </div>
              )}
              {!isImage(file) && !isVideo(file) && (
                <div className="grid place-items-center px-6 py-16 text-center">
                  <FileText size={34} className="text-muted" />
                  <p className="mt-2 text-sm text-muted">PDFs open in a new tab. Leave your notes on the right.</p>
                  <a href={fileUrl(file.id)} target="_blank" rel="noreferrer" className="btn-ghost mt-3"><ExternalLink size={14} />Open PDF</a>
                </div>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
              {isImage(file) && <span className="inline-flex items-center gap-1.5"><MousePointerClick size={14} />Click anywhere on the image to pin a comment.</span>}
              {isVideo(file) && <button type="button" className={pinMode ? 'btn-ink btn-sm' : 'btn-ghost btn-sm'} onClick={() => { videoRef.current?.pause(); setPinMode((m) => !m); }}><MessageSquarePlus size={13} />{pinMode ? 'Click the frame to pin' : `Comment at ${clock(time)}`}</button>}
              <div className="ml-auto flex flex-wrap gap-2">
                {setStatus && file.reviewStatus !== 'approved' && <button type="button" className="btn btn-sm bg-leaf text-white hover:bg-leaf/90" onClick={(e) => setStatus(file, 'approved', e)}><CheckCircle2 size={13} />Approve</button>}
                {setStatus && file.reviewStatus !== 'changes' && <button type="button" className="btn-ghost btn-sm" onClick={(e) => setStatus(file, 'changes', e)}><RotateCcw size={13} />Ask for changes</button>}
                {setStatus && file.reviewStatus !== 'pending' && !isClient && <button type="button" className="btn-ghost btn-sm" onClick={(e) => setStatus(file, 'pending', e)}>Reopen</button>}
              </div>
            </div>
          </div>

          <aside className="min-w-0 space-y-3">
            <div className="flex items-center gap-2">
              <h4 className="text-sm font-semibold">Feedback</h4>
              <span className="text-xs text-muted">{notes.filter((c) => !c.resolved).length} open</span>
              <div className="ml-auto"><Segmented size="sm" value={filter} onChange={setFilter} options={[{ value: 'open', label: 'Open' }, { value: 'resolved', label: 'Done' }, { value: 'all', label: 'All' }]} /></div>
            </div>
            {draft ? (
              <div className="rounded-xl border-2 border-cobalt/40 bg-cobalt/5 p-2">
                <p className="mb-1.5 flex items-center gap-2 text-xs font-semibold text-cobalt"><span className="grid h-5 w-5 place-items-center rounded-full bg-cobalt text-[10px] text-white">{notes.length + 1}</span>New pin{draft.t != null ? ` at ${clock(draft.t)}` : ''}<button type="button" className="ml-auto text-muted hover:text-ink" onClick={() => setDraft(null)} aria-label="Cancel pin"><X size={14} /></button></p>
                <Composer autoFocus compact onSubmit={submitDraft} placeholder="What should change here?" submitLabel="Pin it" />
              </div>
            ) : (
              <Composer compact onSubmit={async (v) => { await post(toFormData(v, { attachmentId: file.id, pinTime: isVideo(file) ? videoRef.current?.currentTime : undefined })); }} placeholder={isImage(file) ? 'General note, or click the image to pin one' : 'Write a note about this file'} submitLabel="Send" />
            )}
            <ol className="max-h-[52vh] space-y-2 overflow-y-auto pr-1">
              {shown.map((c) => (
                <li key={c.id} onMouseEnter={() => setHover(c.id)} onMouseLeave={() => setHover(null)}
                  className={clsx('rounded-xl border p-2.5 transition', hover === c.id ? 'border-cobalt/50 bg-cobalt/5' : 'border-line bg-surface', c.resolved && 'opacity-60')}>
                  <div className="flex items-center gap-2 text-xs">
                    {c.pinX != null ? <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-cobalt text-[10px] font-bold text-white">{c.n}</span> : <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-sunken text-[10px] font-bold text-muted">{c.n}</span>}
                    <Avatar user={c.author} size={18} />
                    <span className="truncate font-semibold">{c.author?.name}</span>
                    {c.author?.Role?.isClientRole && <span className="chip bg-amber/15 text-amber">Client</span>}
                    {c.pinTime != null && <button type="button" className="chip bg-night text-white" onClick={() => jump(c)}>{clock(c.pinTime)}</button>}
                    <span className="ml-auto shrink-0 text-faint">{ago(c.createdAt)}</span>
                  </div>
                  {c.body && <p className="mt-1.5 whitespace-pre-wrap break-words text-sm">{c.body}</p>}
                  <Thumbs size="sm" images={c.images} onOpen={(i) => setBox({ images: c.images, index: i })} />
                  {resolve && <button type="button" onClick={() => resolve(c, !c.resolved)} className={clsx('mt-2 inline-flex items-center gap-1 text-xs font-semibold', c.resolved ? 'text-muted hover:text-ink' : 'text-leaf hover:underline')}>{c.resolved ? <><RotateCcw size={12} />Reopen</> : <><Check size={12} />Mark resolved</>}</button>}
                </li>
              ))}
              {!shown.length && <li className="py-6 text-center text-sm text-muted">{filter === 'open' ? 'No open feedback on this file.' : 'Nothing here.'}</li>}
            </ol>
          </aside>
        </div>
      )}
      <Lightbox images={box.images} index={box.index} onClose={() => setBox({ images: [], index: null })} />
    </div>
  );
}

function Pins({ pins, draft, hover, setHover }) {
  return (
    <>
      {pins.map((c) => (
        <span key={c.id} onMouseEnter={() => setHover(c.id)} onMouseLeave={() => setHover(null)} onClick={(e) => e.stopPropagation()}
          className={clsx('absolute z-10 grid h-7 w-7 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full rounded-bl-none border-2 border-white text-[11px] font-bold text-white shadow-lift transition', c.resolved ? 'bg-leaf' : 'bg-cobalt', hover === c.id && 'scale-125')}
          style={{ left: `${c.pinX * 100}%`, top: `${c.pinY * 100}%` }} title={c.body}>{c.n}</span>
      ))}
      {draft && draft.x != null && <span className="absolute z-10 h-7 w-7 -translate-x-1/2 -translate-y-1/2 animate-pulse rounded-full rounded-bl-none border-2 border-white bg-brand shadow-lift" style={{ left: `${draft.x * 100}%`, top: `${draft.y * 100}%` }} />}
    </>
  );
}
