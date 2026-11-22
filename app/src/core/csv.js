// CSV read and write (RFC 4180 quoting; comma, semicolon or tab, detected from the first lines).

export function detectDelimiter(text) {
  const head = text.split(/\r?\n/).slice(0, 5).join('\n');
  const count = (d) => head.split(d).length - 1;
  return [',', ';', '\t'].sort((a, b) => count(b) - count(a))[0];
}

/** CSV text -> { grid: string[][], delimiter }. */
export function parseCsv(input) {
  const text = String(input).replace(/^﻿/, '');
  const d = detectDelimiter(text);
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"' && field === '') quoted = true;
    else if (ch === d) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  const width = Math.max(0, ...rows.map((r) => r.length));
  return { grid: rows.map((r) => Array.from({ length: width }, (_, c) => String(r[c] ?? '').trim())), delimiter: d };
}

const q = (v, d) => {
  const s = String(v ?? '');
  return s.includes('"') || s.includes(d) || /[\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function writeCsv(grid, delimiter = ',') {
  return `${grid.map((r) => r.map((v) => q(v, delimiter)).join(delimiter)).join('\r\n')}\r\n`;
}

/** Copy of grid with writes [{ row (0-based), col (0-based), text }] applied, growing it as needed. */
export function fillGrid(grid, writes) {
  const out = grid.map((r) => [...r]);
  for (const w of writes) {
    while (out.length <= w.row) out.push([]);
    const r = out[w.row];
    while (r.length <= w.col) r.push('');
    r[w.col] = w.text;
  }
  const width = Math.max(...out.map((r) => r.length));
  return out.map((r) => Array.from({ length: width }, (_, c) => r[c] ?? ''));
}
