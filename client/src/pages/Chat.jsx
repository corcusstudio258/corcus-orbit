import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import { format, isSameDay, isToday, isYesterday } from 'date-fns';
import { Hash, Lock, Plus, Send, ArrowLeft, MessageSquare, Pencil, Trash2, Search, AtSign, Users } from 'lucide-react';
import api from '../lib/api';
import { useAuth, useSocketEvent } from '../context/AuthContext';
import { useDirectory } from '../lib/directory';
import { Avatar, Modal, Field, UserPicker, Toggle, Empty, PageLoader, confirm, Spinner } from '../components/ui';
import { useOpenTask } from '../components/Layout';
import { STATUS, ago } from '../lib/format';

const dayLabel = (d) => (isToday(d) ? 'Today' : isYesterday(d) ? 'Yesterday' : format(d, 'EEEE, d MMMM'));

function Body({ text, people, meId }) {
  const names = people.map((p) => p.name).sort((a, b) => b.length - a.length).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!names.length) return <>{text}</>;
  const re = new RegExp(`(@(?:${names.join('|')}))`, 'g');
  return text.split(re).map((part, i) => {
    if (!part.startsWith('@')) return <Fragment key={i}>{part}</Fragment>;
    const who = people.find((p) => `@${p.name}` === part);
    return <span key={i} className={clsx('rounded px-0.5 font-semibold', who?.id === meId ? 'bg-brand/40 text-ink' : 'text-cobalt')}>{part}</span>;
  });
}

function NewChannel({ open, onClose, onCreated }) {
  const people = useDirectory();
  const [f, setF] = useState({ name: '', description: '', isPrivate: false, memberIds: [] });
  const save = async () => {
    try { const r = await api.post('/chat/channels', f); onCreated(r.data.id); setF({ name: '', description: '', isPrivate: false, memberIds: [] }); } catch (err) { toast.error(err.message); }
  };
  return (
    <Modal open={open} onClose={onClose} title="New channel" footer={<><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button type="button" className="btn-primary" onClick={save}>Create</button></>}>
      <div className="space-y-4">
        <Field label="Name"><div className="relative"><Hash size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" /><input className="input pl-8" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="design-reviews" autoFocus /></div></Field>
        <Field label="What it's for"><input className="input" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <Toggle checked={f.isPrivate} onChange={(v) => setF({ ...f, isPrivate: v })} label="Private" hint="Only people you add can see it." />
        {f.isPrivate && <Field label="Members"><UserPicker users={people.filter((p) => !p.isClient)} value={f.memberIds} onChange={(v) => setF({ ...f, memberIds: v })} /></Field>}
      </div>
    </Modal>
  );
}

function NewDm({ open, onClose, onOpen }) {
  const { user } = useAuth();
  const people = useDirectory().filter((p) => !p.isClient && p.id !== user.id);
  const [q, setQ] = useState('');
  const start = async (id) => { try { const r = await api.post('/chat/dm', { userId: id }); onOpen(r.data.id); } catch (err) { toast.error(err.message); } };
  return (
    <Modal open={open} onClose={onClose} title="Message a teammate" width="max-w-md">
      <input className="input mb-3" placeholder="Search people" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      <ul className="max-h-80 space-y-0.5 overflow-y-auto">
        {people.filter((p) => p.name.toLowerCase().includes(q.toLowerCase())).map((p) => (
          <li key={p.id}><button type="button" onClick={() => start(p.id)} className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-sunken"><Avatar user={p} size={30} /><span><span className="block text-sm font-medium">{p.name}</span><span className="block text-xs text-muted">{p.designation || p.Role?.name}</span></span></button></li>
        ))}
      </ul>
    </Modal>
  );
}

