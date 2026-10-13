import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import { MessageCircle, Send, Sparkles, KeyRound, ExternalLink, CheckCircle2, User, Building2, Palette, Plug, Mail, Video, Flame, UserPlus, BellRing } from 'lucide-react';
import api from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { refreshAi } from '../lib/directory';
import { useTheme } from '../lib/theme';
import { Field, Toggle, PageLoader, Segmented, PageHeader, Tabs, Spinner, PasswordInput } from '../components/ui';
import { ago } from '../lib/format';
import { pushState, enablePush, disablePush, isIosWithoutInstall } from '../lib/push';

const EVENTS = [
  ['assigned', 'Task assigned', 'When someone gives a person a task'],
  ['status', 'Status changes', 'When a task they own or created moves'],
  ['comment', 'Comments and mentions', 'New comments, and @mentions'],
  ['due', 'Due soon', 'Reminder within 24 hours of the deadline'],
  ['overdue', 'Overdue', 'Daily at 10:05 to the assignee and their manager'],
  ['approval', 'Approvals', 'Review requests and results'],
  ['client_update', 'Client updates', 'Progress updates sent to client portal users'],
  ['client_request', 'Client requests', 'New requests raised from the portal'],
];

function BrowserAlerts({ prefs, setPref }) {
  const [state, setState] = useState('…');
  const [busy, setBusy] = useState(false);
  useEffect(() => { pushState().then(setState); }, []);
  const run = async (fn, ok) => { setBusy(true); try { setState(await fn()); if (ok) toast.success(ok); } catch (e) { toast.error(e.message); } finally { setBusy(false); } };
  const test = async () => { try { await api.post('/push/test'); toast.success('Test sent. Look for the pop-up.'); } catch (e) { toast.error(e.message); } };
  const label = { on: 'On for this browser', off: 'Off for this browser', blocked: 'Blocked in browser settings', unsupported: 'Not supported here' }[state] || 'Checking…';
  return (
    <div className="space-y-3 rounded-xl bg-sunken/60 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <BellRing size={16} className={state === 'on' ? 'text-leaf' : 'text-muted'} />
        <span className="text-sm font-semibold">Browser notifications</span>
        <span className={clsx('chip', state === 'on' ? 'bg-leaf/15 text-leaf' : state === 'blocked' ? 'bg-ember/10 text-ember' : 'bg-surface text-muted')}>{label}</span>
      </div>
      <p className="text-xs text-muted">Pop-ups on this computer or phone for the alerts picked below, even when Orbit is closed. Turn it on in each browser you use.{isIosWithoutInstall() ? ' On iPhone, add Orbit to your Home Screen first.' : ''}</p>
      {state === 'blocked' && <p className="text-xs text-ember">Click the lock icon next to the address bar, allow Notifications, then reload.</p>}
      <div className="flex flex-wrap gap-2">
        {state !== 'on' && state !== 'unsupported' && <button type="button" className="btn-primary btn-sm" disabled={busy || state === 'blocked'} onClick={() => run(enablePush, 'Browser notifications are on')}>Turn on</button>}
        {state === 'on' && <><button type="button" className="btn-ghost btn-sm" onClick={test}>Send a test</button><button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => run(disablePush, 'Turned off for this browser')}>Turn off here</button></>}
      </div>
      {state === 'on' && <Toggle checked={prefs.push !== false} onChange={setPref('push')} label="Use pop-ups on all my browsers" hint="Switch off to pause them everywhere without removing browsers." />}
    </div>
  );
}

