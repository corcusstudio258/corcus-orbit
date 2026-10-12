// Team chat: public channels, private channels and 1:1 direct messages.
const router = require('express').Router();
const { Op } = require('sequelize');
const { Channel, ChannelMember, Message, User, Role, Task } = require('../models');
const { staffOnly } = require('../middleware/auth');
const { notify } = require('../services/notify');
const socket = require('../services/socket');

router.use(staffOnly);
const wrap = (f) => (req, res) => f(req, res).catch((e) => res.status(e.status || 500).json({ error: e.message }));
const userAttrs = ['id', 'name', 'color', 'designation', 'lastSeenAt'];

async function canAccess(req, channel) {
  if (!channel) return false;
  if (channel.kind === 'channel' && !channel.isPrivate) return true;
  return !!(await ChannelMember.findOne({ where: { channelId: channel.id, userId: req.user.id } }));
}

async function audience(channel) {
  if (channel.kind === 'channel' && !channel.isPrivate) return null; // everyone on staff
  return (await ChannelMember.findAll({ where: { channelId: channel.id }, raw: true })).map((m) => m.userId);
}

async function emitTo(channel, event, data) {
  const ids = await audience(channel);
  if (ids) socket.toUsers(ids, event, data); else socket.toStaff(event, data);
}

async function ensureGeneral(ownerId) {
  const exists = await Channel.findOne({ where: { kind: 'channel', name: 'general' } });
  if (exists) return exists;
  return Channel.create({ name: 'general', description: 'Company-wide announcements and chat', kind: 'channel', createdById: ownerId || null });
}

router.get('/channels', wrap(async (req, res) => {
  await ensureGeneral(req.user.id);
  const memberships = await ChannelMember.findAll({ where: { userId: req.user.id }, raw: true });
  const memberOf = memberships.map((m) => m.channelId);
  const channels = await Channel.findAll({
    where: { [Op.or]: [{ kind: 'channel', isPrivate: false }, { id: memberOf }] },
    include: [{ model: User, as: 'members', attributes: userAttrs, through: { attributes: [] } }],
    order: [['lastMessageAt', 'DESC'], ['name', 'ASC']],
  });
  const out = [];
  for (const c of channels) {
    const m = memberships.find((x) => x.channelId === c.id);
    const since = m?.lastReadAt || req.user.createdAt;
    const unread = await Message.count({ where: { channelId: c.id, userId: { [Op.ne]: req.user.id }, createdAt: { [Op.gt]: since } } });
    const last = await Message.findOne({ where: { channelId: c.id }, order: [['createdAt', 'DESC']], include: [{ model: User, as: 'author', attributes: ['id', 'name'] }] });
    const other = c.kind === 'dm' ? c.members.find((x) => x.id !== req.user.id) : null;
    out.push({
      id: c.id, kind: c.kind, name: c.kind === 'dm' ? other?.name || 'Direct message' : c.name, description: c.description, isPrivate: c.isPrivate,
      other, memberCount: c.kind === 'channel' && !c.isPrivate ? null : c.members.length, members: c.members.slice(0, 8),
      unread, lastMessage: last ? { body: last.body.slice(0, 120), author: last.author?.name, createdAt: last.createdAt } : null,
      lastMessageAt: c.lastMessageAt, projectId: c.projectId,
    });
  }
  res.json(out);
}));

router.post('/channels', wrap(async (req, res) => {
  const name = String(req.body.name || '').trim().toLowerCase().replace(/[^a-z0-9-_ ]/g, '').replace(/\s+/g, '-').slice(0, 40);
  if (!name) return res.status(400).json({ error: 'Give the channel a name.' });
  if (await Channel.findOne({ where: { kind: 'channel', name } })) return res.status(400).json({ error: `#${name} already exists.` });
  const c = await Channel.create({ name, description: req.body.description || '', isPrivate: !!req.body.isPrivate, kind: 'channel', createdById: req.user.id, projectId: req.body.projectId || null });
  const ids = [...new Set([req.user.id, ...(req.body.memberIds || []).map(Number)])];
  if (c.isPrivate) await c.setMembers(ids);
  else await ChannelMember.findOrCreate({ where: { channelId: c.id, userId: req.user.id } });
  await emitTo(c, 'chat:channel', { id: c.id });
  res.status(201).json(c);
}));

router.patch('/channels/:id', wrap(async (req, res) => {
  const c = await Channel.findByPk(req.params.id);
  if (!c || c.kind !== 'channel') return res.status(404).json({ error: 'Channel not found.' });
  if (c.createdById !== req.user.id && !req.can('settings.manage')) return res.status(403).json({ error: 'Only the creator or an admin can edit this channel.' });
  if (req.body.description !== undefined) c.description = req.body.description;
  if (req.body.name && c.name !== 'general') c.name = String(req.body.name).toLowerCase().replace(/[^a-z0-9-_]/g, '-').slice(0, 40);
  await c.save();
  if (Array.isArray(req.body.memberIds) && c.isPrivate) await c.setMembers([...new Set([req.user.id, ...req.body.memberIds.map(Number)])]);
  await emitTo(c, 'chat:channel', { id: c.id });
  res.json(c);
}));

router.delete('/channels/:id', wrap(async (req, res) => {
  const c = await Channel.findByPk(req.params.id);
  if (!c || c.kind !== 'channel' || c.name === 'general') return res.status(400).json({ error: "This channel can't be deleted." });
  if (c.createdById !== req.user.id && !req.can('settings.manage')) return res.status(403).json({ error: 'Only the creator or an admin can delete this channel.' });
  await Message.destroy({ where: { channelId: c.id } });
  await ChannelMember.destroy({ where: { channelId: c.id } });
  await c.destroy();
  socket.toStaff('chat:channel', { id: c.id, deleted: true });
  res.json({ ok: true });
}));

