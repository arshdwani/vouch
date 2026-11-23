// End-to-end flow through service.js with Forge mocked in memory: import -> draft -> approve -> find expert (TWG)
// -> sub-task -> expert comment -> export -> graph connector writes. Run with --experimental-test-module-mocks.
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { buildXlsx, readXlsx } from '../src/core/xlsx.js';
import { SAMPLE_PAGES, SAMPLE_LIBRARY, sampleRows, SAMPLE_XLSX_OPTS } from '../src/core/sample.js';

// ---- In-memory Forge --------------------------------------------------------------------------------------------
const kv = new Map();
const kvs = {
  get: async (k) => structuredClone(kv.get(k)),
  set: async (k, v, opts) => {
    if (opts?.keyPolicy === 'FAIL_IF_EXISTS' && kv.has(k)) throw new Error('exists');
    kv.set(k, structuredClone(v));
  },
  delete: async (k) => kv.delete(k),
  query: () => {
    let prefix = '';
    const q = { where: (_, c) => ((prefix = c), q), limit: () => q, cursor: () => q, getMany: async () => ({ results: [...kv].filter(([k]) => k.startsWith(prefix)).map(([key, value]) => ({ key, value: structuredClone(value) })) }) };
    return q;
  },
};
mock.module('@forge/kvs', { exports: { kvs, WhereConditions: { beginsWith: (p) => p } } });

