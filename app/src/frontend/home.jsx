// Vouch global page: Getting started (with Load sample), Questionnaires, Answer library, Settings.
import React, { useCallback, useEffect, useState } from 'react';
import ForgeReconciler, {
  Box,
  Button,
  DynamicTable,
  ErrorMessage,
  Heading,
  Inline,
  Label,
  Link,
  Lozenge,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  ModalTransition,
  ProgressBar,
  SectionMessage,
  Select,
  Spinner,
  Stack,
  Strong,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  Text,
  Toggle,
  User,
} from '@forge/react';
import { call, clip, plural } from './common.jsx';

const Step = ({ done, title, children }) => (
  <Inline space="space.150" alignBlock="start">
    <Box xcss={{ minWidth: '72px' }}>
      <Lozenge appearance={done ? 'success' : 'default'}>{done ? 'Done' : 'To do'}</Lozenge>
    </Box>
    <Stack space="space.050">
      <Text><Strong>{title}</Strong></Text>
      {children}
    </Stack>
  </Inline>
);

const SampleCard = ({ data, choices, loadChoices, onChanged, setFlash }) => {
  const [space, setSpace] = useState(null);
  const [project, setProject] = useState(null);
  const [busy, setBusy] = useState('');
  const [confirm, setConfirm] = useState(false);
  const remove = async () => {
    setConfirm(false);
    setBusy('remove');
    const r = await call('removeSample');
    setBusy('');
    setFlash(r?.error ? { appearance: 'error', msg: r.error } : { appearance: 'success', msg: 'Sample removed: pages, issue, sub-tasks and library answers.' });
    onChanged();
  };
  useEffect(() => {
    if (!choices) loadChoices();
  }, []);
  if (!data.isAdmin) return <Text>A Jira administrator can load a sample questionnaire and policies from here.</Text>;
  if (data.sample) {
    return (
      <SectionMessage appearance="information" title="Sample loaded">
        <Stack space="space.100">
          <Text>
            10 Brightlake policy pages in {data.sample.spaceKey}, 3 approved library answers, and the Halden Bank questionnaire on{' '}
            <Link href={`/browse/${data.sample.issueKey}`}>{data.sample.issueKey}</Link>. Open the issue and use Answer with Vouch.
          </Text>
          <Inline space="space.100">
            <Button appearance="subtle" isDisabled={!!busy} onClick={() => setConfirm(true)}>
              {busy === 'remove' ? 'Removing…' : 'Remove sample'}
            </Button>
          </Inline>
        </Stack>
        <ModalTransition>
          {confirm ? (
            <Modal onClose={() => setConfirm(false)}>
              <ModalHeader>
                <ModalTitle appearance="danger">Remove the sample?</ModalTitle>
              </ModalHeader>
              <ModalBody>
                <Text>This permanently deletes the 10 sample policy pages in {data.sample.spaceKey}, issue {data.sample.issueKey} with its sub-tasks, and the sample library answers. Your own questionnaires and answers stay.</Text>
              </ModalBody>
              <ModalFooter>
                <Button appearance="subtle" onClick={() => setConfirm(false)}>Cancel</Button>
                <Button appearance="danger" onClick={remove}>Remove sample</Button>
              </ModalFooter>
            </Modal>
          ) : null}
        </ModalTransition>
      </SectionMessage>
    );
  }
  return (
    <Stack space="space.150">
      <Text>Creates 10 security policy pages for a fictional company in a space you choose, 3 approved library answers, and a Jira issue with a 40-question vendor security questionnaire attached. Five questions have no policy on purpose, so you can route them to experts.</Text>
      {!choices ? (
        <Spinner size="small" />
      ) : (
        <Inline space="space.150" alignBlock="end" shouldWrap>
          <Stack space="space.050">
            <Label labelFor="vouch-sample-space">Confluence space for the policies</Label>
            <Box xcss={{ width: '280px' }}>
              <Select id="vouch-sample-space" options={choices.spaces.map((s) => ({ label: `${s.name} (${s.key})`, value: s.key }))} onChange={(o) => setSpace(o?.value)} />
            </Box>
          </Stack>
          <Stack space="space.050">
            <Label labelFor="vouch-sample-project">Jira project for the questionnaire</Label>
            <Box xcss={{ width: '280px' }}>
              <Select id="vouch-sample-project" options={choices.projects.map((p) => ({ label: `${p.name} (${p.key})`, value: p.key }))} onChange={(o) => setProject(o?.value)} />
            </Box>
          </Stack>
          <Button
            appearance="primary"
            isDisabled={!space || !project || !!busy}
            onClick={async () => {
              setBusy('load');
              const r = await call('loadSample', { spaceKey: space, projectKey: project });
              setBusy('');
              setFlash(r?.error ? { appearance: 'error', msg: r.error } : { appearance: 'success', msg: `Sample loaded: ${r.pages} policy pages and ${r.issueKey}. Open ${r.issueKey} and use Answer with Vouch.` });
              onChanged();
            }}
          >
            {busy === 'load' ? 'Loading sample…' : 'Load sample'}
          </Button>
        </Inline>
      )}
    </Stack>
  );
};

