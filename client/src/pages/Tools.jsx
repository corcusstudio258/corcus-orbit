import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import { Plus, Workflow, Sparkles, Trash2, Pencil, Play, Zap, ArrowDown, LayoutTemplate, Upload, Download, FileSpreadsheet, Database, Check, X, Copy } from 'lucide-react';
import api, { download } from '../lib/api';
import useFetch from '../lib/useFetch';
import { useAuth } from '../context/AuthContext';
import { useDirectory, useProjects, useAiStatus } from '../lib/directory';
import { PageHeader, Panel, Modal, Field, Toggle, Empty, PageLoader, Spinner, confirm, Segmented } from '../components/ui';
import { STATUS, STATUS_ORDER, PRIORITY, PRIORITY_ORDER, ago } from '../lib/format';
import { ProjectForm } from './Projects';

// ---------------- Automations ----------------
const TO = { assignees: 'Assignees', creator: 'Whoever created it', managers: "Assignees' managers", project_owner: 'Project lead', watchers: 'Watchers', user: 'A specific person', phone: 'A phone number' };

function describe(rule, triggers, actions, people, projects) {
  const c = rule.conditions || {};
  const bits = [];
  if (c.fromStatus) bits.push(`from ${STATUS[c.fromStatus]?.label}`);
  if (c.status) bits.push(`${rule.trigger === 'task.status' ? 'to' : 'status is'} ${STATUS[c.status]?.label}`);
  if (c.priority) bits.push(`priority ${PRIORITY[c.priority]?.label}`);
  if (c.projectId) bits.push(`in ${projects.find((p) => p.id === Number(c.projectId))?.name || 'a project'}`);
  if (c.tag) bits.push(`tagged ${c.tag}`);
  if (c.decision) bits.push(c.decision === 'approve' ? 'when approved' : 'when changes are asked');
  if (c.clientVisible) bits.push('shared with the client');
  const acts = (rule.actions || []).map((a) => {
    const who = a.to === 'user' ? people.find((p) => p.id === Number(a.userId))?.name : a.to === 'phone' ? a.phone : TO[a.to]?.toLowerCase();
    if (a.type === 'notify') return `notify ${who || 'assignees'}`;
    if (a.type === 'whatsapp') return `WhatsApp ${who || 'assignees'}`;
    if (a.type === 'set_status') return `move to ${STATUS[a.status]?.label}`;
    if (a.type === 'set_priority') return `set priority ${PRIORITY[a.priority]?.label}`;
    if (a.type === 'assign') return `assign ${people.find((p) => p.id === Number(a.userId))?.name || 'someone'}`;
    if (a.type === 'comment') return 'post a comment';
    if (a.type === 'points') return `give ${a.points || 0} points`;
    if (a.type === 'move_section') return `move to stage ${a.sectionName}`;
    if (a.type === 'email') return `email ${who || 'assignees'}`;
    if (a.type === 'notify_client') return 'notify the client';
    if (a.type === 'add_tag') return `tag #${a.tag}`;
    if (a.type === 'add_watcher') return `add ${people.find((p) => p.id === Number(a.userId))?.name || 'someone'} as watcher`;
    if (a.type === 'set_due') return `set due in ${a.days || 0} days at ${a.time || '18:00'}`;
    if (a.type === 'create_subtask') return `create subtask "${a.title}"`;
    if (a.type === 'add_checklist') return 'add checklist items';
    if (a.type === 'share_client') return 'share with the client';
    if (a.type === 'archive') return 'archive it';
    return actions[a.type];
  });
  return { when: `${triggers[rule.trigger] || rule.trigger}${bits.length ? `, ${bits.join(', ')}` : ''}`, then: acts.join(', then ') };
}

