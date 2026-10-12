import clsx from 'clsx';
import { useEffect, useState } from 'react';
import { AreaChart, Area, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, PieChart, Pie, Cell } from 'recharts';
import { format } from 'date-fns';
import { STATUS, PRIORITY } from '../lib/format';

/** Reads design tokens so charts follow the light/dark theme. */
export function useTokens() {
  const read = () => {
    const cs = getComputedStyle(document.documentElement);
    const v = (n) => `rgb(${cs.getPropertyValue(`--c-${n}`).trim().split(' ').join(',')})`;
    return { s1: v('s1'), s2: v('s2'), ink: v('ink'), muted: v('muted'), faint: v('faint'), line: v('line'), surface: v('surface'), sunken: v('sunken') };
  };
  const [t, setT] = useState(read);
  useEffect(() => {
    const obs = new MutationObserver(() => setT(read()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);
  return t;
}

function Legend({ items }) {
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 rounded" style={{ background: i.color, borderTop: i.dashed ? `2px dashed ${i.color}` : undefined, height: i.dashed ? 0 : 2 }} />{i.label}
        </span>
      ))}
    </div>
  );
}

function TipBox({ active, payload, label, fmtLabel }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-line bg-surface px-3 py-2 text-xs shadow-lift">
      <div className="mb-1 font-semibold text-ink">{fmtLabel ? fmtLabel(label) : label}</div>
      {payload.filter((p) => p.value != null).map((p) => (
        <div key={p.dataKey} className="flex items-center gap-2 text-muted"><span className="h-2 w-2 rounded-full" style={{ background: p.color || p.stroke }} />{p.name}<span className="ml-auto pl-3 font-semibold text-ink">{p.value}</span></div>
      ))}
    </div>
  );
}

const dayFmt = (d) => format(new Date(`${d}T12:00:00`), 'd MMM');

