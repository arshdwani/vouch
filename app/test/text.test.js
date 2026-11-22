import test from 'node:test';
import assert from 'node:assert/strict';
import { stem, tokens, queryTerms, sentences, storageToBlocks, adfText, decodeEntities, escapeXml } from '../src/core/text.js';

test('stemming joins word forms', () => {
  const same = (...ws) => assert.equal(new Set(ws.map(stem)).size, 1, ws.join(','));
  same('encrypt', 'encrypted', 'encryption', 'encrypting');
  same('authenticate', 'authenticated', 'authentication');
  same('retain', 'retention', 'retained');
  same('vulnerability', 'vulnerabilities');
  same('policy', 'policies');
  same('logging', 'logs', 'log');
  same('notify', 'notice', 'notification', 'notified');
  assert.equal(stem('access'), 'access');
  assert.equal(stem('business'), 'business');
});

test('phrases fold to canonical tokens, questionnaire boilerplate drops out', () => {
  assert.ok(tokens('Multi-factor authentication').includes('mfa'));
  assert.ok(tokens('We use 2FA').includes('mfa'));
  assert.ok(tokens('penetration testing').includes('pentest'));
  assert.ok(tokens('data at rest').includes('atrest'));
  assert.deepEqual(tokens('Please describe your organization policy'), []);
  assert.deepEqual(queryTerms('Encrypted? encryption!').map((t) => t.word), ['encrypted']);
});

test('sentences keep abbreviations together and drop bullets', () => {
  assert.deepEqual(sentences('Keys rotate, e.g. yearly. Logs are kept.\n• Item one'), ['Keys rotate, e.g. yearly.', 'Logs are kept.', 'Item one']);
});

test('Confluence storage to blocks: headings, lists, tables, macros', () => {
  const xhtml = '<p>Intro &amp; scope.</p><h2>Data <strong>at rest</strong></h2><p>AES-256.</p><ul><li><p>One</p></li><li>Two</li></ul>' +
    '<ac:structured-macro ac:name="info"><ac:parameter ac:name="title">Hidden</ac:parameter><ac:rich-text-body><p>Note body</p></ac:rich-text-body></ac:structured-macro>' +
    '<table><tr><th>Tier</th><th>Days</th></tr><tr><td>Critical</td><td>7</td></tr></table>';
  assert.deepEqual(storageToBlocks(xhtml), [
    { heading: '', text: 'Intro & scope.' },
    { heading: 'Data at rest', text: 'AES-256.\n• One\n• Two\nNote body\nTier; Days\nCritical; 7' },
  ]);
});

test('ADF to text and entity helpers', () => {
  const adf = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Yes, ' }, { type: 'mention', attrs: { text: '@Ann' } }] }, { type: 'paragraph', content: [{ type: 'text', text: 'USD 5m' }] }] };
  assert.equal(adfText(adf).trim(), 'Yes, @Ann\nUSD 5m');
  assert.equal(decodeEntities('&lt;&#65;&#x42;&nbsp;&bogus;'), '<AB &bogus;');
  assert.equal(escapeXml('a<b>&"\u0001'), 'a&lt;b&gt;&amp;&quot;');
});
