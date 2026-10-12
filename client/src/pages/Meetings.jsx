import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import { addMinutes, format, isSameDay, isToday, isTomorrow, startOfMonth } from 'date-fns';
import { Plus, Video, MapPin, CalendarDays, List, Clock, Sparkles, Check, Trash2, Pencil, ExternalLink, X, Users, Mail } from 'lucide-react';
import api from '../lib/api';
import useFetch from '../lib/useFetch';
import { useAuth, useLive } from '../context/AuthContext';
import { useDirectory, useProjects, useAiStatus } from '../lib/directory';
import { PageHeader, Segmented, Modal, Field, UserPicker, Toggle, Avatar, AvatarStack, Empty, PageLoader, Drawer, Spinner, confirm, Markdown } from '../components/ui';
import MonthCalendar from '../components/MonthCalendar';
import { toLocalInput, PRIORITY } from '../lib/format';

const dayName = (d) => (isToday(d) ? 'Today' : isTomorrow(d) ? 'Tomorrow' : format(d, 'EEEE, d MMM'));
const RSVP = { yes: { label: 'Going', cls: 'bg-leaf/10 text-leaf' }, maybe: { label: 'Maybe', cls: 'bg-amber/10 text-amber' }, no: { label: 'Not going', cls: 'bg-ember/10 text-ember' }, pending: { label: 'No reply', cls: 'bg-sunken text-muted' } };