function Profile() {
  const { user, refresh } = useAuth();
  const [f, setF] = useState({ name: user.name, phone: user.phone || '', whatsappOptIn: user.whatsappOptIn, notifyPrefs: user.notifyPrefs || {}, currentPassword: '', newPassword: '' });
  const save = async () => {
    try { await api.patch('/auth/me', f); toast.success('Profile saved'); setF((s) => ({ ...s, currentPassword: '', newPassword: '' })); refresh(); } catch (e) { toast.error(e.message); }
  };
  const pref = (k) => (v) => setF((s) => ({ ...s, notifyPrefs: { ...s.notifyPrefs, [k]: v } }));
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <section className="panel space-y-4 p-5">
        <h2 className="font-semibold">Your profile</h2>
        <Field label="Name"><input className="input" value={f.name} onChange={(e) => setF((s) => ({ ...s, name: e.target.value }))} /></Field>
        <Field label="WhatsApp number" hint="Include the country code, e.g. 91 98765 43210"><input className="input" value={f.phone} onChange={(e) => setF((s) => ({ ...s, phone: e.target.value }))} /></Field>
        <Toggle checked={f.whatsappOptIn} onChange={(v) => setF((s) => ({ ...s, whatsappOptIn: v }))} label="Send me WhatsApp alerts" hint="In-app notifications always stay on." />
        <BrowserAlerts prefs={f.notifyPrefs} setPref={pref} />
        <h3 className="pt-2 text-sm font-semibold text-muted">Alert me about</h3>
        {[['assigned', 'New assignments'], ['status', 'Status changes'], ['comment', 'Comments and mentions'], ['due', 'Deadlines'], ['approval', 'Approvals']].map(([k, l]) => (
          <Toggle key={k} checked={f.notifyPrefs[k] !== false} onChange={pref(k)} label={l} />
        ))}
      </section>
      <section className="panel space-y-4 self-start p-5">
        <h2 className="font-semibold">Change password</h2>
        <Field label="Current password"><input type="password" className="input" value={f.currentPassword} onChange={(e) => setF((s) => ({ ...s, currentPassword: e.target.value }))} /></Field>
        <Field label="New password" hint="At least 8 characters"><input type="password" className="input" value={f.newPassword} onChange={(e) => setF((s) => ({ ...s, newPassword: e.target.value }))} /></Field>
        <button type="button" className="btn-primary" onClick={save}>Save profile</button>
      </section>
    </div>
  );
}

function Company({ company, onSaved }) {
  const [f, setF] = useState({ graceMinutes: 15, dailyCapacity: 7, currency: 'INR', workStart: '10:00', reviewRetentionDays: 30, ...company });
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  const save = async () => { try { await api.patch('/settings/company', { ...f, graceMinutes: Number(f.graceMinutes), dailyCapacity: Number(f.dailyCapacity), reviewRetentionDays: Number(f.reviewRetentionDays) }); toast.success('Company saved'); onSaved(); } catch (e) { toast.error(e.message); } };
  return (
    <section className="panel max-w-2xl space-y-4 p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Company name"><input className="input" value={f.name} onChange={set('name')} /></Field>
        <Field label="Tagline"><input className="input" value={f.tagline || ''} onChange={set('tagline')} /></Field>
        <Field label="Office starts at" hint="Punch-ins after this plus the grace period are marked late"><input type="time" className="input" value={f.workStart} onChange={set('workStart')} /></Field>
        <Field label="Grace period (minutes)"><input type="number" min={0} className="input" value={f.graceMinutes} onChange={set('graceMinutes')} /></Field>
        <Field label="Working hours per person per day" hint="Used by the workload view"><input type="number" min={1} max={14} className="input" value={f.dailyCapacity} onChange={set('dailyCapacity')} /></Field>
        <Field label="Default currency"><select className="input" value={f.currency} onChange={set('currency')}>{['INR', 'USD', 'EUR', 'GBP', 'AED'].map((c) => <option key={c}>{c}</option>)}</select></Field>
        <Field label="Delete review data after a project is completed" hint="Review files, pinned feedback and comment images are removed this many days after completion. 0 keeps them forever."><div className="flex items-center gap-2"><input type="number" min={0} max={3650} className="input w-28" value={f.reviewRetentionDays} onChange={set('reviewRetentionDays')} /><span className="text-sm text-muted">days</span></div></Field>
      </div>
      <button type="button" className="btn-primary" onClick={save}>Save company</button>
    </section>
  );
}

const MODELS = [
  ['gemini-3.8-flash', 'Gemini 3.8 Flash', 'Fast and smart. The default.'],
  ['gemini-3.6-flash', 'Gemini 3.6 Flash', 'Previous Flash.'],
  ['gemini-3.5-flash-lite', 'Gemini 3.5 Flash-Lite', 'Cheapest, good for high volume.'],
  ['gemini-2.5-flash', 'Gemini 2.5 Flash', 'Older, widely available.'],
];

