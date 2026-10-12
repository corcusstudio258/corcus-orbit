import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useNavigate, useLocation, Link, useSearchParams } from 'react-router-dom';
import clsx from 'clsx';
import {
  LayoutDashboard, CheckSquare, FolderKanban, CalendarDays, Building2, Inbox, Users, ShieldCheck, Activity, Settings, Bell, Plus, Search,
  LogOut, Menu as MenuIcon, X, Timer, Square, MessagesSquare, Video, FileText, Sparkles, FileBarChart, HeartPulse, BarChart3, Fingerprint,
  Trophy, Workflow, LayoutTemplate, ArrowLeftRight, ChevronDown, Moon, Sun, LogIn,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../lib/api';
import { useAuth, useLive } from '../context/AuthContext';
import { useTheme } from '../lib/theme';
import { Avatar, Drawer, Kbd, ConfirmHost } from './ui';
import TaskForm from './TaskForm';
import TaskPanel from './TaskPanel';
import CommandPalette from './CommandPalette';
import AiPanel from './AiPanel';
import { ago } from '../lib/format';

const ComposerCtx = createContext(() => {});
export const useComposer = () => useContext(ComposerCtx);
const AiCtx = createContext(() => {});
export const useAskAi = () => useContext(AiCtx);

/** Open a task in the side drawer from anywhere: openTask(id) */
export function useOpenTask() {
  const [params, setParams] = useSearchParams();
  return useCallback((id) => { const p = new URLSearchParams(params); p.set('task', id); setParams(p); }, [params, setParams]);
}

function Logo({ name }) {
  return (
    <Link to="/" className="flex items-center gap-2.5 px-2">
      <img src="/orbit.svg" alt="" className="h-9 w-9" />
      <span className="leading-tight">
        <span className="block font-display text-[17px] font-bold tracking-tight">Orbit</span>
        <span className="block max-w-[150px] truncate text-[11px] text-muted">{name}</span>
      </span>
    </Link>
  );
}

function useOpenGroups() {
  const [open, setOpen] = useState(() => { try { return JSON.parse(localStorage.getItem('orbit_nav') || '{}'); } catch { return {}; } });
  const toggle = (k) => setOpen((o) => { const n = { ...o, [k]: !(o[k] ?? true) }; try { localStorage.setItem('orbit_nav', JSON.stringify(n)); } catch { /* */ } return n; });
  return [open, toggle];
}

function Nav({ onNavigate }) {
  const { can, chatUnread } = useAuth();
  const [openReq, setOpenReq] = useState(0);
  const [groups, toggle] = useOpenGroups();
  const loadReq = () => can('clients.view', 'clients.manage') && api.get('/clients/requests/all?status=open').then((r) => setOpenReq(r.data.length)).catch(() => {});
  useEffect(() => { loadReq(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useLive('request:changed', loadReq);

  const sections = [
    { key: 'main', items: [
      { to: '/', icon: LayoutDashboard, label: 'Dashboard', end: true },
      { to: '/my-tasks', icon: CheckSquare, label: 'My tasks' },
      { to: '/projects', icon: FolderKanban, label: 'Projects' },
      { to: '/calendar', icon: CalendarDays, label: 'Calendar' },
    ] },
    { key: 'collab', title: 'Collaborate', items: [
      { to: '/chat', icon: MessagesSquare, label: 'Team chat', badge: chatUnread },
      { to: '/meetings', icon: Video, label: 'Meetings' },
      { to: '/docs', icon: FileText, label: 'Documents' },
    ] },
    { key: 'ai', title: 'Orbit AI', items: [
      { to: '/ai', icon: Sparkles, label: 'Ask Orbit', end: true },
      { to: '/ai/reports', icon: FileBarChart, label: 'AI reports' },
      { to: '/ai/health', icon: HeartPulse, label: 'Project health' },
    ] },
    { key: 'clients', title: 'Clients', items: [
      can('clients.view', 'clients.manage') && { to: '/clients', icon: Building2, label: 'Clients' },
      can('clients.view', 'clients.manage') && { to: '/requests', icon: Inbox, label: 'Requests', badge: openReq, badgeTone: 'brand' },
    ].filter(Boolean) },
    { key: 'people', title: 'People', items: [
      can('users.view', 'users.manage') && { to: '/team', icon: Users, label: 'Team' },
      { to: '/workload', icon: BarChart3, label: 'Workload' },
      { to: '/attendance', icon: Fingerprint, label: 'Attendance' },
      { to: '/rewards', icon: Trophy, label: 'Rewards' },
    ].filter(Boolean) },
    { key: 'tools', title: 'Tools', items: [
      { to: '/automations', icon: Workflow, label: 'Automations' },
      { to: '/templates', icon: LayoutTemplate, label: 'Templates' },
      { to: '/import-export', icon: ArrowLeftRight, label: 'Import / export' },
      can('roles.manage') && { to: '/roles', icon: ShieldCheck, label: 'Roles & access' },
      { to: '/activity', icon: Activity, label: 'Activity log' },
    ].filter(Boolean) },
  ];
  return (
    <nav className="space-y-1">
      {sections.filter((s) => s.items.length).map((s) => {
        const isOpen = !s.title || (groups[s.key] ?? true);
        return (
          <div key={s.key} className={s.title ? 'pt-2' : ''}>
            {s.title && (
              <button type="button" onClick={() => toggle(s.key)} className="flex w-full items-center justify-between rounded-lg px-3 py-1.5 text-xs font-semibold text-faint hover:text-muted">
                {s.title}<ChevronDown size={14} className={clsx('transition', !isOpen && '-rotate-90')} />
              </button>
            )}
            {isOpen && (
              <div className="space-y-0.5">
                {s.items.map((it) => (
                  <NavLink key={it.to} to={it.to} end={it.end ?? it.to === '/ai'} onClick={onNavigate}
                    className={({ isActive }) => clsx('relative flex items-center gap-3 rounded-xl px-3 py-[7px] text-[14px] font-medium transition',
                      isActive ? 'bg-ink text-surface' : 'text-muted hover:bg-sunken hover:text-ink')}>
                    {({ isActive }) => (<>
                      <it.icon size={17} className={isActive ? 'text-brand' : ''} />
                      <span className="flex-1">{it.label}</span>
                      {!!it.badge && <span className={clsx('min-w-[20px] rounded-full px-1.5 text-center text-[11px] font-bold', it.badgeTone === 'brand' ? 'bg-brand text-brand-ink' : 'bg-ember text-white')}>{it.badge > 99 ? '99+' : it.badge}</span>}
                    </>)}
                  </NavLink>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}

function PunchButton() {
  const [rec, setRec] = useState(undefined);
  const [, tick] = useState(0);
  const load = () => api.get('/people/attendance/today').then((r) => setRec(r.data.record)).catch(() => setRec(null));
  useEffect(() => { load(); const i = setInterval(() => tick((x) => x + 1), 30000); return () => clearInterval(i); }, []);
  if (rec === undefined) return null;
  const isIn = rec?.inAt && !rec.outAt;
  const act = async () => {
    try {
      const r = await api.post(`/people/attendance/${isIn ? 'punch-out' : 'punch-in'}`, {});
      setRec(r.data);
      toast.success(isIn ? `Punched out. ${Math.floor(r.data.minutes / 60)}h ${r.data.minutes % 60}m today.` : r.data.status === 'late' ? 'Punched in (marked late)' : 'Punched in. Have a great day!');
    } catch (e) { toast.error(e.message); }
  };
  const since = isIn ? Math.floor((Date.now() - new Date(rec.sessionAt || rec.inAt)) / 60000) : 0;
  return (
    <button type="button" onClick={act} title={isIn ? 'Punch out' : 'Punch in'}
      className={clsx('hidden items-center gap-2 rounded-xl border px-3 py-1.5 text-xs font-semibold transition md:inline-flex',
        isIn ? 'border-leaf/30 bg-leaf/10 text-leaf hover:bg-leaf/15' : 'border-line bg-surface text-ink hover:bg-sunken')}>
      {isIn ? <><span className="h-2 w-2 animate-pulse rounded-full bg-leaf" />In for {Math.floor(since / 60)}h {since % 60}m</> : <><LogIn size={14} />{rec?.outAt ? 'Punch in again' : 'Punch in'}</>}
    </button>
  );
}

function TimerPill() {
  const [log, setLog] = useState(null);
  const [, tick] = useState(0);
  const load = () => api.get('/tasks/timer/active').then((r) => setLog(r.data)).catch(() => {});
  useEffect(() => { load(); const i = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(i); }, []);
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
    <div className="hidden items-center gap-2 rounded-xl border border-cobalt/25 bg-cobalt/10 py-1 pl-3 pr-1 text-xs font-semibold text-cobalt lg:flex">
      <Timer size={14} />
      <Link to={`?task=${log.taskId}`} className="max-w-[120px] truncate hover:underline">{log.Task?.key}</Link>
      <span className="font-display tabular-nums">{t}</span>
      <button type="button" onClick={stop} className="rounded-lg p-1.5 text-ember hover:bg-ember/10" aria-label="Stop timer"><Square size={12} fill="currentColor" /></button>
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
    if (!n.link) return;
    const m = n.link.match(/^\/tasks\/(\d+)$/);
    if (m) nav({ search: `?task=${m[1]}` }); else nav(n.link);
  };
  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen((o) => !o)} className="relative rounded-xl p-2 text-muted hover:bg-sunken hover:text-ink" aria-label={`Notifications, ${unread} unread`}>
        <Bell size={19} />
        {unread > 0 && <span className="absolute right-1 top-1 grid h-4 min-w-[16px] place-items-center rounded-full bg-ember px-1 text-[10px] font-bold text-white">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-2 w-[min(92vw,400px)] overflow-hidden rounded-2xl border border-line bg-surface shadow-pop">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <span className="font-display font-semibold">Notifications</span>
            <button type="button" className="text-xs font-semibold text-cobalt hover:underline" onClick={readAll}>Mark all as read</button>
          </div>
          <div className="max-h-[65vh] overflow-y-auto">
            {items.map((n) => (
              <button type="button" key={n.id} onClick={() => go(n)} className={clsx('flex w-full gap-3 border-b border-line/70 px-4 py-3 text-left transition hover:bg-sunken/70', !n.read && 'bg-brand-soft/40')}>
                <span className={clsx('mt-1.5 h-2 w-2 shrink-0 rounded-full', n.read ? 'bg-transparent' : 'bg-brand')} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{n.title}</span>
                  {n.body && <span className="line-clamp-2 block whitespace-pre-line text-xs text-muted">{n.body}</span>}
                  <span className="mt-1 flex items-center gap-2 text-[11px] text-faint">{ago(n.createdAt)}{n.whatsappStatus === 'sent' && <span className="text-leaf">Sent on WhatsApp</span>}</span>
                </span>
              </button>
            ))}
            {!items.length && <div className="px-4 py-10 text-center text-sm text-muted">You're all caught up.</div>}
          </div>
        </div>
      )}
    </div>
  );
}

function TaskDrawerHost() {
  const [params, setParams] = useSearchParams();
  const id = params.get('task');
  const close = () => { const p = new URLSearchParams(params); p.delete('task'); setParams(p); };
  return (
    <Drawer open={!!id} onClose={close}>
      {id && <TaskPanel id={id} onClose={close} inDrawer />}
    </Drawer>
  );
}

export default function Layout() {
  const { user, company, logout, can } = useAuth();
  const [mobile, setMobile] = useState(false);
  const [palette, setPalette] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiSeed, setAiSeed] = useState(null);
  const [theme, toggleTheme] = useTheme();
  const [composer, setComposer] = useState({ open: false, defaults: {}, onCreated: null });
  const loc = useLocation();
  useEffect(() => setMobile(false), [loc.pathname]);
  useEffect(() => {
    const h = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette(true); }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') { e.preventDefault(); setAiOpen((o) => !o); }
    };
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  }, []);

  const openComposer = (defaults = {}, onCreated) => setComposer({ open: true, defaults, onCreated });
  const askAi = (q) => { setAiSeed(q ? { q, at: Date.now() } : null); setAiOpen(true); };

  const sidebar = (
    <div className="flex h-full flex-col gap-4 p-3">
      <div className="px-1 pt-1"><Logo name={company?.name} /></div>
      <div className="-mx-1 flex-1 overflow-y-auto px-1"><Nav onNavigate={() => setMobile(false)} /></div>
      <div className="space-y-1 border-t border-line pt-3">
        <NavLink to="/settings" className={({ isActive }) => clsx('flex items-center gap-3 rounded-xl px-3 py-[7px] text-[14px] font-medium', isActive ? 'bg-ink text-surface' : 'text-muted hover:bg-sunken hover:text-ink')}><Settings size={17} />Settings</NavLink>
        <div className="flex items-center gap-3 rounded-xl p-2">
          <Avatar user={user} size={34} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{user.name}</div>
            <div className="truncate text-[11px] text-muted">{user.Role?.name}</div>
          </div>
          <button type="button" onClick={logout} className="rounded-lg p-2 text-muted hover:bg-sunken hover:text-ember" aria-label="Sign out"><LogOut size={16} /></button>
        </div>
      </div>
    </div>
  );

  return (
    <ComposerCtx.Provider value={openComposer}>
      <AiCtx.Provider value={askAi}>
        <div className="flex min-h-screen">
          <aside className="sticky top-0 hidden h-screen w-[248px] shrink-0 border-r border-line bg-surface lg:block">{sidebar}</aside>
          {mobile && (
            <div className="fixed inset-0 z-50 lg:hidden">
              <div className="absolute inset-0 bg-night/40" onClick={() => setMobile(false)} />
              <aside className="absolute inset-y-0 left-0 w-72 border-r border-line bg-surface">{sidebar}
                <button type="button" className="absolute right-3 top-4 rounded-lg p-1.5 text-muted" onClick={() => setMobile(false)} aria-label="Close menu"><X size={18} /></button>
              </aside>
            </div>
          )}
          <div className="flex min-w-0 flex-1 flex-col">
            <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-line bg-canvas/85 px-4 py-2.5 backdrop-blur-md sm:px-6">
              <button type="button" className="rounded-lg p-2 text-muted lg:hidden" onClick={() => setMobile(true)} aria-label="Open menu"><MenuIcon size={20} /></button>
              <button type="button" onClick={() => setPalette(true)} className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-left text-sm text-faint transition hover:border-faint sm:max-w-sm">
                <Search size={16} className="shrink-0" /><span className="flex-1 truncate">Search or jump to…</span><span className="hidden gap-1 sm:flex"><Kbd>Ctrl</Kbd><Kbd>K</Kbd></span>
              </button>
              <div className="ml-auto flex items-center gap-1.5">
                <TimerPill />
                <PunchButton />
                {can('tasks.create') && <button type="button" className="btn-primary !px-3" onClick={() => openComposer()} title="New task"><Plus size={17} /><span className="hidden sm:inline">New task</span></button>}
                <button type="button" onClick={toggleTheme} className="rounded-xl p-2 text-muted hover:bg-sunken hover:text-ink" aria-label="Switch theme">{theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}</button>
                <Notifications />
              </div>
            </header>
            <main className="mx-auto w-full max-w-[1480px] flex-1 px-4 py-6 sm:px-6 lg:px-8"><Outlet /></main>
          </div>
        </div>

        {!/^\/(chat|docs|ai)(\/|$)/.test(loc.pathname) && <button type="button" onClick={() => askAi()} title="Ask Orbit AI (Ctrl J)"
          className="fixed bottom-5 right-5 z-40 grid h-14 w-14 place-items-center rounded-2xl bg-night text-brand shadow-pop ring-4 ring-brand/25 transition hover:scale-105">
          <Sparkles size={24} />
        </button>}
        <AiPanel open={aiOpen} onClose={() => setAiOpen(false)} seed={aiSeed} />
        <CommandPalette open={palette} onClose={() => setPalette(false)} onCompose={openComposer} onAsk={askAi} />
        <TaskForm open={composer.open} defaults={composer.defaults} onClose={() => setComposer((c) => ({ ...c, open: false }))}
          onCreated={(t) => { composer.onCreated?.(t); window.dispatchEvent(new CustomEvent('orbit:task-created', { detail: t })); }} />
        <TaskDrawerHost />
        <ConfirmHost />
      </AiCtx.Provider>
    </ComposerCtx.Provider>
  );
}
