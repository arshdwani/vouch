// Jira issue panel: the questionnaire on this issue. Progress, the answers table, and review / route / export.
import React, { useCallback, useEffect, useState } from 'react';
import ForgeReconciler, {
  Box,
  Button,
  ButtonGroup,
  DynamicTable,
  EmptyState,
  ErrorMessage,
  Heading,
  Inline,
  Label,
  Link,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  ModalTransition,
  ProgressBar,
  RadioGroup,
  SectionMessage,
  Select,
  Spinner,
  Stack,
  Strong,
  Text,
  TextArea,
  User,
  UserPicker,
} from '@forge/react';
import { events, router } from '@forge/bridge';
import { call, Confidence, Status, Sources, clip, answerLine, plural, UPDATED, useDraftLoop, DraftProgress, stripMarkers } from './common.jsx';

const FILTERS = [
  ['all', 'All'],
  ['review', 'To review'],
  ['gaps', 'Gaps'],
  ['experts', 'With experts'],
  ['done', 'Done'],
];
const inFilter = (f, r) =>
  f === 'all' ||
  (f === 'review' && r.status === 'drafted') ||
  (f === 'gaps' && r.status === 'gap') ||
  (f === 'experts' && (r.status === 'routed' || r.status === 'answered')) ||
  (f === 'done' && (r.status === 'approved' || r.status === 'answered' || r.status === 'existing'));

const YESNO = [
  { label: 'Yes', value: 'Yes' },
  { label: 'No', value: 'No' },
  { label: 'N/A', value: 'N/A' },
  { label: '(none)', value: '' },
];

// Start: pick the attached questionnaire and draft it.
const Start = ({ state, onDone }) => {
  const [file, setFile] = useState(state.files?.[0]?.id || null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { progress, run } = useDraftLoop();
  if (!state.files?.length) {
    return (
      <EmptyState
        header="No questionnaire on this issue"
        description="Attach the customer's questionnaire (.xlsx or .csv) to this issue, then come back here or use Answer with Vouch from the ••• menu."
      />
    );
  }
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
    if (last?.error) setError(last.error);
    onDone({ ...r, drafted: last?.error ? r.drafted : last });
  };
  return (
    <Stack space="space.200">
      {!state.settings.spaces.length ? (
        <SectionMessage appearance="warning" title="Choose knowledge spaces first">
          <Inline space="space.100" shouldWrap alignBlock="center">
            <Text>Vouch answers from the Confluence spaces chosen in its settings.</Text>
            <Button appearance="link" onClick={() => router.navigate(state.appPath).catch(() => null)}>Open Vouch settings</Button>
          </Inline>
        </SectionMessage>
      ) : null}
      <Text>Vouch reads the questions, drafts each answer from your policies with a citation, and lists the gaps for experts.</Text>
      <RadioGroup
        name="vouch-file"
        defaultValue={file}
        options={state.files.map((f) => ({ name: 'vouch-file', value: f.id, label: `${f.filename} (${Math.max(1, Math.round(f.size / 1024))} KB${f.author ? `, ${f.author}` : ''})` }))}
        onChange={(e) => setFile(e.target.value)}
      />
      {error ? <ErrorMessage>{error}</ErrorMessage> : null}
      <DraftProgress progress={progress} />
      <Inline space="space.100" alignBlock="center">
        <Button appearance="primary" isDisabled={busy || !state.settings.spaces.length} onClick={go}>{busy ? 'Reading and drafting…' : 'Answer with Vouch'}</Button>
        {busy && !progress ? <Spinner size="small" /> : null}
      </Inline>
    </Stack>
  );
};