export function MeetingForm({ open, onClose, meeting, defaults = {}, onSaved }) {
  const people = useDirectory();
  const projects = useProjects();
  const { data: clients } = useFetch(open ? '/clients' : null);
  const blank = () => {
    const s = new Date(); s.setMinutes(s.getMinutes() < 30 ? 30 : 60, 0, 0);
    return { title: '', agenda: '', startAt: toLocalInput(s), duration: 30, link: '', location: '', projectId: '', clientId: '', inviteClient: false, attendeeIds: [], guestEmails: '', provider: 'link', sendEmail: true, ...defaults };
  };
  const [f, setF] = useState(blank);
  const [busy, setBusy] = useState(false);
  const { data: integ } = useFetch(open ? '/meetings/integrations/status' : null);
  useEffect(() => { if (open && !meeting && integ?.zoom) setF((s) => ({ ...s, provider: s.link ? s.provider : 'zoom' })); }, [integ?.zoom, open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return;
    if (meeting) setF({ ...meeting, guestEmails: (meeting.guestEmails || []).join(', '), provider: meeting.provider || 'link', startAt: toLocalInput(meeting.startAt), duration: Math.round((new Date(meeting.endAt) - new Date(meeting.startAt)) / 60000), projectId: meeting.projectId || '', clientId: meeting.clientId || '', attendeeIds: meeting.attendees.map((a) => a.id) });
    else setF(blank());
  }, [open, meeting]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e?.target ? (e.target.type === 'checkbox' ? e.target.checked : e.target.value) : e }));
  const save = async () => {
    setBusy(true);
    const start = new Date(f.startAt);
    const body = { ...f, startAt: start.toISOString(), endAt: addMinutes(start, Number(f.duration) || 30).toISOString(), projectId: f.projectId || null, clientId: f.clientId || null,
      guestEmails: String(f.guestEmails || '').split(/[,;\s]+/).filter(Boolean), link: f.provider === 'zoom' ? undefined : f.link };
    try {
      const r = meeting ? await api.patch(`/meetings/${meeting.id}`, body) : await api.post('/meetings', body);
      toast.success(meeting ? 'Meeting updated' : r.data.emailed?.sent ? `Invites sent, ${r.data.emailed.sent} emailed` : 'Meeting scheduled'); onSaved?.(r.data); onClose();
    } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title={meeting ? 'Edit meeting' : 'Schedule a meeting'} width="max-w-2xl"
      footer={<><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button type="button" className="btn-primary" disabled={busy || (f.provider === 'zoom' && !integ?.zoom)} onClick={save}>{busy && <Spinner size={14} className="text-ink" />}{meeting ? 'Save' : 'Schedule and invite'}</button></>}>
      <div className="space-y-4">
        <Field label="Title"><input className="input" value={f.title} onChange={set('title')} placeholder="Kasaar monthly review" autoFocus /></Field>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_160px]">
          <Field label="Starts"><input type="datetime-local" className="input" value={f.startAt} onChange={set('startAt')} /></Field>
          <Field label="Length"><select className="input" value={f.duration} onChange={set('duration')}>{[15, 30, 45, 60, 90, 120].map((m) => <option key={m} value={m}>{m < 60 ? `${m} min` : `${m / 60} hr${m > 60 ? 's' : ''}`}</option>)}</select></Field>
        </div>
        <Field label="People"><UserPicker users={people} value={f.attendeeIds} onChange={set('attendeeIds')} /></Field>
        <Field label="Guests by email" hint="Clients or anyone outside the team. They get an email invite with a calendar file."><input className="input" value={f.guestEmails} onChange={set('guestEmails')} placeholder="rohit@kasaar.in, priya@agency.com" /></Field>
        <Field label="Where">
          <Segmented value={f.provider === 'zoom' ? 'zoom' : f.location && !f.link ? 'place' : 'link'} onChange={(v) => setF((s) => ({ ...s, provider: v === 'zoom' ? 'zoom' : 'link', ...(v === 'place' ? { link: '' } : {}) }))}
            options={[{ value: 'zoom', label: integ?.zoom ? 'Zoom (auto)' : 'Zoom (set up first)' }, { value: 'link', label: 'Meet or other link' }, { value: 'place', label: 'In person' }]} />
        </Field>
        {f.provider === 'zoom' ? (
          integ?.zoom ? <p className="flex items-center gap-2 rounded-xl bg-cobalt/5 px-3 py-2 text-sm text-cobalt"><Video size={15} />{meeting?.zoomId ? 'Zoom meeting linked. Time changes sync to Zoom.' : 'A Zoom meeting is created when you save, and the join link goes into every invite.'}</p>
            : <p className="rounded-xl bg-amber/10 px-3 py-2 text-sm text-amber">Zoom isn't connected yet. An admin can add it in Settings, Integrations.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Video link" hint="Google Meet, Teams or any link"><input className="input" value={f.link || ''} onChange={set('link')} placeholder="https://meet.google.com/..." /></Field>
            <Field label="Place"><input className="input" value={f.location || ''} onChange={set('location')} placeholder="Studio, client office" /></Field>
          </div>
        )}
        {integ?.email ? <Toggle checked={f.sendEmail !== false} onChange={set('sendEmail')} label="Email invites with a calendar file" hint="Team members and guests get it in their inbox. WhatsApp and in-app alerts go out either way." />
          : <p className="text-xs text-muted">Email isn't set up, so guests won't get an email. Team members still get WhatsApp and in-app invites.</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Project"><select className="input" value={f.projectId} onChange={set('projectId')}><option value="">None</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.code} {p.name}</option>)}</select></Field>
          <Field label="Client"><select className="input" value={f.clientId} onChange={set('clientId')}><option value="">None</option>{(clients || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
        </div>
        {f.clientId && <Toggle checked={f.inviteClient} onChange={set('inviteClient')} label="Invite the client" hint="Their portal users get the invite and see it on their portal." />}
        <Field label="Agenda"><textarea className="input" rows={4} value={f.agenda || ''} onChange={set('agenda')} placeholder={'1. Last month\'s numbers\n2. Next month\'s calendar\n3. Budget'} /></Field>
      </div>
    </Modal>
  );
}

function MeetingDrawer({ id, onClose, onEdit }) {
  const { user, can } = useAuth();
  const ai = useAiStatus();
  const people = useDirectory();
  const projects = useProjects();
  const { data: m, reload, setData } = useFetch(id ? `/meetings/${id}` : null);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [items, setItems] = useState([]);
  useEffect(() => { if (m?.id) { setNotes(m.notes || ''); setItems((m.aiSummary?.actionItems || []).map((a) => ({ ...a, pick: true }))); } }, [m?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [taskProject, setTaskProject] = useState('');
  if (!id) return null;
  const mine = m?.attendees?.find((a) => a.id === user.id);
  const rsvp = async (response) => { await api.post(`/meetings/${id}/rsvp`, { response }); reload(); };
  const saveNotes = async () => { try { await api.patch(`/meetings/${id}`, { notes }); toast.success('Notes saved'); } catch (err) { toast.error(err.message); } };
  const summarise = async () => {
    setBusy(true);
    try { const r = await api.post('/ai/meeting-notes', { meetingId: id, notes }); setData((s) => ({ ...s, notes, aiSummary: r.data })); setItems(r.data.actionItems.map((a) => ({ ...a, pick: true }))); } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };
  const makeTasks = async () => {
    const chosen = items.filter((i) => i.pick && i.title);
    if (!chosen.length) return;
    if (!m.projectId && !taskProject) { toast.error('Pick the project these tasks go into.'); return; }
    try { const r = await api.post(`/meetings/${id}/action-items`, { items: chosen, projectId: m.projectId || Number(taskProject) }); toast.success(`Created ${r.data.created.length} tasks`); setItems((xs) => xs.map((x) => ({ ...x, pick: false, created: x.pick || x.created }))); } catch (err) { toast.error(err.message); }
  };
  const cancel = async () => { if (await confirm({ title: `Cancel "${m.title}"?`, body: 'Everyone invited gets told.', danger: true, confirmLabel: 'Cancel meeting' })) { await api.delete(`/meetings/${id}`); onClose(); } };

  return (
    <Drawer open onClose={onClose} width="max-w-[640px]">
      {!m?.id ? <PageLoader /> : (
        <div>
          <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-line bg-canvas/90 px-5 py-3 backdrop-blur">
            <span className="text-sm text-muted">{m.Project ? <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: m.Project.color }} />{m.Project.name}</span> : 'Meeting'}</span>
            <div className="ml-auto flex gap-1">
              {m.canEdit && <button type="button" className="btn-ghost btn-sm" onClick={() => onEdit(m)}><Pencil size={14} />Edit</button>}
              {m.canEdit && <button type="button" className="btn-ghost btn-sm text-ember" onClick={cancel} aria-label="Cancel meeting"><Trash2 size={14} /></button>}
              <button type="button" className="rounded-lg p-1.5 text-muted hover:bg-sunken" onClick={onClose} aria-label="Close"><X size={18} /></button>
            </div>
          </div>
          <div className="space-y-6 p-5">
            <div>
              <h2 className="text-2xl font-semibold">{m.title}</h2>
              <p className="mt-1 flex items-center gap-2 text-sm text-muted"><Clock size={14} />{format(new Date(m.startAt), 'EEEE d MMMM, h:mm a')} to {format(new Date(m.endAt), 'h:mm a')}</p>
              {m.location && <p className="mt-1 flex items-center gap-2 text-sm text-muted"><MapPin size={14} />{m.location}</p>}
              {m.zoomPassword && <p className="mt-1 text-sm text-muted">Zoom passcode <b className="font-mono text-ink">{m.zoomPassword}</b></p>}
              {m.guestEmails?.length > 0 && <p className="mt-1 text-sm text-muted">Guests: {m.guestEmails.join(', ')}</p>}
              <div className="mt-4 flex flex-wrap gap-2">
                {m.link && <a href={m.link} target="_blank" rel="noreferrer" className="btn-primary"><Video size={15} />{m.provider === 'zoom' ? 'Join Zoom' : 'Join call'}</a>}
                {m.canEdit && <button type="button" className="btn-ghost" onClick={async () => { try { const r = await api.post(`/meetings/${id}/email`); toast.success(`Emailed ${r.data.sent} people`); } catch (err) { toast.error(err.message); } }}><Mail size={15} />Email invite</button>}
                {mine && ['yes', 'maybe', 'no'].map((r) => <button key={r} type="button" onClick={() => rsvp(r)} className={clsx('btn btn-sm', mine.MeetingAttendee?.response === r ? 'bg-ink text-surface' : 'btn-ghost')}>{RSVP[r].label}</button>)}
              </div>
            </div>
            <section>
              <h3 className="mb-2 text-sm font-semibold">People</h3>
              <ul className="grid gap-2 sm:grid-cols-2">
                {m.attendees.map((a) => { const r = RSVP[a.MeetingAttendee?.response || 'pending'] || RSVP.pending; return (
                  <li key={a.id} className="flex items-center gap-2 rounded-xl border border-line px-3 py-2"><Avatar user={a} size={26} /><span className="min-w-0 flex-1 truncate text-sm">{a.name}{a.id === m.organizerId && <span className="ml-1 text-xs text-faint">organiser</span>}</span><span className={clsx('chip text-[10px]', r.cls)}>{r.label}</span></li>
                ); })}
              </ul>
              {m.inviteClient && m.Client && <p className="mt-2 text-xs text-muted">{m.Client.name} is invited through their portal.</p>}
            </section>
            {m.agenda && <section><h3 className="mb-2 text-sm font-semibold">Agenda</h3><Markdown className="rounded-xl bg-surface p-4 text-sm">{m.agenda}</Markdown></section>}
            <section>
              <div className="mb-2 flex items-center gap-2"><h3 className="text-sm font-semibold">Notes</h3>
                <div className="ml-auto flex gap-2"><button type="button" className="btn-ghost btn-sm" onClick={saveNotes}>Save</button>
                  <button type="button" className="btn-ai btn-sm" onClick={summarise} disabled={busy || !notes.trim() || !ai.ready} title={ai.ready ? '' : 'Add a Gemini key in Settings'}>{busy ? <Spinner size={13} className="text-violet" /> : <Sparkles size={13} />}Summarise</button></div>
              </div>
              <textarea className="input font-mono text-[13px]" rows={7} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Type or paste notes. Hinglish is fine. Orbit pulls out decisions and action items." />
            </section>
            {m.aiSummary && (
              <section className="rounded-2xl border border-violet/25 bg-violet/[0.04] p-4">
                <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-violet"><Sparkles size={14} />Summary</h3>
                <p className="text-sm leading-relaxed">{m.aiSummary.summary}</p>
                {m.aiSummary.decisions?.length > 0 && <><h4 className="mb-1 mt-4 text-xs font-semibold text-muted">Decisions</h4><ul className="list-disc space-y-1 pl-5 text-sm">{m.aiSummary.decisions.map((d, i) => <li key={i}>{d}</li>)}</ul></>}
                {items.length > 0 && (
                  <>
                    <h4 className="mb-2 mt-4 text-xs font-semibold text-muted">Action items</h4>
                    <ul className="space-y-2">
                      {items.map((it, i) => (
                        <li key={i} className={clsx('flex items-start gap-3 rounded-xl border border-line bg-surface p-3', it.created && 'opacity-60')}>
                          <input type="checkbox" className="mt-1 accent-[#0F1535]" checked={!!it.pick} disabled={it.created} onChange={(e) => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, pick: e.target.checked } : x)))} aria-label="Include" />
                          <div className="min-w-0 flex-1">
                            <input className="w-full bg-transparent text-sm font-medium outline-none" value={it.title} onChange={(e) => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} />
                            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                              <AvatarStack users={people.filter((p) => (it.assigneeIds || []).includes(p.id))} size={18} />
                              {it.dueDate && <span>due {format(new Date(it.dueDate), 'd MMM')}</span>}
                              {it.priority && <span style={{ color: PRIORITY[it.priority]?.color }}>{PRIORITY[it.priority]?.label}</span>}
                              {it.created && <span className="font-semibold text-leaf">Task created</span>}
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                    {can('tasks.create') && !m.projectId && <select className="input mt-3" value={taskProject} onChange={(e) => setTaskProject(e.target.value)}><option value="" disabled>Project for these tasks</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.code} {p.name}</option>)}</select>}
                    {can('tasks.create') && <button type="button" className="btn-primary mt-3" onClick={makeTasks} disabled={!items.some((i) => i.pick)}><Check size={15} />Create {items.filter((i) => i.pick).length} tasks{m.projectId ? ` in ${projects.find((p) => p.id === m.projectId)?.code || 'project'}` : ''}</button>}
                  </>
                )}
              </section>
            )}
          </div>
        </div>
      )}
    </Drawer>
  );
}

