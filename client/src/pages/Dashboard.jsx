import { Link, useNavigate } from 'react-router-dom';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { CheckSquare, AlarmClock, Flame, Trophy, Timer, ShieldCheck, Inbox, Eye } from 'lucide-react';
import { format } from 'date-fns';
import useFetch from '../lib/useFetch';
import { useAuth, useLive } from '../context/AuthContext';
import { OrbitRing, StatTile, PageLoader, Avatar, AvatarStack, DueBadge, StatusPill, PriorityFlag, Empty, Bar } from '../components/ui';
import { minutes, ago, STATUS } from '../lib/format';

const STATE = { on_track: { label: 'On track', color: '#5BE3A6' }, at_risk: { label: 'At risk', color: '#FFB648' }, behind: { label: 'Behind', color: '#FF7A90' } };

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

function ActivityFeed({ items }) {
  return (
    <ol className="relative space-y-4 border-l border-line pl-5">
      {items.map((a) => (
        <li key={a.id} className="relative">
          <span className="absolute -left-[26px] top-1"><Avatar user={a.actor} size={14} /></span>
          <p className="text-sm"><span className="font-semibold">{a.actor?.name || 'Someone'}</span> <span className="text-mist">{a.summary}</span></p>
          <p className="mt-0.5 flex items-center gap-2 text-[11px] text-mist/70">{ago(a.createdAt)}{a.Project && <span style={{ color: a.Project.color }}>{a.Project.name}</span>}{a.clientVisible && <Eye size={11} className="text-signal/70" aria-label="Client can see this" />}</p>
        </li>
      ))}
    </ol>
  );
}

