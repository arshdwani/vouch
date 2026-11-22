// Passage retrieval: Confluence pages -> chunks -> BM25 index -> ranked passages for a question.
import { storageToBlocks, sentences, tokens, queryTerms } from './text.js';

const MAX_WORDS = 110;

/**
 * page { id, title, url, body (storage XHTML) } -> chunks [{ id, pageId, title, url, heading, text }].
 * A chunk is consecutive paragraphs under one heading, at most ~110 words; long paragraphs split at sentences.
 */
export function chunkPage(page) {
  const out = [];
  const push = (heading, lines) => {
    const text = lines.join('\n').trim();
    if (text) out.push({ id: `${page.id}#${out.length}`, pageId: String(page.id), title: page.title, url: page.url, heading, text });
  };
  for (const b of storageToBlocks(page.body)) {
    let cur = [];
    let n = 0;
    for (const para of b.text.split('\n')) {
      const pieces = para.split(' ').length > MAX_WORDS ? sentences(para) : [para];
      for (const piece of pieces) {
        const w = piece.split(' ').length;
        if (n + w > MAX_WORDS && cur.length) {
          push(b.heading, cur);
          cur = [];
          n = 0;
        }
        cur.push(piece);
        n += w;
      }
    }
    push(b.heading, cur);
  }
  return out;
}

/** BM25 index over chunks. Each chunk is indexed with its page title and heading, so context words count. */
export function buildIndex(chunks, { k1 = 1.2, b = 0.75 } = {}) {
  const docs = chunks.map((c) => {
    const body = tokens(`${c.title}\n${c.heading}\n${c.text}`);
    const tf = new Map();
    for (const t of body) tf.set(t, (tf.get(t) || 0) + 1);
    return { chunk: c, tf, len: body.length };
  });
  const df = new Map();
  for (const d of docs) for (const t of d.tf.keys()) df.set(t, (df.get(t) || 0) + 1);
  const N = docs.length;
  const avg = docs.reduce((s, d) => s + d.len, 0) / (N || 1);
  const idf = (t) => Math.log(1 + (N - (df.get(t) || 0) + 0.5) / ((df.get(t) || 0) + 0.5));
  return { docs, df, N, avg, k1, b, idf };
}

/**
 * Top passages for a question. Returns [{ chunk, score, matched: [term], terms }], best first.
 * `terms` is the question's term list with idf, shared with the drafting step.
 */
export function search(index, question, k = 5) {
  const terms = queryTerms(question).map((t) => ({ ...t, idf: index.idf(t.term), df: index.df.get(t.term) || 0 }));
  const hits = [];
  for (const d of index.docs) {
    let score = 0;
    const matched = [];
    for (const t of terms) {
      const f = d.tf.get(t.term);
      if (!f) continue;
      matched.push(t.term);
      score += (t.idf * f * (index.k1 + 1)) / (f + index.k1 * (1 - index.b + (index.b * d.len) / (index.avg || 1)));
    }
    if (score > 0) hits.push({ chunk: d.chunk, score, matched });
  }
  hits.sort((a, b) => b.score - a.score || a.chunk.id.localeCompare(b.chunk.id));
  return { terms, hits: hits.slice(0, k) };
}
