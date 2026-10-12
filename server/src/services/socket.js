const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');
const { secret, loadUser } = require('../middleware/auth');

let io = null;
const online = new Map(); // userId -> number of open sockets

function init(httpServer, corsOrigin) {
  io = new Server(httpServer, { cors: { origin: corsOrigin, credentials: true } });
  io.use(async (socket, next) => {
    try {
      const { id } = jwt.verify(socket.handshake.auth?.token, secret());
      const user = await loadUser(id);
      if (!user) return next(new Error('unauthorized'));
      socket.user = user;
      next();
    } catch { next(new Error('unauthorized')); }
  });
  io.on('connection', (socket) => {
    const u = socket.user;
    socket.join(`user:${u.id}`);
    if (u.Role?.isClientRole) socket.join(`client:${u.clientId}`); else socket.join('staff');
    online.set(u.id, (online.get(u.id) || 0) + 1);
    io.to('staff').emit('presence', [...online.keys()]);
    socket.on('chat:typing', (d) => {
      if (u.Role?.isClientRole || !d?.channelId) return;
      socket.to('staff').emit('chat:typing', { channelId: d.channelId, user: { id: u.id, name: u.name } });
    });
    socket.on('disconnect', () => {
      const n = (online.get(u.id) || 1) - 1;
      if (n <= 0) online.delete(u.id); else online.set(u.id, n);
      io.to('staff').emit('presence', [...online.keys()]);
    });
  });
  return io;
}

const toUser = (userId, event, data) => io && io.to(`user:${userId}`).emit(event, data);
const toStaff = (event, data) => io && io.to('staff').emit(event, data);
const toUsers = (ids, event, data) => io && [...new Set(ids)].forEach((id) => io.to(`user:${id}`).emit(event, data));
const toClient = (clientId, event, data) => io && clientId && io.to(`client:${clientId}`).emit(event, data);
const onlineIds = () => [...online.keys()];

module.exports = { init, toUser, toUsers, toStaff, toClient, onlineIds };
