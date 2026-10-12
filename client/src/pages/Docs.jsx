import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import { FileText, Plus, Search, Pin, Lock, Globe, Sparkles, Eye, PenLine, Columns2, Trash2, ArrowLeft, Check, Building2, Wand2 } from 'lucide-react';
import api from '../lib/api';
import useFetch from '../lib/useFetch';
import { useAuth, useLive } from '../context/AuthContext';
import { useProjects, useAiStatus } from '../lib/directory';
import { Avatar, Empty, PageLoader, Segmented, Markdown, Menu, Spinner, confirm, Modal, Field, Toggle } from '../components/ui';
import { ago } from '../lib/format';

const ICONS = ['📄', '📝', '📋', '📌', '🎯', '💡', '📣', '🎨', '📊', '🗓️', '✅', '🔒'];

function AiWrite({ open, onClose, doc, onApply }) {
  const [mode, setMode] = useState('draft');
  const [instruction, setInstruction] = useState('');
  const [out, setOut] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setOut(''); setMode(doc.content?.trim() ? 'improve' : 'draft'); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const run = async () => {
    setBusy(true);
    try { const r = await api.post('/ai/write', { mode, text: mode === 'draft' ? '' : doc.content, instruction, context: `Document title: ${doc.title}${doc.Project ? `. Project: ${doc.Project.name}` : ''}` }); setOut(r.data.text); } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };
  const MODES = [['draft', 'Write from a prompt'], ['improve', 'Improve'], ['shorten', 'Shorten'], ['client_update', 'Client update'], ['summarize', 'Summarise'], ['translate_hi', 'Hindi']];
  return (
    <Modal open={open} onClose={onClose} title="Write with Orbit" subtitle="Gemini drafts, you decide what goes in." width="max-w-3xl"
      footer={out ? <><button type="button" className="btn-ghost" onClick={() => setOut('')}>Try again</button><button type="button" className="btn-ghost" onClick={() => { onApply(`${doc.content || ''}\n\n${out}`); onClose(); }}>Add below</button><button type="button" className="btn-primary" onClick={() => { onApply(out); onClose(); }}><Check size={15} />Replace doc</button></> : <><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button type="button" className="btn-ai" onClick={run} disabled={busy || (mode === 'draft' && !instruction.trim())}>{busy ? <Spinner size={14} className="text-violet" /> : <Wand2 size={15} />}Generate</button></>}>
      {!out ? (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-1.5">{MODES.map(([k, l]) => <button key={k} type="button" disabled={k !== 'draft' && !doc.content?.trim()} onClick={() => setMode(k)} className={clsx('rounded-full border px-3 py-1 text-xs font-semibold transition disabled:opacity-40', mode === k ? 'border-violet bg-violet/10 text-violet' : 'border-line text-muted hover:text-ink')}>{l}</button>)}</div>
          <Field label={mode === 'draft' ? 'What should it say?' : 'Anything specific? (optional)'}>
            <textarea className="input" rows={4} value={instruction} onChange={(e) => setInstruction(e.target.value)} autoFocus
              placeholder={mode === 'draft' ? 'A creative brief for a Diwali reel campaign for Kasaar Jewels: objective, audience, 3 concepts, deliverables, timeline' : 'Keep the numbers, friendlier tone'} />
          </Field>
        </div>
      ) : <div className="max-h-[55vh] overflow-y-auto rounded-xl border border-line p-4"><Markdown>{out}</Markdown></div>}
    </Modal>
  );
}

