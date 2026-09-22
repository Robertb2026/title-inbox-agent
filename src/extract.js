// Turns a pile of real inbox emails into a "how we do title insurance here"
// knowledge base: one pass per batch, then one synthesis pass over all batches.
const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';

// Light defensive redaction before anything leaves this server: strip the
// identifiers that have no business being in a training/knowledge doc even
// though the rest of the deal context (names, addresses, amounts) is kept
// because it's what makes the knowledge base useful.
function redact(text) {
  return text
    .replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[SSN-REDACTED]') // SSN
    .replace(/\b\d{9,17}\b/g, '[ACCOUNT-NUMBER-REDACTED]') // bank acct/routing
    .replace(/\b(?:\d[ -]*?){13,16}\b/g, '[CARD-NUMBER-REDACTED]'); // card numbers
}

function formatBatch(emails) {
  return emails
    .map((e, i) => {
      const body = redact(e.body).slice(0, 4000); // keep prompts bounded
      return [
        `--- EMAIL ${i + 1} ---`,
        `From: ${e.from}`,
        `To: ${e.to.join(', ')}`,
        `Date: ${e.receivedDateTime}`,
        `Subject: ${e.subject}`,
        `Body:`,
        body,
      ].join('\n');
    })
    .join('\n\n');
}

const BATCH_SYSTEM_PROMPT = `You are studying a real title insurance office's email correspondence to build an internal knowledge base of how title insurance work actually gets done there. You are not summarizing individual deals — you are extracting reusable, general knowledge about the process, the people-roles, the vocabulary, and the document types, using these emails as evidence.

For the batch of emails you're given, extract only what the emails actually support. Return your findings as JSON with this shape (omit a field if the batch has nothing for it — do not invent content):

{
  "terminology": [{"term": "...", "meaning": "...", "evidence": "short paraphrase or quote fragment"}],
  "workflow_steps": [{"step": "...", "typically_happens_when": "...", "who_is_involved": "..."}],
  "roles": [{"role": "e.g. title officer, closer, examiner, underwriter, lender, buyer's attorney", "responsibilities": "..."}],
  "document_types": [{"name": "e.g. commitment, CD, payoff letter, survey affidavit", "purpose": "...", "when_used": "..."}],
  "issues_and_resolutions": [{"issue": "e.g. open judgment, name variance, missing payoff", "how_it_was_handled": "..."}],
  "communication_patterns": [{"situation": "...", "typical_phrasing_or_template": "..."}]
}

Do not include client names, property addresses, SSNs, account numbers, or dollar amounts in your output — describe the pattern generically (e.g. "requests a payoff statement from the existing lender" not "requests payoff from Wells Fargo for 123 Main St"). You are building reusable process knowledge, not a case file. Return ONLY the JSON object, no other text.`;

async function extractBatch(emails) {
  const content = formatBatch(emails);
  const resp = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 4000,
    system: BATCH_SYSTEM_PROMPT,
    messages: [{ role: 'user', content }],
  });
  const text = resp.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
  return safeParseJson(text);
}

const SYNTHESIS_SYSTEM_PROMPT = `You are merging several partial extractions (each pulled from a batch of real title insurance office emails) into one clean, deduplicated internal knowledge base document: "How We Do Title Insurance Here."

Input: a JSON array of partial extraction objects, each shaped like:
{ "terminology": [...], "workflow_steps": [...], "roles": [...], "document_types": [...], "issues_and_resolutions": [...], "communication_patterns": [...] }

Merge and deduplicate across all of them. Order workflow_steps into the actual chronological order of a title/closing file to the best of your judgment (order open -> search -> commitment -> clearance of exceptions -> closing -> policy issuance -> recording -> post-closing, adjusted based on what the evidence actually shows). Write it as a well-organized markdown document with headers, meant to teach someone (or another AI assistant) how title insurance work is done at this specific office. Be concrete and specific about process, generic about any private deal details.

End with a short "## Gaps / What This Doesn't Cover Yet" section listing anything a real title agent would need that these emails didn't reveal (e.g. underwriter-specific rate rules, state-specific requirements not seen in this sample).

Return ONLY the markdown document, no preamble.`;

async function synthesize(batchResults, meta) {
  const resp = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 8000,
    system: SYNTHESIS_SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `Source: inbox of ${meta.displayName || meta.mail || 'a title office employee'}, ${meta.emailCount} emails scanned.\n\nPartial extractions:\n${JSON.stringify(batchResults, null, 2)}`,
      },
    ],
  });
  return resp.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
}

function safeParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    // Model sometimes wraps in a code fence despite instructions; try to recover.
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        /* fall through */
      }
    }
    return { parse_error: true, raw: text };
  }
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Runs the full pipeline: batch extraction over all emails, then one synthesis pass. */
async function buildKnowledgeBase(emails, meta, batchSize = 20) {
  const batches = chunk(emails, batchSize);
  const batchResults = [];
  for (const batch of batches) {
    const result = await extractBatch(batch);
    batchResults.push(result);
  }
  const markdown = await synthesize(batchResults, { ...meta, emailCount: emails.length });
  return { markdown, structured: batchResults };
}

module.exports = { buildKnowledgeBase };
