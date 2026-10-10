import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Plus, X } from 'lucide-react';
import api from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useDirectory, useProjects } from '../lib/directory';
import { Modal, Field, UserPicker, Toggle } from './ui';
import { STATUS, STATUS_ORDER, PRIORITY } from '../lib/format';

/** Create-task modal. `defaults` may include projectId, parentId, parentTitle, status, assigneeIds. */
export default function TaskForm({ open, onClose, defaults = {}, onCreated }) {
  const { can, user } = useAuth();
  const people = useDirectory();
  const projects = useProjects();
  const blank = () => ({
    title: '', description: '', projectId: defaults.projectId || '', status: defaults.status || 'todo', priority: 'medium',
    assigneeIds: defaults.assigneeIds || (can('tasks.assign') ? [] : [user.id]), dueDate: '', startDate: '', estimateHours: '',
    milestoneId: '', clientVisible: !!defaults.clientVisible, requiresApproval: false, checklist: [], tags: '',
  });
  const [f, setF] = useState(blank);
  const [milestones, setMilestones] = useState([]);
  const [busy, setBusy] = useState(false);
  const [newItem, setNewItem] = useState('');

  useEffect(() => { if (open) setF(blank()); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!f.projectId || defaults.parentId) { setMilestones([]); return; }
    api.get(`/projects/${f.projectId}`).then((r) => setMilestones(r.data.Milestones || [])).catch(() => setMilestones([]));
  }, [f.projectId, defaults.parentId]);

  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e?.target ? (e.target.type === 'checkbox' ? e.target.checked : e.target.value) : e }));
  const assignable = can('tasks.assign') ? people : people.filter((p) => p.id === user.id);

  const submit = async (e) => {
    e.preventDefault();
    if (!f.title.trim()) return toast.error('Give the task a title.');
    setBusy(true);
    try {
      const payload = {
        ...f, parentId: defaults.parentId || undefined, projectId: f.projectId || null,
        dueDate: f.dueDate ? new Date(f.dueDate).toISOString() : null, startDate: f.startDate || null,
        estimateHours: f.estimateHours ? Number(f.estimateHours) : null, milestoneId: f.milestoneId || null,
        checklist: [...f.checklist, newItem].filter((x) => x.trim()),
        tags: f.tags.split(',').map((t) => t.trim()).filter(Boolean),
      };
      const { data } = await api.post('/tasks', payload);
      toast.success(`Created ${data.key}`);
      onCreated?.(data);
      onClose();
    } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title={defaults.parentId ? `New subtask of “${defaults.parentTitle || 'task'}”` : 'New task'} width="max-w-2xl"
      footer={<><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button form="task-form" className="btn-primary" disabled={busy}>{busy ? 'Creating…' : 'Create task'}</button></>}>
      <form id="task-form" onSubmit={submit} className="space-y-4">
        <input autoFocus className="input !border-transparent !bg-transparent !px-0 font-display !text-xl font-semibold !ring-0" placeholder="What needs to get done?" value={f.title} onChange={set('title')} />
        <textarea className="input min-h-[84px]" placeholder="Details, links, brief…" value={f.description} onChange={set('description')} />
        <div className="grid gap-4 sm:grid-cols-2">
          {!defaults.parentId && (
            <Field label="Project">
              <select className="input" value={f.projectId} onChange={set('projectId')}>
                <option value="">No project (personal)</option>
                {projects.filter((p) => p.status !== 'archived').map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
          )}
          <Field label="Assign to"><UserPicker users={assignable} value={f.assigneeIds} onChange={set('assigneeIds')} placeholder={can('tasks.assign') ? 'Pick people' : 'You'} /></Field>
          <Field label="Status">
            <select className="input" value={f.status} onChange={set('status')}>{STATUS_ORDER.map((s) => <option key={s} value={s}>{STATUS[s].label}</option>)}</select>
          </Field>
          <Field label="Priority">
            <select className="input" value={f.priority} onChange={set('priority')}>{Object.entries(PRIORITY).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
          </Field>
          <Field label="Start date"><input type="date" className="input" value={f.startDate} onChange={set('startDate')} /></Field>
          <Field label="Due"><input type="datetime-local" className="input" value={f.dueDate} onChange={set('dueDate')} /></Field>
          <Field label="Estimate (hours)"><input type="number" min="0" step="0.5" className="input" value={f.estimateHours} onChange={set('estimateHours')} /></Field>
          {milestones.length > 0 && (
            <Field label="Milestone">
              <select className="input" value={f.milestoneId} onChange={set('milestoneId')}>
                <option value="">None</option>{milestones.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
              </select>
            </Field>
          )}
          <Field label="Tags" hint="Comma separated, e.g. reel, festive"><input className="input" value={f.tags} onChange={set('tags')} /></Field>
        </div>

        <div>
          <span className="label">Checklist</span>
          <div className="space-y-1.5">
            {f.checklist.map((c, i) => (
              <div key={i} className="flex items-center gap-2 rounded-lg bg-white/[0.03] px-3 py-1.5 text-sm">
                <span className="flex-1">{c}</span>
                <button type="button" className="text-mist hover:text-rose" onClick={() => setF((s) => ({ ...s, checklist: s.checklist.filter((_, j) => j !== i) }))} aria-label="Remove"><X size={14} /></button>
              </div>
            ))}
            <div className="flex gap-2">
              <input className="input" placeholder="Add a step and press Enter" value={newItem} onChange={(e) => setNewItem(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (newItem.trim()) { setF((s) => ({ ...s, checklist: [...s.checklist, newItem.trim()] })); setNewItem(''); } } }} />
              <button type="button" className="btn-ghost" onClick={() => { if (newItem.trim()) { setF((s) => ({ ...s, checklist: [...s.checklist, newItem.trim()] })); setNewItem(''); } }} aria-label="Add step"><Plus size={16} /></button>
            </div>
          </div>
        </div>

        <div className="panel-quiet space-y-3 p-3">
          <Toggle checked={f.clientVisible} onChange={set('clientVisible')} label="Show in client portal" hint="The client sees this task, its progress and comments you mark as shared." />
          <Toggle checked={f.requiresApproval} onChange={set('requiresApproval')} label="Needs approval" hint="Marking it done sends it to review for a manager or the client to sign off." />
        </div>
      </form>
    </Modal>
  );
}
