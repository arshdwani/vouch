// Minimal ZIP reader and writer (enough for XLSX), built on Node's zlib. No dependencies.
//
// Reader: walks the central directory, inflates each entry (stored or deflate). ZIP64 and encryption are refused
// with a clear error; questionnaires are far below the 4 GB limit that needs ZIP64.
// Writer: deflates each entry, CRC32 per entry, local headers + central directory + end record.
import zlib from 'node:zlib';

export class ZipError extends Error {}

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_END = 0x06054b50;

// CRC32 (IEEE 802.3), table-driven.
const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function findEnd(buf) {
  // The end record is 22 bytes plus a comment of at most 65535 bytes.
  const stop = Math.max(0, buf.length - 22 - 65535);
  for (let i = buf.length - 22; i >= stop; i--) if (buf.readUInt32LE(i) === SIG_END) return i;
  return -1;
}

/** Returns [{ name, data: Buffer }] for every file entry (directories skipped). */
export function readZip(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  if (buf.length < 22 || buf.readUInt32LE(0) !== SIG_LOCAL) throw new ZipError('This file is not a ZIP/XLSX file.');
  const end = findEnd(buf);
  if (end < 0) throw new ZipError('This file looks damaged (no ZIP directory found).');
  const count = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  if (count === 0xffff || p === 0xffffffff) throw new ZipError('ZIP64 files are not supported.');
  const out = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== SIG_CENTRAL) throw new ZipError('This file looks damaged (bad ZIP directory).');
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString(flags & 0x800 ? 'utf8' : 'latin1', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue;
    if (flags & 1) throw new ZipError('Encrypted (password-protected) files are not supported.');
    if (buf.readUInt32LE(local) !== SIG_LOCAL) throw new ZipError(`This file looks damaged (entry ${name}).`);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + compSize);
    let data;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) data = zlib.inflateRawSync(raw);
    else throw new ZipError(`Unsupported compression method ${method} in ${name}.`);
    if (data.length !== size) throw new ZipError(`This file looks damaged (size mismatch in ${name}).`);
    out.push({ name, data });
  }
  return out;
}

function dosTime(d) {
  const time = (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | Math.floor(d.getUTCSeconds() / 2);
  const date = ((Math.max(1980, d.getUTCFullYear()) - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate();
  return { time, date };
}

/** entries: [{ name, data: Buffer|string }] -> Buffer. Entry order is kept ([Content_Types].xml first for XLSX). */
export function writeZip(entries, { date = new Date() } = {}) {
  const { time, date: day } = dosTime(date);
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const e of entries) {
    const data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(String(e.data), 'utf8');
    const name = Buffer.from(e.name, 'utf8');
    const deflated = zlib.deflateRawSync(data);
    const useDeflate = deflated.length < data.length;
    const body = useDeflate ? deflated : data;
    const crc = crc32(data);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(SIG_LOCAL, 0);
    head.writeUInt16LE(20, 4); // version needed
    head.writeUInt16LE(0x800, 6); // UTF-8 names
    head.writeUInt16LE(useDeflate ? 8 : 0, 8);
    head.writeUInt16LE(time, 10);
    head.writeUInt16LE(day, 12);
    head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(body.length, 18);
    head.writeUInt32LE(data.length, 22);
    head.writeUInt16LE(name.length, 26);
    head.writeUInt16LE(0, 28);
    locals.push(head, name, body);

    const c = Buffer.alloc(46);
    c.writeUInt32LE(SIG_CENTRAL, 0);
    c.writeUInt16LE(20, 4); // made by
    c.writeUInt16LE(20, 6); // needed
    c.writeUInt16LE(0x800, 8);
    c.writeUInt16LE(useDeflate ? 8 : 0, 10);
    c.writeUInt16LE(time, 12);
    c.writeUInt16LE(day, 14);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(body.length, 20);
    c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(name.length, 28);
    c.writeUInt32LE(offset, 42);
    centrals.push(c, name);
    offset += 30 + name.length + body.length;
  }
  const dir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(SIG_END, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}
