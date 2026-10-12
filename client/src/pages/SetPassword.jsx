import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ShieldCheck, AlertTriangle } from 'lucide-react';
import api from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { Field, PasswordInput, PageLoader } from '../components/ui';
import { AuthShell } from './Login';

/** Pull our token and Firebase's one-time code out of the URL, even when Firebase nests it in `link`. */
function readParams(search) {
  const p = new URLSearchParams(search);
  const nested = p.get('link') ? new URLSearchParams(new URL(p.get('link'), window.location.origin).search) : null;
  const pick = (k) => p.get(k) || nested?.get(k) || null;
  let token = pick('token'); let email = pick('email');
  const cont = pick('continueUrl');
  if ((!token || !email) && cont) { try { const c = new URL(cont).searchParams; token = token || c.get('token'); email = email || c.get('email'); } catch { /* ignore */ } }
  return { token, email, oobCode: pick('oobCode') };
}

export default function SetPassword({ purpose }) {
  const loc = useLocation();
  const nav = useNavigate();
  const { adopt } = useAuth();
  const { token, email, oobCode } = useMemo(() => readParams(loc.search), [loc.search]);
  const [info, setInfo] = useState(null);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!token) { setInfo({ error: 'This link is incomplete. Open it again from your email or WhatsApp.' }); return; }
    api.get(`/auth/token?token=${encodeURIComponent(token)}${email ? `&email=${encodeURIComponent(email)}` : ''}`).then((r) => setInfo(r.data)).catch((e) => setInfo({ error: e.message }));
  }, [token, email]);

  const submit = async (e) => {
    e.preventDefault();
    if (pw.length < 8) return toast.error('Use at least 8 characters.');
    if (pw !== pw2) return toast.error('The two passwords do not match.');
    setBusy(true);
    try {
      const { data } = await api.post('/auth/accept', { token, password: pw, oobCode });
      adopt(data);
      toast.success(info.purpose === 'invite' ? `Welcome to ${info.company?.name || 'Orbit'}` : 'Password updated');
      nav(data.isClient ? '/portal' : '/', { replace: true });
    } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };

  const invite = (info?.purpose || purpose) === 'invite';
  return (
    <AuthShell title={invite ? 'Welcome aboard.' : 'Back in a moment.'} body={invite ? 'Set a password and you are in. Your projects, tasks and team chat are waiting.' : 'Choose a new password. Your old one stops working straight away.'}>
      <div className="w-full max-w-sm">
        <img src="/orbit.svg" alt="" className="mb-6 h-12 w-12 lg:hidden" />
        {!info ? <PageLoader /> : info.error ? (
          <div>
            <span className="grid h-11 w-11 place-items-center rounded-2xl bg-ember/10 text-ember"><AlertTriangle size={20} /></span>
            <h2 className="mt-4 text-2xl font-semibold">Link not valid</h2>
            <p className="mt-1 text-sm text-muted">{info.error}</p>
            <Link to="/login" className="btn-ghost mt-6">Go to sign in</Link>
          </div>
        ) : (
          <form onSubmit={submit}>
            <h2 className="text-2xl font-semibold">{invite ? `Hi ${info.name.split(' ')[0]}, set your password` : 'Choose a new password'}</h2>
            <p className="mt-1 text-sm text-muted">{info.email}{invite ? `, joining ${info.company?.name}` : ''}</p>
            {info.firebase && !oobCode && <p className="mt-4 rounded-xl bg-amber/10 px-3 py-2 text-sm text-amber">Open this page from the link in your email so we can confirm it is you.</p>}
            {info.firebase && oobCode && <p className="mt-4 flex items-center gap-2 rounded-xl bg-leaf/10 px-3 py-2 text-sm text-leaf"><ShieldCheck size={15} />Email confirmed</p>}
            <div className="mt-8 space-y-4">
              <Field label="New password"><PasswordInput autoComplete="new-password" autoFocus required value={pw} onChange={(e) => setPw(e.target.value)} strength /></Field>
              <Field label="Type it again"><PasswordInput autoComplete="new-password" required value={pw2} onChange={(e) => setPw2(e.target.value)} /></Field>
              <button className="btn-primary w-full !py-2.5" disabled={busy || (info.firebase && !oobCode)}>{busy ? 'Saving' : invite ? 'Join the workspace' : 'Save and sign in'}</button>
            </div>
          </form>
        )}
      </div>
    </AuthShell>
  );
}
