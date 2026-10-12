import { useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import { format, startOfWeek, subDays } from 'date-fns';
import { Sparkles, FileBarChart, Copy, Download, Trash2, Wand2, HeartPulse, RefreshCw, AlertTriangle, ArrowLeft, Settings2 } from 'lucide-react';
import api from '../lib/api';
import useFetch from '../lib/useFetch';
import { useAuth } from '../context/AuthContext';
import { useDirectory, useProjects, useAiStatus } from '../lib/directory';
import { PageHeader, Panel, Field, UserPicker, Markdown, PageLoader, Empty, Spinner, HealthBadge, Bar, Segmented, confirm } from '../components/ui';
import { AssistantChat } from '../components/AiPanel';
import { useAskAi } from '../components/Layout';
import { ago, fmtDate, HEALTH } from '../lib/format';

function AiBadge() {
  const ai = useAiStatus();
  return <span className={clsx('chip', ai.ready ? 'bg-leaf/10 text-leaf' : 'bg-sunken text-muted')}><span className={clsx('h-1.5 w-1.5 rounded-full', ai.ready ? 'bg-leaf' : 'bg-faint')} />{ai.ready ? `Gemini connected${ai.model ? `, ${ai.model}` : ''}` : 'Gemini not connected'}</span>;
}

// ---------------- Ask Orbit ----------------
export function AskOrbit() {
  const projects = useProjects();
  const [projectId, setProjectId] = useState('');
  return (
    <div className="mx-auto flex h-[calc(100dvh-140px)] max-w-4xl flex-col">
      <PageHeader title="Ask Orbit" subtitle="Your AI teammate. It reads tasks, projects, people and deadlines you can see, and can create or update tasks when you say so.">
        <div className="mt-3 flex flex-wrap items-center gap-2"><AiBadge />
          <select className="input !w-auto !py-1 text-xs" value={projectId} onChange={(e) => setProjectId(e.target.value)} aria-label="Focus on a project"><option value="">All projects</option>{projects.map((p) => <option key={p.id} value={p.id}>Focus: {p.name}</option>)}</select>
        </div>
      </PageHeader>
      <div className="flex min-h-0 flex-1 flex-col"><AssistantChat projectId={projectId || undefined} /></div>
    </div>
  );
}

// ---------------- Reports ----------------
const TYPES = [
  { value: 'weekly', label: 'Weekly summary', hint: 'What shipped, what slipped, what is next' },
  { value: 'client', label: 'Client update', hint: 'Friendly progress note to send a client' },
  { value: 'team', label: 'Team performance', hint: 'Output, on-time rate and load per person' },
  { value: 'daily', label: 'Daily stand-up', hint: "Yesterday's done and today's plan" },
  { value: 'sprint', label: 'Sprint retro', hint: 'What went well and what to change' },
  { value: 'custom', label: 'Custom', hint: 'Tell it what you need' },
];
const SECTIONS = ['Highlights', 'Completed work', 'In progress', 'Risks and blockers', 'Overdue tasks', 'Upcoming deadlines', 'Team workload', 'Next steps'];

function ReportView({ id, onBack, onDeleted }) {
  const { data } = useFetch(`/ai/reports/${id}`);
  if (!data) return <PageLoader />;
  const copy = () => { navigator.clipboard?.writeText(data.markdown); toast.success('Copied as markdown'); };
  const save = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([data.markdown], { type: 'text/markdown' })); a.download = `${data.title.replace(/[^\w]+/g, '-').toLowerCase()}.md`; a.click(); };
  const remove = async () => { if (await confirm({ title: 'Delete this report?', danger: true, confirmLabel: 'Delete' })) { await api.delete(`/ai/reports/${id}`); onDeleted(); } };
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button type="button" className="btn-ghost btn-sm" onClick={onBack}><ArrowLeft size={14} />All reports</button>
        <span className="text-xs text-muted">{data.source === 'gemini' ? 'Written by Gemini' : 'Rule-based draft'}, {ago(data.createdAt)}</span>
        <div className="ml-auto flex gap-2">
          <button type="button" className="btn-ghost btn-sm" onClick={copy}><Copy size={13} />Copy</button>
          <button type="button" className="btn-ghost btn-sm" onClick={save}><Download size={13} />Download .md</button>
          <button type="button" className="btn-ghost btn-sm" onClick={() => window.print()}>Print or PDF</button>
          <button type="button" className="btn-ghost btn-sm text-ember" onClick={remove} aria-label="Delete"><Trash2 size={13} /></button>
        </div>
      </div>
      {data.totals && (
        <div className="panel mb-4 grid grid-cols-2 sm:grid-cols-4 sm:divide-x sm:divide-line">
          {[['Completed', data.totals.completed], ['Created', data.totals.created], ['Overdue', data.totals.overdue], ['Hours logged', data.totals.hoursLogged]].map(([l, v]) => v != null && <div key={l} className="px-5 py-3"><div className="text-xs text-muted">{l}</div><div className="font-display text-2xl font-semibold">{v}</div></div>)}
        </div>
      )}
      <article className="panel px-6 py-8 sm:px-12"><Markdown className="mx-auto max-w-3xl !text-[15px]">{data.markdown}</Markdown></article>
    </div>
  );
}

