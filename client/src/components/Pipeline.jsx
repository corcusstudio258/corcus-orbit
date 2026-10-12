import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import { Plus, Search, Settings2, Eye, CircleCheckBig, Archive, GripVertical, Trash2, ArrowUp, ArrowDown, Lock, MoreHorizontal, Pencil } from 'lucide-react';
import api from '../lib/api';
import { useAuth, useLive } from '../context/AuthContext';
import { useDirectory } from '../lib/directory';
import { PageLoader, Modal, Toggle, Menu, UserPicker, confirm } from './ui';
import { TaskCard } from './TaskViews';
import { useComposer } from './Layout';
import { celebrate, pointOf } from './Celebrate';

const FIXED = {
  review: { label: 'In review', color: '#8B5CF6', icon: Eye, hint: 'Work waiting for a check or client approval.' },
  done: { label: 'Completed', color: '#1FA971', icon: CircleCheckBig, hint: 'Finished and approved work.' },
  archive: { label: 'Archive', color: '#5B6386', icon: Archive, hint: 'Out of sight but kept. Archived tasks drop off lists and reports.' },
};
const STAGE_COLORS = ['#5B6386', '#3D5AFE', '#8B5CF6', '#0EA5B7', '#C76A00', '#1FA971', '#D946EF', '#E5484D'];

/** Which column a task belongs in. */
export function stageOf(t, sections) {
  if (t.archived) return 'archive';
  if (t.status === 'review') return 'review';
  if (t.status === 'done') return 'done';
  const sec = sections.find((s) => s.id === t.sectionId);
  if (sec) return `section:${sec.id}`;
  if (!sections.length) return 'none';
  return t.status === 'in_progress' || t.status === 'blocked' ? `section:${(sections[1] || sections[0]).id}` : `section:${sections[0].id}`;
}