function RuleBuilder({ open, onClose, rule, meta, onSaved }) {
  const people = useDirectory();
  const projects = useProjects();
  const ai = useAiStatus();
  const [r, setR] = useState(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setR(rule ? JSON.parse(JSON.stringify(rule)) : { name: '', description: '', trigger: 'task.status', conditions: {}, actions: [{ type: 'notify', to: 'assignees', title: '', message: '' }], active: true });
    else { setR(null); setText(''); }
  }, [open, rule]);
  const close = () => onClose();
  if (!open || !r) return null;
  const setC = (k, v) => setR({ ...r, conditions: { ...r.conditions, [k]: v || undefined } });
  const setA = (i, patch) => setR({ ...r, actions: r.actions.map((a, j) => (j === i ? { ...a, ...patch } : a)) });
  const fromText = async () => {
    setBusy(true);
    try { const out = (await api.post('/ai/automation', { text })).data; setR({ ...r, ...out, actions: out.actions?.length ? out.actions : r.actions }); toast.success('Rule drafted, check it below'); } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };
  const save = async () => {
    try { const res = r.id ? await api.patch(`/tools/automations/${r.id}`, r) : await api.post('/tools/automations', r); onSaved(res.data); close(); } catch (err) { toast.error(err.message); }
  };
  const sel = (v, on, opts, blank) => <select className="input" value={v || ''} onChange={(e) => on(e.target.value)}>{blank !== false && <option value="">{blank || 'Any'}</option>}{opts.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>;
  const statusOpts = STATUS_ORDER.map((k) => [k, STATUS[k].label]);
  const prioOpts = PRIORITY_ORDER.map((k) => [k, PRIORITY[k].label]);

  return (
    <Modal open onClose={close} title={r.id ? 'Edit automation' : 'New automation'} width="max-w-2xl"
      footer={<><button type="button" className="btn-ghost" onClick={close}>Cancel</button><button type="button" className="btn-primary" onClick={save}>Save automation</button></>}>
      <div className="space-y-5">
        {!r.id && (
          <div className="rounded-2xl border border-violet/25 bg-violet/[0.05] p-4">
            <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-violet"><Sparkles size={14} />Describe it in plain English</p>
            <div className="flex gap-2">
              <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="When an urgent task is blocked, WhatsApp the project lead" onKeyDown={(e) => e.key === 'Enter' && text.trim() && fromText()} />
              <button type="button" className="btn-ai shrink-0" onClick={fromText} disabled={busy || !text.trim() || !ai.ready} title={ai.ready ? '' : 'Add a Gemini key in Settings'}>{busy ? <Spinner size={14} className="text-violet" /> : 'Draft'}</button>
            </div>
          </div>
        )}
        <Field label="Name"><input className="input" value={r.name} onChange={(e) => setR({ ...r, name: e.target.value })} placeholder="Escalate blocked urgent work" /></Field>

        <div className="rounded-2xl border border-line p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold"><span className="grid h-6 w-6 place-items-center rounded-lg bg-cobalt/10 text-cobalt"><Zap size={13} /></span>When</div>
          {sel(r.trigger, (v) => setR({ ...r, trigger: v }), Object.entries(meta.triggers), false)}
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {r.trigger === 'task.status' && <Field label="Moving from">{sel(r.conditions.fromStatus, (v) => setC('fromStatus', v), statusOpts)}</Field>}
            <Field label={r.trigger === 'task.status' ? 'Moving to' : 'Status is'}>{sel(r.conditions.status, (v) => setC('status', v), statusOpts)}</Field>
            <Field label="Priority is">{sel(r.conditions.priority, (v) => setC('priority', v), prioOpts)}</Field>
            <Field label="In project">{sel(r.conditions.projectId, (v) => setC('projectId', v ? Number(v) : undefined), projects.map((p) => [p.id, `${p.code} ${p.name}`]))}</Field>
            <Field label="Has tag"><input className="input" value={r.conditions.tag || ''} onChange={(e) => setC('tag', e.target.value)} placeholder="Any" /></Field>
            {['task.client_review', 'task.approval'].includes(r.trigger) && <Field label="Decision">{sel(r.conditions.decision, (v) => setC('decision', v), [['approve', 'Approved'], ['changes', 'Changes asked']])}</Field>}
            <div className="flex items-end pb-2"><Toggle checked={!!r.conditions.clientVisible} onChange={(v) => setC('clientVisible', v || undefined)} label="Only tasks shared with the client" /></div>
          </div>
        </div>
        <div className="flex justify-center text-faint"><ArrowDown size={18} /></div>
        <div className="space-y-3 rounded-2xl border border-line p-4">
          <div className="flex items-center gap-2 text-sm font-semibold"><span className="grid h-6 w-6 place-items-center rounded-lg bg-leaf/10 text-leaf"><Play size={12} /></span>Then</div>
          {r.actions.map((a, i) => (
            <div key={i} className="space-y-3 rounded-xl bg-sunken/60 p-3">
              <div className="flex gap-2">{sel(a.type, (v) => setA(i, { type: v }), Object.entries(meta.actions), false)}{r.actions.length > 1 && <button type="button" className="btn-ghost btn-sm" onClick={() => setR({ ...r, actions: r.actions.filter((_, j) => j !== i) })} aria-label="Remove action"><X size={14} /></button>}</div>
              {['notify', 'whatsapp', 'email'].includes(a.type) && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="To">{sel(a.to, (v) => setA(i, { to: v }), Object.entries(TO).filter(([k]) => k !== 'phone' || a.type === 'whatsapp'), false)}</Field>
                  {a.to === 'user' && <Field label="Person">{sel(a.userId, (v) => setA(i, { userId: Number(v) }), people.map((p) => [p.id, p.name]), 'Pick')}</Field>}
                  {a.to === 'phone' && <Field label="Phone"><input className="input" value={a.phone || ''} onChange={(e) => setA(i, { phone: e.target.value })} placeholder="+91 98..." /></Field>}
                  {['notify', 'email'].includes(a.type) && <Field label={a.type === 'email' ? 'Subject' : 'Title'} className="sm:col-span-2"><input className="input" value={a.title || ''} onChange={(e) => setA(i, { title: e.target.value })} placeholder="{{task.key}} is blocked" /></Field>}
                  <Field label="Message" className="sm:col-span-2" hint="Use {{task.key}}, {{task.title}}, {{project.name}}, {{actor.name}}, {{from}}, {{to}}"><textarea className="input" rows={2} value={a.message || ''} onChange={(e) => setA(i, { message: e.target.value })} /></Field>
                </div>
              )}
              {a.type === 'set_status' && <Field label="Status">{sel(a.status, (v) => setA(i, { status: v }), statusOpts, false)}</Field>}
              {a.type === 'set_priority' && <Field label="Priority">{sel(a.priority, (v) => setA(i, { priority: v }), prioOpts, false)}</Field>}
              {a.type === 'assign' && <Field label="Person">{sel(a.userId, (v) => setA(i, { userId: Number(v) }), people.map((p) => [p.id, p.name]), 'Pick')}</Field>}
              {a.type === 'comment' && <Field label="Comment"><textarea className="input" rows={2} value={a.message || ''} onChange={(e) => setA(i, { message: e.target.value })} /></Field>}
              {a.type === 'points' && <div className="grid gap-3 sm:grid-cols-2"><Field label="Points"><input type="number" className="input" value={a.points || ''} onChange={(e) => setA(i, { points: Number(e.target.value) })} /></Field><Field label="To">{sel(a.to, (v) => setA(i, { to: v }), [['assignees', 'Assignees'], ['creator', 'Creator']], false)}</Field></div>}
              {a.type === 'notify_client' && <div className="grid gap-3"><Field label="Title"><input className="input" value={a.title || ''} onChange={(e) => setA(i, { title: e.target.value })} placeholder="{{task.title}} has an update" /></Field><Field label="Message"><textarea className="input" rows={2} value={a.message || ''} onChange={(e) => setA(i, { message: e.target.value })} /></Field></div>}
              {a.type === 'add_tag' && <Field label="Tag"><input className="input" value={a.tag || ''} onChange={(e) => setA(i, { tag: e.target.value })} placeholder="needs-qa" /></Field>}
              {a.type === 'add_watcher' && <Field label="Person">{sel(a.userId, (v) => setA(i, { userId: Number(v) }), people.map((p) => [p.id, p.name]), 'Pick')}</Field>}
              {a.type === 'set_due' && <div className="grid grid-cols-2 gap-3"><Field label="Days from now"><input type="number" min="0" className="input" value={a.days ?? 3} onChange={(e) => setA(i, { days: Number(e.target.value) })} /></Field><Field label="Time"><input type="time" className="input" value={a.time || '18:00'} onChange={(e) => setA(i, { time: e.target.value })} /></Field></div>}
              {a.type === 'create_subtask' && <Field label="Subtask title" hint="You can use {{task.title}}"><input className="input" value={a.title || ''} onChange={(e) => setA(i, { title: e.target.value })} /></Field>}
              {a.type === 'add_checklist' && <Field label="Checklist items" hint="One per line"><textarea className="input" rows={3} value={String(a.items || '').replace(/; /g, '\n')} onChange={(e) => setA(i, { items: e.target.value })} /></Field>}
              {['share_client', 'archive'].includes(a.type) && <p className="text-xs text-muted">No settings needed.</p>}
              {a.type === 'move_section' && <Field label="Stage name"><input className="input" value={a.sectionName || ''} onChange={(e) => setA(i, { sectionName: e.target.value })} /></Field>}
            </div>
          ))}
          <button type="button" className="btn-ghost btn-sm" onClick={() => setR({ ...r, actions: [...r.actions, { type: 'notify', to: 'assignees' }] })}><Plus size={13} />Another action</button>
        </div>
      </div>
    </Modal>
  );
}

