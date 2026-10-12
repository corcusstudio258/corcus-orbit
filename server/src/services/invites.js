// Invite and password-reset links for team members (and client portal logins).
// Delivery order: Firebase email link → SMTP email → WhatsApp. The link is also returned
// to the admin so it can be shared by hand when nothing is set up yet.
const crypto = require('crypto');
const { Op } = require('sequelize');
const { User } = require('../models');
const firebase = require('./firebase');
const mailer = require('./mailer');
const whatsapp = require('./whatsapp');
const settings = require('./settings');

const hash = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');

function appUrl(req) {
  const origin = req?.headers?.origin;
  return String(origin && /^https?:\/\//.test(origin) ? origin : process.env.APP_URL || 'http://localhost:5173').replace(/\/$/, '');
}

/**
 * purpose: 'invite' | 'reset'
 * Returns { link, via: ['firebase'|'email'|'whatsapp'], errors }
 */
async function issue(req, user, purpose) {
  const raw = crypto.randomBytes(24).toString('hex');
  const hours = purpose === 'invite' ? 24 * 7 : 2;
  const link = `${appUrl(req)}/${purpose === 'invite' ? 'accept' : 'reset'}?token=${raw}&email=${encodeURIComponent(user.email)}`;
  const company = (await settings.get('company')).name;
  const via = []; const errors = [];
  let fb = false;
  try { fb = await firebase.sendLink(user.email, link); if (fb) via.push('firebase'); } catch (e) { errors.push(e.message); }
  if (!fb) {
    const title = purpose === 'invite' ? `You're invited to ${company}` : `Reset your ${company} password`;
    const intro = purpose === 'invite'
      ? `<p>Hi ${user.name.split(' ')[0]},</p><p>${req?.user?.name || 'Your team'} invited you to join <b>${company}</b> on Orbit, where we plan projects, share work with clients and track tasks.</p><p>Set your password to get started. This link works for 7 days.</p>`
      : `<p>Hi ${user.name.split(' ')[0]},</p><p>Someone asked to reset the password for this email. If it was you, choose a new password below. The link works for 2 hours.</p><p>If it wasn't you, ignore this email.</p>`;
    try {
      if (await mailer.send({ to: user.email, subject: title, text: `${title}\n\n${link}`, html: await mailer.layout(title, intro, { url: link, label: purpose === 'invite' ? 'Accept invite' : 'Choose a new password' }) })) via.push('email');
    } catch (e) { errors.push(`Email: ${e.message}`); }
  }
  if (user.phone && (purpose === 'invite' || !via.length)) {
    const msg = purpose === 'invite'
      ? `*${company}*\nHi ${user.name.split(' ')[0]}, you're invited to Orbit${fb ? '. Check your email for the sign-in link.' : `. Set your password here (valid 7 days):\n${link}`}`
      : `*${company}*\nPassword reset link (valid 2 hours):\n${link}`;
    const st = await whatsapp.send(user.phone, msg);
    if (st === 'sent' || st === 'logged') via.push('whatsapp');
  }
  user.inviteToken = hash(raw);
  user.inviteExpires = new Date(Date.now() + hours * 3600e3);
  user.invitePurpose = `${purpose}${fb ? '|fb' : ''}`;
  if (purpose === 'invite') user.invitedAt = new Date();
  await user.save();
  return { link, via, errors };
}

async function find(raw) {
  if (!raw) return null;
  return User.findOne({ where: { inviteToken: hash(raw), inviteExpires: { [Op.gt]: new Date() } } });
}

module.exports = { issue, find, appUrl };