// Find or open a DM
router.post('/dm', wrap(async (req, res) => {
  const other = await User.findByPk(req.body.userId, { include: [Role] });
  if (!other || other.Role?.isClientRole || other.id === req.user.id) return res.status(400).json({ error: 'Pick a teammate.' });
  const key = [req.user.id, other.id].sort((a, b) => a - b).join(':');
  let c = await Channel.findOne({ where: { dmKey: key } });
  if (!c) { c = await Channel.create({ kind: 'dm', dmKey: key, isPrivate: true, createdById: req.user.id }); await c.setMembers([req.user.id, other.id]); }
  res.json({ id: c.id });
}));

router.get('/channels/:id/messages', wrap(async (req, res) => {
  const c = await Channel.findByPk(req.params.id);
  if (!(await canAccess(req, c))) return res.status(404).json({ error: 'Channel not found.' });
  const where = { channelId: c.id };
  if (req.query.before) where.id = { [Op.lt]: Number(req.query.before) };
  const rows = await Message.findAll({
    where, order: [['id', 'DESC']], limit: Math.min(Number(req.query.limit) || 60, 200),
    include: [{ model: User, as: 'author', attributes: userAttrs }, { model: Task, attributes: ['id', 'key', 'title', 'status'] }],
  });
  const [member] = await ChannelMember.findOrCreate({ where: { channelId: c.id, userId: req.user.id } });
  member.lastReadAt = new Date(); await member.save();
  res.json({ channel: c, messages: rows.reverse(), hasMore: rows.length === (Math.min(Number(req.query.limit) || 60, 200)) });
}));

router.post('/channels/:id/read', wrap(async (req, res) => {
  const [member] = await ChannelMember.findOrCreate({ where: { channelId: req.params.id, userId: req.user.id } });
  member.lastReadAt = new Date(); await member.save();
  res.json({ ok: true });
}));

router.post('/channels/:id/messages', wrap(async (req, res) => {
  const c = await Channel.findByPk(req.params.id, { include: [{ model: User, as: 'members', attributes: ['id'], through: { attributes: [] } }] });
  if (!(await canAccess(req, c))) return res.status(404).json({ error: 'Channel not found.' });
  const body = String(req.body.body || '').trim();
  if (!body) return res.status(400).json({ error: 'Write a message first.' });
  const mentions = [...new Set((req.body.mentions || []).map(Number).filter((id) => id !== req.user.id))];
  const m = await Message.create({ channelId: c.id, userId: req.user.id, body: body.slice(0, 5000), mentions, taskId: req.body.taskId || null });
  c.lastMessageAt = m.createdAt; await c.save();
  const [me] = await ChannelMember.findOrCreate({ where: { channelId: c.id, userId: req.user.id } });
  me.lastReadAt = new Date(); await me.save();
  const full = await Message.findByPk(m.id, { include: [{ model: User, as: 'author', attributes: userAttrs }, { model: Task, attributes: ['id', 'key', 'title', 'status'] }] });
  await emitTo(c, 'chat:message', { channelId: c.id, message: full });
  const where = c.kind === 'dm' ? 'a direct message' : `#${c.name}`;
  if (mentions.length) await notify({ userIds: mentions, type: 'chat_mention', title: `${req.user.name} mentioned you in ${where}`, body: body.slice(0, 200), link: `/chat/${c.id}` });
  if (c.kind === 'dm') {
    const other = c.members.map((x) => x.id).filter((id) => id !== req.user.id && !mentions.includes(id));
    await notify({ userIds: other, type: 'chat_dm', title: `Message from ${req.user.name}`, body: body.slice(0, 200), link: `/chat/${c.id}` });
  }
  res.status(201).json(full);
}));

router.patch('/messages/:id', wrap(async (req, res) => {
  const m = await Message.findByPk(req.params.id);
  if (!m || m.userId !== req.user.id) return res.status(403).json({ error: 'You can only edit your own messages.' });
  m.body = String(req.body.body || '').trim().slice(0, 5000) || m.body; m.editedAt = new Date(); await m.save();
  const c = await Channel.findByPk(m.channelId);
  await emitTo(c, 'chat:message', { channelId: c.id, message: await Message.findByPk(m.id, { include: [{ model: User, as: 'author', attributes: userAttrs }] }), edited: true });
  res.json(m);
}));

router.delete('/messages/:id', wrap(async (req, res) => {
  const m = await Message.findByPk(req.params.id);
  if (!m || (m.userId !== req.user.id && !req.can('settings.manage'))) return res.status(403).json({ error: 'You can only delete your own messages.' });
  const c = await Channel.findByPk(m.channelId);
  await m.destroy();
  await emitTo(c, 'chat:message', { channelId: c.id, deletedId: m.id });
  res.json({ ok: true });
}));

router.get('/unread', wrap(async (req, res) => {
  const memberships = await ChannelMember.findAll({ where: { userId: req.user.id }, raw: true });
  const pub = await Channel.findAll({ where: { kind: 'channel', isPrivate: false }, attributes: ['id'], raw: true });
  const ids = [...new Set([...memberships.map((m) => m.channelId), ...pub.map((p) => p.id)])];
  let total = 0;
  for (const id of ids) {
    const m = memberships.find((x) => x.channelId === id);
    total += await Message.count({ where: { channelId: id, userId: { [Op.ne]: req.user.id }, createdAt: { [Op.gt]: m?.lastReadAt || req.user.createdAt } } });
  }
  res.json({ unread: total });
}));

module.exports = { router, ensureGeneral };
