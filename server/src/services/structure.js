// Turns a template / AI plan structure into real sections, milestones and task trees inside a project.
const { Section, Milestone, Task, ChecklistItem } = require('../models');
const { createTaskRecord } = require('./taskFactory');

const addDays = (base, n) => { const d = new Date(base); d.setDate(d.getDate() + Number(n || 0)); return d; };
const dateOnly = (d) => new Date(d).toISOString().slice(0, 10);

/**
 * structure: {
 *   sections: [{ name, color }],
 *   milestones: [{ title, offsetDays }],
 *   tasks: [{ title, description, section, priority, offsetDays, durationDays, estimateHours, storyPoints, tags, checklist, subtasks: [...] }]
 * }
 */
async function applyStructure(project, structure, actorId, { startDate, assigneeIds = [], clientVisible = false } = {}) {
  const start = startDate ? new Date(startDate) : (project.startDate ? new Date(project.startDate) : new Date());
  const sectionIds = {};
  let order = await Section.count({ where: { projectId: project.id } });
  for (const s of structure.sections || []) {
    if (!s?.name) continue;
    const [sec] = await Section.findOrCreate({ where: { projectId: project.id, name: s.name }, defaults: { color: s.color || '#5E6787', order: order++ } });
    sectionIds[s.name] = sec.id;
  }
  const msByTitle = {};
  let mOrder = await Milestone.count({ where: { projectId: project.id } });
  for (const m of structure.milestones || []) {
    if (!m?.title) continue;
    const row = await Milestone.create({ projectId: project.id, title: m.title, dueDate: m.offsetDays != null ? dateOnly(addDays(start, m.offsetDays)) : null, order: mOrder++ });
    msByTitle[m.title] = row.id;
  }
  let created = 0;
  const make = async (t, parentId) => {
    if (!t?.title) return;
    const due = t.offsetDays != null ? addDays(start, t.offsetDays) : null;
    if (due) due.setHours(18, 0, 0, 0);
    const begin = due && t.durationDays ? dateOnly(addDays(due, -Number(t.durationDays))) : null;
    const row = await createTaskRecord({
      title: t.title, description: t.description || '', projectId: parentId ? undefined : project.id, parentId,
      sectionId: !parentId ? sectionIds[t.section] || null : undefined, priority: t.priority || 'medium',
      dueDate: due, startDate: begin, estimateHours: t.estimateHours || null, storyPoints: t.storyPoints || null,
      tags: t.tags || [], checklist: t.checklist || [], milestoneId: msByTitle[t.milestone] || null,
      assigneeIds: t.assigneeIds || assigneeIds, clientVisible: t.clientVisible ?? clientVisible,
    }, actorId);
    created += 1;
    for (const st of t.subtasks || []) await make(typeof st === 'string' ? { title: st } : st, row.id);
  };
  for (const t of structure.tasks || []) await make(t, null);
  return { created, sections: Object.keys(sectionIds).length, milestones: Object.keys(msByTitle).length };
}

/** Snapshot a live project into a template structure (dates become offsets from the project start). */
async function snapshotProject(project) {
  const start = project.startDate ? new Date(project.startDate) : new Date(project.createdAt);
  const offset = (d) => (d ? Math.round((new Date(d) - start) / 864e5) : null);
  const sections = await Section.findAll({ where: { projectId: project.id }, order: [['order', 'ASC']], raw: true });
  const milestones = await Milestone.findAll({ where: { projectId: project.id }, order: [['order', 'ASC']], raw: true });
  const tasks = await Task.findAll({ where: { projectId: project.id, archived: false }, order: [['position', 'ASC']], raw: true });
  const checklists = await ChecklistItem.findAll({ where: { taskId: tasks.map((t) => t.id) }, order: [['position', 'ASC']], raw: true });
  const secName = Object.fromEntries(sections.map((s) => [s.id, s.name]));
  const msName = Object.fromEntries(milestones.map((m) => [m.id, m.title]));
  const node = (t) => ({
    title: t.title, description: t.description || '', section: secName[t.sectionId], priority: t.priority,
    offsetDays: offset(t.dueDate), durationDays: t.startDate && t.dueDate ? Math.max(0, Math.round((new Date(t.dueDate) - new Date(t.startDate)) / 864e5)) : null,
    estimateHours: t.estimateHours, storyPoints: t.storyPoints, milestone: msName[t.milestoneId],
    tags: (() => { try { return JSON.parse(t.tags || '[]'); } catch { return []; } })(),
    checklist: checklists.filter((c) => c.taskId === t.id).map((c) => c.text),
    subtasks: tasks.filter((x) => x.parentId === t.id).map(node),
  });
  return {
    sections: sections.map((s) => ({ name: s.name, color: s.color })),
    milestones: milestones.map((m) => ({ title: m.title, offsetDays: offset(m.dueDate) })),
    tasks: tasks.filter((t) => !t.parentId).map(node),
  };
}

const countTasks = (structure) => {
  const walk = (ts) => (ts || []).reduce((n, t) => n + 1 + walk(t.subtasks), 0);
  return walk(structure?.tasks);
};

module.exports = { applyStructure, snapshotProject, countTasks };
