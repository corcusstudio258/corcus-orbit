import { useCallback, useEffect, useState } from 'react';
import api from './api';

/** Small data hook: const { data, loading, error, reload, setData } = useFetch('/projects') */
export default function useFetch(url, deps = []) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(!!url);
  const [error, setError] = useState(null);

  const reload = useCallback(async (silent = true) => {
    if (!url) return;
    if (!silent) setLoading(true);
    try {
      const r = await api.get(url);
      setData(r.data); setError(null);
    } catch (e) { setError(e.message); setData((prev) => prev ?? { error: e.message }); } finally { setLoading(false); }
  }, [url]);

  useEffect(() => { setLoading(true); reload(false); }, [url, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps
  return { data, loading, error, reload, setData };
}
