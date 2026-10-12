import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import { ArrowLeft, ArrowRight, Check, ImagePlus, FileUp, X, PartyPopper, Hourglass } from 'lucide-react';
import api from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { Field, PasswordInput, PageLoader, Spinner } from '../components/ui';
import OnboardingFields, { visibleQuestions } from '../components/OnboardingFields';
import { bytes } from '../lib/format';

const STEPS = ['Your login', 'Your business', 'Logo and files'];

export default function Signup() {
  const nav = useNavigate();
  const { adopt, refresh } = useAuth();
  const [form, setForm] = useState(null);
  const [step, setStep] = useState(0);
  const [acct, setAcct] = useState({ name: '', email: '', password: '', phone: '' });
  const [answers, setAnswers] = useState({});
  const [logo, setLogo] = useState(null);
  const [docs, setDocs] = useState([]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const logoRef = useRef(null); const docRef = useRef(null);
  useEffect(() => { api.get('/public/onboarding').then((r) => setForm(r.data)).catch(() => setForm({ error: true })); }, []);
  const logoUrl = useMemo(() => (logo ? URL.createObjectURL(logo) : null), [logo]);

  if (!form) return <PageLoader />;
  if (form.error || !form.allowSignup) {
    return <div className="grid min-h-screen place-items-center p-6 text-center"><div><h1 className="text-2xl font-semibold">Sign-up is closed</h1><p className="mt-2 text-muted">Ask your agency for a portal login.</p><Link to="/login" className="btn-ghost mt-6">Go to sign in</Link></div></div>;
  }

  const next = () => {
    if (step === 0) {
      if (!acct.name.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(acct.email)) return toast.error('Add your name and a valid email.');
      if (acct.password.length < 8) return toast.error('Choose a password of at least 8 characters.');
    }
    if (step === 1) {
      const missing = visibleQuestions(form.questions, answers).find((q) => q.required && (answers[q.id] === undefined || answers[q.id] === '' || (Array.isArray(answers[q.id]) && !answers[q.id].length)));
      if (missing) return toast.error(`Please answer: ${missing.label}`);
    }
    setStep((s) => s + 1); window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const submit = async () => {
    setBusy(true);
    try {
      const fd = new FormData();
      Object.entries(acct).forEach(([k, v]) => fd.append(k, v));
      fd.append('answers', JSON.stringify(answers));
      if (logo) fd.append('logo', logo);
      docs.forEach((d) => fd.append('documents', d));
      const { data } = await api.post('/public/signup', fd);
      if (data.approved && data.token) {
        const me = await api.get('/auth/me', { headers: { Authorization: `Bearer ${data.token}` } });
        adopt({ token: data.token, ...me.data }); await refresh(); toast.success('Welcome aboard'); nav('/portal', { replace: true });
      } else setDone(data.message);
    } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen bg-canvas">
      <header className="border-b border-line bg-surface/80 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
          <img src="/orbit.svg" alt="" className="h-8 w-8" />
          <span className="font-display font-semibold">{form.company?.name}</span>
          <span className="text-sm text-muted">Client sign-up</span>
          <Link to="/login" className="ml-auto text-sm font-semibold text-cobalt hover:underline">I have an account</Link>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-8">
        {done ? (
          <section className="panel px-6 py-14 text-center">
            <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-brand-soft text-ink"><Hourglass size={24} /></span>
            <h1 className="mt-4 text-2xl font-semibold">You're on the list</h1>
            <p className="mx-auto mt-2 max-w-md text-muted">{done}</p>
            <Link to="/login" className="btn-ghost mt-6">Back to sign in</Link>
          </section>
        ) : (
          <>
            <div className="mb-6">
              <h1 className="font-display text-3xl font-semibold">Let's get you set up</h1>
              <p className="mt-1 text-muted">{form.welcome}</p>
            </div>
            <ol className="mb-6 grid grid-cols-3 gap-2">
              {STEPS.map((s, i) => (
                <li key={s} className="flex items-center gap-2">
                  <span className={clsx('grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold transition', i < step ? 'bg-leaf text-white' : i === step ? 'bg-ink text-brand' : 'bg-sunken text-muted')}>{i < step ? <Check size={14} strokeWidth={3} /> : i + 1}</span>
                  <span className={clsx('truncate text-sm font-semibold', i === step ? 'text-ink' : 'text-muted')}>{s}</span>
                </li>
              ))}
            </ol>
            <section className="panel p-5 sm:p-7">
              {step === 0 && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Your full name"><input className="input" autoFocus value={acct.name} onChange={(e) => setAcct({ ...acct, name: e.target.value })} /></Field>
                  <Field label="Your WhatsApp number" hint="Updates and approvals come here"><input className="input" value={acct.phone} onChange={(e) => setAcct({ ...acct, phone: e.target.value })} placeholder="91 98765 43210" /></Field>
                  <Field label="Email (your login)"><input type="email" className="input" value={acct.email} onChange={(e) => setAcct({ ...acct, email: e.target.value })} autoComplete="email" /></Field>
                  <Field label="Password"><PasswordInput value={acct.password} onChange={(e) => setAcct({ ...acct, password: e.target.value })} autoComplete="new-password" strength /></Field>
                </div>
              )}
              {step === 1 && <OnboardingFields questions={form.questions} values={answers} onChange={setAnswers} />}
              {step === 2 && (
                <div className="space-y-6">
                  <div>
                    <span className="label">Your logo</span>
                    <div className="flex items-center gap-4">
                      <button type="button" onClick={() => logoRef.current?.click()} className="grid h-24 w-24 shrink-0 place-items-center overflow-hidden rounded-2xl border-2 border-dashed border-line bg-surface hover:border-faint">
                        {logoUrl ? <img src={logoUrl} alt="Logo preview" className="h-full w-full object-contain p-2" /> : <ImagePlus size={24} className="text-faint" />}
                      </button>
                      <div className="text-sm text-muted"><p>PNG or SVG with a transparent background works best.</p>{logo && <button type="button" className="link mt-1 text-xs" onClick={() => setLogo(null)}>Remove</button>}</div>
                      <input ref={logoRef} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) setLogo(f); e.target.value = ''; }} />
                    </div>
                  </div>
                  <div>
                    <span className="label">Brand guidelines, menus, price lists, photos</span>
                    <div onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); setDocs((d) => [...d, ...e.dataTransfer.files].slice(0, 10)); }}
                      className="rounded-2xl border-2 border-dashed border-line px-4 py-8 text-center">
                      <FileUp size={22} className="mx-auto text-faint" />
                      <p className="mt-2 text-sm text-muted">Drop files here or <button type="button" className="link" onClick={() => docRef.current?.click()}>choose files</button>. Up to 10 files, 25 MB each.</p>
                      <input ref={docRef} type="file" multiple hidden onChange={(e) => { setDocs((d) => [...d, ...e.target.files].slice(0, 10)); e.target.value = ''; }} />
                    </div>
                    {docs.length > 0 && <ul className="mt-3 space-y-1.5">{docs.map((d, i) => <li key={i} className="flex items-center gap-2 rounded-xl bg-sunken/60 px-3 py-2 text-sm"><span className="min-w-0 flex-1 truncate">{d.name}</span><span className="text-xs text-muted">{bytes(d.size)}</span><button type="button" onClick={() => setDocs((x) => x.filter((_, j) => j !== i))} className="text-muted hover:text-ember" aria-label="Remove"><X size={14} /></button></li>)}</ul>}
                  </div>
                  <p className="rounded-xl bg-sunken/60 px-3 py-2 text-xs text-muted">You can add or change all of this later from your portal.</p>
                </div>
              )}
            </section>
            <div className="mt-5 flex items-center justify-between">
              {step > 0 ? <button type="button" className="btn-ghost" onClick={() => setStep((s) => s - 1)}><ArrowLeft size={15} />Back</button> : <span />}
              {step < 2 ? <button type="button" className="btn-primary" onClick={next}>Continue<ArrowRight size={15} /></button>
                : <button type="button" className="btn-primary" onClick={submit} disabled={busy}>{busy ? <Spinner size={14} className="text-ink" /> : <PartyPopper size={15} />}Create my account</button>}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
