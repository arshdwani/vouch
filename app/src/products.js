// Thin wrappers over the Jira and Confluence REST APIs. `who` is 'user' (UI resolvers and Rovo actions: the
// current user's permissions) or 'app' (event triggers, where there is no user).
import { asApp, asUser, route, assumeTrustedRoute } from '@forge/api';

const as = (who) => (who === 'app' ? asApp() : asUser());

async function json(res, what, product = 'Jira') {
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const e = new Error(`${what} failed (${res.status}): ${body.slice(0, 300)}`);
    Object.assign(e, { status: res.status, what, product });
    throw e;
  }
  return res.status === 204 ? null : res.json();
}
const cjson = (res, what) => json(res, what, 'Confluence');
const JSON_HEADERS = { 'Content-Type': 'application/json', Accept: 'application/json' };

// ---- Jira ---------------------------------------------------------------------------------------------------

export async function getIssue(issueKey, who = 'user') {
  const res = await as(who).requestJira(route`/rest/api/3/issue/${issueKey}?fields=summary,project,attachment,issuetype,parent,status`);
  const issue = await json(res, `Reading ${issueKey}`);
  const f = issue.fields || {};
  return {
    key: issue.key,
    id: issue.id,
    summary: f.summary || '',
    projectId: f.project?.id,
    projectKey: f.project?.key,
    parentKey: f.parent?.key || null,
    isSubtask: !!f.issuetype?.subtask,
    attachments: (f.attachment || []).map((a) => ({ id: a.id, filename: a.filename, size: a.size, mimeType: a.mimeType, created: a.created, author: a.author?.displayName || '' })),
  };
}

export async function downloadAttachment(id, who = 'user') {
  const res = await as(who).requestJira(route`/rest/api/3/attachment/content/${id}`);
  if (!res.ok) await json(res, 'Downloading the questionnaire');
  return Buffer.from(await res.arrayBuffer());
}

/** Attach a file to an issue (multipart body built by hand; no FormData dependency). Returns the attachment. */
export async function attachFile(issueKey, filename, data, mimeType, who = 'user') {
  const boundary = `----vouch${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
  const safeName = filename.replace(/["\r\n]/g, '_');
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${safeName}"\r\nContent-Type: ${mimeType}\r\n\r\n`),
    data,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  let res = await as(who).requestJira(route`/rest/api/3/issue/${issueKey}/attachments`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'X-Atlassian-Token': 'no-check', Accept: 'application/json' },
    body,
  });
  if (!res.ok && res.status < 500 && typeof FormData !== 'undefined') {
    // Fallback: let the runtime build the multipart body.
    console.warn('Vouch: hand-built multipart refused, retrying with FormData', res.status, (await res.text()).slice(0, 200));
    const form = new FormData();
    form.append('file', new Blob([data], { type: mimeType }), safeName);
    res = await as(who).requestJira(route`/rest/api/3/issue/${issueKey}/attachments`, {
      method: 'POST',
      headers: { 'X-Atlassian-Token': 'no-check', Accept: 'application/json' },
      body: form,
    });
  }
  const out = await json(res, `Attaching ${filename} to ${issueKey}`);
  return Array.isArray(out) ? out[0] : out;
}

export async function getComment(issueKey, commentId, who = 'app') {
  const res = await as(who).requestJira(route`/rest/api/3/issue/${issueKey}/comment/${commentId}`);
  return json(res, `Reading a comment on ${issueKey}`);
}

export async function addComment(issueKey, adfContent, who = 'user') {
  const res = await as(who).requestJira(route`/rest/api/3/issue/${issueKey}/comment`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ body: { type: 'doc', version: 1, content: adfContent } }),
  });
  return json(res, `Commenting on ${issueKey}`);
}

async function issueTypes(projectId, who) {
  const meta = await json(await as(who).requestJira(route`/rest/api/3/issue/createmeta/${projectId}/issuetypes?maxResults=100`), 'Reading issue types');
  return meta.issueTypes || meta.values || [];
}

/**
 * Create the expert's sub-task under the questionnaire issue. Falls back to a linked Task when the project has no
 * sub-task type, and to unassigned when Jira won't let the expert be assigned. Returns { key, id, assigned, kind }.
 */
