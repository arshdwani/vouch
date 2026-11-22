// Teamwork Graph (TWG) queries Vouch uses, called as the current user (TWG is asUser only).
// Lessons from the spike (docs/TWG-NOTES.md): operation names must be <company>_<operation>; never select
// edges.cursor; a missing scope returns an empty result, not an error; first <= 25.
import { asUser } from '@forge/api';

export const userAri = (accountId) => `ari:cloud:identity::user/${accountId}`;
export const pageAri = (cloudId, pageId) => `ari:cloud:confluence:${cloudId}:page/${pageId}`;

const QUERIES = {
  pageContributors: `query vouch_pageContributors($id: ID!, $first: Int) {
  confluencePageContributors(id: $id, first: $first) { edges { node { __typename ... on AtlassianUser { id accountId name } } } pageInfo { hasNextPage } }
}`,
  userTeams: `query vouch_userTeams($userId: ID!, $first: Int) {
  atlassianUserInTeams(userId: $userId, first: $first) { edges { node { __typename ... on AtlassianTeam { id displayName } } } pageInfo { hasNextPage } }
}`,
};
const FIELD = { pageContributors: 'confluencePageContributors', userTeams: 'atlassianUserInTeams' };

/** One curated query. Returns { ok, nodes, ms, error }. `ok` needs HTTP 200, data.<field> and no errors. */
export async function twg(key, variables) {
  const t0 = Date.now();
  try {
    const res = await asUser().requestTeamworkGraph(QUERIES[key], { first: 25, ...variables }, `vouch_${key}`);
    const body = await res.json().catch(() => null);
    const conn = body?.data?.[FIELD[key]];
    const nodes = (conn?.edges || []).map((e) => e?.node).filter(Boolean);
    const error = body?.errors?.length ? body.errors.map((e) => e.message).join('; ').slice(0, 300) : res.status !== 200 ? `HTTP ${res.status}` : null;
    if (error) console.warn(`TWG ${key} failed: ${error}`);
    return { ok: !error && !!conn, nodes, ms: Date.now() - t0, error };
  } catch (e) {
    console.warn(`TWG ${key} threw: ${e?.message || e}`);
    return { ok: false, nodes: [], ms: Date.now() - t0, error: String(e?.message || e) };
  }
}

/** Run tasks with at most `limit` in flight (TWG allows roughly 128 calls per 20 s per caller). */
export async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const worker = async () => {
    while (i < items.length) {
      const k = i++;
      out[k] = await fn(items[k], k);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

const accountIdOf = (node) => node.accountId || String(node.id || '').split('/').pop();
export const contributorsOf = (r) => r.nodes.filter((n) => n.__typename === 'AtlassianUser').map((n) => ({ accountId: accountIdOf(n), name: n.name }));
