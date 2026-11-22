// draftOne with a fake Forge LLM: faithful replies are used (with citations), NO_ANSWER makes a gap, and a reply
// that invents a number is rejected in favour of the verbatim extract.
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { chunkPage, buildIndex } from '../src/core/retrieval.js';
import { SAMPLE_PAGES } from '../src/core/sample.js';

const calls = [];
mock.module('@forge/llm', {
  exports: {
    list: async () => ({ models: [{ model: 'claude-haiku-test', status: 'active' }] }),
    chat: async ({ messages }) => {
      const user = messages[1].content[0].text;
      calls.push(user);
      const q = /^QUESTION[^:]*: (.*)$/m.exec(user)[1];
      let answer;
      if (/insurance/i.test(q)) answer = { answer: 'NO_ANSWER' };
      else if (/rotated/i.test(q)) answer = { answer: 'Keys are rotated every 6 months [1].', short: null, citations: [1] };
      else {
        // Echo the first sentence of passage [1], as a faithful model would.
        const p1 = /\[1\][^\n]*\n([^\n]*)/.exec(user)[1].split(/(?<=\.)\s/)[0].replace(/\.$/, '');
        answer = { answer: `Yes. ${p1} [1].`, short: 'Yes', citations: [1] };
      }
      return { choices: [{ message: { content: [{ type: 'text', text: JSON.stringify(answer) }] } }] };
    },
  },
});
mock.module('@forge/kvs', { exports: { kvs: {}, WhereConditions: {} } });
mock.module('@forge/api', { exports: { asUser: () => ({}), asApp: () => ({}), route: String.raw, assumeTrustedRoute: (s) => s } });
mock.module('@forge/teamwork-graph', { exports: { graph: {} } });

const { draftOne } = await import('../src/service.js');
const index = buildIndex(SAMPLE_PAGES.flatMap((p, i) => chunkPage({ id: String(i), title: p.title, url: `u${i}`, body: p.body })));

test('faithful LLM reply is used, with numbered citations and the verbatim quote kept', async () => {
  const d = await draftOne('Is customer data encrypted at rest?', { index, library: [], useLlm: true, yesNo: true });
  assert.equal(d.writer, 'llm', `${d.writerNote} | ${calls.length} calls`);
  assert.match(d.text, /^Yes\. .*AES-256.* \[1\]\.$/);
  assert.equal(d.short, 'Yes');
  assert.equal(d.citations[0].n, 1);
  assert.equal(d.citations[0].title, 'Encryption Standard');
  assert.match(d.quote, /AES-256/);
  assert.match(calls[0], /\[1\] Encryption Standard/);
});

test('NO_ANSWER turns an extract into a gap; open questions never reach the LLM', async () => {
  const n = calls.length;
  const gap = await draftOne('Do you maintain cyber insurance for data incidents?', { index, library: [], useLlm: true, yesNo: true });
  assert.equal(gap.confidence, 'none');
  assert.equal(calls.length, n, 'no LLM call for a question the extract left open');
  const vetoed = await draftOne('Is customer data encrypted at rest, and is that covered by insurance?', { index, library: [], useLlm: true, yesNo: true });
  assert.equal(vetoed.confidence, 'none');
  assert.match(vetoed.why, /Forge LLM found nothing/);
});

test('an invented number is rejected and the extract stands', async () => {
  const d = await draftOne('How often are encryption keys rotated?', { index, library: [], useLlm: true, yesNo: false });
  assert.equal(d.writer, 'extract');
  assert.match(d.writerNote, /numbers/);
  assert.match(d.text, /12 months/);
});

test('LLM off: deterministic only, no calls', async () => {
  const n = calls.length;
  const d = await draftOne('Is customer data encrypted at rest?', { index, library: [], useLlm: false, yesNo: true });
  assert.equal(calls.length, n);
  assert.match(d.text, /AES-256/);
});
