import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { Search, Plus, Sparkles, FolderKanban, CheckSquare, User, FileText, Building2, LayoutDashboard, MessagesSquare, Video, CalendarDays, Fingerprint } from 'lucide-react';
import api from '../lib/api';
import { STATUS } from '../lib/format';
import { Kbd } from './ui';

const JUMPS = [
  { label: 'Dashboard', to: '/', icon: LayoutDashboard },
  { label: 'My tasks', to: '/my-tasks', icon: CheckSquare },
  { label: 'Projects', to: '/projects', icon: FolderKanban },
  { label: 'Calendar', to: '/calendar', icon: CalendarDays },
  { label: 'Team chat', to: '/chat', icon: MessagesSquare },
  { label: 'Meetings', to: '/meetings', icon: Video },
  { label: 'Attendance', to: '/attendance', icon: Fingerprint },
];

export default function CommandPalette({ open, onClose, onCompose, onAsk }) {
  const [q, setQ] = useState('');
  const [res, setRes] = useState(null);
  const [idx, setIdx] = useState(0);
  const nav = useNavigate();
  useEffect(() => { if (open) { setQ(''); setRes(null); setIdx(0); } }, [open]);
  useEffect(() => {
    if (q.trim().length < 2) { setRes(null); return undefined; }
    const t = setTimeout(() => api.get(`/tools/search?q=${encodeURIComponent(q)}`).then((r) => setRes(r.data)).catch(() => {}), 160);
    return () => clearTimeout(t);
  }, [q]);

  const items = useMemo(() => {
    const out = [];
    if (q.trim()) out.push({ key: 'ask', icon: Sparkles, label: `Ask Orbit AI: “${q}”`, tone: 'ai', run: () => onAsk(q) });
    out.push({ key: 'new', icon: Plus, label: q.trim() ? `Create task “${q}”` : 'Create a task', run: () => onCompose({ title: q }) });
    if (res) {
      res.tasks.forEach((t) => out.push({ key: `t${t.id}`, icon: CheckSquare, label: t.title, meta: t.key, dot: STATUS[t.status]?.color, run: () => nav({ search: `?task=${t.id}` }) }));
      res.projects.forEach((p) => out.push({ key: `p${p.id}`, icon: FolderKanban, label: p.name, meta: p.code, dot: p.color, run: () => nav(`/projects/${p.id}`) }));
      res.people.forEach((p) => out.push({ key: `u${p.id}`, icon: User, label: p.name, meta: p.designation, run: () => nav(`/team/${p.id}`) }));
      res.clients.forEach((c) => out.push({ key: `c${c.id}`, icon: Building2, label: c.name, meta: 'Client', run: () => nav(`/clients/${c.id}`) }));
      res.docs.forEach((d) => out.push({ key: `d${d.id}`, icon: FileText, label: d.title, meta: 'Doc', run: () => nav(`/docs/${d.id}`) }));
    } else {
      JUMPS.filter((j) => !q || j.label.toLowerCase().includes(q.toLowerCase())).forEach((j) => out.push({ key: j.to, icon: j.icon, label: j.label, meta: 'Go to', run: () => nav(j.to) }));
    }
    return out;
  }, [q, res, nav, onAsk, onCompose]);

  useEffect(() => { setIdx(0); }, [items.length]);
  if (!open) return null;
  const choose = (it) => { onClose(); it.run(); };
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-night/40 px-3 pt-[12vh] backdrop-blur-[2px]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-xl animate-rise overflow-hidden rounded-2xl border border-line bg-surface shadow-pop" role="dialog" aria-label="Search">
        <div className="flex items-center gap-3 border-b border-line px-4">
          <Search size={18} className="text-muted" />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tasks, projects, people, docs… or ask AI"
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose();
              if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(items.length - 1, i + 1)); }
              if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)); }
              if (e.key === 'Enter' && items[idx]) { e.preventDefault(); choose(items[idx]); }
            }}
            className="h-14 flex-1 bg-transparent text-[15px] outline-none placeholder:text-faint" />
          <Kbd>Esc</Kbd>
        </div>
        <div className="max-h-[52vh] overflow-y-auto p-1.5">
          {items.map((it, i) => (
            <button key={it.key} type="button" onMouseEnter={() => setIdx(i)} onClick={() => choose(it)}
              className={clsx('flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm', i === idx ? (it.tone === 'ai' ? 'bg-violet/10' : 'bg-sunken') : '')}>
              <it.icon size={17} className={it.tone === 'ai' ? 'text-violet' : 'text-muted'} />
              {it.dot && <span className="h-2 w-2 rounded-full" style={{ background: it.dot }} />}
              <span className="min-w-0 flex-1 truncate">{it.label}</span>
              {it.meta && <span className="text-xs text-faint">{it.meta}</span>}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3 border-t border-line px-4 py-2 text-[11px] text-faint"><Kbd>↑</Kbd><Kbd>↓</Kbd>to move<Kbd>Enter</Kbd>to open<span className="ml-auto">Ctrl J opens the AI panel</span></div>
      </div>
    </div>
  );
}
