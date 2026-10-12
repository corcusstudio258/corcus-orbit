require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const { sequelize } = require('./models');
const { auth } = require('./middleware/auth');
const { router: authRouter, ensureRoles } = require('./routes/auth');
const misc = require('./routes/misc');
const socket = require('./services/socket');
const reminders = require('./jobs/reminders');

const app = express();
const server = http.createServer(app);
const origins = (process.env.CORS_ORIGIN || 'http://localhost:5173').split(',').map((s) => s.trim());

app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(cors({ origin: origins, credentials: true }));
app.use(express.json({ limit: '5mb' }));
if (process.env.NODE_ENV !== 'test') app.use(morgan('dev'));

app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));
app.use('/api/auth', authRouter);
app.use('/api/roles', auth, require('./routes/roles'));
app.use('/api/users', auth, require('./routes/users'));
app.use('/api/clients', auth, require('./routes/clients'));
app.use('/api/projects', auth, require('./routes/projects'));
app.use('/api/tasks', auth, require('./routes/tasks').router);
app.use('/api/dashboard', auth, require('./routes/dashboard'));
app.use('/api/portal', auth, require('./routes/portal'));
app.use('/api/ai', auth, require('./routes/ai'));
app.use('/api/chat', auth, require('./routes/chat').router);
app.use('/api/meetings', auth, require('./routes/meetings').router);
app.use('/api/documents', auth, require('./routes/documents'));
app.use('/api/people', auth, require('./routes/people'));
app.use('/api/tools', auth, require('./routes/tools'));
app.use('/api/notifications', ...misc.notifications);
app.use('/api/activity', ...misc.activity);
app.use('/api/settings', ...misc.settings);
app.use('/api/files', misc.files);
app.use('/api', (req, res) => res.status(404).json({ error: 'Unknown API route.' }));

// Serve the built React app in production (client/dist)
const dist = path.resolve(__dirname, '../../client/dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist, { maxAge: '7d', index: false }));
  app.get(/^\/(?!api|socket\.io).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Files can be up to 25 MB.' : 'Something went wrong on the server.' });
});

async function start() {
  await sequelize.authenticate();
  if (sequelize.getDialect() === 'sqlite') await sequelize.query('PRAGMA journal_mode = WAL;');
  await require('./config/migrate').migrate();
  await ensureRoles();
  await require('./config/defaults').ensureDefaults();
  require('./services/hooks').register();
  socket.init(server, origins);
  reminders.start();
  const port = Number(process.env.PORT || 5000);
  server.listen(port, () => console.log(`Orbit API running on http://localhost:${port} (${sequelize.getDialect()})`));
}

if (require.main === module) start().catch((e) => { console.error('Failed to start:', e); process.exit(1); });

module.exports = { app, server, start };