const ME = 'me-1';
const ALANA = 'alana-1';
const MAX = 'max-1';
const BOT = 'bot-1';
const site = 'https://example.atlassian.net';
const xlsx = buildXlsx(sampleRows(), SAMPLE_XLSX_OPTS);
const issues = { 'SEC-1': { id: '1001', key: 'SEC-1', fields: { summary: 'Halden', project: { id: '10', key: 'SEC' }, issuetype: { subtask: false }, attachment: [{ id: '501', filename: 'Halden.xlsx', size: xlsx.length, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', created: '2026-11-21T10:00:00Z', author: { displayName: 'Me' } }] } } };
const files = { 501: xlsx };
const comments = {};
const created = [];
const transitions = [];
const policyPages = SAMPLE_PAGES.map((p, i) => ({ id: String(100 + i), title: p.title, body: { storage: { value: p.body } }, _links: { webui: `/spaces/SEC/pages/${100 + i}` } }));
const sitePages = [
  { id: '900', title: 'Cyber insurance renewal 2026', text: 'cyber liability insurance coverage limit broker', by: ALANA },
  { id: '901', title: 'Insurance and claims FAQ', text: 'insurance claims cyber', by: ALANA },
  { id: '902', title: 'Vendor contracts checklist', text: 'liability caps insurance certificates', by: MAX },
];
const contributors = { 900: [ALANA, MAX, ME], 901: [ALANA, BOT], 902: [MAX] };
const names = { [ALANA]: 'Alana Grant', [MAX]: 'Max Taylor', [ME]: 'Me Myself', [BOT]: 'Automation' };
const graphObjects = new Map();

const ok = (body, status = 200) => ({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body), arrayBuffer: async () => body });
const bin = (buf) => ({ ok: true, status: 200, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length) });

function jira(path, init = {}) {
  const [p, qs] = path.split('?');
  const params = new URLSearchParams(qs || '');
  let m;
  if ((m = p.match(/^\/rest\/api\/3\/issue\/([A-Z]+-\d+)$/)) && !init.method) return ok(issues[m[1]] || {}, issues[m[1]] ? 200 : 404);
  if ((m = p.match(/^\/rest\/api\/3\/attachment\/content\/(\d+)$/))) return bin(files[m[1]]);
  if ((m = p.match(/^\/rest\/api\/3\/issue\/([A-Z]+-\d+)\/attachments$/))) {
    const body = init.body;
    const boundary = /boundary=(.+)$/.exec(init.headers['Content-Type'])[1];
    const start = body.indexOf('\r\n\r\n') + 4;
    const end = body.lastIndexOf(Buffer.from(`\r\n--${boundary}--`));
    const filename = /filename="([^"]+)"/.exec(body.subarray(0, start).toString())[1];
    const id = String(600 + Object.keys(files).length);
    files[id] = body.subarray(start, end);
    issues[m[1]].fields.attachment.push({ id, filename, size: end - start, mimeType: 'x', created: new Date().toISOString() });
    return ok([{ id, filename }]);
  }
  if (p.match(/\/issue\/createmeta\/10\/issuetypes$/)) return ok({ issueTypes: [{ id: '1', name: 'Task', subtask: false }, { id: '5', name: 'Sub-task', subtask: true }] });
  if (p === '/rest/api/3/issue' && init.method === 'POST') {
    const f = JSON.parse(init.body).fields;
    if (f.assignee?.accountId === MAX) return ok({ errors: { assignee: 'not assignable' } }, 400);
    const key = `SEC-${2 + created.length}`;
    created.push({ key, fields: f });
    issues[key] = { id: String(2000 + created.length), key, fields: { summary: f.summary, project: { id: '10' }, issuetype: { subtask: true }, attachment: [] } };
    return ok({ key, id: issues[key].id });
  }
  if ((m = p.match(/^\/rest\/api\/3\/issue\/([A-Z]+-\d+)\/comment\/(\d+)$/))) return ok(comments[m[2]]);
  if ((m = p.match(/^\/rest\/api\/3\/issue\/([A-Z]+-\d+)\/transitions$/))) {
    if (init.method === 'POST') {
      transitions.push(m[1]);
      return ok(null, 204);
    }
    return ok({ transitions: [{ id: '11', to: { statusCategory: { key: 'indeterminate' } } }, { id: '31', to: { statusCategory: { key: 'done' } } }] });
  }
  if (p === '/rest/api/3/serverInfo') return ok({ baseUrl: site });
  if (p === '/rest/api/3/mypermissions') return ok({ permissions: { ADMINISTER: { havePermission: true } } });
  if (p === '/rest/api/3/user/bulk') return ok({ values: params.getAll('accountId').map((id) => ({ accountId: id, displayName: names[id], accountType: id === BOT ? 'app' : 'atlassian', active: true })) });
  throw new Error(`unmocked Jira ${init.method || 'GET'} ${path}`);
}

function confluence(path) {
  const [p, qs] = path.split('?');
  const params = new URLSearchParams(qs || '');
  if (p === '/wiki/api/v2/spaces') return ok({ results: [{ id: '77', key: 'SEC', name: 'Security' }] });
  if (p === '/wiki/api/v2/spaces/77/pages') {
    // Two pages of results, so a small per-space cap leaves pages unread.
    const second = params.get('cursor') === 'c2';
    return ok({ results: second ? policyPages.slice(5) : policyPages.slice(0, 5), _links: { base: `${site}/wiki`, ...(second ? {} : { next: '/wiki/api/v2/spaces/77/pages?cursor=c2' }) } });
  }
  if (p === '/wiki/rest/api/search') {
    const cql = params.get('cql');
    const field = cql.includes('title ~') ? 'title' : 'text';
    const words = [...cql.matchAll(/(?:title|text) ~ "([^"]+)"/g)].map((x) => x[1].toLowerCase().split(' '));
    const any = cql.includes(' OR ');
    const hits = sitePages.filter((pg) => {
      const t = (field === 'title' ? pg.title : `${pg.title} ${pg.text}`).toLowerCase();
      return any ? words.some((ws) => ws.every((w) => t.includes(w))) : words.every((ws) => ws.every((w) => t.includes(w)));
    });
    return ok({ _links: { base: `${site}/wiki` }, results: hits.map((pg) => ({ url: `/pages/${pg.id}`, content: { id: pg.id, type: 'page', title: pg.title, space: { key: 'LEGAL', name: 'Legal' }, history: { createdBy: { accountId: pg.by, displayName: names[pg.by] } } } })) });
  }
  if (p === '/wiki/rest/api/content/search') {
    contentSearches.push(params.get('cql'));
    const words = [...params.get('cql').matchAll(/text ~ "([^"]+)"/g)].map((x) => x[1].toLowerCase());
    const hits = policyPages.filter((pg) => words.some((w) => `${pg.title} ${pg.body.storage.value}`.toLowerCase().includes(w))).slice(0, 5);
    return ok({ _links: { base: `${site}/wiki` }, results: hits.map((pg) => ({ ...pg, space: { key: 'SEC' } })) });
  }
  throw new Error(`unmocked Confluence ${path}`);
}

const twgCalls = [];
const contentSearches = [];
function twgRequest(query, vars, op) {
  twgCalls.push(op);
  assert.match(op, /^vouch_[a-zA-Z]{4,}$/);
  assert.ok(!/cursor\s*}/.test(query.replace(/endCursor/g, '')), 'never select edges.cursor');
  if (op === 'vouch_pageContributors') {
    const id = vars.id.split('/').pop();
    return ok({ data: { confluencePageContributors: { edges: (contributors[id] || []).map((a) => ({ node: { __typename: 'AtlassianUser', id: `ari:cloud:identity::user/${a}`, accountId: a, name: names[a] } })), pageInfo: { hasNextPage: false } } } });
  }
  if (op === 'vouch_userTeams') return ok({ data: { atlassianUserInTeams: { edges: [{ node: { __typename: 'AtlassianTeam', id: 't1', displayName: 'Platform' } }, { node: { __typename: 'AtlassianTeam', id: 't2', displayName: 'Legal & Insurance' } }], pageInfo: { hasNextPage: false } } } });
  throw new Error(op);
}