// Review one drafted / approved row.
const ReviewModal = ({ row, onClose, onSaved, onRoute }) => {
  const [text, setText] = useState(row.answer?.text || '');
  const [showQuote, setShowQuote] = useState(false);
  const [short, setShort] = useState(row.answer?.short || '');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const save = async () => {
    setBusy('approve');
    const r = await call('approve', { qid: row.qid, text, short: row.yesNo ? short : undefined });
    setBusy('');
    if (r?.error) setError(r.error);
    else onSaved(r, r.graph && !r.graph.ok && r.graph.connected ? `Approved. The Teamwork Graph didn't accept it yet: ${r.graph.error}` : 'Approved and added to the answer library.');
  };
  return (
    <Modal onClose={onClose} width="large">
      <ModalHeader>
        <ModalTitle>{row.id ? `${row.id}: ` : ''}Review answer</ModalTitle>
      </ModalHeader>
      <ModalBody>
        <Stack space="space.200">
          <Text><Strong>{row.text}</Strong></Text>
          <Inline space="space.100" alignBlock="center" shouldWrap>
            <Confidence value={row.confidence} />
            <Text>{row.why}</Text>
          </Inline>
          {row.answer?.writer === 'llm' ? (
            <Stack space="space.050">
              <Text>Written by Forge LLM from these passages only; every claim is cited:</Text>
              {(row.answer.citations || []).map((c) => (
                <Inline key={c.n} space="space.050" alignBlock="center">
                  <Text>[{c.n}]</Text>
                  {c.url ? <Link href={c.url} openNewTab>{c.heading ? `${c.title} › ${c.heading}` : c.title}</Link> : <Text>{c.title}</Text>}
                </Inline>
              ))}
              <Button appearance="subtle" spacing="compact" onClick={() => setShowQuote(!showQuote)}>{showQuote ? 'Hide the source text' : 'Show the source text'}</Button>
              {showQuote ? <Text>"{row.answer.quote || row.answer.citations?.[0]?.quote}"</Text> : null}
            </Stack>
          ) : (
            <Sources citations={row.answer?.citations} />
          )}
          {row.yesNo ? (
            <Stack space="space.050">
              <Label labelFor="vouch-short">Yes / No</Label>
              <Box xcss={{ width: '160px' }}>
                <Select id="vouch-short" options={YESNO} defaultValue={YESNO.find((o) => o.value === (row.answer?.short || ''))} onChange={(o) => setShort(o?.value || '')} />
              </Box>
            </Stack>
          ) : null}
          <Stack space="space.050">
            <Label labelFor="vouch-text">Answer</Label>
            <TextArea id="vouch-text" defaultValue={text} onChange={(e) => setText(e.target.value)} />
          </Stack>
          {row.passages?.length ? (
            <Stack space="space.050">
              <Text><Strong>Passages it came from</Strong></Text>
              {row.passages.map((p, i) => (
                <Stack key={i} space="space.025">
                  {p.url ? <Link href={p.url} openNewTab>{p.heading ? `${p.title} › ${p.heading}` : p.title}</Link> : <Text>{p.title}</Text>}
                  <Text>{clip(p.text, 260)}</Text>
                </Stack>
              ))}
            </Stack>
          ) : null}
          {error ? <ErrorMessage>{error}</ErrorMessage> : null}
        </Stack>
      </ModalBody>
      <ModalFooter>
        <ButtonGroup>
          <Button appearance="subtle" onClick={onClose}>Cancel</Button>
          <Button onClick={() => onRoute(row)}>Ask an expert instead</Button>
          <Button appearance="primary" isDisabled={!!busy} onClick={save}>{busy === 'approve' ? 'Approving…' : 'Approve'}</Button>
        </ButtonGroup>
      </ModalFooter>
    </Modal>
  );
};

