// What Vouch does, independent of where it is called from (issue panel, issue action, global page, Rovo, triggers).
//
// A questionnaire row:
//   { qid, row, ref, id, section, text, yesNo, existing,
//     status: 'pending'|'drafted'|'gap'|'routed'|'answered'|'approved'|'existing',
//     confidence: 'high'|'medium'|'none'|null,
//     answer: { text, short, source: 'policy'|'library'|'expert'|'reviewer', citations, by, byName, at } | null,
//     why, passages, topic, missing, experts: { list, via, pages, topic, at } | null, task: { key, ... } | null }
import { randomUUID } from 'node:crypto';
import * as store from './store.js';
import * as products from './products.js';
import * as graphSync from './graph.js';
import { twg, pool, pageAri, userAri, contributorsOf } from './twg.js';
import { UserError } from './errors.js';
import { counts } from './core/counts.js';
export { counts };
import { readXlsx, fillXlsx, buildXlsx } from './core/xlsx.js';
import { parseCsv, writeCsv, fillGrid } from './core/csv.js';
import { detectLayout, extractQuestions, answerWrites } from './core/questionnaire.js';
import { chunkPage, buildIndex } from './core/retrieval.js';
import { draftAnswer, topicWords } from './core/draft.js';
import { rankExperts, pickTeams, topicCql, titleCql, titleWeight } from './core/experts.js';
import { expertTaskDescription, questionnaireDescription } from './core/adf.js';
import { adfText, clip } from './core/text.js';
import { numberPassages, validateReply, mergeDraft, stripMarkers } from './core/grounded.js';
import { runBenchmark } from './core/benchmark.js';
import { SAMPLE_PAGES, SAMPLE_PARENT, SAMPLE_PREFIX, SAMPLE_LIBRARY, SAMPLE_ISSUE, sampleRows, SAMPLE_XLSX_OPTS, SAMPLE_QUESTIONS, SAMPLE_KEY, PARAPHRASED } from './core/sample.js';
import { writeGrounded, llmModel } from './llm.js';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const isXlsx = (a) => /\.xlsx$/i.test(a.filename) || a.mimeType === XLSX_MIME;
const isCsv = (a) => /\.csv$/i.test(a.filename) || a.mimeType === 'text/csv';
const now = () => new Date().toISOString();
const DONE = new Set(['approved', 'answered', 'existing']);
const REDRAFTABLE = new Set(['pending', 'drafted', 'gap']);

// ---- Counts (panel, badge, Rovo) -----------------------------------------------------------------------------

export function badge(qn) {
  if (!qn) return null;
  const c = counts(qn);
  return {
    label: `${c.answered}/${c.total} answered${c.routed ? ` · ${c.routed} with experts` : ''}`,
    type: c.done === c.total ? 'success' : c.routed || c.gaps ? 'inprogress' : 'new',
  };
}

// ---- Import ---------------------------------------------------------------------------------------------------

export async function candidates(issueKey) {
  const issue = await products.getIssue(issueKey);
  return issue.attachments.filter((a) => isXlsx(a) || isCsv(a)).sort((a, b) => String(b.created).localeCompare(String(a.created)));
}

function parseFile(att, buf) {
  if (isCsv(att) && buf[0] !== 0x50) {
    const { grid, delimiter } = parseCsv(buf.toString('utf8'));
    const layout = detectLayout(grid);
    return layout ? { format: 'csv', delimiter, sheet: null, layout, questions: extractQuestions(grid, layout) } : null;
  }
  const { sheets } = readXlsx(buf);
  let best = null;
  for (const s of sheets.filter((x) => !x.hidden)) {
    const layout = detectLayout(s.grid);
    if (!layout) continue;
    const questions = extractQuestions(s.grid, layout);
    if (!best || questions.length > best.questions.length) best = { format: 'xlsx', sheet: { name: s.name, path: s.path }, layout, questions };
  }
  return best;
}