export function VelocityChart({ data, height = 220 }) {
  const t = useTokens();
  return (
    <div>
      <div className="mb-2 flex justify-end"><Legend items={[{ label: 'Created', color: t.s2 }, { label: 'Completed', color: t.s1 }]} /></div>
      <div style={{ height }}>
        <ResponsiveContainer>
          <AreaChart data={data} margin={{ left: -22, right: 6, top: 6, bottom: 0 }}>
            <defs>
              <linearGradient id="vC" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={t.s1} stopOpacity={0.18} /><stop offset="100%" stopColor={t.s1} stopOpacity={0} /></linearGradient>
            </defs>
            <CartesianGrid stroke={t.line} strokeDasharray="0" vertical={false} />
            <XAxis dataKey="day" tickFormatter={dayFmt} tick={{ fill: t.faint, fontSize: 11 }} axisLine={false} tickLine={false} interval={2} />
            <YAxis allowDecimals={false} tick={{ fill: t.faint, fontSize: 11 }} axisLine={false} tickLine={false} />
            <Tooltip content={<TipBox fmtLabel={dayFmt} />} cursor={{ stroke: t.faint, strokeWidth: 1 }} />
            <Area type="monotone" dataKey="created" name="Created" stroke={t.s2} fill="none" strokeWidth={2} dot={false} activeDot={{ r: 4, stroke: t.surface, strokeWidth: 2 }} />
            <Area type="monotone" dataKey="completed" name="Completed" stroke={t.s1} fill="url(#vC)" strokeWidth={2} dot={false} activeDot={{ r: 4, stroke: t.surface, strokeWidth: 2 }} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function BurndownChart({ data, height = 220, xKey = 'day', remainingKey = 'remaining', label = 'Open tasks' }) {
  const t = useTokens();
  return (
    <div>
      <div className="mb-2 flex justify-end"><Legend items={[{ label, color: t.s1 }, { label: 'Ideal pace', color: t.faint, dashed: true }]} /></div>
      <div style={{ height }}>
        <ResponsiveContainer>
          <LineChart data={data} margin={{ left: -22, right: 6, top: 6, bottom: 0 }}>
            <CartesianGrid stroke={t.line} vertical={false} />
            <XAxis dataKey={xKey} tickFormatter={dayFmt} tick={{ fill: t.faint, fontSize: 11 }} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={24} />
            <YAxis allowDecimals={false} tick={{ fill: t.faint, fontSize: 11 }} axisLine={false} tickLine={false} />
            <Tooltip content={<TipBox fmtLabel={dayFmt} />} cursor={{ stroke: t.faint, strokeWidth: 1 }} />
            <Line type="linear" dataKey="ideal" name="Ideal pace" stroke={t.faint} strokeDasharray="5 5" strokeWidth={1.5} dot={false} />
            <Line type="monotone" dataKey={remainingKey} name={label} stroke={t.s1} strokeWidth={2} dot={false} connectNulls={false} activeDot={{ r: 4, stroke: t.surface, strokeWidth: 2 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/** Status donut: status colors are state colors, labelled in the list beside it. */
export function StatusDonut({ data, size = 150, onSelect }) {
  const t = useTokens();
  const rows = data.filter((d) => d.count > 0);
  const total = rows.reduce((s, d) => s + d.count, 0);
  return (
    <div className="flex flex-wrap items-center gap-5">
      <div className="relative" style={{ width: size, height: size }}>
        <ResponsiveContainer>
          <PieChart>
            <Pie data={rows} dataKey="count" nameKey="status" innerRadius={size * 0.34} outerRadius={size / 2 - 2} paddingAngle={rows.length > 1 ? 2 : 0} stroke={t.surface} strokeWidth={2} isAnimationActive={false}>
              {rows.map((d) => <Cell key={d.status} fill={STATUS[d.status]?.color} />)}
            </Pie>
            <Tooltip content={({ active, payload }) => (active && payload?.[0] ? <div className="rounded-xl border border-line bg-surface px-3 py-2 text-xs shadow-lift"><b>{STATUS[payload[0].payload.status]?.label}</b>: {payload[0].value}</div> : null)} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center"><div><div className="font-display text-2xl font-semibold">{total}</div><div className="text-[11px] text-muted">tasks</div></div></div>
      </div>
      <ul className="min-w-[150px] flex-1 space-y-1.5 text-sm">
        {data.map((d) => {
          const C = onSelect ? 'button' : 'div';
          return (
            <li key={d.status}>
              <C {...(onSelect ? { type: 'button', onClick: () => onSelect(d.status), title: `Open ${STATUS[d.status]?.label} tasks` } : {})} className={clsx('flex w-full items-center gap-2 rounded-lg text-left', onSelect && '-mx-1.5 px-1.5 py-0.5 transition hover:bg-sunken')}>
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: STATUS[d.status]?.color }} />
                <span className="flex-1 whitespace-nowrap text-muted">{STATUS[d.status]?.label}</span>
                <span className="font-semibold">{d.count}</span>
                <span className="w-10 text-right text-xs text-faint">{total ? Math.round((d.count / total) * 100) : 0}%</span>
              </C>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function PriorityBars({ data, onSelect }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  const total = data.reduce((s, d) => s + d.count, 0);
  return (
    <ul className="space-y-3">
      {data.map((d) => (
        <li key={d.priority} {...(onSelect ? { role: 'button', tabIndex: 0, onClick: () => onSelect(d.priority), onKeyDown: (e) => e.key === 'Enter' && onSelect(d.priority), className: '-mx-2 cursor-pointer rounded-lg px-2 py-1 transition hover:bg-sunken' } : {})}>
          <div className="mb-1 flex items-center justify-between text-sm"><span className="font-medium">{PRIORITY[d.priority].label}</span><span className="text-muted"><b className="text-ink">{d.count}</b> <span className="text-xs text-faint">({total ? Math.round((d.count / total) * 100) : 0}%)</span></span></div>
          <div className="h-2 overflow-hidden rounded-full bg-sunken" title={`${d.count} ${PRIORITY[d.priority].label.toLowerCase()} priority`}><div className="h-full rounded-full" style={{ width: `${(d.count / max) * 100}%`, background: PRIORITY[d.priority].color }} /></div>
        </li>
      ))}
    </ul>
  );
}
