import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import { Plus, X, Sparkles, Repeat, ListTree, ChevronDown } from 'lucide-react';
import api from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useDirectory, useProjects, useAiStatus } from '../lib/directory';
import { Modal, Field, UserPicker, Toggle, Spinner, DueInput } from './ui';
import { PRIORITY } from '../lib/format';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function ListInput({ items, onChange, placeholder, icon: Icon = Plus }) {
  const [v, setV] = useState('');
  const add = () => { if (v.trim()) { onChange([...items, v.trim()]); setV(''); } };
  return (
    <div className="space-y-1.5">
      {items.map((c, i) => (
        <div key={i} className="flex items-center gap-2 rounded-lg bg-sunken px-3 py-1.5 text-sm">
          <span className="flex-1">{c}</span>
          <button type="button" className="text-muted hover:text-ember" onClick={() => onChange(items.filter((_, j) => j !== i))} aria-label="Remove"><X size={14} /></button>
        </div>
      ))}
      <div className="flex gap-2">
        <input className="input" placeholder={placeholder} value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />
        <button type="button" className="btn-ghost" onClick={add} aria-label="Add"><Icon size={16} /></button>
      </div>
    </div>
  );
}

/** Create-task modal. `defaults` may include projectId, parentId, parentTitle, status, assigneeIds, sectionId, sprintId, title, dueDate. */
export default function TaskForm({ open, onClose, defaults = {}, onCreated }) {
  const { can, user } = useAuth();
  const people = useDirectory();
  const projects = useProjects();
  const ai = useAiStatus();
  const blank = () => ({
    title: defaults.title || '', description: '', projectId: defaults.projectId || '', status: defaults.status || 'todo', priority: defaults.priority || 'medium',
    assigneeIds: defaults.assigneeIds || (can('tasks.assign') ? [] : [user.id]), dueDate: defaults.dueDate || '', startDate: '',
    estimateHours: '', storyPoints: '', milestoneId: '', sectionId: defaults.sectionId || '', sprintId: defaults.sprintId || '',
    clientVisible: !!defaults.clientVisible, requiresApproval: false, checklist: [], subtasks: [], tags: '', recurrence: null,
  });
  const [f, setF] = useState(blank);
  const [meta, setMeta] = useState({ milestones: [], sections: [], sprints: [] });
  const [busy, setBusy] = useState(false);
  const [aiText, setAiText] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [more, setMore] = useState(false);

  useEffect(() => { if (open) { setF(blank()); setAiText(''); setMore(false); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open || !f.projectId || defaults.parentId) { setMeta({ milestones: [], sections: [], sprints: [] }); return; }
    Promise.all([api.get(`/projects/${f.projectId}`), api.get(`/projects/${f.projectId}/sprints`)])
      .then(([p, s]) => setMeta({ milestones: p.data.Milestones || [], sections: p.data.Sections || [], sprints: s.data.filter((x) => x.status !== 'completed') }))
      .catch(() => setMeta({ milestones: [], sections: [], sprints: [] }));
  }, [f.projectId, defaults.parentId, open]);

  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e?.target ? (e.target.type === 'checkbox' ? e.target.checked : e.target.value) : e }));
  const assignable = can('tasks.assign') ? people : people.filter((p) => p.id === user.id);

  const fillWithAi = async () => {
    if (!aiText.trim()) return;
    setAiBusy(true);
    try {
      const { data } = await api.post('/ai/parse-task', { text: aiText, projectId: defaults.projectId || f.projectId || undefined });
      setF((s) => ({
        ...s, title: data.title || s.title, description: data.description || s.description, projectId: defaults.parentId ? s.projectId : (data.projectId || s.projectId),
        priority: data.priority || s.priority, assigneeIds: can('tasks.assign') && data.assigneeIds?.length ? data.assigneeIds : s.assigneeIds,
        dueDate: data.dueDate || s.dueDate, startDate: data.startDate || s.startDate, tags: (data.tags || []).join(', ') || s.tags,
        checklist: data.checklist?.length ? data.checklist : s.checklist, subtasks: data.subtasks?.length ? data.subtasks : s.subtasks,
        estimateHours: data.estimateHours || s.estimateHours,
      }));
      if (data.subtasks?.length || data.checklist?.length) setMore(true);
      toast.success('Filled in. Check the details and create.');
    } catch (e) { toast.error(e.message); } finally { setAiBusy(false); }
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!f.title.trim()) return toast.error('Give the task a title.');
    if (!defaults.parentId && !f.projectId) return toast.error('Pick the project this task belongs to.');
    setBusy(true);
    try {
      const payload = {
        ...f, parentId: defaults.parentId || undefined, projectId: f.projectId || null,
        dueDate: f.dueDate || null, startDate: f.startDate || null,
        estimateHours: f.estimateHours ? Number(f.estimateHours) : null, storyPoints: f.storyPoints ? Number(f.storyPoints) : null,
        milestoneId: f.milestoneId || null, sectionId: f.sectionId || null, sprintId: f.sprintId || null,
        tags: f.tags.split(',').map((t) => t.trim()).filter(Boolean),
      };
      const { data } = await api.post('/tasks', payload);
      toast.success(`Created ${data.key}`);
      onCreated?.(data);
      onClose();
    } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };

  const rec = f.recurrence;
  return (
    <Modal open={open} onClose={onClose} title={defaults.parentId ? 'New subtask' : 'New task'} subtitle={defaults.parentId ? `Inside “${defaults.parentTitle || 'task'}”` : undefined} width="max-w-2xl"
      footer={<><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button form="task-form" className="btn-primary" disabled={busy}>{busy ? 'Creating…' : 'Create task'}</button></>}>
      <form id="task-form" onSubmit={submit} className="space-y-4">
        {ai.ready && (
          <div className="rounded-xl border border-violet/25 bg-violet/5 p-2.5">
            <div className="flex items-start gap-2">
              <Sparkles size={16} className="mt-2.5 shrink-0 text-violet" />
              <textarea value={aiText} onChange={(e) => setAiText(e.target.value)} rows={1}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); fillWithAi(); } }}
                placeholder="Describe it like a message: “Rahul ko Friday tak Kasaar ke 3 Diwali reels banana hai, urgent”"
                className="min-h-[40px] flex-1 resize-none bg-transparent py-2 text-sm outline-none placeholder:text-violet/60" />
              <button type="button" className="btn-ai btn-sm mt-1" onClick={fillWithAi} disabled={aiBusy || !aiText.trim()}>{aiBusy ? <Spinner size={13} className="text-violet" /> : 'Fill in'}</button>
            </div>
          </div>
        )}
        <input autoFocus className="w-full border-0 bg-transparent px-0 font-display text-2xl font-semibold outline-none placeholder:text-faint" placeholder="Task title" value={f.title} onChange={set('title')} />
        <textarea className="input min-h-[78px]" placeholder="Brief, links, acceptance criteria…" value={f.description} onChange={set('description')} />
        <div className="grid gap-4 sm:grid-cols-2">
          {!defaults.parentId && (
            <Field label="Project">
              <select required className={clsx('input', !f.projectId && 'text-muted')} value={f.projectId} onChange={(e) => setF((s) => ({ ...s, projectId: e.target.value, sectionId: '', sprintId: '', milestoneId: '' }))}>
                <option value="" disabled>Pick a project</option>
                {projects.filter((p) => !['archived', 'completed'].includes(p.status)).map((p) => <option key={p.id} value={p.id}>{p.icon ? `${p.icon} ` : ''}{p.name}</option>)}
              </select>
            </Field>
          )}
          <Field label="Assign to"><UserPicker users={assignable} value={f.assigneeIds} onChange={set('assigneeIds')} placeholder={can('tasks.assign') ? 'Pick people' : 'You'} /></Field>
          <Field label="Stage">
            <select className="input" value={f.status === 'review' || f.status === 'done' ? f.status : `s:${f.sectionId || meta.sections[0]?.id || ''}`}
              onChange={(e) => { const v = e.target.value; if (v === 'review' || v === 'done') setF((s) => ({ ...s, status: v })); else { const sid = Number(v.slice(2)) || ''; setF((s) => ({ ...s, sectionId: sid, status: meta.sections[0] && sid === meta.sections[0].id ? 'todo' : sid ? 'in_progress' : 'todo' })); } }}>
              {meta.sections.length ? meta.sections.map((s) => <option key={s.id} value={`s:${s.id}`}>{s.name}</option>) : <option value="s:">{defaults.parentId ? 'Same as parent' : f.projectId ? 'First stage' : 'Pick a project first'}</option>}
              <option value="review">In review</option>
              <option value="done">Completed</option>
            </select>
          </Field>
          <Field label="Priority">
            <div className="grid grid-cols-4 gap-1 rounded-xl bg-sunken p-1">
              {Object.entries(PRIORITY).map(([k, v]) => (
                <button key={k} type="button" onClick={() => set('priority')(k)} className={clsx('rounded-lg py-1.5 text-xs font-semibold transition', f.priority === k ? 'bg-surface shadow-sm' : 'text-muted hover:text-ink')} style={f.priority === k ? { color: v.color } : undefined}>{v.label}</button>
              ))}
            </div>
          </Field>
          <Field label="Start date"><input type="date" className="input" value={f.startDate} onChange={set('startDate')} /></Field>
          <div><span className="label">Due date and time</span><DueInput value={f.dueDate} onChange={(v) => setF((s) => ({ ...s, dueDate: v }))} /></div>
          {meta.sprints.length > 0 && (
            <Field label="Sprint">
              <select className="input" value={f.sprintId} onChange={set('sprintId')}><option value="">Backlog</option>{meta.sprints.map((s) => <option key={s.id} value={s.id}>{s.name}{s.status === 'active' ? ' (active)' : ''}</option>)}</select>
            </Field>
          )}
        </div>

        <button type="button" onClick={() => setMore((m) => !m)} className="flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-ink">
          <ChevronDown size={16} className={clsx('transition', !more && '-rotate-90')} />More options
          <span className="font-normal text-faint">estimate, milestone, repeat, checklist, subtasks</span>
        </button>
        {more && (
          <div className="space-y-4 rounded-xl border border-line p-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Estimate (hours)"><input type="number" min="0" step="0.5" className="input" value={f.estimateHours} onChange={set('estimateHours')} /></Field>
              <Field label="Story points"><input type="number" min="0" className="input" value={f.storyPoints} onChange={set('storyPoints')} /></Field>
              <Field label="Tags" hint="Comma separated"><input className="input" value={f.tags} onChange={set('tags')} placeholder="reel, festive" /></Field>
              {meta.milestones.length > 0 && (
                <Field label="Milestone" className="sm:col-span-3">
                  <select className="input" value={f.milestoneId} onChange={set('milestoneId')}><option value="">None</option>{meta.milestones.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}</select>
                </Field>
              )}
            </div>
            <div>
              <span className="label flex items-center gap-1.5"><Repeat size={13} />Repeat</span>
              <div className="flex flex-wrap items-center gap-2">
                <select className="input !w-auto" value={rec?.freq || ''} onChange={(e) => set('recurrence')(e.target.value ? { freq: e.target.value, interval: 1, days: e.target.value === 'weekly' ? [1] : [] } : null)}>
                  <option value="">Doesn't repeat</option><option value="daily">Every day</option><option value="weekly">Every week</option><option value="monthly">Every month</option>
                </select>
                {rec?.freq === 'weekly' && DAYS.map((d, i) => (
                  <button key={d} type="button" onClick={() => set('recurrence')({ ...rec, days: rec.days.includes(i) ? rec.days.filter((x) => x !== i) : [...rec.days, i] })}
                    className={clsx('h-8 w-10 rounded-lg text-xs font-semibold', rec.days.includes(i) ? 'bg-ink text-surface' : 'bg-sunken text-muted')}>{d}</button>
                ))}
              </div>
              {rec && <p className="mt-1.5 text-[11px] text-faint">When it's marked done, the next one is created automatically with a new due date.</p>}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div><span className="label">Checklist</span><ListInput items={f.checklist} onChange={set('checklist')} placeholder="Add a step" /></div>
              <div><span className="label flex items-center gap-1.5"><ListTree size={13} />Subtasks</span><ListInput items={f.subtasks} onChange={set('subtasks')} placeholder="Add a subtask" /></div>
            </div>
          </div>
        )}

        <div className="space-y-3 rounded-xl bg-sunken/60 p-3">
          <Toggle checked={f.clientVisible} onChange={set('clientVisible')} label="Show in client portal" hint="The client sees this task, its progress and the comments you share." />
          <Toggle checked={f.requiresApproval} onChange={set('requiresApproval')} label="Needs approval" hint="Marking it done sends it to review for a manager or the client to sign off." />
        </div>
      </form>
    </Modal>
  );
}
