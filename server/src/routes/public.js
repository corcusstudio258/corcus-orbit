// Public (signed-out) endpoints: client self sign-up with the onboarding form.
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { Client, User, Role, ClientFile } = require('../models');
const { signToken } = require('../middleware/auth');
const { notify } = require('../services/notify');
const settings = require('../services/settings');
const profile = require('../services/clientProfile');
const mailer = require('../services/mailer');

const limiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many sign-ups from this network. Try again later.' } });
const COLORS = ['#3D5AFE', '#8B5CF6', '#1FA971', '#C76A00', '#E5484D', '#0EA5B7', '#D946EF'];

router.get('/onboarding', async (req, res) => res.json(await profile.publicForm()));

router.post('/signup', limiter, profile.upload.fields([{ name: 'logo', maxCount: 1 }, { name: 'documents', maxCount: 10 }]), async (req, res) => {
  try {
    const form = await settings.get('onboarding');
    if (form.allowSignup === false) return res.status(403).json({ error: 'Sign-up is closed. Ask your agency for a login.' });
    const { name, email, password, phone } = req.body;
    const cleanEmail = String(email || '').toLowerCase().trim();
    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) return res.status(400).json({ error: 'Your name and a valid email are required.' });
    if (!password || password.length < 8) return res.status(400).json({ error: 'Choose a password of at least 8 characters.' });
    if (await User.findOne({ where: { email: cleanEmail } })) return res.status(400).json({ error: 'This email already has an account. Sign in instead, or use Forgot password.' });
    const { answers, secrets, mapped, error } = await profile.readAnswers(req.body.answers);
    if (error) return res.status(400).json({ error });
    const role = await Role.findOne({ where: { isClientRole: true } });
    const auto = !!form.autoApprove;
    const client = await Client.create({
      name: mapped.name || req.body.businessName || name, company: mapped.name || null, email: mapped.email || cleanEmail, phone: mapped.phone || phone || null,
      whatsapp: mapped.whatsapp || phone || null, industry: mapped.industry || null, city: mapped.city || null, website: mapped.website || null,
      color: COLORS[Math.floor(Math.random() * COLORS.length)], status: auto ? 'active' : 'pending', onboarding: answers,
      secrets: Object.keys(secrets).length ? profile.encrypt(secrets) : null, signupSource: 'portal', approvedAt: auto ? new Date() : null,
    });
    const files = req.files || {};
    const logo = files.logo?.[0];
    if (logo) {
      const cf = await ClientFile.create({ clientId: client.id, originalName: logo.originalname, fileName: logo.filename, mime: logo.mimetype, size: logo.size, category: 'logo' });
      client.logo = String(cf.id); await client.save();
    }
    for (const f of files.documents || []) await ClientFile.create({ clientId: client.id, originalName: f.originalname, fileName: f.filename, mime: f.mimetype, size: f.size, category: 'document' });
    const user = await User.create({ name, email: cleanEmail, phone: phone || mapped.whatsapp || null, roleId: role.id, clientId: client.id, color: client.color,
      designation: 'Client', isActive: auto, passwordHash: await bcrypt.hash(password, 10) });
    const staff = (await User.findAll({ where: { isActive: true }, include: [Role] })).filter((u) => !u.Role?.isClientRole && (u.Role?.permissions || []).includes('clients.manage'));
    await notify({ userIds: staff.map((u) => u.id), type: 'client_request', title: `New client sign-up: ${client.name}`, body: auto ? `${name} joined the portal.` : `${name} is waiting for approval.`, link: `/clients/${client.id}` });
    if (await mailer.ready()) {
      const company = (await settings.get('company')).name;
      mailer.send({ to: cleanEmail, subject: `Welcome to ${company}`, html: await mailer.layout(`Thanks, ${name.split(' ')[0]}`, auto ? '<p>Your client portal is ready. Sign in any time to follow your projects, review work and share files.</p>' : '<p>We have your details. Our team will review them and activate your portal shortly. We will let you know as soon as it is ready.</p>') }).catch(() => {});
    }
    if (auto) return res.status(201).json({ approved: true, token: signToken(user) });
    res.status(201).json({ approved: false, message: 'Thanks! Your details are in. We will activate your portal and let you know.' });
  } catch (e) { console.error('[signup]', e); res.status(500).json({ error: 'Sign-up failed. Please try again.' }); }
});

module.exports = router;
