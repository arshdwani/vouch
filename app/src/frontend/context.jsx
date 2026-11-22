// Issue sidebar (jira:issueContext): questionnaire progress at a glance. The lozenge comes from contextStatus.
import React, { useEffect, useState } from 'react';
import ForgeReconciler, { ProgressBar, Spinner, Stack, Text } from '@forge/react';
import { events } from '@forge/bridge';
import { call, plural, UPDATED } from './common.jsx';

const App = () => {
  const [state, setState] = useState(null);
  const load = () => call('getIssueState').then(setState);
  useEffect(() => {
    load();
    let sub;
    events.on(UPDATED, load).then((s) => (sub = s)).catch(() => null);
    return () => sub?.unsubscribe?.();
  }, []);
  if (!state) return <Spinner size="small" />;
  if (state.error) return <Text>{state.error}</Text>;
  if (!state.qn) return <Text>{state.files?.length ? 'A questionnaire is attached. Use Answer with Vouch from the ••• menu.' : 'Attach a questionnaire (.xlsx or .csv) and use Answer with Vouch.'}</Text>;
  const c = state.counts;
  return (
    <Stack space="space.100">
      <ProgressBar value={c.total ? c.done / c.total : 0} ariaLabel="Questionnaire progress" />
      <Text>{c.answered}/{c.total} answered · {c.done} approved · {plural(c.gaps, 'gap')} · {c.routed} with experts</Text>
    </Stack>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
