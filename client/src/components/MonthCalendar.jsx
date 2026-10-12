import { useMemo } from 'react';
import clsx from 'clsx';
import { addDays, addMonths, endOfMonth, endOfWeek, format, isSameDay, isSameMonth, isToday, startOfMonth, startOfWeek } from 'date-fns';
import { ChevronLeft, ChevronRight } from 'lucide-react';

/**
 * items: [{ id, date, title, color, kind: 'task'|'meeting'|'milestone', done }]
 */
export default function MonthCalendar({ month, setMonth, items, selected, onSelectDay, onItemClick, onDropItem }) {
  const from = startOfWeek(startOfMonth(month), { weekStartsOn: 1 });
  const to = endOfWeek(endOfMonth(month), { weekStartsOn: 1 });
  const days = useMemo(() => { const out = []; for (let d = from; d <= to; d = addDays(d, 1)) out.push(d); return out; }, [month]); // eslint-disable-line react-hooks/exhaustive-deps
  const on = (d) => items.filter((i) => isSameDay(new Date(i.date), d)).sort((a, b) => new Date(a.date) - new Date(b.date));
  return (
    <div className="panel overflow-hidden">
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <h3 className="font-display text-lg font-semibold">{format(month, 'MMMM yyyy')}</h3>
        <div className="ml-auto flex gap-1">
          <button type="button" className="btn-ghost btn-sm" onClick={() => setMonth(addMonths(month, -1))} aria-label="Previous month"><ChevronLeft size={15} /></button>
          <button type="button" className="btn-ghost btn-sm" onClick={() => setMonth(startOfMonth(new Date()))}>Today</button>
          <button type="button" className="btn-ghost btn-sm" onClick={() => setMonth(addMonths(month, 1))} aria-label="Next month"><ChevronRight size={15} /></button>
        </div>
      </div>
      <div className="grid grid-cols-7 border-b border-line bg-sunken/50 text-center text-xs font-semibold text-muted">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d} className="py-2">{d}</div>)}</div>
      <div className="grid grid-cols-7">
        {days.map((d) => {
          const list = on(d);
          return (
            <div key={d.toISOString()} role="button" tabIndex={0} onClick={() => onSelectDay?.(d)} onKeyDown={(e) => e.key === 'Enter' && onSelectDay?.(d)}
              onDragOver={onDropItem ? (e) => e.preventDefault() : undefined} onDrop={onDropItem ? (e) => { e.preventDefault(); onDropItem(Number(e.dataTransfer.getData('text/task')), d); } : undefined}
              className={clsx('min-h-[108px] cursor-pointer border-b border-r border-line/70 p-1.5 text-left align-top transition hover:bg-sunken/40', !isSameMonth(d, month) && 'bg-sunken/30 text-faint', selected && isSameDay(d, selected) && 'bg-brand-soft/50')}>
              <span className={clsx('mb-1 inline-grid h-6 min-w-[24px] place-items-center rounded-full px-1 text-xs font-semibold', isToday(d) ? 'bg-ink text-surface' : 'text-muted')}>{format(d, 'd')}</span>
              <div className="space-y-1">
                {list.slice(0, 3).map((it) => (
                  <button key={`${it.kind}-${it.id}`} type="button" draggable={it.kind === 'task' && !!onDropItem} onDragStart={(e) => e.dataTransfer.setData('text/task', String(it.id))}
                    onClick={(e) => { e.stopPropagation(); onItemClick?.(it); }}
                    className={clsx('flex w-full items-center gap-1 truncate rounded-md px-1.5 py-0.5 text-left text-[11px] font-medium', it.done && 'line-through opacity-60')}
                    style={{ background: `${it.color}1F`, color: it.color }}>
                    {it.kind === 'meeting' && <span>●</span>}{it.kind === 'milestone' && <span>◆</span>}<span className="truncate">{it.kind === 'meeting' ? `${format(new Date(it.date), 'h:mm')} ` : ''}{it.title}</span>
                  </button>
                ))}
                {list.length > 3 && <div className="px-1 text-[10px] font-semibold text-muted">+{list.length - 3} more</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
