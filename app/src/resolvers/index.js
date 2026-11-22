// UI resolvers: the backend for the issue panel, the issue action, the issue badge and the Vouch global page.
import ResolverModule from '@forge/resolver';
// With "type": "module", Forge's bundler hands back the CommonJS namespace; unwrap the class either way.
const Resolver = ResolverModule.default || ResolverModule;
import * as svc from '../service.js';
import * as store from '../store.js';
import * as products from '../products.js';
import { UserError, friendly } from '../errors.js';

const resolver = new Resolver();
const actorOf = (req) => ({ accountId: req.context?.accountId });
const issueKeyOf = (req) => req.payload?.issueKey || req.context?.extension?.issue?.key;
const ctxOf = (req) => ({ cloudId: req.context?.cloudId, actorId: req.context?.accountId });

const safe = (fn) => async (req) => {
  try {
    return await fn(req);
  } catch (e) {
    console.error(e);
    return { error: friendly(e) };
  }
};
const requireAdmin = async (what) => {
  if (!(await products.isJiraAdmin().catch(() => false))) throw new UserError(`Only Jira administrators can ${what}.`);
};
// The global page lives at /jira/apps/<appId>/<environmentId>; both are inside the module's localId.
const appPathOf = (req) => {
  const m = String(req.context?.localId || '').match(/extension\/([0-9a-f-]{36})\/([0-9a-f-]{36})\//);
  return m ? `/jira/apps/${m[1]}/${m[2]}` : '/jira/apps';
};

// ---- Issue panel and issue action ----------------------------------------------------------------------------

resolver.define('getIssueState', safe(async (req) => {
  const key = issueKeyOf(req);
  const [qn, settings] = await Promise.all([store.getQuestionnaire(key), store.getSettings()]);
  const files = qn ? null : await svc.candidates(key);
  return { issueKey: key, qn, counts: qn ? svc.counts(qn) : null, files, settings: { spaces: settings.spaceKeys, llmWriter: settings.llmWriter }, appPath: appPathOf(req) };
}));

resolver.define('importAndDraft', safe(async (req) => {
  const key = issueKeyOf(req);
  const imported = await svc.importQuestionnaire(key, req.payload?.attachmentId, req.context.accountId);
  const drafted = await svc.draftQuestionnaire(key, { budgetMs: 8000 });
  return { imported, drafted };
}));

// Called repeatedly by the panel until remaining is 0 (each call stays well under the 25 s limit).
resolver.define('draftNext', safe(async (req) => svc.draftQuestionnaire(issueKeyOf(req), { redraft: !!req.payload?.redraft })));
resolver.define('approve', safe(async (req) => svc.approve(issueKeyOf(req), req.payload.qid, { text: req.payload.text, short: req.payload.short }, req.context.accountId)));
resolver.define('approveAllHigh', safe(async (req) => svc.approveAllHigh(issueKeyOf(req), req.context.accountId)));
resolver.define('reopen', safe(async (req) => svc.reopen(issueKeyOf(req), req.payload.qid)));
resolver.define('suggestExperts', safe(async (req) => svc.suggestExperts(issueKeyOf(req), req.payload.qid, ctxOf(req))));
resolver.define('route', safe(async (req) => {
  const me = await products.usersInfo([req.context.accountId]).catch(() => ({}));
  return svc.routeToExpert(issueKeyOf(req), req.payload.qid, req.payload.accountId, { actorId: req.context.accountId, actorName: me[req.context.accountId]?.name });
}));
resolver.define('export', safe(async (req) => svc.exportQuestionnaire(issueKeyOf(req), req.context.accountId)));
resolver.define('discard', safe(async (req) => {
  await store.deleteQuestionnaire(issueKeyOf(req));
  return { ok: true };
}));

// ---- Global page ----------------------------------------------------------------------------------------------

resolver.define('getOverview', safe(async (req) => {
  // Remembered so graph documents can link back to the Vouch page.
  if (appPathOf(req) !== '/jira/apps') store.setMeta('appPath', appPathOf(req)).catch(() => null);
  const [qns, library, settings, connection, sample, isAdmin] = await Promise.all([
    store.listQuestionnaires(),
    store.listLibrary(),
    store.getSettings(),
    store.getConnection(),
    store.getSample(),
    products.isJiraAdmin().catch(() => false),
  ]);
  const questionnaires = qns
    .map((q) => ({ issueKey: q.issueKey, summary: q.summary, filename: q.attachment?.filename, createdAt: q.createdAt, counts: q.counts || svc.counts(q), exported: (q.exports || []).length }))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const anyRouted = qns.some((q) => q.routedAny);
  const anyApproved = qns.some((q) => q.approvedAny);
  return {
    isAdmin,
    settings,
    connection: connection ? { name: connection.name, at: connection.at } : null,
    sample,
    questionnaires,
    library,
    checklist: {
      spaces: settings.spaceKeys.length > 0,
      questionnaire: qns.length > 0,
      approved: anyApproved,
      routed: anyRouted,
      exported: qns.some((q) => (q.exports || []).length),
      connected: !!connection,
    },
    siteUrl: await products.siteUrl().catch(() => ''),
    appPath: appPathOf(req),
  };
}));

resolver.define('getChoices', safe(async () => {
  const [spaces, projects] = await Promise.all([products.listSpaces().catch(() => []), products.listProjects().catch(() => [])]);
  return { spaces, projects };
}));

resolver.define('saveSettings', safe(async (req) => {
  await requireAdmin('change Vouch settings');
  const spaceKeys = [...new Set((req.payload.spaceKeys || []).map(String))].slice(0, 20);
  const s = { ...(await store.getSettings()), spaceKeys, llmWriter: !!req.payload.llmWriter, updatedBy: req.context.accountId, updatedAt: new Date().toISOString() };
  await store.saveSettings(s);
  return { settings: s };
}));

resolver.define('loadSample', safe(async (req) => svc.loadSample(req.payload, actorOf(req))));
resolver.define('removeSample', safe(async (req) => svc.removeSample(actorOf(req))));
resolver.define('deleteLibraryEntry', safe(async (req) => {
  await requireAdmin('delete library answers');
  await svc.deleteLibraryEntry(req.payload.id);
  return { ok: true };
}));
resolver.define('benchmark', safe(async (req) => {
  await requireAdmin('run the answer benchmark');
  return svc.benchmarkNext({ restart: !!req.payload?.restart });
}));
resolver.define('getBenchmark', safe(async () => svc.summarizeBenchmark(await store.getBenchmark())));

resolver.define('resyncLibrary', safe(async () => {
  await requireAdmin('sync the library to the Teamwork Graph');
  return svc.resyncLibrary();
}));

export const handler = resolver.getDefinitions();
