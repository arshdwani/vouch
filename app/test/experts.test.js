import test from 'node:test';
import assert from 'node:assert/strict';
import { rankExperts, pickTeams, topicCql } from '../src/core/experts.js';

const u = (accountId, name) => ({ accountId, name });
const pages = [
  { id: '1', title: 'Insurance FAQ', url: 'u1', contributors: [u('a', 'Alana'), u('m', 'Max')] },
  { id: '2', title: 'Benefits', url: 'u2', contributors: [u('a', 'Alana'), u('a', 'Alana')] },
  { id: '3', title: 'Claims', url: 'u3', contributors: [u('m', 'Max'), u('me', 'Me')] },
  { id: '4', title: 'Bot page', url: 'u4', contributors: [u('bot', 'Automation')] },
];

test('ranks by pages contributed, counts each page once, explains why', () => {
  const r = rankExperts(pages, { exclude: ['me'], eligible: (id) => id !== 'bot', topic: 'insurance' });
  assert.deepEqual(r.map((x) => [x.name, x.pages]), [['Alana', 2], ['Max', 2]]);
  assert.equal(r[0].reason, 'Contributed to 2 of 4 pages about insurance');
  assert.deepEqual(r[0].titles.map((t) => t.title), ['Insurance FAQ', 'Benefits']);
});

test('ties break toward more relevant pages', () => {
  const r = rankExperts([pages[2], pages[0]], {});
  assert.equal(r[0].name, 'Max');
});

test('only teams related to the topic are shown', () => {
  assert.deepEqual(pickTeams([{ displayName: 'Platform' }, { displayName: 'Legal & Insurance' }, { displayName: 'Platform' }], ['insurance']), ['Legal & Insurance']);
  assert.deepEqual(pickTeams([{ displayName: 'Team Pulse' }], ['vpn']), []);
});

test('topic CQL escapes quotes and supports any-word fallback and spaces', () => {
  assert.equal(topicCql(['cyber', 'liability']), 'type = page AND text ~ "cyber liability"');
  assert.equal(topicCql(['a"b', 'c'], { any: true, spaces: ['SEC'] }), 'type = page AND space in ("SEC") AND (text ~ "a b" OR text ~ "c")');
  assert.equal(topicCql([]), null);
});

test('a page titled after the topic outweighs text-only mentions; spaces are named', async () => {
  const { titleCql, titleWeight } = await import('../src/core/experts.js');
  assert.equal(titleCql(['audit', 'compliance']), 'type = page AND (title ~ "audit" OR title ~ "compliance")');
  const words = ['compliance', 'audit'];
  const ps = [
    { id: 'a', title: 'Compliance Standards', space: 'Legal', contributors: [u('al', 'Alana')] },
    { id: 'b', title: 'Audit compliance', space: 'Marketing Software Development', contributors: [u('mx', 'Max')] },
    { id: 'c', title: 'Dashloop architecture', space: 'Engineering', contributors: [u('al', 'Alana')] },
  ].map((p) => ({ ...p, weight: titleWeight(p.title, words) }));
  const r = rankExperts(ps, { topic: 'compliance audit' });
  assert.equal(r[0].name, 'Max');
  assert.equal(r[0].reason, 'Contributed to 1 of 3 pages about compliance audit in Marketing Software Development');
  assert.deepEqual(r[1].spaces, ['Legal', 'Engineering']);
});

test('Jira work items are a second signal; the reason names them', () => {
  const issues = [
    { key: 'ITS-4', summary: 'VPN client rollout', assignee: u('ada', 'Ada'), reporter: u('al', 'Alana') },
    { key: 'ITS-9', summary: 'VPN outage', assignee: u('ada', 'Ada'), reporter: null },
  ];
  const r = rankExperts([], { issues, topic: 'vpn' });
  assert.equal(r[0].name, 'Ada');
  assert.equal(r[0].reason, 'Worked on 2 related work items (ITS-4, ITS-9)');
  assert.deepEqual(r[0].issues.map((i) => i.role), ['assignee', 'assignee']);
  assert.equal(r[1].issues[0].role, 'reporter');
  const both = rankExperts([{ id: 'p', title: 'VPN setup', space: 'IT', contributors: [u('ada', 'Ada')] }], { issues, topic: 'vpn' });
  assert.equal(both[0].reason, 'Contributed to 1 of 1 page about vpn in IT; worked on 2 related work items (ITS-4, ITS-9)');
});
