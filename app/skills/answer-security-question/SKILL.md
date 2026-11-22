---
name: answer-security-question
description: Answer a vendor security questionnaire question (encryption, access control, retention, incident response, continuity, subprocessors, SDLC, vulnerability management, HR or physical security) from the company's own Confluence policies and approved answer library, with sources. Use whenever someone asks how the company handles a security or compliance topic a customer asked about.
---

# Answer a security question with Vouch

1. Call the `answer-security-question` action with the question exactly as the customer wrote it.
2. If it returns an `answer`, reply with that text unchanged, then list every entry in `sources` (title and link,
   or "no link"). Mention the `confidence`; for "medium", suggest a reviewer checks it before it is sent.
3. If `confidence` is "none", do not answer from general knowledge. Say that no approved policy covers it, show
   `nearestPassages` if there are any, and suggest routing it to an expert from the questionnaire issue in Jira
   (Vouch panel → Find expert), where the Teamwork Graph picks the person who knows the topic.
