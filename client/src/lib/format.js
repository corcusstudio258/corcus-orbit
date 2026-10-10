import { format, formatDistanceToNowStrict, isToday, isTomorrow, isYesterday, isPast, differenceInCalendarDays } from 'date-fns';

export const STATUS = {
  todo: { label: 'To do', color: '#8D96C4' },
  in_progress: { label: 'In progress', color: '#3DE0F2' },
  review: { label: 'In review', color: '#8F7BFF' },
  blocked: { label: 'Blocked', color: '#FF7A90' },
  done: { label: 'Done', color: '#5BE3A6' },
};
export const STATUS_ORDER = ['todo', 'in_progress', 'review', 'blocked', 'done'];

export const PRIORITY = {
  low: { label: 'Low', color: '#8D96C4' },
  medium: { label: 'Medium', color: '#3DE0F2' },
  high: { label: 'High', color: '#FFB648' },
  urgent: { label: 'Urgent', color: '#FF7A90' },
};

export const PROJECT_STATUS = {
  planning: 'Planning', active: 'Active', on_hold: 'On hold', completed: 'Completed', archived: 'Archived',
};

export function dueLabel(date, done) {
  if (!date) return null;
  const d = new Date(date);
  const hasTime = d.getHours() !== 0 || d.getMinutes() !== 0;
  const time = hasTime ? `, ${format(d, 'h:mm a')}` : '';
  let text;
  if (isToday(d)) text = `Today${time}`;
  else if (isTomorrow(d)) text = `Tomorrow${time}`;
  else if (isYesterday(d)) text = 'Yesterday';
  else text = format(d, Math.abs(differenceInCalendarDays(d, new Date())) > 180 ? 'd MMM yyyy' : 'd MMM');
  const overdue = !done && isPast(d);
  const soon = !done && !overdue && differenceInCalendarDays(d, new Date()) <= 1;
  return { text, overdue, soon };
}

export const ago = (d) => (d ? `${formatDistanceToNowStrict(new Date(d))} ago` : '');
export const fmtDate = (d, f = 'd MMM yyyy') => (d ? format(new Date(d), f) : '—');
export const minutes = (m) => {
  if (!m) return '0m';
  const h = Math.floor(m / 60); const r = m % 60;
  return h ? `${h}h${r ? ` ${r}m` : ''}` : `${r}m`;
};
export const initials = (name = '') => name.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
export const bytes = (b) => (b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`);

/** yyyy-MM-ddTHH:mm for <input type="datetime-local"> */
export const toLocalInput = (d) => (d ? format(new Date(d), "yyyy-MM-dd'T'HH:mm") : '');
