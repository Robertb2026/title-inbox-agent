require('dotenv').config();
const express = require('express');
const session = require('express-session');

const { getAuthUrl, getTokensFromCode, fetchInboxMessages, fetchMe } = require('./gmail');
const { buildKnowledgeBase } = require('./extract');
const { deliverReport } = require('./deliver');

const PORT = process.env.PORT || 3000;
const SCAN_MONTHS = Number(process.env.SCAN_MONTHS || 12);
const MAX_MESSAGES = Number(process.env.MAX_MESSAGES || 400);
const BATCH_SIZE = Number(process.env.BATCH_SIZE || 20);

const app = express();
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax' },
  })
);

app.get('/', (req, res) => {
  res.send(PAGE_LAYOUT(`
    <h1>Title Insurance Inbox Learning Agent</h1>
    <p>This connects to your Gmail / Google Workspace inbox (read-only), reviews
    recent title insurance correspondence, and builds a knowledge base of how
    title work is done at the office. It does <strong>not</strong> send email,
    delete anything, or change your mailbox. When it's done, a summary is
    emailed to the office admin &mdash; not to you.</p>
    <p>It scans messages from the last ${SCAN_MONTHS} month(s), up to
    ${MAX_MESSAGES} emails.</p>
    <a class="button" href="/auth/login">Connect my Gmail</a>
  `));
});

app.get('/auth/login', (req, res) => {
  res.redirect(getAuthUrl());
});

app.get('/auth/callback', async (req, res) => {
  if (req.query.error) {
    return res
      .status(400)
      .send(PAGE_LAYOUT(`<h1>Access not granted</h1><p>${escapeHtml(req.query.error)}</p>`));
  }

  let tokens;
  try {
    tokens = await getTokensFromCode(req.query.code);
  } catch (err) {
    console.error('[auth] token exchange failed', err);
    return res
      .status(500)
      .send(PAGE_LAYOUT(`<h1>Something went wrong signing you in</h1><p>${escapeHtml(err.message)}</p>`));
  }

  // Respond immediately — the scan can take a few minutes on a big mailbox,
  // so we don't hold the HTTP request open for it.
  res.send(PAGE_LAYOUT(`
    <h1>Thanks — you're connected</h1>
    <p>Your inbox is being reviewed now. This runs in the background and
    can take a few minutes depending on how much mail there is. You don't
    need to keep this tab open. Nothing further is required from you.</p>
    <p>The results go to the office admin, not to you.</p>
  `));

  runScanInBackground(tokens).catch((err) => {
    console.error('[scan] failed', err);
  });
});

async function runScanInBackground(tokens) {
  const meta = await fetchMe(tokens);
  console.log(`[scan] starting for ${meta.mail}`);

  const sinceDate = new Date();
  sinceDate.setMonth(sinceDate.getMonth() - SCAN_MONTHS);

  const emails = await fetchInboxMessages(tokens, {
    sinceDate,
    maxMessages: MAX_MESSAGES,
  });
  console.log(`[scan] fetched ${emails.length} emails`);

  if (emails.length === 0) {
    await deliverReport({
      ok: false,
      error: 'No emails found in the configured window (SCAN_MONTHS/MAX_MESSAGES) — nothing to learn from.',
      meta,
    });
    return;
  }

  try {
    const { markdown, structured } = await buildKnowledgeBase(emails, meta, BATCH_SIZE);
    await deliverReport({ ok: true, markdown, structured, meta });
    console.log('[scan] complete, report delivered');
  } catch (err) {
    console.error('[scan] extraction/delivery failed', err);
    await deliverReport({ ok: false, error: err.stack || String(err), meta });
  }
}

app.get('/healthz', (req, res) => res.send('ok'));

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function PAGE_LAYOUT(body) {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Title Inbox Agent</title>
<style>
  body { font-family: -apple-system, system-ui, sans-serif; max-width: 640px; margin: 60px auto; padding: 0 20px; color: #1a1a1a; line-height: 1.5; }
  h1 { font-size: 1.4rem; }
  .button { display: inline-block; margin-top: 16px; padding: 12px 20px; background: #1a5fb4; color: #fff; text-decoration: none; border-radius: 6px; font-weight: 600; }
</style>
</head>
<body>${body}</body>
</html>`;
}

app.listen(PORT, () => {
  console.log(`Title inbox agent listening on :${PORT}`);
});
