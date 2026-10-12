// Keeps the database schema in step with the models.
// New tables are always created; existing tables are altered once per SCHEMA_VERSION bump
// (running `alter` on every boot makes MySQL pile up duplicate indexes).
const { sequelize, Setting } = require('../models');

const SCHEMA_VERSION = 3;

/** One-off data changes that go with a schema version. */
const DATA_STEPS = {
  3: async () => {
    const { Project, Section, Task, Role } = require('../models');
    // Every project gets a pipeline: at least two working stages.
    for (const p of await Project.findAll()) {
      let secs = await Section.findAll({ where: { projectId: p.id }, order: [['order', 'ASC']] });
      if (!secs.length) {
        secs = [await Section.create({ projectId: p.id, name: 'To do', color: '#5B6386', order: 0 }),
          await Section.create({ projectId: p.id, name: 'In progress', color: '#3D5AFE', order: 1 })];
      }
      const first = secs[0]; const working = secs[1] || secs[0];
      await Task.update({ sectionId: first.id }, { where: { projectId: p.id, sectionId: null, status: ['backlog', 'todo'] } });
      await Task.update({ sectionId: working.id }, { where: { projectId: p.id, sectionId: null, status: ['in_progress', 'blocked'] } });
      if (!p.pipeline) { p.pipeline = { review: true, done: true, archive: true }; await p.save(); }
    }
    // New permissions: staff keep what they could do before.
    const { ALL } = require('./permissions');
    for (const r of await Role.findAll()) {
      if (r.isClientRole) continue;
      const perms = new Set(r.permissions || []);
      perms.add('ai.use');
      if (perms.has('users.manage') || perms.has('dashboard.team')) perms.add('attendance.manage');
      if (perms.has('settings.manage') || perms.has('projects.manage')) { perms.add('automations.manage'); perms.add('templates.manage'); perms.add('projects.budget'); }
      if (perms.has('users.manage')) perms.add('users.invite');
      if (r.slug === 'admin') ALL.forEach((k) => perms.add(k));
      r.permissions = [...perms]; await r.save();
    }
  },
};

async function migrate() {
  await sequelize.sync(); // creates missing tables, leaves existing ones alone
  const row = await Setting.findOne({ where: { key: 'schemaVersion' } });
  const current = Number(row?.value || 1);
  if (current < SCHEMA_VERSION || process.env.DB_ALTER === '1') {
    console.log(`[migrate] updating schema ${current} → ${SCHEMA_VERSION}`);
    await sequelize.sync({ alter: true });
    for (let v = current + 1; v <= SCHEMA_VERSION; v += 1) {
      if (DATA_STEPS[v]) { console.log(`[migrate] data step ${v}`); await DATA_STEPS[v](); }
    }
    if (row) { row.value = SCHEMA_VERSION; await row.save(); } else await Setting.create({ key: 'schemaVersion', value: SCHEMA_VERSION });
  }
}

module.exports = { migrate, SCHEMA_VERSION, DATA_STEPS };