function Editor({ id, onDeleted }) {
  const { data: doc, setData, error } = useFetch(`/documents/${id}`);
  const projects = useProjects();
  const ai = useAiStatus();
  const { user } = useAuth();
  const [mode, setMode] = useState(() => (window.innerWidth > 1200 ? 'split' : 'write'));
  const [saved, setSaved] = useState('saved');
  const [aiOpen, setAiOpen] = useState(false);
  const [settings, setSettings] = useState(false);
  const timer = useRef(null);
  const pending = useRef({});

  const flush = async () => {
    const body = pending.current; pending.current = {};
    if (!Object.keys(body).length) return;
    setSaved('saving');
    try { await api.patch(`/documents/${id}`, body); setSaved('saved'); } catch (err) { setSaved('error'); toast.error(err.message); }
  };
  useEffect(() => () => { clearTimeout(timer.current); flush(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const change = (patch, now) => {
    setData((d) => ({ ...d, ...patch })); pending.current = { ...pending.current, ...patch }; setSaved('dirty');
    clearTimeout(timer.current); timer.current = setTimeout(flush, now ? 0 : 900);
  };
  useLive('doc:changed', async (d) => {
    if (d?.id !== Number(id) || d.by === user.id || saved !== 'saved') return;
    const r = await api.get(`/documents/${id}`); setData(r.data); toast('Someone else updated this doc', { icon: '✏️' });
  }, [id, saved]);

  if (error && !doc?.id) return <Empty icon={FileText} title="Can't open this doc" body={error} />;
  if (!doc?.id) return <PageLoader />;
  const ro = !doc.canEdit;
  const words = (doc.content || '').trim().split(/\s+/).filter(Boolean).length;
  const remove = async () => { if (await confirm({ title: `Delete "${doc.title}"?`, body: 'This cannot be undone.', danger: true, confirmLabel: 'Delete' })) { await api.delete(`/documents/${id}`); onDeleted(); } };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
        <Link to="/docs" className="rounded-lg p-1 text-muted hover:bg-sunken lg:hidden" aria-label="All docs"><ArrowLeft size={18} /></Link>
        <span className="flex items-center gap-1.5 text-xs text-muted">{doc.visibility === 'private' ? <><Lock size={12} />Only you</> : <><Globe size={12} />Whole team</>}{doc.Project && <span className="inline-flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full" style={{ background: doc.Project.color }} />{doc.Project.name}</span>}{doc.clientVisible && <span className="chip bg-leaf/10 text-leaf"><Building2 size={10} />Client sees it</span>}</span>
        <span className={clsx('text-xs', saved === 'error' ? 'text-ember' : 'text-faint')}>{saved === 'saving' ? 'Saving' : saved === 'dirty' ? 'Editing' : saved === 'error' ? 'Not saved' : `Saved, ${words} words`}</span>
        <div className="ml-auto flex items-center gap-2">
          <Segmented size="sm" value={mode} onChange={setMode} options={[{ value: 'write', icon: PenLine, label: '', title: 'Write' }, { value: 'split', icon: Columns2, label: '', title: 'Side by side' }, { value: 'read', icon: Eye, label: '', title: 'Read' }]} />
          {!ro && <button type="button" className="btn-ai btn-sm" onClick={() => setAiOpen(true)} disabled={!ai.ready} title={ai.ready ? 'Write with Gemini' : 'Add a Gemini key in Settings'}><Sparkles size={13} />Write with AI</button>}
          {!ro && <Menu trigger={<span className="btn-ghost btn-sm">Share</span>} items={[
            { label: doc.pinned ? 'Unpin' : 'Pin to top', icon: Pin, onClick: () => change({ pinned: !doc.pinned }, true) },
            { label: 'Sharing and project', icon: Globe, onClick: () => setSettings(true) },
            doc.canDelete && '-', doc.canDelete && { label: 'Delete doc', icon: Trash2, danger: true, onClick: remove },
          ]} />}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1200px] px-5 pb-16 pt-8 sm:px-10">
          <div className="mb-6 flex items-start gap-3">
            <Menu align="left" trigger={<button type="button" disabled={ro} className="rounded-xl p-1 text-4xl hover:bg-sunken">{doc.icon || '📄'}</button>} items={ICONS.map((i) => ({ label: i, onClick: () => change({ icon: i }, true) }))} />
            <div className="min-w-0 flex-1">
              <input className="w-full bg-transparent font-display text-3xl font-semibold tracking-tight outline-none placeholder:text-faint sm:text-4xl" value={doc.title} readOnly={ro} onChange={(e) => change({ title: e.target.value })} placeholder="Untitled" />
              <p className="mt-1 flex items-center gap-2 text-xs text-muted"><Avatar user={doc.author} size={16} /><span>{doc.author?.name}{doc.editor ? `, edited by ${doc.editor.name} ${ago(doc.updatedAt)}` : ''}</span></p>
            </div>
          </div>
          <div className={clsx(mode === 'split' && 'grid gap-8 lg:grid-cols-2')}>
            {mode !== 'read' && !ro && (
              <textarea value={doc.content || ''} onChange={(e) => change({ content: e.target.value })}
                placeholder={'Start writing. Markdown works: # heading, **bold**, - list, [ ] checklist, | tables |'}
                className="min-h-[60vh] w-full resize-none rounded-2xl border border-line bg-surface p-5 font-mono text-[13.5px] leading-7 outline-none focus:border-muted" />
            )}
            {(mode !== 'write' || ro) && <div className={clsx(mode === 'split' && 'rounded-2xl border border-dashed border-line p-5')}>{doc.content?.trim() ? <Markdown className="!text-[15px]">{doc.content}</Markdown> : <p className="text-sm text-faint">Nothing written yet.</p>}</div>}
          </div>
        </div>
      </div>
      <AiWrite open={aiOpen} onClose={() => setAiOpen(false)} doc={doc} onApply={(content) => change({ content }, true)} />
      <Modal open={settings} onClose={() => setSettings(false)} title="Sharing" width="max-w-md" footer={<button type="button" className="btn-primary" onClick={() => setSettings(false)}>Done</button>}>
        <div className="space-y-4">
          {doc.author?.id === user.id && <Field label="Who can see it"><Segmented value={doc.visibility} onChange={(v) => change({ visibility: v }, true)} options={[{ value: 'workspace', label: 'Whole team', icon: Globe }, { value: 'private', label: 'Only me', icon: Lock }]} /></Field>}
          <Field label="Project"><select className="input" value={doc.projectId || ''} onChange={(e) => change({ projectId: e.target.value ? Number(e.target.value) : null, Project: projects.find((p) => p.id === Number(e.target.value)) || null }, true)}><option value="">None</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.code} {p.name}</option>)}</select></Field>
          {doc.projectId && <Toggle checked={!!doc.clientVisible} onChange={(v) => change({ clientVisible: v }, true)} label="Show on the client portal" hint="The project's client can read it, not edit it." />}
        </div>
      </Modal>
    </div>
  );
}

