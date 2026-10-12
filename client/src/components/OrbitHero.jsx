import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { HEALTH } from '../lib/format';

const W = 460; const H = 280; const CX = W / 2; const CY = H / 2 + 4; const TILT = (-16 * Math.PI) / 180;
const RINGS = [
  { rx: 86, ry: 34, label: 'Due this week' },
  { rx: 148, ry: 62, label: 'Due this month' },
  { rx: 212, ry: 92, label: 'Later' },
];

function pos(ring, angle) {
  const x = ring.rx * Math.cos(angle); const y = ring.ry * Math.sin(angle);
  return { x: CX + x * Math.cos(TILT) - y * Math.sin(TILT), y: CY + x * Math.sin(TILT) + y * Math.cos(TILT) };
}

/** Projects as planets: the closer the deadline, the tighter the orbit. Halo colour = health. */
export function OrbitSystem({ projects = [] }) {
  const nav = useNavigate();
  const [hover, setHover] = useState(null);
  const list = projects.slice(0, 10);
  const ringOf = (p) => (p.daysLeft != null && p.daysLeft <= 7 ? 0 : p.daysLeft != null && p.daysLeft <= 31 ? 1 : 2);
  const byRing = [[], [], []];
  list.forEach((p) => byRing[ringOf(p)].push(p));
  const planets = byRing.flatMap((ps, ri) => ps.map((p, i) => {
    const angle = (i / Math.max(ps.length, 1)) * Math.PI * 2 + ri * 0.9 + 0.35;
    const { x, y } = pos(RINGS[ri], angle);
    const r = Math.max(7, Math.min(15, 6 + Math.sqrt(p.open || 1) * 2.4));
    return { p, x, y, r, behind: Math.sin(angle) < 0 };
  }));
  const h = hover != null ? planets.find((pl) => pl.p.id === hover) : null;
  return (
    <div className="relative w-full max-w-[460px]">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Projects orbiting by deadline">
        <defs>
          <radialGradient id="sun" cx="50%" cy="45%" r="55%"><stop offset="0%" stopColor="#FFE38A" /><stop offset="70%" stopColor="#FFC21A" /><stop offset="100%" stopColor="#F0A800" /></radialGradient>
          <radialGradient id="sunGlow" cx="50%" cy="50%" r="50%"><stop offset="0%" stopColor="#FFC21A" stopOpacity="0.45" /><stop offset="100%" stopColor="#FFC21A" stopOpacity="0" /></radialGradient>
        </defs>
        {RINGS.map((r, i) => (
          <ellipse key={i} cx={CX} cy={CY} rx={r.rx} ry={r.ry} transform={`rotate(-16 ${CX} ${CY})`} fill="none"
            stroke="rgb(var(--c-night-line))" strokeWidth="1.2" strokeDasharray={i === 2 ? '3 6' : undefined} />
        ))}
        <g className="orbit-ring">
          {planets.filter((pl) => pl.behind).map((pl) => <Planet key={pl.p.id} pl={pl} hover={hover} setHover={setHover} nav={nav} />)}
        </g>
        <circle cx={CX} cy={CY} r="46" fill="url(#sunGlow)" />
        <circle cx={CX} cy={CY} r="20" fill="url(#sun)" />
        <g className="orbit-ring">
          {planets.filter((pl) => !pl.behind).map((pl) => <Planet key={pl.p.id} pl={pl} hover={hover} setHover={setHover} nav={nav} />)}
        </g>
      </svg>
      {h && (
        <div className="pointer-events-none absolute z-10 w-52 -translate-x-1/2 rounded-xl bg-white px-3 py-2 text-xs text-ink shadow-pop" style={{ left: `${(h.x / W) * 100}%`, top: `calc(${(h.y / H) * 100}% + 18px)` }}>
          <div className="truncate font-semibold">{h.p.icon ? `${h.p.icon} ` : ''}{h.p.name}</div>
          <div className="mt-0.5 text-muted">{h.p.progress}% done{h.p.daysLeft != null ? `, ${h.p.daysLeft < 0 ? `${-h.p.daysLeft} days late` : `${h.p.daysLeft} days left`}` : ''}</div>
          <div className="mt-1 font-semibold" style={{ color: HEALTH[h.p.state]?.color }}>{HEALTH[h.p.state]?.label}</div>
        </div>
      )}
      <div className="mt-1 flex justify-center gap-4 text-[11px] text-white/55">
        <span>Inner ring: due this week</span><span>Middle: this month</span><span>Outer: later</span>
      </div>
    </div>
  );
}

