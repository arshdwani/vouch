import test from 'node:test';
import assert from 'node:assert/strict';
import { readZip, writeZip } from '../src/core/zip.js';
import { readXlsx, fillXlsx, buildXlsx, colName, colIndex, parseSharedStrings, parseSheet } from '../src/core/xlsx.js';
import { sampleRows, SAMPLE_XLSX_OPTS, SAMPLE_QUESTIONS } from '../src/core/sample.js';

test('column names', () => {
  assert.deepEqual([0, 25, 26, 27, 701, 702].map(colName), ['A', 'Z', 'AA', 'AB', 'ZZ', 'AAA']);
  assert.deepEqual(['A', 'Z', 'AA', 'ZZ', 'AAA'].map(colIndex), [0, 25, 26, 701, 702]);
});

test('shared strings: plain, rich text runs, phonetic runs skipped, entities decoded', () => {
  const xml = '<sst><si><t>Plain &amp; simple</t></si><si><r><rPr><b/></rPr><t>Rich </t></r><r><t xml:space="preserve">text</t></r><rPh><t>IGNORED</t></rPh></si><si><t/></si></sst>';
  assert.deepEqual(parseSharedStrings(xml), ['Plain & simple', 'Rich text', '']);
});

test('sheet cells: shared, inline, number, boolean, missing r attributes, sparse rows', () => {
  const xml = '<sheetData><row r="2"><c r="B2" t="s"><v>0</v></c><c t="inlineStr"><is><t>inline</t></is></c><c r="E2"><v>42</v></c></row><row><c t="b"><v>1</v></c></row></sheetData>';
  const { grid } = parseSheet(xml, ['shared']);
  assert.deepEqual(grid[0], ['', '', '', '', '']);
  assert.deepEqual(grid[1], ['', 'shared', 'inline', '', '42']);
  assert.deepEqual(grid[2], ['TRUE', '', '', '', '']);
});

test('the sample workbook builds and reads back', () => {
  const buf = buildXlsx(sampleRows(), SAMPLE_XLSX_OPTS);
  const { sheets } = readXlsx(buf);
  assert.equal(sheets.length, 1);
  assert.equal(sheets[0].name, 'Assessment');
  assert.equal(sheets[0].grid[3][2], 'Question');
  assert.equal(sheets[0].grid[4][2], SAMPLE_QUESTIONS[0][2]);
  assert.equal(sheets[0].grid.length, 4 + SAMPLE_QUESTIONS.length);
});

test('fill writes answers, keeps styles and every other part unchanged', () => {
  const buf = buildXlsx(sampleRows(), SAMPLE_XLSX_OPTS);
  const { buffer, written, skipped } = fillXlsx(buf, 'xl/worksheets/sheet1.xml', [
    { ref: 'D5', text: 'Yes' },
    { ref: 'E5', text: 'Line one\nline <two> & "three"' },
    { ref: 'F6', text: 'new column' },
  ]);
  assert.equal(written, 3);
  assert.deepEqual(skipped, []);
  const g = readXlsx(buffer).sheets[0].grid;
  assert.equal(g[4][3], 'Yes');
  assert.equal(g[4][4], 'Line one\nline <two> & "three"');
  assert.equal(g[5][5], 'new column');
  assert.equal(g[4][2], SAMPLE_QUESTIONS[0][2], 'question text untouched');
  const before = new Map(readZip(buf).map((e) => [e.name, e.data.toString()]));
  const after = new Map(readZip(buffer).map((e) => [e.name, e.data.toString()]));
  assert.deepEqual([...after.keys()], [...before.keys()], 'same parts in the same order');
  for (const [name, data] of before) if (name !== 'xl/worksheets/sheet1.xml') assert.equal(after.get(name), data, name);
  const sheet = after.get('xl/worksheets/sheet1.xml');
  assert.match(sheet, /<c r="D5" s="2" t="inlineStr">/, 'existing cell style kept');
  assert.match(sheet, /<dimension ref="A1:F44"\/>/, 'dimension widened');
});

test('fill inserts missing rows in order and leaves formula cells alone', () => {
  const sheet = '<worksheet><sheetData><row r="1"><c r="A1"><v>1</v></c></row><row r="3"><c r="A3"><f>A1*2</f><v>2</v></c></row></sheetData></worksheet>';
  const wb = writeZip([
    { name: 'xl/workbook.xml', data: '<workbook><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>' },
    { name: 'xl/_rels/workbook.xml.rels', data: '<Relationships><Relationship Id="rId1" Target="/xl/worksheets/s.xml"/></Relationships>' },
    { name: 'xl/worksheets/s.xml', data: sheet },
  ]);
  const { buffer, skipped } = fillXlsx(wb, 'xl/worksheets/s.xml', [{ ref: 'B2', text: 'two' }, { ref: 'A3', text: 'x' }, { ref: 'C9', text: 'nine' }]);
  assert.deepEqual(skipped, [{ ref: 'A3', reason: 'formula' }]);
  const xml = readZip(buffer).find((e) => e.name === 'xl/worksheets/s.xml').data.toString();
  assert.ok(xml.indexOf('r="2"') < xml.indexOf('r="3"') && xml.indexOf('r="3"') < xml.indexOf('r="9"'));
  const g = readXlsx(buffer).sheets[0].grid;
  assert.equal(g[1][1], 'two');
  assert.equal(g[2][0], '2');
  assert.equal(g[8][2], 'nine');
});
