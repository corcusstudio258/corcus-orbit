import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { MessageCircle, Send } from 'lucide-react';
import api from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { Field, Toggle, PageLoader, Segmented } from '../components/ui';
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
        <h3 className="pt-2 text-sm font-semibold text-mist">Alert me about</h3>
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
  const [f, setF] = useState(company);
  const save = async () => { try { await api.patch('/settings/company', f); toast.success('Company saved'); onSaved(); } catch (e) { toast.error(e.message); } };
  return (
    <section className="panel max-w-xl space-y-4 p-5">
      <Field label="Company name"><input className="input" value={f.name} onChange={(e) => setF((s) => ({ ...s, name: e.target.value }))} /></Field>
      <Field label="Tagline"><input className="input" value={f.tagline || ''} onChange={(e) => setF((s) => ({ ...s, tagline: e.target.value }))} /></Field>
      <button type="button" className="btn-primary" onClick={save}>Save company</button>
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
    <div className="grid gap-5 xl:grid-cols-[1.2fr_1fr]">
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
            <p className="text-xs text-mist">Works with most WhatsApp panels and BSPs (your own white-label panel, Interakt, WATI, AiSensy and similar). Use {'{{phone}}'} and {'{{message}}'} as placeholders.</p>
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
          <h3 className="mb-2 text-sm font-semibold text-mist">Which events go to WhatsApp</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {EVENTS.map(([k, l, h]) => <div key={k} className="panel-quiet p-3"><Toggle checked={f.events[k] !== false} onChange={(v) => set(`events.${k}`)(v)} label={l} hint={h} /></div>)}
          </div>
        </div>
        <button type="button" className="btn-primary" onClick={save}>Save WhatsApp settings</button>
      </section>
      <section className="panel self-start p-5">
        <h2 className="mb-3 flex items-center gap-2 font-semibold"><MessageCircle size={17} className="text-mint" />Send a test</h2>
        <div className="flex gap-2"><input className="input" placeholder="91 98765 43210" value={test} onChange={(e) => setTest(e.target.value)} /><button type="button" className="btn-ghost" onClick={sendTest}><Send size={15} />Send</button></div>
        <h3 className="mb-2 mt-6 text-sm font-semibold text-mist">Recent messages</h3>
        <ul className="max-h-[420px] space-y-2 overflow-y-auto">
          {logs.map((l) => (
            <li key={l.id} className="rounded-xl border border-line bg-white/[0.02] p-3 text-xs">
              <div className="mb-1 flex justify-between"><span className="font-semibold">+{l.to}</span><span className={l.status === 'failed' ? 'text-rose' : l.status === 'sent' ? 'text-mint' : 'text-mist'}>{l.status}, {ago(l.createdAt)}</span></div>
              <p className="whitespace-pre-wrap text-mist">{l.message}</p>
              {l.error && <p className="mt-1 text-rose">{l.error}</p>}
            </li>
          ))}
          {!logs.length && <li className="text-sm text-mist">Nothing sent yet.</li>}
        </ul>
      </section>
    </div>
  );
}

export default function Settings() {
  const { can, refresh } = useAuth();
  const [tab, setTab] = useState('profile');
  const [s, setS] = useState(null);
  const load = () => api.get('/settings').then((r) => setS(r.data));
  useEffect(() => { load(); }, []);
  const tabs = [['profile', 'My profile'], ...(can('settings.manage') ? [['company', 'Company'], ['whatsapp', 'WhatsApp']] : [])];
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <div className="flex gap-1">{tabs.map(([k, l]) => <button type="button" key={k} onClick={() => setTab(k)} className={`tab ${tab === k ? 'tab-active' : ''}`}>{l}</button>)}</div>
      {tab === 'profile' && <Profile />}
      {tab === 'company' && (s ? <Company company={s.company} onSaved={() => { load(); refresh(); }} /> : <PageLoader />)}
      {tab === 'whatsapp' && (s?.whatsapp ? <WhatsApp initial={s.whatsapp} /> : <PageLoader />)}
    </div>
  );
}
