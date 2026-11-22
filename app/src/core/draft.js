// Grounded drafting: the answer is copied from the best passages (never invented), with a citation and a
// confidence the reviewer can trust. No LLM. Deterministic.
import { search } from './retrieval.js';
import { queryTerms, sentences, tokens, clip, words, stem, isStop } from './text.js';
import { isYesNoQuestion } from './questionnaire.js';

export const THRESHOLDS = { highChunk: 0.6, highSentence: 0.35, mediumChunk: 0.35, mediumSentence: 0.2, libraryHigh: 0.7, libraryMedium: 0.5 };
const MAX_ANSWER_WORDS = 80;
const NEGATION = /\b(not|no|never|none|cannot|can't|won't|don't|doesn't|isn't|aren't|prohibited|forbidden)\b/i;

// idf-weighted share of the question's terms that `has` covers. A short question (3 terms or fewer) hinges on each
// word, so a word the knowledge base never mentions ("officer" in "Do you have a Data Protection Officer?") counts
// double.
const weight = (terms, has) => {
  const w = (t) => (terms.length <= 3 && t.df === 0 ? 2 * t.idf : t.idf);
  const total = terms.reduce((s, t) => s + w(t), 0) || 1;
  return terms.filter((t) => has(t.term)).reduce((s, t) => s + w(t), 0) / total;
};

function pickSentences(chunk, terms) {
  const list = sentences(chunk.text);
  const scored = list.map((s, i) => {
    const set = new Set(tokens(s));
    const hit = terms.filter((t) => set.has(t.term));
    return { i, s, set, hit, score: hit.reduce((a, t) => a + t.idf, 0) + (s.split(' ').length < 5 ? -1 : 0) };
  });
  const ranked = [...scored].sort((a, b) => b.score - a.score || a.i - b.i);
  const first = ranked[0];
  if (!first || first.score <= 0) return { text: '', set: new Set() };
  const chosen = [first];
  let wordsN = first.s.split(' ').length;
  // A sentence that introduces a list ("Access reviews cover:") brings its items along.
  if (/:$/.test(first.s)) {
    for (const next of scored.slice(first.i + 1, first.i + 5)) {
      if (wordsN + next.s.split(' ').length > MAX_ANSWER_WORDS) break;
      chosen.push(next);
      wordsN += next.s.split(' ').length;
    }
  } else {
    const second = ranked.slice(1).find((x) => x.score > 0 && x.hit.some((t) => !first.set.has(t.term)));
    if (second && wordsN + second.s.split(' ').length <= MAX_ANSWER_WORDS) chosen.push(second);
  }
  chosen.sort((a, b) => a.i - b.i);
  let text;
  if (/:$/.test(chosen[0].s) && chosen.length > 1) {
    text = `${chosen[0].s} ${chosen.slice(1).map((x) => x.s.replace(/[.;,]$/, '')).join('; ')}.`;
  } else text = chosen.map((x) => x.s).join(' ');
  const set = new Set();
  for (const x of chosen) for (const t of x.set) set.add(t);
  return { text: /[.!?]$/.test(text) ? text : `${text.replace(/[;:,]$/, '')}.`, set };
}

/**
 * Best approved library answer for a question: { entry, score } or null. Score = how much of the question the
 * library question covers (idf-weighted), with the library question's extra words counting half against it.
 */
export function matchLibrary(question, library, idf) {
  const q = queryTerms(question);
  const qSum = q.reduce((s, t) => s + idf(t.term), 0) || 1;
  let best = null;
  for (const entry of library || []) {
    const eSet = new Set(queryTerms(entry.question).map((t) => t.term));
    const qSet = new Set(q.map((t) => t.term));
    const common = q.filter((t) => eSet.has(t.term)).reduce((s, t) => s + idf(t.term), 0);
    const extra = [...eSet].filter((t) => !qSet.has(t)).reduce((s, t) => s + idf(t), 0);
    const score = common / (qSum + 0.5 * extra);
    if (!best || score > best.score) best = { entry, score };
  }
  return best;
}

/**
 * Draft one answer. Returns {
 *   confidence: 'high'|'medium'|'none', text, short ('Yes'|null), source: 'library'|'policy'|null,
 *   citations: [{ type, title, url, heading, quote, libraryId }], passages: [...top 3], matched, missing, why }
 */
export function draftAnswer(question, index, library = [], t = THRESHOLDS) {
  const found = search(index, question, 5);
  const d = draftFrom(question, found, index, library, t);
  // The top chunks, for the LLM writer. Not enumerable, so they never reach storage.
  Object.defineProperty(d, 'chunks', { value: found.hits.map((h) => h.chunk), enumerable: false });
  return d;
}