function Ai({ initial, onSaved }) {
  const [f, setF] = useState({ ...initial, apiKey: initial.apiKey || '' });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const custom = !MODELS.some(([m]) => m === f.model);
  const save = async (quiet) => {
    const { data } = await api.patch('/settings/ai', { enabled: f.enabled, model: f.model, apiKey: f.apiKey });
    setF((s) => ({ ...s, ...data })); refreshAi(); onSaved?.();
    if (!quiet) toast.success('AI settings saved');
  };
  const test = async () => {
    setBusy(true); setResult(null);
    try { await save(true); const { data } = await api.post('/settings/ai/test'); setResult({ ok: true, text: `Connected. ${data.model} replied: "${String(data.reply).trim()}"` }); refreshAi(); } catch (e) { setResult({ ok: false, text: e.message }); } finally { setBusy(false); }
  };
  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.2fr_1fr]">
      <section className="panel space-y-5 p-5">
        <div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-night text-brand"><Sparkles size={18} /></span><div><h2 className="font-semibold">Google Gemini</h2><p className="text-xs text-muted">Powers Ask Orbit, smart task entry, AI planning, briefs, reports, meeting notes and writing help.</p></div></div>
        <Toggle checked={f.enabled} onChange={(v) => setF((s) => ({ ...s, enabled: v }))} label="Turn on AI features" hint="When off, Orbit falls back to rule-based summaries." />
        <Field label="Gemini API key" hint={f.envKey ? 'A key is set on the server (GEMINI_API_KEY). A key here overrides it.' : 'Stored on your server and shown masked. Never sent to the browser again.'}>
          <div className="relative"><KeyRound size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" /><input className="input pl-9 font-mono" value={f.apiKey} onChange={(e) => setF((s) => ({ ...s, apiKey: e.target.value }))} placeholder="AIza..." autoComplete="off" spellCheck={false} /></div>
        </Field>
        <Field label="Model">
          <div className="grid gap-2 sm:grid-cols-2">
            {MODELS.map(([m, l, h]) => <button key={m} type="button" onClick={() => setF((s) => ({ ...s, model: m }))} className={`rounded-xl border p-3 text-left transition ${f.model === m ? 'border-ink bg-brand-soft/40' : 'border-line hover:border-muted'}`}><div className="text-sm font-semibold">{l}</div><div className="text-xs text-muted">{h}</div></button>)}
          </div>
          <input className="input mt-2 font-mono text-xs" value={custom ? f.model : ''} onChange={(e) => setF((s) => ({ ...s, model: e.target.value }))} placeholder="Or type another model id" />
        </Field>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn-primary" onClick={() => save().catch((e) => toast.error(e.message))}>Save</button>
          <button type="button" className="btn-ai" onClick={test} disabled={busy}>{busy ? <Spinner size={14} className="text-violet" /> : <CheckCircle2 size={15} />}Save and test</button>
        </div>
        {result && <p className={`rounded-xl px-3 py-2 text-sm ${result.ok ? 'bg-leaf/10 text-leaf' : 'bg-ember/10 text-ember'}`}>{result.text}</p>}
      </section>
      <section className="panel self-start p-5">
        <h2 className="font-semibold">Get a free key in two minutes</h2>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-muted">
          <li>Open Google AI Studio and sign in with any Google account.</li>
          <li>Click <b className="text-ink">Get API key</b>, then <b className="text-ink">Create API key</b>.</li>
          <li>Copy the key (it starts with AIza) and paste it here.</li>
          <li>Press <b className="text-ink">Save and test</b>.</li>
        </ol>
        <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" className="btn-ghost mt-4"><ExternalLink size={14} />Open Google AI Studio</a>
        <p className="mt-4 text-xs text-muted">The free tier has daily limits that suit a small team. If you hit them, Orbit tries a lighter model and then falls back to rule-based output, so nothing breaks.</p>
      </section>
    </div>
  );
}

function IntegrationCard({ icon: Icon, color, title, desc, children, on, onToggle, steps }) {
  return (
    <section className="panel space-y-4 p-5">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-white" style={{ background: color }}><Icon size={18} /></span>
        <div className="min-w-0 flex-1"><h2 className="font-semibold">{title}</h2><p className="text-xs text-muted">{desc}</p></div>
        <span className={`chip ${on ? 'bg-leaf/10 text-leaf' : 'bg-sunken text-muted'}`}>{on ? 'On' : 'Off'}</span>
      </div>
      <Toggle checked={on} onChange={onToggle} label={`Use ${title}`} />
      {children}
      {steps && <details className="rounded-xl bg-sunken/60 px-3 py-2 text-xs text-muted"><summary className="cursor-pointer font-semibold text-ink">How to set it up</summary><ol className="mt-2 list-decimal space-y-1 pl-4">{steps.map((x, i) => <li key={i}>{x}</li>)}</ol></details>}
    </section>
  );
}

