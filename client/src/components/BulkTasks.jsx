// Bulk task import / export for one project: sample file from its pipeline stages,
// round-trip export (with dates and times), and CSV upload with column mapping.
import { useState } from 'react';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import { Download, Upload, FileSpreadsheet, FileDown, Check, AlertTriangle, Info, ArrowLeft } from 'lucide-react';
import api, { download } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { Modal, Spinner } from './ui';

export function parseCsv(text) {
  const rows = []; let row = []; let cell = ''; let q = false;
  const sep = (() => { const first = text.split(/\r?\n/, 1)[0] || ''; return (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ';' : ','; })();
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i += 1; } else q = false; } else cell += ch; } else if (ch === '"') q = true;
    else if (ch === sep) { row.push(cell); cell = ''; } else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i += 1; row.push(cell); rows.push(row); row = []; cell = ''; } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}

export const FIELD_LABEL = {
  key: 'Task key', title: 'Title', description: 'Description', stage: 'Stage', status: 'Status', priority: 'Priority', assignee: 'Assignees',
  start: 'Start date', due: 'Due date', due_time: 'Due time', estimate: 'Estimate hours', points: 'Story points', tags: 'Tags', parent: 'Parent task', client_visible: 'Client visible',
};
export const FIELDS = Object.keys(FIELD_LABEL);
const ALIASES = {
  key: ['key', 'taskkey', 'id', 'taskid'], title: ['title', 'task', 'name', 'taskname', 'summary'], description: ['description', 'details', 'notes'],
  stage: ['stage', 'section', 'group', 'list', 'column', 'pipeline', 'pipelinestage', 'board'], status: ['status', 'state'], priority: ['priority'],
  assignee: ['assignee', 'assignees', 'owner', 'assignedto', 'assigneeemails', 'assigneeemail'], start: ['start', 'startdate', 'startson'],
  due: ['due', 'duedate', 'deadline', 'enddate', 'dueon'], due_time: ['duetime', 'time', 'deadlinetime'], estimate: ['estimate', 'hours', 'estimatehours', 'estimateh'],
  points: ['storypoints', 'points', 'sp'], tags: ['tags', 'labels'], parent: ['parent', 'parenttask', 'parentkey'], client_visible: ['clientvisible', 'visibletoclient', 'client'],
};
export const guess = (h) => { const s = String(h).toLowerCase().replace(/[^a-z]/g, ''); return Object.keys(ALIASES).find((k) => ALIASES[k].includes(s)) || ''; };

/** Map header guesses; when two columns guess the same field keep the later one (e.g. "Assignee emails" over "Assignees"). */
export function guessAll(head) {
  const out = head.map(guess);
  out.forEach((f, i) => { if (f && out.indexOf(f, i + 1) > -1) out[i] = ''; });
  return out;
}

const HELP = [
  ['Key', 'Leave blank to add a task. Fill with a task key (from an export) to update that task.'],
  ['Stage', 'A pipeline stage of this project. New names become new stages.'],
  ['Status', 'To do, In progress, In review, Blocked or Done.'],
  ['Dates', 'YYYY-MM-DD, DD/MM/YYYY or 15 Oct 2026.'],
  ['Due time', '18:00 or 6 PM, India time. Blank means 6 PM.'],
  ['Assignees', 'Emails or names, separated by ;'],
  ['Parent task', 'Title of an earlier row or an existing task key, to make a subtask.'],
];

