// Emails the finished knowledge base back to the office admin (Robert).
const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

async function deliverReport({ markdown, structured, meta, ok = true, error = null }) {
  const to = process.env.REPORT_TO_EMAIL;
  const from = process.env.REPORT_FROM_EMAIL;

  if (!process.env.RESEND_API_KEY || !to || !from) {
    console.error(
      '[deliver] Missing RESEND_API_KEY / REPORT_TO_EMAIL / REPORT_FROM_EMAIL — report not sent. Dumping to stdout instead.'
    );
    console.log(markdown || error);
    return { sent: false };
  }

  const subject = ok
    ? `Title insurance knowledge base ready — ${meta.displayName || meta.mail || 'inbox scan'}`
    : `Title inbox scan failed — ${meta.displayName || meta.mail || 'unknown'}`;

  const html = ok
    ? `<pre style="white-space:pre-wrap;font-family:ui-monospace,monospace">${escapeHtml(markdown)}</pre>`
    : `<p>The inbox scan for ${escapeHtml(meta.displayName || meta.mail || 'a colleague')} failed.</p><pre>${escapeHtml(String(error))}</pre>`;

  const attachments = [];
  if (ok) {
    attachments.push({
      filename: 'title-insurance-playbook.md',
      content: Buffer.from(markdown, 'utf-8').toString('base64'),
    });
    attachments.push({
      filename: 'title-insurance-knowledge-base.json',
      content: Buffer.from(JSON.stringify(structured, null, 2), 'utf-8').toString('base64'),
    });
  }

  const result = await resend.emails.send({
    from,
    to,
    subject,
    html,
    attachments,
  });

  return { sent: true, result };
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

module.exports = { deliverReport };
