// Keeps the database schema in step with the models.
// New tables are always created; existing tables are altered once per SCHEMA_VERSION bump
// (running `alter` on every boot makes MySQL pile up duplicate indexes).
const { sequelize, Setting } = require('../models');

const SCHEMA_VERSION = 2;

async function migrate() {
  await sequelize.sync(); // creates missing tables, leaves existing ones alone
  const row = await Setting.findOne({ where: { key: 'schemaVersion' } });
  const current = Number(row?.value || 1);
  if (current < SCHEMA_VERSION || process.env.DB_ALTER === '1') {
    console.log(`[migrate] updating schema ${current} → ${SCHEMA_VERSION}`);
    await sequelize.sync({ alter: true });
    if (row) { row.value = SCHEMA_VERSION; await row.save(); } else await Setting.create({ key: 'schemaVersion', value: SCHEMA_VERSION });
  }
}

module.exports = { migrate, SCHEMA_VERSION };
