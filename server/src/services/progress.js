// Progress is computed from the "leaf" tasks (tasks with no subtasks) so deep task trees roll up correctly.
const WEIGHT = { done: 1, review: 0.85, in_progress: 0.45, blocked: 0.2, todo: 0 };

function buildChildren(tasks) {
  const children = new Map();
  tasks.forEach((t) => {
    const p = t.parentId || 0;
    if (!children.has(p)) children.set(p, []);
    children.get(p).push(t);
  });
  return children;
}

function leavesUnder(id, children) {
  const kids = children.get(id) || [];
  if (!kids.length) return null;
  return kids.flatMap((k) => leavesUnder(k.id, children) || [k]);
}

/** Returns Map(taskId -> 0..100) for every task in the list. */
function taskProgressMap(tasks) {
  const children = buildChildren(tasks);
  const map = new Map();
  tasks.forEach((t) => {
    const leaves = leavesUnder(t.id, children);
    if (!leaves) map.set(t.id, Math.round((WEIGHT[t.status] ?? 0) * 100));
    else map.set(t.id, Math.round((leaves.reduce((s, l) => s + (WEIGHT[l.status] ?? 0), 0) / leaves.length) * 100));
  });
  return map;
}

/** Project progress 0..100 from all its tasks. */
function projectProgress(tasks) {
  if (!tasks.length) return 0;
  const children = buildChildren(tasks);
  const leaves = tasks.filter((t) => !(children.get(t.id) || []).length);
  return Math.round((leaves.reduce((s, l) => s + (WEIGHT[l.status] ?? 0), 0) / leaves.length) * 100);
}

module.exports = { taskProgressMap, projectProgress, WEIGHT };
