import { useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import { addDays, differenceInCalendarDays, format, startOfDay, isWeekend, isToday } from 'date-fns';
import { ChevronLeft, ChevronRight, CalendarRange } from 'lucide-react';
import api from '../lib/api';
import { STATUS } from '../lib/format';
import { Avatar, PageLoader, Empty, Segmented } from './ui';
import { useOpenTask } from './Layout';
import { useLive } from '../context/AuthContext';

const ROW = 40;
const toDate = (s) => (s ? startOfDay(new Date(String(s).length === 10 ? `${s}T12:00:00` : s)) : null);

export default function Gantt({ projectId }) {
  const [data, setData] = useState(null);
  const [zoom, setZoom] = useState('day');
  const [offset, setOffset] = useState(0);
  const [drag, setDrag] = useState(null);
  const openTask = useOpenTask();
  const scroller = useRef(null);
  const load = () => api.get(`/projects/${projectId}/timeline`).then((r) => setData(r.data));
  useEffect(() => { load(); }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps
  useLive('task:changed', (d) => { if (!d?.projectId || d.projectId === Number(projectId)) load(); }, [projectId]);

  const DW = zoom === 'day' ? 34 : 14;
  const rows = useMemo(() => (data?.tasks || []).map((t) => {
    const due = toDate(t.dueDate); const start = toDate(t.startDate) || (due ? addDays(due, -1) : null);
    return { ...t, start: start && due && start > due ? due : start, end: due || start };
  }).filter((t) => t.start && t.end), [data]);

  const range = useMemo(() => {
    const today = startOfDay(new Date());
    const all = rows.flatMap((r) => [r.start, r.end]).concat((data?.milestones || []).map((m) => toDate(m.dueDate)).filter(Boolean));
    const min = all.length ? new Date(Math.min(...all, today)) : addDays(today, -7);
    const max = all.length ? new Date(Math.max(...all, today)) : addDays(today, 21);
    const from = addDays(min, -3 + offset);
    const days = Math.max(28, differenceInCalendarDays(max, min) + 10);
    return { from, days };
  }, [rows, data, offset]);

  useEffect(() => {
    if (!scroller.current || !data) return;
    const x = differenceInCalendarDays(new Date(), range.from) * DW - 200;
    scroller.current.scrollLeft = Math.max(0, x);
  }, [data, DW]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!data) return <PageLoader />;
  if (!rows.length) return <div className="panel"><Empty icon={CalendarRange} title="Nothing on the timeline yet" body="Give tasks a start or due date and they appear here as bars you can drag." /></div>;

  const xOf = (d) => differenceInCalendarDays(d, range.from) * DW;
  const idx = Object.fromEntries(rows.map((r, i) => [r.id, i]));

  const onDown = (e, r, mode) => {
    e.stopPropagation(); e.preventDefault();
    setDrag({ id: r.id, mode, x0: e.clientX, start: r.start, end: r.end, dx: 0 });
  };
  const onMove = (e) => { if (drag) setDrag((d) => ({ ...d, dx: Math.round((e.clientX - d.x0) / DW) })); };
  const onUp = async () => {
    if (!drag) return;
    const d = drag; setDrag(null);
    if (!d.dx) { openTask(d.id); return; }
    let start = d.start; let end = d.end;
    if (d.mode === 'move') { start = addDays(start, d.dx); end = addDays(end, d.dx); } else { end = addDays(end, d.dx); if (end < start) end = start; }
    setData((x) => ({ ...x, tasks: x.tasks.map((t) => (t.id === d.id ? { ...t, startDate: format(start, 'yyyy-MM-dd'), dueDate: new Date(`${format(end, 'yyyy-MM-dd')}T18:00`).toISOString() } : t)) }));
    try {
      await api.patch(`/tasks/${d.id}`, { startDate: format(start, 'yyyy-MM-dd'), dueDate: new Date(`${format(end, 'yyyy-MM-dd')}T18:00`).toISOString() });
      toast.success(`Rescheduled to ${format(end, 'd MMM')}`);
    } catch (err) { toast.error(err.message); load(); }
  };
  const geom = (r) => {
    let { start, end } = r;
    if (drag?.id === r.id) { if (drag.mode === 'move') { start = addDays(start, drag.dx); end = addDays(end, drag.dx); } else { end = addDays(end, drag.dx); if (end < start) end = start; } }
    return { x: xOf(start), w: Math.max(DW, (differenceInCalendarDays(end, start) + 1) * DW), start, end };
  };
  const days = [...Array(range.days)].map((_, i) => addDays(range.from, i));
  const width = range.days * DW;
  const todayX = xOf(startOfDay(new Date()));

  return (
    <div className="panel overflow-hidden" onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={onUp}>
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        <h3 className="section-title">Timeline</h3><span className="text-xs text-muted">{rows.length} scheduled tasks. Drag a bar to move it, drag its right edge to change the due date.</span>
        <div className="ml-auto flex items-center gap-2">
          <button type="button" className="btn-ghost btn-sm" onClick={() => setOffset((o) => o - 7)} aria-label="Earlier"><ChevronLeft size={14} /></button>
          <button type="button" className="btn-ghost btn-sm" onClick={() => { setOffset(0); if (scroller.current) scroller.current.scrollLeft = Math.max(0, todayX - 200); }}>Today</button>
          <button type="button" className="btn-ghost btn-sm" onClick={() => setOffset((o) => o + 7)} aria-label="Later"><ChevronRight size={14} /></button>
          <Segmented size="sm" value={zoom} onChange={setZoom} options={[{ value: 'day', label: 'Days' }, { value: 'week', label: 'Weeks' }]} />
        </div>
      </div>
      <div className="flex">
        <div className="w-[240px] shrink-0 border-r border-line bg-surface">
          <div className="h-[52px] border-b border-line px-3 pt-7 text-xs font-semibold text-muted">Task</div>
          {(data.milestones || []).length > 0 && <div className="flex h-8 items-center border-b border-line px-3 text-xs text-muted">Milestones</div>}
          {rows.map((r) => (
            <button key={r.id} type="button" onClick={() => openTask(r.id)} className="flex w-full items-center gap-2 border-b border-line/60 px-3 text-left hover:bg-sunken/60" style={{ height: ROW, paddingLeft: 12 + r.depth * 12 }}>
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: STATUS[r.status]?.color }} />
              <span className="min-w-0 flex-1 truncate text-sm">{r.title}</span>
              {r.assignees?.[0] && <Avatar user={r.assignees[0]} size={18} />}
            </button>
          ))}
        </div>
        <div ref={scroller} className="flex-1 overflow-x-auto">
          <div className="relative select-none" style={{ width }}>
            <div className="flex h-[52px] border-b border-line">
              {days.map((d) => (
                <div key={d.toISOString()} className={clsx('shrink-0 border-r border-line/50 text-center', isWeekend(d) && 'bg-sunken/60')} style={{ width: DW }}>
                  {(zoom === 'day' || d.getDay() === 1) && <>
                    <div className="pt-1 text-[10px] font-semibold text-faint">{d.getDate() === 1 || d === days[0] ? format(d, 'MMM') : zoom === 'day' ? format(d, 'EEEEE') : ''}</div>
                    <div className={clsx('mx-auto mt-0.5 grid h-6 w-6 place-items-center rounded-full text-[11px] font-semibold', isToday(d) ? 'bg-brand text-brand-ink' : 'text-muted')}>{format(d, 'd')}</div>
                  </>}
                </div>
              ))}
            </div>
            <div className="pointer-events-none absolute bottom-0 top-[52px] flex">
              {days.map((d) => <div key={d.toISOString()} className={clsx('shrink-0 border-r border-line/40', isWeekend(d) && 'bg-sunken/40')} style={{ width: DW }} />)}
            </div>
            {(data.milestones || []).length > 0 && (
              <div className="relative h-8 border-b border-line">
                {data.milestones.filter((m) => m.dueDate).map((m) => (
                  <div key={m.id} className="absolute top-1.5 flex items-center gap-1 whitespace-nowrap text-[11px] font-semibold" style={{ left: xOf(toDate(m.dueDate)) + DW / 2 - 6 }} title={m.title}>
                    <span className={clsx('h-3 w-3 rotate-45 rounded-[2px]', m.done ? 'bg-leaf' : 'bg-brand')} /><span className="text-muted">{m.title}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="relative" style={{ height: rows.length * ROW }}>
              <div className="pointer-events-none absolute bottom-0 top-0 w-0.5 bg-brand" style={{ left: todayX + DW / 2 }} />
              <svg className="pointer-events-none absolute inset-0" width={width} height={rows.length * ROW}>
                {data.dependencies.filter((d) => idx[d.taskId] != null && idx[d.blockerId] != null).map((d) => {
                  const a = geom(rows[idx[d.blockerId]]); const b = geom(rows[idx[d.taskId]]);
                  const x1 = a.x + a.w; const y1 = idx[d.blockerId] * ROW + ROW / 2; const x2 = b.x; const y2 = idx[d.taskId] * ROW + ROW / 2;
                  const mid = Math.max(x1 + 8, Math.min(x2 - 8, x1 + 12));
                  return <path key={`${d.taskId}-${d.blockerId}`} d={`M${x1},${y1} H${mid} V${y2} H${x2 - 2}`} fill="none" stroke={x2 < x1 ? 'rgb(var(--c-ember))' : 'rgb(var(--c-faint))'} strokeWidth="1.5" markerEnd="url(#arr)" />;
                })}
                <defs><marker id="arr" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 z" fill="rgb(var(--c-faint))" /></marker></defs>
              </svg>
              {rows.map((r, i) => {
                const g = geom(r);
                const color = STATUS[r.status]?.color;
                return (
                  <div key={r.id} className="absolute" style={{ top: i * ROW + 8, left: g.x, width: g.w, height: ROW - 16 }}>
                    <div onMouseDown={(e) => onDown(e, r, 'move')} title={`${r.key} ${r.title}: ${format(g.start, 'd MMM')} to ${format(g.end, 'd MMM')}`}
                      className={clsx('group flex h-full cursor-grab items-center overflow-hidden rounded-lg px-2 text-[11px] font-semibold text-white shadow-sm active:cursor-grabbing', drag?.id === r.id && 'ring-2 ring-ink/30')}
                      style={{ background: color }}>
                      <span className="truncate">{zoom === 'day' && g.w > 60 ? r.title : ''}</span>
                      <span onMouseDown={(e) => onDown(e, r, 'resize')} className="absolute right-0 top-0 h-full w-2 cursor-ew-resize rounded-r-lg bg-black/0 hover:bg-black/20" />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