function draftFrom(question, { terms, hits }, index, library, t) {
  const passages = hits.slice(0, 3).map((h) => ({
    title: h.chunk.title,
    url: h.chunk.url,
    heading: h.chunk.heading,
    text: clip(h.chunk.text, 320),
    score: Math.round(h.score * 100) / 100,
  }));
  const yesNo = isYesNoQuestion(question);
  const lib = matchLibrary(question, library, index.idf);
  const fromLibrary = (confidence) => ({
    confidence,
    text: lib.entry.text,
    short: yesNo ? lib.entry.short || null : null,
    source: 'library',
    citations: [{ type: 'library', title: 'Answer library', libraryId: lib.entry.id, approvedBy: lib.entry.approvedBy || null, quote: clip(lib.entry.question, 160) }],
    passages,
    matched: [],
    missing: [],
    why: `Matches an approved library answer (${Math.round(lib.score * 100)}% overlap with "${clip(lib.entry.question, 80)}")`,
  });
  if (lib && lib.score >= t.libraryHigh) return fromLibrary('high');

  const best = hits[0];
  const none = (why) => ({ confidence: 'none', text: '', short: null, source: null, citations: [], passages, matched: [], missing: terms.filter((x) => x.df === 0).map((x) => x.word), why });
  if (!terms.length) return none('The question has no searchable words.');
  if (!best) return lib && lib.score >= t.libraryMedium ? fromLibrary('medium') : none('No passage in the knowledge spaces mentions this topic.');

  const chunkSet = new Set(tokens(`${best.chunk.title}\n${best.chunk.heading}\n${best.chunk.text}`));
  const chunkCov = weight(terms, (x) => chunkSet.has(x));
  const picked = pickSentences(best.chunk, terms);
  const sentCov = weight(terms, (x) => picked.set.has(x));
  const matched = terms.filter((x) => chunkSet.has(x.term)).map((x) => x.word);
  const missing = terms.filter((x) => !chunkSet.has(x.term)).sort((a, b) => b.idf - a.idf).map((x) => x.word);
  let confidence = 'none';
  if (picked.text && chunkCov >= t.highChunk && sentCov >= t.highSentence) confidence = 'high';
  else if (picked.text && chunkCov >= t.mediumChunk && sentCov >= t.mediumSentence) confidence = 'medium';
  // A close approved answer beats a passage that only partly covers the question.
  if (confidence !== 'high' && lib && lib.score >= t.libraryMedium) return fromLibrary('medium');
  if (confidence === 'none') {
    return { ...none(`Closest passage covers ${Math.round(chunkCov * 100)}% of the question${missing.length ? `; nothing on ${missing.slice(0, 3).join(', ')}` : ''}.`), matched, missing };
  }
  const where = best.chunk.heading ? `${best.chunk.title} › ${best.chunk.heading}` : best.chunk.title;
  return {
    confidence,
    text: picked.text,
    short: yesNo && !NEGATION.test(picked.text) ? 'Yes' : null,
    source: 'policy',
    citations: [{ type: 'confluence', title: best.chunk.title, url: best.chunk.url, heading: best.chunk.heading, quote: clip(picked.text, 240), pageId: best.chunk.pageId }],
    passages,
    matched,
    missing,
    why: `Covers ${Math.round(chunkCov * 100)}% of the question in "${where}"${missing.length ? `; not mentioned: ${missing.slice(0, 3).join(', ')}` : ''}.`,
    coverage: { chunk: Math.round(chunkCov * 100) / 100, sentence: Math.round(sentCov * 100) / 100 },
  };
}

const CANONICAL = new Set(('mfa sso privileged jit accessreview access offboard revoke tenantisolation leastprivilege rbac atrest intransit tls aes byod kms rotate ' +
  'contractend delete export auditlog residency breach notify incident tabletop oncall rpo rto redundancy disasterrecovery bcp restore ' +
  'subprocessor thirdparty dpa codereview sast depscan cicd proddata testenv pentest vdp vulnscan vulnerability patch sdlc ' +
  'backgroundcheck phishing awareness physicalaccess datacenter approve leadership soc2 iso27001 edr dlp siem acceptableuse').split(' '));
// Words that say nothing about who would know the answer.
const VAGUE = /^(often|frequency|annual|annually|regularly|currently|least|time|times|year|years|frequently|typically|external|internal|corporate|company|staff|employees?|team|teams|new|first|week|weeks|last|month|months|platform|systems?|share|details|latest|current|used|customers?|data|information|security|formal|please|state|limit|level|enforce|enforced|apply|applied|support|supported|follow|report|reports|domains?)$/;

/** The topic words of a question as people wrote them, most specific first (for expert search and reasons). */
export function topicWords(question, index, n = 3) {
  const raw = ` ${String(question).toLowerCase()} `;
  const seen = new Map();
  for (const w of words(question)) {
    // Canonical tokens ("pentest") read badly; keep them only when the question used that word itself ("MFA").
    if (isStop(w) || w.length < 3 || VAGUE.test(w) || (CANONICAL.has(w) && !new RegExp(`[^a-z]${w}[^a-z]`).test(raw))) continue;
    const t = stem(w);
    if (!seen.has(t)) seen.set(t, { term: t, word: w, idf: index ? index.idf(t) : 1, pos: seen.size });
  }
  return [...seen.values()].sort((a, b) => b.idf - a.idf || a.pos - b.pos).slice(0, n).map((t) => t.word);
}
