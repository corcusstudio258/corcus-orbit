import axios from 'axios';

export const TOKEN_KEY = 'orbit_token';
export const getToken = () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } };
export const setToken = (t) => { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ } };

const api = axios.create({ baseURL: import.meta.env.VITE_API_URL || '/api' });

api.interceptors.request.use((cfg) => {
  const t = getToken();
  if (t) cfg.headers.Authorization = `Bearer ${t}`;
  return cfg;
});

api.interceptors.response.use((r) => r, (err) => {
  if (err.response?.status === 401 && !String(err.config?.url).includes('/auth/')) {
    setToken(null);
    if (!location.pathname.startsWith('/login')) location.href = '/login';
  }
  err.message = err.response?.data?.error || err.message || 'Something went wrong.';
  return Promise.reject(err);
});

export const fileUrl = (id) => `${import.meta.env.VITE_API_URL || '/api'}/files/${id}?t=${encodeURIComponent(getToken() || '')}`;

export default api;