function Planet({ pl, hover, setHover, nav }) {
  const halo = HEALTH[pl.p.state]?.color || '#1FA971';
  const active = hover === pl.p.id;
  return (
    <g style={{ cursor: 'pointer' }} onMouseEnter={() => setHover(pl.p.id)} onMouseLeave={() => setHover(null)} onClick={() => nav(`/projects/${pl.p.id}`)}
      role="link" aria-label={pl.p.name} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && nav(`/projects/${pl.p.id}`)} onFocus={() => setHover(pl.p.id)} onBlur={() => setHover(null)}>
      <circle cx={pl.x} cy={pl.y} r={pl.r + 5} fill="none" stroke={halo} strokeWidth={active ? 2.5 : 1.6} opacity={pl.behind ? 0.5 : 0.95} />
      <circle cx={pl.x} cy={pl.y} r={pl.r} fill={pl.p.color || '#3D5AFE'} opacity={pl.behind ? 0.6 : 1} stroke="rgb(var(--c-night))" strokeWidth="2" />
      <circle cx={pl.x - pl.r * 0.35} cy={pl.y - pl.r * 0.35} r={pl.r * 0.28} fill="#fff" opacity={0.35} />
    </g>
  );
}

export default function OrbitHero({ user, hero, projects, summary }) {
  const now = new Date();
  const h = now.getHours();
  const greet = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  const chips = [
    { label: 'In progress', value: hero.active, color: '#7086FF' },
    { label: 'To do', value: hero.pending, color: '#FFC21A' },
    { label: 'In review', value: hero.review, color: '#A78BFA' },
    { label: 'Done', value: hero.completed, color: '#34C78C' },
  ];
  return (
    <section className="relative overflow-hidden rounded-[22px] bg-night text-white">
      <div className="pointer-events-none absolute inset-0 opacity-60" style={{ backgroundImage: 'radial-gradient(1px 1px at 20% 30%, #fff8 50%, transparent 51%), radial-gradient(1px 1px at 70% 20%, #fff6 50%, transparent 51%), radial-gradient(1px 1px at 40% 80%, #fff5 50%, transparent 51%), radial-gradient(1px 1px at 85% 70%, #fff7 50%, transparent 51%), radial-gradient(1px 1px at 10% 85%, #fff4 50%, transparent 51%), radial-gradient(1.5px 1.5px at 60% 55%, #fff6 50%, transparent 51%)' }} />
      <div className="relative grid items-center gap-4 p-6 sm:p-8 lg:grid-cols-[1fr_auto]">
        <div className="min-w-0">
          <p className="text-sm text-white/60">{format(now, 'EEEE, d MMMM')}</p>
          <h1 className="mt-1 font-display text-[34px] font-semibold leading-[1.05] tracking-tight text-white sm:text-[44px]">{greet},<br />{user.name.split(' ')[0]}.</h1>
          <p className="mt-3 max-w-md text-[15px] text-white/75">{summary}</p>
          <div className="mt-6 grid max-w-lg grid-cols-2 gap-2 sm:grid-cols-4">
            {chips.map((c) => (
              <div key={c.label} className="rounded-2xl border border-night-line bg-night-2/70 px-3 py-2.5">
                <div className="font-display text-2xl font-semibold leading-none" style={{ color: c.color }}>{c.value}</div>
                <div className="mt-1 text-[11px] text-white/60">{c.label}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="hidden justify-self-end md:block"><OrbitSystem projects={projects} /></div>
      </div>
    </section>
  );
}
