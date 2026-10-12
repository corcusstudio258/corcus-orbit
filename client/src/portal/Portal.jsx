import { useState } from 'react';
import { Link, NavLink, Outlet, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import { LogOut, Check, X, Send, Download, Paperclip, Inbox, Plus, Flag, ChevronRight, MessageCircle, Video, FileText, ArrowLeft } from 'lucide-react';
import { format } from 'date-fns';
import api, { fileUrl } from '../lib/api';
import useFetch from '../lib/useFetch';
import { useAuth, useLive } from '../context/AuthContext';
import { OrbitRing, Avatar, AvatarStack, StatusPill, DueBadge, PageLoader, Modal, Field, Bar, Empty, Markdown } from '../components/ui';
import { ago, fmtDate, bytes, STATUS, PRIORITY, PROJECT_STATUS } from '../lib/format';

export function PortalLayout() {
  const { user, company, logout } = useAuth();
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-line bg-canvas/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3 sm:px-6">
          <Link to="/portal" className="flex items-center gap-2.5"><img src="/orbit.svg" alt="" className="h-8 w-8" /><span className="leading-tight"><span className="block font-display text-sm font-semibold">{company?.name}</span><span className="block text-[11px] text-muted">Client portal</span></span></Link>
          <nav className="ml-4 flex gap-1">
            <NavLink end to="/portal" className={({ isActive }) => clsx('tab', isActive && 'tab-active')}>Overview</NavLink>
            <NavLink to="/portal/requests" className={({ isActive }) => clsx('tab', isActive && 'tab-active')}>Requests</NavLink>
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden text-sm text-muted sm:block">{user.Client?.name}</span>
            <Avatar user={user} size={30} />
            <button type="button" onClick={logout} className="rounded-lg p-2 text-muted hover:text-ember" aria-label="Sign out"><LogOut size={17} /></button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6"><Outlet /></main>
    </div>
  );
}

function ReviewButtons({ task, onDone }) {
  const [mode, setMode] = useState(null);
  const [note, setNote] = useState('');
  const send = async () => {
    try { await api.post(`/portal/tasks/${task.id}/review`, { decision: mode, note }); toast.success(mode === 'approve' ? 'Approved. The team has been told.' : 'Sent back to the team with your notes.'); setMode(null); setNote(''); onDone(); } catch (e) { toast.error(e.message); }
  };
  return (<>
    <div className="flex gap-2">
      <button type="button" className="btn-ghost btn-sm" onClick={() => setMode('changes')}><X size={13} />Ask for changes</button>
      <button type="button" className="btn-primary btn-sm" onClick={() => setMode('approve')}><Check size={13} />Approve</button>
    </div>
    <Modal open={!!mode} onClose={() => setMode(null)} title={mode === 'approve' ? `Approve “${task.title}”` : `Changes for “${task.title}”`} width="max-w-md"
      footer={<><button type="button" className="btn-ghost" onClick={() => setMode(null)}>Cancel</button><button type="button" className="btn-primary" onClick={send}>{mode === 'approve' ? 'Approve' : 'Send to team'}</button></>}>
      <textarea className="input min-h-[110px]" value={note} onChange={(e) => setNote(e.target.value)} placeholder={mode === 'approve' ? 'Anything you want to add? (optional)' : 'Tell the team what to change'} />
    </Modal>
  </>);
}

