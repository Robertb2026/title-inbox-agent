# Title Insurance Inbox Learning Agent

What it does: you send your colleague a link. He clicks it, signs into his own Gmail / Google Workspace account, and approves read-only access to his inbox. The agent then reads his recent title-insurance-related email, extracts a "how we do title insurance here" knowledge base (terminology, workflow steps, roles, document types, how issues get resolved, communication patterns), and emails the finished playbook to **you** — not to him. His raw email content never gets stored anywhere; only the distilled knowledge leaves the process.

This is deliberately built as two separable pieces: the Gmail connector (`src/gmail.js`) and the extraction pipeline (`src/extract.js`). When you're ready to make this the AI inbox/closing assistant inside Meister Flow, the extraction pipeline is the part that gets reused — the Meister Flow app just needs to call it with a different mail source.

---

## What you need to do (nobody else can do these for you)

### 1. Set up OAuth in Google Cloud Console (10-15 min)

This is what makes the "Connect my Gmail" button work at all — Google requires every app that touches a mailbox to be registered and approved through this.

1. Go to https://console.cloud.google.com and create a new project (top-left project dropdown → New Project). Name it something like `Title Inbox Agent`.
2. Go to **APIs & Services → Library**, search **Gmail API**, click it, click **Enable**.
3. Go to **APIs & Services → OAuth consent screen**.
   - User type: choose **Internal** if this offers it (it will, since Meister Abstract is on Google Workspace) — that keeps it restricted to people at your company and skips Google's public-app verification process entirely. If it only offers **External**, choose that and add your colleague's email under **Test users** so he can use it without the app going through Google's full review.
   - Fill in the app name, your email as support contact, and save through the steps.
4. Go to **APIs & Services → Credentials → Create Credentials → OAuth client ID**.
   - Application type: **Web application**.
   - Name it `Title Inbox Agent`.
   - Under **Authorized redirect URIs**, add (you'll update this once it's deployed — for now use):
     `http://localhost:3000/auth/callback`
   - Click **Create**.
5. Copy the **Client ID** and **Client Secret** it shows you → these are `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
6. If you chose **Internal** in step 3, nobody outside Meister Abstract's Workspace can even see this app, and there's no extra admin-consent step — any employee can just sign in. If you chose **External** with test users, only the emails you listed as test users can sign in until/unless you submit the app for Google's verification (skip that for an internal tool — the test-user list is enough).

### 2. Get an Anthropic API key

You already have one if Meister Flow uses Claude — reuse it, or create a new one at https://console.anthropic.com. This is `ANTHROPIC_API_KEY`.

### 3. Get a Resend API key (for emailing you the results)

1. Sign up at https://resend.com (free tier is enough for this).
2. Verify a domain you control, or use their sandbox for testing.
3. Create an API key → `RESEND_API_KEY`.
4. Set `REPORT_FROM_EMAIL` to an address on your verified domain, and `REPORT_TO_EMAIL` to your own email.

*(If you'd rather not stand up Resend right now, the app still works — it just prints the finished report to the server logs instead of emailing it, so you can grab it from there.)*

### 4. Deploy it somewhere with a stable URL

Easiest: Railway, same as Meister Flow.

1. Push this folder to a new GitHub repo (or a new folder in an existing one).
2. In Railway: **New Project** → **Deploy from GitHub repo** → pick it.
3. Add all the environment variables from `.env.example` in Railway's **Variables** tab (with your real values).
4. Once deployed, Railway gives you a public URL like `title-inbox-agent-production.up.railway.app`.
5. Set `GOOGLE_REDIRECT_URI` in Railway's variables to `https://<that-url>/auth/callback`.
6. Go back to Google Cloud Console → **Credentials** → your OAuth client → add that same URL under **Authorized redirect URIs** (you can remove the localhost one).
7. Redeploy so the new env var takes effect.

### 5. Send it to your colleague

Just send him the deployed URL. That's the whole "plug and play" — he opens it, clicks **Connect my Gmail**, signs in with his own Google Workspace account, and approves the permission prompt. Everything after that is automatic; you'll get an email with the results.

---

## Running it locally first (recommended before deploying)

```
npm install
cp .env.example .env
# fill in .env with real values, GOOGLE_REDIRECT_URI=http://localhost:3000/auth/callback
npm start
```

Then open http://localhost:3000 yourself and go through the flow once with your own Gmail/Workspace account before sending the link to anyone else.

## Privacy / what actually gets stored

- Access is read-only (`gmail.readonly`) — it cannot send mail, delete anything, or touch other mailboxes.
- The OAuth token is used in memory for one scan and then discarded; it is not written to disk or a database.
- Before any email text is sent to Claude for extraction, obvious SSNs, bank account/routing numbers, and card numbers are stripped.
- The extraction prompt explicitly instructs the model to describe *patterns* (e.g. "requests a payoff statement from the lender") rather than retain specific names, addresses, or dollar amounts from individual deals.
- Nothing is emailed to the colleague whose inbox was scanned — only to `REPORT_TO_EMAIL`.
- This is a reasonable-effort privacy design for an internal tool, not a compliance certification — if this is ever pointed at a mailbox outside your own company, get real legal sign-off first (it's reading someone's actual work email).

## Tuning

All in `.env`:
- `SCAN_MONTHS` — how far back to look (default 12).
- `MAX_MESSAGES` — hard cap on emails scanned, controls cost/time (default 400). Gmail requires one API call per message body, so a high cap means a slower scan.
- `BATCH_SIZE` — emails per Claude call during extraction (default 20). Lower this if individual emails are long and you hit token limits.

## Known limitations (MVP, not the finished Meister Flow assistant)

- Scans the Inbox only — not Sent, not other labels/folders. Easy to extend in `src/gmail.js`.
- Runs one scan per OAuth login; there's no "re-scan monthly" scheduler yet.
- No persistent database — each run's knowledge base only exists in the emailed report. When this becomes the Meister Flow assistant, that's the piece to add (store the structured JSON somewhere Meister Flow can query, instead of only emailing it).
- No admin dashboard to review before it's emailed — it just sends.
