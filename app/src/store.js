// Persistence on Forge Key-Value Storage (KVS).
//   settings              { spaceKeys, llm, updatedBy, updatedAt }
//   qn:<issueKey>         one questionnaire: file, layout and rows (see service.js for the row shape)
//   lib:<id>              one approved answer in the library
//   task:<subtaskKey>     { issueKey, qid }: which question an expert sub-task answers
//   graph:connection      { connectionId, name, at }: the Teamwork Graph connection an admin created
//   sample                what "Load sample" created, so it can be removed again
//   claim:<key>           exactly-once markers for side effects triggered by events
import { kvs, WhereConditions } from '@forge/kvs';
import { counts } from './core/counts.js';

async function listPrefix(prefix) {
  const out = [];
  let cursor;
  do {
    let q = kvs.query().where('key', WhereConditions.beginsWith(prefix)).limit(100);
    if (cursor) q = q.cursor(cursor);
    const page = await q.getMany();
    for (const r of page.results || []) out.push(r.value);
    cursor = page.nextCursor;
  } while (cursor);
  return out;
}

// llmWriter: write answers with Forge LLM (grounded, validated) when the site has it; off = verbatim extracts only.
export const DEFAULT_SETTINGS = { spaceKeys: [], llmWriter: true };
export const getSettings = async () => ({ ...DEFAULT_SETTINGS, ...((await kvs.get('settings')) || {}) });
export const saveSettings = (s) => kvs.set('settings', s);

// A questionnaire is stored as its header (qn:<issueKey>, with progress counts) plus its rows in parts of 25
// (qnr:<issueKey>:<n>), because one KVS value holds at most 240 KB and a 200-row questionnaire with citations is more.
const ROWS_PER_PART = 25;

export async function getQuestionnaire(issueKey) {
  const head = await kvs.get(`qn:${issueKey}`);
  if (!head || !head.parts) return head;
  const parts = await Promise.all(Array.from({ length: head.parts }, (_, i) => kvs.get(`qnr:${issueKey}:${i}`)));
  return { ...head, rows: parts.flatMap((p) => p || []) };
}

export async function saveQuestionnaire(qn) {
  const { rows = [], ...head } = qn;
  const parts = Math.max(1, Math.ceil(rows.length / ROWS_PER_PART));
  await Promise.all(Array.from({ length: parts }, (_, i) => kvs.set(`qnr:${qn.issueKey}:${i}`, rows.slice(i * ROWS_PER_PART, (i + 1) * ROWS_PER_PART))));
  await kvs.set(`qn:${qn.issueKey}`, { ...head, parts, counts: counts({ rows }), routedAny: rows.some((r) => r.task), approvedAny: rows.some((r) => r.status === 'approved' || r.status === 'answered') });
}

export async function deleteQuestionnaire(issueKey) {
  const head = await kvs.get(`qn:${issueKey}`);
  for (let i = 0; i < (head?.parts || 0); i++) await kvs.delete(`qnr:${issueKey}:${i}`);
  await kvs.delete(`qn:${issueKey}`);
}

/** Headers only (no rows): issueKey, summary, attachment, counts, exports... */
export const listQuestionnaires = () => listPrefix('qn:');

export const listLibrary = async () => (await listPrefix('lib:')).sort((a, b) => String(b.approvedAt).localeCompare(String(a.approvedAt)));
export const getLibraryEntry = (id) => kvs.get(`lib:${id}`);
export const saveLibraryEntry = (e) => kvs.set(`lib:${e.id}`, e);
export const deleteLibraryEntry = (id) => kvs.delete(`lib:${id}`);

export const getTask = (key) => kvs.get(`task:${key}`);
export const saveTask = (key, v) => kvs.set(`task:${key}`, v);
export const deleteTask = (key) => kvs.delete(`task:${key}`);

export const getConnection = () => kvs.get('graph:connection');
export const saveConnection = (c) => kvs.set('graph:connection', c);
export const deleteConnection = () => kvs.delete('graph:connection');

export const getSample = () => kvs.get('sample');
export const saveSample = (s) => kvs.set('sample', s);
export const deleteSample = () => kvs.delete('sample');

/** Atomic "first one wins" claim, so a duplicated event can't apply an expert answer twice. */
export async function claim(key) {
  try {
    await kvs.set(`claim:${key}`, Date.now(), { keyPolicy: 'FAIL_IF_EXISTS' });
    return true;
  } catch (_) {
    return false;
  }
}

export const getBenchmark = () => kvs.get('benchmark');
export const saveBenchmark = (b) => kvs.set('benchmark', b);

export const getMeta = (k) => kvs.get(`meta:${k}`);
export const setMeta = (k, v) => kvs.set(`meta:${k}`, v);
