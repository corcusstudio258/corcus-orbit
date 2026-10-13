// One-time import of the SyncUpp boards (as projects), team members and open tasks.
// Runs at boot; a Setting marks it done so it never runs twice. Team members that don't
// exist yet are added without a password and without any email, so they can be invited later.
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { sequelize, Setting, User, Role, Project, Section, ProjectMember, Task } = require('../models');
const { createTaskRecord } = require('../services/taskFactory');

const KEY = 'import:syncupp:v1';
const PALETTE = ['#3D5AFE', '#1FA971', '#C76A00', '#8B5CF6', '#E5484D', '#0EA5B7', '#D946EF', '#64748B'];

async function run() {
  if (await Setting.findOne({ where: { key: KEY } })) return null;
  const data = require('../data/syncupp-import.json');
  const admin = await User.findOne({ include: [{ model: Role, where: { slug: 'admin' } }], order: [['id', 'ASC']] });
  if (!admin) return null; // fresh install with no admin yet: try again next boot
  const memberRole = (await Role.findOne({ where: { slug: 'executive' } })) || (await Role.findOne({ where: { isClientRole: false }, order: [['level', 'DESC']] }));

  const summary = { projects: 0, tasks: 0, people: 0 };
  await sequelize.transaction(async (tx) => {
    // People: reuse by email, otherwise add a teammate who still needs an invite.
    const byEmail = {};
    let i = 0;
    for (const [email, name] of Object.entries(data.people)) {
      let u = await User.findOne({ where: { email: email.toLowerCase() }, transaction: tx });
      if (!u) {
        u = await User.create({
          name, email: email.toLowerCase(), roleId: memberRole.id, color: PALETTE[i % PALETTE.length],
          passwordHash: await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 10),
          designation: 'Team member',
        }, { transaction: tx });
        summary.people += 1;
      }
      byEmail[email.toLowerCase()] = u;
      i += 1;
    }

    for (const b of data.boards) {
      let code = b.code;
      for (let n = 2; await Project.findOne({ where: { code }, transaction: tx }); n += 1) code = `${b.code}${n}`;
      const p = await Project.create({
        name: b.name, code, icon: b.icon, color: b.color, status: 'active', ownerId: admin.id,
        description: `Imported from SyncUpp (${b.doneCount} completed tasks there).`,
        pipeline: { review: true, done: true, archive: true },
      }, { transaction: tx });
      await Section.bulkCreate([
        { projectId: p.id, name: 'To do', color: '#5B6386', order: 0 },
        { projectId: p.id, name: 'In progress', color: '#3D5AFE', order: 1 },
      ], { transaction: tx });
      const memberIds = [...new Set([admin.id, ...b.members.map((e) => byEmail[e.toLowerCase()]?.id).filter(Boolean)])];
      await ProjectMember.bulkCreate(memberIds.map((userId) => ({ projectId: p.id, userId, role: userId === admin.id ? 'lead' : 'member' })), { transaction: tx, ignoreDuplicates: true });
      summary.projects += 1;

      const assigneeIds = (b.taskAssignees || []).map((e) => byEmail[e.toLowerCase()]?.id).filter(Boolean);
      for (const t of b.tasks) {
        await createTaskRecord({ title: t.title, projectId: p.id, dueDate: t.due, priority: t.priority, status: 'todo', assigneeIds }, admin.id, { transaction: tx });
        summary.tasks += 1;
      }
    }
    await Setting.create({ key: KEY, value: { at: new Date().toISOString(), ...summary } }, { transaction: tx });
  });
  console.log(`[import] SyncUpp: ${summary.projects} projects, ${summary.tasks} open tasks, ${summary.people} new teammates`);
  return summary;
}

module.exports = { run, KEY };
