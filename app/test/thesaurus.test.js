import test from 'node:test';
import assert from 'node:assert/strict';
import { queryTerms, tokens, stem } from '../src/core/text.js';
import { chunkPage, buildIndex } from '../src/core/retrieval.js';
import { draftAnswer } from '../src/core/draft.js';
import { runBenchmark } from '../src/core/benchmark.js';
import { SAMPLE_PAGES, SAMPLE_QUESTIONS, SAMPLE_LIBRARY, SAMPLE_KEY, PARAPHRASED } from '../src/core/sample.js';

const concept = (text) => queryTerms(text).map((t) => t.term);
const same = (token, ...phrases) => {
  for (const p of phrases) assert.ok(concept(p).includes(token), `"${p}" should mean ${token} (got ${concept(p)})`);
};

test('customer wording meets policy wording', () => {
  same(stem('tenantisolation'), 'logically segregated', 'multi-tenant environment', 'tenant isolation', 'isolated from other customers');
  same('mfa', 'second factor', '2FA', 'two-step verification', 'multi-factor authentication', 'hardware tokens');
  same('sso', 'Okta', 'Azure AD', 'identity provider', 'single sign-on', 'SAML');
  same('pentest', 'pen test', 'penetration testing', 'break into your platform', 'red team');
  same('subprocessor', 'sub-processor', 'other companies that handle our data', 'subcontractors');
  same('rpo', 'RPO', 'recovery point objective', 'maximum tolerable data loss');
  same('kms', 'key management service', 'cryptographic keys', 'key material');
  same(stem('delete'), 'purged', 'destroyed', 'erasure', 'deleted');
  same('backgroundcheck', 'screened', 'vetting', 'background checks');
  same('accessreview', 'recertified', 'user access reviews', 'review their access');
});

test('documents keep their own words next to the concept', () => {
  const t = tokens('Multi-factor authentication is required');
  assert.ok(t.includes('mfa') && t.includes('authenticat'));
});

test('benchmark: zero wrong answers on the original and the paraphrased set', async () => {
  const index = buildIndex(SAMPLE_PAGES.flatMap((p, i) => chunkPage({ id: String(i), title: p.title, url: 'u', body: p.body })));
  const lib = SAMPLE_LIBRARY.map((x, i) => ({ ...x, id: `l${i}` }));
  const draft = (q) => draftAnswer(q, index, lib);
  const a = await runBenchmark(SAMPLE_QUESTIONS.map(([ref, , question]) => ({ ref, question, expected: SAMPLE_KEY[ref] })), draft);
  const b = await runBenchmark(PARAPHRASED.map(([ref, question, expected]) => ({ ref, question, expected })), draft);
  assert.equal(a.wrong, 0, a.wrongList.join(' '));
  assert.equal(b.wrong, 0, b.wrongList.join(' '));
  assert.ok(a.correct >= 39, `original ${a.correct}/40`);
  assert.ok(b.correct >= 38, `paraphrased ${b.correct}/40`);
});
