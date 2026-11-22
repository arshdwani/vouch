import test from 'node:test';
import assert from 'node:assert/strict';
import { numberPassages, validateReply, mergeDraft, stripMarkers, userPrompt, SYSTEM_PROMPT } from '../src/core/grounded.js';

const passages = numberPassages([
  { title: 'Encryption Standard', heading: 'Data at rest', url: 'u1', pageId: '1', text: 'All customer data at rest is encrypted with AES-256, including backups.' },
  { title: 'Business Continuity', heading: 'Recovery objectives', url: 'u2', pageId: '2', text: 'Our RTO is 4 hours and our RPO is 1 hour.' },
]);
const det = { confidence: 'high', text: 'All customer data at rest is encrypted with AES-256, including backups.', short: 'Yes', source: 'policy', citations: [{ type: 'confluence', title: 'Encryption Standard', pageId: '1' }], why: 'Covers 100%' };

test('prompt carries the rules and the numbered passages', () => {
  assert.match(SYSTEM_PROMPT, /NO_ANSWER/);
  assert.match(SYSTEM_PROMPT, /ONLY/);
  const u = userPrompt('Do you encrypt data at rest?', passages, { yesNo: true });
  assert.match(u, /\[1\] Encryption Standard > Data at rest/);
  assert.match(u, /yes\/no/);
});

test('a cited, faithful answer is accepted', () => {
  const r = validateReply('{"answer":"Yes. We encrypt all customer data at rest with AES-256, including backups [1].","short":"Yes","citations":[1]}', passages);
  assert.deepEqual(r, { ok: true, text: 'Yes. We encrypt all customer data at rest with AES-256, including backups [1].', short: 'Yes', cited: [1] });
  assert.equal(stripMarkers(r.text), 'Yes. We encrypt all customer data at rest with AES-256, including backups.');
});

test('NO_ANSWER becomes a gap', () => {
  const r = validateReply('{"answer":"NO_ANSWER"}', passages);
  assert.deepEqual(r, { ok: true, noAnswer: true });
  const m = mergeDraft(det, r, passages);
  assert.equal(m.confidence, 'none');
  assert.equal(m.text, '');
});

test('invented numbers, missing or unknown citations and bad JSON are rejected', () => {
  assert.match(validateReply('{"answer":"Yes, AES-256 with keys rotated every 90 days [1].","citations":[1]}', passages).reason, /90/);
  assert.match(validateReply('{"answer":"Our RPO is 1 hour [1].","citations":[1]}', passages).reason, /numbers/, 'number only in an uncited passage');
  assert.match(validateReply('{"answer":"We encrypt data.","citations":[]}', passages).reason, /cites no passage/);
  assert.match(validateReply('{"answer":"We encrypt data [7].","citations":[7]}', passages).reason, /not given/);
  assert.equal(validateReply('Sure! Here is the answer', passages).ok, false);
  assert.equal(validateReply('```json\n{"answer":"Our RTO is 4 hours [2].","short":null,"citations":[2]}\n```', passages).ok, true, 'fenced JSON is fine');
});

test('merge: same page keeps confidence, other page is medium, gaps stay gaps, rejection falls back', () => {
  const same = mergeDraft(det, { ok: true, text: 'Yes. We encrypt data at rest with AES-256 [1].', short: 'Yes', cited: [1] }, passages);
  assert.equal(same.confidence, 'high');
  assert.equal(same.writer, 'llm');
  assert.equal(same.quote, det.text, 'verbatim extract kept for the expander');
  assert.equal(same.citations[0].n, 1);
  const other = mergeDraft({ ...det, citations: [{ type: 'confluence', title: 'X', pageId: '9' }] }, { ok: true, text: 'Our RTO is 4 hours [2].', short: null, cited: [2] }, passages);
  assert.equal(other.confidence, 'medium', 'different page: a reviewer checks');
  const gap = { ...det, confidence: 'none', source: null, citations: [], text: '' };
  assert.equal(mergeDraft(gap, { ok: true, text: 'Our RTO is 4 hours [2].', short: null, cited: [2] }, passages), gap, 'never answers what the extract left open');
  const fallback = mergeDraft(det, { ok: false, reason: 'bad' }, passages);
  assert.equal(fallback.text, det.text);
  assert.equal(fallback.writer, 'extract');
});