function Thread({ channelId, channels, people, onBack, reloadChannels }) {
  const { user, socketEmit, online } = useAuth();
  const openTask = useOpenTask();
  const [data, setData] = useState(null);
  const [text, setText] = useState('');
  const [mentions, setMentions] = useState([]);
  const [picker, setPicker] = useState(null);
  const [typing, setTyping] = useState({});
  const [editing, setEditing] = useState(null);
  const [sending, setSending] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const scroller = useRef(null);
  const input = useRef(null);
  const lastTyped = useRef(0);
  const ch = channels.find((c) => c.id === channelId);

  const toBottom = () => requestAnimationFrame(() => { if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight; });
  useEffect(() => {
    setData(null); setText(''); setTyping({});
    api.get(`/chat/channels/${channelId}/messages`).then((r) => { setData(r.data); toBottom(); reloadChannels(); }).catch((e) => setData({ error: e.message, messages: [] }));
  }, [channelId]); // eslint-disable-line react-hooks/exhaustive-deps

  useSocketEvent('chat:message', (d) => {
    if (d.channelId !== channelId) return;
    setData((s) => {
      if (!s) return s;
      if (d.deletedId) return { ...s, messages: s.messages.filter((m) => m.id !== d.deletedId) };
      const exists = s.messages.some((m) => m.id === d.message.id);
      return { ...s, messages: exists ? s.messages.map((m) => (m.id === d.message.id ? { ...m, ...d.message } : m)) : [...s.messages, d.message] };
    });
    if (!d.edited && !d.deletedId) {
      const el = scroller.current;
      if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 200) toBottom();
      api.post(`/chat/channels/${channelId}/read`).catch(() => {});
      setTyping((t) => { const n = { ...t }; delete n[d.message?.userId]; return n; });
    }
  }, [channelId]);
  useSocketEvent('chat:typing', (d) => {
    if (d.channelId !== channelId || d.user.id === user.id) return;
    setTyping((t) => ({ ...t, [d.user.id]: { name: d.user.name, at: Date.now() } }));
  }, [channelId]);
  useEffect(() => { const i = setInterval(() => setTyping((t) => Object.fromEntries(Object.entries(t).filter(([, v]) => Date.now() - v.at < 4000))), 1500); return () => clearInterval(i); }, []);

  const older = async () => {
    if (!data?.messages.length) return;
    setLoadingOlder(true);
    const el = scroller.current; const h = el.scrollHeight;
    try {
      const r = await api.get(`/chat/channels/${channelId}/messages?before=${data.messages[0].id}`);
      setData((s) => ({ ...s, hasMore: r.data.hasMore, messages: [...r.data.messages, ...s.messages] }));
      requestAnimationFrame(() => { el.scrollTop = el.scrollHeight - h; });
    } finally { setLoadingOlder(false); }
  };

  const onChange = (e) => {
    const v = e.target.value; setText(v);
    if (Date.now() - lastTyped.current > 2500) { lastTyped.current = Date.now(); socketEmit('chat:typing', { channelId }); }
    const m = v.slice(0, e.target.selectionStart).match(/@([\w ]{0,20})$/);
    setPicker(m ? { q: m[1].toLowerCase(), i: 0 } : null);
  };
  const candidates = picker ? people.filter((p) => !p.isClient && p.id !== user.id && p.name.toLowerCase().startsWith(picker.q)).slice(0, 6) : [];
  const pick = (p) => {
    const el = input.current; const pos = el.selectionStart;
    const before = text.slice(0, pos).replace(/@([\w ]{0,20})$/, `@${p.name} `);
    setText(before + text.slice(pos)); setMentions((m) => [...new Set([...m, p.id])]); setPicker(null);
    requestAnimationFrame(() => { el.focus(); el.selectionStart = el.selectionEnd = before.length; });
  };
  const send = async () => {
    const body = text.trim(); if (!body || sending) return;
    setSending(true);
    try {
      const ms = mentions.filter((id) => body.includes(`@${people.find((p) => p.id === id)?.name}`));
      const r = await api.post(`/chat/channels/${channelId}/messages`, { body, mentions: ms });
      setData((s) => (s.messages.some((m) => m.id === r.data.id) ? s : { ...s, messages: [...s.messages, r.data] }));
      setText(''); setMentions([]); toBottom();
    } catch (err) { toast.error(err.message); } finally { setSending(false); }
  };
  const onKey = (e) => {
    if (picker && candidates.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setPicker((p) => ({ ...p, i: (p.i + 1) % candidates.length })); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setPicker((p) => ({ ...p, i: (p.i - 1 + candidates.length) % candidates.length })); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(candidates[picker.i]); return; }
      if (e.key === 'Escape') { setPicker(null); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  };
  const saveEdit = async () => { try { await api.patch(`/chat/messages/${editing.id}`, { body: editing.body }); setData((s) => ({ ...s, messages: s.messages.map((m) => (m.id === editing.id ? { ...m, body: editing.body, editedAt: new Date() } : m)) })); setEditing(null); } catch (err) { toast.error(err.message); } };
  const remove = async (m) => { if (await confirm({ title: 'Delete this message?', danger: true, confirmLabel: 'Delete' })) { await api.delete(`/chat/messages/${m.id}`); setData((s) => ({ ...s, messages: s.messages.filter((x) => x.id !== m.id) })); } };

  const whoTyping = Object.values(typing).map((t) => t.name.split(' ')[0]);
  const title = ch ? (ch.kind === 'dm' ? ch.name : ch.name) : data?.channel?.name;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-3 border-b border-line px-4 py-3">
        <button type="button" className="rounded-lg p-1 text-muted hover:bg-sunken lg:hidden" onClick={onBack} aria-label="Back to channels"><ArrowLeft size={18} /></button>
        {ch?.kind === 'dm' ? <Avatar user={ch.other} size={32} online={online.includes(ch.other?.id)} /> : <span className="grid h-8 w-8 place-items-center rounded-xl bg-sunken text-muted">{ch?.isPrivate ? <Lock size={15} /> : <Hash size={15} />}</span>}
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-semibold">{title}</h2>
          <p className="truncate text-xs text-muted">{ch?.kind === 'dm' ? (online.includes(ch.other?.id) ? 'Online now' : ch.other?.lastSeenAt ? `Last seen ${ago(ch.other.lastSeenAt)}` : ch.other?.designation) : ch?.description || (ch?.isPrivate ? `${ch.memberCount} members` : 'Everyone on the team')}</p>
        </div>
        {ch?.kind !== 'dm' && ch?.isPrivate && <span className="hidden -space-x-1.5 sm:flex">{ch.members.slice(0, 5).map((m) => <Avatar key={m.id} user={m} size={24} ring />)}</span>}
      </header>
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {!data ? <PageLoader /> : (
          <>
            {data.hasMore && <div className="mb-3 text-center"><button type="button" className="btn-ghost btn-sm" onClick={older} disabled={loadingOlder}>{loadingOlder ? <Spinner size={13} /> : null}Load earlier</button></div>}
            {!data.messages.length && <Empty compact icon={MessageSquare} title="Say hello" body={ch?.kind === 'dm' ? `This is the start of your conversation with ${title}.` : `This is the very beginning of #${title}.`} />}
            {data.messages.map((m, i) => {
              const prev = data.messages[i - 1];
              const d = new Date(m.createdAt);
              const newDay = !prev || !isSameDay(new Date(prev.createdAt), d);
              const grouped = !newDay && prev.userId === m.userId && d - new Date(prev.createdAt) < 5 * 60e3;
              const mine = m.userId === user.id;
              return (
                <Fragment key={m.id}>
                  {newDay && <div className="my-4 flex items-center gap-3 text-xs font-semibold text-muted"><span className="h-px flex-1 bg-line" />{dayLabel(d)}<span className="h-px flex-1 bg-line" /></div>}
                  <div className={clsx('group relative flex gap-3 rounded-xl px-2 py-0.5 hover:bg-sunken/50', !grouped && 'mt-3')}>
                    <div className="w-9 shrink-0">{!grouped ? <Avatar user={m.author} size={36} /> : <span className="hidden pt-1 text-[10px] text-faint group-hover:block">{format(d, 'h:mm')}</span>}</div>
                    <div className="min-w-0 flex-1">
                      {!grouped && <div className="flex items-baseline gap-2"><span className="text-sm font-semibold">{m.author?.name}</span><span className="text-[11px] text-faint">{format(d, 'h:mm a')}</span></div>}
                      {editing?.id === m.id ? (
                        <div className="mt-1 flex gap-2"><input className="input" value={editing.body} onChange={(e) => setEditing({ ...editing, body: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditing(null); }} autoFocus /><button type="button" className="btn-ink btn-sm" onClick={saveEdit}>Save</button></div>
                      ) : (
                        <p className="whitespace-pre-wrap break-words text-[14.5px] leading-relaxed"><Body text={m.body} people={people} meId={user.id} />{m.editedAt && <span className="ml-1 text-[11px] text-faint">(edited)</span>}</p>
                      )}
                      {m.Task && <button type="button" onClick={() => openTask(m.Task.id)} className="mt-1.5 inline-flex items-center gap-2 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs hover:border-muted"><span className="h-2 w-2 rounded-full" style={{ background: STATUS[m.Task.status]?.color }} /><span className="font-semibold text-muted">{m.Task.key}</span>{m.Task.title}</button>}
                    </div>
                    {mine && editing?.id !== m.id && (
                      <div className="absolute -top-3 right-2 hidden gap-0.5 rounded-lg border border-line bg-surface p-0.5 shadow-sm group-hover:flex">
                        <button type="button" className="rounded p-1 text-muted hover:bg-sunken" onClick={() => setEditing({ id: m.id, body: m.body })} aria-label="Edit"><Pencil size={13} /></button>
                        <button type="button" className="rounded p-1 text-muted hover:bg-sunken hover:text-ember" onClick={() => remove(m)} aria-label="Delete"><Trash2 size={13} /></button>
                      </div>
                    )}
                  </div>
                </Fragment>
              );
            })}
          </>
        )}
      </div>
      <div className="relative border-t border-line px-4 pb-4 pt-2">
        <div className="h-5 text-xs text-muted">{whoTyping.length > 0 && <span className="inline-flex items-center gap-1.5"><span className="flex gap-0.5">{[0, 1, 2].map((i) => <span key={i} className="h-1 w-1 animate-bounce rounded-full bg-muted" style={{ animationDelay: `${i * 120}ms` }} />)}</span>{whoTyping.join(', ')} {whoTyping.length > 1 ? 'are' : 'is'} typing</span>}</div>
        {picker && candidates.length > 0 && (
          <div className="absolute bottom-full left-4 z-10 mb-1 w-64 rounded-xl border border-line bg-surface p-1 shadow-lift">
            {candidates.map((p, i) => <button key={p.id} type="button" onMouseDown={(e) => { e.preventDefault(); pick(p); }} className={clsx('flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm', i === picker.i ? 'bg-sunken' : 'hover:bg-sunken')}><Avatar user={p} size={22} />{p.name}</button>)}
          </div>
        )}
        <div className="flex items-end gap-2 rounded-2xl border border-line bg-surface p-2 focus-within:border-muted">
          <button type="button" className="rounded-lg p-1.5 text-muted hover:bg-sunken" onClick={() => { setText((t) => `${t}@`); setPicker({ q: '', i: 0 }); input.current?.focus(); }} aria-label="Mention someone"><AtSign size={17} /></button>
          <textarea ref={input} rows={1} value={text} onChange={onChange} onKeyDown={onKey} placeholder={`Message ${ch?.kind === 'dm' ? title : `#${title || ''}`}`}
            className="max-h-40 min-h-[36px] flex-1 resize-none bg-transparent py-1.5 text-[14.5px] outline-none placeholder:text-faint" style={{ height: Math.min(160, 36 + (text.split('\n').length - 1) * 22) }} />
          <button type="button" className="btn-primary btn-sm h-9 w-9 !p-0" onClick={send} disabled={!text.trim() || sending} aria-label="Send"><Send size={15} /></button>
        </div>
      </div>
    </div>
  );
}

export default function Chat() {
  const { id } = useParams();
  const nav = useNavigate();
  const { online, loadChatUnread } = useAuth();
  const people = useDirectory();
  const [channels, setChannels] = useState(null);
  const [q, setQ] = useState('');
  const [newCh, setNewCh] = useState(false);
  const [newDm, setNewDm] = useState(false);
  const load = () => api.get('/chat/channels').then((r) => { setChannels(r.data); loadChatUnread(); });
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useSocketEvent('chat:channel', load, []);
  useSocketEvent('chat:message', (d) => {
    setChannels((cs) => cs && cs.map((c) => (c.id === d.channelId && d.message ? { ...c, lastMessage: { body: d.message.body, author: d.message.author?.name, createdAt: d.message.createdAt }, lastMessageAt: d.message.createdAt, unread: c.id === Number(id) ? 0 : c.unread + 1 } : c)).sort((a, b) => new Date(b.lastMessageAt || 0) - new Date(a.lastMessageAt || 0)));
  }, [id]);
  const current = Number(id) || null;
  useEffect(() => {
    if (!current && channels?.length && window.innerWidth >= 1024) nav(`/chat/${(channels.find((c) => c.name === 'general') || channels[0]).id}`, { replace: true });
  }, [channels, current]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (current) setChannels((cs) => cs && cs.map((c) => (c.id === current ? { ...c, unread: 0 } : c))); }, [current]);

  const filtered = useMemo(() => (channels || []).filter((c) => c.name.toLowerCase().includes(q.toLowerCase())), [channels, q]);
  const rooms = filtered.filter((c) => c.kind === 'channel');
  const dms = filtered.filter((c) => c.kind === 'dm');

  const Row = ({ c }) => (
    <Link to={`/chat/${c.id}`} className={clsx('flex items-center gap-2.5 rounded-xl px-2.5 py-2 transition', c.id === current ? 'bg-ink text-surface' : 'hover:bg-sunken')}>
      {c.kind === 'dm' ? <Avatar user={c.other} size={26} online={online.includes(c.other?.id)} /> : <span className={clsx('grid h-[26px] w-[26px] place-items-center rounded-lg', c.id === current ? 'bg-surface/15' : 'bg-sunken text-muted')}>{c.isPrivate ? <Lock size={13} /> : <Hash size={13} />}</span>}
      <span className="min-w-0 flex-1">
        <span className={clsx('block truncate text-sm', c.unread ? 'font-bold' : 'font-medium')}>{c.name}</span>
        {c.lastMessage && <span className={clsx('block truncate text-xs', c.id === current ? 'text-surface/70' : 'text-muted')}>{c.kind === 'channel' && c.lastMessage.author ? `${c.lastMessage.author.split(' ')[0]}: ` : ''}{c.lastMessage.body}</span>}
      </span>
      {c.unread > 0 && c.id !== current && <span className="grid h-5 min-w-[20px] place-items-center rounded-full bg-brand px-1.5 text-[11px] font-bold text-brand-ink">{c.unread}</span>}
    </Link>
  );

  return (
    <div className="-mx-4 -my-6 flex h-[calc(100dvh-57px)] overflow-hidden border-line bg-surface sm:-mx-6 lg:mx-0 lg:my-0 lg:h-[calc(100dvh-106px)] lg:rounded-3xl lg:border">
      <aside className={clsx('w-full shrink-0 flex-col border-r border-line bg-canvas/60 lg:flex lg:w-72', current ? 'hidden' : 'flex')}>
        <div className="flex items-center gap-2 px-4 pb-2 pt-4"><h1 className="font-display text-xl font-semibold">Chat</h1>
          <div className="ml-auto flex gap-1"><button type="button" className="btn-ghost btn-sm" onClick={() => setNewDm(true)} title="New message"><Users size={14} /></button><button type="button" className="btn-ink btn-sm" onClick={() => setNewCh(true)} title="New channel"><Plus size={14} /></button></div>
        </div>
        <div className="relative px-3 pb-2"><Search size={14} className="absolute left-6 top-1/2 -translate-y-[60%] text-faint" /><input className="input !py-1.5 pl-8 text-sm" placeholder="Find a conversation" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-2 pb-4">
          {!channels ? <PageLoader /> : (
            <>
              <div><div className="px-2.5 pb-1 text-xs font-semibold text-muted">Channels</div>{rooms.map((c) => <Row key={c.id} c={c} />)}</div>
              <div><div className="flex items-center px-2.5 pb-1 text-xs font-semibold text-muted">Direct messages<button type="button" className="ml-auto rounded p-0.5 hover:bg-sunken" onClick={() => setNewDm(true)} aria-label="New direct message"><Plus size={13} /></button></div>
                {dms.map((c) => <Row key={c.id} c={c} />)}
                {!dms.length && <p className="px-2.5 text-xs text-faint">No direct messages yet.</p>}
              </div>
            </>
          )}
        </div>
      </aside>
      <main className={clsx('min-w-0 flex-1 flex-col', current ? 'flex' : 'hidden lg:flex')}>
        {current && channels ? <Thread channelId={current} channels={channels} people={people} onBack={() => nav('/chat')} reloadChannels={loadChatUnread} /> : <div className="grid flex-1 place-items-center"><Empty icon={MessageSquare} title="Pick a conversation" /></div>}
      </main>
      <NewChannel open={newCh} onClose={() => setNewCh(false)} onCreated={(cid) => { setNewCh(false); load(); nav(`/chat/${cid}`); }} />
      <NewDm open={newDm} onClose={() => setNewDm(false)} onOpen={(cid) => { setNewDm(false); load(); nav(`/chat/${cid}`); }} />
    </div>
  );
}
