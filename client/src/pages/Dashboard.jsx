import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import {
  FolderKanban, ListTodo, Gauge, AlarmClock, Sparkles, RefreshCw, ShieldCheck, Target, AlertTriangle, Video, Copy, Trophy, Plus, Wand2, Users,
  CalendarDays, Inbox, Mic,
} from 'lucide-react';
import api from '../lib/api';
import useFetch from '../lib/useFetch';
import { useAuth, useLive } from '../context/AuthContext';
import { useAiStatus } from '../lib/directory';
import { Avatar, AvatarStack, DueBadge, PriorityFlag, StatusPill, Empty, Bar, Panel, Stat, Spinner, HealthBadge, PageLoader } from '../components/ui';
import { VelocityChart, StatusDonut, PriorityBars, BurndownChart } from '../components/Charts';
import OrbitHero from '../components/OrbitHero';
import { useComposer, useAskAi, useOpenTask } from '../components/Layout';
import { ago, fmtTime, STATUS } from '../lib/format';

export function ActivityFeed({ items, compact }) {
  return (
    <ol className="relative space-y-3.5 border-l-2 border-line pl-5">
      {items.map((a) => (
        <li key={a.id} className="relative">
          <span className="absolute -left-[27px] top-0.5"><Avatar user={a.actor} size={16} /></span>
          <p className="text-sm leading-snug"><span className="font-semibold">{a.actor?.name || 'Someone'}</span> <span className="text-muted">{a.summary}</span></p>
          {!compact && <p className="mt-0.5 flex items-center gap-2 text-[11px] text-faint">{ago(a.createdAt)}{a.Project && <span className="inline-flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full" style={{ background: a.Project.color }} />{a.Project.name}</span>}</p>}
        </li>
      ))}
    </ol>
  );
}

