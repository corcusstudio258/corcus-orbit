// SMTP email (Gmail app password, Hostinger mailbox, Zoho, any SMTP).
const nodemailer = require('nodemailer');
const settings = require('./settings');

let cached = null;
async function transport() {
  const c = await settings.get('email');
  const sig = JSON.stringify([c.host, c.port, c.secure, c.user, c.pass]);
  if (cached?.sig === sig) return { t: cached.t, c };
  const t = nodemailer.createTransport({ host: c.host, port: Number(c.port) || 465, secure: c.secure !== false && Number(c.port) !== 587, auth: c.user ? { user: c.user, pass: c.pass } : undefined });
  cached = { sig, t };
  return { t, c };
}

async function ready() {
  const c = await settings.get('email');
  return !!(c.enabled && c.host && c.from);
}

/** Send one email. Throws on failure. Returns false when email is switched off (unless force). */
async function send({ to, subject, text, html, attachments, replyTo }, { force = false } = {}) {
  const c = await settings.get('email');
  if (!force && !(await ready())) return false;
  if (!c.host || !c.from) throw new Error('Add the SMTP host and From address first.');
  const { t } = await transport();
  const company = (await settings.get('company')).name;
  await t.sendMail({ from: c.from.includes('<') ? c.from : `${company} <${c.from}>`, to, subject, text, html, attachments, replyTo });
  return true;
}

/** Simple branded HTML wrapper. */
async function layout(title, bodyHtml, cta) {
  const company = (await settings.get('company')).name;
  const esc = (s) => String(s || '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  return `<!doctype html><html><body style="margin:0;background:#F4F6FB;font-family:Arial,Helvetica,sans-serif;color:#0F1535">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px"><tr><td align="center">
  <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #E3E7F2">
  <tr><td style="background:#0F1535;padding:20px 28px;color:#fff;font-size:16px;font-weight:bold"><span style="color:#FFC21A">&#9679;</span> ${esc(company)}</td></tr>
  <tr><td style="padding:28px">
  <h1 style="margin:0 0 12px;font-size:22px">${esc(title)}</h1>
  <div style="font-size:15px;line-height:1.6;color:#3A4166">${bodyHtml}</div>
  ${cta ? `<p style="margin:24px 0 8px"><a href="${esc(cta.url)}" style="display:inline-block;background:#FFC21A;color:#0F1535;font-weight:bold;text-decoration:none;padding:12px 20px;border-radius:10px">${esc(cta.label)}</a></p><p style="font-size:12px;color:#8D94B3;word-break:break-all">${esc(cta.url)}</p>` : ''}
  </td></tr></table></td></tr></table></body></html>`;
}

module.exports = { send, ready, layout };