// Find an expert through the Teamwork Graph and create their sub-task.
const RouteModal = ({ row: initial, onClose, onRouted }) => {
  const [row, setRow] = useState(initial);
  const [busy, setBusy] = useState(!initial.experts && !initial.task);
  const [sending, setSending] = useState('');
  const [error, setError] = useState('');
  const [answer, setAnswer] = useState('');
  const [pick, setPick] = useState(null);
  const find = async () => {
    setBusy(true);
    setError('');
    const r = await call('suggestExperts', { qid: row.qid });
    setBusy(false);
    if (r?.error) setError(r.error);
    else setRow(r.row);
  };
  useEffect(() => {
    if (!initial.experts && !initial.task) find();
  }, []);
  const send = async (x) => {
    setSending(x.accountId);
    const r = await call('route', { qid: row.qid, accountId: x.accountId });
    setSending('');
    if (r?.error) setError(r.error);
    else onRouted(r, `Sent to ${x.name} as ${r.task.key}${r.task.assigned ? '' : ' (unassigned: Jira would not let them be assigned in this project)'}.`);
  };
  const answerHere = async () => {
    setSending('self');
    const r = await call('approve', { qid: row.qid, text: answer });
    setSending('');
    if (r?.error) setError(r.error);
    else onRouted(r, 'Answer saved and added to the library.');
  };
  const ex = row.experts;
  return (
    <Modal onClose={onClose} width="large">
      <ModalHeader>
        <ModalTitle>{row.id ? `${row.id}: ` : ''}{row.task ? 'Answer' : 'Find an expert'}</ModalTitle>
      </ModalHeader>
      <ModalBody>
        <Stack space="space.200">
          <Text><Strong>{row.text}</Strong></Text>
          {row.why ? <Text>{row.why}</Text> : null}
          {row.task ? (
            <SectionMessage appearance="information" title={`With ${row.task.assigneeName} in ${row.task.key}`}>
              <Text>{row.task.reason}. Their first comment on the sub-task becomes the answer; answering here closes the sub-task instead.</Text>
            </SectionMessage>
          ) : busy ? (
            <Inline space="space.100" alignBlock="center">
              <Spinner size="small" />
              <Text>Asking the Teamwork Graph who works on {row.topic?.join(', ') || 'this topic'}…</Text>
            </Inline>
          ) : ex ? (
            <Stack space="space.200">
              <Text>
                Searched for {ex.topic?.join(', ')}: {plural(ex.pages?.length || 0, 'Confluence page')}{ex.issues ? ` and ${plural(ex.issues, 'Jira work item')}` : ''}. People from {ex.via || 'the Teamwork Graph'}{ex.twgCalls ? ` (${ex.twgCalls} graph queries, ${(ex.ms / 1000).toFixed(1)} s)` : ''}.
              </Text>
              {ex.list?.length ? (
                ex.list.map((x, i) => (
                  <Box key={x.accountId} padding="space.150" xcss={{ borderColor: 'color.border', borderWidth: 'border.width', borderStyle: 'solid', borderRadius: 'border.radius' }}>
                    <Stack space="space.100">
                      <Inline space="space.100" alignBlock="center" spread="space-between" shouldWrap>
                        <Inline space="space.100" alignBlock="center">
                          <User accountId={x.accountId} />
                          {i === 0 ? <Text><Strong>Best match</Strong></Text> : null}
                        </Inline>
                        <Button appearance={i === 0 ? 'primary' : 'default'} isDisabled={!!sending} onClick={() => send(x)}>
                          {sending === x.accountId ? 'Creating sub-task…' : `Send to ${x.name.split(' ')[0]}`}
                        </Button>
                      </Inline>
                      <Text>{x.reason}{x.self ? ' (that is you: nobody else on this site has worked on this)' : ''}</Text>
                      <Stack space="space.025">
                        <Text><Strong>How the Teamwork Graph found {x.self ? 'you' : x.name.split(' ')[0]}</Strong></Text>
                        {x.titles.slice(0, 3).map((t, k) => (
                          <Inline key={`p${k}`} space="space.050" alignBlock="center" shouldWrap>
                            <Text>Page</Text>
                            {t.url ? <Link href={t.url} openNewTab>{t.title}</Link> : <Text>{t.title}</Text>}
                            <Text>→ contributor → {x.name}{x.teams?.length ? ` → member of ${x.teams[0]}` : ''}</Text>
                          </Inline>
                        ))}
                        {(x.issues || []).slice(0, 2).map((i) => (
                          <Text key={i.key}>Work item {i.key} ({clip(i.summary, 50)}) → {i.role} → {x.name}</Text>
                        ))}
                      </Stack>
                    </Stack>
                  </Box>
                ))
              ) : (
                <SectionMessage appearance="information" title="No one to suggest yet">
                  <Text>{ex.note || 'Nobody besides you has written Confluence pages or worked Jira issues on this topic.'} Vouch suggests people from their real work, so a new or quiet site has few candidates. Send it to someone you know below, or answer it yourself.</Text>
                </SectionMessage>
              )}
              <Button appearance="subtle" onClick={find}>Search again</Button>
            </Stack>
          ) : null}
          {!row.task ? (
            <Stack space="space.050">
              <UserPicker label="Send to someone else" name="vouch-pick" placeholder="Anyone on this site, including you" onChange={(u) => setPick(u ? { accountId: u.id || u.accountId, name: u.name || u.displayName || 'them' } : null)} />
              <Inline space="space.100">
                <Button isDisabled={!pick || !!sending} onClick={() => send(pick)}>{sending && pick && sending === pick.accountId ? 'Creating sub-task…' : 'Create sub-task'}</Button>
              </Inline>
            </Stack>
          ) : null}
          <Stack space="space.050">
            <Label labelFor="vouch-self">Or answer it yourself</Label>
            <TextArea id="vouch-self" placeholder="The answer as you'd send it to the customer" onChange={(e) => setAnswer(e.target.value)} />
          </Stack>
          {error ? <ErrorMessage>{error}</ErrorMessage> : null}
        </Stack>
      </ModalBody>
      <ModalFooter>
        <ButtonGroup>
          <Button appearance="subtle" onClick={onClose}>Close</Button>
          <Button isDisabled={!!sending || answer.trim().length < 2} onClick={answerHere}>Save my answer</Button>
        </ButtonGroup>
      </ModalFooter>
    </Modal>
  );
};