export async function createExpertTask({ parent, summary, description, assignee, who = 'user' }) {
  const types = await issueTypes(parent.projectId, who);
  const sub = types.find((t) => t.subtask);
  const task = types.find((t) => !t.subtask && t.name === 'Task') || types.find((t) => !t.subtask);
  const fields = {
    project: { id: parent.projectId },
    summary,
    description,
    labels: ['vouch-question'],
    ...(sub ? { parent: { key: parent.key }, issuetype: { id: sub.id } } : { issuetype: { id: task.id } }),
  };
  const post = (f) =>
    as(who).requestJira(route`/rest/api/3/issue`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ fields: f }) });
  let assigned = !!assignee;
  let res = await post(assignee ? { ...fields, assignee: { accountId: assignee } } : fields);
  if (!res.ok && assignee && res.status === 400) {
    console.warn('Vouch: expert not assignable here, creating unassigned', (await res.text()).slice(0, 200));
    assigned = false;
    res = await post(fields);
  }
  const created = await json(res, 'Creating the expert sub-task');
  if (!sub) {
    await as(who)
      .requestJira(route`/rest/api/3/issueLink`, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ type: { name: 'Relates' }, inwardIssue: { key: created.key }, outwardIssue: { key: parent.key } }),
      })
      .catch(() => null);
  }
  return { key: created.key, id: created.id, assigned, kind: sub ? 'sub-task' : 'task' };
}

/** Move an issue to the first transition that lands in a "done" status. Best effort. */
export async function transitionToDone(issueKey, who = 'app') {
  try {
    const data = await json(await as(who).requestJira(route`/rest/api/3/issue/${issueKey}/transitions`), 'Reading transitions');
    const t = (data.transitions || []).find((x) => x.to?.statusCategory?.key === 'done');
    if (!t) return false;
    const res = await as(who).requestJira(route`/rest/api/3/issue/${issueKey}/transitions`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ transition: { id: t.id } }),
    });
    return res.ok;
  } catch (e) {
    console.warn('Vouch: transition failed', issueKey, e.message);
    return false;
  }
}

export async function createIssue({ projectKey, summary, description, who = 'user' }) {
  const proj = await json(await as(who).requestJira(route`/rest/api/3/project/${projectKey}`), `Reading project ${projectKey}`);
  const types = await issueTypes(proj.id, who);
  const type = types.find((t) => !t.subtask && t.name === 'Task') || types.find((t) => !t.subtask);
  const res = await as(who).requestJira(route`/rest/api/3/issue`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ fields: { project: { id: proj.id }, issuetype: { id: type.id }, summary, description, labels: ['vouch-questionnaire'] } }),
  });
  return json(res, 'Creating the sample issue');
}

export async function deleteIssue(issueKey, who = 'user') {
  const res = await as(who).requestJira(route`/rest/api/3/issue/${issueKey}?deleteSubtasks=true`, { method: 'DELETE' });
  if (!res.ok && res.status !== 404) await json(res, `Deleting ${issueKey}`);
}

export async function listProjects(who = 'user') {
  const data = await json(await as(who).requestJira(route`/rest/api/3/project/search?maxResults=100&orderBy=name&action=create`), 'Reading projects');
  return (data.values || []).map((p) => ({ key: p.key, name: p.name, type: p.projectTypeKey }));
}

/** accountIds -> { [id]: { name, human } } where human means an active Atlassian account (not an app or customer). */
export async function usersInfo(accountIds, who = 'user') {
  const ids = [...new Set(accountIds.filter(Boolean))].slice(0, 90);
  if (!ids.length) return {};
  const qs = ids.map((id) => `accountId=${encodeURIComponent(id)}`).join('&');
  // route`` would encode the & between repeated parameters; each id is encoded above instead.
  const res = await as(who).requestJira(assumeTrustedRoute(`/rest/api/3/user/bulk?${qs}&maxResults=100`));
  const data = await json(res, 'Reading people');
  return Object.fromEntries((data.values || []).map((u) => [u.accountId, { name: u.displayName, human: u.accountType === 'atlassian' && u.active !== false }]));
}

export async function isJiraAdmin() {
  const data = await json(await asUser().requestJira(route`/rest/api/3/mypermissions?permissions=ADMINISTER`), 'Checking permissions');
  return !!data.permissions?.ADMINISTER?.havePermission;
}

export async function siteUrl(who = 'user') {
  const data = await json(await as(who).requestJira(route`/rest/api/3/serverInfo`), 'Reading site info');
  return String(data.baseUrl || '').replace(/\/$/, '');
}

/** JQL search: [{ key, summary, url, assignee: { accountId, name }, reporter }]. */
export async function searchIssues(jql, limit = 25, who = 'user') {
  const res = await as(who).requestJira(route`/rest/api/3/search/jql?jql=${jql}&maxResults=${limit}&fields=summary,assignee,reporter`);
  const data = await json(res, 'Searching Jira');
  const person = (u) => (u?.accountId ? { accountId: u.accountId, name: u.displayName } : null);
  return (data.issues || []).map((i) => ({ key: i.key, summary: i.fields?.summary || '', assignee: person(i.fields?.assignee), reporter: person(i.fields?.reporter) }));
}

// ---- Confluence ---------------------------------------------------------------------------------------------