/** Download, parse and store a questionnaire attached to an issue. Re-importing keeps nothing from before. */
export async function importQuestionnaire(issueKey, attachmentId, actorId) {
  const issue = await products.getIssue(issueKey);
  const files = issue.attachments.filter((a) => isXlsx(a) || isCsv(a));
  const att = files.find((a) => String(a.id) === String(attachmentId)) || files.sort((a, b) => String(b.created).localeCompare(String(a.created)))[0];
  if (!att) throw new UserError('Attach the questionnaire to this issue as an .xlsx or .csv file first.');
  if (att.size > 8 * 1024 * 1024) throw new UserError(`${att.filename} is larger than 8 MB. Remove images or extra sheets and attach it again.`);
  const parsed = parseFile(att, await products.downloadAttachment(att.id));
  if (!parsed || !parsed.questions.length) {
    throw new UserError(`Couldn't find the questions in ${att.filename}. Vouch looks for a header such as "Question" in the first 30 rows of each sheet.`);
  }
  const qn = {
    issueKey: issue.key,
    issueId: issue.id,
    projectId: issue.projectId,
    summary: issue.summary,
    attachment: { id: String(att.id), filename: att.filename, mimeType: att.mimeType },
    format: parsed.format,
    delimiter: parsed.delimiter || null,
    sheet: parsed.sheet,
    layout: parsed.layout,
    rows: parsed.questions.map((q) => ({
      ...q,
      status: q.existing ? 'existing' : 'pending',
      confidence: null,
      answer: q.existing ? { text: q.existing, short: null, source: 'existing', citations: [] } : null,
    })),
    createdAt: now(),
    createdBy: actorId,
    exports: [],
  };
  await store.saveQuestionnaire(qn);
  return { issueKey: qn.issueKey, filename: att.filename, sheet: qn.sheet?.name || null, headers: qn.layout.headers, questions: qn.rows.length, existing: qn.rows.filter((r) => r.status === 'existing').length };
}

// ---- Knowledge base and drafting ------------------------------------------------------------------------------

/**
 * The knowledge base: every page in the chosen spaces (up to a cap per space), chunked and indexed, plus the
 * library. When a space is bigger than the cap, `questions` are also searched with CQL inside those spaces, so pages
 * beyond the cap that match a question still get indexed.
 */
export async function knowledge(who = 'user', { questions = [] } = {}) {
  const settings = await store.getSettings();
  if (!settings.spaceKeys.length) throw new UserError('Choose the Confluence spaces Vouch answers from first (Vouch → Settings).');
  const [{ pages, truncated, spaces }, library] = await Promise.all([
    products.spacePages(settings.spaceKeys, { who, maxPerSpace: settings.maxPagesPerSpace || 300 }),
    store.listLibrary(),
  ]);
  let searched = 0;
  if (truncated && questions.length) {
    const have = new Set(pages.map((p) => p.id));
    const found = await pool(questions.slice(0, 60), 6, (q) => {
      const cql = topicCql(topicWords(q, null), { spaces: settings.spaceKeys, any: true });
      return cql ? products.searchPagesWithBodies(cql, 5, who).catch(() => []) : [];
    });
    for (const p of found.flat()) {
      if (!have.has(p.id)) {
        have.add(p.id);
        pages.push(p);
        searched++;
      }
    }
  }
  const chunks = pages.flatMap((p) => chunkPage(p));
  return {
    index: buildIndex(chunks),
    library,
    settings,
    stats: { pages: pages.length, chunks: chunks.length, truncated, searchedExtra: searched, spaces: (spaces || []).map((s) => s.name) },
  };
}

function applyDraft(row, d, index) {
  row.confidence = d.confidence;
  row.why = d.why;
  row.missing = (d.missing || []).slice(0, 5);
  row.passages = (d.passages || []).slice(0, 2).map((p) => ({ ...p, text: clip(p.text, 260) }));
  const words = topicWords(row.text, index, 4);
  const lower = row.text.toLowerCase();
  row.topic = words.sort((a, b) => lower.indexOf(a) - lower.indexOf(b));
  row.experts = null; // a fresh draft means a fresh expert search
  if (d.confidence === 'none') {
    row.status = 'gap';
    row.answer = null;
  } else {
    row.status = 'drafted';
    row.answer = { text: d.text, short: d.short, source: d.source, citations: d.citations, writer: d.writer || 'extract', quote: d.quote || null, at: now() };
  }
}

/**
 * Draft one question: the deterministic extract first; then, when Forge LLM is on and available, a grounded
 * rewrite from the top passages that must pass validateReply, else the extract stands. Library answers are
 * human-approved and are used as they are.
 */
export async function draftOne(question, { index, library, useLlm, yesNo }) {
  const d = draftAnswer(question, index, library);
  if (!useLlm || d.source === 'library' || d.confidence === 'none' || !d.chunks?.length) return d;
  const passages = numberPassages(d.chunks);
  const raw = await writeGrounded(question, passages, { yesNo });
  if (raw == null) return { ...d, writer: 'extract' };
  return mergeDraft(d, validateReply(raw, passages), passages);
}