const client = { requestJira: async (r, i) => jira(String(r), i), requestConfluence: async (r, i) => confluence(String(r), i), requestTeamworkGraph: async (q, v, o) => twgRequest(q, v, o) };
const route = (strings, ...vals) => strings.reduce((s, str, i) => s + str + (i < vals.length ? encodeURIComponent(vals[i]) : ''), '');
mock.module('@forge/api', { exports: { asUser: () => client, asApp: () => client, route, assumeTrustedRoute: (s) => s } });
mock.module('@forge/teamwork-graph', {
  exports: {
    graph: {
      setObjects: async ({ objects, connectionId }) => {
        assert.equal(connectionId, 'conn-1');
        for (const o of objects) {
          assert.ok(o.id && o.displayName && o.url && o.permissions && o['atlassian:document'].content.text);
          graphObjects.set(o.id, o);
        }
        return { success: true, results: { accepted: objects.map((o) => ({ id: o.id })) } };
      },
      deleteObjectsByExternalId: async ({ externalIds }) => externalIds.forEach((id) => graphObjects.delete(id)),
      getObjectIndexStatusByExternalId: async () => ({ success: true, status: 'INDEXED' }),
    },
  },
});

// Forge LLM unavailable here: drafting must fall back to the deterministic extract (llm-flow.test.js covers the LLM).
mock.module('@forge/llm', { exports: { list: async () => { throw new Error('not enabled'); }, chat: async () => { throw new Error('not enabled'); } } });

const svc = await import('../src/service.js');
const store = await import('../src/store.js');
const graph = await import('../src/graph.js');

