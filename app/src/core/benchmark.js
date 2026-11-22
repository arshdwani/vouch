// Answer-quality benchmark: runs a drafting function over questions with an answer key and counts outcomes.
// A wrong answer is the cardinal sin: a confident (high or medium) answer that cites the wrong source, or any
// answer to a question that has no policy.

// Sample pages carry a 'Brightlake sample – ' prefix on the site; the answer key uses the plain titles.
const norm = (t) => String(t || '').replace(/^Brightlake sample – /, '');
const ok = (expected, cited) => [].concat(expected).includes(norm(cited)) || [].concat(expected).includes(cited);

/** draft: (question) => { confidence, source, citations }. items: [{ ref, question, expected }]. */
export async function runBenchmark(items, draft) {
  const out = { total: items.length, high: 0, medium: 0, none: 0, correct: 0, wrong: 0, missed: 0, wrongList: [], missedList: [] };
  for (const it of items) {
    const d = await draft(it.question);
    out[d.confidence] = (out[d.confidence] || 0) + 1;
    const cited = d.source === 'library' ? 'library' : d.citations?.[0]?.title || null;
    if (d.confidence === 'none') {
      if (it.expected == null) out.correct++;
      else {
        out.missed++;
        out.missedList.push(it.ref);
      }
    } else if (it.expected != null && ok(it.expected, cited)) out.correct++;
    else {
      out.wrong++;
      out.wrongList.push(`${it.ref} (${d.confidence}: ${cited || 'none'})`);
    }
  }
  return out;
}

export const summary = (r) => `${r.high} high, ${r.medium} medium, ${r.none} none · ${r.correct}/${r.total} correct · ${r.wrong} wrong · ${r.missed} missed`;
