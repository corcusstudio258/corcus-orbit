import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Plus, Lock, Trash2, ShieldCheck } from 'lucide-react';
import clsx from 'clsx';
import api from '../lib/api';
import useFetch from '../lib/useFetch';
import { useAuth } from '../context/AuthContext';
import { PageLoader, Field, ColorPicker } from '../components/ui';

export default function Roles() {
  const { user } = useAuth();
  const { data: roles, reload } = useFetch('/roles');
  const { data: perms } = useFetch('/auth/permissions');
  const [sel, setSel] = useState(null);
  const [f, setF] = useState(null);

  useEffect(() => {
    if (!roles) return;
    const r = sel === 'new' ? null : roles.find((x) => x.id === sel) || roles.find((x) => !x.isSystem) || roles[0];
    if (sel !== 'new' && r && sel !== r.id) setSel(r.id);
    setF(sel === 'new' ? { name: '', description: '', level: Math.max(user.Role.level + 1, 3), color: '#3DE0F2', permissions: ['tasks.create'] } : r ? { ...r } : null);
  }, [roles, sel]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!roles || !perms || !f) return <PageLoader />;
  const groups = [...new Set(perms.map((p) => p.group))];
  const locked = !!f.isSystem;
  const toggle = (k) => !locked && setF((s) => ({ ...s, permissions: s.permissions.includes(k) ? s.permissions.filter((x) => x !== k) : [...s.permissions, k] }));
  const save = async () => {
    try {
      if (sel === 'new') { const { data } = await api.post('/roles', f); toast.success(`Role “${data.name}” created`); await reload(); setSel(data.id); } else { await api.patch(`/roles/${f.id}`, f); toast.success('Role saved'); reload(); }
    } catch (e) { toast.error(e.message); }
  };
  const remove = async () => {
    if (!window.confirm(`Delete the role “${f.name}”?`)) return;
    try { await api.delete(`/roles/${f.id}`); toast.success('Role deleted'); setSel(null); reload(); } catch (e) { toast.error(e.message); }
  };

  return (
    <div className="space-y-5">
      <div><h1 className="text-2xl font-semibold">Roles & access</h1><p className="text-sm text-mist">Build any hierarchy you need. Lower level number means more senior; people can only manage roles below their own level.</p></div>
      <div className="grid gap-5 lg:grid-cols-[300px_1fr]">
        <div className="space-y-2">
          {roles.map((r) => (
            <button type="button" key={r.id} onClick={() => setSel(r.id)} className={clsx('flex w-full items-center gap-3 rounded-xl border p-3 text-left transition', sel === r.id ? 'border-signal/50 bg-signal/[0.06]' : 'border-line bg-space-2/50 hover:border-line hover:bg-white/[0.04]')}>
              <span className="grid h-8 w-8 place-items-center rounded-lg font-display text-xs font-bold text-space" style={{ background: r.color }}>{r.level}</span>
              <span className="min-w-0 flex-1"><span className="flex items-center gap-1.5 font-semibold">{r.name}{r.isSystem && <Lock size={12} className="text-mist" />}</span><span className="block truncate text-xs text-mist">{r.userCount} people</span></span>
            </button>
          ))}
          <button type="button" onClick={() => setSel('new')} className={clsx('flex w-full items-center gap-2 rounded-xl border border-dashed p-3 text-sm font-semibold', sel === 'new' ? 'border-signal text-signal' : 'border-line text-mist hover:text-star')}><Plus size={16} />New role</button>
        </div>

        <section className="panel p-5 sm:p-6">
          {locked && <div className="mb-5 flex items-center gap-2 rounded-xl bg-white/[0.04] px-3 py-2 text-xs text-mist"><Lock size={13} />Built-in role. {f.isClientRole ? 'Clients only ever see the client portal.' : 'Admins always have every permission.'}</div>}
          <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
            <Field label="Role name"><input className="input" disabled={locked} value={f.name} onChange={(e) => setF((s) => ({ ...s, name: e.target.value }))} placeholder="e.g. Senior Designer" /></Field>
            <Field label="Level" hint="1 = top"><input type="number" min={1} max={98} disabled={locked} className="input" value={f.level} onChange={(e) => setF((s) => ({ ...s, level: e.target.value }))} /></Field>
            <Field label="What this role does" className="sm:col-span-2"><input className="input" value={f.description || ''} onChange={(e) => setF((s) => ({ ...s, description: e.target.value }))} /></Field>
            <Field label="Colour" className="sm:col-span-2"><ColorPicker value={f.color} onChange={(c) => setF((s) => ({ ...s, color: c }))} /></Field>
          </div>
          {!f.isClientRole && (
            <div className="mt-6 space-y-5">
              {groups.map((g) => (
                <div key={g}>
                  <h3 className="mb-2 text-sm font-semibold text-mist">{g}</h3>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {perms.filter((p) => p.group === g).map((p) => {
                      const on = f.permissions.includes(p.key);
                      return (
                        <button type="button" key={p.key} onClick={() => toggle(p.key)} disabled={locked}
                          className={clsx('flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left text-sm transition', on ? 'border-signal/40 bg-signal/[0.07]' : 'border-line bg-white/[0.02]', !locked && 'hover:border-signal/40')}>
                          <span className={clsx('grid h-5 w-5 shrink-0 place-items-center rounded-md border', on ? 'border-signal bg-signal text-space' : 'border-mist/50')}>{on && <ShieldCheck size={12} />}</span>{p.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="mt-6 flex justify-between gap-2 border-t border-line pt-4">
            {!locked && sel !== 'new' ? <button type="button" className="btn-danger" onClick={remove}><Trash2 size={15} />Delete role</button> : <span />}
            <button type="button" className="btn-primary" onClick={save}>{sel === 'new' ? 'Create role' : 'Save role'}</button>
          </div>
        </section>
      </div>
    </div>
  );
}
