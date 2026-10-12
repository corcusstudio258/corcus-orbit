import { format, formatDistanceToNowStrict, isToday, isTomorrow, isYesterday, isPast, differenceInCalendarDays } from 'date-fns';

export const STATUS = {
  backlog: { label: 'Backlog', color: '#8D94B3' },
  todo: { label: 'To do', color: '#5B6386' },
  in_progress: { label: 'In progress', color: '#3D5AFE' },
  review: { label: 'In review', color: '#8B5CF6' },
  blocked: { label: 'Blocked', color: '#E5484D' },
  done: { label: 'Done', color: '#1FA971' },
};
export const STATUS_ORDER = ['backlog', 'todo', 'in_progress', 'review', 'blocked', 'done'];
export const BOARD_STATUSES = ['backlog', 'todo', 'in_progress', 'review', 'blocked', 'done'];

export const PRIORITY = {
  low: { label: 'Low', color: '#8D94B3' },
  medium: { label: 'Medium', color: '#3D5AFE' },
  high: { label: 'High', color: '#F08C00' },
  urgent: { label: 'Urgent', color: '#E5484D' },
};
export const PRIORITY_ORDER = ['urgent', 'high', 'medium', 'low'];

export const PROJECT_STATUS = {
  planning: 'Planning', active: 'Active', on_hold: 'On hold', completed: 'Completed', archived: 'Archived',
};

export const HEALTH = {
  on_track: { label: 'On track', color: '#1FA971' },
  at_risk: { label: 'At risk', color: '#F08C00' },
  off_track: { label: 'Off track', color: '#E5484D' },
  done: { label: 'Complete', color: '#5B6386' },
};

export const PALETTE = ['#3D5AFE', '#8B5CF6', '#1FA971', '#F08C00', '#E5484D', '#0EA5B7', '#D946EF', '#64748B', '#0F1535'];

export function dueLabel(date, done) {
  if (!date) return null;
  const d = new Date(date);
  const time = `, ${format(d, d.getMinutes() ? 'h:mm a' : 'h a')}`;
  let text;
  if (isToday(d)) text = `Today${time}`;
  else if (isTomorrow(d)) text = `Tomorrow${time}`;
  else if (isYesterday(d)) text = `Yesterday${time}`;
  else text = format(d, Math.abs(differenceInCalendarDays(d, new Date())) > 180 ? 'd MMM yyyy' : 'd MMM') + time;
  const overdue = !done && isPast(d);
  const soon = !done && !overdue && differenceInCalendarDays(d, new Date()) <= 1;
  return { text, overdue, soon };
}

export const ago = (d) => {
  if (!d) return '';
  const s = (Date.now() - new Date(d).getTime()) / 1000;
  if (s < 45) return 'just now';
  return `${formatDistanceToNowStrict(new Date(d))} ago`;
};
export const fmtDate = (d, f = 'd MMM yyyy') => (d ? format(new Date(d), f) : '—');
export const fmtTime = (d) => (d ? format(new Date(d), 'h:mm a') : '');
export const minutes = (m) => {
  if (!m) return '0m';
  const h = Math.floor(m / 60); const r = Math.round(m % 60);
  return h ? `${h}h${r ? ` ${r}m` : ''}` : `${r}m`;
};
export const initials = (name = '') => name.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
export const bytes = (b) => (b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`);
export const money = (n, cur = 'INR') => new Intl.NumberFormat('en-IN', { style: 'currency', currency: cur || 'INR', maximumFractionDigits: 0 }).format(n || 0);
export const compact = (n) => new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 }).format(n || 0);

/** yyyy-MM-ddTHH:mm for <input type="datetime-local"> */
export const toLocalInput = (d) => (d ? format(new Date(d), "yyyy-MM-dd'T'HH:mm") : '');
export const toDateInput = (d) => (d ? format(new Date(d), 'yyyy-MM-dd') : '');

export function greeting(d = new Date()) {
  const h = d.getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}
