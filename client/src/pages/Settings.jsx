import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { MessageCircle, Send, Sparkles, KeyRound, ExternalLink, CheckCircle2, User, Building2, Palette } from 'lucide-react';
import api from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { refreshAi } from '../lib/directory';
import { useTheme } from '../lib/theme';
import { Field, Toggle, PageLoader, Segmented, PageHeader, Tabs, Spinner } from '../components/ui';
import { ago } from '../lib/format';

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
  const [f, setF] = useState({ graceMinutes: 15, dailyCapacity: 7, currency: 'INR', workStart: '10:00', ...company });
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  const save = async () => { try { await api.patch('/settings/company', { ...f, graceMinutes: Number(f.graceMinutes), dailyCapacity: Number(f.dailyCapacity) }); toast.success('Company saved'); onSaved(); } catch (e) { toast.error(e.message); } };
  return (
    <section className="panel max-w-2xl space-y-4 p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Company name"><input className="input" value={f.name} onChange={set('name')} /></Field>
        <Field label="Tagline"><input className="input" value={f.tagline || ''} onChange={set('tagline')} /></Field>
        <Field label="Office starts at" hint="Punch-ins after this plus the grace period are marked late"><input type="time" className="input" value={f.workStart} onChange={set('workStart')} /></Field>
        <Field label="Grace period (minutes)"><input type="number" min={0} className="input" value={f.graceMinutes} onChange={set('graceMinutes')} /></Field>
        <Field label="Working hours per person per day" hint="Used by the workload view"><input type="number" min={1} max={14} className="input" value={f.dailyCapacity} onChange={set('dailyCapacity')} /></Field>
        <Field label="Default currency"><select className="input" value={f.currency} onChange={set('currency')}>{['INR', 'USD', 'EUR', 'GBP', 'AED'].map((c) => <option key={c}>{c}</option>)}</select></Field>
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
          <Segmented value={f.provider} onChange={set('provider')} options={[{ value: 'log', label: 'Log only (testing)' }, { value: 'meta', label: 'WhatsApp Cloud API' }, { value: 'custom', label: 'My WhatsApp API' }]} />
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
    ...(admin ? [{ value: 'company', label: 'Company', icon: Building2 }, { value: 'ai', label: 'AI', icon: Sparkles }, { value: 'whatsapp', label: 'WhatsApp', icon: MessageCircle }] : [])];
  return (
    <div>
      <PageHeader title="Settings" />
      <div className="mb-5"><Tabs value={tab} onChange={setTab} tabs={tabs} /></div>
      {tab === 'profile' && <Profile />}
      {tab === 'appearance' && <Appearance />}
      {tab === 'company' && admin && (s ? <Company company={s.company} onSaved={() => { load(); refresh(); }} /> : <PageLoader />)}
      {tab === 'ai' && admin && (s?.ai ? <Ai initial={s.ai} onSaved={load} /> : <PageLoader />)}
      {tab === 'whatsapp' && admin && (s?.whatsapp ? <WhatsApp initial={s.whatsapp} /> : <PageLoader />)}
    </div>
  );
}