export function ProjectBulkTasks({ open, onClose, project, onDone }) {
  const { can } = useAuth();
  const [csv, setCsv] = useState(null);
  const [mapping, setMapping] = useState([]);
  const [busy, setBusy] = useState('');
  const [check, setCheck] = useState(null);
  const [result, setResult] = useState(null);
  const stamp = new Date().toISOString().slice(0, 10);
  const stages = (project.Sections || []).slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  const reset = () => { setCsv(null); setMapping([]); setCheck(null); setResult(null); };
  const close = () => { reset(); onClose(); };
  const dl = async (what) => {
    setBusy(what);
    try {
      if (what === 'sample') await download(`/tools/projects/${project.id}/sample.csv`, `${project.code}-sample-import.csv`);
      else await download(`/tools/projects/${project.id}/tasks.csv`, `${project.code}-tasks-${stamp}.csv`);
    } catch (e) { toast.error(e.message); } finally { setBusy(''); }
  };
  const onFile = async (e) => {
    const f = e.target.files?.[0] || e.dataTransfer?.files?.[0]; if (!f) return;
    if (!/\.(csv|txt)$/i.test(f.name)) { toast.error('Save the sheet as CSV first (File > Save as > CSV UTF-8).'); return; }
    const rows = parseCsv((await f.text()).replace(/^﻿/, ''));
    if (rows.length < 2) { toast.error('That file has no data rows.'); return; }
    setCsv({ name: f.name, head: rows[0], rows: rows.slice(1) }); setMapping(guessAll(rows[0])); setCheck(null); setResult(null);
    if (e.target?.value) e.target.value = '';
  };
  const payload = () => csv.rows.map((r) => Object.fromEntries(mapping.map((k, i) => [k, r[i]]).filter(([k]) => k)));
  const send = async (dryRun) => {
    if (!mapping.includes('title') && !mapping.includes('key')) { toast.error('Map one column to Title.'); return; }
    setBusy(dryRun ? 'check' : 'import');
    try {
      const { data } = await api.post('/tools/import/tasks', { projectId: project.id, rows: payload(), dryRun });
      if (dryRun) setCheck(data);
      else {
        setResult(data); setCheck(null);
        toast.success([data.created && `${data.created} added`, data.updated && `${data.updated} updated`].filter(Boolean).join(', ') || 'Nothing changed');
        onDone?.();
      }
    } catch (err) { toast.error(err.message); } finally { setBusy(''); }
  };
  const used = new Set(mapping.filter(Boolean));

  const footer = csv && !result ? (
    <>
      <button type="button" className="btn-ghost mr-auto" onClick={reset}><ArrowLeft size={14} />Back</button>
      <button type="button" className="btn-ghost" disabled={!!busy} onClick={() => send(true)}>{busy === 'check' && <Spinner size={14} />}Check file</button>
      <button type="button" className="btn-primary" disabled={!!busy || !can('tasks.create')} onClick={() => send(false)}>{busy === 'import' ? <Spinner size={14} className="text-ink" /> : <Upload size={15} />}Import {csv.rows.length} rows</button>
    </>
  ) : <button type="button" className="btn-ghost" onClick={close}>Close</button>;

  return (
    <Modal open={open} onClose={close} width="max-w-4xl" title="Bulk import and export" subtitle={`${project.code} ${project.name}`} footer={footer}>
      {!csv && (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-line p-4">
              <div className="flex items-center gap-2 font-semibold"><FileDown size={16} />Sample file</div>
              <p className="mt-1 text-sm text-muted">A ready CSV for this project, with one example row per pipeline stage, dates from today and due times.</p>
              {stages.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{stages.map((s) => <span key={s.id} className="chip" style={{ background: `${s.color}1F`, color: s.color }}>{s.name}</span>)}</div>}
              <button type="button" className="btn-ghost btn-sm mt-3" disabled={!!busy} onClick={() => dl('sample')}>{busy === 'sample' ? <Spinner size={13} /> : <Download size={14} />}Download sample</button>
            </div>
            <div className="rounded-2xl border border-line p-4">
              <div className="flex items-center gap-2 font-semibold"><FileSpreadsheet size={16} />Export tasks</div>
              <p className="mt-1 text-sm text-muted">Every task you can see in this project, with stage, assignees, start date, due date and time, created and completed times.</p>
              <p className="mt-2 text-xs text-faint">Edit it in Excel or Google Sheets and import it back to update tasks in bulk.</p>
              <button type="button" className="btn-ghost btn-sm mt-3" disabled={!!busy} onClick={() => dl('export')}>{busy === 'export' ? <Spinner size={13} /> : <Download size={14} />}Export CSV</button>
            </div>
          </div>
          {can('tasks.create') ? (
            <label onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); onFile(e); }}
              className="grid cursor-pointer place-items-center rounded-2xl border-2 border-dashed border-line px-6 py-10 text-center transition hover:border-muted hover:bg-sunken/40">
              <Upload size={26} className="text-muted" />
              <p className="mt-2 font-semibold">Import a CSV into {project.code}</p>
              <p className="mt-1 text-sm text-muted">Drop the file here or click to choose. From Excel, save as CSV UTF-8.</p>
              <input type="file" accept=".csv,text/csv" className="hidden" onChange={onFile} />
            </label>
          ) : <p className="text-sm text-muted">Your role can export but not import tasks.</p>}
          <div className="rounded-xl bg-sunken/50 p-3">
            <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted"><Info size={13} />How the columns work</p>
            <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">{HELP.map(([k, v]) => <div key={k}><dt className="inline font-semibold">{k}: </dt><dd className="inline text-muted">{v}</dd></div>)}</dl>
          </div>
        </div>
      )}

      {csv && !result && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-sm"><FileSpreadsheet size={16} className="text-muted" /><span className="font-semibold">{csv.name}</span><span className="text-muted">{csv.rows.length} rows</span></div>
          <p className="text-xs text-muted">Check that each column points to the right field. Columns set to Skip are ignored.</p>
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full text-sm">
              <thead className="bg-sunken/60"><tr>{csv.head.map((h, i) => (
                <th key={i} className="min-w-[130px] p-2 text-left align-top">
                  <div className="mb-1 truncate text-xs font-semibold text-muted">{h || `Column ${i + 1}`}</div>
                  <select className="input !py-1 text-xs" value={mapping[i]} onChange={(e) => { setCheck(null); setMapping((m) => m.map((x, j) => (j === i ? e.target.value : x))); }}>
                    <option value="">Skip</option>
                    {FIELDS.map((f) => <option key={f} value={f} disabled={used.has(f) && mapping[i] !== f}>{FIELD_LABEL[f]}</option>)}
                  </select>
                </th>
              ))}</tr></thead>
              <tbody>{csv.rows.slice(0, 5).map((r, i) => <tr key={i} className="border-t border-line">{csv.head.map((_, j) => <td key={j} className={clsx('max-w-[200px] truncate p-2', !mapping[j] && 'text-faint')}>{r[j]}</td>)}</tr>)}</tbody>
            </table>
          </div>
          {csv.rows.length > 5 && <p className="text-xs text-muted">Showing 5 of {csv.rows.length} rows.</p>}
          {check && <Outcome data={check} preview />}
        </div>
      )}

      {result && (
        <div className="space-y-4">
          <Outcome data={result} />
          <div className="flex gap-2"><button type="button" className="btn-ghost" onClick={reset}>Import another file</button></div>
        </div>
      )}
    </Modal>
  );
}

function Outcome({ data, preview }) {
  const bad = data.errors.length > 0;
  return (
    <div className={clsx('rounded-xl p-3 text-sm', bad ? 'bg-amber/10' : 'bg-leaf/10')}>
      <p className="flex items-center gap-2 font-semibold">{bad ? <AlertTriangle size={15} /> : <Check size={15} />}
        {preview ? 'Ready to import: ' : ''}{data.created} {preview ? 'new' : 'added'}, {data.updated} {preview ? 'to update' : 'updated'}{bad ? `, ${data.errors.length} rows skipped` : ''}
      </p>
      {data.newStages?.length > 0 && <p className="mt-1 text-xs text-muted">New stages {preview ? 'will be' : 'were'} added: {data.newStages.join(', ')}</p>}
      {bad && <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs">{data.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>}
      {data.warnings?.length > 0 && <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-muted">{data.warnings.map((e, i) => <li key={i}>{e}</li>)}</ul>}
    </div>
  );
}