const App = () => {
  const [state, setState] = useState(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all');
  const [review, setReview] = useState(null);
  const [routing, setRouting] = useState(null);
  const [flash, setFlash] = useState(null);
  const [busy, setBusy] = useState('');
  const { progress, run } = useDraftLoop(() => load());

  const load = useCallback(async () => {
    const r = await call('getIssueState');
    if (r?.error) setError(r.error);
    else {
      setError('');
      setState(r);
    }
  }, []);
  useEffect(() => {
    load();
    let sub;
    events.on(UPDATED, () => load()).then((s) => (sub = s)).catch(() => null);
    return () => sub?.unsubscribe?.();
  }, [load]);

  const done = (msg, appearance = 'success') => {
    setFlash({ msg, appearance });
    events.emit(UPDATED).catch(() => null);
    load();
  };
  const bulk = async (name, label, ok) => {
    setBusy(name);
    const r = await call(name);
    setBusy('');
    if (r?.error) setFlash({ msg: r.error, appearance: 'error' });
    else done(ok(r));
    return label;
  };

  const draft = async (redraft) => {
    setBusy('draft');
    const r = await run({ redraft });
    setBusy('');
    if (r?.error) setFlash({ msg: r.error, appearance: 'error' });
    else done(`Drafted ${r.total - r.remaining} of ${r.total}${r.llm ? ' with Forge LLM' : ''} from ${plural(r.knowledge?.pages || 0, 'page')}.`);
  };

  if (error) {
    return (
      <Stack space="space.100">
        <ErrorMessage>{error}</ErrorMessage>
        <Button onClick={() => { setError(''); load(); }}>Try again</Button>
      </Stack>
    );
  }
  if (!state) return <Spinner label="Loading Vouch" />;
  if (!state.qn) return <Start state={state} onDone={(r) => done(`Found ${r.imported.questions} questions in ${r.imported.filename}; drafted ${r.drafted.total - r.drafted.remaining} of ${r.drafted.total}${r.drafted.llm ? ' with Forge LLM' : ''} from ${plural(r.drafted.knowledge?.pages || 0, 'page')}.`)} />;

  const { qn, counts: c } = state;
  const pending = qn.rows.filter((r) => r.status === 'pending').length;
  const rows = qn.rows.filter((r) => inFilter(filter, r));
  const head = {
    cells: [
      { key: 'ref', content: 'Ref', width: 9 },
      { key: 'q', content: 'Question', width: 33 },
      { key: 'a', content: 'Answer', width: 40 },
      { key: 'act', content: '', width: 18 },
    ],
  };
  const action = (r) => {
    if (r.status === 'drafted' || r.status === 'approved') return <Button spacing="compact" appearance={r.status === 'drafted' ? 'primary' : 'subtle'} onClick={() => setReview(r)}>{r.status === 'drafted' ? 'Review' : 'Edit'}</Button>;
    if (r.status === 'gap') return <Button spacing="compact" onClick={() => setRouting(r)}>Find expert</Button>;
    if (r.status === 'routed') {
      return (
        <Stack space="space.050">
          {r.task?.url ? <Link href={r.task.url} openNewTab>{r.task.key}</Link> : <Text>{r.task?.key}</Text>}
          <Button spacing="compact" appearance="subtle" onClick={() => setRouting(r)}>Answer here</Button>
        </Stack>
      );
    }
    return null;
  };
  const tableRows = rows.map((r) => ({
    key: r.qid,
    cells: [
      { key: 'ref', content: <Stack space="space.050"><Text>{r.id || r.qid}</Text><Status value={r.status} /></Stack> },
      { key: 'q', content: <Text>{clip(r.text, 140)}</Text> },
      {
        key: 'a',
        content:
          r.status === 'routed' ? (
            <Stack space="space.050">
              <Inline space="space.050" alignBlock="center"><Text>With</Text><User accountId={r.task.assignee} /></Inline>
              <Text>{r.task.reason}</Text>
            </Stack>
          ) : r.answer?.text ? (
            <Stack space="space.050">
              <Text>{clip(answerLine({ ...r.answer, text: stripMarkers(r.answer.text) }), 170)}</Text>
              <Inline space="space.100" alignBlock="center" shouldWrap>
                {r.status === 'drafted' ? <Confidence value={r.confidence} /> : null}
                {r.answer.source === 'expert' ? <Text>From {r.answer.byName || 'the expert'}</Text> : null}
                {r.answer.writer === 'llm' ? <Text>Forge LLM, cited</Text> : null}
              </Inline>
            </Stack>
          ) : (
            <Text>{r.why || 'Not drafted yet'}</Text>
          ),
      },
      { key: 'act', content: action(r) },
    ],
  }));

  return (
    <Stack space="space.200">
      <Stack space="space.100">
        <Inline space="space.100" alignBlock="center" spread="space-between" shouldWrap>
          <Heading size="small">{qn.attachment.filename}</Heading>
          <Text>{c.done} of {c.total} done</Text>
        </Inline>
        <ProgressBar value={c.total ? c.done / c.total : 0} appearance={c.done === c.total ? 'success' : 'default'} ariaLabel="Questionnaire progress" />
        <Text>
          {c.approved} approved · {c.toReview} to review ({c.high} high confidence) · {plural(c.gaps, 'gap')} · {c.routed} with experts{c.expert ? ` · ${c.expert} answered by experts` : ''}
          {qn.knowledge ? ` · drafted from ${plural(qn.knowledge.pages, 'page')} in ${qn.knowledge.spaces.join(', ')}` : ''}
        </Text>
      </Stack>
      {flash ? (
        <SectionMessage appearance={flash.appearance}>
          <Text>{flash.msg}</Text>
        </SectionMessage>
      ) : null}
      <DraftProgress progress={progress} />
      {pending && !progress ? (
        <SectionMessage appearance="warning" title={`${pending} questions still to draft`}>
          <Inline space="space.100" alignBlock="center" shouldWrap>
            <Text>Drafting runs in short steps and stopped part-way. It picks up where it left off.</Text>
            <Button appearance="primary" isDisabled={!!busy} onClick={() => draft(false)}>Continue drafting</Button>
          </Inline>
        </SectionMessage>
      ) : null}
      <Inline space="space.100" shouldWrap>
        {c.high ? (
          <Button appearance="primary" isDisabled={!!busy} onClick={() => bulk('approveAllHigh', '', (r) => `Approved ${r.approved} high-confidence answers; ${r.library} added to the library${r.graph?.ok ? ' and the Teamwork Graph' : ''}.`)}>
            {busy === 'approveAllHigh' ? 'Approving…' : `Approve ${c.high} high-confidence`}
          </Button>
        ) : null}
        <Button isDisabled={!!busy || !(c.approved + c.expert)} onClick={() => bulk('export', '', (r) => `Attached ${r.filename}: ${r.answers} of ${r.total} answers filled${r.left ? `, ${r.left} left blank for review` : ''}.`)}>
          {busy === 'export' ? 'Exporting…' : `Export ${qn.format === 'csv' ? 'CSV' : 'XLSX'}`}
        </Button>
        <Button appearance="subtle" isDisabled={!!busy} onClick={() => draft(true)}>
          {busy === 'draft' ? 'Drafting…' : 'Re-draft open questions'}
        </Button>
      </Inline>
      <ButtonGroup>
        {FILTERS.map(([k, label]) => (
          <Button key={k} spacing="compact" appearance={filter === k ? 'primary' : 'subtle'} onClick={() => setFilter(k)}>
            {label} ({qn.rows.filter((r) => inFilter(k, r)).length})
          </Button>
        ))}
      </ButtonGroup>
      <DynamicTable head={head} rows={tableRows} rowsPerPage={10} emptyView="Nothing here." />
      {(qn.exports || []).length ? <Text>Last export: {qn.exports[qn.exports.length - 1].filename}</Text> : null}

      <ModalTransition>
        {review ? (
          <ReviewModal
            row={review}
            onClose={() => setReview(null)}
            onRoute={(r) => {
              setReview(null);
              setRouting(r);
            }}
            onSaved={(_, msg) => {
              setReview(null);
              done(msg);
            }}
          />
        ) : null}
        {routing ? (
          <RouteModal
            row={routing}
            onClose={() => {
              setRouting(null);
              load();
            }}
            onRouted={(_, msg) => {
              setRouting(null);
              done(msg);
            }}
          />
        ) : null}
      </ModalTransition>
    </Stack>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
