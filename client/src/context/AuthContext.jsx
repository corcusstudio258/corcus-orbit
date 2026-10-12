import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import toast from 'react-hot-toast';
import api, { getToken, setToken } from '../lib/api';

const AuthCtx = createContext(null);
const EVENTS = ['task:changed', 'project:changed', 'activity', 'request:changed', 'chat:message', 'chat:channel', 'chat:typing', 'meeting:changed', 'attendance:changed', 'doc:changed'];

export function AuthProvider({ children }) {
  const [state, setState] = useState({ loading: true, user: null, permissions: [], isClient: false, company: null });
  const [unread, setUnread] = useState(0);
  const [chatUnread, setChatUnread] = useState(0);
  const [online, setOnline] = useState([]);
  const socketRef = useRef(null);
  const listeners = useRef(new Map());

  const apply = (data) => setState({ loading: false, user: data.user, permissions: data.permissions, isClient: data.isClient, company: data.company });

  const refresh = useCallback(async () => {
    if (!getToken()) return setState((s) => ({ ...s, loading: false, user: null }));
    try { apply((await api.get('/auth/me')).data); } catch { setToken(null); setState((s) => ({ ...s, loading: false, user: null })); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const loadChatUnread = useCallback(() => api.get('/chat/unread').then((r) => setChatUnread(r.data.unread)).catch(() => {}), []);

  useEffect(() => {
    if (!state.user) return undefined;
    const s = io(import.meta.env.VITE_SOCKET_URL || '/', { auth: { token: getToken() }, transports: ['websocket', 'polling'] });
    socketRef.current = s;
    const emit = (event, data) => (listeners.current.get(event) || new Set()).forEach((fn) => fn(data));
    s.on('notification', (n) => {
      setUnread((u) => u + 1);
      const onChat = location.pathname.startsWith('/chat');
      if (!(onChat && ['chat_dm', 'chat_mention'].includes(n.type))) toast(n.title, { icon: n.type?.startsWith('chat') ? '💬' : n.type === 'kudos' ? '🎉' : '🔔' });
      emit('notification', n);
    });
    s.on('presence', setOnline);
    EVENTS.forEach((ev) => s.on(ev, (d) => emit(ev, d)));
    s.on('chat:message', (d) => { if (d?.message && d.message.userId !== state.user.id && !location.pathname.startsWith(`/chat/${d.channelId}`)) setChatUnread((n) => n + 1); });
    api.get('/notifications?limit=1').then((r) => setUnread(r.data.unread)).catch(() => {});
    if (!state.isClient) loadChatUnread();
    return () => { s.disconnect(); socketRef.current = null; };
  }, [state.user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const subscribe = useCallback((event, fn) => {
    if (!listeners.current.has(event)) listeners.current.set(event, new Set());
    listeners.current.get(event).add(fn);
    return () => listeners.current.get(event)?.delete(fn);
  }, []);

  const socketEmit = useCallback((event, data) => socketRef.current?.emit(event, data), []);

  const login = async (email, password) => {
    const { data } = await api.post('/auth/login', { email, password });
    setToken(data.token); apply(data);
    return data;
  };
  const setup = async (payload) => {
    const { data } = await api.post('/auth/setup', payload);
    setToken(data.token); apply(data);
    return data;
  };
  const logout = () => { setToken(null); setState({ loading: false, user: null, permissions: [], isClient: false, company: null }); };

  const value = useMemo(() => ({
    ...state, unread, setUnread, chatUnread, setChatUnread, loadChatUnread, online, login, logout, setup, refresh, subscribe, socketEmit,
    can: (...perms) => perms.some((p) => state.permissions.includes(p)),
  }), [state, unread, chatUnread, online, refresh, subscribe, socketEmit, loadChatUnread]); // eslint-disable-line react-hooks/exhaustive-deps

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);

/** Re-run `fn` whenever one of the realtime events fires (debounced). */
export function useLive(events, fn, deps = []) {
  const { subscribe } = useAuth();
  useEffect(() => {
    let t;
    const run = (d) => { clearTimeout(t); t = setTimeout(() => fn(d), 250); };
    const offs = [].concat(events).map((e) => subscribe(e, run));
    return () => { clearTimeout(t); offs.forEach((off) => off()); };
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
}

/** Like useLive but not debounced (for chat). */
export function useSocketEvent(event, fn, deps = []) {
  const { subscribe } = useAuth();
  useEffect(() => subscribe(event, fn), deps); // eslint-disable-line react-hooks/exhaustive-deps
}
