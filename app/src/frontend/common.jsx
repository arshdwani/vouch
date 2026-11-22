// Pieces shared by the issue panel, issue action, issue badge and the Vouch page (Atlassian UI Kit only).
import React, { useState } from 'react';
import { invoke } from '@forge/bridge';
import { Box, Inline, Link, Lozenge, ProgressBar, Stack, Text } from '@forge/react';

// invoke() that always resolves: a failed or timed-out call becomes { error } with a message people can act on.
export const call = (name, payload) =>
  invoke(name, payload).catch((e) => {
    console.error(name, e);
    return { error: 'Vouch took too long to respond. Please try again.' };
  });

export const UPDATED = 'vouch:updated';

// A lozenge that keeps its full text in a narrow column.
export const Pill = ({ appearance, children }) => (
  <Box xcss={{ minWidth: 'max-content' }}>
    <Lozenge appearance={appearance}>{children}</Lozenge>
  </Box>
);

const CONF = { high: ['success', 'High confidence'], medium: ['moved', 'Check this'], none: ['removed', 'No answer'] };
export const Confidence = ({ value }) => (CONF[value] ? <Pill appearance={CONF[value][0]}>{CONF[value][1]}</Pill> : null);

const STATUS = {
  pending: ['default', 'Not drafted'],
  drafted: ['inprogress', 'To review'],
  gap: ['removed', 'Gap'],
  routed: ['moved', 'With expert'],
  answered: ['success', 'Expert answer'],
  approved: ['success', 'Approved'],
  existing: ['default', 'Already answered'],
};
export const Status = ({ value }) => (STATUS[value] ? <Pill appearance={STATUS[value][0]}>{STATUS[value][1]}</Pill> : null);

export const Sources = ({ citations }) => {
  if (!citations?.length) return null;
  return (
    <Inline space="space.100" shouldWrap alignBlock="center">
      <Text>Source:</Text>
      {citations.map((c, i) =>
        c.type === 'library' ? (
          <Text key={i}>Approved answer library</Text>
        ) : c.url ? (
          <Link key={i} href={c.url} openNewTab>{c.heading ? `${c.title} › ${c.heading}` : c.title}</Link>
        ) : (
          <Text key={i}>{c.title}</Text>
        ),
      )}
    </Inline>
  );
};

export const clip = (s, n) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

export const answerLine = (a) => (a?.text ? `${a.short && !a.text.startsWith(a.short) ? `${a.short}. ` : ''}${a.text}` : '');

export const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

export const stripMarkers = (s) => String(s || '').replace(/\s*\[\d+(?:\s*,\s*\d+)*\]/g, '').replace(/\s+([.,;:])/g, '$1').trim();

// Drafting runs in chunks (each resolver call stays under the 25 s limit); this keeps calling draftNext until no
// question is left, reporting progress. Returns the last response, or { error }.
export function useDraftLoop(onStep) {
  const [progress, setProgress] = useState(null); // { done, total }
  const run = async ({ redraft = false, first } = {}) => {
    let r = first || (await call('draftNext', { redraft }));
    for (let guard = 0; guard < 80; guard++) {
      if (r?.error) r = await call('draftNext', {}); // one retry: a slow step should not stop the whole run
      if (r?.error) break;
      setProgress({ done: r.total - r.remaining, total: r.total, llm: r.llm });
      if (onStep) onStep(r);
      if (!r.remaining) break;
      r = await call('draftNext', {});
    }
    setProgress(null);
    return r;
  };
  return { progress, run };
}

export const DraftProgress = ({ progress }) =>
  progress ? (
    <Stack space="space.050">
      <ProgressBar value={progress.total ? progress.done / progress.total : 0} ariaLabel="Drafting progress" />
      <Text>Drafting {progress.done} of {progress.total}{progress.llm ? ' with Forge LLM (grounded, cited)' : ''}…</Text>
    </Stack>
  ) : null;