function Integrations({ initial, onSaved }) {
  const [fb, setFb] = useState(initial.firebase);
  const [em, setEm] = useState(initial.email);
  const [zm, setZm] = useState(initial.zoom);
  const [busy, setBusy] = useState('');
  const save = async (key, body, quiet) => {
    const { data } = await api.patch(`/settings/${key}`, body);
    ({ firebase: setFb, email: setEm, zoom: setZm })[key](data);
    if (!quiet) toast.success('Saved'); onSaved?.();
    return data;
  };
  const test = async (key, body, extra) => {
    setBusy(key);
    try { await save(key, body, true); const { data } = await api.post(`/settings/${key}/test`, extra || {}); toast.success(key === 'zoom' ? `Zoom connected (${data.account})` : key === 'email' ? 'Test email sent' : 'Firebase sent a sign-in link to your email'); } catch (e) { toast.error(e.message); } finally { setBusy(''); }
  };
  const fset = (setter) => (k) => (e) => setter((s) => ({ ...s, [k]: e?.target ? (e.target.type === 'checkbox' ? e.target.checked : e.target.value) : e }));
  const F = fset(setFb); const E = fset(setEm); const Z = fset(setZm);
  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
      <IntegrationCard icon={Flame} color="#F5820D" title="Firebase" desc="Sends team invites and password-reset emails with secure sign-in links."
        on={fb.enabled} onToggle={(v) => save('firebase', { ...fb, enabled: v })}
        steps={['Open console.firebase.google.com and create a project (free Spark plan is enough).', 'Authentication, Get started, Sign-in method: turn on Email/Password and Email link (passwordless sign-in).', 'Authentication, Settings, Authorized domains: add your Orbit domain (for example orbit-api-production-a127.up.railway.app).', 'Project settings, General: copy the Web API key and paste it here.']}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Web API key"><input className="input font-mono text-xs" value={fb.apiKey || ''} onChange={F('apiKey')} placeholder="AIza..." autoComplete="off" /></Field>
          <Field label="Project ID" hint="Optional, for your reference"><input className="input" value={fb.projectId || ''} onChange={F('projectId')} placeholder="corcus-orbit" /></Field>
        </div>
        <div className="flex gap-2"><button type="button" className="btn-primary" onClick={() => save('firebase', fb).catch((e) => toast.error(e.message))}>Save</button><button type="button" className="btn-ghost" disabled={busy === 'firebase'} onClick={() => test('firebase', fb)}>{busy === 'firebase' ? <Spinner size={14} /> : <Send size={14} />}Send me a test link</button></div>
      </IntegrationCard>

      <IntegrationCard icon={Mail} color="#3D5AFE" title="Email (SMTP)" desc="Meeting invites with calendar files, client approvals and a backup for invites. Firebase can't send these."
        on={em.enabled} onToggle={(v) => save('email', { ...em, enabled: v })}
        steps={['Hostinger mailbox: host smtp.hostinger.com, port 465, your full email and its password.', 'Gmail: turn on 2-step verification, create an App password, then host smtp.gmail.com, port 465, your Gmail and the 16-letter app password.', 'Set From to something like Corcus Studio <noreply@corcus.in>.']}>
        <div className="grid gap-3 sm:grid-cols-[1fr_110px]">
          <Field label="SMTP host"><input className="input" value={em.host || ''} onChange={E('host')} placeholder="smtp.hostinger.com" /></Field>
          <Field label="Port"><input type="number" className="input" value={em.port || 465} onChange={E('port')} /></Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Username"><input className="input" value={em.user || ''} onChange={E('user')} placeholder="noreply@corcus.in" autoComplete="off" /></Field>
          <Field label="Password"><PasswordInput value={em.pass || ''} onChange={E('pass')} autoComplete="new-password" /></Field>
          <Field label="From" className="sm:col-span-2"><input className="input" value={em.from || ''} onChange={E('from')} placeholder="Corcus Studio <noreply@corcus.in>" /></Field>
        </div>
        <div className="flex gap-2"><button type="button" className="btn-primary" onClick={() => save('email', em).catch((e) => toast.error(e.message))}>Save</button><button type="button" className="btn-ghost" disabled={busy === 'email'} onClick={() => test('email', em)}>{busy === 'email' ? <Spinner size={14} /> : <Send size={14} />}Send a test email</button></div>
      </IntegrationCard>

      <IntegrationCard icon={Video} color="#2D8CFF" title="Zoom" desc="Creates a Zoom meeting for every meeting you schedule in Orbit, and keeps time changes in sync."
        on={zm.enabled} onToggle={(v) => save('zoom', { ...zm, enabled: v })}
        steps={['Go to marketplace.zoom.us, Develop, Build App, and choose Server-to-Server OAuth.', 'Add scopes: meeting:write:meeting:admin, meeting:update:meeting:admin, meeting:delete:meeting:admin and user:read:user:admin (or the older meeting:write:admin and user:read:admin).', 'Activate the app, then copy the Account ID, Client ID and Client secret here.']}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Account ID"><input className="input font-mono text-xs" value={zm.accountId || ''} onChange={Z('accountId')} autoComplete="off" /></Field>
          <Field label="Client ID"><input className="input font-mono text-xs" value={zm.clientId || ''} onChange={Z('clientId')} autoComplete="off" /></Field>
          <Field label="Client secret" className="sm:col-span-2"><PasswordInput value={zm.clientSecret || ''} onChange={Z('clientSecret')} autoComplete="new-password" /></Field>
        </div>
        <div className="flex gap-2"><button type="button" className="btn-primary" onClick={() => save('zoom', zm).catch((e) => toast.error(e.message))}>Save</button><button type="button" className="btn-ghost" disabled={busy === 'zoom'} onClick={() => test('zoom', zm)}>{busy === 'zoom' ? <Spinner size={14} /> : <CheckCircle2 size={14} />}Test connection</button></div>
      </IntegrationCard>
    </div>
  );
}

