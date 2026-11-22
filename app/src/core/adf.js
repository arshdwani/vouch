// Atlassian Document Format builders for what Vouch writes into Jira. Pure, so the output is unit-tested.
import { clip } from './text.js';

export const txt = (text, marks) => (marks ? { type: 'text', text, marks } : { type: 'text', text });
export const strong = (text) => txt(text, [{ type: 'strong' }]);
export const link = (text, href) => (href ? txt(text, [{ type: 'link', attrs: { href } }]) : txt(text));
export const para = (...nodes) => ({ type: 'paragraph', content: nodes.filter(Boolean) });
export const heading = (level, text) => ({ type: 'heading', attrs: { level }, content: [txt(text)] });
export const bullets = (items) => ({ type: 'bulletList', content: items.map((nodes) => ({ type: 'listItem', content: [para(...[].concat(nodes))] })) });
export const quote = (...nodes) => ({ type: 'blockquote', content: [para(...nodes)] });
export const mention = (accountId, name) => ({ type: 'mention', attrs: { id: accountId, ...(name ? { text: `@${name}` } : {}) } });
export const doc = (...content) => ({ type: 'doc', version: 1, content: content.filter(Boolean) });

/**
 * The expert's sub-task description: the question, why they were picked (from the Teamwork Graph), what the
 * knowledge base already has nearby, and how to answer.
 */
export function expertTaskDescription({ question, ref, section, issueKey, issueUrl, expert, reason, pages = [], teams = [], issues = [], siteUrl = '', passages = [], requester }) {
  const chain = [
    ...pages.slice(0, 4).map((p) => [txt('Page '), link(p.title, p.url), txt(' → you contributed to it (Teamwork Graph: page contributors)')]),
    ...issues.slice(0, 3).map((i) => [txt('Work item '), link(`${i.key} ${clip(i.summary, 60)}`, siteUrl ? `${siteUrl}/browse/${i.key}` : null), txt(` → you are the ${i.role}`)]),
    ...teams.map((t) => [txt(`Team ${t} → you are a member (Teamwork Graph: user in teams)`)]),
  ];
  return doc(
    para(strong('Vouch needs your answer for a security questionnaire. '), txt('Reply with a comment on this sub-task; Vouch copies it into '), link(issueKey, issueUrl), txt(' and into the approved answer library.')),
    heading(3, `Question${ref ? ` ${ref}` : ''}${section ? ` (${section})` : ''}`),
    quote(txt(question)),
    heading(3, 'Why you'),
    para(expert?.accountId ? mention(expert.accountId, expert.name) : null, txt(`${expert?.accountId ? ': ' : ''}${reason}.`)),
    chain.length ? para(strong('How Vouch found you:')) : null,
    chain.length ? bullets(chain) : null,
    heading(3, 'What the knowledge base has nearby'),
    passages.length
      ? bullets(passages.slice(0, 3).map((p) => [link(p.heading ? `${p.title} › ${p.heading}` : p.title, p.url), txt(`: "${clip(p.text, 220)}"`)]))
      : para(txt('No policy page mentions this topic, so there was nothing to draft from.')),
    para(txt('Not enough to answer with confidence, which is why this came to you.')),
    heading(3, 'How to answer'),
    bullets([
      [txt('Write the answer as you would send it to the customer. Start with '), strong('Yes'), txt(' or '), strong('No'), txt(' for yes/no questions.')],
      [txt('Your first comment is used. Vouch then closes this sub-task.')],
    ]),
    requester ? para(txt('Asked by '), mention(requester.accountId, requester.name)) : null,
  );
}

export function questionnaireDescription(text) {
  return doc(para(txt(text)), para(txt('Open the Vouch panel on this issue, or use '), strong('Answer with Vouch'), txt(' from the issue actions menu.')));
}
