import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Check, ChevronDown, Search, Flag, CalendarClock, Loader2, Eye, EyeOff } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import clsx from 'clsx';
import { STATUS, PRIORITY, HEALTH, PALETTE, dueLabel, initials } from '../lib/format';

/** Signature progress ring with a small "satellite" riding at the progress angle. */
export function OrbitRing({ value = 0, size = 64, stroke = 5, color = 'rgb(var(--c-cobalt))', track = 'rgb(var(--c-line))', label = true, sub, dark = false }) {
  const r = (size - stroke) / 2 - 3;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, Math.round(value)));
  const angle = (v / 100) * 2 * Math.PI - Math.PI / 2;
  const cx = size / 2 + r * Math.cos(angle);
  const cy = size / 2 + r * Math.sin(angle);
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={`${v}% complete`}>
      <svg width={size} height={size} className="block">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={dark ? 'rgb(var(--c-night-line))' : track} strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - v / 100)} transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: 'stroke-dashoffset .8s cubic-bezier(.2,.8,.2,1)' }} />
        {v > 0 && v < 100 && <circle key={v} className="orbit-dot" cx={cx} cy={cy} r={stroke * 0.85} fill={dark ? '#FFC21A' : 'rgb(var(--c-surface))'} stroke={color} strokeWidth={Math.max(1.5, stroke * 0.45)} />}
      </svg>
      {label && (
        <div className="absolute inset-0 grid place-items-center text-center leading-none">
          <div>
            <div className={clsx('font-display font-semibold', dark ? 'text-white' : 'text-ink')} style={{ fontSize: Math.max(11, size * 0.25) }}>{v}<span className="opacity-50" style={{ fontSize: '0.55em' }}>%</span></div>
            {sub && <div className={clsx('mt-0.5 text-[10px]', dark ? 'text-white/60' : 'text-muted')}>{sub}</div>}
          </div>
        </div>
      )}
    </div>
  );
}

export function Bar({ value = 0, color = 'rgb(var(--c-cobalt))', className, height = 6 }) {
  return (
    <div className={clsx('w-full overflow-hidden rounded-full bg-sunken', className)} style={{ height }}>
      <div className="h-full rounded-full transition-all duration-700" style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: color }} />
    </div>
  );
}

export function Avatar({ user, size = 28, ring = false, online, title }) {
  if (!user) return null;
  return (
    <span className="relative inline-grid shrink-0 select-none place-items-center rounded-full font-semibold text-white"
      title={title || user.name}
      style={{ width: size, height: size, fontSize: Math.max(9, size * 0.38), background: user.color || '#3D5AFE', boxShadow: ring ? '0 0 0 2px rgb(var(--c-surface))' : undefined }}>
      {initials(user.name)}
      {online && <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-surface bg-leaf" />}
    </span>
  );
}

export function AvatarStack({ users = [], max = 3, size = 24, emptyLabel = 'Unassigned' }) {
  if (!users?.length) return emptyLabel ? <span className="text-xs text-faint">{emptyLabel}</span> : null;
  return (
    <div className="flex items-center -space-x-1.5">
      {users.slice(0, max).map((u) => <Avatar key={u.id} user={u} size={size} ring />)}
      {users.length > max && <span className="grid place-items-center rounded-full bg-sunken text-[10px] font-semibold text-muted" style={{ width: size, height: size, boxShadow: '0 0 0 2px rgb(var(--c-surface))' }}>+{users.length - max}</span>}
    </div>
  );
}

export function StatusPill({ status, small }) {
  const s = STATUS[status] || STATUS.todo;
  return (
    <span className={clsx('chip', small && 'px-1.5 text-[10px]')} style={{ color: s.color, background: `${s.color}17` }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: s.color }} />{s.label}
    </span>
  );
}

export function PriorityFlag({ priority, showLabel = false }) {
  const p = PRIORITY[priority] || PRIORITY.medium;
  return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold" style={{ color: p.color }} title={`${p.label} priority`}>
      <Flag size={13} fill={priority === 'urgent' || priority === 'high' ? p.color : 'none'} />{showLabel && p.label}
    </span>
  );
}

export function PriorityChip({ priority }) {
  const p = PRIORITY[priority] || PRIORITY.medium;
  return <span className="chip" style={{ color: p.color, background: `${p.color}17` }}>{p.label}</span>;
}