function Recipes({ recipes, rules, onAdded }) {
  const [group, setGroup] = useState('');
  const [busy, setBusy] = useState('');
  const groups = [...new Set(recipes.map((x) => x.group))];
  const has = (rc) => rules.some((x) => x.name === rc.name);
  const add = async (rc) => { setBusy(rc.key); try { await api.post('/tools/automations/recipe', { key: rc.key }); toast.success(`Added: ${rc.name}`); onAdded(); } catch (err) { toast.error(err.message); } finally { setBusy(''); } };
  const ICON = { Reviews: '👀', Clients: '🤝', Deadlines: '⏰', Workflow: '⚙️', 'Tidy up': '✨' };
  return (
    <section className="panel p-5">
      <div className="mb-3 flex flex-wrap items-center gap-2"><h2 className="section-title">Recipes</h2><span className="text-xs text-muted">Ready-made automations. Add one, then tweak it if you like.</span>
        <div className="ml-auto"><Segmented size="sm" value={group} onChange={setGroup} options={[{ value: '', label: 'All' }, ...groups.map((g) => ({ value: g, label: g }))]} /></div></div>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {recipes.filter((rc) => !group || rc.group === group).map((rc) => (
          <div key={rc.key} className="flex items-start gap-3 rounded-xl border border-line p-3">
            <span className="text-xl leading-none">{ICON[rc.group] || '⚡'}</span>
            <div className="min-w-0 flex-1"><p className="text-sm font-semibold leading-snug">{rc.name}</p><p className="mt-0.5 text-[11px] text-muted">{rc.group}</p></div>
            {has(rc) ? <span className="chip bg-leaf/10 text-leaf"><Check size={11} />Added</span> : <button type="button" className="btn-ghost btn-sm shrink-0" disabled={busy === rc.key} onClick={() => add(rc)}><Plus size={13} />Add</button>}
          </div>
        ))}
      </div>
    </section>
  );
}

