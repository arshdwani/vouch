import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, writeCsv, fillGrid } from '../src/core/csv.js';

test('parses quoted fields, escaped quotes, CRLF, BOM and semicolons', () => {
  const { grid, delimiter } = parseCsv('﻿Ref;Question;Answer\r\n1;"Do you, really?";\r\n2;"He said ""yes""\nthen left";x\r\n');
  assert.equal(delimiter, ';');
  assert.deepEqual(grid, [['Ref', 'Question', 'Answer'], ['1', 'Do you, really?', ''], ['2', 'He said "yes"\nthen left', 'x']]);
});

test('write and fill round-trip', () => {
  const grid = [['Q', 'A'], ['Is it "on"?', '']];
  const filled = fillGrid(grid, [{ row: 1, col: 1, text: 'Yes, always' }, { row: 1, col: 2, text: 'extra' }]);
  const back = parseCsv(writeCsv(filled)).grid;
  assert.deepEqual(back, [['Q', 'A', ''], ['Is it "on"?', 'Yes, always', 'extra']]);
});