const App = () => {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [flash, setFlash] = useState(null);
  const [choices, setChoices] = useState(null);
  const [cfg, setCfg] = useState(null);
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    const r = await call('getOverview');
    if (r?.error) setError(r.error);
    else {
      setError('');
      setData(r);
      setCfg({ spaceKeys: r.settings.spaceKeys, llmWriter: r.settings.llmWriter !== false });
    }
  }, []);
  const loadChoices = async () => {
    const r = await call('getChoices');
    setChoices(r?.error ? { spaces: [], projects: [] } : r);
  };
  useEffect(() => {
    load();
  }, [load]);

  if (error) {
    return (
      <Stack space="space.100">
        <ErrorMessage>{error}</ErrorMessage>
        <Button onClick={() => { setError(''); load(); }}>Try again</Button>
      </Stack>
    );
  }
  if (!data) return <Spinner label="Loading Vouch" />;
  const ck = data.checklist;

  const qnHead = { cells: [{ key: 'issue', content: 'Issue' }, { key: 'file', content: 'Questionnaire' }, { key: 'p', content: 'Progress' }, { key: 'gaps', content: 'Gaps' }, { key: 'exp', content: 'With experts' }, { key: 'x', content: 'Exported' }] };
  const qnRows = data.questionnaires.map((q) => ({
    key: q.issueKey,
    cells: [
      { key: 'issue', content: <Stack space="space.025"><Link href={`/browse/${q.issueKey}`}>{q.issueKey}</Link><Text>{clip(q.summary, 60)}</Text></Stack> },
      { key: 'file', content: <Text>{q.filename}</Text> },
      { key: 'p', content: <Stack space="space.050"><ProgressBar value={q.counts.total ? q.counts.done / q.counts.total : 0} ariaLabel="progress" /><Text>{q.counts.done}/{q.counts.total} done</Text></Stack> },
      { key: 'gaps', content: <Text>{q.counts.gaps}</Text> },
      { key: 'exp', content: <Text>{q.counts.routed}</Text> },
      { key: 'x', content: <Text>{q.exported ? 'Yes' : 'No'}</Text> },
    ],
  }));
  const connected = !!data.connection;
  const libHead = { cells: [{ key: 'q', content: 'Question', width: 30 }, { key: 'a', content: 'Approved answer', width: 40 }, { key: 'by', content: 'Approved by', width: 14 }, ...(connected ? [{ key: 'g', content: 'Teamwork Graph', width: 10 }] : []), { key: 'x', content: '', width: 6 }] };
  const libRows = data.library.map((e) => ({
    key: e.id,
    cells: [
      { key: 'q', content: <Text>{clip(e.question, 120)}</Text> },
      { key: 'a', content: <Stack space="space.025"><Text>{clip(`${e.short ? `${e.short}. ` : ''}${e.text}`, 200)}</Text><Text>{e.source?.type === 'expert' ? `Expert answer${e.source.issueKey ? ` on ${e.source.issueKey}` : ''}` : e.source?.type === 'sample' ? 'Sample' : e.citations?.length ? `From ${e.citations.map((c) => c.title).join(', ')}` : 'Written by a reviewer'}</Text></Stack> },
      { key: 'by', content: e.approvedBy ? <User accountId={e.approvedBy} /> : <Text>-</Text> },
      ...(connected ? [{ key: 'g', content: <Lozenge appearance={e.graph?.ok ? 'success' : 'removed'}>{e.graph?.ok ? 'In graph' : 'Not synced yet'}</Lozenge> }] : []),
      {
        key: 'x',
        content: data.isAdmin ? (
          <Button
            appearance="subtle"
            spacing="compact"
            onClick={async () => {
              const r = await call('deleteLibraryEntry', { id: e.id });
              if (r?.error) setFlash({ appearance: 'error', msg: r.error });
              load();
            }}
          >
            Delete
          </Button>
        ) : null,
      },
    ],
  }));

  return (
    <Stack space="space.200">
      <Stack space="space.050">
        <Text>Answers vendor security questionnaires from your Confluence policies, with citations. Routes the gaps to the people who know, found through the Teamwork Graph.</Text>
      </Stack>
      {flash ? <SectionMessage appearance={flash.appearance}><Text>{flash.msg}</Text></SectionMessage> : null}
      <Tabs id="vouch-tabs">
        <TabList>
          <Tab>Getting started</Tab>
          <Tab>Questionnaires ({data.questionnaires.length})</Tab>
          <Tab>Answer library ({data.library.length})</Tab>
          <Tab>Settings</Tab>
        </TabList>

        <TabPanel>
          <Box padding="space.200">
            <Stack space="space.200">
              <Step done={ck.spaces} title="1. Choose the Confluence spaces with your security policies">
                <Text>Settings tab. Vouch only answers from these spaces and from the approved answer library.</Text>
              </Step>
              <Step done={ck.questionnaire} title="2. Attach a questionnaire to a Jira issue and click Answer with Vouch">
                <Text>XLSX or CSV. Vouch finds the question column and where answers go, then drafts every answer with a citation.</Text>
              </Step>
              <Step done={ck.approved} title="3. Review in the Vouch panel on the issue">
                <Text>Approve high-confidence answers in one click; edit the rest. Approved answers join the library.</Text>
              </Step>
              <Step done={ck.routed} title="4. Route a gap to an expert">
                <Text>Find expert searches Confluence for the topic and asks the Teamwork Graph who contributed to those pages. The expert gets a sub-task; their first comment becomes the answer.</Text>
              </Step>
              <Step done={ck.exported} title="5. Export">
                <Text>The original spreadsheet comes back attached to the issue with the answers filled in.</Text>
              </Step>
              <Step done={ck.connected} title="6. Let Rovo find your approved answers (admin)">
                <Text>In Atlassian Administration open Connectors → Add connector and connect "Vouch answer library" (under Other). Approved answers are then written to the Teamwork Graph, where Rovo search finds them.</Text>
              </Step>
              <Heading size="small">Try it with sample data</Heading>
              <SampleCard data={data} choices={choices} loadChoices={loadChoices} onChanged={load} setFlash={setFlash} />
            </Stack>
          </Box>
        </TabPanel>

        <TabPanel>
          <Box padding="space.200">
            {qnRows.length ? <DynamicTable head={qnHead} rows={qnRows} rowsPerPage={15} /> : <Text>No questionnaires yet. Attach one to a Jira issue and use Answer with Vouch.</Text>}
          </Box>
        </TabPanel>

        <TabPanel>
          <Box padding="space.200">
            <Stack space="space.200">
              <Inline space="space.100" alignBlock="center" shouldWrap>
                {data.connection ? (
                  <Text>Connected to the Teamwork Graph as "{data.connection.name}". Approved answers are written there, so Rovo search finds them.</Text>
                ) : (
                  <SectionMessage appearance="information" title="Let Rovo find these answers">
                    <Text>{data.isAdmin ? 'Connect "Vouch answer library" in Atlassian Administration → Connectors → Add connector (under Other). Vouch then writes every approved answer to the Teamwork Graph.' : 'An admin can connect this library to the Teamwork Graph so Rovo search finds approved answers.'}</Text>
                  </SectionMessage>
                )}
                {data.isAdmin && data.connection ? (
                  <Button
                    isDisabled={!!busy}
                    onClick={async () => {
                      setBusy('sync');
                      const r = await call('resyncLibrary');
                      setBusy('');
                      setFlash(r?.error ? { appearance: 'error', msg: r.error } : r.ok ? { appearance: 'success', msg: `Wrote ${r.written} of ${r.total} answers to the Teamwork Graph${r.indexStatus ? ` (search index: ${r.indexStatus.status})` : ''}.` } : { appearance: 'warning', msg: r.error });
                      load();
                    }}
                  >
                    {busy === 'sync' ? 'Syncing…' : 'Sync all to Teamwork Graph'}
                  </Button>
                ) : null}
              </Inline>
              {libRows.length ? <DynamicTable head={libHead} rows={libRows} rowsPerPage={15} /> : <Text>No approved answers yet. Approving an answer in a questionnaire adds it here.</Text>}
            </Stack>
          </Box>
        </TabPanel>

        <TabPanel>
          <Box padding="space.200">
            <SettingsTab data={data} cfg={cfg} setCfg={setCfg} choices={choices} loadChoices={loadChoices} setFlash={setFlash} onSaved={load} />
          </Box>
        </TabPanel>
      </Tabs>
    </Stack>
  );
};

