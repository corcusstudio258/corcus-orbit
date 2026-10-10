import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { startOfMonth, endOfMonth, startOfWeek, endOfWeek, addDays, addMonths, format, isSameMonth, isToday, isSameDay } from 'date-fns';
import clsx from 'clsx';
import useFetch from '../lib/useFetch';
import { useLive } from '../context/AuthContext';
import TaskExplorer from '../components/TaskExplorer';
import { PageLoader } from '../components/ui';
import { STATUS } from '../lib/format';
import { ActivityFeed } from './Dashboard';

export function MyTasks() {
  return (
    <div className="space-y-5">
      <div><h1 className="text-2xl font-semibold">My tasks</h1><p className="text-sm text-mist">Everything assigned to you, at any level of a task tree.</p></div>
      <TaskExplorer fixed={{ assignee: 'me' }} storageKey="mine" />
    </div>
  );
}

export function Board() {
  return (
    <div className="space-y-5">
      <div><h1 className="text-2xl font-semibold">Task board</h1><p className="text-sm text-mist">Drag cards between columns to update status. Your team gets notified.</p></div>
      <TaskExplorer storageKey="board" defaultView="board" />
    </div>
  );
}

export function Calendar() {
  const [month, setMonth] = useState(startOfMonth(new Date()));
  const from = startOfWeek(month, { weekStartsOn: 1 });
  const to = endOfWeek(endOfMonth(month), { weekStartsOn: 1 });
  const { data, loading, reload } = useFetch(`/tasks?from=${from.toISOString()}&to=${addDays(to, 1).toISOString()}`);
  useLive('task:changed', reload, [month]);
  const days = useMemo(() => { const out = []; for (let d = from; d <= to; d = addDays(d, 1)) out.push(d); return out; }, [month]); // eslint-disable-line react-hooks/exhaustive-deps
  const [sel, setSel] = useState(new Date());
  const dayTasks = (d) => (data || []).filter((t) => t.dueDate && isSameDay(new Date(t.dueDate), d));
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{format(month, 'MMMM yyyy')}</h1>
        <div className="flex gap-1">
          <button type="button" className="btn-ghost btn-sm" onClick={() => setMonth(addMonths(month, -1))} aria-label="Previous month"><ChevronLeft size={16} /></button>
          <button type="button" className="btn-ghost btn-sm" onClick={() => setMonth(startOfMonth(new Date()))}>Today</button>
          <button type="button" className="btn-ghost btn-sm" onClick={() => setMonth(addMonths(month, 1))} aria-label="Next month"><ChevronRight size={16} /></button>
        </div>
      </div>
      {loading ? <PageLoader /> : (
        <div className="grid gap-5 xl:grid-cols-[1fr_320px]">
          <div className="panel overflow-hidden">
            <div className="grid grid-cols-7 border-b border-line text-center text-xs font-semibold text-mist">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d} className="py-2">{d}</div>)}</div>
            <div className="grid grid-cols-7">
              {days.map((d) => {
                const ts = dayTasks(d);
                return (
                  <button type="button" key={d.toISOString()} onClick={() => setSel(d)} className={clsx('min-h-[96px] border-b border-r border-line/60 p-1.5 text-left align-top transition hover:bg-white/[0.03]', !isSameMonth(d, month) && 'opacity-40', isSameDay(d, sel) && 'bg-signal/[0.06]')}>
                    <span className={clsx('mb-1 inline-grid h-6 w-6 place-items-center rounded-full text-xs', isToday(d) ? 'bg-signal font-bold text-space' : 'text-mist')}>{format(d, 'd')}</span>
                    <div className="space-y-1">
                      {ts.slice(0, 3).map((t) => <div key={t.id} className="truncate rounded-md px-1.5 py-0.5 text-[11px]" style={{ background: `${STATUS[t.status].color}1F`, color: STATUS[t.status].color }}>{t.title}</div>)}
                      {ts.length > 3 && <div className="px-1 text-[10px] text-mist">+{ts.length - 3} more</div>}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
          <section className="panel self-start p-5">
            <h2 className="mb-3 font-semibold">{format(sel, 'EEEE, d MMM')}</h2>
            <ul className="space-y-2">
              {dayTasks(sel).map((t) => (
                <li key={t.id}><Link to={`/tasks/${t.id}`} className="block rounded-xl border border-line bg-white/[0.02] p-3 hover:border-signal/40">
                  <div className="text-sm font-medium">{t.title}</div>
                  <div className="mt-1 text-xs text-mist">{t.key}, {format(new Date(t.dueDate), 'h:mm a')}, <span style={{ color: STATUS[t.status].color }}>{STATUS[t.status].label}</span></div>
                </Link></li>
              ))}
              {!dayTasks(sel).length && <li className="text-sm text-mist">Nothing due this day.</li>}
            </ul>
          </section>
        </div>
      )}
    </div>
  );
}

export function ActivityPage() {
  const { data, loading, reload } = useFetch('/activity');
  useLive('activity', reload);
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold">Activity</h1>
      <section className="panel p-5">{loading ? <PageLoader /> : <ActivityFeed items={data} />}</section>
    </div>
  );
}
