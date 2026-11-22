import test from 'node:test';
import assert from 'node:assert/strict';
import { chunkPage, buildIndex, search } from '../src/core/retrieval.js';
import { draftAnswer, matchLibrary, topicWords } from '../src/core/draft.js';
import { SAMPLE_PAGES, SAMPLE_QUESTIONS, SAMPLE_LIBRARY, SAMPLE_GAPS } from '../src/core/sample.js';

const chunks = SAMPLE_PAGES.flatMap((p, i) => chunkPage({ id: String(i + 1), title: p.title, url: `https://wiki/p/${i + 1}`, body: p.body }));
const index = buildIndex(chunks);
const library = SAMPLE_LIBRARY.map((x, i) => ({ ...x, id: `lib${i}` }));
const byRef = Object.fromEntries(SAMPLE_QUESTIONS.map(([ref, , q]) => [ref, draftAnswer(q, index, library)]));

test('chunks carry page, heading and stay short', () => {
  assert.ok(chunks.length > 30);
  for (const c of chunks) {
    assert.ok(c.text.split(' ').length <= 120, c.id);
    assert.ok(c.title && c.url);
  }
  assert.ok(chunks.some((c) => c.heading === 'Key management'));
});

test('search ranks the right page first', () => {
  assert.equal(search(index, 'What is your RTO?').hits[0].chunk.title, 'Business Continuity and Disaster Recovery Plan');
  assert.equal(search(index, 'MFA for admins').hits[0].chunk.title, 'Access Control and SSO Policy');
});

test('every designed gap gets no confident answer', () => {
  for (const ref of SAMPLE_GAPS) {
    assert.equal(byRef[ref].confidence, 'none', ref);
    assert.equal(byRef[ref].text, '');
  }
});

test('most covered questions get a cited high-confidence answer', () => {
  const covered = SAMPLE_QUESTIONS.map(([r]) => r).filter((r) => !SAMPLE_GAPS.includes(r) && r !== 'RES-01');
  const high = covered.filter((r) => byRef[r].confidence === 'high');
  const answered = covered.filter((r) => byRef[r].confidence !== 'none');
  assert.ok(answered.length >= covered.length - 1, `answered ${answered.length}/${covered.length}`);
  assert.ok(high.length >= 26, `high ${high.length}`);
  for (const r of answered) assert.equal(byRef[r].citations.length, 1, r);
});

test('answers are copied from the passages, with the facts that matter', () => {
  const has = (ref, re) => assert.match(byRef[ref].text, re, ref);
  has('ENC-01', /AES-256/);
  has('ENC-02', /TLS 1\.2/);
  has('INC-02', /48 hours/);
  has('BCP-02', /4 hours.*1 hour/);
  has('VUL-02', /7 days.*30 days/);
  has('IAM-04', /24 hours/);
  for (const [ref, d] of Object.entries(byRef)) {
    if (d.source !== 'policy') continue;
    const page = chunks.find((c) => c.pageId === d.citations[0].pageId && c.heading === d.citations[0].heading);
    for (const s of d.text.split(/(?<=\.)\s+/)) assert.ok(chunks.some((c) => c.text.includes(s.replace(/\.$/, '').slice(0, 40))), `${ref}: "${s}" not in source`);
    assert.ok(page, ref);
  }
});

test('library answers win for near-identical questions and carry their approval', () => {
  assert.equal(byRef['GOV-01'].source, 'library');
  assert.equal(byRef['GOV-01'].citations[0].type, 'library');
  assert.equal(byRef['GOV-02'].source, 'library');
  // "professional indemnity insurance" must not answer "cyber liability insurance".
  assert.equal(byRef['GAP-01'].source, null);
  assert.ok(matchLibrary('Do you have cyber liability insurance?', library, index.idf).score < 0.5);
});

test('Yes only when the question is yes/no and the passage has no negation', () => {
  assert.equal(byRef['IAM-02'].short, 'Yes');
  assert.equal(byRef['VUL-02'].short, null, 'not a yes/no question');
  assert.equal(byRef['SDL-03'].short, null, '"never" in the passage');
});

test('topic words are the specific words people wrote', () => {
  assert.deepEqual(topicWords(SAMPLE_QUESTIONS.find((q) => q[0] === 'GAP-01')[2], index), ['cyber', 'liability', 'insurance']);
  const t = topicWords('Is an independent penetration test performed?', index);
  assert.ok(!t.includes('pentest') && t.includes('penetration'));
});

test('drafting is deterministic', () => {
  const again = draftAnswer(SAMPLE_QUESTIONS[4][2], buildIndex(chunks), library);
  assert.deepEqual(again, byRef['ENC-03']);
});