test('full flow on the sample questionnaire', async () => {
  await store.saveSettings({ spaceKeys: ['SEC'], llm: false });
  for (const [i, x] of SAMPLE_LIBRARY.entries()) await store.saveLibraryEntry({ ...x, id: `sample-${i + 1}`, approvedAt: '2026-11-01T00:00:00Z', citations: [] });
  await graph.onConnectionChange({ action: 'CREATED', connectionId: 'conn-1', name: 'Vouch answer library' });
  assert.equal(graphObjects.size, 3, 'existing library pushed on connect');
  assert.ok([...graphObjects.values()].every((o) => /^https:\/\/example\.atlassian\.net\//.test(o.url)), 'absolute links, even from the connection event');

  const imp = await svc.importQuestionnaire('SEC-1', '501', ME);
  assert.equal(imp.questions, 40);
  assert.deepEqual(imp.headers, { question: 'Question', text: 'Comments / Evidence', yesno: 'Response (Yes / No / N/A)' });

  const dr = await svc.draftQuestionnaire('SEC-1');
  assert.equal(dr.knowledge.pages, 10);
  assert.equal(dr.counts.gaps, 5);
  assert.ok(dr.counts.high >= 30, `high ${dr.counts.high}`);
  assert.equal(svc.badge(await store.getQuestionnaire('SEC-1')).label, '35/40 answered');

  const bulk = await svc.approveAllHigh('SEC-1', ME);
  assert.equal(bulk.approved, dr.counts.high);
  assert.ok(bulk.graph.ok);
  let qn = await store.getQuestionnaire('SEC-1');
  const enc = qn.rows.find((r) => r.status === 'approved' && r.answer.source === 'policy');
  assert.ok(enc, 'a policy answer was approved');

  // Edit one medium draft.
  const medium = qn.rows.find((r) => r.status === 'drafted');
  const ap = await svc.approve('SEC-1', medium.qid, { text: 'Edited by the reviewer.', short: 'Yes' }, ME);
  assert.equal(ap.row.answer.source, 'reviewer');

  // Gap -> experts through the Teamwork Graph.
  const gap = qn.rows.find((r) => r.id === 'GAP-01');
  assert.equal(gap.status, 'gap');
  const sug = await svc.suggestExperts('SEC-1', gap.qid, { cloudId: 'cloud-1', actorId: ME });
  const ex = sug.row.experts;
  assert.equal(ex.via, 'Teamwork Graph');
  assert.deepEqual(ex.list.map((x) => x.name), ['Alana Grant', 'Max Taylor'], 'requester and bots excluded');
  assert.match(ex.list[0].reason, /^Contributed to 2 of \d pages about cyber liability in Legal$/);
  assert.equal(ex.list[0].teams[0], 'Legal & Insurance');
  assert.ok(twgCalls.includes('vouch_pageContributors') && twgCalls.includes('vouch_userTeams'));

  const routed = await svc.routeToExpert('SEC-1', gap.qid, ALANA, { actorId: ME, actorName: 'Me Myself' });
  assert.equal(routed.task.key, 'SEC-2');
  assert.equal(created[0].fields.parent.key, 'SEC-1');
  assert.equal(created[0].fields.assignee.accountId, ALANA);
  const desc = JSON.stringify(created[0].fields.description);
  assert.match(desc, /Contributed to 2 of/);
  assert.match(desc, /Cyber insurance renewal 2026/);
  assert.match(desc, /cyber liability insurance/i);
  assert.equal(svc.badge(await store.getQuestionnaire('SEC-1')).label, '35/40 answered · 1 with experts');

  // A non-assignable expert still gets an (unassigned) sub-task.
  const gap2 = qn.rows.find((r) => r.id === 'GAP-03');
  await svc.suggestExperts('SEC-1', gap2.qid, { cloudId: 'cloud-1', actorId: ME });
  const r2 = await svc.routeToExpert('SEC-1', gap2.qid, MAX, { actorId: ME });
  assert.equal(r2.task.assigned, false);

  // The expert answers in a comment; it flows into the questionnaire, the library and the graph; sub-task closes.
  comments['7001'] = { id: '7001', author: { accountId: ALANA, displayName: 'Alana Grant' }, body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Yes - we hold cyber liability insurance with a USD 10M limit.' }] }] } };
  const cm = await svc.onExpertComment('SEC-2', '7001');
  assert.equal(cm.answered, true);
  assert.deepEqual(transitions, ['SEC-2']);
  assert.equal((await svc.onExpertComment('SEC-2', '7001')).skipped, 'already answered');
  qn = await store.getQuestionnaire('SEC-1');
  const answered = qn.rows.find((r) => r.id === 'GAP-01');
  assert.equal(answered.status, 'answered');
  assert.equal(answered.answer.short, 'Yes');
  assert.equal(answered.answer.text, 'We hold cyber liability insurance with a USD 10M limit.');
  const lib = await store.listLibrary();
  assert.ok(lib.some((e) => e.source.type === 'expert' && /USD 10M/.test(e.text)));
  assert.ok([...graphObjects.values()].some((o) => /USD 10M/.test(o['atlassian:document'].content.text)));
  assert.ok(lib.every((e) => e.graph?.ok), 'every library entry synced');

  // Export: the original workbook with answers filled, attached back to the issue.
  const exp = await svc.exportQuestionnaire('SEC-1', ME);
  assert.equal(exp.filename, 'Halden (answered).xlsx');
  assert.equal(exp.answers, bulk.approved + 2);
  const out = readXlsx(files[issues['SEC-1'].fields.attachment.at(-1).id]).sheets[0].grid;
  const rowOf = (ref) => out.find((r) => r[0] === ref);
  assert.equal(rowOf('GAP-01')[3], 'Yes');
  assert.match(rowOf('GAP-01')[4], /USD 10M/);
  assert.equal(rowOf(enc.id)[4], enc.answer.text);
  assert.equal(rowOf('GAP-05')[4], '', 'unanswered gap left blank');
  assert.equal(out[3][2], 'Question', 'headers untouched');

  // Re-draft never overwrites approved or routed rows.
  await svc.draftQuestionnaire('SEC-1');
  qn = await store.getQuestionnaire('SEC-1');
  assert.equal(qn.rows.find((r) => r.id === enc.id).status, 'approved');
  assert.equal(qn.rows.find((r) => r.id === 'GAP-03').status, 'routed');
});

test('a 200-question workbook drafts in resumable chunks', async () => {
  const { SAMPLE_QUESTIONS } = await import('../src/core/sample.js');
  const rows = [['Ref', 'Question', 'Answer']];
  for (let k = 0; k < 5; k++) for (const [ref, , q] of SAMPLE_QUESTIONS) rows.push([`${ref}-${k}`, q, '']);
  files[777] = buildXlsx(rows, { sheetName: 'Big' });
  issues['SEC-9'] = { id: '1009', key: 'SEC-9', fields: { summary: 'Big', project: { id: '10', key: 'SEC' }, issuetype: { subtask: false }, attachment: [{ id: '777', filename: 'big.xlsx', size: files[777].length, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', created: '2026-11-22T10:00:00Z' }] } };
  const imp = await svc.importQuestionnaire('SEC-9', '777', ME);
  assert.equal(imp.questions, 200);
  const seen = [];
  let r;
  do {
    r = await svc.draftQuestionnaire('SEC-9', { budgetMs: 0 });
    seen.push(r.remaining);
  } while (r.remaining && seen.length < 10);
  assert.deepEqual(seen, [150, 100, 50, 0], 'one batch of 50 per call, state kept between calls');
  const qn = await store.getQuestionnaire('SEC-9');
  assert.equal(qn.rows.length, 200);
  assert.equal([...kv.keys()].filter((k) => k.startsWith('qnr:SEC-9:')).length, 8, 'rows stored in parts of 25');
  assert.equal(kv.get('qn:SEC-9').rows, undefined, 'header holds no rows');
  assert.equal(kv.get('qn:SEC-9').counts.total, 200);
  assert.equal(qn.rows.filter((x) => x.status === 'pending').length, 0);
  // 5 gaps x 5 copies, minus the 5 copies of GAP-01 that the expert's library answer now covers.
  assert.equal(qn.rows.filter((x) => x.status === 'gap').length, 20);
});

test('spaces bigger than the cap: CQL finds the pages beyond it', async () => {
  await store.saveSettings({ spaceKeys: ['SEC'], llm: false, maxPagesPerSpace: 5 });
  const k = await svc.knowledge('user', { questions: ['What are your RTO and RPO for the production service?'] });
  assert.equal(k.stats.truncated, true);
  assert.ok(contentSearches.length === 1 && contentSearches[0].includes('space in ("SEC")'));
  assert.ok(k.stats.searchedExtra >= 1, 'BCP page fetched by search');
  const { d } = await svc.answerOne('What are your RTO and RPO for the production service?');
  assert.match(d.text, /4 hours/);
  await store.saveSettings({ spaceKeys: ['SEC'], llm: false });
});

test('Rovo actions answer with sources, admit gaps and route', async () => {
  const actions = await import('../src/actions.js');
  const a = await actions.answerQuestion({ question: 'What is your RPO for production?' });
  assert.match(a.answer, /1 hour/);
  // By now the approved BCP answer is in the library, which is the better source.
  assert.ok(['Confluence page', 'approved answer library'].includes(a.sources[0].type));
  const g = await actions.answerQuestion({ question: 'Do you have a Data Protection Officer?' });
  assert.equal(g.answer, null);
  assert.equal(g.confidence, 'none');
  const s = await actions.questionnaireStatus({ issueKey: 'SEC-1' });
  assert.equal(s.counts.total, 40);
  assert.ok(s.withExperts.some((x) => x.expert === 'Max Taylor' && x.subtask === 'SEC-3'));
  const r = await actions.routeQuestion({ issueKey: 'SEC-1', question: 'GAP-01', context: { accountId: ME, cloudId: 'c' } });
  assert.ok(r.alreadyRouted || r.error === undefined);
});
