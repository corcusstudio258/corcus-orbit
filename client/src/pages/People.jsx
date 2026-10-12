import { useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import { addMonths, eachDayOfInterval, endOfMonth, format, getDay, isToday, startOfMonth } from 'date-fns';
import { ChevronLeft, ChevronRight, Download, LogIn, LogOut, Gift, Trophy, Medal, Clock, Users, CalendarCheck } from 'lucide-react';
import api, { download } from '../lib/api';
import useFetch from '../lib/useFetch';
import { useAuth, useLive } from '../context/AuthContext';
import { useDirectory } from '../lib/directory';
import { PageHeader, Avatar, Panel, PageLoader, Segmented, Modal, Field, Empty, Bar, Tabs } from '../components/ui';
import { ago, fmtTime } from '../lib/format';

// ---------------- Workload ----------------
const heat = (h, cap) => {
  if (!h) return { bg: 'transparent', fg: 'rgb(var(--c-faint))' };
  const r = h / cap;
  if (r > 1.15) return { bg: 'rgb(var(--c-ember) / 0.85)', fg: '#fff' };
  if (r > 0.9) return { bg: 'rgb(var(--c-amber) / 0.75)', fg: '#fff' };
  if (r > 0.5) return { bg: 'rgb(var(--c-cobalt) / 0.55)', fg: '#fff' };
  return { bg: 'rgb(var(--c-cobalt) / 0.18)', fg: 'rgb(var(--c-ink))' };
};

export function Workload() {
  const [days, setDays] = useState(10);
  const { data, reload } = useFetch(`/people/workload?days=${days}`, [days]);
  useLive('task:changed', reload);
  return (
    <div>
      <PageHeader title="Workload" subtitle={data ? `Estimated hours per person per day, against ${data.capacity}h of capacity. Spread from start to due date, Sundays skipped.` : ' '}
        actions={<Segmented value={days} onChange={setDays} options={[{ value: 6, label: '1 week' }, { value: 10, label: '2 weeks' }, { value: 20, label: '4 weeks' }]} />} />
      {!data ? <PageLoader /> : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-4 text-xs text-muted">
            {[['Light', 0.3], ['Busy', 0.7], ['Full', 1], ['Over capacity', 1.3]].map(([l, r]) => <span key={l} className="flex items-center gap-1.5"><span className="h-3 w-5 rounded" style={{ background: heat(r * data.capacity, data.capacity).bg }} />{l}</span>)}
          </div>
          <div className="panel overflow-x-auto">
            <table className="w-full min-w-[760px] border-separate border-spacing-0 text-sm">
              <thead>
                <tr className="text-xs text-muted">
                  <th className="sticky left-0 z-10 bg-surface px-4 py-3 text-left font-semibold">Person</th>
                  <th className="px-2 py-3 text-left font-semibold">Load</th>
                  {data.dates.map((d) => { const dt = new Date(`${d}T12:00`); return <th key={d} className={clsx('px-1 py-3 text-center font-semibold', isToday(dt) && 'text-ink')}><div>{format(dt, 'EEEEE')}</div><div className={clsx('mx-auto mt-0.5 grid h-6 w-6 place-items-center rounded-full', isToday(dt) && 'bg-brand text-brand-ink')}>{format(dt, 'd')}</div></th>; })}
                  <th className="px-3 py-3 text-right font-semibold">No date</th>
                </tr>
              </thead>
              <tbody>
                {data.people.map((p) => (
                  <tr key={p.user.id} className="group">
                    <td className="sticky left-0 z-10 border-t border-line bg-surface px-4 py-2.5 group-hover:bg-sunken">
                      <div className="flex items-center gap-2.5"><Avatar user={p.user} size={28} /><div className="min-w-0"><div className="truncate font-medium">{p.user.name}</div><div className="truncate text-xs text-muted">{p.open} open{p.overdue ? <span className="text-ember">, {p.overdue} overdue</span> : ''}</div></div></div>
                    </td>
                    <td className="w-28 border-t border-line px-2"><div className="flex items-center gap-2"><Bar value={Math.min(100, p.utilisation)} height={5} color={p.utilisation > 110 ? 'rgb(var(--c-ember))' : p.utilisation > 85 ? 'rgb(var(--c-amber))' : 'rgb(var(--c-cobalt))'} /><span className={clsx('w-9 text-right text-xs font-semibold', p.utilisation > 110 && 'text-ember')}>{p.utilisation}%</span></div></td>
                    {p.days.map((h, i) => { const c = heat(h, data.capacity); return (
                      <td key={i} className="border-t border-line p-1"><div className="grid h-9 min-w-[34px] place-items-center rounded-lg text-[11px] font-semibold" style={{ background: c.bg, color: c.fg }} title={`${h}h`}>{h ? h.toFixed(h < 10 ? 1 : 0).replace('.0', '') : ''}</div></td>
                    ); })}
                    <td className="border-t border-line px-3 text-right text-xs text-muted">{p.unscheduled ? `${p.unscheduled}h` : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-muted">Tasks without an estimate count as 2 hours. Overdue work is stacked on today.</p>
        </>
      )}
    </div>
  );
}

// ---------------- Attendance ----------------
const ATT = {
  present: { label: 'Present', color: '#1FA971' }, late: { label: 'Late', color: '#C76A00' }, half_day: { label: 'Half day', color: '#8B5CF6' },
  remote: { label: 'Remote', color: '#3D5AFE' }, leave: { label: 'Leave', color: '#8D94B3' }, absent: { label: 'Absent', color: '#E5484D' },
  in: { label: 'Working now', color: '#1FA971' }, not_in: { label: 'Not in yet', color: '#C9CEE0' },
};

function MonthHeat({ records, month }) {
  const days = eachDayOfInterval({ start: startOfMonth(month), end: endOfMonth(month) });
  const lead = (getDay(days[0]) + 6) % 7;
  return (
    <div>
      <div className="grid grid-cols-7 gap-1.5 text-center text-[10px] font-semibold text-faint">{['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <div key={i}>{d}</div>)}</div>
      <div className="mt-1.5 grid grid-cols-7 gap-1.5">
        {[...Array(lead)].map((_, i) => <div key={`x${i}`} />)}
        {days.map((d) => {
          const r = records.find((x) => x.date === format(d, 'yyyy-MM-dd'));
          const s = r ? ATT[r.status] : null;
          return (
            <div key={d.toISOString()} title={r ? `${s?.label}${r.minutes ? `, ${(r.minutes / 60).toFixed(1)}h` : ''}${r.note ? `: ${r.note}` : ''}` : format(d, 'd MMM')}
              className={clsx('grid aspect-square place-items-center rounded-lg text-xs font-semibold', !r && 'bg-sunken text-faint', isToday(d) && 'ring-2 ring-ink ring-offset-1 ring-offset-surface')}
              style={r ? { background: s?.color, color: '#fff' } : undefined}>{format(d, 'd')}</div>
          );
        })}
      </div>
    </div>
  );
}

function MarkModal({ target, onClose, onDone }) {
  const [status, setStatus] = useState(target?.record?.status || 'present');
  const [note, setNote] = useState(target?.record?.note || '');
  if (!target) return null;
  const save = async () => { try { await api.post('/people/attendance/mark', { userId: target.user.id, date: target.date, status, note }); onDone(); onClose(); } catch (err) { toast.error(err.message); } };
  return (
    <Modal open onClose={onClose} title={`Mark ${target.user.name}`} subtitle={format(new Date(`${target.date}T12:00`), 'EEEE d MMMM')} width="max-w-md"
      footer={<><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button type="button" className="btn-primary" onClick={save}>Save</button></>}>
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-2">{['present', 'late', 'half_day', 'remote', 'leave', 'absent'].map((k) => <button key={k} type="button" onClick={() => setStatus(k)} className={clsx('rounded-xl border px-2 py-2 text-xs font-semibold', status === k ? 'border-ink' : 'border-line text-muted')}><span className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ background: ATT[k].color }} />{ATT[k].label}</button>)}</div>
        <Field label="Note"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Doctor's appointment, client visit" /></Field>
      </div>
    </Modal>
  );
}

export function Attendance() {
  const { can, user } = useAuth();
  const team = can('dashboard.team', 'users.manage');
  const [tab, setTab] = useState('me');
  const [month, setMonth] = useState(startOfMonth(new Date()));
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [mark, setMark] = useState(null);
  const [who, setWho] = useState(null);
  const mk = format(month, 'yyyy-MM');
  const { data: today, reload: reloadToday } = useFetch('/people/attendance/today');
  const { data: mine, reload: reloadMine } = useFetch(`/people/attendance/me?month=${mk}${who ? `&userId=${who.id}` : ''}`, [mk, who]);
  const { data: teamData, reload: reloadTeam } = useFetch(team && tab === 'team' ? `/people/attendance/team?date=${date}` : null, [date, tab]);
  useLive('attendance:changed', () => { reloadToday(); reloadMine(); if (team && tab === 'team') reloadTeam(); });

  const rec = today?.record;
  const working = rec?.inAt && !rec?.outAt;
  const punch = async (kind) => {
    try { const r = await api.post(`/people/attendance/punch-${kind}`, kind === 'in' ? { mode: 'office' } : {}); toast.success(kind === 'in' ? (r.data.status === 'late' ? 'Punched in, marked late' : 'Punched in. Have a good day') : 'Punched out'); reloadToday(); reloadMine(); } catch (err) { toast.error(err.message); }
  };
  const counts = useMemo(() => { const c = {}; (teamData?.people || []).forEach((p) => { c[p.status] = (c[p.status] || 0) + 1; }); return c; }, [teamData]);

  return (
    <div>
      <PageHeader title="Attendance" subtitle={`Office starts at ${today?.workStart || '10:00'}. Punch in from anywhere, it counts toward points.`}
        actions={team && <button type="button" className="btn-ghost" onClick={() => download(`/people/attendance/export?month=${mk}`, `attendance-${mk}.csv`).catch((e) => toast.error(e.message))}><Download size={15} />Export {format(month, 'MMM')}</button>} />
      {team && <div className="mb-5"><Tabs value={tab} onChange={setTab} tabs={[{ value: 'me', label: who ? who.name : 'My attendance', icon: CalendarCheck }, { value: 'team', label: 'Team', icon: Users }]} /></div>}

      {tab === 'me' ? (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[360px_minmax(0,1fr)]">
          <div className="space-y-5">
            {!who && (
              <section className="relative overflow-hidden rounded-3xl bg-night p-6 text-white">
                <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full border border-white/10" /><div className="pointer-events-none absolute -right-2 -top-2 h-24 w-24 rounded-full border border-white/10" />
                <p className="text-sm text-white/60">{format(new Date(), 'EEEE, d MMMM')}</p>
                <p className="mt-2 font-display text-4xl font-semibold">{working ? 'Working' : rec?.outAt ? 'Done for today' : 'Not in yet'}</p>
                <p className="mt-1 text-sm text-white/70">{rec?.inAt ? `In at ${fmtTime(rec.inAt)}${rec.outAt ? `, out at ${fmtTime(rec.outAt)}` : ''}${rec.status === 'late' ? ', marked late' : ''}` : 'Punch in to start your day.'}</p>
                <div className="mt-5">{working ? <button type="button" className="btn bg-white text-night hover:bg-white/90" onClick={() => punch('out')}><LogOut size={16} />Punch out</button> : <button type="button" className="btn-primary" onClick={() => punch('in')}><LogIn size={16} />Punch in{rec?.outAt ? ' again' : ''}</button>}</div>
              </section>
            )}
            {who && <button type="button" className="btn-ghost" onClick={() => setWho(null)}><ChevronLeft size={15} />Back to my attendance</button>}
            {mine && (
              <Panel title={format(month, 'MMMM yyyy')} action={<div className="flex gap-1"><button type="button" className="btn-ghost btn-sm" onClick={() => setMonth(addMonths(month, -1))} aria-label="Previous month"><ChevronLeft size={14} /></button><button type="button" className="btn-ghost btn-sm" onClick={() => setMonth(addMonths(month, 1))} aria-label="Next month"><ChevronRight size={14} /></button></div>}>
                <MonthHeat records={mine.records} month={month} />
                <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5 text-xs">{['present', 'late', 'half_day', 'remote', 'leave', 'absent'].map((k) => <span key={k} className="flex items-center gap-1.5 text-muted"><span className="h-2 w-2 rounded-full" style={{ background: ATT[k].color }} />{ATT[k].label} <span className="font-semibold text-ink">{mine.summary[k]}</span></span>)}</div>
              </Panel>
            )}
          </div>
          <div className="space-y-5">
            {mine && (
              <section className="panel grid grid-cols-2 sm:grid-cols-4 sm:divide-x sm:divide-line">
                {[['Days in', mine.summary.present + mine.summary.late + mine.summary.remote + mine.summary.half_day], ['On time', mine.summary.present + mine.summary.remote], ['Late', mine.summary.late], ['Hours', mine.summary.hours]].map(([l, v]) => <div key={l} className="px-5 py-4"><div className="text-xs text-muted">{l}</div><div className="font-display text-[28px] font-semibold leading-none">{v}</div></div>)}
              </section>
            )}
            <Panel title="Log" subtitle={who ? `${who.name}, ${format(month, 'MMMM')}` : format(month, 'MMMM')}>
              {!mine ? <PageLoader /> : !mine.records.length ? <p className="py-6 text-center text-sm text-muted">Nothing recorded this month.</p> : (
                <ul className="divide-y divide-line">
                  {mine.records.slice().reverse().map((r) => (
                    <li key={r.id} className="flex items-center gap-3 py-2.5 text-sm">
                      <span className="w-20 shrink-0 font-medium">{format(new Date(`${r.date}T12:00`), 'EEE d')}</span>
                      <span className="chip" style={{ background: `${ATT[r.status]?.color}1F`, color: ATT[r.status]?.color }}>{ATT[r.status]?.label}</span>
                      <span className="text-muted">{r.inAt ? `${fmtTime(r.inAt)} to ${r.outAt ? fmtTime(r.outAt) : 'now'}` : ''}</span>
                      <span className="ml-auto text-xs text-muted">{r.minutes ? `${(r.minutes / 60).toFixed(1)}h` : ''}{r.note ? ` ${r.note}` : ''}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <input type="date" className="input !w-auto" value={date} onChange={(e) => setDate(e.target.value)} />
            <div className="flex flex-wrap gap-1.5">{Object.entries(counts).map(([k, n]) => <span key={k} className="chip" style={{ background: `${ATT[k]?.color}24`, color: k === 'not_in' ? 'rgb(var(--c-muted))' : ATT[k]?.color }}>{ATT[k]?.label} {n}</span>)}</div>
          </div>
          {!teamData ? <PageLoader /> : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {teamData.people.map((p) => (
                <div key={p.user.id} className="panel flex items-center gap-3 p-4">
                  <Avatar user={p.user} size={40} online={p.status === 'in'} />
                  <div className="min-w-0 flex-1">
                    <button type="button" className="truncate font-semibold hover:underline" onClick={() => { setWho(p.user); setTab('me'); }}>{p.user.name}</button>
                    <p className="flex items-center gap-1.5 text-xs text-muted"><span className="h-2 w-2 rounded-full" style={{ background: ATT[p.status]?.color }} />{ATT[p.status]?.label}{p.record?.inAt ? `, in ${fmtTime(p.record.inAt)}` : ''}</p>
                    <p className="mt-0.5 text-[11px] text-faint">This month: {p.month.present} days, {p.month.late} late, {p.month.hours}h</p>
                  </div>
                  {p.user.id !== user.id && <button type="button" className="btn-ghost btn-sm" onClick={() => setMark({ ...p, date })}>Mark</button>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      <MarkModal key={mark?.user?.id} target={mark} onClose={() => setMark(null)} onDone={reloadTeam} />
    </div>
  );
}

// ---------------- Rewards ----------------
export function Rewards() {
  const { user } = useAuth();
  const people = useDirectory();
  const [period, setPeriod] = useState('month');
  const { data: me, reload } = useFetch('/people/rewards/me');
  const { data: board, reload: reloadBoard } = useFetch(`/people/rewards/leaderboard?period=${period}`, [period]);
  const [kudos, setKudos] = useState(null);
  useLive('task:changed', () => { reload(); reloadBoard(); });
  const give = async () => {
    try { await api.post('/people/rewards/kudos', kudos); toast.success('Kudos sent'); setKudos(null); reloadBoard(); } catch (err) { toast.error(err.message); }
  };
  if (!me) return <PageLoader />;
  const earned = new Set(me.badges.map((b) => b.code));
  const podium = (board || []).slice(0, 3);

  return (
    <div>
      <PageHeader title="Rewards" subtitle="Points for finishing on time, showing up, and helping each other."
        actions={<button type="button" className="btn-primary" onClick={() => setKudos({ userId: '', points: 10, reason: '' })}><Gift size={16} />Give kudos</button>} />
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-5">
          <section className="relative overflow-hidden rounded-3xl bg-night p-6 text-white">
            <div className="pointer-events-none absolute -right-20 -top-20 h-72 w-72 rounded-full" style={{ background: 'radial-gradient(circle, rgba(255,194,26,0.35), transparent 65%)' }} />
            <div className="relative flex flex-wrap items-end gap-8">
              <div><p className="text-sm text-white/60">This month</p><p className="font-display text-6xl font-semibold leading-none text-brand">{me.month}</p><p className="mt-1 text-sm text-white/70">points{me.rank ? `, rank ${me.rank} on the team` : ''}</p></div>
              <div><p className="text-sm text-white/60">All time</p><p className="font-display text-3xl font-semibold">{me.lifetime}</p></div>
              <div><p className="text-sm text-white/60">Badges</p><p className="font-display text-3xl font-semibold">{me.badges.length}<span className="text-lg text-white/50">/{me.catalog.length}</span></p></div>
            </div>
            <p className="relative mt-5 text-xs text-white/60">Task done: 10, 15 high, 20 urgent. On time: +5. Early: +5 more. On-time punch-in: +2. Each badge: +25.</p>
          </section>

          <Panel title="Badges" icon={Medal}>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {me.catalog.map((b) => {
                const has = earned.has(b.code);
                const when = me.badges.find((x) => x.code === b.code)?.earnedAt;
                return (
                  <div key={b.code} className={clsx('rounded-2xl border p-3 text-center transition', has ? 'border-brand/60 bg-brand-soft/50' : 'border-line opacity-55 grayscale')} title={b.desc}>
                    <div className="text-3xl">{b.icon}</div>
                    <div className="mt-1 text-sm font-semibold">{b.name}</div>
                    <div className="mt-0.5 text-[11px] leading-tight text-muted">{has ? `Earned ${ago(when)}` : b.desc}</div>
                  </div>
                );
              })}
            </div>
          </Panel>

          <Panel title="Your points" icon={Clock}>
            {!me.history.length ? <p className="text-sm text-muted">Finish a task to earn your first points.</p> : (
              <ul className="divide-y divide-line">
                {me.history.map((h) => (
                  <li key={h.id} className="flex items-center gap-3 py-2.5 text-sm">
                    <span className={clsx('w-12 shrink-0 font-display font-semibold', h.points >= 0 ? 'text-leaf' : 'text-ember')}>{h.points > 0 ? '+' : ''}{h.points}</span>
                    <span className="min-w-0 flex-1 truncate">{h.reason}</span>
                    <span className="shrink-0 text-xs text-faint">{ago(h.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <Panel title="Leaderboard" icon={Trophy} action={<Segmented size="sm" value={period} onChange={setPeriod} options={[{ value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }, { value: 'all', label: 'All time' }]} />}>
          {!board ? <PageLoader /> : !board.length ? <Empty compact icon={Trophy} title="No points yet" /> : (
            <>
              <div className="mb-5 mt-2 flex items-end justify-center gap-3">
                {[1, 0, 2].map((i) => podium[i] && (
                  <div key={i} className="flex flex-col items-center">
                    <Avatar user={podium[i].user} size={i === 0 ? 52 : 40} ring />
                    <p className="mt-1 max-w-[80px] truncate text-xs font-semibold">{podium[i].user.name.split(' ')[0]}</p>
                    <div className={clsx('mt-1 grid w-20 place-items-center rounded-t-xl font-display font-semibold', i === 0 ? 'h-20 bg-brand text-brand-ink' : i === 1 ? 'h-14 bg-sunken' : 'h-10 bg-sunken')}>
                      <span className="text-lg">{podium[i].points}</span>
                    </div>
                  </div>
                ))}
              </div>
              <ol className="space-y-1">
                {board.map((b, i) => (
                  <li key={b.user.id} className={clsx('flex items-center gap-3 rounded-xl px-2 py-2', b.user.id === user.id && 'bg-brand-soft/50')}>
                    <span className="w-6 text-center font-display text-sm font-semibold text-muted">{i + 1}</span>
                    <Avatar user={b.user} size={28} />
                    <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{b.user.name}</span><span className="block truncate text-[11px] text-muted">{b.badges} badges</span></span>
                    <span className="font-display font-semibold">{b.points}</span>
                  </li>
                ))}
              </ol>
            </>
          )}
        </Panel>
      </div>

      <Modal open={!!kudos} onClose={() => setKudos(null)} title="Give kudos" subtitle="Say thanks in public. They get the points and a notification." width="max-w-md"
        footer={<><button type="button" className="btn-ghost" onClick={() => setKudos(null)}>Cancel</button><button type="button" className="btn-primary" onClick={give}>Send +{kudos?.points}</button></>}>
        {kudos && (
          <div className="space-y-4">
            <Field label="Who"><select className="input" value={kudos.userId} onChange={(e) => setKudos({ ...kudos, userId: Number(e.target.value) })}><option value="">Pick a teammate</option>{people.filter((p) => p.id !== user.id).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
            <Field label="Points"><Segmented value={kudos.points} onChange={(v) => setKudos({ ...kudos, points: v })} options={[5, 10, 25, 50].map((n) => ({ value: n, label: `+${n}` }))} /></Field>
            <Field label="For what" hint="Managers can give up to 100, everyone else up to 10."><textarea className="input" rows={3} value={kudos.reason} onChange={(e) => setKudos({ ...kudos, reason: e.target.value })} placeholder="Stayed late to fix the Diwali reel export" /></Field>
          </div>
        )}
      </Modal>
    </div>
  );
}

