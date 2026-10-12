import clsx from 'clsx';
import { Check } from 'lucide-react';
import { Field, PasswordInput } from './ui';

export const visibleQuestions = (questions, values) => questions.filter((q) => q.type !== 'file' && (!q.showIf || String(values[q.showIf.id] ?? '') === q.showIf.is));

/** Renders onboarding questions grouped by section. values: { [id]: string | string[] } */
export default function OnboardingFields({ questions, values, onChange, savedSecrets = [] }) {
  const qs = visibleQuestions(questions, values);
  const groups = [];
  qs.forEach((q) => { const g = q.section || ''; const last = groups[groups.length - 1]; if (last && last.name === g) last.items.push(q); else groups.push({ name: g, items: [q] }); });
  const set = (id, v) => onChange({ ...values, [id]: v });

  const input = (q) => {
    const v = values[q.id] ?? (q.type === 'multi' ? [] : '');
    switch (q.type) {
      case 'textarea': return <textarea className="input" rows={3} value={v} onChange={(e) => set(q.id, e.target.value)} required={q.required} />;
      case 'choice': return (
        <div className="flex flex-wrap gap-2">
          {(q.options || []).map((o) => (
            <button key={o} type="button" onClick={() => set(q.id, o)} className={clsx('rounded-full border px-3.5 py-1.5 text-sm font-semibold transition', v === o ? 'border-ink bg-ink text-surface' : 'border-line bg-surface text-muted hover:border-faint hover:text-ink')}>{o}</button>
          ))}
        </div>
      );
      case 'multi': return (
        <div className="flex flex-wrap gap-2">
          {(q.options || []).map((o) => {
            const on = v.includes(o);
            return <button key={o} type="button" onClick={() => set(q.id, on ? v.filter((x) => x !== o) : [...v, o])} className={clsx('inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-semibold transition', on ? 'border-ink bg-brand-soft text-ink' : 'border-line bg-surface text-muted hover:text-ink')}>{on && <Check size={13} />}{o}</button>;
          })}
        </div>
      );
      case 'secret': return <PasswordInput value={v} onChange={(e) => set(q.id, e.target.value)} autoComplete="off" placeholder={savedSecrets.includes(q.id) ? 'Saved. Type to replace it' : ''} />;
      case 'date': return <input type="date" className="input" value={v} onChange={(e) => set(q.id, e.target.value)} required={q.required} />;
      default: return <input type={['email', 'tel', 'url'].includes(q.type) ? q.type : 'text'} className="input" value={v} onChange={(e) => set(q.id, e.target.value)} required={q.required} placeholder={q.type === 'url' ? 'https://' : q.type === 'tel' ? '91 98765 43210' : ''} />;
    }
  };

  return (
    <div className="space-y-6">
      {groups.map((g, gi) => (
        <section key={gi} className="space-y-4">
          {g.name && <h3 className="border-b border-line pb-1.5 text-sm font-semibold text-muted">{g.name}</h3>}
          <div className="grid gap-4 sm:grid-cols-2">
            {g.items.map((q) => (
              <div key={q.id} className={['textarea', 'choice', 'multi'].includes(q.type) || q.label.length > 40 ? 'sm:col-span-2' : ''}>
                {['choice', 'multi'].includes(q.type) ? (
                  <div role="group" aria-label={q.label}><span className="label">{q.label}{q.required && <span className="text-ember"> *</span>}</span>{input(q)}{q.hint && <span className="mt-1 block text-[11px] text-faint">{q.hint}</span>}</div>
                ) : <Field label={<>{q.label}{q.required && <span className="text-ember"> *</span>}</>} hint={q.hint}>{input(q)}</Field>}
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
