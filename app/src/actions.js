// Rovo actions (also used by the answer-security-question skill). Each returns plain JSON with explicit sources, so
// the agent never has to invent provenance.
import * as svc from './service.js';
import * as store from './store.js';
import * as products from './products.js';
import { friendly } from './errors.js';
import { stripMarkers } from './core/grounded.js';

const issueKeyFrom = (payload) => payload?.issueKey || payload?.context?.jira?.issueKey;
const wrap = (fn) => async (payload) => {
  try {
    return await fn(payload);
  } catch (e) {
    console.error(e);
    return { error: friendly(e) };
  }
};
// One source per page (the LLM may cite several passages of the same page), with the sections it drew on.
function sourcesOf(citations = []) {
  const out = new Map();
  for (const c of citations) {
    if (c.type === 'library') {
      out.set('library', { type: 'approved answer library', title: c.quote ? `Approved answer to "${c.quote}"` : 'Approved answer', url: null });
      continue;
    }
    const key = c.url || c.title;
    const x = out.get(key) || { type: c.type === 'jira' ? 'expert answer' : 'Confluence page', title: c.title, sections: [], url: c.url || null };
    if (c.heading && !x.sections.includes(c.heading)) x.sections.push(c.heading);
    out.set(key, x);
  }
  // A ready-made markdown link, so the agent shows the page title rather than the raw address.
  return [...out.values()].map((x) => ({ ...x, markdown: x.url ? `[${x.title}](${x.url})` : x.title }));
}

// answer-security-question (GET)
export const answerQuestion = wrap(async (payload) => {
  const question = String(payload?.question || '').trim();
  if (question.length < 8) return { error: 'Give the full question to answer.' };
  const { d, stats } = await svc.answerOne(question);
  if (d.confidence === 'none') {
    return {
      answer: null,
      confidence: 'none',
      note: 'No approved policy or library answer covers this. Do not answer from general knowledge. Offer to route it to an expert (on a questionnaire issue), or say who to ask.',
      reason: d.why,
      nearestPassages: d.passages.slice(0, 2).map((p) => ({ title: p.title, url: p.url, excerpt: p.text })),
      searched: stats,
    };
  }
  const text = stripMarkers(d.text);
  return {
    answer: d.short && !/^(yes|no)\b/i.test(text) ? `${d.short}. ${text}` : text,
    confidence: d.confidence,
    writtenBy: d.writer === 'llm' ? 'Forge LLM, from the cited passages only (checked: every claim cites a source, no added numbers)' : 'quoted verbatim from the sources',
    quotedVerbatimFromSources: d.writer !== 'llm',
    sources: sourcesOf(d.citations),
    reason: d.why,
  };
});

// questionnaire-status (GET)
export const questionnaireStatus = wrap(async (payload) => {
  const key = issueKeyFrom(payload);
  if (!key) return { error: 'Which Jira issue holds the questionnaire? Give its key, e.g. SEC-12.' };
  const qn = await store.getQuestionnaire(key);
  if (!qn) return { issueKey: key, status: 'No questionnaire has been imported on this issue. Use "Answer with Vouch" on the issue.' };
  const c = svc.counts(qn);
  return {
    issueKey: key,
    file: qn.attachment.filename,
    summary: svc.badge(qn).label,
    counts: { total: c.total, approved: c.approved, answeredByExperts: c.expert, draftsToReview: c.toReview, gapsNotRouted: c.gaps, withExperts: c.routed },
    gaps: qn.rows.filter((r) => r.status === 'gap').slice(0, 10).map((r) => ({ ref: r.id || r.qid, question: r.text })),
    withExperts: qn.rows.filter((r) => r.status === 'routed').map((r) => ({ ref: r.id || r.qid, question: r.text, expert: r.task?.assigneeName, subtask: r.task?.key, why: r.task?.reason })),
    lastExport: (qn.exports || []).slice(-1)[0]?.filename || null,
  };
});

// route-question-to-expert (CREATE)
export const routeQuestion = wrap(async (payload) => {
  const key = issueKeyFrom(payload);
  const qn = key ? await store.getQuestionnaire(key) : null;
  if (!qn) return { error: 'Routing works on a questionnaire issue. Give the issue key of an imported questionnaire.' };
  const row = svc.findRow(qn, payload?.question);
  if (!row) return { error: `No question matching "${payload?.question}" on ${key}. Use its reference (e.g. GAP-03) or words from it.` };
  if (row.task?.key) return { alreadyRouted: true, subtask: row.task.key, expert: row.task.assigneeName, why: row.task.reason };
  const ctx = { cloudId: payload?.context?.cloudId, actorId: payload?.context?.accountId };
  if (!row.experts?.list?.length) await svc.suggestExperts(key, row.qid, ctx);
  const fresh = (await store.getQuestionnaire(key)).rows.find((r) => r.qid === row.qid);
  const top = fresh.experts?.list?.[0];
  if (!top) return { routed: false, reason: fresh.experts?.note || 'Nobody in the Teamwork Graph has contributed to pages on this topic.' };
  const me = ctx.actorId ? await products.usersInfo([ctx.actorId]).catch(() => ({})) : {};
  const r = await svc.routeToExpert(key, row.qid, top.accountId, { actorId: ctx.actorId, actorName: me[ctx.actorId]?.name });
  return { routed: true, question: row.text, expert: top.name, why: top.reason, teams: top.teams || [], subtask: r.task.key, subtaskUrl: r.task.url, foundVia: fresh.experts.via };
});