/**
 * Draft open rows, as many as fit in the time budget (resolvers stop at 25 s), and save after each batch so a
 * closed panel can pick up where it stopped. `redraft` re-opens drafted rows and gaps first.
 * Returns { drafted, remaining, total, ms, knowledge, counts, llm }.
 */
export async function draftQuestionnaire(issueKey, { budgetMs = 12000, redraft = false } = {}) {
  const t0 = Date.now();
  let qn = await store.getQuestionnaire(issueKey);
  if (!qn) throw new UserError('No questionnaire on this issue yet.');
  if (redraft) {
    for (const r of qn.rows) if (r.status === 'drafted' || r.status === 'gap') r.status = 'pending';
    await store.saveQuestionnaire(qn);
  }
  const open = qn.rows.filter((r) => r.status === 'pending');
  if (!open.length) return { drafted: 0, remaining: 0, total: qn.rows.length, ms: 0, knowledge: qn.knowledge || null, counts: counts(qn), llm: qn.llm || null };
  const { index, library, stats, settings } = await knowledge('user', { questions: open.slice(0, 60).map((r) => r.text) });
  const useLlm = settings.llmWriter !== false && !!(await llmModel());
  const batch = useLlm ? 6 : 50;
  let drafted = 0;
  let slowest = 0;
  for (let i = 0; i < open.length; i += batch) {
    // At least one batch per call, so every call makes progress; then only start a batch that should finish in time.
    if (i > 0 && Date.now() - t0 + slowest >= budgetMs) break;
    const tb = Date.now();
    const rows = open.slice(i, i + batch);
    const drafts = await pool(rows, batch, (r) => draftOne(r.text, { index, library, useLlm, yesNo: r.yesNo }));
    qn = await store.getQuestionnaire(issueKey);
    rows.forEach((r, k) => {
      const row = qn.rows.find((x) => x.qid === r.qid);
      if (row && row.status === 'pending') applyDraft(row, drafts[k], index);
    });
    drafted += rows.length;
    slowest = Math.max(slowest, Date.now() - tb);
    qn.draftedAt = now();
    qn.knowledge = stats;
    qn.llm = useLlm;
    await store.saveQuestionnaire(qn);
  }
  const remaining = qn.rows.filter((r) => r.status === 'pending').length;
  return { drafted, remaining, total: qn.rows.length, ms: Date.now() - t0, knowledge: stats, counts: counts(qn), llm: useLlm };
}

// ---- Review -------------------------------------------------------------------------------------------------

async function addToLibrary(entries, { siteUrl } = {}) {
  const r = await graphSync.syncEntries(entries, { siteUrl, appPath: (await store.getMeta('appPath')) || undefined });
  const mark = { ok: r.ok, at: now(), error: r.ok ? null : r.error, connected: r.connected };
  for (const e of entries) await store.saveLibraryEntry({ ...e, graph: mark });
  return r;
}

const libraryEntry = (row, issueKey, answer, actorId, type) => ({
  id: randomUUID(),
  question: row.text,
  text: stripMarkers(answer.text),
  short: answer.short || null,
  citations: (answer.citations || []).filter((c) => c.type !== 'library').map((c) => ({ title: c.title, url: c.url || null })),
  approvedBy: actorId || null,
  approvedByName: answer.byName || null,
  approvedAt: now(),
  tags: row.topic || [],
  source: { type, issueKey, ref: row.id || row.ref },
  uses: 1,
});

/** Approve one row (optionally edited). Approved answers join the library and the Teamwork Graph. */
export async function approve(issueKey, qid, { text, short } = {}, actorId) {
  const qn = await store.getQuestionnaire(issueKey);
  const row = qn?.rows.find((r) => r.qid === qid);
  if (!row) throw new UserError('That question is no longer on this questionnaire. Refresh the panel.');
  const finalText = String(text ?? row.answer?.text ?? '').trim();
  if (!finalText) throw new UserError('Write an answer before approving it.');
  const edited = finalText !== row.answer?.text || (short !== undefined && (short || null) !== (row.answer?.short || null));
  const source = edited ? 'reviewer' : row.answer?.source || 'reviewer';
  row.answer = { ...(row.answer || {}), text: finalText, short: short !== undefined ? short || null : row.answer?.short || null, source, by: actorId, at: now(), edited };
  const wasRouted = row.status === 'routed';
  if (row.status !== 'answered') row.status = 'approved';
  // Answered here while an expert had it: close their sub-task so nobody answers twice.
  if (wasRouted && row.task?.key) await products.transitionToDone(row.task.key, 'user');
  let graph = null;
  const fromLibrary = row.answer.citations?.find((c) => c.type === 'library');
  if (fromLibrary && !edited) {
    const e = await store.getLibraryEntry(fromLibrary.libraryId);
    if (e) await store.saveLibraryEntry({ ...e, uses: (e.uses || 1) + 1, lastUsedAt: now() });
  } else {
    graph = await addToLibrary([libraryEntry(row, issueKey, row.answer, actorId, edited ? 'reviewer' : 'policy')], { siteUrl: await products.siteUrl().catch(() => '') });
  }
  await store.saveQuestionnaire(qn);
  return { row, graph: graph ? { ok: graph.ok, connected: graph.connected, error: graph.error || null } : null, counts: counts(qn) };
}

