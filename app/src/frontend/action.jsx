// "Answer with Vouch" issue action: read the attached questionnaire and draft every answer.
import React, { useEffect, useState } from 'react';
import ForgeReconciler, { Button, ErrorMessage, Inline, RadioGroup, SectionMessage, Spinner, Stack, Text, Strong } from '@forge/react';
import { events, router, view } from '@forge/bridge';
import { call, plural, UPDATED, useDraftLoop, DraftProgress } from './common.jsx';

const App = () => {
  const [state, setState] = useState(null);
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const { progress, run } = useDraftLoop();

  useEffect(() => {
    call('getIssueState').then((r) => {
      if (r?.error) setError(r.error);
      else {
        setState(r);
        setFile(r.files?.[0]?.id || null);
      }
    });
  }, []);

  const go = async () => {
    setBusy(true);
    setError('');
    const r = await call('importAndDraft', { attachmentId: file });
    if (r?.error) {
      setBusy(false);
      setError(r.error);
      return;
    }
    const last = await run({ first: r.drafted });
    setBusy(false);
    setResult({ ...r, drafted: last?.error ? r.drafted : last });
    events.emit(UPDATED).catch(() => null);
  };

  if (error && !state) return <ErrorMessage>{error}</ErrorMessage>;
  if (!state) return <Spinner label="Loading" />;

  if (result) {
    const c = result.drafted.counts;
    return (
      <Stack space="space.200">
        <SectionMessage appearance="success" title={`Drafted ${result.imported.questions} answers`}>
          <Stack space="space.100">
            <Text>
              Read <Strong>{result.imported.filename}</Strong>{result.imported.sheet ? ` (sheet "${result.imported.sheet}")` : ''}: questions in "{result.imported.headers.question}", answers go to "{result.imported.headers.text}"{result.imported.headers.yesno ? ` and "${result.imported.headers.yesno}"` : ''}.
            </Text>
            <Text>
              {c.high} high confidence · {c.medium} to check · {plural(c.gaps, 'gap')} for experts · searched {plural(result.drafted.knowledge?.pages || 0, 'page')} in {(result.drafted.knowledge?.spaces || []).join(', ')}{result.drafted.llm ? ' · written by Forge LLM with citations' : ''}.
            </Text>
          </Stack>
        </SectionMessage>
        <Text>Review the answers and route the gaps in the Vouch panel on this issue.</Text>
        <Inline space="space.100">
          <Button appearance="primary" onClick={() => view.close()}>Done</Button>
        </Inline>
      </Stack>
    );
  }

  if (state.qn) {
    return (
      <Stack space="space.200">
        <Text>This issue already has a questionnaire: <Strong>{state.qn.attachment.filename}</Strong>, {state.counts.done} of {state.counts.total} done.</Text>
        <Text>Open the Vouch panel on this issue to review, route and export it.</Text>
        <Button appearance="primary" onClick={() => view.close()}>Close</Button>
      </Stack>
    );
  }

  if (!state.files?.length) {
    return (
      <Stack space="space.200">
        <Text>Attach the customer's questionnaire to this issue as an .xlsx or .csv file, then run Answer with Vouch again.</Text>
        <Button onClick={() => view.close()}>Close</Button>
      </Stack>
    );
  }

  return (
    <Stack space="space.200">
      {!state.settings.spaces.length ? (
        <SectionMessage appearance="warning" title="Choose knowledge spaces first">
          <Inline space="space.100" alignBlock="center" shouldWrap>
            <Text>Vouch answers from the Confluence spaces chosen in its settings.</Text>
            <Button appearance="link" onClick={() => router.navigate(state.appPath).catch(() => null)}>Open Vouch settings</Button>
          </Inline>
        </SectionMessage>
      ) : null}
      <Text>Pick the questionnaire. Vouch drafts every answer from your Confluence policies, cites the page, and marks what it can't answer.</Text>
      <RadioGroup
        name="vouch-file"
        defaultValue={file}
        options={state.files.map((f) => ({ name: 'vouch-file', value: f.id, label: f.filename }))}
        onChange={(e) => setFile(e.target.value)}
      />
      {error ? <ErrorMessage>{error}</ErrorMessage> : null}
      <DraftProgress progress={progress} />
      <Inline space="space.100" alignBlock="center">
        <Button appearance="primary" isDisabled={busy || !state.settings.spaces.length} onClick={go}>{busy ? 'Reading and drafting…' : 'Draft answers'}</Button>
        <Button appearance="subtle" onClick={() => view.close()}>Cancel</Button>
        {busy && !progress ? <Spinner size="small" /> : null}
      </Inline>
    </Stack>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
