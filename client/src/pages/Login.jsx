import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { Field } from '../components/ui';

function OrbitArt() {
  // Decorative system: rings with planets in the brand palette.
  const planets = [['#FFC21A', 6], ['#8B5CF6', 5], ['#1FA971', 4.5], ['#3D5AFE', 7]];
  return (
    <svg viewBox="0 0 400 400" className="h-full w-full" aria-hidden="true">
      <defs>
        <radialGradient id="core" cx="50%" cy="50%" r="50%"><stop offset="0%" stopColor="#FFC21A" stopOpacity=".55" /><stop offset="100%" stopColor="#FFC21A" stopOpacity="0" /></radialGradient>
      </defs>
      <circle cx="200" cy="200" r="90" fill="url(#core)" />
      {[70, 110, 150, 190].map((r, i) => (
        <g key={r}>
          <circle cx="200" cy="200" r={r} fill="none" stroke="rgba(255,255,255,.12)" strokeDasharray={i === 2 ? '2 7' : undefined} />
          <g style={{ transformOrigin: '200px 200px', animation: `spin ${22 + i * 12}s linear infinite ${i % 2 ? 'reverse' : ''}` }}>
            <circle cx={200 + r} cy="200" r={planets[i][1]} fill={planets[i][0]} stroke="#0F1535" strokeWidth="3" />
          </g>
        </g>
      ))}
      <circle cx="200" cy="200" r="22" fill="#FFC21A" />
      <circle cx="200" cy="200" r="9" fill="#0F1535" />
      <style>{'@keyframes spin { to { transform: rotate(360deg); } } @media (prefers-reduced-motion: reduce) { g { animation: none !important; } }'}</style>
    </svg>
  );
}

export default function Login() {
  const { login, setup } = useAuth();
  const nav = useNavigate();
  const [status, setStatus] = useState(null);
  const [f, setF] = useState({ email: '', password: '', name: '', companyName: '', phone: '' });
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.get('/auth/status').then((r) => setStatus(r.data)).catch(() => setStatus({ needsSetup: false })); }, []);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  const needsSetup = status?.needsSetup;

  const submit = async (e) => {
    e.preventDefault(); setBusy(true);
    try {
      const data = needsSetup ? await setup(f) : await login(f.email, f.password);
      nav(data.isClient ? '/portal' : '/', { replace: true });
    } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <div className="relative m-3 hidden overflow-hidden rounded-[28px] bg-night text-white lg:block">
        <div className="absolute -right-24 top-1/2 aspect-square w-[95%] -translate-y-1/2"><OrbitArt /></div>
        <div className="absolute left-10 top-10 flex items-center gap-2.5"><img src="/orbit.svg" alt="" className="h-9 w-9" /><span className="font-display text-lg font-semibold">Orbit</span></div>
        <div className="absolute bottom-10 left-10 max-w-sm">
          <h1 className="font-display text-[40px] font-semibold leading-[1.05] tracking-tight">Projects, people and clients in one orbit.</h1>
          <p className="mt-4 text-white/70">Plan work in layers, hand it down the team, let Gemini write the updates, and give clients a portal so nobody chases anyone on WhatsApp.</p>
        </div>
      </div>
      <div className="flex items-center justify-center px-6 py-12">
        <form onSubmit={submit} className="w-full max-w-sm">
          <img src="/orbit.svg" alt="" className="mb-6 h-12 w-12 lg:hidden" />
          <h2 className="text-2xl font-semibold">{needsSetup ? 'Set up your workspace' : `Sign in to ${status?.company?.name || 'Orbit'}`}</h2>
          <p className="mt-1 text-sm text-muted">{needsSetup ? 'You will be the first admin. Add your team after this.' : 'Team members and clients use the same sign-in.'}</p>
          <div className="mt-8 space-y-4">
            {needsSetup && (<>
              <Field label="Company name"><input className="input" required value={f.companyName} onChange={set('companyName')} placeholder="Corcus Studio" /></Field>
              <Field label="Your name"><input className="input" required value={f.name} onChange={set('name')} /></Field>
              <Field label="WhatsApp number" hint="With country code, e.g. 91 98765 43210"><input className="input" value={f.phone} onChange={set('phone')} /></Field>
            </>)}
            <Field label="Email"><input type="email" autoComplete="email" className="input" required value={f.email} onChange={set('email')} /></Field>
            <Field label="Password" hint={needsSetup ? 'At least 8 characters' : undefined}><input type="password" autoComplete={needsSetup ? 'new-password' : 'current-password'} className="input" required value={f.password} onChange={set('password')} /></Field>
            <button className="btn-primary w-full !py-2.5" disabled={busy || !status}>{busy ? 'Please wait' : needsSetup ? 'Create workspace' : 'Sign in'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