export function Reports() {
  const people = useDirectory();
  const projects = useProjects();
  const ai = useAiStatus();
  const { data: list, reload } = useFetch('/ai/reports');
  const [view, setView] = useState(null);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ type: 'weekly', from: format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd'), to: format(new Date(), 'yyyy-MM-dd'), projectIds: [], userIds: [], sections: [], instructions: '' });
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const range = (days) => setF((s) => ({ ...s, from: format(subDays(new Date(), days - 1), 'yyyy-MM-dd'), to: format(new Date(), 'yyyy-MM-dd') }));
  const run = async () => {
    setBusy(true);
    try { const r = await api.post('/ai/report', f); await reload(); setView(r.data.id); } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };
  if (view) return <ReportView id={view} onBack={() => setView(null)} onDeleted={() => { setView(null); reload(); }} />;

  return (
    <div>
      <PageHeader title="AI reports" subtitle="Pick a period and a scope. Orbit pulls the numbers and Gemini writes it up."><div className="mt-3"><AiBadge /></div></PageHeader>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Panel title="New report" icon={FileBarChart}>
          <div className="space-y-5">
            <div className="grid gap-2 sm:grid-cols-3">
              {TYPES.map((t) => (
                <button key={t.value} type="button" onClick={() => set('type', t.value)} className={clsx('rounded-xl border p-3 text-left transition', f.type === t.value ? 'border-ink bg-brand-soft/40' : 'border-line hover:border-muted')}>
                  <div className="text-sm font-semibold">{t.label}</div><div className="mt-0.5 text-xs text-muted">{t.hint}</div>
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <Field label="From"><input type="date" className="input" value={f.from} onChange={(e) => set('from', e.target.value)} /></Field>
              <Field label="To"><input type="date" className="input" value={f.to} onChange={(e) => set('to', e.target.value)} /></Field>
              <div className="flex gap-1 pb-0.5">{[[1, 'Today'], [7, '7 days'], [30, '30 days']].map(([d, l]) => <button key={d} type="button" className="btn-ghost btn-sm" onClick={() => range(d)}>{l}</button>)}</div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Projects" hint="Leave empty for all"><select multiple className="input h-28" value={f.projectIds.map(String)} onChange={(e) => set('projectIds', [...e.target.selectedOptions].map((o) => Number(o.value)))}>{projects.map((p) => <option key={p.id} value={p.id}>{p.code} {p.name}</option>)}</select></Field>
              <Field label="People" hint="Leave empty for everyone"><UserPicker users={people} value={f.userIds} onChange={(v) => set('userIds', v)} placeholder="Everyone" /></Field>
            </div>
            <Field label="Sections">
              <div className="flex flex-wrap gap-1.5">{SECTIONS.map((s) => { const on = f.sections.includes(s); return <button key={s} type="button" onClick={() => set('sections', on ? f.sections.filter((x) => x !== s) : [...f.sections, s])} className={clsx('rounded-full border px-3 py-1 text-xs font-semibold transition', on ? 'border-ink bg-ink text-surface' : 'border-line text-muted hover:text-ink')}>{s}</button>; })}</div>
            </Field>
            <Field label="Anything else"><textarea className="input" rows={2} value={f.instructions} onChange={(e) => set('instructions', e.target.value)} placeholder="Keep it under one page. Mention the Diwali launch numbers." /></Field>
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" className="btn-primary" onClick={run} disabled={busy}>{busy ? <Spinner size={14} className="text-ink" /> : <Wand2 size={15} />}{busy ? 'Writing the report' : 'Generate report'}</button>
              {!ai.ready && <span className="text-xs text-muted">Without a Gemini key you get a rule-based draft.</span>}
            </div>
          </div>
        </Panel>
        <Panel title="Saved reports">
          {!list ? <PageLoader /> : !list.length ? <p className="py-6 text-center text-sm text-muted">Reports you generate are kept here.</p> : (
            <ul className="-mx-2 space-y-0.5">
              {list.map((r) => (
                <li key={r.id}><button type="button" onClick={() => setView(r.id)} className="w-full rounded-xl px-2 py-2 text-left hover:bg-sunken">
                  <span className="block truncate text-sm font-medium">{r.title}</span>
                  <span className="block text-xs text-muted">{r.period ? `${fmtDate(r.period.from, 'd MMM')} to ${fmtDate(r.period.to, 'd MMM')}, ` : ''}{ago(r.createdAt)}{r.source === 'gemini' && <Sparkles size={10} className="ml-1 inline text-violet" />}</span>
                </button></li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}

// ---------------- Health ----------------
const SEV = { critical: '#E5484D', warning: '#C76A00', info: '#3D5AFE' };

export function Health() {
  const { can } = useAuth();
  const ai = useAiStatus();
  const ask = useAskAi();
  const [refresh, setRefresh] = useState(0);
  const { data, loading } = useFetch(`/ai/health?narrative=1${refresh ? '&refresh=1' : ''}`, [refresh]);
  const [sev, setSev] = useState('');
  if (!data) return <PageLoader />;
  const alerts = data.alerts.filter((a) => !sev || a.severity === sev);
  const by = (s) => data.projects.filter((p) => p.state === s).length;

  return (
    <div>
      <PageHeader title="Project health" subtitle="Every running project scored on schedule, overdue work, blockers, activity and budget." actions={<AiBadge />} />
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-5">
          <section className="relative overflow-hidden rounded-3xl bg-night p-6 text-white">
            <div className="flex flex-wrap items-start gap-6">
              {['on_track', 'at_risk', 'off_track'].map((s) => <div key={s}><div className="font-display text-5xl font-semibold leading-none" style={{ color: s === 'on_track' ? '#4ADE80' : s === 'at_risk' ? '#FFC21A' : '#FF7A7E' }}>{by(s)}</div><div className="mt-1 text-sm text-white/70">{HEALTH[s].label}</div></div>)}
              <button type="button" className="ml-auto rounded-lg p-2 text-white/60 hover:bg-white/10" onClick={() => setRefresh((n) => n + 1)} aria-label="Refresh" disabled={loading}>{loading ? <Spinner size={16} className="text-white" /> : <RefreshCw size={16} />}</button>
            </div>
            {data.narrative?.summary ? (
              <div className="mt-6 border-t border-white/10 pt-5">
                <p className="flex items-center gap-2 text-xs font-semibold text-brand"><Sparkles size={13} />Gemini read-out</p>
                <p className="mt-2 text-[15px] leading-relaxed text-white/90">{data.narrative.summary}</p>
                <ol className="mt-3 space-y-1.5 text-sm text-white/80">{(data.narrative.actions || []).map((a, i) => <li key={i} className="flex gap-2"><span className="font-display font-semibold text-brand">{i + 1}</span>{a}</li>)}</ol>
              </div>
            ) : (
              <p className="mt-6 border-t border-white/10 pt-5 text-sm text-white/60">{data.narrative?.error || (ai.ready ? 'No read-out yet.' : 'Connect Gemini in Settings for a written read-out and next actions.')}{!ai.ready && can('settings.manage') && <Link to="/settings?tab=ai" className="ml-2 inline-flex items-center gap-1 font-semibold text-brand"><Settings2 size={13} />Set up</Link>}</p>
            )}
          </section>

          <div className="grid gap-3 md:grid-cols-2">
            {data.projects.sort((a, b) => a.score - b.score).map((p) => (
              <Link key={p.id} to={`/projects/${p.id}`} className="panel p-4 transition hover:shadow-lift">
                <div className="flex items-center gap-3">
                  <span className="grid h-9 w-9 place-items-center rounded-xl text-lg" style={{ background: `${p.color}1F` }}>{p.icon || '📁'}</span>
                  <div className="min-w-0 flex-1"><p className="truncate font-semibold">{p.name}</p><p className="text-xs text-muted">{p.daysLeft == null ? 'No deadline' : p.daysLeft < 0 ? `${-p.daysLeft} days late` : `${p.daysLeft} days left`}{p.overdue ? `, ${p.overdue} overdue` : ''}</p></div>
                  <div className="text-right"><div className="font-display text-2xl font-semibold leading-none" style={{ color: HEALTH[p.state]?.color }}>{p.score}</div><HealthBadge state={p.state} /></div>
                </div>
                <div className="mt-3 space-y-1">
                  <div className="flex justify-between text-[11px] text-muted"><span>Done {p.progress}%</span>{p.expected != null && <span>Plan {p.expected}%</span>}</div>
                  <div className="relative"><Bar value={p.progress} color={p.color} height={6} />{p.expected != null && <span className="absolute top-[-2px] h-[10px] w-0.5 rounded bg-ink" style={{ left: `${p.expected}%` }} title={`Expected ${p.expected}%`} />}</div>
                </div>
              </Link>
            ))}
            {!data.projects.length && <div className="panel md:col-span-2"><Empty icon={HeartPulse} title="No running projects" /></div>}
          </div>
        </div>

        <Panel title="Alerts" icon={AlertTriangle} subtitle={`${data.alerts.length} things to look at`} action={<Segmented size="sm" value={sev} onChange={setSev} options={[{ value: '', label: 'All' }, { value: 'critical', label: 'Critical' }, { value: 'warning', label: 'Warning' }]} />}>
          {!alerts.length ? <p className="py-6 text-center text-sm text-muted">Nothing flagged. Nice.</p> : (
            <ul className="space-y-2.5">
              {alerts.map((a, i) => (
                <li key={i} className="rounded-xl border border-line p-3">
                  <div className="flex gap-2.5"><span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: SEV[a.severity] }} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold">{a.title}</p>
                      <p className="mt-0.5 text-xs text-muted">{a.detail}</p>
                      <p className="mt-1 text-xs">{a.suggestion}</p>
                      <div className="mt-2 flex gap-2">
                        {a.projectId && <Link to={`/projects/${a.projectId}`} className="link text-xs">Open project</Link>}
                        <button type="button" className="text-xs font-semibold text-violet hover:underline" onClick={() => ask(`${a.title}. ${a.detail} What exactly should we do about it this week?`)}>Ask Orbit</button>
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
