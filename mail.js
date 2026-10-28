// Sending email (used for password reset links).
// Needs the SMTP_* settings in .env. Without them the email is printed in the server
// terminal instead, which is fine while the site only runs on your own computer.
import nodemailer from 'nodemailer';

const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM } = process.env;
const port = Number(SMTP_PORT) || 465;

export const mailConfigured = Boolean(SMTP_HOST && SMTP_USER && SMTP_PASS);

const transport = mailConfigured
  ? nodemailer.createTransport({ host: SMTP_HOST, port, secure: port === 465, auth: { user: SMTP_USER, pass: SMTP_PASS } })
  : null;

export async function sendMail({ to, subject, text, html }) {
  if (!transport) {
    console.log([
      '',
      '----- Email (not sent: SMTP is not set up in .env) -----',
      `To: ${to}`,
      `Subject: ${subject}`,
      '',
      text,
      '--------------------------------------------------------',
      '',
    ].join('\n'));
    return;
  }
  await transport.sendMail({ from: MAIL_FROM || `Taskflow <${SMTP_USER}>`, to, subject, text, html });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export function sendPasswordResetEmail(user, link, minutes) {
  const text = [
    `Hi ${user.name},`,
    '',
    'Someone asked to reset the password for your Taskflow account.',
    `Open this link to choose a new password (it works for ${minutes} minutes, one time):`,
    '',
    link,
    '',
    "If this wasn't you, ignore this email. Your password stays the same.",
  ].join('\n');

  const html = `
  <div style="background:#050505;padding:40px 16px;font-family:Inter,Segoe UI,Arial,sans-serif">
    <div style="max-width:460px;margin:0 auto;background:#111;border:1px solid #2a2a2a;border-radius:16px;padding:32px;color:#f4f4f4">
      <div style="font-size:18px;font-weight:700;margin-bottom:24px">Taskflow</div>
      <h1 style="font-size:22px;margin:0 0 12px">Reset your password</h1>
      <p style="color:#a3a3a3;line-height:1.6;margin:0 0 24px">Hi ${escapeHtml(user.name)}, someone asked to reset the password
        for your Taskflow account. This link works for ${minutes} minutes and can be used once.</p>
      <a href="${escapeHtml(link)}" style="display:inline-block;background:#fff;color:#000;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:10px">Choose a new password</a>
      <p style="color:#6b6b6b;font-size:13px;line-height:1.6;margin:24px 0 0">If this wasn't you, ignore this email. Your password stays the same.</p>
    </div>
  </div>`;

  return sendMail({ to: user.email, subject: 'Reset your Taskflow password', text, html });
}