function AiBrief() {
  const { data, loading, reload, setData } = useFetch('/ai/brief');
  const ai = useAiStatus();
  const [busy, setBusy] = useState(false);
  const refresh = async () => { setBusy(true); try { setData((await api.get('/ai/brief?refresh=1')).data); } catch (e) { toast.error(e.message); } finally { setBusy(false); } };
  void reload;
  return (
    <Panel title="AI brief" icon={Sparkles} subtitle={data ? `${data.source === 'gemini' ? 'Gemini' : 'Rule-based'}, ${ago(data.at)}` : ' '}
      action={<button type="button" onClick={refresh} className="rounded-lg p-1.5 text-muted hover:bg-sunken" aria-label="Refresh brief" disabled={busy}>{busy ? <Spinner size={15} /> : <RefreshCw size={15} />}</button>}>
      {loading || !data ? <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-4 animate-pulse rounded bg-sunken" />)}</div> : (
        <div className="space-y-3">
          <p className="text-[15px] font-medium leading-snug">{data.summary}</p>
          <ul className="space-y-1.5 text-sm text-muted">{(data.highlights || []).slice(1, 4).map((h, i) => <li key={i} className="flex gap-2"><span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-faint" />{h}</li>)}</ul>
          <div className="rounded-xl bg-brand-soft/60 p-3">
            <div className="mb-1.5 text-xs font-semibold">Do next</div>
            <ul className="space-y-1.5 text-sm">{(data.recommendations || []).slice(0, 3).map((r, i) => <li key={i} className="flex gap-2"><span className="font-display font-semibold text-amber">{i + 1}</span>{r}</li>)}</ul>
          </div>
          {!ai.ready && <p className="text-[11px] text-faint">Add a Gemini key in Settings for a written brief.</p>}
        </div>
      )}
    </Panel>
  );
}

function Standup() {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const run = async () => { setBusy(true); try { setData((await api.post('/ai/standup', {})).data); } catch (e) { toast.error(e.message); } finally { setBusy(false); } };
  return (
    <Panel title="Daily stand-up" icon={Mic} subtitle="Your update, written from your tasks"
      action={<button type="button" className="btn-ai btn-sm" onClick={run} disabled={busy}>{busy ? <Spinner size={13} className="text-violet" /> : <Wand2 size={13} />}{data ? 'Regenerate' : 'Write it'}</button>}>
      {!data ? <p className="py-6 text-center text-sm text-muted">One click turns yesterday's finished work and today's plan into a stand-up you can paste into WhatsApp.</p> : (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            {[['Done', data.yesterday, 'text-leaf'], ['Today', data.today, 'text-cobalt'], ['Blockers', data.blockers, 'text-ember']].map(([t, list, c]) => (
              <div key={t}><div className={clsx('mb-1 text-xs font-semibold', c)}>{t}</div><ul className="space-y-1 text-sm">{(list?.length ? list : ['None']).map((x, i) => <li key={i} className="text-muted">{x}</li>)}</ul></div>
            ))}
          </div>
          <button type="button" className="btn-ghost btn-sm" onClick={() => { navigator.clipboard?.writeText(data.text); toast.success('Copied for WhatsApp'); }}><Copy size={13} />Copy for WhatsApp</button>
        </div>
      )}
    </Panel>
  );
}

const SEV = { critical: { color: '#E5484D', label: 'Critical' }, warning: { color: '#F08C00', label: 'Warning' }, info: { color: '#3D5AFE', label: 'Info' } };

export default function Dashboard() {
  const { user, can } = useAuth();
  const { data, loading, reload } = useFetch('/dashboard');
  const nav = useNavigate();
  const compose = useComposer();
  const askAi = useAskAi();
  const openTask = useOpenTask();
  useLive(['task:changed', 'project:changed'], reload);
  if (loading || !data) return <PageLoader />;
  const { personal: me, kpis, focus } = data;
  const team = data.scope === 'team';
  const listUrl = (q) => `${team ? '/board' : '/my-tasks'}?${team ? '' : 'tab=assigned&'}${q}`;
  const summary = me.overdue ? `${me.overdue} of your tasks ${me.overdue === 1 ? 'is' : 'are'} overdue and ${me.dueToday} due today.` : me.dueToday ? `${me.dueToday} ${me.dueToday === 1 ? 'task is' : 'tasks are'} due today. Nothing overdue.` : 'Nothing overdue. A clear runway today.';

  return (
    <div className="space-y-5">
      <OrbitHero user={user} hero={data.hero} projects={data.health} summary={summary} />

      <section className="panel grid grid-cols-2 divide-line overflow-hidden lg:grid-cols-4 lg:divide-x [&>*]:border-line max-lg:[&>*:nth-child(odd)]:border-r max-lg:[&>*:nth-child(-n+2)]:border-b">
        <Stat icon={FolderKanban} tone="#3D5AFE" label="Active projects" value={kpis.activeProjects} hint={`${kpis.totalProjects} in flight, ${kpis.newProjects} new this month`} onClick={() => nav('/projects')} />
        <Stat icon={ListTodo} tone="#8B5CF6" label={team ? 'Total tasks' : 'Tasks you can see'} value={kpis.totalTasks} hint={`${kpis.inProgress} in progress`} onClick={() => nav(team ? '/board' : '/my-tasks?tab=assigned')} />
        <Stat icon={Gauge} tone="#1FA971" label="Completion rate" value={`${kpis.completionRate}%`} hint={`${kpis.done} done`} onClick={() => nav(listUrl('status=done&showDone=1'))} />
        <Stat icon={AlarmClock} tone="#E5484D" label="Overdue" value={kpis.overdue} hint={kpis.overdueUrgent ? `${kpis.overdueUrgent} urgent` : 'needs attention'} onClick={() => nav(listUrl('due=overdue'))} />
      </section>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <Panel className="xl:col-span-2" title="14-day velocity" subtitle={data.velocityFlag || 'Tasks created and completed each day'}
          action={data.velocityFlag && <span className={clsx('chip', data.velocityFlag.startsWith('Adding') ? 'bg-ember/10 text-ember' : 'bg-leaf/10 text-leaf')}>{data.velocityFlag.startsWith('Adding') ? 'Backlog growing' : 'Backlog shrinking'}</span>}>
          <VelocityChart data={data.velocity} />
        </Panel>
        <Panel title="Status mix" action={<Link to="/my-tasks" className="link text-xs">View tasks</Link>}><StatusDonut data={data.statusMix} onSelect={(st) => nav(listUrl(`status=${st}`))} /></Panel>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Panel title="Today's focus" icon={Target}>
          {focus ? (
            <div>
              <span className={clsx('chip', focus.kind === 'overdue' ? 'bg-ember/10 text-ember' : focus.kind === 'today' ? 'bg-amber/10 text-amber' : 'bg-cobalt/10 text-cobalt')}>{focus.kind === 'overdue' ? 'Overdue' : focus.kind === 'today' ? 'Due today' : 'Up next'}</span>
              <button type="button" onClick={() => openTask(focus.task.id)} className="mt-2 block text-left font-display text-lg font-semibold leading-snug hover:underline">{focus.task.title}</button>
              <p className="mt-1 text-xs text-muted">{focus.task.key}{focus.task.Project ? `, ${focus.task.Project.name}` : ''}</p>
              <p className="mt-3 text-sm text-muted">{focus.reason}</p>
              <div className="mt-4 flex items-center justify-between"><DueBadge date={focus.task.dueDate} /><button type="button" className="btn-ink btn-sm" onClick={() => openTask(focus.task.id)}>Open task</button></div>
            </div>
          ) : <Empty compact icon={Trophy} title="Nothing assigned to you" body="Enjoy it, or pick something from the backlog." />}
        </Panel>
        <AiBrief />
        <Panel title="Risks" icon={AlertTriangle} subtitle={`${data.risks.length} things to watch`} action={<Link to="/ai/health" className="link text-xs">Project health</Link>}>
          {data.risks.length ? (
            <ul className="space-y-2.5">
              {data.risks.slice(0, 4).map((r, i) => (
                <li key={i} className="rounded-xl border border-line p-3">
                  <div className="flex items-start gap-2"><span className="chip shrink-0" style={{ color: SEV[r.severity].color, background: `${SEV[r.severity].color}17` }}>{SEV[r.severity].label}</span></div>
                  <p className="mt-1.5 text-sm font-medium leading-snug">{r.title}</p>
                  <p className="text-xs text-muted">{r.detail}</p>
                </li>
              ))}
            </ul>
          ) : <Empty compact icon={ShieldCheck} title="No risks spotted" body="Projects are moving on schedule." />}
        </Panel>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Your queue" subtitle={`${me.open} open, ${me.dueToday} due today`} action={<Link to="/my-tasks" className="link text-xs">All my tasks</Link>} bodyClass="!px-2">
          {me.tasks.length ? (
            <ul>
              {me.tasks.map((t) => (
                <li key={t.id}>
                  <button type="button" onClick={() => openTask(t.id)} className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition hover:bg-sunken/70">
                    <span className="h-8 w-1 shrink-0 rounded-full" style={{ background: STATUS[t.status]?.color }} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{t.title}</span>
                      <span className="mt-0.5 flex items-center gap-3 text-xs text-faint"><span>{t.key}</span>{t.Project && <span className="truncate">{t.Project.name}</span>}<DueBadge date={t.dueDate} compact /></span>
                    </span>
                    <PriorityFlag priority={t.priority} />
                    <span className="hidden sm:block"><StatusPill status={t.status} small /></span>
                  </button>
                </li>
              ))}
            </ul>
          ) : <Empty compact icon={Trophy} title="Your queue is clear" body="New assignments land here and on WhatsApp." />}
        </Panel>
        <div className="space-y-5">
          <Panel title="Waiting for your approval" icon={ShieldCheck}>
            {me.approvals.length ? (
              <ul className="space-y-2">
                {me.approvals.map((t) => (
                  <li key={t.id}><button type="button" onClick={() => openTask(t.id)} className="flex w-full items-center gap-3 rounded-xl border border-line p-3 text-left hover:border-violet/40 hover:bg-violet/5">
                    <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{t.title}</span><span className="text-xs text-muted">{t.key}, by {t.assignees.map((a) => a.name.split(' ')[0]).join(', ') || 'someone'}</span></span>
                    <AvatarStack users={t.assignees} size={22} />
                  </button></li>
                ))}
              </ul>
            ) : <p className="py-3 text-sm text-muted">No reviews pending.</p>}
          </Panel>
          <Panel title="Meetings today" icon={Video} action={<Link to="/meetings" className="link text-xs">Calendar</Link>}>
            {me.meetings.length ? (
              <ul className="space-y-2">
                {me.meetings.map((m) => (
                  <li key={m.id} className="flex items-center gap-3 rounded-xl border border-line p-3">
                    <div className="w-16 shrink-0 text-xs font-semibold text-muted">{fmtTime(m.startAt)}</div>
                    <div className="min-w-0 flex-1 truncate text-sm font-medium">{m.title}</div>
                    {m.link && <a href={m.link} target="_blank" rel="noreferrer" className="btn-primary btn-sm">Join</a>}
                  </li>
                ))}
              </ul>
            ) : <p className="py-3 text-sm text-muted">No meetings today.</p>}
          </Panel>
        </div>
      </div>

      {team && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Panel title="Team pulse" icon={Users} subtitle={`${data.pulse.length} people, by open tasks`} action={<Link to="/workload" className="link text-xs">Workload</Link>}>
            <div className="grid gap-2 sm:grid-cols-2">
              {data.pulse.slice(0, 8).map((p) => (
                <Link key={p.id} to={`/team/${p.id}`} className="flex items-center gap-3 rounded-xl border border-line p-2.5 hover:bg-sunken/60">
                  <Avatar user={p} size={34} />
                  <div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold">{p.name}</div><div className="text-xs text-muted">{p.open} open{p.overdue ? <span className="text-ember">, {p.overdue} late</span> : ''}</div></div>
                  <span className={clsx('chip', p.load === 'high' ? 'bg-ember/10 text-ember' : p.load === 'medium' ? 'bg-amber/10 text-amber' : 'bg-leaf/10 text-leaf')}>{p.load === 'high' ? 'Heavy' : p.load === 'medium' ? 'Busy' : 'Light'}</span>
                </Link>
              ))}
            </div>
          </Panel>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
            <Panel title="Priority split" subtitle="Open work"><PriorityBars data={data.prioritySplit} onSelect={(pr) => nav(listUrl(`priority=${pr}`))} /></Panel>
            <Panel title="Burndown" subtitle="Open tasks over 14 days"><BurndownChart data={data.burndown} height={170} /></Panel>
          </div>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Project roadmap" icon={CalendarDays} subtitle="Sorted by deadline" action={<Link to="/projects" className="link text-xs">All projects</Link>}>
          {data.roadmap.length ? (
            <ul className="space-y-3">
              {data.roadmap.map((p) => (
                <li key={p.id}>
                  <Link to={`/projects/${p.id}`} className="block rounded-xl p-2 hover:bg-sunken/60">
                    <div className="flex items-center gap-2"><span className="text-base">{p.icon || '●'}</span><span className="min-w-0 flex-1 truncate text-sm font-semibold">{p.name}</span>
                      <span className={clsx('text-xs font-semibold', p.daysLeft < 0 ? 'text-ember' : p.daysLeft <= 7 ? 'text-amber' : 'text-muted')}>{p.daysLeft < 0 ? `${-p.daysLeft}d late` : `${p.daysLeft}d left`}</span>
                      <HealthBadge state={p.state} />
                    </div>
                    <div className="mt-2 flex items-center gap-3"><Bar value={p.progress} color={p.color} height={5} /><span className="w-9 text-right text-xs text-muted">{p.progress}%</span></div>
                  </Link>
                </li>
              ))}
            </ul>
          ) : <p className="py-3 text-sm text-muted">No deadlines set on projects yet.</p>}
        </Panel>
        <Standup />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Panel className="lg:col-span-2" title={can('activity.view') ? 'Recent activity' : 'Your recent activity'} action={<Link to="/activity" className="link text-xs">See all</Link>}><ActivityFeed items={data.activity.slice(0, 10)} /></Panel>
        <div className="space-y-5">
          <Panel title="Quick actions">
            <div className="grid grid-cols-2 gap-2">
              {[
                { icon: Plus, label: 'New task', run: () => compose() },
                { icon: Sparkles, label: 'Ask Orbit', run: () => askAi() },
                { icon: FolderKanban, label: 'Projects', run: () => nav('/projects') },
                { icon: Inbox, label: 'Requests', run: () => nav('/requests') },
              ].map((q) => <button key={q.label} type="button" onClick={q.run} className="flex flex-col items-start gap-2 rounded-xl border border-line p-3 text-left text-sm font-semibold hover:bg-sunken/60"><q.icon size={18} className="text-muted" />{q.label}</button>)}
            </div>
          </Panel>
          <Panel title="Wins today" icon={Trophy}>
            {data.wins.length ? <ul className="space-y-2">{data.wins.map((w) => <li key={w.id} className="flex items-center gap-2 text-sm"><span className="text-leaf">✓</span><button type="button" className="min-w-0 flex-1 truncate text-left hover:underline" onClick={() => openTask(w.id)}>{w.title}</button><AvatarStack users={w.assignees} size={20} emptyLabel="" /></li>)}</ul>
              : <p className="text-sm text-muted">Nothing closed yet today.</p>}
          </Panel>
        </div>
      </div>
    </div>
  );
}
