import { useEffect, useMemo, useRef, useState } from 'react';
import { X, Check, ChevronDown, Search, Flag, CalendarClock, Loader2 } from 'lucide-react';
import clsx from 'clsx';
import { STATUS, PRIORITY, dueLabel, initials } from '../lib/format';

/**
 * The signature element: a progress ring with a glowing "satellite" riding at the progress angle.
 */
export function OrbitRing({ value = 0, size = 64, stroke = 5, color = '#3DE0F2', track = 'rgba(150,168,255,.14)', label = true, sub }) {
  const r = (size - stroke) / 2 - 3;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, value));
  const angle = (v / 100) * 2 * Math.PI - Math.PI / 2;
  const cx = size / 2 + r * Math.cos(angle);
  const cy = size / 2 + r * Math.sin(angle);
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={`${v}% complete`}>
      <svg width={size} height={size} className="block">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - v / 100)} transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: 'stroke-dashoffset .8s cubic-bezier(.2,.8,.2,1)', filter: `drop-shadow(0 0 6px ${color}88)` }} />
        {v > 0 && v < 100 && (
          <circle key={v} className="orbit-dot" cx={cx} cy={cy} r={stroke * 0.9} fill="#E8ECFF" style={{ filter: `drop-shadow(0 0 6px ${color})` }} />
        )}
      </svg>
      {label && (
        <div className="absolute inset-0 grid place-items-center text-center leading-none">
          <div>
            <div className="font-display font-semibold" style={{ fontSize: Math.max(11, size * 0.24) }}>{v}<span className="text-mist" style={{ fontSize: '0.6em' }}>%</span></div>
            {sub && <div className="mt-0.5 text-[10px] text-mist">{sub}</div>}
          </div>
        </div>
      )}
    </div>
  );
}

export function Bar({ value = 0, color = '#3DE0F2', className }) {
  return (
    <div className={clsx('h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]', className)}>
      <div className="h-full rounded-full transition-all duration-700" style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: color, boxShadow: `0 0 10px ${color}66` }} />
    </div>
  );
}

export function Avatar({ user, size = 28, ring = false, online }) {
  if (!user) return null;
  return (
    <span className="relative inline-grid shrink-0 place-items-center rounded-full font-semibold text-space"
      title={user.name}
      style={{ width: size, height: size, fontSize: size * 0.38, background: user.color || '#8F7BFF', boxShadow: ring ? '0 0 0 2px #141B42' : undefined }}>
      {initials(user.name)}
      {online && <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-space-2 bg-mint" />}
    </span>
  );
}

export function AvatarStack({ users = [], max = 3, size = 24 }) {
  if (!users.length) return <span className="text-xs text-mist">Unassigned</span>;
  return (
    <div className="flex items-center -space-x-1.5">
      {users.slice(0, max).map((u) => <Avatar key={u.id} user={u} size={size} ring />)}
      {users.length > max && <span className="grid place-items-center rounded-full bg-space-3 text-[10px] font-semibold text-mist" style={{ width: size, height: size, boxShadow: '0 0 0 2px #141B42' }}>+{users.length - max}</span>}
    </div>
  );
}

export function StatusPill({ status, small }) {
  const s = STATUS[status] || STATUS.todo;
  return (
    <span className={clsx('chip whitespace-nowrap', small && 'px-1.5')} style={{ color: s.color, background: `${s.color}1A`, border: `1px solid ${s.color}33` }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: s.color, boxShadow: `0 0 6px ${s.color}` }} />
      {s.label}
    </span>
  );
}

export function PriorityFlag({ priority, showLabel = false }) {
  const p = PRIORITY[priority] || PRIORITY.medium;
  return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold" style={{ color: p.color }} title={`${p.label} priority`}>
      <Flag size={13} fill={priority === 'urgent' || priority === 'high' ? p.color : 'none'} />
      {showLabel && p.label}
    </span>
  );
}

export function DueBadge({ date, done }) {
  const d = dueLabel(date, done);
  if (!d) return null;
  return (
    <span className={clsx('inline-flex items-center gap-1 text-xs font-medium', d.overdue ? 'text-rose' : d.soon ? 'text-flare' : 'text-mist')}>
      <CalendarClock size={13} />{d.overdue ? `Overdue, ${d.text.toLowerCase().startsWith('yesterday') ? 'yesterday' : d.text}` : d.text}
    </span>
  );
}

export function Spinner({ className }) {
  return <Loader2 className={clsx('animate-spin text-signal', className)} size={20} />;
}

export function PageLoader() {
  return <div className="grid h-64 place-items-center"><Spinner /></div>;
}

