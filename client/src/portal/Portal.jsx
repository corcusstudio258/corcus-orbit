import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import { LogOut, Check, X, Download, Paperclip, Inbox, Plus, Flag, ChevronRight, MessageCircle, Video, FileText, ArrowLeft, LayoutDashboard, Eye, Building2, Film, ImagePlus, FileUp } from 'lucide-react';
import { ReviewBoard, CommentThread, BriefThread, toFormData } from '../components/Review';
import OnboardingFields from '../components/OnboardingFields';
import { celebrate, pointOf } from '../components/Celebrate';
import { format } from 'date-fns';
import api, { fileUrl, clientFileUrl } from '../lib/api';
import useFetch from '../lib/useFetch';
import { useAuth, useLive } from '../context/AuthContext';
import { OrbitRing, Avatar, AvatarStack, StatusPill, DueBadge, PageLoader, Modal, Field, Bar, Empty, Markdown } from '../components/ui';
import { ago, fmtDate, bytes, STATUS, PRIORITY, PROJECT_STATUS } from '../lib/format';

export function PortalLayout() {
  const { user, company, logout } = useAuth();
  const { data: ov, reload } = useFetch('/portal/overview');
  useLive(['task:changed', 'request:changed'], reload);
  const client = ov?.client || user.Client || {};
  const toReview = (ov?.reviewFiles?.length || 0) + (ov?.awaitingReview?.length || 0) + (ov?.briefs?.length || 0);
  const nav = [
    { to: '/portal', label: 'Overview', icon: LayoutDashboard, end: true },
    { to: '/portal/review', label: 'Review', icon: Eye, badge: toReview },
    { to: '/portal/requests', label: 'Requests', icon: Inbox, badge: ov?.openRequests },
    { to: '/portal/profile', label: 'Business & files', icon: Building2 },
  ];
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-line bg-canvas/85 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2.5 sm:px-6">
          <Link to="/portal" className="flex min-w-0 items-center gap-2.5">
            {client.logo ? <span className="grid h-9 w-9 place-items-center overflow-hidden rounded-xl border border-line bg-surface"><img src={clientFileUrl(client.logo, true)} alt="" className="h-full w-full object-contain p-1" /></span>
              : <span className="grid h-9 w-9 place-items-center rounded-xl font-display font-semibold text-white" style={{ background: client.color || '#3D5AFE' }}>{(client.name || 'C')[0]}</span>}
            <span className="min-w-0 leading-tight"><span className="block truncate font-display text-sm font-semibold">{client.name || 'Your portal'}</span><span className="block truncate text-[11px] text-muted">with {company?.name}</span></span>
          </Link>
          <nav className="ml-4 hidden gap-1 md:flex">
            {nav.map((n) => (
              <NavLink key={n.to} end={n.end} to={n.to} className={({ isActive }) => clsx('inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm font-semibold transition', isActive ? 'bg-ink text-surface' : 'text-muted hover:bg-sunken hover:text-ink')}>
                <n.icon size={15} />{n.label}{n.badge > 0 && <span className="grid h-5 min-w-[20px] place-items-center rounded-full bg-brand px-1.5 text-[10px] font-bold text-brand-ink">{n.badge}</span>}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <span className="hidden text-right text-xs leading-tight sm:block"><span className="block font-semibold">{user.name}</span><span className="text-muted">{user.email}</span></span>
            <Avatar user={user} size={32} />
            <button type="button" onClick={logout} className="rounded-lg p-2 text-muted hover:bg-sunken hover:text-ember" aria-label="Sign out" title="Sign out"><LogOut size={17} /></button>
          </div>
        </div>
        <nav className="flex gap-1 overflow-x-auto border-t border-line/60 px-3 py-1.5 md:hidden">
          {nav.map((n) => (
            <NavLink key={n.to} end={n.end} to={n.to} className={({ isActive }) => clsx('inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold', isActive ? 'bg-ink text-surface' : 'text-muted')}>
              <n.icon size={14} />{n.label}{n.badge > 0 && <span className="rounded-full bg-brand px-1.5 text-[10px] font-bold text-brand-ink">{n.badge}</span>}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8"><Outlet /></main>
      <footer className="mx-auto max-w-6xl px-6 pb-8 text-center text-xs text-faint">Powered by Orbit for {company?.name}</footer>
    </div>
  );
}

function ReviewButtons({ task, onDone }) {
  const [mode, setMode] = useState(null);
  const [note, setNote] = useState('');
  const send = async () => {
    try { await api.post(`/portal/tasks/${task.id}/review`, { decision: mode, note }); if (mode === 'approve') celebrate('done'); else toast.success('Sent back to the team with your notes.'); setMode(null); setNote(''); onDone(); } catch (e) { toast.error(e.message); }
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

/** The task description (brief, caption, script) with the client's approve / suggest-changes buttons. */
function BriefReview({ task: t, onDone, compact, comments }) {
  const [mode, setMode] = useState(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    try {
      await api.post(`/portal/tasks/${t.id}/description-review`, { decision: mode, note });
      if (mode === 'approve') celebrate('done'); else toast.success('Sent to the team with your notes.');
      setMode(null); setNote(''); onDone();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  const asked = t.descReviewStatus === 'requested';
  return (
    <div className={clsx(compact ? '' : 'border-t border-line px-6 py-5', asked && !compact && 'bg-cobalt/[0.04]')}>
      {!compact && (
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold text-muted">Details</h2>
          {asked && <span className="chip bg-cobalt/10 text-cobalt">The team would like your feedback on this</span>}
          {t.descReviewStatus === 'approved' && <span className="chip bg-leaf/15 text-leaf"><Check size={11} />You approved this{t.descReviewedAt ? ` ${ago(t.descReviewedAt)}` : ''}</span>}
          {t.descReviewStatus === 'changes' && <span className="chip bg-amber/15 text-amber">You asked for changes. The team is updating it.</span>}
        </div>
      )}
      {!compact && <div className="rounded-xl border border-line bg-surface p-4 text-sm leading-relaxed"><Markdown>{t.description}</Markdown></div>}
      <div className={clsx('flex flex-wrap items-center gap-2', !compact && 'mt-3')}>
        {t.descReviewStatus !== 'approved' && <button type="button" className="btn-primary btn-sm" onClick={() => setMode('approve')}><Check size={13} />Approve</button>}
        <button type="button" className="btn-ghost btn-sm" onClick={() => setMode('changes')}><X size={13} />Request changes</button>
        {!compact && <span className="text-xs text-muted">or leave a comment below</span>}
      </div>
      {!compact && comments && (
        <div className="mt-4 rounded-xl border border-line bg-surface/60 p-4">
          <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold"><MessageCircle size={14} />Comments on these details</h3>
          <BriefThread comments={comments} emptyText="Have a suggestion or a question about the text? Write it here. The people working on this task see it right away."
            placeholder="Suggest a change or ask a question about the details"
            onPost={async (v) => { await api.post(`/portal/tasks/${t.id}/comments`, toFormData(v, { kind: 'brief' })); toast.success('Sent to the team'); onDone(); }} />
        </div>
      )}
      <Modal open={!!mode} onClose={() => setMode(null)} title={mode === 'approve' ? 'Approve these details' : 'What should change?'} width="max-w-lg"
        footer={<><button type="button" className="btn-ghost" onClick={() => setMode(null)}>Cancel</button><button type="button" className="btn-primary" disabled={busy || (mode === 'changes' && !note.trim())} onClick={send}>{mode === 'approve' ? 'Approve' : 'Send to team'}</button></>}>
        {mode === 'changes' && <div className="mb-3 max-h-48 overflow-y-auto rounded-xl bg-sunken/60 p-3 text-sm"><Markdown>{t.description}</Markdown></div>}
        <textarea className="input min-h-[120px]" autoFocus value={note} onChange={(e) => setNote(e.target.value)} placeholder={mode === 'approve' ? 'Anything to add? (optional)' : 'For example: change the second line to "Order now on kasaar.in", and use a warmer tone.'} />
      </Modal>
    </div>
  );
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
        <div className="relative">
          <OrbitRing value={avg} size={132} stroke={8} sub="overall" dark color="#FFC21A" track="rgba(255,255,255,.12)" />
          {data.client?.logo && <span className="absolute -bottom-1 -right-1 grid h-12 w-12 place-items-center overflow-hidden rounded-2xl border-2 border-night bg-white"><img src={clientFileUrl(data.client.logo, true)} alt="" className="h-full w-full object-contain p-1" /></span>}
        </div>
        <div className="relative max-w-xl">
          <h1 className="font-display text-3xl font-semibold text-white sm:text-4xl">Hello, {user.name.split(' ')[0]}</h1>
          <p className="mt-2 text-white/70">Here's where your work with us stands right now. Updates appear the moment the team moves something.</p>
          {data.awaitingReview.length > 0 && <p className="mt-4 inline-flex rounded-full bg-brand px-3 py-1 text-sm font-semibold text-brand-ink">{data.awaitingReview.length} item{data.awaitingReview.length > 1 ? 's are' : ' is'} waiting for your approval</p>}
        </div>
      </section>

      {data.reviewFiles?.length > 0 && (
        <section>
          <div className="mb-3 flex items-center gap-2"><h2 className="text-lg font-semibold">Needs your eyes</h2><span className="chip bg-brand-soft text-ink">{data.reviewFiles.length} to review</span><Link to="/portal/review" className="link ml-auto text-sm">See all</Link></div>
          <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
            {data.reviewFiles.map((f) => (
              <Link key={f.id} to={`/portal/tasks/${f.task.id}?tab=review`} className="group w-56 shrink-0 overflow-hidden rounded-2xl border border-line bg-surface transition hover:shadow-lift">
                <div className="grid h-32 place-items-center overflow-hidden bg-sunken">{/^image\//.test(f.mime || '') ? <img src={fileUrl(f.id)} alt="" className="h-full w-full object-cover transition group-hover:scale-105" loading="lazy" /> : /^video\//.test(f.mime || '') ? <Film size={26} className="text-muted" /> : <FileText size={26} className="text-muted" />}</div>
                <div className="p-3"><p className="truncate text-sm font-semibold">{f.task.title}</p><p className="truncate text-xs text-muted">{f.name}</p><p className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-cobalt">Review and comment<ChevronRight size={12} /></p></div>
              </Link>
            ))}
          </div>
        </section>
      )}

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
  const [tab, setTab] = useState(() => new URLSearchParams(window.location.search).get('tab') || null);
  useLive('task:changed', (d) => d?.id === Number(id) && reload(), [id]);
  if (loading || !t) return <PageLoader />;
  if (t.error) return <div className="panel p-10 text-center text-muted">{t.error}</div>;
  const reviewFiles = t.files.filter((f) => /^(image|video)\//.test(f.mime || '') || /pdf/.test(f.mime || ''));
  const otherFiles = t.files.filter((f) => !reviewFiles.includes(f));
  const active = tab || (reviewFiles.length ? 'review' : 'talk');
  const post = async (fd) => { await api.post(`/portal/tasks/${t.id}/comments`, fd); reload(); };
  const openNotes = t.comments.filter((c) => c.kind === 'review' && !c.resolved).length;
  return (
    <div className="space-y-6">
      <nav className="flex items-center gap-1 text-sm text-muted"><Link to="/portal" className="hover:text-ink">Overview</Link><ChevronRight size={13} /><Link to={`/portal/projects/${t.project.id}`} className="hover:text-ink">{t.project.name}</Link></nav>
      <section className="panel overflow-hidden">
        <div className="h-1.5" style={{ background: t.project.color }} />
        <div className="flex flex-wrap items-start gap-5 p-6">
          <OrbitRing value={t.progress} size={80} color={STATUS[t.status].color} />
          <div className="min-w-0 flex-1">
            <div className="mb-2 flex flex-wrap items-center gap-3"><StatusPill status={t.status} /><DueBadge date={t.dueDate} done={t.status === 'done'} /><span className="text-xs text-muted">{t.key}</span></div>
            <h1 className="text-2xl font-semibold">{t.title}</h1>
            <div className="mt-4 flex items-center gap-2 text-sm text-muted"><AvatarStack users={t.assignees} />{t.assignees.length ? 'working on this' : ''}</div>
          </div>
          {t.status === 'review' && <div className="w-full sm:w-auto"><p className="mb-2 text-xs font-semibold text-violet">Waiting for your sign-off</p><ReviewButtons task={t} onDone={reload} /></div>}
        </div>
        {t.description && <BriefReview task={t} onDone={reload} comments={t.comments} />}
        {t.subtasks.length > 0 && (
          <div className="border-t border-line px-6 py-4">
            <h2 className="mb-2 text-sm font-semibold text-muted">Steps</h2>
            <ul className="grid gap-1.5 sm:grid-cols-2">{t.subtasks.map((st2) => <li key={st2.id} className="flex items-center gap-3 text-sm"><span className={clsx('grid h-4 w-4 place-items-center rounded border', st2.status === 'done' ? 'border-leaf bg-leaf text-white' : 'border-line')}>{st2.status === 'done' && <Check size={10} strokeWidth={3} />}</span><span className={clsx('flex-1', st2.status === 'done' && 'text-muted line-through')}>{st2.title}</span><span className="text-xs text-muted">{STATUS[st2.status].label}</span></li>)}</ul>
          </div>
        )}
      </section>
      <div className="flex gap-1">
        {[['review', `Review the work${openNotes ? ` (${openNotes})` : ''}`, Eye], ['talk', 'Conversation', MessageCircle]].map(([k, l, I]) => (
          <button key={k} type="button" onClick={() => setTab(k)} className={clsx('inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-semibold transition', active === k ? 'bg-ink text-surface' : 'text-muted hover:bg-sunken hover:text-ink')}><I size={15} />{l}</button>
        ))}
      </div>
      <section className="panel p-5">
        {active === 'review' ? (
          <ReviewBoard isClient files={reviewFiles} comments={t.comments} post={post}
            setStatus={async (f, status, e) => {
              if (status === 'pending') return;
              try { await api.post(`/portal/files/${f.id}/review`, { decision: status === 'approved' ? 'approve' : 'changes', note: status === 'changes' ? 'Please see my pinned comments.' : '' }); if (status === 'approved') celebrate('done', pointOf(e)); else toast.success('Sent to the team'); reload(); } catch (err) { toast.error(err.message); }
            }} />
        ) : (
          <CommentThread comments={t.comments.filter((c) => c.kind !== 'brief')} onPost={async (v) => post(toFormData(v))} emptyText="Ask a question or share feedback. You can paste screenshots too. The team gets it right away." />
        )}
        {otherFiles.length > 0 && (
          <div className="mt-6 border-t border-line pt-4">
            <h2 className="mb-2 text-sm font-semibold text-muted">Other files</h2>
            <ul className="space-y-1.5 text-sm">{otherFiles.map((f) => <li key={f.id}><a href={fileUrl(f.id)} className="inline-flex items-center gap-2 hover:text-cobalt"><Download size={14} />{f.name}<span className="text-xs text-muted">{bytes(f.size)}</span></a></li>)}</ul>
          </div>
        )}
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

export function PortalReview() {
  const { data, loading, reload } = useFetch('/portal/overview');
  useLive('task:changed', reload);
  if (loading || !data) return <PageLoader />;
  const files = data.reviewFiles || [];
  return (
    <div className="space-y-6">
      <div><h1 className="text-2xl font-semibold">Review</h1><p className="text-sm text-muted">Designs, videos and documents waiting for your feedback. Click on any part of an image or video frame to leave a pinned comment.</p></div>
      {data.awaitingReview.length > 0 && (
        <section className="panel p-5">
          <h2 className="mb-3 font-semibold">Deliverables waiting for sign-off</h2>
          <ul className="space-y-2">{data.awaitingReview.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-line p-3">
              <span className="h-2 w-2 rounded-full" style={{ background: t.project.color }} />
              <Link to={`/portal/tasks/${t.id}?tab=review`} className="min-w-0 flex-1"><span className="block font-medium hover:underline">{t.title}</span><span className="text-xs text-muted">{t.project.name}</span></Link>
              <ReviewButtons task={t} onDone={reload} />
            </li>
          ))}</ul>
        </section>
      )}
      {data.briefs?.length > 0 && (
        <section className="panel p-5">
          <h2 className="mb-1 font-semibold">Details to check</h2>
          <p className="mb-3 text-sm text-muted">Captions, scripts and briefs the team wants you to read before they go ahead.</p>
          <ul className="space-y-3">{data.briefs.map((t) => (
            <li key={t.id} className="rounded-xl border border-line p-4">
              <div className="mb-2 flex flex-wrap items-center gap-2"><span className="h-2 w-2 rounded-full" style={{ background: t.project.color }} /><Link to={`/portal/tasks/${t.id}`} className="font-medium hover:underline">{t.title}</Link><span className="text-xs text-muted">{t.project.name}</span></div>
              <div className="mb-3 line-clamp-4 rounded-lg bg-sunken/50 p-3 text-sm"><Markdown>{t.description}</Markdown></div>
              <BriefReview task={t} onDone={reload} compact />
            </li>
          ))}</ul>
        </section>
      )}
      {files.length ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {files.map((f) => (
            <Link key={f.id} to={`/portal/tasks/${f.task.id}?tab=review`} className="group overflow-hidden rounded-2xl border border-line bg-surface transition hover:shadow-lift">
              <div className="grid aspect-video place-items-center overflow-hidden bg-sunken">{/^image\//.test(f.mime || '') ? <img src={fileUrl(f.id)} alt="" className="h-full w-full object-cover transition group-hover:scale-105" loading="lazy" /> : /^video\//.test(f.mime || '') ? <Film size={30} className="text-muted" /> : <FileText size={30} className="text-muted" />}</div>
              <div className="p-4"><p className="truncate font-semibold">{f.task.title}</p><p className="truncate text-xs text-muted">{f.project?.name}, {f.name}, shared {ago(f.createdAt)}</p></div>
            </Link>
          ))}
        </div>
      ) : !data.awaitingReview.length && !data.briefs?.length && <div className="panel"><Empty icon={Eye} title="All caught up" body="When the team shares work for you to check, it shows up here." /></div>}
    </div>
  );
}

export function PortalProfile() {
  const { data, loading, reload } = useFetch('/portal/profile');
  const { user } = useAuth();
  const [answers, setAnswers] = useState(null);
  const [busy, setBusy] = useState(false);
  const [cat, setCat] = useState('document');
  const logoRef = useRef(null); const fileRef = useRef(null);
  useEffect(() => { if (data?.answers) setAnswers(data.answers); }, [data?.answers]);
  if (loading || !data || !answers) return <PageLoader />;
  const c = data.client;
  const save = async () => { setBusy(true); try { await api.patch('/portal/profile', { answers }); toast.success('Saved. The team can see your updates.'); reload(); } catch (err) { toast.error(err.message); } finally { setBusy(false); } };
  const upload = async (list, category) => {
    if (!list?.length) return;
    const fd = new FormData(); [...list].forEach((f) => fd.append('files', f)); fd.append('category', category);
    const tid = toast.loading('Uploading');
    try { await api.post('/portal/files', fd); toast.success(category === 'logo' ? 'Logo updated' : 'Uploaded', { id: tid }); reload(); } catch (err) { toast.error(err.message, { id: tid }); }
  };
  const remove = async (f) => { try { await api.delete(`/portal/files/${f.id}`); reload(); } catch (err) { toast.error(err.message); } };
  const LABEL = { logo: 'Logo', brand: 'Brand', document: 'Document', other: 'Other' };
  return (
    <div className="space-y-6">
      <section className="panel flex flex-wrap items-center gap-5 p-6">
        <button type="button" onClick={() => logoRef.current?.click()} className="group relative grid h-24 w-24 place-items-center overflow-hidden rounded-3xl border-2 border-dashed border-line bg-surface hover:border-faint" title="Change logo">
          {c.logo ? <img src={clientFileUrl(c.logo, true)} alt="Your logo" className="h-full w-full object-contain p-2" /> : <ImagePlus size={26} className="text-faint" />}
          <span className="absolute inset-x-0 bottom-0 bg-night/70 py-0.5 text-center text-[10px] font-semibold text-white opacity-0 transition group-hover:opacity-100">Change logo</span>
        </button>
        <input ref={logoRef} type="file" accept="image/*" hidden onChange={(e) => { upload(e.target.files, 'logo'); e.target.value = ''; }} />
        <div className="min-w-0 flex-1"><h1 className="text-2xl font-semibold">{c.name}</h1><p className="text-sm text-muted">{[c.industry, c.city].filter(Boolean).join(', ')}</p><p className="mt-1 text-xs text-muted">Signed in as {user.email}</p></div>
      </section>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <section className="panel p-5 sm:p-6">
          <div className="mb-5 flex items-center gap-2"><h2 className="font-semibold">Business details</h2><button type="button" className="btn-primary btn-sm ml-auto" onClick={save} disabled={busy}>{busy ? 'Saving' : 'Save changes'}</button></div>
          <OnboardingFields questions={data.questions} values={answers} onChange={setAnswers} savedSecrets={data.savedSecrets} />
          <div className="mt-6 flex justify-end"><button type="button" className="btn-primary" onClick={save} disabled={busy}>Save changes</button></div>
        </section>
        <section className="panel h-fit p-5">
          <div className="mb-3 flex items-center gap-2"><h2 className="font-semibold">Brand files and documents</h2></div>
          <div onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); upload(e.dataTransfer.files, cat); }} className="rounded-2xl border-2 border-dashed border-line p-4 text-center">
            <FileUp size={20} className="mx-auto text-faint" />
            <p className="mt-1 text-sm text-muted">Drop files or <button type="button" className="link" onClick={() => fileRef.current?.click()}>choose</button></p>
            <select className="input mx-auto mt-2 !w-auto !py-1 text-xs" value={cat} onChange={(e) => setCat(e.target.value)}><option value="document">Document</option><option value="brand">Brand guidelines, fonts, photos</option><option value="other">Other</option></select>
            <input ref={fileRef} type="file" multiple hidden onChange={(e) => { upload(e.target.files, cat); e.target.value = ''; }} />
          </div>
          <ul className="mt-3 space-y-1.5">
            {data.files.map((f) => (
              <li key={f.id} className="flex items-center gap-2.5 rounded-xl px-2 py-1.5 text-sm hover:bg-sunken/60">
                <span className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-lg bg-sunken">{/^image\//.test(f.mime) ? <img src={clientFileUrl(f.id, true)} alt="" className="h-full w-full object-cover" loading="lazy" /> : <FileText size={15} className="text-muted" />}</span>
                <span className="min-w-0 flex-1"><span className="block truncate font-medium">{f.originalName}</span><span className="text-[11px] text-muted">{LABEL[f.category]}, {bytes(f.size)}, {f.uploader ? (f.uploader.id === user.id ? 'you' : f.uploader.name) : 'at sign-up'}</span></span>
                <a href={clientFileUrl(f.id)} className="rounded p-1 text-muted hover:text-ink" aria-label="Download"><Download size={14} /></a>
                {f.uploader?.id === user.id && <button type="button" onClick={() => remove(f)} className="rounded p-1 text-muted hover:text-ember" aria-label="Remove"><X size={14} /></button>}
              </li>
            ))}
            {!data.files.length && <li className="py-2 text-sm text-muted">Nothing yet. Share your logo, brand guide, product photos or price list.</li>}
          </ul>
        </section>
      </div>
    </div>
  );
}
