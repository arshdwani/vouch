// Grounded answer writing with an LLM: the prompt, and the checks every reply must pass before Vouch uses it.
// Pure (no Forge imports), so the rules are unit-tested. The LLM only sees numbered passages from the company's
// own pages; a reply that cites nothing, cites a passage it wasn't given, or states a number the cited passages
// don't contain is rejected and the deterministic draft is kept.
import { clip } from './text.js';

export const NO_ANSWER = 'NO_ANSWER';
const MAX_PASSAGES = 5;

/** chunks (best first) -> numbered passages [{ n, title, heading, url, pageId, text }]. */
export function numberPassages(chunks) {
  return chunks.slice(0, MAX_PASSAGES).map((c, i) => ({ n: i + 1, title: c.title, heading: c.heading || '', url: c.url, pageId: c.pageId, text: clip(c.text, 900) }));
}

export const SYSTEM_PROMPT = `You answer vendor security questionnaire questions on behalf of a company, using ONLY numbered passages from the company's own policy pages.
Rules:
1. Every statement must be supported by a passage. Cite passages inline as [n].
2. Never add facts, numbers, standards, certifications, product names or commitments that are not in the cited passages.
3. If the passages do not answer the question, reply with exactly {"answer":"NO_ANSWER"}.
4. Write as the company would in the questionnaire: first person plural ("We ..."), direct, at most 3 sentences, plain text.
5. For a yes/no question, start with "Yes." or "No." only if the passages clearly support it, and set "short" to the same word; otherwise "short" is null.
6. Reply with JSON only: {"answer": "...", "short": "Yes" | "No" | null, "citations": [n, ...]}`;

export function userPrompt(question, passages, { yesNo } = {}) {
  const list = passages.map((p) => `[${p.n}] ${p.title}${p.heading ? ` > ${p.heading}` : ''}\n${p.text}`).join('\n\n');
  return `QUESTION (${yesNo ? 'yes/no' : 'open'}): ${question}\n\nPASSAGES:\n${list}`;
}

export const numbersIn = (s) => new Set((String(s).replace(/\[\d+(?:\s*,\s*\d+)*\]/g, ' ').match(/\d+(?:[.,]\d+)?/g) || []).map((n) => n.replace(',', '.')));
export const stripMarkers = (s) => String(s || '').replace(/\s*\[\d+(?:\s*,\s*\d+)*\]/g, '').replace(/\s+([.,;:])/g, '$1').trim();

function parseJson(raw) {
  const s = String(raw || '').trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(s.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * Check a model reply against the passages it was given.
 * Returns { ok: true, noAnswer: true } | { ok: true, text, short, cited: [n] } | { ok: false, reason }.
 */
export function validateReply(raw, passages) {
  const j = parseJson(raw);
  if (!j || typeof j.answer !== 'string') return { ok: false, reason: 'The model did not return the expected JSON.' };
  if (j.answer.trim() === NO_ANSWER || /^NO_ANSWER\b/.test(j.answer.trim())) return { ok: true, noAnswer: true };
  const valid = new Set(passages.map((p) => p.n));
  const inline = [...j.answer.matchAll(/\[(\d+(?:\s*,\s*\d+)*)\]/g)].flatMap((m) => m[1].split(',').map((x) => Number(x.trim())));
  const cited = [...new Set([...(Array.isArray(j.citations) ? j.citations.map(Number) : []), ...inline])].filter(Number.isFinite);
  if (!cited.length) return { ok: false, reason: 'The answer cites no passage.' };
  const bad = cited.filter((n) => !valid.has(n));
  if (bad.length) return { ok: false, reason: `The answer cites passages it was not given (${bad.join(', ')}).` };
  const text = j.answer.trim();
  if (text.length > 900) return { ok: false, reason: 'The answer is too long.' };
  const allowed = new Set(passages.filter((p) => cited.includes(p.n)).flatMap((p) => [...numbersIn(p.text), ...numbersIn(p.title), ...numbersIn(p.heading)]));
  const extra = [...numbersIn(text)].filter((n) => !allowed.has(n));
  if (extra.length) return { ok: false, reason: `The answer states numbers the cited passages don't contain (${extra.join(', ')}).` };
  const lead = /^(yes|no)\b/i.exec(stripMarkers(text));
  const short = j.short === 'Yes' || j.short === 'No' ? j.short : lead ? (lead[1].toLowerCase() === 'yes' ? 'Yes' : 'No') : null;
  return { ok: true, text, short, cited: cited.sort((a, b) => a - b) };
}

/**
 * Merge the deterministic draft with a validated LLM reply into the final draft. The LLM can rewrite an answer or
 * veto it, never invent one: measured live, letting it answer questions the extract left open was the only source
 * of wrong answers (it found tangential passages for two no-policy questions).
 * - The extract found nothing: stays a gap.
 * - NO_ANSWER: the question becomes a gap (routed), whatever the lexical score said.
 * - Answered and cites the page the extract found: keep its confidence; other pages: medium (a reviewer checks).
 */
export function mergeDraft(d, reply, passages) {
  if (d.confidence === 'none') return d;
  if (!reply?.ok) return { ...d, writer: 'extract', writerNote: reply?.reason || null };
  if (reply.noAnswer) {
    return { ...d, confidence: 'none', text: '', short: null, source: null, citations: [], writer: 'llm', why: 'Forge LLM found nothing in the passages that answers this.' };
  }
  const cited = passages.filter((p) => reply.cited.includes(p.n));
  const sameSource = d.source === 'policy' && cited.some((p) => p.pageId === d.citations?.[0]?.pageId);
  const confidence = sameSource ? (d.confidence === 'high' ? 'high' : 'medium') : 'medium';
  return {
    ...d,
    confidence,
    text: reply.text,
    short: reply.short,
    source: 'policy',
    writer: 'llm',
    quote: d.source === 'policy' ? d.text : cited[0]?.text || '',
    citations: cited.map((p) => ({ type: 'confluence', n: p.n, title: p.title, heading: p.heading, url: p.url, pageId: p.pageId, quote: clip(p.text, 240) })),
    why: sameSource ? d.why : `Written from ${cited.map((p) => `[${p.n}] ${p.title}`).join(', ')}; check before approving.`,
  };
}
