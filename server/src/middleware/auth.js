const jwt = require('jsonwebtoken');
const { User, Role } = require('../models');

const secret = () => process.env.JWT_SECRET || 'dev-secret-change-me';

function signToken(user) {
  return jwt.sign({ id: user.id }, secret(), { expiresIn: process.env.JWT_EXPIRES || '7d' });
}

async function loadUser(id) {
  const user = await User.findByPk(id, { include: [{ model: Role }] });
  if (!user || !user.isActive) return null;
  return user;
}

async function auth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Sign in to continue.' });
    const payload = jwt.verify(token, secret());
    const user = await loadUser(payload.id);
    if (!user) return res.status(401).json({ error: 'Your account is inactive or no longer exists.' });
    req.user = user;
    req.perms = new Set(user.Role?.permissions || []);
    req.isClient = !!user.Role?.isClientRole;
    req.can = (p) => req.perms.has(p);
    // fire-and-forget presence update, at most once a minute
    if (!user.lastSeenAt || Date.now() - new Date(user.lastSeenAt).getTime() > 60000) {
      User.update({ lastSeenAt: new Date() }, { where: { id: user.id } }).catch(() => {});
    }
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Your session has expired. Sign in again.' });
  }
}

const requirePerm = (...perms) => (req, res, next) => {
  if (perms.some((p) => req.perms.has(p))) return next();
  return res.status(403).json({ error: "Your role doesn't allow this action." });
};

const staffOnly = (req, res, next) => (req.isClient
  ? res.status(403).json({ error: 'This area is for the team only.' }) : next());

const clientOnly = (req, res, next) => (!req.isClient
  ? res.status(403).json({ error: 'This area is for client portal users.' }) : next());

module.exports = { auth, requirePerm, staffOnly, clientOnly, signToken, secret, loadUser };
