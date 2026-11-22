// Library -> Teamwork Graph. Approved answers are written as atlassian:document objects through the app's
// graph:connector, so Rovo search (and anything else that reads the graph) finds them. The connection is created by
// a site admin (Administration -> Apps -> Connected apps -> Vouch -> Connections); onConnectionChange stores its id.
import { graph } from '@forge/teamwork-graph';
import * as store from './store.js';

const ID_PREFIX = 'vouch-answer-';

export function toDocument(entry, { siteUrl = '', appPath = '/jira/apps' } = {}) {
  const text = `Question: ${entry.question}\n\nApproved answer: ${entry.short ? `${entry.short}. ` : ''}${entry.text}` +
    (entry.citations?.length ? `\n\nSources: ${entry.citations.map((c) => c.title).join('; ')}` : '');
  const at = entry.updatedAt || entry.approvedAt || new Date().toISOString();
  return {
    schemaVersion: '1.0',
    id: `${ID_PREFIX}${entry.id}`,
    updateSequenceNumber: Date.parse(at) || Date.now(),
    displayName: `Security answer: ${entry.question}`.slice(0, 255),
    description: `${entry.short ? `${entry.short}. ` : ''}${entry.text}`.slice(0, 1000),
    // The questionnaire the answer was approved on, else the Vouch answer library.
    url: entry.source?.issueKey ? `${siteUrl}/browse/${entry.source.issueKey}` : `${siteUrl}${appPath}`,
    createdAt: entry.approvedAt || at,
    lastUpdatedAt: at,
    ...(entry.approvedBy ? { createdBy: { accountId: entry.approvedBy, externalId: entry.approvedBy } } : {}),
    // Answers are approved for anyone on the site to reuse, so they are visible to the whole workspace.
    permissions: [{ accessControls: [{ principals: [{ type: 'ATLASSIAN_WORKSPACE' }] }] }],
    'atlassian:document': {
      type: { category: 'DOCUMENT', mimeType: 'text/plain' },
      content: { mimeType: 'text/plain', text },
      labels: ['vouch', 'security-questionnaire', ...(entry.tags || [])].slice(0, 10),
    },
  };
}

/** Write library entries to the graph. Returns { ok, connected, written, error }. Never throws. */
export async function syncEntries(entries, opts = {}) {
  const conn = await store.getConnection();
  if (!conn?.connectionId) return { ok: false, connected: false, written: 0, error: 'No Teamwork Graph connection yet.' };
  if (!entries.length) return { ok: true, connected: true, written: 0 };
  try {
    let written = 0;
    for (let i = 0; i < entries.length; i += 100) {
      const objects = entries.slice(i, i + 100).map((e) => toDocument(e, opts));
      const r = await graph.setObjects({ objects, connectionId: conn.connectionId });
      if (!r.success) {
        console.error('Vouch: graph.setObjects failed', JSON.stringify(r.error || r).slice(0, 500), JSON.stringify(r.originalError || '').slice(0, 500));
        return { ok: false, connected: true, written, error: String(r.error?.message || r.error || 'The Teamwork Graph rejected the update.') };
      }
      const rejected = r.results?.rejected || [];
      if (rejected.length) {
        console.error('Vouch: graph rejected objects', JSON.stringify(rejected).slice(0, 800));
        return { ok: false, connected: true, written: written + objects.length - rejected.length, error: `The Teamwork Graph rejected ${rejected.length} answer(s).` };
      }
      written += objects.length;
    }
    return { ok: true, connected: true, written };
  } catch (e) {
    console.error('Vouch: graph sync threw', e);
    return { ok: false, connected: true, written: 0, error: String(e?.message || e) };
  }
}

export async function removeEntries(ids) {
  const conn = await store.getConnection();
  if (!conn?.connectionId || !ids.length) return { ok: true };
  try {
    await graph.deleteObjectsByExternalId({ objectType: 'atlassian:document', externalIds: ids.map((id) => `${ID_PREFIX}${id}`), connectionId: conn.connectionId });
    return { ok: true };
  } catch (e) {
    console.error('Vouch: graph delete threw', e);
    return { ok: false, error: String(e?.message || e) };
  }
}

/** Is one entry in the graph's search index yet? { ok, status }. */
export async function indexStatus(id) {
  const conn = await store.getConnection();
  if (!conn?.connectionId) return { ok: false, status: 'not connected' };
  try {
    const r = await graph.getObjectIndexStatusByExternalId({ objectType: 'atlassian:document', externalId: `${ID_PREFIX}${id}`, connectionId: conn.connectionId });
    return { ok: !!r.success, status: r.status || r.error?.message || 'unknown' };
  } catch (e) {
    return { ok: false, status: String(e?.message || e) };
  }
}

// graph:connector datasource.onConnectionChange: { action: CREATED|UPDATED|DELETED, name, connectionId, configProperties }
export async function onConnectionChange(event) {
  const { action, connectionId, name } = event || {};
  console.log(`Vouch: connection ${action} ${connectionId} (${name})`);
  if (action === 'DELETED') await store.deleteConnection();
  else if (connectionId) {
    await store.saveConnection({ connectionId, name: name || 'Vouch', at: new Date().toISOString() });
    // Push the existing library once the admin connects, so Rovo finds answers approved before the connection.
    const entries = await store.listLibrary();
    const r = await syncEntries(entries);
    const mark = { ok: r.ok, at: new Date().toISOString(), error: r.ok ? null : r.error, connected: true };
    for (const e of entries) await store.saveLibraryEntry({ ...e, graph: mark });
    console.log(`Vouch: initial graph sync ${r.ok ? 'ok' : 'failed'} (${r.written}/${entries.length})`, r.error || '');
  }
  return { success: true };
}