export async function listSpaces(who = 'user') {
  const out = [];
  let cursor = null;
  for (let i = 0; i < 4; i++) {
    const res = await as(who).requestConfluence(cursor ? route`/wiki/api/v2/spaces?limit=250&status=current&cursor=${cursor}` : route`/wiki/api/v2/spaces?limit=250&status=current`);
    const data = await cjson(res, 'Listing Confluence spaces');
    for (const s of data.results || []) if (s.type !== 'personal') out.push({ id: s.id, key: s.key, name: s.name });
    cursor = new URLSearchParams(String(data._links?.next || '').split('?')[1] || '').get('cursor');
    if (!cursor) break;
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

async function spaceIds(keys, who) {
  const res = await as(who).requestConfluence(route`/wiki/api/v2/spaces?keys=${keys.join(',')}&limit=50`);
  const data = await cjson(res, 'Reading knowledge spaces');
  return (data.results || []).map((s) => ({ id: s.id, key: s.key, name: s.name }));
}

/**
 * Every current page (with its storage body) in the given spaces, up to `maxPerSpace` each.
 * Returns { pages: [{ id, title, url, body, spaceKey }], truncated }.
 */
export async function spacePages(keys, { who = 'user', maxPerSpace = 300 } = {}) {
  if (!keys.length) return { pages: [], truncated: false };
  const spaces = await spaceIds(keys, who);
  const pages = [];
  let truncated = false;
  await Promise.all(
    spaces.map(async (s) => {
      let cursor = null;
      let n = 0;
      do {
        const res = await as(who).requestConfluence(
          cursor
            ? route`/wiki/api/v2/spaces/${s.id}/pages?body-format=storage&status=current&limit=100&cursor=${cursor}`
            : route`/wiki/api/v2/spaces/${s.id}/pages?body-format=storage&status=current&limit=100`,
        );
        const data = await cjson(res, `Reading pages in ${s.name}`);
        const base = String(data._links?.base || '').replace(/\/$/, '');
        for (const p of data.results || []) {
          pages.push({ id: p.id, title: p.title, url: p._links?.webui ? `${base}${p._links.webui}` : null, body: p.body?.storage?.value || '', spaceKey: s.key });
          n++;
        }
        cursor = new URLSearchParams(String(data._links?.next || '').split('?')[1] || '').get('cursor');
        if (cursor && n >= maxPerSpace) {
          truncated = true;
          cursor = null;
        }
      } while (cursor);
    }),
  );
  return { pages, truncated, spaces };
}

/** CQL page search that also returns page bodies (storage format): [{ id, title, url, body, spaceKey }]. */
export async function searchPagesWithBodies(cql, limit = 5, who = 'user') {
  const res = await as(who).requestConfluence(route`/wiki/rest/api/content/search?cql=${cql}&limit=${limit}&expand=body.storage,space`);
  const data = await cjson(res, 'Searching Confluence');
  const base = String(data._links?.base || '').replace(/\/$/, '');
  return (data.results || []).map((p) => ({ id: p.id, title: p.title, url: p._links?.webui ? `${base}${p._links.webui}` : null, body: p.body?.storage?.value || '', spaceKey: p.space?.key }));
}

/** CQL page search. Returns [{ id, title, url, spaceKey, createdBy, lastEditedBy }]. */
export async function searchPages(cql, limit = 10, who = 'user') {
  const res = await as(who).requestConfluence(route`/wiki/rest/api/search?cql=${cql}&limit=${limit}&expand=content.history,content.version,content.space`);
  const data = await cjson(res, 'Searching Confluence');
  const base = String(data._links?.base || '').replace(/\/$/, '');
  return (data.results || [])
    .filter((x) => x.content?.type === 'page')
    .map((x) => ({
      id: x.content.id,
      title: x.content.title,
      url: x.url ? `${base}${x.url}` : x.content._links?.webui ? `${base}${x.content._links.webui}` : null,
      spaceKey: x.content.space?.key,
      spaceName: x.content.space?.name,
      createdBy: x.content.history?.createdBy ? { accountId: x.content.history.createdBy.accountId, name: x.content.history.createdBy.displayName } : null,
      lastEditedBy: x.content.version?.by ? { accountId: x.content.version.by.accountId, name: x.content.version.by.displayName } : null,
    }));
}

export async function findPage(spaceId, title, who = 'user') {
  const res = await as(who).requestConfluence(route`/wiki/api/v2/pages?space-id=${spaceId}&title=${title}&status=current&limit=1`);
  const data = await cjson(res, `Looking for "${title}"`);
  return data.results?.[0] || null;
}

export async function createPage({ spaceId, parentId, title, body, who = 'user' }) {
  const res = await as(who).requestConfluence(route`/wiki/api/v2/pages`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ spaceId, status: 'current', title, ...(parentId ? { parentId } : {}), body: { representation: 'storage', value: body } }),
  });
  return cjson(res, `Creating page "${title}"`);
}

export async function deletePage(id, who = 'user') {
  const res = await as(who).requestConfluence(route`/wiki/api/v2/pages/${id}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 404) await cjson(res, 'Deleting a sample page');
}

export async function spaceByKey(key, who = 'user') {
  return (await spaceIds([key], who))[0] || null;
}
