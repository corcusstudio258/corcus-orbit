import { useEffect, useState } from 'react';
import api from './api';

// Module-level caches for lists that many screens need (people, projects, AI status).
const cache = {};
const inflight = {};
const subs = {};

async function load(key, url, force) {
  if (cache[key] && !force) return cache[key];
  if (!inflight[key]) {
    inflight[key] = api.get(url).then((r) => { cache[key] = r.data; (subs[key] || []).forEach((fn) => fn(r.data)); return r.data; })
      .finally(() => { delete inflight[key]; });
  }
  return inflight[key];
}

export const invalidate = (key) => { delete cache[key]; };
export const refresh = (key, url) => load(key, url, true);

function useCached(key, url, fallback = []) {
  const [data, setData] = useState(cache[key] ?? fallback);
  useEffect(() => {
    subs[key] = [...(subs[key] || []), setData];
    load(key, url).then(setData).catch(() => {});
    return () => { subs[key] = (subs[key] || []).filter((f) => f !== setData); };
  }, [key, url]);
  return data;
}

export const useDirectory = () => useCached('people', '/users/directory');
export const useProjects = () => useCached('projects', '/projects');
export const refreshProjects = () => refresh('projects', '/projects');
export const useAiStatus = () => useCached('ai', '/ai/status', { ready: false, enabled: false });
export const refreshAi = () => refresh('ai', '/ai/status');