const QTYPES = [['text', 'Short text'], ['textarea', 'Paragraph'], ['email', 'Email'], ['tel', 'Phone'], ['url', 'Link'], ['choice', 'One choice'], ['multi', 'Several choices'], ['date', 'Date'], ['secret', 'Password (encrypted)']];
const MAPS = [['', 'Nothing'], ['name', 'Client name'], ['industry', 'Industry'], ['phone', 'Phone'], ['whatsapp', 'WhatsApp'], ['email', 'Email'], ['city', 'City / address'], ['website', 'Website']];

function SignupSettings({ initial, onSaved }) {
  const [f, setF] = useState(initial);
  const [open, setOpen] = useState(null);
  const [busy, setBusy] = useState(false);
  const link = `${window.location.origin}/signup`;
  const setQ = (i, patch) => setF((s) => ({ ...s, questions: s.questions.map((q, j) => (j === i ? { ...q, ...patch } : q)) }));
  const move = (i, d) => setF((s) => { const qs = [...s.questions]; const j = i + d; if (j < 0 || j >= qs.length) return s; [qs[i], qs[j]] = [qs[j], qs[i]]; return { ...s, questions: qs }; });
  const add = () => { setF((s) => ({ ...s, questions: [...s.questions, { id: `q_${Date.now().toString(36)}`, label: 'New question', type: 'text', required: false }] })); setOpen(f.questions.length); };
  const save = async () => {
    setBusy(true);
    try { const { data } = await api.put('/settings/onboarding', f); setF(data); toast.success('Sign-up form saved'); onSaved?.(); } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
      <section className="panel space-y-3 p-5">
        <div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold">Onboarding questions</h2><span className="text-xs text-muted">{f.questions.length} questions</span>
          <div className="ml-auto flex gap-2"><button type="button" className="btn-ghost btn-sm" onClick={add}>Add question</button><button type="button" className="btn-primary btn-sm" disabled={busy} onClick={save}>Save form</button></div></div>
        <p className="text-xs text-muted">This is what new clients fill in when they sign up, and what they can update later in their portal. Paste your Google Form questions here as new questions.</p>
        <ol className="space-y-2">
          {f.questions.map((q, i) => (
            <li key={q.id} className="rounded-xl border border-line bg-surface">
              <div className="flex items-center gap-2 px-3 py-2">
                <span className="w-6 text-center text-xs font-semibold text-faint">{i + 1}</span>
                <button type="button" className="min-w-0 flex-1 truncate text-left text-sm font-medium" onClick={() => setOpen(open === i ? null : i)}>{q.label}{q.required && <span className="text-ember"> *</span>}</button>
                <span className="chip bg-sunken text-muted">{QTYPES.find(([k]) => k === q.type)?.[1]}</span>
                {q.showIf && <span className="chip bg-violet/10 text-violet">conditional</span>}
                <button type="button" className="rounded p-1 text-muted hover:bg-sunken disabled:opacity-30" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Up">↑</button>
                <button type="button" className="rounded p-1 text-muted hover:bg-sunken disabled:opacity-30" disabled={i === f.questions.length - 1} onClick={() => move(i, 1)} aria-label="Down">↓</button>
                <button type="button" className="rounded p-1 text-muted hover:bg-sunken hover:text-ember" onClick={() => setF((s) => ({ ...s, questions: s.questions.filter((_, j) => j !== i) }))} aria-label="Delete">✕</button>
              </div>
              {open === i && (
                <div className="grid gap-3 border-t border-line p-3 sm:grid-cols-2">
                  <Field label="Question" className="sm:col-span-2"><input className="input" value={q.label} onChange={(e) => setQ(i, { label: e.target.value })} /></Field>
                  <Field label="Answer type"><select className="input" value={q.type} onChange={(e) => setQ(i, { type: e.target.value })}>{QTYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
                  <Field label="Section heading" hint="Questions with the same heading are grouped"><input className="input" value={q.section || ''} onChange={(e) => setQ(i, { section: e.target.value })} placeholder="Social media" /></Field>
                  {['choice', 'multi'].includes(q.type) && <Field label="Options" hint="Comma separated" className="sm:col-span-2"><input className="input" value={(q.options || []).join(', ')} onChange={(e) => setQ(i, { options: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} /></Field>}
                  <Field label="Help text" className="sm:col-span-2"><input className="input" value={q.hint || ''} onChange={(e) => setQ(i, { hint: e.target.value })} /></Field>
                  <Field label="Fills the client's"><select className="input" value={q.maps || ''} onChange={(e) => setQ(i, { maps: e.target.value || undefined })}>{MAPS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
                  <Field label="Only show when">
                    <div className="flex gap-2">
                      <select className="input" value={q.showIf?.id || ''} onChange={(e) => setQ(i, { showIf: e.target.value ? { id: e.target.value, is: q.showIf?.is || '' } : undefined })}><option value="">Always</option>{f.questions.filter((x) => x.id !== q.id && x.type === 'choice').map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select>
                      {q.showIf?.id && <select className="input" value={q.showIf.is} onChange={(e) => setQ(i, { showIf: { ...q.showIf, is: e.target.value } })}><option value="">pick</option>{(f.questions.find((x) => x.id === q.showIf.id)?.options || []).map((o) => <option key={o}>{o}</option>)}</select>}
                    </div>
                  </Field>
                  <div className="sm:col-span-2"><Toggle checked={!!q.required} onChange={(v) => setQ(i, { required: v })} label="Required" /></div>
                </div>
              )}
            </li>
          ))}
        </ol>
      </section>
      <section className="panel h-fit space-y-4 p-5">
        <Toggle checked={f.allowSignup !== false} onChange={(v) => setF((s) => ({ ...s, allowSignup: v }))} label="Let clients sign up" hint="Shows a Create account option on the sign-in page." />
        <Toggle checked={!!f.autoApprove} onChange={(v) => setF((s) => ({ ...s, autoApprove: v }))} label="Approve automatically" hint="Off: you approve each new client from the Clients page first." />
        <Field label="Welcome line"><textarea className="input" rows={3} value={f.welcome || ''} onChange={(e) => setF((s) => ({ ...s, welcome: e.target.value }))} /></Field>
        <Field label="Sign-up link to share"><div className="flex gap-2"><input readOnly className="input text-xs" value={link} onFocus={(e) => e.target.select()} /><button type="button" className="btn-ghost shrink-0" onClick={() => { navigator.clipboard?.writeText(link); toast.success('Link copied'); }}>Copy</button></div></Field>
        <a href="/signup" target="_blank" rel="noreferrer" className="btn-ghost w-full"><ExternalLink size={14} />Preview the form</a>
        <button type="button" className="btn-primary w-full" disabled={busy} onClick={save}>Save form</button>
      </section>
    </div>
  );
}

function Appearance() {
  const [theme, , setTheme] = useTheme();
  return (
    <section className="panel max-w-xl space-y-4 p-5">
      <Field label="Theme"><Segmented value={theme} onChange={setTheme} options={[{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} /></Field>
      <p className="text-xs text-muted">Saved on this device. Light is the default.</p>
    </section>
  );
}

function WhatsApp({ initial }) {
  const [f, setF] = useState(initial);
  const [test, setTest] = useState('');
  const [logs, setLogs] = useState([]);
  const loadLogs = () => api.get('/settings/whatsapp/logs').then((r) => setLogs(r.data));
  useEffect(() => { loadLogs(); }, []);
  const set = (path) => (v) => setF((s) => {
    const n = JSON.parse(JSON.stringify(s)); const keys = path.split('.'); let o = n;
    keys.slice(0, -1).forEach((k) => { o = o[k]; }); o[keys.at(-1)] = v?.target ? v.target.value : v; return n;
  });
  const save = async () => { try { const { data } = await api.patch('/settings/whatsapp', f); setF(data); toast.success('WhatsApp settings saved'); } catch (e) { toast.error(e.message); } };
  const sendTest = async () => {
    try {
      await api.patch('/settings/whatsapp', f);
      const { data } = await api.post('/settings/whatsapp/test', { phone: test });
      if (data.status === 'failed') toast.error(`Not sent: ${data.error}`); else toast.success(data.status === 'logged' ? 'Logged (provider is set to Log only)' : 'Test message sent');
      loadLogs();
    } catch (e) { toast.error(e.message); }
  };
  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.2fr_1fr]">
      <section className="panel space-y-5 p-5">
        <Toggle checked={f.enabled} onChange={set('enabled')} label="Send WhatsApp notifications" hint="When off, people only get in-app notifications." />
        <Field label="How messages are sent">
          <Segmented value={f.provider} onChange={set('provider')} options={[{ value: 'log', label: 'Log only (testing)' }, { value: 'corcus', label: 'chat.corcus.in' }, { value: 'meta', label: 'WhatsApp Cloud API' }, { value: 'custom', label: 'Other API' }]} />
        </Field>
        {f.provider === 'meta' && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Permanent access token" className="sm:col-span-2"><input className="input" value={f.meta.token} onChange={set('meta.token')} placeholder="EAAG…" /></Field>
            <Field label="Phone number ID"><input className="input" value={f.meta.phoneNumberId} onChange={set('meta.phoneNumberId')} /></Field>
            <Field label="API version"><input className="input" value={f.meta.apiVersion} onChange={set('meta.apiVersion')} /></Field>
            <Field label="Message type" className="sm:col-span-2" hint="Business-started messages need an approved template with one body variable {{1}}. Plain text only reaches people who messaged you in the last 24 hours.">
              <Segmented value={f.meta.mode} onChange={set('meta.mode')} options={[{ value: 'template', label: 'Approved template' }, { value: 'text', label: 'Plain text' }]} />
            </Field>
            {f.meta.mode === 'template' && (<>
              <Field label="Template name"><input className="input" value={f.meta.templateName} onChange={set('meta.templateName')} /></Field>
              <Field label="Template language"><input className="input" value={f.meta.templateLang} onChange={set('meta.templateLang')} placeholder="en" /></Field>
            </>)}
          </div>
        )}
        {f.provider === 'corcus' && (
          <div className="space-y-4 rounded-xl border border-leaf/30 bg-leaf/5 p-4">
            <p className="text-xs text-muted">In chat.corcus.in open <b>Channels → WhatsApp</b>, click <b>⋮</b> on your number and choose <b>Access Token</b>. Copy the token, API URL, API version and Phone number ID from there. The token is shown only once, so paste it here straight away.</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="API URL"><input className="input font-mono text-xs" value={f.corcus?.baseUrl || ''} onChange={set('corcus.baseUrl')} placeholder="https://crmapi.1automations.com/api/meta" /></Field>
              <Field label="API version"><input className="input" value={f.corcus?.apiVersion || ''} onChange={set('corcus.apiVersion')} placeholder="v19.0" /></Field>
              <Field label="Access token" className="sm:col-span-2"><PasswordInput value={f.corcus?.token || ''} onChange={set('corcus.token')} autoComplete="off" /></Field>
              <Field label="Phone number ID" hint="The long ID, not the phone number itself"><input className="input" value={f.corcus?.phoneNumberId || ''} onChange={set('corcus.phoneNumberId')} placeholder="1277701765431660" /></Field>
            </div>
            <Field label="Message type" hint="Messages Orbit starts need an approved template with one body variable {{1}}. Plain text only reaches people who messaged your number in the last 24 hours.">
              <Segmented value={f.corcus?.mode || 'template'} onChange={set('corcus.mode')} options={[{ value: 'template', label: 'Approved template' }, { value: 'text', label: 'Plain text' }]} />
            </Field>
            {(f.corcus?.mode || 'template') === 'template' && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Template name" hint="Exactly as approved in the panel"><input className="input" value={f.corcus?.templateName || ''} onChange={set('corcus.templateName')} /></Field>
                <Field label="Template language"><input className="input" value={f.corcus?.templateLang || ''} onChange={set('corcus.templateLang')} placeholder="en" /></Field>
              </div>
            )}
          </div>
        )}
        {f.provider === 'custom' && (
          <div className="space-y-4">
            <p className="text-xs text-muted">Works with most WhatsApp panels and BSPs (your own white-label panel, Interakt, WATI, AiSensy and similar). Use {'{{phone}}'} and {'{{message}}'} as placeholders.</p>
            <div className="grid gap-4 sm:grid-cols-[110px_1fr]">
              <Field label="Method"><select className="input" value={f.custom.method} onChange={set('custom.method')}><option>POST</option><option>GET</option></select></Field>
              <Field label="API URL"><input className="input" value={f.custom.url} onChange={set('custom.url')} placeholder="https://chat.yourpanel.in/api/send" /></Field>
            </div>
            <Field label="Headers (JSON)"><textarea className="input font-mono text-xs" rows={3} value={f.custom.headers} onChange={set('custom.headers')} /></Field>
            {f.custom.method !== 'GET' && <Field label="Body (JSON)"><textarea className="input font-mono text-xs" rows={4} value={f.custom.bodyTemplate} onChange={set('custom.bodyTemplate')} /></Field>}
          </div>
        )}
        <Field label="Default country code" hint="Added to 10-digit numbers"><input className="input !w-28" value={f.defaultCountryCode} onChange={set('defaultCountryCode')} /></Field>
        <div>
          <h3 className="mb-2 text-sm font-semibold text-muted">Which events go to WhatsApp</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {EVENTS.map(([k, l, h]) => <div key={k} className="panel-quiet p-3"><Toggle checked={f.events[k] !== false} onChange={(v) => set(`events.${k}`)(v)} label={l} hint={h} /></div>)}
          </div>
        </div>
        <button type="button" className="btn-primary" onClick={save}>Save WhatsApp settings</button>
      </section>
      <section className="panel self-start p-5">
        <h2 className="mb-3 flex items-center gap-2 font-semibold"><MessageCircle size={17} className="text-leaf" />Send a test</h2>
        <div className="flex gap-2"><input className="input" placeholder="91 98765 43210" value={test} onChange={(e) => setTest(e.target.value)} /><button type="button" className="btn-ghost" onClick={sendTest}><Send size={15} />Send</button></div>
        <h3 className="mb-2 mt-6 text-sm font-semibold text-muted">Recent messages</h3>
        <ul className="max-h-[420px] space-y-2 overflow-y-auto">
          {logs.map((l) => (
            <li key={l.id} className="rounded-xl border border-line bg-sunken/50 p-3 text-xs">
              <div className="mb-1 flex justify-between"><span className="font-semibold">+{l.to}</span><span className={l.status === 'failed' ? 'text-ember' : l.status === 'sent' ? 'text-leaf' : 'text-muted'}>{l.status}, {ago(l.createdAt)}</span></div>
              <p className="whitespace-pre-wrap text-muted">{l.message}</p>
              {l.error && <p className="mt-1 text-ember">{l.error}</p>}
            </li>
          ))}
          {!logs.length && <li className="text-sm text-muted">Nothing sent yet.</li>}
        </ul>
      </section>
    </div>
  );
}

export default function Settings() {
  const { can, refresh } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'profile';
  const setTab = (t) => setParams({ tab: t }, { replace: true });
  const [s, setS] = useState(null);
  const load = () => api.get('/settings').then((r) => setS(r.data));
  useEffect(() => { load(); }, []);
  const admin = can('settings.manage');
  const tabs = [{ value: 'profile', label: 'My profile', icon: User }, { value: 'appearance', label: 'Appearance', icon: Palette },
    ...(admin ? [{ value: 'company', label: 'Company', icon: Building2 }, { value: 'ai', label: 'AI', icon: Sparkles }, { value: 'whatsapp', label: 'WhatsApp', icon: MessageCircle }, { value: 'integrations', label: 'Email, Firebase, Zoom', icon: Plug }, { value: 'signup', label: 'Client sign-up', icon: UserPlus }] : [])];
  return (
    <div>
      <PageHeader title="Settings" />
      <div className="mb-5"><Tabs value={tab} onChange={setTab} tabs={tabs} /></div>
      {tab === 'profile' && <Profile />}
      {tab === 'appearance' && <Appearance />}
      {tab === 'company' && admin && (s ? <Company company={s.company} onSaved={() => { load(); refresh(); }} /> : <PageLoader />)}
      {tab === 'ai' && admin && (s?.ai ? <Ai initial={s.ai} onSaved={load} /> : <PageLoader />)}
      {tab === 'whatsapp' && admin && (s?.whatsapp ? <WhatsApp initial={s.whatsapp} /> : <PageLoader />)}
      {tab === 'integrations' && admin && (s?.email ? <Integrations initial={s} onSaved={load} /> : <PageLoader />)}
      {tab === 'signup' && admin && (s?.onboarding ? <SignupSettings initial={s.onboarding} onSaved={load} /> : <PageLoader />)}
    </div>
  );
}
