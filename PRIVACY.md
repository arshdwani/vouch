# Vouch: privacy policy

_Last updated: 22 November 2026_

Vouch is a Forge app for Jira and Confluence. It runs entirely on Atlassian's infrastructure, with **no external
egress**; its production build is eligible for Atlassian's "Runs on Atlassian" program. This page explains what Vouch
stores and why.

## What Vouch stores
Vouch keeps the following in Forge hosted storage, which Atlassian operates for the site where the app is installed:
- **Questionnaires:** the questions read from spreadsheets attached to Jira issues, plus the drafted answers, their
  citations (Confluence page titles and links), confidence and review status.
- **The approved answer library:** answers your team approved, with their sources.
- **Atlassian account IDs** of people who approved answers or were asked to answer a question. Vouch does not store
  names or email addresses; display names are looked up at runtime.
- **Settings:** which Confluence spaces to draw on and whether AI-written answers are on.

## Processing
- **Confluence:** pages are read with the viewing user's permissions.
- **Teamwork Graph:** Vouch reads it to find who contributed to the pages behind a question.
- **Forge LLM:** when AI-written answers are on, the question and the cited passages are sent to Atlassian's Forge
  LLM service to phrase the reply. It runs on Atlassian's platform under Atlassian's terms. Replies that aren't
  backed by a cited passage are discarded.
- **Teamwork Graph connector:** if an org admin connects Vouch's connector, approved library answers are written to
  the Teamwork Graph as documents so Rovo can find them. As Atlassian's connector screen notes, they are then
  visible to everyone in the workspace.

## What Vouch does not do
Vouch sends no data outside Atlassian's platform, uses no external services, analytics or advertising, and doesn't
sell or share data.

## Retention and deletion
Data stays in the site's Forge storage until a user deletes it in Vouch (questionnaires, library answers, sample
data) or the app is uninstalled. Atlassian's Forge data lifecycle then applies.

## Contact
Open an issue at https://github.com/arshdwani/vouch/issues. Don't include confidential data.