export function Empty({ icon: Icon, title, body, action }) {
  return (
    <div className="grid place-items-center px-6 py-14 text-center">
      {Icon && <div className="mb-4 grid h-12 w-12 place-items-center rounded-2xl border border-line bg-white/[0.03] text-signal"><Icon size={22} /></div>}
      <h3 className="text-base font-semibold">{title}</h3>
      {body && <p className="mt-1 max-w-sm text-sm text-mist">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Modal({ open, onClose, title, children, width = 'max-w-xl', footer }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-space-deep/70 p-0 backdrop-blur-sm sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={clsx('panel rise flex max-h-[92vh] w-full flex-col rounded-b-none sm:rounded-2xl', width)} role="dialog" aria-modal="true" aria-label={title}>
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button type="button" className="rounded-lg p-1.5 text-mist hover:bg-white/5 hover:text-star" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, children, hint, className }) {
  return (
    <label className={clsx('block', className)}>
      {label && <span className="label">{label}</span>}
      {children}
      {hint && <span className="mt-1 block text-[11px] text-mist">{hint}</span>}
    </label>
  );
}

export function Toggle({ checked, onChange, label, hint }) {
  return (
    <button type="button" onClick={() => onChange(!checked)} className="flex w-full items-start justify-between gap-4 text-left">
      <span>
        <span className="block text-sm font-medium">{label}</span>
        {hint && <span className="block text-xs text-mist">{hint}</span>}
      </span>
      <span className={clsx('relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition', checked ? 'bg-signal' : 'bg-white/10')} role="switch" aria-checked={checked}>
        <span className={clsx('absolute top-0.5 h-4 w-4 rounded-full bg-star transition-all', checked ? 'left-[18px]' : 'left-0.5')} />
      </span>
    </button>
  );
}

export function Segmented({ value, onChange, options }) {
  return (
    <div className="inline-flex rounded-xl border border-line bg-space-deep/50 p-0.5">
      {options.map((o) => (
        <button key={o.value} type="button" onClick={() => onChange(o.value)}
          className={clsx('inline-flex items-center gap-1.5 rounded-[10px] px-3 py-1.5 text-xs font-semibold transition', value === o.value ? 'bg-white/[0.09] text-star' : 'text-mist hover:text-star')}>
          {o.icon && <o.icon size={14} />}{o.label}
        </button>
      ))}
    </div>
  );
}

/** Searchable people picker. multiple=true → array of ids. */
export function UserPicker({ users = [], value, onChange, multiple = true, placeholder = 'Pick people', disabled }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef(null);
  useEffect(() => {
    const h = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h);
  }, []);
  const selected = multiple ? (value || []) : (value ? [value] : []);
  const list = useMemo(() => users.filter((u) => u.name.toLowerCase().includes(q.toLowerCase())), [users, q]);
  const toggle = (id) => {
    if (multiple) onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
    else { onChange(selected[0] === id ? null : id); setOpen(false); }
  };
  const chosen = users.filter((u) => selected.includes(u.id));
  return (
    <div className="relative" ref={ref}>
      <button type="button" disabled={disabled} onClick={() => setOpen((o) => !o)} className="input flex min-h-[38px] items-center justify-between gap-2 text-left">
        {chosen.length ? (
          <span className="flex flex-wrap items-center gap-1.5">
            {chosen.map((u) => <span key={u.id} className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.06] py-0.5 pl-0.5 pr-2 text-xs"><Avatar user={u} size={18} />{u.name.split(' ')[0]}</span>)}
          </span>
        ) : <span className="text-mist/70">{placeholder}</span>}
        <ChevronDown size={16} className="shrink-0 text-mist" />
      </button>
      {open && (
        <div className="panel absolute z-30 mt-1 w-full overflow-hidden p-1">
          <div className="flex items-center gap-2 border-b border-line px-2 pb-1.5 pt-1">
            <Search size={14} className="text-mist" />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" className="w-full bg-transparent text-sm outline-none" />
          </div>
          <div className="max-h-56 overflow-y-auto py-1">
            {list.map((u) => (
              <button type="button" key={u.id} onClick={() => toggle(u.id)} className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-white/[0.05]">
                <Avatar user={u} size={24} />
                <span className="min-w-0 flex-1"><span className="block truncate">{u.name}</span><span className="block truncate text-[11px] text-mist">{u.designation || u.Role?.name}</span></span>
                {selected.includes(u.id) && <Check size={15} className="text-signal" />}
              </button>
            ))}
            {!list.length && <div className="px-2 py-3 text-center text-xs text-mist">No one matches “{q}”</div>}
          </div>
        </div>
      )}
    </div>
  );
}

export function StatTile({ label, value, tone = '#3DE0F2', icon: Icon, hint, onClick }) {
  const C = onClick ? 'button' : 'div';
  return (
    <C onClick={onClick} className={clsx('panel-quiet flex items-center gap-3 p-4 text-left', onClick && 'transition hover:border-signal/40')}>
      {Icon && <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl" style={{ background: `${tone}18`, color: tone }}><Icon size={19} /></span>}
      <span className="min-w-0">
        <span className="block font-display text-2xl font-semibold leading-none">{value}</span>
        <span className="mt-1 block truncate text-xs text-mist">{label}{hint && <span className="text-mist/70"> — {hint}</span>}</span>
      </span>
    </C>
  );
}

export const COLORS = ['#3DE0F2', '#8F7BFF', '#5BE3A6', '#FFB648', '#FF7A90', '#62D2FF', '#B8A6FF', '#7EF0C9'];
export function ColorPicker({ value, onChange }) {
  return (
    <div className="flex flex-wrap gap-2">
      {COLORS.map((c) => (
        <button type="button" key={c} onClick={() => onChange(c)} aria-label={`Colour ${c}`}
          className={clsx('h-7 w-7 rounded-full transition', value === c ? 'ring-2 ring-star ring-offset-2 ring-offset-space-2' : 'opacity-70 hover:opacity-100')} style={{ background: c }} />
      ))}
    </div>
  );
}