const SettingsTab = ({ data, cfg, setCfg, choices, loadChoices, setFlash, onSaved }) => {
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!choices) loadChoices();
  }, []);
  if (!choices) return <Spinner size="small" />;
  const options = choices.spaces.map((s) => ({ label: `${s.name} (${s.key})`, value: s.key }));
  return (
    <Stack space="space.200">
      {!data.isAdmin ? <SectionMessage appearance="information"><Text>Only Jira administrators can change these settings.</Text></SectionMessage> : null}
      <Stack space="space.050">
        <Label labelFor="vouch-spaces">Knowledge spaces</Label>
        <Box xcss={{ maxWidth: '560px' }}>
          <Select
            id="vouch-spaces"
            isMulti
            isDisabled={!data.isAdmin}
            options={options}
            defaultValue={options.filter((o) => cfg.spaceKeys.includes(o.value))}
            onChange={(v) => setCfg({ ...cfg, spaceKeys: (v || []).map((o) => o.value) })}
          />
        </Box>
        <Text>Vouch drafts answers only from pages in these spaces, read with the permissions of the person using it.</Text>
      </Stack>
      <Inline space="space.100" alignBlock="center">
        <Toggle id="vouch-llm" isDisabled={!data.isAdmin} isChecked={cfg.llmWriter} onChange={() => setCfg({ ...cfg, llmWriter: !cfg.llmWriter })} />
        <Text>Write answers with Forge LLM when this site has it. The model sees only the top passages from your pages, must cite one for every claim and say NO_ANSWER when they don't answer the question; a reply that cites nothing or adds a number the sources don't contain is discarded for the verbatim extract. Off: verbatim extracts only.</Text>
      </Inline>
      <Inline space="space.100">
        <Button
          appearance="primary"
          isDisabled={!data.isAdmin || busy}
          onClick={async () => {
            setBusy(true);
            const r = await call('saveSettings', cfg);
            setBusy(false);
            setFlash(r?.error ? { appearance: 'error', msg: r.error } : { appearance: 'success', msg: `Saved. Answering from ${plural(r.settings.spaceKeys.length, 'space')}.` });
            onSaved();
          }}
        >
          {busy ? 'Saving…' : 'Save settings'}
        </Button>
      </Inline>
      {data.isAdmin ? <Benchmark /> : null}
    </Stack>
  );
};

