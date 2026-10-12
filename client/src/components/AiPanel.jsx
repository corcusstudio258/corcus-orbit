import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import { Sparkles, Send, X, Check, Wand2, RotateCcw, Settings2 } from 'lucide-react';
import api from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useAiStatus } from '../lib/directory';
import { Markdown, Spinner } from './ui';

const STARTERS = [
  'What should I work on first today?',
  'Which tasks are overdue across my projects?',
  'Summarise where the Kasaar project stands',
  'Who on the team has the most on their plate?',
];
const KEY = 'orbit_ai_chat';
const load = () => { try { return JSON.parse(sessionStorage.getItem(KEY) || '[]'); } catch { return []; } };
const save = (m) => { try { sessionStorage.setItem(KEY, JSON.stringify(m.slice(-30))); } catch { /* ignore */ } };

function ActionCard({ action }) {
  const [state, setState] = useState('idle');
  const run = async () => {
    setState('busy');
    try {
      const { data } = await api.post('/ai/execute', { action });
      setState('done'); toast.success(data.message);
      window.dispatchEvent(new CustomEvent('orbit:task-created', { detail: { id: data.taskId } }));
    } catch (e) { setState('idle'); toast.error(e.message); }
  };
  return (
    <div className="flex items-center gap-3 rounded-xl border border-violet/25 bg-violet/5 px-3 py-2">
      <Wand2 size={15} className="shrink-0 text-violet" />
      <span className="min-w-0 flex-1 text-sm">{action.label}</span>
      {state === 'done' ? <span className="inline-flex items-center gap-1 text-xs font-semibold text-leaf"><Check size={14} />Done</span>
        : <button type="button" className="btn-ai btn-sm" disabled={state === 'busy'} onClick={run}>{state === 'busy' ? <Spinner size={13} /> : 'Do it'}</button>}
    </div>
  );
}