export function HealthBadge({ state, score }) {
  const h = HEALTH[state] || HEALTH.on_track;
  return <span className="chip" style={{ color: h.color, background: `${h.color}17` }}><span className="h-1.5 w-1.5 rounded-full" style={{ background: h.color }} />{h.label}{score != null && <span className="opacity-60">{score}</span>}</span>;
}

export function DueBadge({ date, done, compact }) {
  const d = dueLabel(date, done);
  if (!d) return null;
  return (
    <span className={clsx('inline-flex items-center gap-1 text-xs font-medium', d.overdue ? 'text-ember' : d.soon ? 'text-amber' : 'text-muted')}>
      <CalendarClock size={13} />{d.overdue && !compact ? `Overdue, ${d.text.charAt(0).toLowerCase()}${d.text.slice(1)}` : d.text}
    </span>
  );
}

export function Spinner({ className, size = 18 }) { return <Loader2 className={clsx('animate-spin text-cobalt', className)} size={size} />; }

export function PageLoader() {
  return (
    <div className="space-y-4" aria-busy="true">
      <div className="h-8 w-56 animate-pulse rounded-lg bg-sunken" />
      <div className="grid gap-4 md:grid-cols-3">{[0, 1, 2].map((i) => <div key={i} className="h-28 animate-pulse rounded-xl2 bg-sunken" />)}</div>
      <div className="h-64 animate-pulse rounded-xl2 bg-sunken" />
    </div>
  );
}