export function PortalHome() {
  const { user } = useAuth();
  const { data, loading, reload } = useFetch('/portal/overview');
  useLive(['task:changed', 'project:changed', 'activity', 'request:changed'], reload);
  if (loading || !data) return <PageLoader />;
  const avg = data.projects.length ? Math.round(data.projects.reduce((s, p) => s + p.progress, 0) / data.projects.length) : 0;
  return (
    <div className="space-y-8">
      <section className="relative flex flex-wrap items-center gap-8 overflow-hidden rounded-[26px] bg-night p-7 text-white sm:p-9">
        <div className="pointer-events-none absolute -right-20 -top-28 h-80 w-80 rounded-full border border-white/10" />
        <div className="pointer-events-none absolute -right-6 -top-14 h-52 w-52 rounded-full border border-white/10" />
        <OrbitRing value={avg} size={132} stroke={8} sub="overall" dark color="#FFC21A" track="rgba(255,255,255,.12)" />
        <div className="relative max-w-xl">
          <h1 className="font-display text-3xl font-semibold text-white sm:text-4xl">Hello, {user.name.split(' ')[0]}</h1>
          <p className="mt-2 text-white/70">Here's where your work with us stands right now. Updates appear the moment the team moves something.</p>
          {data.awaitingReview.length > 0 && <p className="mt-4 inline-flex rounded-full bg-brand px-3 py-1 text-sm font-semibold text-brand-ink">{data.awaitingReview.length} item{data.awaitingReview.length > 1 ? 's are' : ' is'} waiting for your approval</p>}
        </div>
      </section>

      {data.meetings?.length > 0 && (
        <section className="panel p-5">
          <h2 className="mb-3 font-semibold">Meetings with the team</h2>
          <ul className="grid gap-2 sm:grid-cols-2">
            {data.meetings.map((m) => (
              <li key={m.id} className="flex items-center gap-3 rounded-xl border border-line p-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-violet/10 text-violet"><Video size={17} /></span>
                <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{m.title}</span><span className="block text-xs text-muted">{format(new Date(m.startAt), 'EEE d MMM, h:mm a')}{m.location ? `, ${m.location}` : ''}</span></span>
                {m.link && <a href={m.link} target="_blank" rel="noreferrer" className="btn-primary btn-sm">Join</a>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {data.awaitingReview.length > 0 && (
        <section className="panel border-violet/40 p-5">
          <h2 className="mb-4 font-semibold">Ready for your review</h2>
          <ul className="space-y-3">
            {data.awaitingReview.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-sunken/50 p-3">
                <span className="h-2 w-2 rounded-full" style={{ background: t.project.color }} />
                <Link to={`/portal/tasks/${t.id}`} className="min-w-0 flex-1"><span className="block font-medium hover:underline">{t.title}</span><span className="text-xs text-muted">{t.project.name}</span></Link>
                <ReviewButtons task={t} onDone={reload} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="mb-4 text-xl font-semibold">Your projects</h2>
        {!data.projects.length ? <div className="panel"><Empty title="No shared projects yet" body="Your team will share projects here as work begins." /></div> : (
          <div className="grid gap-4 md:grid-cols-2">
            {data.projects.map((p) => {
              const next = p.milestones.find((m) => !m.done);
              return (
                <Link key={p.id} to={`/portal/projects/${p.id}`} className="panel p-5 transition hover:border-cobalt/40">
                  <div className="flex items-center gap-4">
                    <OrbitRing value={p.progress} size={80} color={p.color} />
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-lg font-semibold">{p.name}</h3>
                      <div className="text-xs text-muted">{PROJECT_STATUS[p.status]}{p.dueDate ? `, target ${fmtDate(p.dueDate, 'd MMM')}` : ''}</div>
                      <div className="mt-2 flex items-center gap-2 text-xs text-muted"><Avatar user={p.owner} size={18} />{p.owner?.name} leads this</div>
                    </div>
                  </div>
                  {next && <div className="mt-4 flex items-center gap-2 rounded-xl bg-sunken/50 px-3 py-2 text-sm"><Flag size={14} className="text-amber" /><span className="text-muted">Next milestone:</span><span className="truncate font-medium">{next.title}</span>{next.dueDate && <span className="ml-auto text-xs text-muted">{fmtDate(next.dueDate, 'd MMM')}</span>}</div>}
                  <div className="mt-3 text-xs text-muted">{p.doneTasks} of {p.visibleTasks} shared deliverables complete</div>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="panel p-5">
          <h2 className="mb-4 font-semibold">Coming up</h2>
          <ul className="space-y-3">
            {data.upcoming.map((t) => (
              <li key={t.id}><Link to={`/portal/tasks/${t.id}`} className="flex items-center gap-3">
                <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{t.title}</span><span className="text-xs text-muted">{t.project.name}</span></span>
                <DueBadge date={t.dueDate} /><StatusPill status={t.status} small />
              </Link></li>
            ))}
            {!data.upcoming.length && <li className="text-sm text-muted">No upcoming deadlines.</li>}
          </ul>
        </section>
        <section className="panel p-5">
          <h2 className="mb-4 font-semibold">Latest updates</h2>
          <ol className="space-y-3">
            {data.activity.map((a) => (
              <li key={a.id} className="flex gap-3 text-sm"><Avatar user={a.actor} size={22} /><span><span className="font-medium">{a.actor?.name}</span> <span className="text-muted">{a.summary}</span><span className="block text-[11px] text-muted/70">{ago(a.createdAt)}, {a.Project?.name}</span></span></li>
            ))}
            {!data.activity.length && <li className="text-sm text-muted">Updates appear here as the team works.</li>}
          </ol>
        </section>
      </div>
    </div>
  );
}

export function PortalProject() {
  const { id } = useParams();
  const { data: p, loading, reload } = useFetch(`/portal/projects/${id}`);
  useLive(['task:changed', 'activity'], reload, [id]);
  if (loading || !p) return <PageLoader />;
  const roots = p.tasks.filter((t) => !t.parentId || !p.tasks.some((x) => x.id === t.parentId));
  const kids = (tid) => p.tasks.filter((t) => t.parentId === tid);
  return (
    <div className="space-y-6">
      <Link to="/portal" className="text-sm text-muted hover:text-ink">Overview</Link>
      <section className="panel flex flex-wrap items-center gap-6 p-6">
        <OrbitRing value={p.progress} size={112} stroke={7} color={p.color} sub="complete" />
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold sm:text-3xl">{p.name}</h1>
          {p.description && <p className="mt-1 max-w-2xl text-sm text-muted">{p.description}</p>}
          <div className="mt-3 flex flex-wrap items-center gap-5 text-sm text-muted">
            <span className="inline-flex items-center gap-2"><Avatar user={p.owner} size={22} />{p.owner?.name}, your point of contact</span>
            {p.dueDate && <span>Target {fmtDate(p.dueDate)}</span>}
            <AvatarStack users={p.team} max={5} />
          </div>
        </div>
      </section>

      {p.milestones.length > 0 && (
        <section className="panel p-5">
          <h2 className="mb-5 font-semibold">Milestones</h2>
          <div className="relative flex gap-0 overflow-x-auto pb-2">
            {p.milestones.map((m, i) => (
              <div key={m.id} className="relative min-w-[180px] flex-1 pr-4">
                <div className="flex items-center">
                  <span className={clsx('z-10 grid h-6 w-6 shrink-0 place-items-center rounded-full border-2', m.done ? 'border-leaf bg-leaf text-white' : 'border-line bg-canvas')}>{m.done && <Check size={13} strokeWidth={3} />}</span>
                  {i < p.milestones.length - 1 && <span className={clsx('h-0.5 flex-1', m.done ? 'bg-leaf' : 'bg-line')} />}
                </div>
                <div className="mt-3 text-sm font-semibold">{m.title}</div>
                <div className="text-xs text-muted">{m.dueDate ? fmtDate(m.dueDate, 'd MMM') : 'No date yet'}</div>
                {!m.done && <Bar value={m.progress} color={p.color} className="mt-2 max-w-[140px]" />}
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
        <section className="panel p-5">
          <h2 className="mb-4 font-semibold">Deliverables</h2>
          <ul className="space-y-2">
            {roots.map((t) => (
              <li key={t.id}>
                <Link to={`/portal/tasks/${t.id}`} className="flex items-center gap-3 rounded-xl border border-line bg-sunken/50 p-3 hover:border-cobalt/40">
                  <OrbitRing value={t.progress} size={40} stroke={4} color={STATUS[t.status].color} label={false} />
                  <span className="min-w-0 flex-1"><span className="block truncate font-medium">{t.title}</span><span className="mt-0.5 flex items-center gap-3"><DueBadge date={t.dueDate} done={t.status === 'done'} /></span></span>
                  <StatusPill status={t.status} />
                </Link>
                {kids(t.id).length > 0 && (
                  <ul className="ml-8 mt-1 space-y-1 border-l border-line pl-4">
                    {kids(t.id).map((k) => <li key={k.id}><Link to={`/portal/tasks/${k.id}`} className="flex items-center gap-2 py-1 text-sm"><span className="h-1.5 w-1.5 rounded-full" style={{ background: STATUS[k.status].color }} /><span className="flex-1 truncate">{k.title}</span><span className="text-xs text-muted">{STATUS[k.status].label}</span></Link></li>)}
                  </ul>
                )}
              </li>
            ))}
            {!roots.length && <li className="text-sm text-muted">The team hasn't shared deliverables on this project yet.</li>}
          </ul>
        </section>
        <div className="space-y-5">
          {p.docs?.length > 0 && (
            <section className="panel p-5">
              <h2 className="mb-3 font-semibold">Documents</h2>
              <ul className="space-y-1">{p.docs.map((d) => <li key={d.id}><Link to={`/portal/docs/${d.id}`} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-sunken"><span>{d.icon || '📄'}</span><span className="flex-1 truncate font-medium">{d.title}</span><span className="text-xs text-muted">{ago(d.updatedAt)}</span></Link></li>)}</ul>
            </section>
          )}
          <section className="panel p-5">
            <h2 className="mb-3 font-semibold">Shared files</h2>
            <ul className="space-y-2 text-sm">
              {p.files.map((f) => <li key={f.id}><a href={fileUrl(f.id)} className="flex items-center gap-2 hover:text-cobalt"><Paperclip size={14} className="text-muted" /><span className="flex-1 truncate">{f.name}</span><span className="text-xs text-muted">{bytes(f.size)}</span><Download size={14} /></a></li>)}
              {!p.files.length && <li className="text-muted">No files shared yet.</li>}
            </ul>
          </section>
          <section className="panel p-5">
            <h2 className="mb-3 font-semibold">Updates</h2>
            <ol className="space-y-3">
              {p.activity.slice(0, 15).map((a) => <li key={a.id} className="flex gap-2 text-sm"><Avatar user={a.actor} size={20} /><span><span className="font-medium">{a.actor?.name}</span> <span className="text-muted">{a.summary}</span><span className="block text-[11px] text-muted/70">{ago(a.createdAt)}</span></span></li>)}
            </ol>
          </section>
        </div>
      </div>
    </div>
  );
}

export function PortalTask() {
  const { id } = useParams();
  const { data: t, loading, reload } = useFetch(`/portal/tasks/${id}`);
  const [body, setBody] = useState('');
  useLive('task:changed', (d) => d?.id === Number(id) && reload(), [id]);
  if (loading || !t) return <PageLoader />;
  if (t.error) return <div className="panel p-10 text-center text-muted">{t.error}</div>;
  const post = async (e) => {
    e.preventDefault(); if (!body.trim()) return;
    try { await api.post(`/portal/tasks/${t.id}/comments`, { body }); setBody(''); reload(); } catch (err) { toast.error(err.message); }
  };
  return (
    <div className="space-y-6">
      <nav className="flex items-center gap-1 text-sm text-muted"><Link to="/portal" className="hover:text-ink">Overview</Link><ChevronRight size={13} /><Link to={`/portal/projects/${t.project.id}`} className="hover:text-ink">{t.project.name}</Link></nav>
      <section className="panel p-6">
        <div className="flex flex-wrap items-start gap-5">
          <OrbitRing value={t.progress} size={88} color={STATUS[t.status].color} />
          <div className="min-w-0 flex-1">
            <div className="mb-2 flex flex-wrap items-center gap-3"><StatusPill status={t.status} /><DueBadge date={t.dueDate} done={t.status === 'done'} /></div>
            <h1 className="text-2xl font-semibold">{t.title}</h1>
            {t.description && <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-ink/85">{t.description}</p>}
            <div className="mt-4 flex items-center gap-2 text-sm text-muted"><AvatarStack users={t.assignees} />{t.assignees.length ? 'working on this' : ''}</div>
          </div>
          {t.status === 'review' && <ReviewButtons task={t} onDone={reload} />}
        </div>
        {t.subtasks.length > 0 && (
          <div className="mt-6 border-t border-line pt-4">
            <h2 className="mb-2 text-sm font-semibold text-muted">Steps</h2>
            <ul className="space-y-1.5">{t.subtasks.map((s) => <li key={s.id} className="flex items-center gap-3 text-sm"><span className={clsx('grid h-4 w-4 place-items-center rounded border', s.status === 'done' ? 'border-leaf bg-leaf text-white' : 'border-line')}>{s.status === 'done' && <Check size={10} strokeWidth={3} />}</span><span className={clsx('flex-1', s.status === 'done' && 'text-muted line-through')}>{s.title}</span><span className="text-xs text-muted">{STATUS[s.status].label}</span></li>)}</ul>
          </div>
        )}
        {t.files.length > 0 && (
          <div className="mt-6 border-t border-line pt-4">
            <h2 className="mb-2 text-sm font-semibold text-muted">Files</h2>
            <ul className="space-y-1.5 text-sm">{t.files.map((f) => <li key={f.id}><a href={fileUrl(f.id)} className="inline-flex items-center gap-2 hover:text-cobalt"><Download size={14} />{f.name}<span className="text-xs text-muted">{bytes(f.size)}</span></a></li>)}</ul>
          </div>
        )}
      </section>
      <section className="panel p-6">
        <h2 className="mb-4 flex items-center gap-2 font-semibold"><MessageCircle size={17} className="text-cobalt" />Conversation with the team</h2>
        <ul className="space-y-4">
          {t.comments.map((c) => (
            <li key={c.id} className={clsx('flex gap-3', c.author?.Role?.isClientRole && 'flex-row-reverse text-right')}>
              <Avatar user={c.author} size={30} />
              <div className={clsx('max-w-[80%] rounded-2xl px-4 py-2.5', c.author?.Role?.isClientRole ? 'bg-cobalt/10' : 'bg-sunken/50')}>
                <div className="mb-0.5 text-xs text-muted"><span className="font-semibold text-ink">{c.author?.name}</span> {ago(c.createdAt)}</div>
                <p className="whitespace-pre-wrap text-left text-sm">{c.body}</p>
              </div>
            </li>
          ))}
          {!t.comments.length && <li className="text-sm text-muted">Ask a question or share feedback. The team gets it right away.</li>}
        </ul>
        <form onSubmit={post} className="mt-5 flex gap-2"><input className="input" value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write to the team" /><button className="btn-primary"><Send size={15} />Send</button></form>
      </section>
    </div>
  );
}

export function PortalRequests() {
  const { data, loading, reload } = useFetch('/portal/requests');
  const { data: ov } = useFetch('/portal/overview');
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ title: '', description: '', priority: 'medium', projectId: '' });
  useLive('request:changed', reload);
  const submit = async (e) => {
    e.preventDefault();
    try { await api.post('/portal/requests', f); toast.success('Request sent to the team'); setOpen(false); setF({ title: '', description: '', priority: 'medium', projectId: '' }); reload(); } catch (err) { toast.error(err.message); }
  };
  const tone = { open: '#FFB648', accepted: '#3DE0F2', declined: '#FF7A90', done: '#5BE3A6' };
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-semibold">Requests</h1><p className="text-sm text-muted">Need something new or changed? Ask here instead of WhatsApp so nothing gets lost.</p></div><button type="button" className="btn-primary" onClick={() => setOpen(true)}><Plus size={16} />New request</button></div>
      {loading ? <PageLoader /> : !data.length ? <div className="panel"><Empty icon={Inbox} title="No requests yet" body="Requests go straight to your project lead." /></div> : (
        <ul className="space-y-3">
          {data.map((r) => (
            <li key={r.id} className="panel p-4">
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-semibold">{r.title}</span>
                <span className="chip" style={{ color: tone[r.status], background: `${tone[r.status]}1A` }}>{r.status}</span>
                <span className="ml-auto text-xs text-muted">{ago(r.createdAt)}{r.Project ? `, ${r.Project.name}` : ''}</span>
              </div>
              {r.description && <p className="mt-2 text-sm text-muted">{r.description}</p>}
              {r.response && <p className="mt-2 rounded-xl bg-sunken/50 px-3 py-2 text-sm">Team reply: {r.response}</p>}
              {r.Task && <Link to={`/portal/tasks/${r.Task.id}`} className="link mt-2 inline-block text-sm">Track it: {STATUS[r.Task.status]?.label}</Link>}
            </li>
          ))}
        </ul>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="New request" footer={<><button type="button" className="btn-ghost" onClick={() => setOpen(false)}>Cancel</button><button form="rq" className="btn-primary">Send request</button></>}>
        <form id="rq" onSubmit={submit} className="space-y-4">
          <Field label="What do you need?"><input className="input" required value={f.title} onChange={(e) => setF((s) => ({ ...s, title: e.target.value }))} placeholder="One more post for Chhath Puja" /></Field>
          <Field label="Details"><textarea className="input min-h-[100px]" value={f.description} onChange={(e) => setF((s) => ({ ...s, description: e.target.value }))} /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Project"><select className="input" value={f.projectId} onChange={(e) => setF((s) => ({ ...s, projectId: e.target.value }))}><option value="">Not sure</option>{ov?.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
            <Field label="How urgent?"><select className="input" value={f.priority} onChange={(e) => setF((s) => ({ ...s, priority: e.target.value }))}>{Object.entries(PRIORITY).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></Field>
          </div>
        </form>
      </Modal>
    </div>
  );
}

export function PortalDoc() {
  const { id } = useParams();
  const { data: d, loading } = useFetch(`/portal/docs/${id}`);
  if (loading || !d) return <PageLoader />;
  if (d.error) return <div className="panel"><Empty icon={FileText} title="Document not available" body={d.error} /></div>;
  return (
    <div className="mx-auto max-w-3xl">
      <Link to={`/portal/projects/${d.project.id}`} className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink"><ArrowLeft size={15} />{d.project.name}</Link>
      <article className="panel px-6 py-8 sm:px-10">
        <div className="mb-6 flex items-center gap-3"><span className="text-4xl">{d.icon || '📄'}</span><div><h1 className="font-display text-3xl font-semibold">{d.title}</h1><p className="text-xs text-muted">Updated {ago(d.updatedAt)}</p></div></div>
        <Markdown className="!text-[15px]">{d.content}</Markdown>
      </article>
    </div>
  );
}
