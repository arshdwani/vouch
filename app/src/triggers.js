// Event triggers and the issue badge.
import * as svc from './service.js';
import * as store from './store.js';

// avi:jira:commented:issue -> an expert answered on their sub-task?
export async function onCommentEvent(event) {
  const key = event?.issue?.key;
  const commentId = event?.comment?.id;
  if (!key || !commentId) return;
  try {
    const r = await svc.onExpertComment(key, commentId);
    if (r.answered) console.log(`Vouch: expert answer captured from ${key}`);
  } catch (e) {
    console.error('Vouch: comment handling failed', key, e);
  }
}

// jira:issueContext dynamicProperties: "31/40 answered · 6 with experts".
export async function contextStatus(payload) {
  const key = payload?.extension?.issue?.key;
  if (!key) return {};
  try {
    const b = svc.badge(await store.getQuestionnaire(key));
    // No lozenge on issues without a questionnaire, so the sidebar stays quiet everywhere else.
    return b ? { status: { type: 'lozenge', value: { label: b.label, type: b.type } } } : {};
  } catch (e) {
    console.error('Vouch: status failed', key, e.message);
    return {};
  }
}
