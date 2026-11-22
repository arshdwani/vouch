import test from 'node:test';
import assert from 'node:assert/strict';
import { detectLayout, extractQuestions, answerWrites, isYesNoQuestion } from '../src/core/questionnaire.js';
import { sampleRows, SAMPLE_QUESTIONS } from '../src/core/sample.js';

const pad = (rows) => {
  const w = Math.max(...rows.map((r) => r.length));
  return rows.map((r) => Array.from({ length: w }, (_, i) => r[i] ?? ''));
};

test('sample: header on row 4, Yes/No and comment columns found, 40 questions', () => {
  const grid = pad(sampleRows());
  const layout = detectLayout(grid);
  assert.equal(layout.headerRow, 3);
  assert.deepEqual(layout.cols, { question: 2, id: 0, section: 1, yesno: 3, text: 4 });
  const qs = extractQuestions(grid, layout);
  assert.equal(qs.length, SAMPLE_QUESTIONS.length);
  assert.deepEqual(qs[0], { qid: 'r5', row: 4, ref: 'C5', id: 'GOV-01', section: 'Governance', text: SAMPLE_QUESTIONS[0][2], yesNo: true, existing: '' });
});

test('CAIQ-style sheet: "Answer" column of Yes/No values plus notes', () => {
  const grid = pad([
    ['Question ID', 'Control', 'Question', 'Answer', 'Notes'],
    ['A&A-01.1', 'Audit', 'Are audit policies established?', 'Yes', ''],
    ['A&A-01.2', 'Audit', 'Are audits performed annually?', 'No', ''],
    ['A&A-02.1', 'Audit', 'Are results shared with customers?', 'N/A', ''],
  ]);
  const layout = detectLayout(grid);
  assert.equal(layout.cols.yesno, 3);
  assert.equal(layout.cols.text, 4);
  const qs = extractQuestions(grid, layout);
  assert.equal(qs.length, 3);
  assert.equal(qs[1].existing, 'No');
});

test('single Response column takes the whole answer; section rows are not questions', () => {
  const grid = pad([
    ['#', 'Question', 'Response'],
    ['', 'Encryption', ''],
    ['1', 'Do you encrypt data at rest?', ''],
    ['2', 'Describe your key management.', ''],
    ['', 'Access control', ''],
    ['3', 'Is MFA enforced?', ''],
  ]);
  const layout = detectLayout(grid);
  assert.equal(layout.cols.text, 2);
  assert.equal(layout.cols.yesno, undefined);
  const qs = extractQuestions(grid, layout);
  assert.deepEqual(qs.map((q) => [q.id, q.section]), [['1', 'Encryption'], ['2', 'Encryption'], ['3', 'Access control']]);
  const writes = answerWrites(layout, qs, { r3: { text: 'Data is encrypted with AES-256.', short: 'Yes' } });
  assert.deepEqual(writes, [{ row: 2, col: 2, ref: 'C3', text: 'Yes. Data is encrypted with AES-256.' }]);
});

test('no answer column: a new "Answer (Vouch)" column is added after the headers', () => {
  const grid = pad([['ID', 'Security question'], ['Q1', 'Do you have a security team?']]);
  const layout = detectLayout(grid);
  assert.equal(layout.cols.text, 2);
  assert.equal(layout.addHeader, 'Answer (Vouch)');
  const writes = answerWrites(layout, extractQuestions(grid, layout), { r2: { text: 'We do.', short: null } });
  assert.deepEqual(writes.map((w) => [w.ref, w.text]), [['C1', 'Answer (Vouch)'], ['C2', 'We do.']]);
});

test('returns null when nothing looks like a questionnaire', () => {
  assert.equal(detectLayout(pad([['Name', 'Amount'], ['Ann', '3']])), null);
});

test('yes/no question detection', () => {
  assert.equal(isYesNoQuestion('Do you encrypt?'), true);
  assert.equal(isYesNoQuestion('1.2 Is MFA on?'), true);
  assert.equal(isYesNoQuestion('How often are keys rotated?'), false);
  assert.equal(isYesNoQuestion('Describe your SDLC.'), false);
});

test('two-row header: "Response" merged over Yes/No and Comments', () => {
  const grid = pad([
    ['Vendor assessment'],
    ['#', 'Question', 'Response', ''],
    ['', '', 'Yes/No', 'Comments'],
    ['1.1', 'Do you encrypt data at rest?', '', ''],
    ['1.2', 'Is MFA enforced for admins?', '', ''],
  ]);
  const layout = detectLayout(grid);
  assert.equal(layout.headerRow, 2);
  assert.deepEqual(layout.cols, { question: 1, id: 0, yesno: 2, text: 3 });
  assert.equal(extractQuestions(grid, layout).length, 2);
});
