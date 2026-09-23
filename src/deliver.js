// Emails the finished knowledge base back to the office admin (Robert).
const { Resend } = require('resend');

// Built lazily (not at module load) so a missing/placeholder key can never
// crash the whole server at startup — it just means email delivery is
// skipped, not that the process dies.
function getResendClient() {
  const key = process.env.RESEND_API_KEY;
  if (!key || key === 'SET_ME') return null;
  return new Resend(key);
}

async function deliverReport({ markdown, structured, meta, ok = true, error = null }) {
  const to = process.env.REPORT_TO_EMAIL;
  const from = process.env.REPORT_FROM_EMAIL;

  // Safety net: print the full report to the logs FIRST, every time, no
  // matter what happens with email. This is what guarantees the report is
  // never silently lost, even if Resend is misconfigured or its API call
  // fails for some reason.
  console.log('[deliver] ==== REPORT START ====');
  console.log(`[deliver] for: ${(meta && (meta.displayName || meta.mail)) || 'unknown'}`);
  console.log(`[deliver] ok: ${ok}`);
  if (ok) {
    console.log(markdown);
    console.log('[deliver] ---- structured JSON ----');
    console.log(JSON.stringify(structured, null, 2));
  } else {
    console.log(`[deliver] error: ${error}`);
  }
  console.log('[deliver] ==== REPORT END ====');

  const resend = getResendClient();
  if (!resend || !to || !from) {
    console.error(
      '[deliver] RESEND_API_KEY not set (or still the "SET_ME" placeholder) / REPORT_TO_EMAIL / REPORT_FROM_EMAIL missing — email not sent. The full report is printed above in these logs.'
    );
    return { sent: false, reason: 'not_configured' };
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

  try {
    const { data, error: sendError } = await resend.emails.send({
      from,
      to,
      subject,
      html,
      attachments,
    });

    if (sendError) {
      console.error(
        '[deliver] Resend API returned an error — email NOT sent. The full report is printed above in these logs.',
        sendError
      );
      return { sent: false, reason: 'resend_error', error: sendError };
    }

    console.log(`[deliver] email sent via Resend, id: ${data && data.id}`);
    return { sent: true, result: data };
  } catch (err) {
    console.error(
      '[deliver] Resend call threw — email NOT sent. The full report is printed above in these logs.',
      err
    );
    return { sent: false, reason: 'resend_exception', error: err.message || String(err) };
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

module.exports = { deliverReport };
