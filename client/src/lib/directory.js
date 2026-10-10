import { useEffect, useState } from 'react';
import api from './api';

// Module-level caches for lists that many screens need (people, projects).
const cache = {};
const inflight = {};

async function load(key, url) {
  if (cache[key]) return cache[key];
  if (!inflight[key]) inflight[key] = api.get(url).then((r) => { cache[key] = r.data; return r.data; }).finally(() => { delete inflight[key]; });
  return inflight[key];
}

export const invalidate = (key) => { delete cache[key]; };

function useCached(key, url, enabled = true) {
  const [data, setData] = useState(cache[key] || []);
  useEffect(() => { if (enabled) load(key, url).then(setData).catch(() => {}); }, [key, url, enabled]);
  return data;
}

export const useDirectory = () => useCached('people', '/users/directory');
export const useProjects = () => useCached('projects', '/projects');
