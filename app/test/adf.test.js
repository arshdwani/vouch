import test from 'node:test';
import assert from 'node:assert/strict';
import { expertTaskDescription } from '../src/core/adf.js';
import { adfText } from '../src/core/text.js';

test('expert sub-task description carries question, reason, pages, passages and how to answer', () => {
  const d = expertTaskDescription({
    question: 'Do you maintain cyber liability insurance?',
    ref: 'GAP-01',
    section: 'Legal',
    issueKey: 'SEC-1',
    issueUrl: 'https://x/browse/SEC-1',
    expert: { accountId: 'a1', name: 'Alana Grant' },
    reason: 'Contributed to 2 of 3 pages about cyber liability',
    teams: ['Legal & Insurance'],
    pages: [{ title: 'Cyber insurance renewal', url: 'https://x/p/1' }],
    passages: [{ title: 'HR Security Policy', heading: 'Training', url: 'https://x/p/2', text: 'Security awareness training...' }],
    requester: { accountId: 'me', name: 'Me' },
  });
  assert.equal(d.type, 'doc');
  const text = adfText(d);
  for (const s of ['Question GAP-01 (Legal)', 'cyber liability insurance', 'Contributed to 2 of 3 pages', 'How Vouch found you', 'Page Cyber insurance renewal → you contributed to it (Teamwork Graph: page contributors)', 'Team Legal & Insurance → you are a member', 'HR Security Policy › Training', 'Your first comment is used']) {
    assert.ok(text.includes(s), s);
  }
  const json = JSON.stringify(d);
  assert.match(json, /"type":"mention","attrs":\{"id":"a1"/);
  assert.match(json, /"href":"https:\/\/x\/browse\/SEC-1"/);
  assert.ok(!json.includes('null'), 'no null nodes');
});

test('no passages: says so instead of an empty list', () => {
  const text = adfText(expertTaskDescription({ question: 'Q?', issueKey: 'K-1', expert: { accountId: 'a', name: 'A' }, reason: 'r' }));
  assert.match(text, /No policy page mentions this topic/);
});