export function Automations() {
  const { data, reload, setData } = useFetch('/tools/automations');
  const people = useDirectory();
  const projects = useProjects();
  const [edit, setEdit] = useState(null);
  const [test, setTest] = useState(null);
  if (!data) return <PageLoader />;
  const toggle = async (a) => { setData((d) => ({ ...d, rules: d.rules.map((x) => (x.id === a.id ? { ...x, active: !a.active } : x)) })); await api.patch(`/tools/automations/${a.id}`, { active: !a.active }).catch((e) => { toast.error(e.message); reload(); }); };
  const remove = async (a) => { if (await confirm({ title: `Delete "${a.name}"?`, danger: true, confirmLabel: 'Delete' })) { await api.delete(`/tools/automations/${a.id}`); reload(); } };
  const runTest = async () => { try { const r = await api.post(`/tools/automations/${test.id}/test`, { taskKey: test.key }); toast(r.data.message, { icon: r.data.ran ? '✅' : 'ℹ️' }); setTest(null); reload(); } catch (err) { toast.error(err.message); } };

  return (
    <div>
      <PageHeader title="Automations" subtitle="When something happens to a task, Orbit does the follow-up for you."
        actions={data.canEdit && <button type="button" className="btn-primary" onClick={() => setEdit({})}><Plus size={16} />New automation</button>} />
      {data.canEdit && data.recipes?.length > 0 && <Recipes recipes={data.recipes} rules={data.rules} onAdded={reload} />}
      <h2 className="mb-3 mt-6 section-title">Your automations <span className="text-sm font-normal text-muted">{data.rules.length}</span></h2>
      {!data.rules.length ? <div className="panel"><Empty icon={Workflow} title="No automations yet" body="Add a recipe above, or build your own." /></div> : (
        <div className="grid gap-3 lg:grid-cols-2">
          {data.rules.map((a) => {
            const d = describe(a, data.triggers, data.actions, people, projects);
            return (
              <div key={a.id} className={clsx('panel p-5 transition', !a.active && 'opacity-60')}>
                <div className="flex items-start gap-3">
                  <span className={clsx('grid h-10 w-10 shrink-0 place-items-center rounded-xl', a.active ? 'bg-brand-soft text-ink' : 'bg-sunken text-muted')}><Workflow size={18} /></span>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-semibold">{a.name}</h3>
                    <p className="mt-0.5 text-xs text-muted">{a.runs ? `Ran ${a.runs} times, last ${ago(a.lastRunAt)}` : 'Has not run yet'}</p>
                  </div>
                  {data.canEdit && <span className="w-12"><Toggle checked={a.active} onChange={() => toggle(a)} /></span>}
                </div>
                <div className="mt-4 space-y-2 text-sm">
                  <p className="flex gap-2"><span className="w-11 shrink-0 font-semibold text-cobalt">When</span><span>{d.when}</span></p>
                  <p className="flex gap-2"><span className="w-11 shrink-0 font-semibold text-leaf">Then</span><span>{d.then}</span></p>
                </div>
                {data.canEdit && (
                  <div className="mt-4 flex gap-2 border-t border-line pt-3">
                    <button type="button" className="btn-ghost btn-sm" onClick={() => setEdit(a)}><Pencil size={13} />Edit</button>
                    <button type="button" className="btn-ghost btn-sm" onClick={() => setTest({ id: a.id, key: '' })}><Play size={13} />Test on a task</button>
                    <button type="button" className="btn-ghost btn-sm ml-auto text-ember" onClick={() => remove(a)} aria-label="Delete"><Trash2 size={13} /></button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      <RuleBuilder open={!!edit} rule={edit?.id ? edit : null} meta={data} onClose={() => setEdit(null)} onSaved={() => { toast.success('Automation saved'); reload(); }} />
      <Modal open={!!test} onClose={() => setTest(null)} title="Test on a task" subtitle="The actions really run, so pick a test task." width="max-w-sm"
        footer={<><button type="button" className="btn-ghost" onClick={() => setTest(null)}>Cancel</button><button type="button" className="btn-primary" onClick={runTest} disabled={!test?.key}>Run</button></>}>
        <Field label="Task key"><input className="input uppercase" value={test?.key || ''} onChange={(e) => setTest({ ...test, key: e.target.value })} placeholder="KAS-12" autoFocus /></Field>
      </Modal>
    </div>
  );
}

// ---------------- Templates ----------------
function TemplatePreview({ id }) {
  const { data } = useFetch(`/tools/templates/${id}`);
  if (!data) return <PageLoader />;
  const s = data.structure || {};
  return (
    <div className="space-y-4">
      {s.milestones?.length > 0 && <div className="flex flex-wrap gap-1.5">{s.milestones.map((m) => <span key={m.title} className="chip bg-brand-soft text-ink">◆ {m.title}, day {m.offsetDays}</span>)}</div>}
      {(s.sections?.length ? s.sections : [{ name: '' }]).map((sec) => {
        const ts = (s.tasks || []).filter((t) => (t.section || '') === sec.name);
        if (!ts.length) return null;
        return (
          <div key={sec.name}>
            {sec.name && <div className="mb-1 text-xs font-semibold text-muted">{sec.name}</div>}
            <ul className="space-y-1">{ts.map((t, i) => <li key={i} className="rounded-lg bg-sunken/60 px-3 py-1.5 text-sm"><span className="font-medium">{t.title}</span><span className="ml-2 text-xs text-faint">day {t.offsetDays ?? 0}</span>{t.subtasks?.length > 0 && <span className="ml-2 text-xs text-muted">{t.subtasks.length} subtasks</span>}</li>)}</ul>
          </div>
        );
      })}
    </div>
  );
}

const TPL_ICONS = ['📦', '📅', '📣', '🎬', '🎨', '🖥️', '🤝', '🛒', '🏥', '☀️', '🏗️', '🎯', '📸', '✍️', '🚀'];
const blankTask = (section) => ({ title: '', section: section || '', offsetDays: 0, priority: 'medium', estimateHours: '', subtasks: '' });

export function TemplateBuilder({ open, onClose, template, onSaved }) {
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) { setF(null); return; }
    const st = template?.structure || {};
    setF({
      name: template?.name || '', description: template?.description || '', category: template?.category || 'Marketing', icon: template?.icon || '📦',
      sections: (st.sections || [{ name: 'Plan' }, { name: 'Make' }, { name: 'Deliver' }]).map((x) => x.name),
      milestones: (st.milestones || []).map((m) => ({ title: m.title, offsetDays: m.offsetDays ?? 0 })),
      tasks: (st.tasks || []).length ? st.tasks.map((t) => ({ title: t.title, section: t.section || '', offsetDays: t.offsetDays ?? 0, priority: t.priority || 'medium', estimateHours: t.estimateHours || '', subtasks: (t.subtasks || []).map((x) => (typeof x === 'string' ? x : x.title)).join(', ') }))
        : [blankTask((st.sections || [{ name: 'Plan' }])[0]?.name || 'Plan')],
    });
  }, [open, template]);
  if (!open || !f) return null;
  const setT = (i, patch) => setF((x) => ({ ...x, tasks: x.tasks.map((t, j) => (j === i ? { ...t, ...patch } : t)) }));
  const moveT = (i, d) => setF((x) => { const ts = [...x.tasks]; const j = i + d; if (j < 0 || j >= ts.length) return x; [ts[i], ts[j]] = [ts[j], ts[i]]; return { ...x, tasks: ts }; });
  const save = async () => {
    const tasks = f.tasks.filter((t) => t.title.trim());
    if (!f.name.trim()) return toast.error('Name the template.');
    if (!tasks.length) return toast.error('Add at least one task.');
    const structure = {
      sections: f.sections.filter((x) => x.trim()).map((name) => ({ name: name.trim() })),
      milestones: f.milestones.filter((m) => m.title.trim()).map((m) => ({ title: m.title.trim(), offsetDays: Number(m.offsetDays) || 0 })),
      tasks: tasks.map((t) => ({ title: t.title.trim(), section: t.section || undefined, offsetDays: Number(t.offsetDays) || 0, priority: t.priority, estimateHours: Number(t.estimateHours) || undefined,
        subtasks: String(t.subtasks || '').split(',').map((x) => x.trim()).filter(Boolean).map((title) => ({ title })) })),
    };
    setBusy(true);
    try {
      const body = { name: f.name, description: f.description, category: f.category, icon: f.icon, structure };
      const { data } = template?.id ? await api.patch(`/tools/templates/${template.id}`, body) : await api.post('/tools/templates', body);
      toast.success('Template saved'); onSaved(data); onClose();
    } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };
  const days = Math.max(0, ...f.tasks.map((t) => Number(t.offsetDays) || 0), ...f.milestones.map((m) => Number(m.offsetDays) || 0));
  return (
    <Modal open onClose={onClose} title={template?.id ? 'Edit template' : 'Create a template'} subtitle="Stages, milestones and tasks. Days count from the project start date." width="max-w-4xl"
      footer={<><span className="mr-auto text-xs text-muted">{f.tasks.filter((t) => t.title.trim()).length} tasks over about {days} days</span><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button type="button" className="btn-primary" disabled={busy} onClick={save}>Save template</button></>}>
      <div className="space-y-6">
        <div className="grid gap-3 sm:grid-cols-[72px_1fr_180px]">
          <Field label="Icon"><select className="input text-center text-lg" value={f.icon} onChange={(e) => setF({ ...f, icon: e.target.value })}>{TPL_ICONS.map((i) => <option key={i}>{i}</option>)}</select></Field>
          <Field label="Name"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Monthly content retainer" autoFocus /></Field>
          <Field label="Category"><input className="input" list="tpl-cats" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} /><datalist id="tpl-cats"><option>Marketing</option><option>Design</option><option>Development</option><option>General</option></datalist></Field>
          <Field label="What it's for" className="sm:col-span-3"><input className="input" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Everything for one month of Instagram and Facebook for a client" /></Field>
        </div>
        <section>
          <h3 className="mb-2 text-sm font-semibold">Pipeline stages</h3>
          <div className="flex flex-wrap gap-2">
            {f.sections.map((sname, i) => (
              <span key={i} className="inline-flex items-center gap-1 rounded-full border border-line bg-surface py-0.5 pl-3 pr-1">
                <input className="w-28 bg-transparent text-sm outline-none" value={sname} onChange={(e) => setF((x) => ({ ...x, sections: x.sections.map((y, j) => (j === i ? e.target.value : y)), tasks: x.tasks.map((t) => (t.section === sname ? { ...t, section: e.target.value } : t)) }))} />
                <button type="button" className="rounded-full p-1 text-muted hover:text-ember" onClick={() => setF((x) => ({ ...x, sections: x.sections.filter((_, j) => j !== i) }))} aria-label="Remove stage"><X size={12} /></button>
              </span>
            ))}
            <button type="button" className="btn-ghost btn-sm" onClick={() => setF((x) => ({ ...x, sections: [...x.sections, `Stage ${x.sections.length + 1}`] }))}><Plus size={13} />Stage</button>
          </div>
        </section>
        <section>
          <h3 className="mb-2 text-sm font-semibold">Milestones</h3>
          <div className="space-y-2">
            {f.milestones.map((m, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-amber">◆</span>
                <input className="input !py-1.5" value={m.title} onChange={(e) => setF((x) => ({ ...x, milestones: x.milestones.map((y, j) => (j === i ? { ...y, title: e.target.value } : y)) }))} placeholder="Content approved" />
                <span className="shrink-0 text-xs text-muted">day</span>
                <input type="number" min="0" className="input !w-20 !py-1.5" value={m.offsetDays} onChange={(e) => setF((x) => ({ ...x, milestones: x.milestones.map((y, j) => (j === i ? { ...y, offsetDays: e.target.value } : y)) }))} />
                <button type="button" className="rounded p-1 text-muted hover:text-ember" onClick={() => setF((x) => ({ ...x, milestones: x.milestones.filter((_, j) => j !== i) }))} aria-label="Remove"><X size={14} /></button>
              </div>
            ))}
            <button type="button" className="btn-ghost btn-sm" onClick={() => setF((x) => ({ ...x, milestones: [...x.milestones, { title: '', offsetDays: days }] }))}><Plus size={13} />Milestone</button>
          </div>
        </section>
        <section>
          <h3 className="mb-2 text-sm font-semibold">Tasks</h3>
          <div className="space-y-2">
            {f.tasks.map((t, i) => (
              <div key={i} className="rounded-xl border border-line bg-surface p-2.5">
                <div className="grid gap-2 sm:grid-cols-[1fr_140px_80px_110px_auto]">
                  <input className="input !py-1.5" value={t.title} onChange={(e) => setT(i, { title: e.target.value })} placeholder="Write 30 captions" />
                  <select className="input !py-1.5" value={t.section} onChange={(e) => setT(i, { section: e.target.value })}><option value="">First stage</option>{f.sections.filter(Boolean).map((x) => <option key={x}>{x}</option>)}</select>
                  <label className="relative"><input type="number" min="0" className="input !py-1.5 pr-9" value={t.offsetDays} onChange={(e) => setT(i, { offsetDays: e.target.value })} aria-label="Due day" /><span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] text-faint">day</span></label>
                  <select className="input !py-1.5" value={t.priority} onChange={(e) => setT(i, { priority: e.target.value })}>{PRIORITY_ORDER.map((k) => <option key={k} value={k}>{PRIORITY[k].label}</option>)}</select>
                  <div className="flex items-center gap-0.5">
                    <button type="button" className="rounded p-1 text-muted hover:bg-sunken disabled:opacity-30" disabled={i === 0} onClick={() => moveT(i, -1)} aria-label="Up"><ArrowDown size={13} className="rotate-180" /></button>
                    <button type="button" className="rounded p-1 text-muted hover:bg-sunken disabled:opacity-30" disabled={i === f.tasks.length - 1} onClick={() => moveT(i, 1)} aria-label="Down"><ArrowDown size={13} /></button>
                    <button type="button" className="rounded p-1 text-muted hover:text-ember" onClick={() => setF((x) => ({ ...x, tasks: x.tasks.filter((_, j) => j !== i) }))} aria-label="Remove task"><Trash2 size={13} /></button>
                  </div>
                </div>
                <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_120px]">
                  <input className="input !py-1.5 text-xs" value={t.subtasks} onChange={(e) => setT(i, { subtasks: e.target.value })} placeholder="Subtasks, comma separated (optional)" />
                  <input type="number" min="0" step="0.5" className="input !py-1.5 text-xs" value={t.estimateHours} onChange={(e) => setT(i, { estimateHours: e.target.value })} placeholder="Hours" />
                </div>
              </div>
            ))}
            <button type="button" className="btn-ghost btn-sm" onClick={() => setF((x) => ({ ...x, tasks: [...x.tasks, blankTask(x.tasks[x.tasks.length - 1]?.section || x.sections[0])] }))}><Plus size={13} />Task</button>
          </div>
        </section>
      </div>
    </Modal>
  );
}

export function Templates() {
  const { can } = useAuth();
  const nav = useNavigate();
  const { data, reload } = useFetch('/tools/templates');
  const [cat, setCat] = useState('');
  const [view, setView] = useState(null);
  const [use, setUse] = useState(false);
  const [builder, setBuilder] = useState(null);
  const cats = useMemo(() => [...new Set((data || []).map((t) => t.category).filter(Boolean))], [data]);
  if (!data) return <PageLoader />;
  const list = data.filter((t) => !cat || t.category === cat);
  const remove = async (t) => { if (await confirm({ title: `Delete the "${t.name}" template?`, danger: true, confirmLabel: 'Delete' })) { try { await api.delete(`/tools/templates/${t.id}`); setView(null); reload(); } catch (err) { toast.error(err.message); } } };

  return (
    <div>
      <PageHeader title="Templates" subtitle="Ready-made project plans for the work you repeat. Build your own, or save any project as a template from its menu."
        actions={can('templates.manage', 'projects.manage') && <button type="button" className="btn-primary" onClick={() => setBuilder({})}><Plus size={16} />Create template</button>} />
      {cats.length > 1 && <div className="mb-5"><Segmented value={cat} onChange={setCat} options={[{ value: '', label: 'All' }, ...cats.map((c) => ({ value: c, label: c }))]} /></div>}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {list.map((t) => (
          <button key={t.id} type="button" onClick={() => setView(t)} className="panel group flex flex-col p-5 text-left transition hover:shadow-lift">
            <div className="flex items-start gap-3">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-sunken text-2xl transition group-hover:bg-brand-soft">{t.icon || '📦'}</span>
              <div className="min-w-0"><h3 className="font-semibold">{t.name}</h3><p className="text-xs text-muted">{t.isSystem ? 'Built in' : `By ${t.creator?.name || 'the team'}`}{t.uses ? `, used ${t.uses} times` : ''}</p></div>
            </div>
            <p className="mt-3 line-clamp-2 text-sm text-muted">{t.description}</p>
            <div className="mt-auto flex gap-1.5 pt-4 text-[11px]"><span className="chip bg-sunken text-muted">{t.taskCount} tasks</span><span className="chip bg-sunken text-muted">{t.sectionCount} sections</span><span className="chip bg-sunken text-muted">{t.milestoneCount} milestones</span></div>
          </button>
        ))}
      </div>
      <Modal open={!!view} onClose={() => setView(null)} title={view ? `${view.icon || ''} ${view.name}` : ''} subtitle={view?.description} width="max-w-2xl"
        footer={view && <>{can('projects.manage') && (!view.isSystem || can('settings.manage')) && <button type="button" className="btn-ghost mr-auto text-ember" onClick={() => remove(view)}><Trash2 size={14} />Delete</button>}<button type="button" className="btn-ghost" onClick={() => setView(null)}>Close</button>{can('templates.manage') && !view.isSystem && <button type="button" className="btn-ghost" onClick={async () => { const { data: full } = await api.get(`/tools/templates/${view.id}`); setBuilder(full); }}><Pencil size={14} />Edit</button>}{can('templates.manage') && <button type="button" className="btn-ghost" onClick={async () => { const { data: full } = await api.get(`/tools/templates/${view.id}`); setBuilder({ ...full, id: undefined, name: `${full.name} (copy)` }); }}><Copy size={14} />Duplicate</button>}{can('projects.manage') && <button type="button" className="btn-primary" onClick={() => setUse(true)}><LayoutTemplate size={15} />Start a project from it</button>}</>}>
        {view && <TemplatePreview id={view.id} />}
      </Modal>
      <TemplateBuilder open={!!builder} template={builder?.name !== undefined ? builder : null} onClose={() => setBuilder(null)} onSaved={() => { reload(); setView(null); }} />
      {use && view && <ProjectForm open onClose={() => setUse(false)} initialTemplateId={view.id} onSaved={(p) => { setUse(false); setView(null); nav(`/projects/${p.id}`); }} />}
    </div>
  );
}

// ---------------- Import / export ----------------
function parseCsv(text) {
  const rows = []; let row = []; let cell = ''; let q = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i += 1; } else q = false; } else cell += ch; } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; } else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i += 1; row.push(cell); rows.push(row); row = []; cell = ''; } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}
