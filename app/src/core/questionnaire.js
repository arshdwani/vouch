// Finds the questions in a questionnaire grid: which row holds the headers, which column holds the questions,
// and where answers go (a Yes/No column, a free-text column, or both). Works on any 2D array of cell text, so XLSX
// and CSV share it.
import { colName } from './xlsx.js';

const H = {
  question: /\b(questions?|question text|requirements?|control (question|statement|description|requirement)|query|ask)\b/i,
  questionWeak: /\b(description|item|control|criteria|requirement)\b/i,
  yesno: /\b(yes\s*\/\s*no|y\s*\/\s*n|yes,? no|compliant|compliance status|in place|implemented\?|caiq answer|answer \(yes)/i,
  answer: /\b(answers?|responses?|reply|vendor (answer|response)|supplier (answer|response)|your (answer|response))\b/i,
  comment: /\b(comments?|notes?|additional (info|information|details|comments)|explanation|evidence|details|remarks|justification|implementation (description|details)|supporting|description of)\b/i,
  id: /^(#|id|no\.?|num(ber)?|ref(erence)?|q\s*#|q\.?\s*no\.?|question (id|#|number|no\.?)|item (id|#|no\.?)|control id|s\.?\s*no\.?)$/i,
  section: /^(category|domain|section|area|topic|control (domain|family|area)|group)$/i,
};
const YESNO_VALUES = /^(yes|no|n\/?a|y|n|partial(ly)?|true|false)$/i;

const cleanHeader = (s) => String(s || '').replace(/\s+/g, ' ').trim();

function headerScore(row) {
  let score = 0;
  let q = -1;
  row.forEach((cell, c) => {
    const h = cleanHeader(cell);
    if (!h || h.length > 80) return;
    if (H.question.test(h)) {
      score += 4;
      if (q < 0) q = c;
    } else if (H.yesno.test(h) || H.answer.test(h)) score += 2;
    else if (H.comment.test(h) || H.id.test(h) || H.section.test(h)) score += 1;
  });
  return { score, q };
}

/**
 * grid -> layout { headerRow, cols: { question, id?, section?, yesno?, text }, addHeader?, headers } or null.
 * `text` is the column that receives the written answer; `yesno` (optional) receives Yes/No. When the sheet has no
 * answer column at all, `text` is a new column after the last header and `addHeader` names it.
 */
export function detectLayout(grid) {
  let best = null;
  const consider = (r, row, last) => {
    const { score, q } = headerScore(row);
    let qc = q;
    if (qc < 0) qc = row.findIndex((c) => H.questionWeak.test(cleanHeader(c)) && cleanHeader(c).length <= 40);
    if (qc < 0 || score < 2) return;
    if (!best || score > best.score) best = { r: last, score, qc, row };
  };
  for (let r = 0; r < Math.min(grid.length, 30); r++) {
    const row = grid[r] || [];
    consider(r, row, r);
    // Two-row headers ("Response" merged over "Yes/No" and "Comments"): read both rows as one.
    const next = grid[r + 1] || [];
    if (next.some(Boolean) && !next.some((c) => String(c).includes('?'))) {
      consider(r, row.map((c, i) => [c, next[i]].filter(Boolean).join(' ')), r + 1);
    }
  }
  if (!best) return null;
  const header = best.row.map(cleanHeader);
  const below = grid.slice(best.r + 1, best.r + 60);
  const values = (c) => below.map((row) => row[c]).filter(Boolean);
  const cols = { question: best.qc };
  header.forEach((h, c) => {
    if (!h || c === best.qc) return;
    const vals = values(c);
    const mostlyYesNo = vals.length >= 3 && vals.filter((v) => YESNO_VALUES.test(v)).length / vals.length >= 0.8;
    if (H.id.test(h) && cols.id == null && c < best.qc) cols.id = c;
    else if (H.section.test(h) && cols.section == null) cols.section = c;
    else if ((H.yesno.test(h) || (H.answer.test(h) && mostlyYesNo)) && cols.yesno == null) cols.yesno = c;
    else if (H.answer.test(h) && cols.text == null) cols.text = c;
    else if (H.comment.test(h) && cols.comment == null && c > best.qc) cols.comment = c;
  });
  // A "Response" column with no separate comments column takes the whole answer ("Yes. Data is encrypted ...").
  let addHeader = null;
  if (cols.text == null) {
    if (cols.comment != null) cols.text = cols.comment;
    else if (cols.yesno != null) {
      cols.text = cols.yesno;
      delete cols.yesno;
    } else {
      cols.text = Math.max(header.length, best.qc + 1);
      addHeader = 'Answer (Vouch)';
    }
  }
  delete cols.comment;
  if (cols.yesno === cols.text) delete cols.yesno;
  return {
    headerRow: best.r,
    cols,
    addHeader,
    headers: {
      question: header[cols.question],
      text: addHeader || header[cols.text],
      yesno: cols.yesno != null ? header[cols.yesno] : null,
    },
  };
}

const QSTART = /^(do|does|did|is|are|was|were|has|have|can|could|will|would|should|shall)\b/i;
const IMPERATIVE = /^(describe|explain|provide|list|indicate|confirm|state|specify|outline|detail|attach|identify|summari[sz]e|share|upload|please|how|what|which|who|when|where)\b/i;
export const isYesNoQuestion = (text) => QSTART.test(String(text).replace(/^[\s\d.)(:-]*(q\d+[.:)]?)?\s*/i, ''));

/**
 * grid + layout -> questions [{ qid, row (0-based), ref: 'C7', id, section, text, yesNo, existing }].
 * Rows that only name a section ("Encryption", "3. Access control") set `section` for the questions below them.
 */
export function extractQuestions(grid, layout) {
  const { cols } = layout;
  const out = [];
  let section = '';
  for (let r = layout.headerRow + 1; r < grid.length; r++) {
    const row = grid[r] || [];
    const text = String(row[cols.question] || '').replace(/\s+/g, ' ').trim();
    const id = cols.id != null ? row[cols.id] || '' : '';
    if (cols.section != null && row[cols.section]) section = row[cols.section];
    if (!text) {
      // A label in the first columns with an empty question cell is a section row.
      const label = row.slice(0, cols.question).find(Boolean);
      if (label && cols.section == null && !/^\d+(\.\d+)*$/.test(label)) section = label;
      continue;
    }
    const others = row.some((v, c) => v && c !== cols.question && c !== cols.id && c !== cols.section);
    const sectionRow =
      !text.includes('?') && text.split(' ').length <= 6 && !QSTART.test(text) && !IMPERATIVE.test(text) && !others &&
      (cols.id == null || !id || /^([A-Z]|\d+)\.?$/.test(id));
    if (sectionRow) {
      section = text;
      continue;
    }
    if (text.length < 8) continue;
    const existing = [row[cols.text], cols.yesno != null ? row[cols.yesno] : ''].filter(Boolean).join(' · ');
    out.push({
      qid: `r${r + 1}`,
      row: r,
      ref: `${colName(cols.question)}${r + 1}`,
      id: String(id),
      section: String(section || ''),
      text,
      yesNo: isYesNoQuestion(text),
      existing: existing || '',
    });
  }
  return out;
}

/** Cell writes for export. answers: { [qid]: { text, short } }. Returns [{ row, col, ref, text }]. */
export function answerWrites(layout, questions, answers) {
  const out = [];
  const { cols } = layout;
  if (layout.addHeader) out.push({ row: layout.headerRow, col: cols.text, ref: `${colName(cols.text)}${layout.headerRow + 1}`, text: layout.addHeader });
  for (const q of questions) {
    const a = answers[q.qid];
    if (!a || !a.text) continue;
    if (cols.yesno != null) {
      if (a.short) out.push({ row: q.row, col: cols.yesno, ref: `${colName(cols.yesno)}${q.row + 1}`, text: a.short });
      out.push({ row: q.row, col: cols.text, ref: `${colName(cols.text)}${q.row + 1}`, text: a.text });
    } else {
      const text = a.short && !a.text.startsWith(a.short) ? `${a.short}. ${a.text}` : a.text;
      out.push({ row: q.row, col: cols.text, ref: `${colName(cols.text)}${q.row + 1}`, text });
    }
  }
  return out;
}
