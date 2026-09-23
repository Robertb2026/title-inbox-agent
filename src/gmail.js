// Google OAuth + Gmail API helpers: pull messages from the signed-in user's inbox.
const { google } = require('googleapis');

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
];

function newOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

function getAuthUrl() {
  const client = newOAuthClient();
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
  });
}

async function getTokensFromCode(code) {
  const client = newOAuthClient();
  const { tokens } = await client.getToken(code);
  return tokens;
}

function clientWithTokens(tokens) {
  const client = newOAuthClient();
  client.setCredentials(tokens);
  return client;
}

/** Basic profile info, mostly for logging / the final report header. */
async function fetchMe(tokens) {
  const auth = clientWithTokens(tokens);
  const oauth2 = google.oauth2({ version: 'v2', auth });
  const { data } = await oauth2.userinfo.get();
  return { displayName: data.name, mail: data.email };
}

/**
 * Fetch up to `maxMessages` inbox messages newer than `sinceDate`, as plain text.
 * Gmail's API only returns message bodies via a per-message get call, so this
 * does one list call (paginated) followed by one get call per message.
 */
async function fetchInboxMessages(tokens, { sinceDate, maxMessages, pageSize = 50 }) {
  const auth = clientWithTokens(tokens);
  const gmail = google.gmail({ version: 'v1', auth });

  const afterStr = toGmailDate(sinceDate); // YYYY/MM/DD
  // No "in:inbox" here on purpose — Gmail's default search scope (no label
  // filter) covers the whole mailbox except Spam/Trash, so archived/filed
  // mail is included too. Restricting to in:inbox misses everything the
  // person has already filed away, which for a working mailbox is most of it.
  const query = `after:${afterStr}`;

  const ids = [];
  let pageToken;
  do {
    const { data } = await gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults: Math.min(pageSize, maxMessages - ids.length),
      pageToken,
    });
    for (const m of data.messages || []) ids.push(m.id);
    pageToken = data.nextPageToken;
  } while (pageToken && ids.length < maxMessages);

  const messages = [];
  for (const id of ids.slice(0, maxMessages)) {
    const { data } = await gmail.users.messages.get({
      userId: 'me',
      id,
      format: 'full',
    });
    messages.push(parseMessage(data));
  }
  return messages;
}

function toGmailDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}/${m}/${d}`;
}

function header(headers, name) {
  const h = (headers || []).find((h) => h.name.toLowerCase() === name.toLowerCase());
  return h ? h.value : '';
}

function decodeBase64Url(data) {
  if (!data) return '';
  return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8');
}

/** Walk the MIME tree looking for text/plain first, text/html as fallback. */
function extractBody(payload) {
  if (!payload) return '';
  const stack = [payload];
  let htmlFallback = '';

  while (stack.length) {
    const part = stack.shift();
    if (part.mimeType === 'text/plain' && part.body?.data) {
      return decodeBase64Url(part.body.data);
    }
    if (part.mimeType === 'text/html' && part.body?.data && !htmlFallback) {
      htmlFallback = decodeBase64Url(part.body.data);
    }
    if (part.parts) stack.push(...part.parts);
  }

  return htmlFallback.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function parseMessage(data) {
  const headers = data.payload?.headers || [];
  return {
    id: data.id,
    subject: header(headers, 'Subject') || '(no subject)',
    from: header(headers, 'From'),
    to: header(headers, 'To')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    receivedDateTime: header(headers, 'Date') || new Date(Number(data.internalDate)).toISOString(),
    conversationId: data.threadId,
    body: (extractBody(data.payload) || data.snippet || '').trim(),
  };
}

module.exports = { getAuthUrl, getTokensFromCode, fetchInboxMessages, fetchMe };
