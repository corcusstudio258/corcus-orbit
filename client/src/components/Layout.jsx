import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useNavigate, useLocation, Link } from 'react-router-dom';
import clsx from 'clsx';
import {
  LayoutDashboard, CheckSquare, Columns3, FolderKanban, CalendarDays, Building2, Inbox, Users, ShieldCheck, Activity,
  Settings, Bell, Plus, Search, LogOut, Menu, X, Timer, Square,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../lib/api';
import { useAuth, useLive } from '../context/AuthContext';
import { Avatar } from './ui';
import TaskForm from './TaskForm';
import { ago } from '../lib/format';

const ComposerCtx = createContext(() => {});
export const useComposer = () => useContext(ComposerCtx);

function Logo({ name }) {
  return (
    <Link to="/" className="flex items-center gap-2.5 px-2">
      <img src="/orbit.svg" alt="" className="h-8 w-8" />
      <span className="leading-tight">
        <span className="block font-display text-[15px] font-semibold">Orbit</span>
        <span className="block max-w-[150px] truncate text-[11px] text-mist">{name}</span>
      </span>
    </Link>
  );
}

function Nav({ onNavigate }) {
  const { can } = useAuth();
  const [openReq, setOpenReq] = useState(0);
  const loadReq = () => can('clients.view', 'clients.manage') && api.get('/clients/requests/all?status=open').then((r) => setOpenReq(r.data.length)).catch(() => {});
  useEffect(() => { loadReq(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useLive('request:changed', loadReq);

  const groups = [
    { items: [
      { to: '/', icon: LayoutDashboard, label: 'Dashboard', end: true },
      { to: '/my-tasks', icon: CheckSquare, label: 'My tasks' },
      { to: '/board', icon: Columns3, label: 'Task board' },
      { to: '/projects', icon: FolderKanban, label: 'Projects' },
      { to: '/calendar', icon: CalendarDays, label: 'Calendar' },
    ] },
    { title: 'Clients', items: [
      can('clients.view', 'clients.manage') && { to: '/clients', icon: Building2, label: 'Clients' },
      can('clients.view', 'clients.manage') && { to: '/requests', icon: Inbox, label: 'Requests', badge: openReq },
    ].filter(Boolean) },
    { title: 'Workspace', items: [
      can('users.view', 'users.manage') && { to: '/team', icon: Users, label: 'Team' },
      can('roles.manage') && { to: '/roles', icon: ShieldCheck, label: 'Roles & access' },
      { to: '/activity', icon: Activity, label: 'Activity' },
      { to: '/settings', icon: Settings, label: 'Settings' },
    ].filter(Boolean) },
  ];
  return (
    <nav className="space-y-5">
      {groups.filter((g) => g.items.length).map((g, i) => (
        <div key={i}>
          {g.title && <div className="mb-1.5 px-3 text-[11px] font-semibold text-mist/70">{g.title}</div>}
          <div className="space-y-0.5">
            {g.items.map((it) => (
              <NavLink key={it.to} to={it.to} end={it.end} onClick={onNavigate}
                className={({ isActive }) => clsx('group relative flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition',
                  isActive ? 'bg-white/[0.07] text-star' : 'text-mist hover:bg-white/[0.04] hover:text-star')}>
                {({ isActive }) => (<>
                  {isActive && <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-signal shadow-[0_0_10px_#3DE0F2]" />}
                  <it.icon size={18} className={isActive ? 'text-signal' : ''} />
                  <span className="flex-1">{it.label}</span>
                  {!!it.badge && <span className="rounded-full bg-flare/20 px-1.5 text-[11px] font-bold text-flare">{it.badge}</span>}
                </>)}
              </NavLink>
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}

function TimerPill() {
  const [log, setLog] = useState(null);
  const [, tick] = useState(0);
  const load = () => api.get('/tasks/timer/active').then((r) => setLog(r.data)).catch(() => {});
  useEffect(() => { load(); const i = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(i); }, []);
  useLive('timer', load);
  useEffect(() => { const h = () => load(); window.addEventListener('orbit:timer', h); return () => window.removeEventListener('orbit:timer', h); }, []);
  if (!log) return null;
  const s = Math.floor((Date.now() - new Date(log.startedAt)) / 1000);
  const t = `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  const stop = async () => {
    const r = await api.post('/tasks/timer/stop');
    toast.success(`Logged ${r.data?.minutes || 0} min on ${log.Task?.key}`);
    setLog(null); window.dispatchEvent(new Event('orbit:timer'));
  };
  return (
    <div className="hidden items-center gap-2 rounded-xl border border-signal/30 bg-signal/10 py-1 pl-3 pr-1 text-sm md:flex">
      <Timer size={15} className="text-signal" />
      <Link to={`/tasks/${log.taskId}`} className="max-w-[160px] truncate font-medium hover:underline">{log.Task?.key}</Link>
      <span className="font-display tabular-nums text-signal">{t}</span>
      <button type="button" onClick={stop} className="rounded-lg p-1.5 text-rose hover:bg-rose/15" aria-label="Stop timer"><Square size={13} fill="currentColor" /></button>
    </div>
  );
}

function Notifications() {
  const { unread, setUnread } = useAuth();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const ref = useRef(null);
  const nav = useNavigate();
  const load = () => api.get('/notifications').then((r) => { setItems(r.data.items); setUnread(r.data.unread); });
  useEffect(() => { if (open) load(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const h = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h);
  }, []);
  const readAll = async () => { await api.post('/notifications/read', {}); load(); };
  const go = async (n) => {
    if (!n.read) await api.post('/notifications/read', { ids: [n.id] });
    setOpen(false); setUnread((u) => Math.max(0, u - (n.read ? 0 : 1)));
    if (n.link) nav(n.link);
  };
  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen((o) => !o)} className="relative rounded-xl p-2 text-mist hover:bg-white/5 hover:text-star" aria-label={`Notifications, ${unread} unread`}>
        <Bell size={19} />
        {unread > 0 && <span className="absolute right-1 top-1 grid h-4 min-w-[16px] place-items-center rounded-full bg-rose px-1 text-[10px] font-bold text-space">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <div className="panel absolute right-0 z-40 mt-2 w-[min(92vw,380px)] overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <span className="font-semibold">Notifications</span>
            <button type="button" className="text-xs font-semibold text-signal hover:underline" onClick={readAll}>Mark all as read</button>
          </div>
          <div className="max-h-[60vh] overflow-y-auto">
            {items.map((n) => (
              <button type="button" key={n.id} onClick={() => go(n)} className={clsx('flex w-full gap-3 border-b border-line/60 px-4 py-3 text-left transition hover:bg-white/[0.04]', !n.read && 'bg-signal/[0.04]')}>
                <span className={clsx('mt-1.5 h-2 w-2 shrink-0 rounded-full', n.read ? 'bg-transparent' : 'bg-signal shadow-[0_0_8px_#3DE0F2]')} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{n.title}</span>
                  {n.body && <span className="line-clamp-2 block text-xs text-mist">{n.body}</span>}
                  <span className="mt-1 flex items-center gap-2 text-[11px] text-mist/70">{ago(n.createdAt)}{n.whatsappStatus === 'sent' && <span className="text-mint">Sent on WhatsApp</span>}</span>
                </span>
              </button>
            ))}
            {!items.length && <div className="px-4 py-10 text-center text-sm text-mist">You're all caught up.</div>}
          </div>
        </div>
      )}
    </div>
  );
}

function QuickSearch() {
  const [q, setQ] = useState('');
  const [res, setRes] = useState([]);
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  const inputRef = useRef(null);
  useEffect(() => {
    const h = (e) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); inputRef.current?.focus(); } };
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  }, []);
  useEffect(() => {
    if (q.trim().length < 2) { setRes([]); return undefined; }
    const t = setTimeout(() => api.get(`/tasks?q=${encodeURIComponent(q)}&limit=8`).then((r) => setRes(r.data)).catch(() => {}), 200);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div className="relative hidden w-full max-w-sm sm:block">
      <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mist" />
      <input ref={inputRef} value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Search tasks by name or key  (Ctrl K)" className="input !rounded-xl !bg-white/[0.03] pl-9" />
      {open && res.length > 0 && (
        <div className="panel absolute z-40 mt-1 w-full overflow-hidden p-1">
          {res.map((t) => (
            <button type="button" key={t.id} onMouseDown={() => { nav(`/tasks/${t.id}`); setQ(''); }} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-white/[0.05]">
              <span className="text-xs font-semibold text-mist">{t.key}</span><span className="truncate">{t.title}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Layout() {
  const { user, company, logout, can } = useAuth();
  const [mobile, setMobile] = useState(false);
  const [composer, setComposer] = useState({ open: false, defaults: {}, onCreated: null });
  const loc = useLocation();
  useEffect(() => setMobile(false), [loc.pathname]);

  const openComposer = (defaults = {}, onCreated) => setComposer({ open: true, defaults, onCreated });

  const sidebar = (
    <div className="flex h-full flex-col gap-6 p-4">
      <Logo name={company?.name} />
      <div className="flex-1 overflow-y-auto"><Nav /></div>
      <div className="panel-quiet flex items-center gap-3 p-2.5">
        <Avatar user={user} size={34} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{user.name}</div>
          <div className="truncate text-[11px]" style={{ color: user.Role?.color }}>{user.Role?.name}</div>
        </div>
        <button type="button" onClick={logout} className="rounded-lg p-2 text-mist hover:bg-white/5 hover:text-rose" aria-label="Sign out"><LogOut size={16} /></button>
      </div>
    </div>
  );

  return (
    <ComposerCtx.Provider value={openComposer}>
      <div className="flex min-h-screen">
        <aside className="sticky top-0 hidden h-screen w-64 shrink-0 border-r border-line bg-space-deep/40 backdrop-blur-xl lg:block">{sidebar}</aside>
        {mobile && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <div className="absolute inset-0 bg-space-deep/70" onClick={() => setMobile(false)} />
            <aside className="absolute inset-y-0 left-0 w-72 border-r border-line bg-space-2">{sidebar}
              <button type="button" className="absolute right-3 top-4 rounded-lg p-1.5 text-mist" onClick={() => setMobile(false)} aria-label="Close menu"><X size={18} /></button>
            </aside>
          </div>
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-space/70 px-4 py-3 backdrop-blur-xl sm:px-6">
            <button type="button" className="rounded-lg p-2 text-mist lg:hidden" onClick={() => setMobile(true)} aria-label="Open menu"><Menu size={20} /></button>
            <QuickSearch />
            <div className="ml-auto flex items-center gap-2">
              <TimerPill />
              {can('tasks.create') && <button type="button" className="btn-primary" onClick={() => openComposer()}><Plus size={16} /><span className="hidden sm:inline">New task</span></button>}
              <Notifications />
            </div>
          </header>
          <main className="mx-auto w-full max-w-[1500px] flex-1 px-4 py-6 sm:px-6"><Outlet /></main>
        </div>
      </div>
      <TaskForm open={composer.open} defaults={composer.defaults} onClose={() => setComposer((c) => ({ ...c, open: false }))}
        onCreated={(t) => { composer.onCreated?.(t); window.dispatchEvent(new CustomEvent('orbit:task-created', { detail: t })); }} />
    </ComposerCtx.Provider>
  );
}