export default function Dashboard() {
  const { user, company } = useAuth();
  const { data, loading, reload } = useFetch('/dashboard');
  const nav = useNavigate();
  useLive(['task:changed', 'project:changed'], reload);
  if (loading || !data) return <PageLoader />;
  const { personal: me, team } = data;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold sm:text-3xl">{greeting()}, {user.name.split(' ')[0]}</h1>
          <p className="mt-1 text-sm text-mist">{format(new Date(), 'EEEE, d MMMM')} at {company?.name}. {me.overdue ? `${me.overdue} of your tasks are overdue.` : me.dueToday ? `${me.dueToday} due today.` : 'Nothing overdue. Nice.'}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatTile icon={CheckSquare} label="Open tasks" value={me.open} onClick={() => nav('/my-tasks')} />
        <StatTile icon={AlarmClock} label="Due today" value={me.dueToday} tone="#FFB648" />
        <StatTile icon={Flame} label="Overdue" value={me.overdue} tone="#FF7A90" />
        <StatTile icon={Trophy} label="Done this week" value={me.doneThisWeek} tone="#5BE3A6" />
        <StatTile icon={Timer} label="Tracked today" value={minutes(me.minutesToday)} tone="#8F7BFF" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <section className="panel p-5">
          <div className="mb-4 flex items-center justify-between"><h2 className="text-lg font-semibold">Your queue</h2><Link to="/my-tasks" className="link text-sm">All my tasks</Link></div>
          {me.tasks.length ? (
            <ul className="divide-y divide-line/70">
              {me.tasks.map((t) => (
                <li key={t.id}>
                  <Link to={`/tasks/${t.id}`} className="flex items-center gap-3 py-2.5 transition hover:bg-white/[0.02]">
                    <span className="h-8 w-1 shrink-0 rounded-full" style={{ background: STATUS[t.status]?.color }} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{t.title}</span>
                      <span className="mt-0.5 flex items-center gap-3 text-xs text-mist"><span>{t.key}</span>{t.Project && <span style={{ color: t.Project.color }}>{t.Project.name}</span>}<DueBadge date={t.dueDate} /></span>
                    </span>
                    <PriorityFlag priority={t.priority} />
                    <span className="hidden sm:block"><StatusPill status={t.status} /></span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : <Empty icon={Trophy} title="Your queue is clear" body="New assignments land here and on WhatsApp." />}
        </section>

        <section className="panel p-5">
          <div className="mb-4 flex items-center gap-2"><ShieldCheck size={18} className="text-nebula" /><h2 className="text-lg font-semibold">Waiting for your approval</h2></div>
          {me.approvals.length ? (
            <ul className="space-y-2">
              {me.approvals.map((t) => (
                <li key={t.id}><Link to={`/tasks/${t.id}`} className="flex items-center gap-3 rounded-xl border border-line bg-white/[0.02] p-3 hover:border-nebula/50">
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{t.title}</span><span className="text-xs text-mist">{t.key} by {t.assignees.map((a) => a.name.split(' ')[0]).join(', ') || 'someone'}</span></span>
                  <AvatarStack users={t.assignees} size={22} />
                </Link></li>
              ))}
            </ul>
          ) : <p className="py-8 text-center text-sm text-mist">No reviews pending.</p>}
        </section>
      </div>

      {team && (<>
        <div className="flex items-center justify-between pt-2"><h2 className="text-xl font-semibold">Team overview</h2></div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <StatTile label="Open across team" value={team.open} />
          <StatTile label="Overdue" value={team.overdue} tone="#FF7A90" onClick={() => nav('/board')} />
          <StatTile label="In review" value={team.inReview} tone="#8F7BFF" />
          <StatTile label="Completed in 7 days" value={team.doneThisWeek} tone="#5BE3A6" />
          <StatTile icon={Inbox} label="Open client requests" value={team.clientRequests} tone="#FFB648" onClick={() => nav('/requests')} />
        </div>

        <section className="panel p-5">
          <h3 className="mb-1 font-semibold">Project health</h3>
          <p className="mb-5 text-xs text-mist">Ring shows work done. The marker on the bar shows where the project should be by today's date.</p>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {team.health.map((p) => (
              <Link key={p.id} to={`/projects/${p.id}`} className="flex items-center gap-4 rounded-xl border border-line bg-white/[0.02] p-4 transition hover:border-signal/40">
                <OrbitRing value={p.progress} size={64} color={p.color} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold">{p.name}</div>
                  <div className="truncate text-xs text-mist">{p.client || 'Internal'} — {p.taskCount} tasks{p.overdue ? `, ${p.overdue} overdue` : ''}</div>
                  <div className="relative mt-2.5">
                    <Bar value={p.progress} color={p.color} />
                    {p.expected != null && <span className="absolute -top-1 h-3.5 w-0.5 rounded bg-star/80" style={{ left: `${p.expected}%` }} title={`Expected ${p.expected}% by today`} />}
                  </div>
                  <div className="mt-1.5 text-[11px] font-semibold" style={{ color: STATE[p.state].color }}>{STATE[p.state].label}</div>
                </div>
              </Link>
            ))}
          </div>
        </section>

        <div className="grid gap-6 xl:grid-cols-2">
          <section className="panel p-5">
            <h3 className="mb-4 font-semibold">Created vs completed, last 14 days</h3>
            <div className="h-56">
              <ResponsiveContainer>
                <AreaChart data={team.trend} margin={{ left: -24, right: 8, top: 4 }}>
                  <defs>
                    <linearGradient id="gC" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#3DE0F2" stopOpacity={0.35} /><stop offset="100%" stopColor="#3DE0F2" stopOpacity={0} /></linearGradient>
                    <linearGradient id="gN" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#8F7BFF" stopOpacity={0.3} /><stop offset="100%" stopColor="#8F7BFF" stopOpacity={0} /></linearGradient>
                  </defs>
                  <CartesianGrid stroke="rgba(150,168,255,.08)" vertical={false} />
                  <XAxis dataKey="day" tickFormatter={(d) => format(new Date(d), 'd MMM')} tick={{ fill: '#8D96C4', fontSize: 11 }} axisLine={false} tickLine={false} interval={2} />
                  <YAxis allowDecimals={false} tick={{ fill: '#8D96C4', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ background: '#141B42', border: '1px solid rgba(150,168,255,.2)', borderRadius: 12, color: '#E8ECFF' }} labelFormatter={(d) => format(new Date(d), 'd MMM')} />
                  <Area type="monotone" dataKey="created" name="Created" stroke="#8F7BFF" fill="url(#gN)" strokeWidth={2} />
                  <Area type="monotone" dataKey="completed" name="Completed" stroke="#3DE0F2" fill="url(#gC)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </section>
          <section className="panel p-5">
            <h3 className="mb-4 font-semibold">Workload</h3>
            <div className="space-y-3">
              {team.workload.slice(0, 8).map((w) => {
                const max = Math.max(...team.workload.map((x) => x.open), 1);
                return (
                  <Link to={`/team/${w.id}`} key={w.id} className="flex items-center gap-3">
                    <Avatar user={w} size={28} />
                    <div className="min-w-0 flex-1">
                      <div className="flex justify-between text-xs"><span className="truncate font-medium text-star">{w.name}</span><span className="text-mist">{w.open} open{w.overdue ? <span className="text-rose">, {w.overdue} overdue</span> : ''}</span></div>
                      <div className="mt-1 flex h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                        <div style={{ width: `${((w.open - w.overdue) / max) * 100}%`, background: w.color }} />
                        <div style={{ width: `${(w.overdue / max) * 100}%` }} className="bg-rose" />
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          </section>
        </div>
      </>)}

      <section className="panel p-5">
        <div className="mb-4 flex items-center justify-between"><h2 className="text-lg font-semibold">Recent activity</h2><Link to="/activity" className="link text-sm">See all</Link></div>
        <ActivityFeed items={data.activity.slice(0, 12)} />
      </section>
    </div>
  );
}

export { ActivityFeed };
