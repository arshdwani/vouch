// Expert ranking for questions the knowledge base can't answer. Input comes from the Teamwork Graph
// (pages on the topic -> who contributed to each), so the reason shown is a fact people can check:
// "Contributed to 6 of 10 pages about encryption".

/**
 * pages: [{ id, title, url, contributors: [{ accountId, name }] }] in search-relevance order.
 * opts: { exclude: Set|[] of accountIds (the requester, app users), eligible: (accountId) => bool, topic: string }
 * Returns [{ accountId, name, pages, of, score, titles: [{ title, url }], reason }], best first.
 */
export function rankExperts(pages, { exclude = [], eligible = () => true, topic = '', issues = [] } = {}) {
  const skip = new Set(exclude);
  const people = new Map();
  const person = (id, name, rank) => {
    const x = people.get(id) || { accountId: id, name: name || 'Unknown', pages: 0, score: 0, titles: [], spaces: [], issues: [], firstRank: rank };
    people.set(id, x);
    return x;
  };
  pages.forEach((p, rank) => {
    const seen = new Set();
    for (const u of p.contributors || []) {
      const id = u.accountId;
      if (!id || seen.has(id) || skip.has(id) || !eligible(id)) continue;
      seen.add(id);
      const x = person(id, u.name, rank);
      x.pages += 1;
      // Pages whose title names the topic count more; earlier (more relevant) pages a little more.
      x.score += (p.weight || 1) / (1 + 0.1 * rank);
      if (x.titles.length < 5) x.titles.push({ title: p.title, url: p.url });
      if (p.space && !x.spaces.includes(p.space)) x.spaces.push(p.space);
    }
  });
  // Second signal: people assigned to (or who reported) Jira work items on the topic.
  issues.forEach((it, rank) => {
    for (const [u, role, w] of [[it.assignee, 'assignee', 0.8], [it.reporter, 'reporter', 0.4]]) {
      if (!u?.accountId || skip.has(u.accountId) || !eligible(u.accountId)) continue;
      const x = person(u.accountId, u.name, pages.length + rank);
      if (x.issues.some((i) => i.key === it.key)) continue;
      x.score += w / (1 + 0.1 * rank);
      if (x.issues.length < 5) x.issues.push({ key: it.key, summary: it.summary, role });
    }
  });
  const of = pages.length;
  const about = topic ? ` about ${topic}` : '';
  return [...people.values()]
    .sort((a, b) => b.score - a.score || a.firstRank - b.firstRank || a.name.localeCompare(b.name))
    .map(({ firstRank, ...x }) => {
      const parts = [];
      if (x.pages) parts.push(`Contributed to ${x.pages} of ${of} page${of === 1 ? '' : 's'}${about}${x.spaces.length ? ` in ${x.spaces.slice(0, 2).join(', ')}` : ''}`);
      if (x.issues.length) parts.push(`${parts.length ? 'w' : 'W'}orked on ${x.issues.length} related work item${x.issues.length === 1 ? '' : 's'} (${x.issues.slice(0, 3).map((i) => i.key).join(', ')})`);
      return { ...x, of, reason: parts.join('; ') };
    });
}

/** Team names to show next to an expert: a team whose name shares a word with the topic first, else the first. */
export function pickTeams(teams, topicWords = [], n = 2) {
  const words = topicWords.map((w) => w.toLowerCase());
  const names = [...new Set((teams || []).map((t) => t.displayName || t.name).filter(Boolean))];
  // Only teams whose name relates to the topic: a list of unrelated teams is noise, not evidence.
  return names.filter((t) => words.some((w) => w.length > 2 && t.toLowerCase().includes(w.slice(0, 5)))).slice(0, n);
}

/** A CQL text clause for topic words, escaped. One clause with all words, used first; then any-word fallback. */
export function topicCql(words, { spaces = [], any = false } = {}) {
  const esc = (w) => String(w).replace(/["\\]/g, ' ').trim();
  const clean = words.map(esc).filter(Boolean);
  if (!clean.length) return null;
  const text = any ? `(${clean.map((w) => `text ~ "${w}"`).join(' OR ')})` : `text ~ "${clean.join(' ')}"`;
  const space = spaces.length ? ` AND space in (${spaces.map((s) => `"${esc(s)}"`).join(',')})` : '';
  return `type = page${space} AND ${text}`;
}

/** CQL for pages whose title names any topic word (the strongest sign a page is about the topic). */
export function titleCql(words) {
  const clean = words.map((w) => String(w).replace(/["\\]/g, ' ').trim()).filter(Boolean);
  return clean.length ? `type = page AND (${clean.map((w) => `title ~ "${w}"`).join(' OR ')})` : null;
}

/** 1 + 1.5 per topic word the title contains (prefix match, so "audits" counts for "audit"). */
export function titleWeight(title, words) {
  const t = String(title || '').toLowerCase();
  return 1 + 1.5 * words.filter((w) => t.includes(String(w).toLowerCase().slice(0, Math.max(4, String(w).length - 2)))).length;
}