export async function approveAllHigh(issueKey, actorId) {
  const qn = await store.getQuestionnaire(issueKey);
  if (!qn) throw new UserError('No questionnaire on this issue yet.');
  const entries = [];
  let n = 0;
  for (const row of qn.rows) {
    if (row.status !== 'drafted' || row.confidence !== 'high') continue;
    row.status = 'approved';
    row.answer = { ...row.answer, by: actorId, at: now(), edited: false };
    n++;
    if (!row.answer.citations?.some((c) => c.type === 'library')) entries.push(libraryEntry(row, issueKey, row.answer, actorId, 'policy'));
  }
  const graph = entries.length ? await addToLibrary(entries, { siteUrl: await products.siteUrl().catch(() => '') }) : null;
  await store.saveQuestionnaire(qn);
  return { approved: n, library: entries.length, graph: graph ? { ok: graph.ok, connected: graph.connected, error: graph.error || null } : null, counts: counts(qn) };
}

export async function reopen(issueKey, qid) {
  const qn = await store.getQuestionnaire(issueKey);
  const row = qn?.rows.find((r) => r.qid === qid);
  if (!row) throw new UserError('That question is no longer on this questionnaire. Refresh the panel.');
  if (row.status === 'approved') row.status = row.answer?.text ? 'drafted' : 'gap';
  await store.saveQuestionnaire(qn);
  return { row, counts: counts(qn) };
}

// ---- Experts (Teamwork Graph) ---------------------------------------------------------------------------------

/**
 * Who should answer a gap: Confluence search on the question's topic, then confluencePageContributors (TWG) for
 * each page, ranked; teams from atlassianUserInTeams. Falls back to page creators/editors if TWG returns nothing.
 */