const FIELDS = ['title', 'description', 'status', 'priority', 'due', 'start', 'assignee', 'section', 'tags', 'estimate', 'parent'];
const guess = (h) => {
  const s = h.toLowerCase().replace(/[^a-z]/g, '');
  const map = { title: ['title', 'task', 'name', 'taskname', 'summary'], description: ['description', 'details', 'notes'], status: ['status', 'state'], priority: ['priority'], due: ['due', 'duedate', 'deadline', 'enddate'], start: ['start', 'startdate'], assignee: ['assignee', 'assignees', 'owner', 'assignedto'], section: ['section', 'group', 'list', 'column'], tags: ['tags', 'labels'], estimate: ['estimate', 'hours', 'estimatehours'], parent: ['parent', 'parenttask'] };
  return Object.keys(map).find((k) => map[k].includes(s)) || '';
};

export function ImportExport() {
  const { can } = useAuth();
  const projects = useProjects();
  const [csv, setCsv] = useState(null);
  const [mapping, setMapping] = useState([]);
  const [projectId, setProjectId] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [exportProject, setExportProject] = useState('');

  const onFile = async (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    const rows = parseCsv((await f.text()).replace(/^﻿/, ''));
    if (rows.length < 2) { toast.error('That file has no data rows.'); return; }
    setCsv({ name: f.name, head: rows[0], rows: rows.slice(1) }); setMapping(rows[0].map(guess)); setResult(null);
    e.target.value = '';
  };
  const run = async () => {
    if (!mapping.includes('title')) { toast.error('Map one column to Title.'); return; }
    setBusy(true);
    const rows = csv.rows.map((r) => Object.fromEntries(mapping.map((k, i) => [k, r[i]]).filter(([k]) => k)));
    try { const r = await api.post('/tools/import/tasks', { projectId: projectId || null, rows }); setResult(r.data); toast.success(`Imported ${r.data.created} tasks`); } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };
  const dl = (url, name) => download(url, name).catch((e) => toast.error(e.message));
  const stamp = new Date().toISOString().slice(0, 10);

  return (
    <div>
      <PageHeader title="Import and export" subtitle="Bring tasks in from a spreadsheet, Asana, Trello or ClickUp CSV. Take your data out any time." />
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Panel title="Import tasks from CSV" icon={Upload}>
          {!csv ? (
            <label className="grid cursor-pointer place-items-center rounded-2xl border-2 border-dashed border-line px-6 py-14 text-center transition hover:border-muted hover:bg-sunken/40">
              <FileSpreadsheet size={28} className="text-muted" />
              <p className="mt-3 font-semibold">Choose a .csv file</p>
              <p className="mt-1 max-w-sm text-sm text-muted">First row is the header. Columns we understand: title, description, status, priority, due, start, assignee (name or email), section, tags, estimate, parent.</p>
              <input type="file" accept=".csv,text/csv" className="hidden" onChange={onFile} />
            </label>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2 text-sm"><FileSpreadsheet size={16} className="text-muted" /><span className="font-semibold">{csv.name}</span><span className="text-muted">{csv.rows.length} rows</span><button type="button" className="btn-ghost btn-sm ml-auto" onClick={() => { setCsv(null); setResult(null); }}>Choose another</button></div>
              <Field label="Into project"><select className="input sm:w-80" value={projectId} onChange={(e) => setProjectId(e.target.value)}><option value="" disabled>Pick a project</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.code} {p.name}</option>)}</select></Field>
              <div className="overflow-x-auto rounded-xl border border-line">
                <table className="w-full text-sm">
                  <thead className="bg-sunken/60"><tr>{csv.head.map((h, i) => (
                    <th key={i} className="min-w-[140px] p-2 text-left align-top">
                      <div className="mb-1 truncate text-xs font-semibold text-muted">{h || `Column ${i + 1}`}</div>
                      <select className="input !py-1 text-xs" value={mapping[i]} onChange={(e) => setMapping((m) => m.map((x, j) => (j === i ? e.target.value : x)))}><option value="">Skip</option>{FIELDS.map((f) => <option key={f} value={f}>{f}</option>)}</select>
                    </th>
                  ))}</tr></thead>
                  <tbody>{csv.rows.slice(0, 5).map((r, i) => <tr key={i} className="border-t border-line">{csv.head.map((_, j) => <td key={j} className={clsx('max-w-[200px] truncate p-2', !mapping[j] && 'text-faint')}>{r[j]}</td>)}</tr>)}</tbody>
                </table>
              </div>
              {csv.rows.length > 5 && <p className="text-xs text-muted">Showing 5 of {csv.rows.length} rows.</p>}
              <button type="button" className="btn-primary" onClick={run} disabled={busy || !projectId || !can("tasks.create")}>{busy ? <Spinner size={14} className="text-ink" /> : <Upload size={15} />}Import {csv.rows.length} tasks</button>
              {result && (
                <div className={clsx('rounded-xl p-3 text-sm', result.errors.length ? 'bg-amber/10' : 'bg-leaf/10')}>
                  <p className="flex items-center gap-2 font-semibold"><Check size={15} />{result.created} tasks created</p>
                  {result.errors.length > 0 && <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-muted">{result.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>}
                </div>
              )}
            </div>
          )}
        </Panel>
        <div className="space-y-5">
          <Panel title="Export" icon={Download}>
            <div className="space-y-3">
              <div className="flex gap-2"><select className="input" value={exportProject} onChange={(e) => setExportProject(e.target.value)}><option value="">All projects</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.code} {p.name}</option>)}</select>
                <button type="button" className="btn-ghost shrink-0" onClick={() => dl(`/tools/export/tasks.csv${exportProject ? `?projectId=${exportProject}` : ''}`, `orbit-tasks-${stamp}.csv`)}>Tasks CSV</button></div>
              <button type="button" className="btn-ghost w-full" onClick={() => dl('/tools/export/projects.csv', `orbit-projects-${stamp}.csv`)}><FileSpreadsheet size={15} />Projects CSV</button>
              <p className="text-xs text-muted">CSV files open in Excel and Google Sheets.</p>
            </div>
          </Panel>
          {can('settings.manage') && (
            <Panel title="Full backup" icon={Database}>
              <p className="mb-3 text-sm text-muted">Every project, task, client, doc and setting as one JSON file. Passwords are left out.</p>
              <button type="button" className="btn-ink" onClick={() => dl('/tools/export/backup.json', `orbit-backup-${stamp}.json`)}><Download size={15} />Download backup</button>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}