export function Empty({ icon: Icon, title, body, action, compact }) {
  return (
    <div className={clsx('grid place-items-center px-6 text-center', compact ? 'py-8' : 'py-14')}>
      {Icon && <div className="mb-3 grid h-11 w-11 place-items-center rounded-2xl bg-brand-soft text-ink"><Icon size={20} /></div>}
      <h3 className="text-base font-semibold">{title}</h3>
      {body && <p className="mt-1 max-w-sm text-sm text-muted">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions, children }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-[26px] font-semibold leading-tight sm:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
        {children}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Panel({ title, subtitle, action, children, className, bodyClass, icon: Icon }) {
  return (
    <section className={clsx('panel', className)}>
      {(title || action) && (
        <header className="flex items-start justify-between gap-3 px-5 pb-2 pt-4">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 section-title">{Icon && <Icon size={16} className="text-muted" />}{title}</h2>
            {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      <div className={clsx('px-5 pb-5', !title && !action && 'pt-5', bodyClass)}>{children}</div>
    </section>
  );
}

export function Modal({ open, onClose, title, children, width = 'max-w-xl', footer, subtitle }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-night/40 p-0 backdrop-blur-[2px] sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={clsx('flex max-h-[92vh] w-full animate-rise flex-col rounded-t-2xl border border-line bg-surface shadow-pop sm:rounded-2xl', width)} role="dialog" aria-modal="true" aria-label={title}>
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div><h2 className="text-lg font-semibold">{title}</h2>{subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}</div>
          <button type="button" className="rounded-lg p-1.5 text-muted hover:bg-sunken hover:text-ink" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>, document.body,
  );
}

export function Drawer({ open, onClose, children, width = 'max-w-[760px]' }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && !document.querySelector('[role=dialog][aria-modal=true]') && onClose?.();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end bg-night/25" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <aside className={clsx('h-full w-full animate-slide-in overflow-y-auto border-l border-line bg-canvas shadow-pop', width)} role="complementary">{children}</aside>
    </div>, document.body,
  );
}

export function Field({ label, children, hint, className }) {
  return (
    <label className={clsx('block', className)}>
      {label && <span className="label">{label}</span>}
      {children}
      {hint && <span className="mt-1 block text-[11px] text-faint">{hint}</span>}
    </label>
  );
}

export function Toggle({ checked, onChange, label, hint, disabled }) {
  return (
    <button type="button" disabled={disabled} onClick={() => onChange(!checked)} className="flex w-full items-start justify-between gap-4 text-left disabled:opacity-60">
      <span>
        <span className="block text-sm font-medium">{label}</span>
        {hint && <span className="block text-xs text-muted">{hint}</span>}
      </span>
      <span className={clsx('relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition', checked ? 'bg-ink' : 'bg-line')} role="switch" aria-checked={checked}>
        <span className={clsx('absolute top-0.5 h-4 w-4 rounded-full transition-all', checked ? 'left-[18px] bg-brand' : 'left-0.5 bg-surface')} />
      </span>
    </button>
  );
}

export function Segmented({ value, onChange, options, size = 'md' }) {
  return (
    <div className="inline-flex rounded-xl bg-sunken p-0.5">
      {options.map((o) => (
        <button key={o.value} type="button" onClick={() => onChange(o.value)} title={o.title}
          className={clsx('inline-flex items-center gap-1.5 rounded-[10px] font-semibold transition', size === 'sm' ? 'px-2 py-1 text-[11px]' : 'px-3 py-1.5 text-xs',
            value === o.value ? 'bg-surface text-ink shadow-[0_1px_2px_rgb(var(--c-ink)/0.1)]' : 'text-muted hover:text-ink')}>
          {o.icon && <o.icon size={14} />}{o.label}{o.count != null && <span className="text-faint">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Tabs({ value, onChange, tabs }) {
  return (
    <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
      {tabs.map((t) => (
        <button key={t.value} type="button" onClick={() => onChange(t.value)}
          className={clsx('inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold transition',
            value === t.value ? 'bg-ink text-surface' : 'text-muted hover:bg-sunken hover:text-ink')}>
          {t.icon && <t.icon size={15} />}{t.label}{t.count != null && <span className={clsx('rounded-full px-1.5 text-[10px]', value === t.value ? 'bg-surface/20' : 'bg-sunken')}>{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

/** Searchable people picker. multiple=true → array of ids. */
export function UserPicker({ users = [], value, onChange, multiple = true, placeholder = 'Pick people', disabled, compact }) {
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
      <button type="button" disabled={disabled} onClick={() => setOpen((o) => !o)} className={clsx('input flex items-center justify-between gap-2 text-left', compact ? 'min-h-[34px] !py-1' : 'min-h-[38px]')}>
        {chosen.length ? (
          <span className="flex flex-wrap items-center gap-1.5">
            {chosen.map((u) => <span key={u.id} className="inline-flex items-center gap-1.5 rounded-full bg-sunken py-0.5 pl-0.5 pr-2 text-xs"><Avatar user={u} size={18} />{u.name.split(' ')[0]}</span>)}
          </span>
        ) : <span className="text-faint">{placeholder}</span>}
        <ChevronDown size={16} className="shrink-0 text-muted" />
      </button>
      {open && (
        <div className="absolute z-40 mt-1 w-full min-w-[220px] overflow-hidden rounded-xl border border-line bg-surface p-1 shadow-lift">
          <div className="flex items-center gap-2 border-b border-line px-2 pb-1.5 pt-1">
            <Search size={14} className="text-muted" />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" className="w-full bg-transparent text-sm outline-none" />
          </div>
          <div className="max-h-60 overflow-y-auto py-1">
            {list.map((u) => (
              <button type="button" key={u.id} onClick={() => toggle(u.id)} className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-sunken">
                <Avatar user={u} size={24} />
                <span className="min-w-0 flex-1"><span className="block truncate">{u.name}</span><span className="block truncate text-[11px] text-muted">{u.designation || u.Role?.name}</span></span>
                {selected.includes(u.id) && <Check size={15} className="text-cobalt" />}
              </button>
            ))}
            {!list.length && <div className="px-2 py-3 text-center text-xs text-muted">No one matches “{q}”</div>}
          </div>
        </div>
      )}
    </div>
  );
}

export function ColorPicker({ value, onChange, colors = PALETTE }) {
  return (
    <div className="flex flex-wrap gap-2">
      {colors.map((c) => (
        <button type="button" key={c} onClick={() => onChange(c)} aria-label={`Colour ${c}`}
          className={clsx('h-7 w-7 rounded-full transition', value === c ? 'ring-2 ring-ink ring-offset-2 ring-offset-surface' : 'hover:scale-110')} style={{ background: c }} />
      ))}
    </div>
  );
}

export function Menu({ trigger, items, align = 'right' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const h = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h);
  }, []);
  return (
    <div className="relative" ref={ref}>
      <span onClick={() => setOpen((o) => !o)}>{trigger}</span>
      {open && (
        <div className={clsx('absolute z-40 mt-1 min-w-[190px] rounded-xl border border-line bg-surface p-1 shadow-lift', align === 'right' ? 'right-0' : 'left-0')}>
          {items.filter(Boolean).map((it, i) => (it === '-' ? <div key={i} className="my-1 border-t border-line" /> : (
            <button key={i} type="button" onClick={() => { setOpen(false); it.onClick(); }}
              className={clsx('flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-sunken', it.danger && 'text-ember')}>
              {it.icon && <it.icon size={15} className={it.danger ? '' : 'text-muted'} />}{it.label}
            </button>
          )))}
        </div>
      )}
    </div>
  );
}

export function Markdown({ children, className }) {
  return <div className={clsx('md', className)}><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: (p) => <a {...p} target="_blank" rel="noreferrer" /> }}>{children || ''}</ReactMarkdown></div>;
}

/** Inline stat cell used inside the KPI strip. */
export function Stat({ label, value, hint, tone, icon: Icon, onClick }) {
  const C = onClick ? 'button' : 'div';
  return (
    <C onClick={onClick} className={clsx('flex min-w-0 items-start gap-3 px-5 py-4 text-left', onClick && 'transition hover:bg-sunken/60')}>
      {Icon && <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl" style={{ background: `${tone || '#3D5AFE'}17`, color: tone || '#3D5AFE' }}><Icon size={17} /></span>}
      <span className="min-w-0">
        <span className="block text-xs font-medium text-muted">{label}</span>
        <span className="mt-0.5 block font-display text-[28px] font-semibold leading-none tracking-tight">{value}</span>
        {hint && <span className="mt-1.5 block truncate text-xs text-muted">{hint}</span>}
      </span>
    </C>
  );
}

// ---------- confirm dialog (no window.confirm) ----------
let confirmFn = null;
export function confirm(opts) { return confirmFn ? confirmFn(opts) : Promise.resolve(window.confirm(opts.title)); }
export function ConfirmHost() {
  const [state, setState] = useState(null);
  useEffect(() => { confirmFn = (opts) => new Promise((resolve) => setState({ ...opts, resolve })); return () => { confirmFn = null; }; }, []);
  if (!state) return null;
  const done = (v) => { state.resolve(v); setState(null); };
  return (
    <Modal open onClose={() => done(false)} title={state.title} width="max-w-md"
      footer={<><button type="button" className="btn-ghost" onClick={() => done(false)}>Cancel</button><button type="button" autoFocus className={state.danger ? 'btn bg-ember text-white hover:bg-ember/90' : 'btn-primary'} onClick={() => done(true)}>{state.confirmLabel || 'Confirm'}</button></>}>
      <p className="text-sm text-muted">{state.body}</p>
    </Modal>
  );
}

export function Kbd({ children }) { return <kbd className="kbd">{children}</kbd>; }

/** Password field with a show/hide eye and an optional strength meter. */
export function PasswordInput({ value, onChange, strength, className, ...rest }) {
  const [show, setShow] = useState(false);
  const score = !value ? 0 : [value.length >= 8, value.length >= 12, /[A-Z]/.test(value) && /[a-z]/.test(value), /\d/.test(value), /[^\w\s]/.test(value)].filter(Boolean).length;
  const label = ['', 'Weak', 'Weak', 'Okay', 'Good', 'Strong'][score];
  const color = ['', '#E5484D', '#E5484D', '#C76A00', '#1FA971', '#1FA971'][score];
  return (
    <div>
      <div className="relative">
        <input {...rest} type={show ? 'text' : 'password'} value={value} onChange={onChange} className={clsx('input pr-10', className)} />
        <button type="button" onClick={() => setShow((v) => !v)} className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-muted hover:bg-sunken hover:text-ink" aria-label={show ? 'Hide password' : 'Show password'} title={show ? 'Hide password' : 'Show password'}>
          {show ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
      {strength && value && (
        <div className="mt-1.5 flex items-center gap-2">
          <div className="flex flex-1 gap-1">{[1, 2, 3, 4, 5].map((i) => <span key={i} className="h-1 flex-1 rounded-full transition" style={{ background: i <= score ? color : 'rgb(var(--c-line))' }} />)}</div>
          <span className="w-12 text-right text-[11px] font-semibold" style={{ color }}>{label}</span>
        </div>
      )}
    </div>
  );
}