export async function findExperts(question, { topic, cloudId, actorId }) {
  const t0 = Date.now();
  const words = topic?.length ? topic : topicWords(question, null);
  if (!words.length) return { topic: [], pages: [], list: [], via: null, ms: 0, note: 'The question has no searchable topic words.' };
  // Pages titled after the topic first, then full-text matches; the any-word search only if little was found.
  const seen = new Set();
  let pages = [];
  // Two or more pages titled after the topic are its home; broad text matches would only add noise then.
  for (const [cql, enough] of [[titleCql(words), 99], [topicCql(words), 2], [topicCql(words, { any: true }), 3]]) {
    if (pages.length >= enough || !cql) continue;
    for (const p of await products.searchPages(cql, 10).catch(() => [])) {
      if (!seen.has(p.id)) {
        seen.add(p.id);
        pages.push({ ...p, weight: titleWeight(p.title, words), space: p.spaceName || p.spaceKey });
      }
    }
  }
  pages = pages.slice(0, 10);
  // Jira work items on the topic: who is assigned to (or reported) them. Not Vouch's own questionnaire issues.
  const words2 = words.map((w) => String(w).replace(/["\\]/g, ' ').trim()).filter(Boolean);
  const jql = `(${words2.map((w) => `summary ~ "${w}"`).join(' OR ')}) AND (labels is EMPTY OR labels not in (vouch-question, vouch-questionnaire)) ORDER BY updated DESC`;
  const issues = words2.length ? await products.searchIssues(jql, 20).catch(() => []) : [];
  if (!pages.length && !issues.length) {
    return { topic: words, pages: [], list: [], via: null, ms: Date.now() - t0, note: `No Confluence page or Jira work item on this site is about ${words.join(', ')}, so the Teamwork Graph has nobody to suggest.` };
  }

  const results = await pool(pages, 5, (p) => twg('pageContributors', { id: pageAri(cloudId, p.id) }));
  let via = 'Teamwork Graph';
  let withPeople = pages.map((p, i) => ({ ...p, contributors: contributorsOf(results[i]) }));
  if (pages.length && !withPeople.some((p) => p.contributors.length)) {
    via = 'Confluence page history';
    withPeople = pages.map((p) => ({ ...p, contributors: [p.createdBy, p.lastEditedBy].filter(Boolean) }));
  }
  const ids = [...withPeople.flatMap((p) => p.contributors.map((u) => u.accountId)), ...issues.flatMap((i) => [i.assignee?.accountId, i.reporter?.accountId])].filter(Boolean);
  const info = await products.usersInfo(ids).catch(() => ({}));
  const opts = { eligible: (id) => info[id]?.human !== false, topic: words.slice(0, 2).join(' '), issues };
  let ranked = rankExperts(withPeople, { ...opts, exclude: [actorId] }).slice(0, 3);
  let onlyYou = false;
  if (!ranked.length) {
    // On a one-person site the only person who knows is the one asking: say so, and let them take it.
    ranked = rankExperts(withPeople, opts).filter((x) => x.accountId === actorId).slice(0, 1);
    onlyYou = ranked.length > 0;
  }
  await pool(ranked, 3, async (x) => {
    if (info[x.accountId]?.name) x.name = info[x.accountId].name;
    const t = await twg('userTeams', { userId: userAri(x.accountId) });
    x.teams = pickTeams(t.nodes, words);
    x.self = x.accountId === actorId;
  });
  return {
    topic: words,
    pages: pages.map((p) => ({ title: p.title, url: p.url, space: p.spaceName || p.spaceKey })),
    issues: issues.length,
    list: ranked,
    onlyYou,
    via,
    twgCalls: results.length + ranked.length,
    twgOk: results.filter((r) => r.ok).length,
    ms: Date.now() - t0,
    at: now(),
  };
}

export async function suggestExperts(issueKey, qid, ctx) {
  const qn = await store.getQuestionnaire(issueKey);
  const row = qn?.rows.find((r) => r.qid === qid);
  if (!row) throw new UserError('That question is no longer on this questionnaire. Refresh the panel.');
  row.experts = await findExperts(row.text, { topic: row.topic, ...ctx });
  await store.saveQuestionnaire(qn);
  return { row };
}

/** Create the expert's sub-task and mark the row as routed. */
export async function routeToExpert(issueKey, qid, accountId, { actorId, actorName }) {
  const qn = await store.getQuestionnaire(issueKey);
  const row = qn?.rows.find((r) => r.qid === qid);
  if (!row) throw new UserError('That question is no longer on this questionnaire. Refresh the panel.');
  if (row.task?.key) throw new UserError(`This question is already with ${row.task.assigneeName || 'an expert'} in ${row.task.key}.`);
  const expert = row.experts?.list?.find((x) => x.accountId === accountId) || { accountId, name: (await products.usersInfo([accountId]).catch(() => ({})))[accountId]?.name || 'the expert', reason: 'Chosen by the reviewer', titles: [] };
  const [issue, siteUrl] = await Promise.all([products.getIssue(issueKey), products.siteUrl().catch(() => '')]);
  const description = expertTaskDescription({
    question: row.text,
    ref: row.id,
    section: row.section,
    issueKey,
    issueUrl: siteUrl ? `${siteUrl}/browse/${issueKey}` : null,
    expert,
    reason: expert.reason,
    teams: expert.teams || [],
    pages: expert.titles || [],
    issues: expert.issues || [],
    siteUrl,
    passages: row.passages || [],
    requester: actorId ? { accountId: actorId, name: actorName } : null,
  });
  const created = await products.createExpertTask({
    parent: issue.isSubtask ? { ...issue, key: issue.parentKey } : issue,
    summary: clip(`Security question${row.id ? ` ${row.id}` : ''}: ${row.text}`, 250),
    description,
    assignee: accountId,
  });
  await store.saveTask(created.key, { issueKey, qid });
  row.status = 'routed';
  row.task = { key: created.key, url: siteUrl ? `${siteUrl}/browse/${created.key}` : null, assignee: accountId, assigneeName: expert.name, assigned: created.assigned, kind: created.kind, reason: expert.reason, at: now(), by: actorId };
  await store.saveQuestionnaire(qn);
  return { row, task: row.task, counts: counts(qn) };
}

const LEAD = /^\s*(yes|no|n\/a|not applicable)\b[\s.,:;–-]*/i;

/** A comment on an expert's sub-task: the first one becomes the answer (questionnaire + library + graph). */
export async function onExpertComment(subtaskKey, commentId) {
  const link = await store.getTask(subtaskKey);
  if (!link) return { skipped: 'not a Vouch sub-task' };
  const comment = await products.getComment(subtaskKey, commentId, 'app');
  const raw = adfText(comment.body).trim();
  const qn = await store.getQuestionnaire(link.issueKey);
  const row = qn?.rows.find((r) => r.qid === link.qid);
  if (!row || !raw) return { skipped: 'no row or empty comment' };
  // Answered in the panel meanwhile, or a second comment: the first answer stands.
  if (row.status === 'answered' || row.status === 'approved' || !(await store.claim(`comment:${subtaskKey}`))) return { skipped: 'already answered' };
  const lead = LEAD.exec(raw);
  const short = row.yesNo && lead ? (/^y/i.test(lead[1]) ? 'Yes' : /^no$/i.test(lead[1]) ? 'No' : 'N/A') : null;
  const text = (short ? raw.slice(lead[0].length) : raw).replace(/^\w/, (c) => c.toUpperCase()).trim() || raw;
  const siteUrl = await products.siteUrl('app').catch(() => '');
  row.answer = {
    text,
    short,
    source: 'expert',
    by: comment.author?.accountId || null,
    byName: comment.author?.displayName || null,
    at: now(),
    citations: [{ type: 'jira', title: `${subtaskKey} (answer from ${comment.author?.displayName || 'the expert'})`, url: siteUrl ? `${siteUrl}/browse/${subtaskKey}` : null }],
  };
  row.status = 'answered';
  row.confidence = 'high';
  await store.saveQuestionnaire(qn);
  const graph = await addToLibrary([libraryEntry(row, link.issueKey, row.answer, row.answer.by, 'expert')], { siteUrl });
  const closed = await products.transitionToDone(subtaskKey, 'app');
  console.log(`Vouch: ${subtaskKey} answered ${link.issueKey}/${link.qid}; graph ${graph.ok ? 'ok' : graph.error}; closed ${closed}`);
  return { answered: true, closed, graph: graph.ok };
}

// ---- Export ---------------------------------------------------------------------------------------------------

export async function exportQuestionnaire(issueKey, actorId) {
  const qn = await store.getQuestionnaire(issueKey);
  if (!qn) throw new UserError('No questionnaire on this issue yet.');
  const answers = {};
  for (const r of qn.rows) {
    if ((r.status === 'approved' || r.status === 'answered') && r.answer?.text) answers[r.qid] = { ...r.answer, text: stripMarkers(r.answer.text) };
  }
  const n = Object.keys(answers).length;
  if (!n) throw new UserError('Approve at least one answer before exporting.');
  const writes = answerWrites(qn.layout, qn.rows, answers);
  const original = await products.downloadAttachment(qn.attachment.id);
  const base = qn.attachment.filename.replace(/\.(xlsx|csv)$/i, '');
  let data;
  let skipped = [];
  let filename;
  if (qn.format === 'csv') {
    const { grid, delimiter } = parseCsv(original.toString('utf8'));
    data = Buffer.from(`﻿${writeCsv(fillGrid(grid, writes), delimiter)}`, 'utf8');
    filename = `${base} (answered).csv`;
  } else {
    const r = fillXlsx(original, qn.sheet.path, writes.map((w) => ({ ref: w.ref, text: w.text })));
    data = r.buffer;
    skipped = r.skipped;
    filename = `${base} (answered).xlsx`;
  }
  const att = await products.attachFile(issueKey, filename, data, qn.format === 'csv' ? 'text/csv' : XLSX_MIME);
  const c = counts(qn);
  qn.exports = [...(qn.exports || []), { at: now(), by: actorId, filename, attachmentId: att?.id || null, answers: n }].slice(-10);
  await store.saveQuestionnaire(qn);
  return { filename, answers: n, total: c.total, left: c.total - n, skipped: skipped.length, bytes: data.length };
}

// ---- Library --------------------------------------------------------------------------------------------------

export async function deleteLibraryEntry(id) {
  await store.deleteLibraryEntry(id);
  await graphSync.removeEntries([id]);
}

export async function resyncLibrary() {
  const entries = await store.listLibrary();
  const r = await graphSync.syncEntries(entries, { siteUrl: await products.siteUrl().catch(() => ''), appPath: (await store.getMeta('appPath')) || undefined });
  const mark = { ok: r.ok, at: now(), error: r.ok ? null : r.error, connected: r.connected };
  for (const e of entries) await store.saveLibraryEntry({ ...e, graph: mark });
  const probe = r.ok && entries[0] ? await graphSync.indexStatus(entries[0].id) : null;
  return { ...r, total: entries.length, indexStatus: probe };
}

// ---- Rovo helpers ---------------------------------------------------------------------------------------------

export async function answerOne(question) {
  const { index, library, stats, settings } = await knowledge('user', { questions: [question] });
  const useLlm = settings.llmWriter !== false && !!(await llmModel());
  const d = await draftOne(question, { index, library, useLlm, yesNo: /^(do|does|is|are|has|have|can|will)\b/i.test(question.trim()) });
  return { d, stats };
}

export function findRow(qn, ref) {
  const k = String(ref || '').trim().toLowerCase().replace(/^(question|q|number|no\.?|#)\s*/, '');
  if (!k) return null;
  // "14" or "question 14": the 14th question in the sheet.
  if (/^\d+$/.test(k)) return qn.rows[Number(k) - 1] || null;
  return qn.rows.find((r) => r.qid.toLowerCase() === k || String(r.id).toLowerCase() === k) ||
    qn.rows.find((r) => r.text.toLowerCase().includes(k));
}

// ---- Sample data ----------------------------------------------------------------------------------------------

export async function loadSample({ spaceKey, projectKey }, actor) {
  if (!(await products.isJiraAdmin().catch(() => false))) throw new UserError('Only Jira administrators can load the sample.');
  if (!spaceKey || !projectKey) throw new UserError('Choose a Confluence space and a Jira project for the sample.');
  if (await store.getSample()) throw new UserError('The sample is already loaded. Remove it first.');
  const space = await products.spaceByKey(spaceKey);
  if (!space) throw new UserError(`Confluence space ${spaceKey} was not found.`);
  // Sample pages get their own titles and are never reused: Vouch only ever deletes pages it created itself.
  const titles = [SAMPLE_PARENT, ...SAMPLE_PAGES.map((p) => SAMPLE_PREFIX + p.title)];
  for (const t of titles) {
    if (await products.findPage(space.id, t)) throw new UserError(`A page called "${t}" already exists in ${space.name}. Rename or delete it, or choose another space.`);
  }
  const intro = `<p>Ten sample security policies for Brightlake, a fictional SaaS company, created by Vouch's "Load sample". Vouch answers questionnaires from pages like these. Remove sample (Jira → Apps → Vouch) deletes exactly these pages.</p>`;
  const parent = await products.createPage({ spaceId: space.id, title: SAMPLE_PARENT, body: intro });
  const created = [parent.id];
  const pages = await pool(SAMPLE_PAGES, 4, (p) => products.createPage({ spaceId: space.id, parentId: parent.id, title: SAMPLE_PREFIX + p.title, body: p.body }));
  created.push(...pages.map((p) => p.id));
  const siteUrl = await products.siteUrl().catch(() => '');
  const library = SAMPLE_LIBRARY.map((x, i) => ({
    id: `sample-${i + 1}`,
    question: x.question,
    text: x.text,
    short: x.short,
    citations: [],
    approvedBy: actor.accountId,
    approvedAt: now(),
    tags: ['sample'],
    source: { type: 'sample' },
    uses: 0,
  }));
  const graph = await addToLibrary(library, { siteUrl });
  const issue = await products.createIssue({ projectKey, summary: SAMPLE_ISSUE.summary, description: questionnaireDescription(SAMPLE_ISSUE.description) });
  await products.attachFile(issue.key, SAMPLE_ISSUE.filename, buildXlsx(sampleRows(), SAMPLE_XLSX_OPTS), XLSX_MIME);
  const settings = await store.getSettings();
  const addedSpace = !settings.spaceKeys.includes(spaceKey);
  if (addedSpace) await store.saveSettings({ ...settings, spaceKeys: [...settings.spaceKeys, spaceKey], updatedBy: actor.accountId, updatedAt: now() });
  await store.saveSample({ spaceKey, createdPageIds: created, issueKey: issue.key, libraryIds: library.map((l) => l.id), addedSpace, at: now() });
  return { issueKey: issue.key, issueUrl: siteUrl ? `${siteUrl}/browse/${issue.key}` : null, pages: pages.length, library: library.length, graph: graph.ok };
}

export async function removeSample(actor) {
  if (!(await products.isJiraAdmin().catch(() => false))) throw new UserError('Only Jira administrators can remove the sample.');
  const s = await store.getSample();
  if (!s) return { removed: false };
  const qn = s.issueKey ? await store.getQuestionnaire(s.issueKey) : null;
  for (const r of qn?.rows || []) if (r.task?.key) await store.deleteTask(r.task.key);
  if (s.issueKey) {
    await products.deleteIssue(s.issueKey).catch((e) => console.warn('Vouch: sample issue not deleted', e.message));
    await store.deleteQuestionnaire(s.issueKey);
  }
  // Only pages Vouch created (children before the parent). Older sample records listed them as pageIds/parentId.
  const ids = s.createdPageIds ? [...s.createdPageIds].reverse() : [...(s.pageIds || []), s.parentId].filter(Boolean);
  for (const id of ids) await products.deletePage(id).catch(() => null);
  // Sample library answers, and answers approved on the sample questionnaire.
  const fromSample = (await store.listLibrary()).filter((e) => e.source?.issueKey && e.source.issueKey === s.issueKey).map((e) => e.id);
  for (const id of [...(s.libraryIds || []), ...fromSample]) await deleteLibraryEntry(id);
  if (s.addedSpace) {
    const settings = await store.getSettings();
    await store.saveSettings({ ...settings, spaceKeys: settings.spaceKeys.filter((k) => k !== s.spaceKey), updatedBy: actor.accountId, updatedAt: now() });
  }
  await store.deleteSample();
  return { removed: true };
}

export { DONE };

// ---- Answer-quality benchmark (admin, Settings) ----------------------------------------------------------------
// Runs both built-in question sets (the sample questionnaire and the same ground in customer wording) against the
// live knowledge base, once with verbatim extracts and once with the LLM writer, in resumable chunks.

const BENCH_SETS = () => [
  ...SAMPLE_QUESTIONS.map(([ref, , question]) => ({ set: 'original', ref, question, expected: SAMPLE_KEY[ref] })),
  ...PARAPHRASED.map(([ref, question, expected]) => ({ set: 'paraphrased', ref, question, expected })),
];
const outcome = (d) => ({ confidence: d.confidence, source: d.source, cited: d.source === 'library' ? 'library' : d.citations?.[0]?.title || null, writer: d.writer || 'extract' });

export async function benchmarkNext({ restart = false, budgetMs = 15000 } = {}) {
  const t0 = Date.now();
  let b = restart ? null : await store.getBenchmark();
  if (!b || b.done) {
    if (b?.done && !restart) return summarizeBenchmark(b);
    b = { startedAt: now(), items: BENCH_SETS().map((x) => ({ ...x, det: null, llm: null })), done: false };
  }
  const k = await knowledge('user', { questions: b.items.map((x) => x.question) });
  const { index, settings, stats } = k;
  // Only the sample's own library answers, so answers approved later don't hide what retrieval would do.
  const library = k.library.filter((e) => e.source?.type === 'sample');
  const useLlm = settings.llmWriter !== false && !!(await llmModel());
  b.llmAvailable = useLlm;
  b.knowledge = stats;
  for (const it of b.items) if (!it.det) it.det = outcome(draftAnswer(it.question, index, library));
  const todo = b.items.filter((x) => !x.llm);
  for (let i = 0; i < todo.length && useLlm && Date.now() - t0 < budgetMs; i += 6) {
    const part = todo.slice(i, i + 6);
    const out = await pool(part, 6, (x) => draftOne(x.question, { index, library, useLlm, yesNo: /^(do|does|is|are|has|have|can|will)\b/i.test(x.question) }));
    part.forEach((x, k) => (x.llm = outcome(out[k])));
  }
  b.done = !useLlm || b.items.every((x) => x.llm);
  await store.saveBenchmark(b);
  return summarizeBenchmark(b);
}

export async function summarizeBenchmark(b) {
  if (!b) return null;
  const res = {};
  for (const set of ['original', 'paraphrased']) {
    const items = b.items.filter((x) => x.set === set);
    res[set] = {};
    for (const mode of ['det', 'llm']) {
      if (items.some((x) => !x[mode])) continue;
      const by = Object.fromEntries(items.map((x) => [x.ref, x[mode]]));
      res[set][mode] = await runBenchmark(items, (q) => {
        const o = by[items.find((x) => x.question === q).ref];
        return { confidence: o.confidence, source: o.source, citations: o.cited && o.cited !== 'library' ? [{ title: o.cited }] : [] };
      });
    }
  }
  return { startedAt: b.startedAt, done: b.done, llmAvailable: b.llmAvailable, progress: { done: b.items.filter((x) => x.llm).length, total: b.items.length }, knowledge: b.knowledge, results: res };
}