export default function Meetings() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const [view, setView] = useState('upcoming');
  const [scope, setScope] = useState('mine');
  const [month, setMonth] = useState(startOfMonth(new Date()));
  const [form, setForm] = useState(null);
  const url = view === 'past' ? `/meetings?to=${new Date().toISOString()}&order=desc&scope=${scope}` : view === 'upcoming' ? `/meetings?from=${new Date(Date.now() - 3600e3).toISOString()}&scope=${scope}` : `/meetings?scope=${scope}`;
  const { data, reload } = useFetch(url, [view, scope]);
  useLive('meeting:changed', reload);
  const openId = Number(params.get('id')) || null;
  const open = (id) => { const p = new URLSearchParams(params); if (id) p.set('id', id); else p.delete('id'); setParams(p); };

  const groups = useMemo(() => {
    const out = [];
    (data || []).forEach((m) => { const d = new Date(m.startAt); const g = out.find((x) => isSameDay(x.day, d)); if (g) g.items.push(m); else out.push({ day: d, items: [m] }); });
    return out;
  }, [data]);
  const next = view === 'upcoming' ? (data || []).find((m) => new Date(m.endAt) > new Date()) : null;

  return (
    <div>
      <PageHeader title="Meetings" subtitle="Calls with the team and clients, with notes that turn into tasks."
        actions={<button type="button" className="btn-primary" onClick={() => setForm({})}><Plus size={16} />Schedule</button>} />
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Segmented value={view} onChange={setView} options={[{ value: 'upcoming', label: 'Upcoming', icon: List }, { value: 'calendar', label: 'Calendar', icon: CalendarDays }, { value: 'past', label: 'Past' }]} />
        {can('dashboard.team') && <Segmented value={scope} onChange={setScope} options={[{ value: 'mine', label: 'Mine' }, { value: 'all', label: 'Everyone' }]} />}
      </div>

      {!data ? <PageLoader /> : view === 'calendar' ? (
        <MonthCalendar month={month} setMonth={setMonth} items={data.map((m) => ({ id: m.id, date: m.startAt, title: m.title, color: m.Project?.color || '#3D5AFE', kind: 'meeting' }))} onItemClick={(it) => open(it.id)}
          onSelectDay={(d) => { const s = new Date(d); s.setHours(11, 0, 0, 0); setForm({ defaults: { startAt: toLocalInput(s) } }); }} />
      ) : !data.length ? (
        <div className="panel"><Empty icon={Video} title={view === 'past' ? 'No past meetings' : 'Nothing scheduled'} body="Schedule a call and everyone gets a WhatsApp and in-app invite, plus a reminder 15 minutes before." action={<button type="button" className="btn-primary" onClick={() => setForm({})}>Schedule a meeting</button>} /></div>
      ) : (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="space-y-5">
            {groups.map((g) => (
              <section key={g.day.toISOString()}>
                <h2 className="mb-2 text-sm font-semibold text-muted">{dayName(g.day)}</h2>
                <div className="space-y-2">
                  {g.items.map((m) => {
                    const live = new Date(m.startAt) <= new Date() && new Date(m.endAt) > new Date();
                    return (
                      <button key={m.id} type="button" onClick={() => open(m.id)} className="panel flex w-full items-center gap-4 p-4 text-left transition hover:shadow-lift">
                        <div className="w-16 shrink-0 text-center"><div className="font-display text-lg font-semibold leading-none">{format(new Date(m.startAt), 'h:mm')}</div><div className="mt-0.5 text-[11px] text-muted">{format(new Date(m.startAt), 'a')}, {Math.round((new Date(m.endAt) - new Date(m.startAt)) / 60000)}m</div></div>
                        <span className="h-10 w-1 shrink-0 rounded-full" style={{ background: m.Project?.color || '#3D5AFE' }} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2"><p className="truncate font-semibold">{m.title}</p>{live && <span className="chip bg-ember/10 text-ember">Live</span>}{m.aiSummary && <span className="chip bg-violet/10 text-violet"><Sparkles size={10} />Notes</span>}</div>
                          <p className="mt-0.5 flex items-center gap-3 truncate text-xs text-muted">{m.link ? <span className="inline-flex items-center gap-1"><Video size={12} />Video call</span> : m.location ? <span className="inline-flex items-center gap-1"><MapPin size={12} />{m.location}</span> : null}{m.Client && <span>{m.Client.name}</span>}</p>
                        </div>
                        <AvatarStack users={m.attendees} max={4} size={24} />
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
          {next && (
            <aside className="h-fit rounded-3xl bg-night p-5 text-white">
              <p className="text-xs font-semibold text-white/60">Up next</p>
              <h3 className="mt-1 text-xl font-semibold">{next.title}</h3>
              <p className="mt-1 text-sm text-white/70">{dayName(new Date(next.startAt))}, {format(new Date(next.startAt), 'h:mm a')}</p>
              <div className="mt-4 flex -space-x-1.5">{next.attendees.slice(0, 6).map((a) => <Avatar key={a.id} user={a} size={28} ring />)}</div>
              <div className="mt-5 flex gap-2">
                {next.link && <a href={next.link} target="_blank" rel="noreferrer" className="btn-primary"><ExternalLink size={14} />Join</a>}
                <button type="button" className="btn btn-sm border border-white/20 text-white hover:bg-white/10" onClick={() => open(next.id)}><Users size={14} />Details</button>
              </div>
            </aside>
          )}
        </div>
      )}

      <MeetingForm open={!!form} onClose={() => setForm(null)} meeting={form?.meeting} defaults={form?.defaults} onSaved={reload} />
      {openId && <MeetingDrawer id={openId} onClose={() => open(null)} onEdit={(m) => setForm({ meeting: m })} />}
    </div>
  );
}