function PipelineSettings({ open, onClose, project, onSaved }) {
  const [stages, setStages] = useState([]);
  const [pipe, setPipe] = useState({ review: true, done: true, archive: true });
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setStages(project.Sections.map((s) => ({ ...s })));
    setPipe({ review: true, done: true, archive: true, ...(project.pipeline || {}) });
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const move = (i, d) => setStages((xs) => { const n = [...xs]; const j = i + d; if (j < 0 || j >= n.length) return n; [n[i], n[j]] = [n[j], n[i]]; return n; });
  const add = async (e) => {
    e.preventDefault();
    const v = name.trim(); if (!v) return;
    if (['in review', 'review', 'completed', 'done', 'archive', 'archived'].includes(v.toLowerCase())) { toast.error(`"${v}" is one of the fixed stages. Switch it on below instead.`); return; }
    try { const { data } = await api.post(`/projects/${project.id}/sections`, { name: v, color: STAGE_COLORS[stages.length % STAGE_COLORS.length] }); setStages((xs) => [...xs, data]); setName(''); } catch (err) { toast.error(err.message); }
  };
  const remove = async (s) => {
    if (stages.length <= 1) { toast.error('Keep at least one working stage.'); return; }
    if (!(await confirm({ title: `Delete the "${s.name}" stage?`, body: 'Its tasks move to the first stage. Nothing is deleted.', danger: true, confirmLabel: 'Delete stage' }))) return;
    try { await api.delete(`/projects/sections/${s.id}`); setStages((xs) => xs.filter((x) => x.id !== s.id)); } catch (err) { toast.error(err.message); }
  };
  const save = async () => {
    setBusy(true);
    try {
      for (const s of stages) {
        const orig = project.Sections.find((x) => x.id === s.id);
        if (orig && (orig.name !== s.name || orig.color !== s.color)) await api.patch(`/projects/sections/${s.id}`, { name: s.name, color: s.color });
      }
      await api.post(`/projects/${project.id}/sections/reorder`, { ids: stages.map((s) => s.id) });
      await api.patch(`/projects/${project.id}`, { pipeline: pipe });
      toast.success('Pipeline saved'); onSaved(); onClose();
    } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title="Customise pipeline" subtitle="Your own stages first, then the fixed end stages." width="max-w-xl"
      footer={<><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button type="button" className="btn-primary" disabled={busy} onClick={save}>Save pipeline</button></>}>
      <div className="space-y-6">
        <section>
          <h3 className="mb-2 text-sm font-semibold">Working stages</h3>
          <ul className="space-y-2">
            {stages.map((s, i) => (
              <li key={s.id} className="flex items-center gap-2 rounded-xl border border-line bg-surface p-2">
                <Menu align="left" trigger={<button type="button" className="h-6 w-6 rounded-full border-2 border-surface shadow-[0_0_0_1px_rgb(var(--c-line))]" style={{ background: s.color }} aria-label="Stage colour" />}
                  items={STAGE_COLORS.map((c) => ({ label: <span className="flex items-center gap-2"><span className="h-3 w-3 rounded-full" style={{ background: c }} />{c}</span>, onClick: () => setStages((xs) => xs.map((x) => (x.id === s.id ? { ...x, color: c } : x))) }))} />
                <input className="input !py-1.5" value={s.name} onChange={(e) => setStages((xs) => xs.map((x) => (x.id === s.id ? { ...x, name: e.target.value } : x)))} />
                <button type="button" className="rounded-lg p-1.5 text-muted hover:bg-sunken disabled:opacity-30" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up"><ArrowUp size={14} /></button>
                <button type="button" className="rounded-lg p-1.5 text-muted hover:bg-sunken disabled:opacity-30" disabled={i === stages.length - 1} onClick={() => move(i, 1)} aria-label="Move down"><ArrowDown size={14} /></button>
                <button type="button" className="rounded-lg p-1.5 text-muted hover:bg-sunken hover:text-ember" onClick={() => remove(s)} aria-label="Delete stage"><Trash2 size={14} /></button>
              </li>
            ))}
          </ul>
          <form onSubmit={add} className="mt-2 flex gap-2"><input className="input" placeholder="New stage, e.g. Brief, Design, Shoot, Edit" value={name} onChange={(e) => setName(e.target.value)} /><button className="btn-ink shrink-0"><Plus size={14} />Add</button></form>
          <p className="mt-2 text-xs text-muted">The first stage means not started. Every later stage counts as in progress.</p>
        </section>
        <section>
          <h3 className="mb-2 text-sm font-semibold">Fixed end stages</h3>
          <div className="space-y-2">
            {Object.entries(FIXED).map(([k, f]) => (
              <div key={k} className="flex items-center gap-3 rounded-xl border border-line p-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-white" style={{ background: f.color }}><f.icon size={16} /></span>
                <div className="min-w-0 flex-1"><Toggle checked={pipe[k] !== false} onChange={(v) => setPipe((p) => ({ ...p, [k]: v }))} label={f.label} hint={f.hint} /></div>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted">A switched-off stage still shows up if tasks are sitting in it, so nothing gets lost.</p>
        </section>
      </div>
    </Modal>
  );
}

export default function Pipeline({ project, reloadProject }) {
  const { can } = useAuth();
  const people = useDirectory();
  const compose = useComposer();
  const [tasks, setTasks] = useState(null);
  const [q, setQ] = useState('');
  const [who, setWho] = useState(null);
  const [over, setOver] = useState(null);
  const [settings, setSettings] = useState(false);
  const [dragCol, setDragCol] = useState(null);
  const [renaming, setRenaming] = useState(null);
  const ckey = `orbit:pipe-collapsed:${project.id}`;
  const [collapsed, setCollapsed] = useState(() => { try { return JSON.parse(localStorage.getItem(ckey)) || { archive: true }; } catch { return { archive: true }; } });
  const toggleCollapse = (k) => setCollapsed((c) => { const n = { ...c, [k]: !c[k] }; try { localStorage.setItem(ckey, JSON.stringify(n)); } catch { /* ignore */ } return n; });
  const sections = project.Sections || [];
  const pipe = { review: true, done: true, archive: true, ...(project.pipeline || {}) };

  const load = () => api.get(`/tasks?projectId=${project.id}&parentId=root&archived=1`).then((r) => setTasks(r.data.sort((a, b) => a.position - b.position)));
  useEffect(() => { load(); }, [project.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useLive('task:changed', (d) => { if (!d?.projectId || d.projectId === project.id) load(); }, [project.id]);
  useEffect(() => { const h = () => load(); window.addEventListener('orbit:task-created', h); return () => window.removeEventListener('orbit:task-created', h); }, [project.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const visible = useMemo(() => (tasks || []).filter((t) => (!q || `${t.key} ${t.title}`.toLowerCase().includes(q.toLowerCase())) && (!who || t.assignees?.some((a) => a.id === who))), [tasks, q, who]);
  const byStage = (key) => visible.filter((t) => stageOf(t, sections) === key);
  const columns = [
    ...sections.map((s) => ({ key: `section:${s.id}`, label: s.name, color: s.color, section: s })),
    ...Object.entries(FIXED).filter(([k]) => pipe[k] !== false || (tasks || []).some((t) => stageOf(t, sections) === k)).map(([k, f]) => ({ key: k, label: f.label, color: f.color, fixed: f, off: pipe[k] === false })),
  ];

  const move = async (id, stage, beforeId, evt) => {
    const t = tasks.find((x) => x.id === id);
    if (!t) return;
    const from = stageOf(t, sections);
    const col = tasks.filter((x) => stageOf(x, sections) === stage && x.id !== id);
    const idx = beforeId ? col.findIndex((x) => x.id === beforeId) : col.length;
    const after = idx > 0 ? col[idx - 1] : null;
    const before = beforeId ? col[idx] : null;
    const optimistic = stage === 'archive' ? { archived: true } : stage === 'review' || stage === 'done' ? { archived: false, status: stage }
      : { archived: false, sectionId: Number(stage.slice(8)), status: t.status === 'blocked' ? 'blocked' : sections[0] && stage === `section:${sections[0].id}` ? 'todo' : 'in_progress' };
    setTasks((ts) => ts.map((x) => (x.id === id ? { ...x, ...optimistic, position: before && after ? (before.position + after.position) / 2 : before ? before.position - 1 : after ? after.position + 1 : x.position } : x)).sort((a, b) => a.position - b.position));
    try {
      const { data } = await api.post('/tasks/reorder', { id, beforeId: before?.id, afterId: after?.id, ...(from !== stage ? { stage } : {}) });
      if (data.notice) toast(data.notice, { icon: '⚠️' });
      setTasks((ts) => ts.map((x) => (x.id === id ? { ...x, ...data } : x)));
      const landed = stageOf(data, sections);
      if (from !== landed && ['review', 'done', 'archive'].includes(landed)) celebrate(landed, pointOf(evt));
    } catch (err) { toast.error(err.message); load(); }
  };

  const dropColumn = async (targetKey) => {
    if (!dragCol || dragCol === targetKey || !targetKey.startsWith('section:')) return;
    const ids = sections.map((s) => s.id);
    const from = ids.indexOf(Number(dragCol.slice(8))); const to = ids.indexOf(Number(targetKey.slice(8)));
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    try { await api.post(`/projects/${project.id}/sections/reorder`, { ids }); reloadProject(); } catch (err) { toast.error(err.message); }
  };
  const rename = async (s, v) => { setRenaming(null); if (!v.trim() || v === s.name) return; try { await api.patch(`/projects/sections/${s.id}`, { name: v.trim() }); reloadProject(); } catch (err) { toast.error(err.message); } };
  const removeStage = async (s) => {
    if (sections.length <= 1) { toast.error('Keep at least one working stage.'); return; }
    if (!(await confirm({ title: `Delete the "${s.name}" stage?`, body: 'Its tasks move to the first stage.', danger: true, confirmLabel: 'Delete stage' }))) return;
    try { await api.delete(`/projects/sections/${s.id}`); reloadProject(); load(); } catch (err) { toast.error(err.message); }
  };
  const toggleFixed = async (k) => { try { await api.patch(`/projects/${project.id}`, { pipeline: { ...pipe, [k]: !pipe[k] } }); reloadProject(); } catch (err) { toast.error(err.message); } };

  if (!tasks) return <PageLoader />;
  const manage = project.canManage || can('projects.manage');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[180px] flex-1 sm:max-w-xs"><Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" /><input className="input pl-9" placeholder="Filter cards" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div className="w-48"><UserPicker compact multiple={false} users={people} value={who} onChange={setWho} placeholder="Anyone" /></div>
        <div className="ml-auto flex gap-2">
          {manage && <button type="button" className="btn-ghost" onClick={() => setSettings(true)}><Settings2 size={15} />Customise pipeline</button>}
        </div>
      </div>

      <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        {columns.map((c) => {
          const col = byStage(c.key);
          const Icon = c.fixed?.icon;
          if (c.fixed && collapsed[c.key]) {
            return (
              <button key={c.key} type="button" onClick={() => toggleCollapse(c.key)} title={`${c.label}: show`}
                onDragOver={(e) => { e.preventDefault(); setOver(c.key); }} onDragLeave={() => setOver(null)}
                onDrop={(e) => { e.preventDefault(); setOver(null); if (!dragCol) move(Number(e.dataTransfer.getData('text/task')), c.key, null, e); }}
                className={clsx('flex w-14 shrink-0 flex-col items-center gap-3 rounded-2xl py-3 transition', over === c.key ? 'scale-105' : 'hover:brightness-95')}
                style={{ background: over === c.key ? `${c.color}26` : `${c.color}12`, boxShadow: `inset 0 0 0 1px ${c.color}33` }}>
                <span className="grid h-8 w-8 place-items-center rounded-xl text-white" style={{ background: c.color }}><Icon size={15} /></span>
                <span className="rounded-full bg-surface px-1.5 text-xs font-bold text-muted">{col.length}</span>
                <span className="text-xs font-semibold [writing-mode:vertical-rl]" style={{ color: c.color }}>{c.label}</span>
              </button>
            );
          }
          return (
            <div key={c.key}
              onDragOver={(e) => { e.preventDefault(); setOver(c.key); }} onDragLeave={() => setOver(null)}
              onDrop={(e) => { e.preventDefault(); setOver(null); if (dragCol) { dropColumn(c.key); setDragCol(null); return; } move(Number(e.dataTransfer.getData('text/task')), c.key, null, e); }}
              className={clsx('flex w-[272px] shrink-0 flex-col rounded-2xl p-2 transition', over === c.key ? 'ring-2' : '', c.fixed ? 'bg-surface' : 'bg-sunken/70', c.off && 'opacity-70')}
              style={{ ...(c.fixed ? { backgroundImage: `linear-gradient(180deg, ${c.color}14, transparent 140px)`, boxShadow: `inset 0 0 0 1px ${c.color}33` } : {}), ...(over === c.key ? { '--tw-ring-color': `${c.color}66`, background: `${c.color}12` } : {}) }}>
              <div className="mb-2 flex items-center gap-2 px-1.5 pt-1"
                draggable={!!c.section && manage} onDragStart={(e) => { if (!c.section) return; e.dataTransfer.setData('text/col', c.key); setDragCol(c.key); }} onDragEnd={() => setDragCol(null)}>
                {c.section && manage && <GripVertical size={14} className="-ml-1 cursor-grab text-faint" />}
                {Icon ? <span className="grid h-6 w-6 place-items-center rounded-lg text-white" style={{ background: c.color }}><Icon size={13} /></span> : <span className="h-2.5 w-2.5 rounded-full" style={{ background: c.color }} />}
                {renaming === c.key ? (
                  <input autoFocus className="input !py-0.5 text-sm" defaultValue={c.label} onBlur={(e) => rename(c.section, e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setRenaming(null); }} />
                ) : <span className="truncate text-sm font-semibold">{c.label}</span>}
                <span className="rounded-full bg-surface px-1.5 text-xs font-semibold text-muted">{col.length}</span>
                {c.fixed && <Lock size={11} className="text-faint" title="Fixed stage" />}
                {c.fixed && !manage && <button type="button" className="ml-auto rounded-md px-1.5 text-[11px] font-semibold text-muted hover:bg-surface" onClick={() => toggleCollapse(c.key)}>Hide</button>}
                <div className="ml-auto flex items-center">
                  {c.section && can('tasks.create') && <button type="button" className="rounded-md p-1 text-muted hover:bg-surface hover:text-ink" aria-label={`Add task to ${c.label}`} onClick={() => compose({ projectId: project.id, sectionId: c.section.id })}><Plus size={15} /></button>}
                  {manage && (
                    <Menu trigger={<span className="block rounded-md p-1 text-muted hover:bg-surface hover:text-ink"><MoreHorizontal size={15} /></span>} items={c.section ? [
                      { label: 'Rename', icon: Pencil, onClick: () => setRenaming(c.key) },
                      { label: 'Delete stage', icon: Trash2, danger: true, onClick: () => removeStage(c.section) },
                    ] : [{ label: 'Collapse', icon: ArrowDown, onClick: () => toggleCollapse(c.key) }, { label: c.off ? 'Switch stage on' : 'Switch stage off', icon: c.off ? Eye : Lock, onClick: () => toggleFixed(c.key) }]} />
                  )}
                </div>
              </div>
              <div className="flex min-h-[110px] flex-1 flex-col gap-2">
                {col.map((t) => (
                  <div key={t.id} className={clsx(c.key === 'archive' && 'opacity-75 grayscale-[.4]')}>
                    <TaskCard t={t} showProject={false}
                      onDragStart={(e) => { e.dataTransfer.setData('text/task', String(t.id)); setDragCol(null); }}
                      onDropBefore={(e) => { if (dragCol) return; move(Number(e.dataTransfer.getData('text/task')), c.key, t.id, e); }} />
                  </div>
                ))}
                {!col.length && (
                  <div className="grid flex-1 place-items-center rounded-xl border-2 border-dashed border-line px-3 py-6 text-center text-xs text-faint">
                    {c.fixed ? <span>{c.fixed.hint}</span> : 'Drop tasks here'}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {manage && (
          <button type="button" onClick={() => setSettings(true)} className="flex h-14 w-[220px] shrink-0 items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-line text-sm font-semibold text-muted hover:border-faint hover:text-ink"><Plus size={16} />Add stage</button>
        )}
      </div>
      <PipelineSettings open={settings} onClose={() => setSettings(false)} project={project} onSaved={() => { reloadProject(); load(); }} />
    </div>
  );
}