/** The assistant conversation. Used in the floating panel and on the Ask Orbit page. */
export function AssistantChat({ seed, compact, projectId }) {
  const { user, can } = useAuth();
  const ai = useAiStatus();
  const [messages, setMessages] = useState(load);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const end = useRef(null);
  useEffect(() => { save(messages); end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [messages, busy]);
  useEffect(() => { if (seed?.q) ask(seed.q); }, [seed?.at]); // eslint-disable-line react-hooks/exhaustive-deps

  async function ask(q) {
    const question = (q ?? text).trim();
    if (!question || busy) return;
    setText('');
    const next = [...messages, { role: 'user', text: question }];
    setMessages(next); setBusy(true);
    try {
      const { data } = await api.post('/ai/ask', { messages: next.map((m) => ({ role: m.role, text: m.text })), projectId });
      setMessages((m) => [...m, { role: 'model', text: data.reply, actions: data.actions, followUps: data.followUps }]);
    } catch (e) {
      setMessages((m) => [...m, { role: 'model', text: e.message, error: true }]);
    } finally { setBusy(false); }
  }

  if (!ai.ready) {
    return (
      <div className="grid flex-1 place-items-center p-6 text-center">
        <div className="max-w-sm">
          <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-night text-brand"><Sparkles size={24} /></div>
          <h3 className="text-lg font-semibold">Orbit AI isn't switched on yet</h3>
          <p className="mt-2 text-sm text-muted">It runs on Google Gemini. {can('settings.manage') ? 'Paste a free Gemini API key in Settings and the assistant, smart task entry, briefs and reports light up for everyone.' : 'Ask your admin to add a Gemini API key in Settings.'}</p>
          {can('settings.manage') && <Link to="/settings?tab=ai" className="btn-primary mt-5"><Settings2 size={16} />Set up AI</Link>}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className={clsx('flex-1 space-y-4 overflow-y-auto', compact ? 'px-4 py-4' : 'px-1 py-2')}>
        {!messages.length && (
          <div className="py-6 text-center">
            <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-night text-brand"><Sparkles size={22} /></div>
            <h3 className="text-lg font-semibold">Hi {user.name.split(' ')[0]}, what do you need?</h3>
            <p className="mx-auto mt-1 max-w-xs text-sm text-muted">Ask about tasks, projects and the team, or tell me what to create. English, Hindi or Hinglish all work.</p>
            <div className={clsx('mx-auto mt-5 grid gap-2 text-left', compact ? 'max-w-sm' : 'max-w-xl sm:grid-cols-2')}>
              {STARTERS.map((s) => <button key={s} type="button" onClick={() => ask(s)} className="rounded-xl border border-line bg-surface px-3 py-2.5 text-sm text-ink transition hover:border-violet/40 hover:bg-violet/5">{s}</button>)}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={clsx('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
            {m.role === 'user' ? (
              <div className="max-w-[85%] rounded-2xl rounded-br-md bg-ink px-4 py-2.5 text-sm text-surface">{m.text}</div>
            ) : (
              <div className="w-full max-w-[95%] space-y-2">
                <div className={clsx('rounded-2xl rounded-bl-md border px-4 py-3', m.error ? 'border-ember/30 bg-ember/5 text-ember' : 'border-line bg-surface')}>
                  {m.error ? <p className="text-sm">{m.text}</p> : <Markdown>{m.text}</Markdown>}
                </div>
                {m.actions?.map((a, j) => <ActionCard key={j} action={a} />)}
                {i === messages.length - 1 && m.followUps?.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">{m.followUps.map((f) => <button key={f} type="button" onClick={() => ask(f)} className="rounded-full border border-line bg-surface px-3 py-1 text-xs text-muted hover:border-violet/40 hover:text-ink">{f}</button>)}</div>
                )}
              </div>
            )}
          </div>
        ))}
        {busy && <div className="flex items-center gap-2 text-sm text-muted"><Spinner size={15} className="text-violet" />Thinking with your workspace data…</div>}
        <div ref={end} />
      </div>
      <form onSubmit={(e) => { e.preventDefault(); ask(); }} className={clsx('flex items-end gap-2 border-t border-line bg-surface', compact ? 'p-3' : 'rounded-2xl border p-2')}>
        {messages.length > 0 && <button type="button" onClick={() => setMessages([])} className="rounded-lg p-2 text-muted hover:bg-sunken" title="New conversation"><RotateCcw size={16} /></button>}
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={1} placeholder="Ask Orbit anything…"
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(); } }}
          className="max-h-32 min-h-[40px] flex-1 resize-none bg-transparent px-2 py-2 text-sm outline-none placeholder:text-faint" />
        <button className="btn-ink !rounded-xl !px-3" disabled={!text.trim() || busy} aria-label="Send"><Send size={16} /></button>
      </form>
      <p className={clsx('text-center text-[11px] text-faint', compact ? 'pb-2' : 'mt-2')}>Powered by Gemini. Answers use only what you're allowed to see.</p>
    </div>
  );
}

export default function AiPanel({ open, onClose, seed }) {
  if (!open) return null;
  return (
    <div className="fixed bottom-24 right-5 z-50 flex h-[min(640px,calc(100vh-130px))] w-[min(430px,calc(100vw-24px))] animate-rise flex-col overflow-hidden rounded-2xl border border-line bg-canvas shadow-pop" role="dialog" aria-label="Ask Orbit AI">
      <div className="flex items-center gap-3 bg-night px-4 py-3 text-white">
        <span className="grid h-8 w-8 place-items-center rounded-xl bg-brand text-brand-ink"><Sparkles size={16} /></span>
        <div className="flex-1"><div className="font-display font-semibold">Ask Orbit</div><div className="text-[11px] text-white/60">Gemini, press Ctrl J any time</div></div>
        <Link to="/ai" onClick={onClose} className="rounded-lg px-2 py-1 text-xs text-white/70 hover:bg-white/10">Full screen</Link>
        <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-white/70 hover:bg-white/10" aria-label="Close"><X size={18} /></button>
      </div>
      <AssistantChat seed={seed} compact />
    </div>
  );
}
