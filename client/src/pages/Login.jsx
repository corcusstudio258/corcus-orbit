import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { Field } from '../components/ui';

function OrbitArt() {
  // Decorative system: three rings, satellites moving at different speeds.
  return (
    <svg viewBox="0 0 400 400" className="h-full w-full" aria-hidden="true">
      <defs>
        <radialGradient id="core" cx="50%" cy="50%" r="50%"><stop offset="0%" stopColor="#E8ECFF" /><stop offset="60%" stopColor="#8F7BFF" stopOpacity=".6" /><stop offset="100%" stopColor="#8F7BFF" stopOpacity="0" /></radialGradient>
      </defs>
      <circle cx="200" cy="200" r="70" fill="url(#core)" opacity=".5" />
      {[90, 135, 180].map((r, i) => (
        <g key={r}>
          <circle cx="200" cy="200" r={r} fill="none" stroke="rgba(150,168,255,.18)" strokeDasharray={i === 1 ? '2 6' : undefined} />
          <g style={{ transformOrigin: '200px 200px', animation: `spin ${18 + i * 10}s linear infinite ${i % 2 ? 'reverse' : ''}` }}>
            <circle cx={200 + r} cy="200" r={6 - i} fill={['#3DE0F2', '#5BE3A6', '#FFB648'][i]} style={{ filter: `drop-shadow(0 0 8px ${['#3DE0F2', '#5BE3A6', '#FFB648'][i]})` }} />
          </g>
        </g>
      ))}
      <circle cx="200" cy="200" r="16" fill="#E8ECFF" />
      <style>{'@keyframes spin { to { transform: rotate(360deg); } }'}</style>
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
      <div className="relative hidden overflow-hidden border-r border-line lg:block">
        <div className="absolute inset-0 grid place-items-center opacity-90"><div className="aspect-square w-[78%]"><OrbitArt /></div></div>
        <div className="absolute bottom-10 left-10 right-10">
          <h1 className="max-w-md text-4xl font-semibold leading-tight">Every task, every teammate, every client — in one orbit.</h1>
          <p className="mt-3 max-w-md text-mist">Plan work in layers, hand it down the team, and let clients follow progress without chasing you on WhatsApp.</p>
        </div>
      </div>
      <div className="flex items-center justify-center px-6 py-12">
        <form onSubmit={submit} className="w-full max-w-sm">
          <img src="/orbit.svg" alt="" className="mb-6 h-12 w-12" />
          <h2 className="text-2xl font-semibold">{needsSetup ? 'Set up your workspace' : `Sign in to ${status?.company?.name || 'Orbit'}`}</h2>
          <p className="mt-1 text-sm text-mist">{needsSetup ? 'You will be the first admin. Add your team after this.' : 'Team members and clients use the same sign-in.'}</p>
          <div className="mt-8 space-y-4">
            {needsSetup && (<>
              <Field label="Company name"><input className="input" required value={f.companyName} onChange={set('companyName')} placeholder="Corcus Studio" /></Field>
              <Field label="Your name"><input className="input" required value={f.name} onChange={set('name')} /></Field>
              <Field label="WhatsApp number" hint="With country code, e.g. 91 98765 43210"><input className="input" value={f.phone} onChange={set('phone')} /></Field>
            </>)}
            <Field label="Email"><input type="email" autoComplete="email" className="input" required value={f.email} onChange={set('email')} /></Field>
            <Field label="Password" hint={needsSetup ? 'At least 8 characters' : undefined}><input type="password" autoComplete={needsSetup ? 'new-password' : 'current-password'} className="input" required value={f.password} onChange={set('password')} /></Field>
            <button className="btn-primary w-full !py-2.5" disabled={busy || !status}>{busy ? 'Please wait…' : needsSetup ? 'Create workspace' : 'Sign in'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