export default function Docs() {
  const { id } = useParams();
  const nav = useNavigate();
  const [scope, setScope] = useState('all');
  const [q, setQ] = useState('');
  const { data, reload } = useFetch(`/documents?${scope !== 'all' ? `scope=${scope}&` : ''}${q ? `q=${encodeURIComponent(q)}` : ''}`, [scope, q]);
  useLive('doc:changed', reload);
  const create = async () => { try { const r = await api.post('/documents', { title: 'Untitled', visibility: 'workspace' }); await reload(); nav(`/docs/${r.data.id}`); } catch (err) { toast.error(err.message); } };

  return (
    <div className="-mx-4 -my-6 flex h-[calc(100dvh-57px)] overflow-hidden bg-surface sm:-mx-6 lg:mx-0 lg:my-0 lg:h-[calc(100dvh-106px)] lg:rounded-3xl lg:border lg:border-line">
      <aside className={clsx('w-full shrink-0 flex-col border-r border-line bg-canvas/60 lg:flex lg:w-80', id ? 'hidden' : 'flex')}>
        <div className="flex items-center gap-2 px-4 pb-2 pt-4"><h1 className="font-display text-xl font-semibold">Docs</h1><button type="button" className="btn-primary btn-sm ml-auto" onClick={create}><Plus size={14} />New</button></div>
        <div className="space-y-2 px-3 pb-2">
          <div className="relative"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" /><input className="input !py-1.5 pl-8 text-sm" placeholder="Search titles and text" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <Segmented size="sm" value={scope} onChange={setScope} options={[{ value: 'all', label: 'All' }, { value: 'workspace', label: 'Team' }, { value: 'mine', label: 'Private' }]} />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
          {!data ? <PageLoader /> : !data.length ? <p className="px-3 py-6 text-center text-sm text-muted">No docs yet.</p> : data.map((d) => (
            <Link key={d.id} to={`/docs/${d.id}`} className={clsx('flex items-start gap-2.5 rounded-xl px-2.5 py-2', Number(id) === d.id ? 'bg-ink text-surface' : 'hover:bg-sunken')}>
              <span className="text-lg leading-6">{d.icon || '📄'}</span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1 truncate text-sm font-medium">{d.pinned && <Pin size={11} className="shrink-0" />}{d.visibility === 'private' && <Lock size={11} className="shrink-0" />}<span className="truncate">{d.title}</span></span>
                <span className={clsx('block truncate text-xs', Number(id) === d.id ? 'text-surface/70' : 'text-muted')}>{d.Project ? `${d.Project.code}, ` : ''}{ago(d.updatedAt)}</span>
              </span>
            </Link>
          ))}
        </div>
      </aside>
      <main className={clsx('min-w-0 flex-1 flex-col', id ? 'flex' : 'hidden lg:flex')}>
        {id ? <Editor key={id} id={id} onDeleted={() => { reload(); nav('/docs'); }} /> : (
          <div className="grid flex-1 place-items-center"><Empty icon={FileText} title="Briefs, SOPs, meeting notes" body="Write in markdown, share with the team or a client, and let Gemini draft the first version." action={<button type="button" className="btn-primary" onClick={create}><Plus size={15} />New doc</button>} /></div>
        )}
      </main>
    </div>
  );
}