// Answer quality check: both built-in question sets against your knowledge base, extracts vs the LLM writer.
const Benchmark = () => {
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    call('getBenchmark').then((r) => !r?.error && setRes(r));
  }, []);
  const go = async () => {
    setBusy(true);
    setError('');
    let r = await call('benchmark', { restart: true });
    for (let i = 0; i < 30 && r && !r.error && !r.done; i++) {
      setRes(r);
      r = await call('benchmark', {});
    }
    setBusy(false);
    if (r?.error) setError(r.error);
    else setRes(r);
  };
  const head = { cells: ['Question set', 'Writer', 'High', 'Check', 'No answer', 'Correct', 'Wrong'].map((c) => ({ key: c, content: c })) };
  const rows = [];
  for (const set of ['original', 'paraphrased']) {
    for (const mode of ['det', 'llm']) {
      const x = res?.results?.[set]?.[mode];
      if (!x) continue;
      rows.push({
        key: `${set}-${mode}`,
        cells: [
          { key: 's', content: <Text>{set === 'original' ? 'Sample questionnaire' : 'Same, in customer wording'}</Text> },
          { key: 'm', content: <Text>{mode === 'det' ? 'Verbatim extract' : 'Forge LLM'}</Text> },
          { key: 'h', content: <Text>{x.high}</Text> },
          { key: 'c', content: <Text>{x.medium}</Text> },
          { key: 'n', content: <Text>{x.none}</Text> },
          { key: 'ok', content: <Text>{x.correct}/{x.total}</Text> },
          { key: 'w', content: <Lozenge appearance={x.wrong ? 'removed' : 'success'}>{x.wrong ? `${x.wrong}: ${x.wrongList.join(', ')}` : '0'}</Lozenge> },
        ],
      });
    }
  }
  return (
    <Stack space="space.150">
      <Heading size="small">Answer quality check</Heading>
      <Text>Runs the 40 sample questions and the same 40 in customer wording against your knowledge spaces, and counts wrong answers (a confident answer from the wrong page, or any answer to a question with no policy). Load the sample first.</Text>
      <Inline space="space.100" alignBlock="center">
        <Button isDisabled={busy} onClick={go}>{busy ? `Running… ${res?.progress ? `${res.progress.done}/${res.progress.total}` : ''}` : 'Run the check'}</Button>
        {res?.startedAt ? <Text>Last run {new Date(res.startedAt).toLocaleString()}{res.llmAvailable === false ? ' (Forge LLM not available on this site)' : ''}</Text> : null}
      </Inline>
      {error ? <ErrorMessage>{error}</ErrorMessage> : null}
      {rows.length ? <DynamicTable head={head} rows={rows} /> : null}
    </Stack>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
