// First-boot content: #general channel, built-in templates and starter automations.
const { Template, Automation, Channel, User, Role } = require('../models');
const TEMPLATES = require('./templates');
const { DEFAULT_RULES } = require('../services/automations');

async function ensureDefaults() {
  const admin = await User.findOne({ include: [{ model: Role, where: { slug: 'admin' } }], order: [['id', 'ASC']] });
  if (!(await Channel.findOne({ where: { kind: 'channel', name: 'general' } }))) {
    await Channel.create({ name: 'general', description: 'Company-wide announcements and chat', kind: 'channel', createdById: admin?.id || null });
  }
  for (const t of TEMPLATES) {
    const exists = await Template.findOne({ where: { name: t.name, isSystem: true } });
    if (!exists) await Template.create({ ...t, isSystem: true, createdById: admin?.id || null });
  }
  if (!(await Automation.count()) && admin) {
    for (const r of DEFAULT_RULES) await Automation.create({ ...r, createdById: admin.id, active: true });
  }
}

module.exports = { ensureDefaults };
