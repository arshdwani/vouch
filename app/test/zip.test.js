import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { crc32, readZip, writeZip, ZipError } from '../src/core/zip.js';

test('crc32 matches zlib', () => {
  for (const s of ['', 'a', 'hello world', 'x'.repeat(10000), 'ünïcødé ✓']) {
    assert.equal(crc32(Buffer.from(s)), zlib.crc32(Buffer.from(s)));
  }
});

test('write then read round-trips stored and deflated entries', () => {
  const big = 'repeat me '.repeat(500);
  const zip = writeZip([
    { name: 'a.txt', data: 'hi' },
    { name: 'dir/b.xml', data: big },
    { name: 'bin.dat', data: Buffer.from([0, 1, 2, 255]) },
  ]);
  const out = readZip(zip);
  assert.deepEqual(out.map((e) => e.name), ['a.txt', 'dir/b.xml', 'bin.dat']);
  assert.equal(out[0].data.toString(), 'hi');
  assert.equal(out[1].data.toString(), big);
  assert.deepEqual([...out[2].data], [0, 1, 2, 255]);
  assert.ok(zip.length < big.length, 'large entry is deflated');
});

test('rejects non-zip and truncated input with ZipError', () => {
  assert.throws(() => readZip(Buffer.from('Ref,Question\n1,Hi')), ZipError);
  const zip = writeZip([{ name: 'a.txt', data: 'hello' }]);
  assert.throws(() => readZip(zip.subarray(0, zip.length - 30)), ZipError);
});
