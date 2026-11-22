// Load sample / Remove sample must never touch pages Vouch didn't create, even when titles look alike.
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

const kv = new Map();
mock.module('@forge/kvs', {
  exports: {
    kvs: {
      get: async (k) => structuredClone(kv.get(k)),
      set: async (k, v) => kv.set(k, structuredClone(v)),
      delete: async (k) => kv.delete(k),
      query: () => {
        let prefix = '';
        const q = { where: (_, c) => ((prefix = c), q), limit: () => q, cursor: () => q, getMany: async () => ({ results: [...kv].filter(([k]) => k.startsWith(prefix)).map(([key, value]) => ({ key, value })) }) };
        return q;
      },
    },
    WhereConditions: { beginsWith: (p) => p },
  },
});
mock.module('@forge/llm', { exports: { list: async () => ({ models: [] }), chat: async () => null } });
mock.module('@forge/teamwork-graph', { exports: { graph: {} } });

// Confluence space SEC already holds the customer's own "Encryption Standard" page.
const pages = new Map([['1', { id: '1', title: 'Encryption Standard', spaceId: '77' }]]);
const deleted = [];
let nextId = 100;
const ok = (body, status = 200) => ({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
const client = {
  requestJira: async (path, init = {}) => {
    const p = String(path).split('?')[0];
    if (p === '/rest/api/3/mypermissions') return ok({ permissions: { ADMINISTER: { havePermission: true } } });
    if (p === '/rest/api/3/serverInfo') return ok({ baseUrl: 'https://x' });
    if (p === '/rest/api/3/project/SALES') return ok({ id: '10' });
    if (p.endsWith('/issuetypes')) return ok({ issueTypes: [{ id: '1', name: 'Task', subtask: false }] });
    if (p === '/rest/api/3/issue' && init.method === 'POST') return ok({ key: 'SALES-1', id: '1' });
    if (p.endsWith('/attachments')) return ok([{ id: '9' }]);
    if (p.startsWith('/rest/api/3/issue/SALES-1') && init.method === 'DELETE') return ok(null, 204);
    throw new Error(`unmocked ${p}`);
  },
  requestConfluence: async (path, init = {}) => {
    const [p, qs] = String(path).split('?');
    const params = new URLSearchParams(qs || '');
    if (p === '/wiki/api/v2/spaces') return ok({ results: [{ id: '77', key: 'SEC', name: 'Security' }] });
    if (p === '/wiki/api/v2/pages' && !init.method) return ok({ results: [...pages.values()].filter((x) => x.title === params.get('title')) });
    if (p === '/wiki/api/v2/pages' && init.method === 'POST') {
      const b = JSON.parse(init.body);
      const page = { id: String(nextId++), title: b.title, spaceId: b.spaceId };
      pages.set(page.id, page);
      return ok(page);
    }
    const m = /^\/wiki\/api\/v2\/pages\/(\d+)$/.exec(p);
    if (m && init.method === 'DELETE') {
      deleted.push(m[1]);
      pages.delete(m[1]);
      return ok(null, 204);
    }
    throw new Error(`unmocked ${p}`);
  },
};
const route = (strings, ...vals) => strings.reduce((s, str, i) => s + str + (i < vals.length ? encodeURIComponent(vals[i]) : ''), '');
mock.module('@forge/api', { exports: { asUser: () => client, asApp: () => client, route, assumeTrustedRoute: (s) => s } });

const svc = await import('../src/service.js');

test('the sample never reuses or deletes a page it did not create', async () => {
  const r = await svc.loadSample({ spaceKey: 'SEC', projectKey: 'SALES' }, { accountId: 'me' });
  assert.equal(r.pages, 10);
  assert.ok(pages.has('1'), "customer's page untouched");
  const titles = [...pages.values()].map((x) => x.title);
  assert.ok(titles.includes('Brightlake sample – Encryption Standard'));
  assert.equal(titles.filter((t) => t === 'Encryption Standard').length, 1, 'no second page with the customer title');
  await assert.rejects(svc.loadSample({ spaceKey: 'SEC', projectKey: 'SALES' }, { accountId: 'me' }), /already loaded/);
  await svc.removeSample({ accountId: 'me' });
  assert.equal(deleted.length, 11);
  assert.ok(!deleted.includes('1'), "customer's page never deleted");
  assert.deepEqual([...pages.keys()], ['1']);
});

test('a page already using a sample title stops the load before anything is created', async () => {
  pages.set('2', { id: '2', title: 'Brightlake sample – HR Security Policy', spaceId: '77' });
  const before = pages.size;
  await assert.rejects(svc.loadSample({ spaceKey: 'SEC', projectKey: 'SALES' }, { accountId: 'me' }), /already exists/);
  assert.equal(pages.size, before);
});
