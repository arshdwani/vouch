// XLSX read, fill-in and create, on top of zip.js. Only the parts questionnaires need:
//   read:  workbook sheets -> grid of cell text (shared strings, inline strings, numbers, booleans)
//   fill:  write text into chosen cells of one sheet, keeping everything else in the file byte-for-byte
//   build: a small styled workbook (used for the sample questionnaire)
import { readZip, writeZip, ZipError } from './zip.js';
import { decodeEntities, escapeXml } from './text.js';

export { ZipError };

const MAX_ROWS = 5000;
const MAX_COLS = 60;

export const colName = (i) => {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};
export const colIndex = (letters) => [...letters.toUpperCase()].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
export function parseRef(ref) {
  const m = /^([A-Z]+)(\d+)$/i.exec(ref || '');
  return m ? { col: colIndex(m[1]), row: Number(m[2]) } : null;
}

const attr = (tag, name) => {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return m ? decodeEntities(m[1]) : null;
};

// Text of every <t> inside a fragment, skipping phonetic runs (<rPh>).
const tText = (xml) =>
  [...xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g)]
    .map((m) => decodeEntities(m[1] || ''))
    .join('');

export function parseSharedStrings(xml) {
  return [...String(xml || '').matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/g)].map((m) => tText(m[1] || ''));
}

const ROW_RE = /<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g;
const CELL_RE = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;

/** Sheet XML -> { grid: string[][] (row index = sheet row - 1), maxCol }. */
export function parseSheet(xml, shared = []) {
  const grid = [];
  let maxCol = -1;
  let nextRow = 1;
  for (const rm of String(xml).matchAll(ROW_RE)) {
    const r = Number(attr(rm[1], 'r')) || nextRow;
    nextRow = r + 1;
    if (r > MAX_ROWS) break;
    let nextCol = 0;
    const row = [];
    for (const cm of (rm[2] || '').matchAll(CELL_RE)) {
      const ref = parseRef(attr(cm[1], 'r'));
      const c = ref ? ref.col : nextCol;
      nextCol = c + 1;
      if (c >= MAX_COLS) continue;
      const t = attr(cm[1], 't');
      const body = cm[2] || '';
      const v = /<v>([\s\S]*?)<\/v>/.exec(body);
      let text = '';
      if (t === 's') text = v ? shared[Number(v[1])] ?? '' : '';
      else if (t === 'inlineStr') text = tText(/<is>([\s\S]*?)<\/is>/.exec(body)?.[1] || '');
      else if (t === 'b') text = v ? (v[1] === '1' ? 'TRUE' : 'FALSE') : '';
      else text = v ? decodeEntities(v[1]) : '';
      row[c] = text;
      if (text && c > maxCol) maxCol = c;
    }
    grid[r - 1] = row;
  }
  for (let i = 0; i < grid.length; i++) {
    const row = grid[i] || [];
    grid[i] = Array.from({ length: maxCol + 1 }, (_, c) => String(row[c] ?? '').trim());
  }
  return { grid, maxCol };
}

const dirOf = (p) => p.slice(0, p.lastIndexOf('/') + 1);
function resolveTarget(base, target) {
  if (target.startsWith('/')) return target.slice(1);
  const parts = (dirOf(base) + target).split('/');
  const out = [];
  for (const p of parts) {
    if (p === '..') out.pop();
    else if (p !== '.') out.push(p);
  }
  return out.join('/');
}

/** XLSX bytes -> { sheets: [{ name, path, grid, maxCol }] }. Throws ZipError with a readable message. */
export function readXlsx(buf) {
  const files = new Map(readZip(buf).map((e) => [e.name, e.data]));
  const get = (n) => files.get(n)?.toString('utf8');
  const workbook = get('xl/workbook.xml');
  if (!workbook) throw new ZipError('This is a ZIP file but not an Excel workbook (no xl/workbook.xml).');
  const rels = Object.fromEntries(
    [...(get('xl/_rels/workbook.xml.rels') || '').matchAll(/<Relationship\b([^>]*)\/?>/g)].map((m) => [attr(m[1], 'Id'), attr(m[1], 'Target')]),
  );
  const shared = parseSharedStrings(get('xl/sharedStrings.xml'));
  const sheets = [];
  for (const m of workbook.matchAll(/<sheet\b([^>]*)\/?>/g)) {
    const rid = attr(m[1], 'r:id');
    const target = rels[rid];
    if (!target) continue;
    const path = resolveTarget('xl/workbook.xml', target);
    const xml = get(path);
    if (!xml) continue;
    const state = attr(m[1], 'state');
    sheets.push({ name: attr(m[1], 'name') || path, path, hidden: !!state && state !== 'visible', ...parseSheet(xml, shared) });
  }
  if (!sheets.length) throw new ZipError('This workbook has no readable sheets.');
  return { sheets };
}

const cellXml = (ref, text, style) =>
  `<c r="${ref}"${style ? ` s="${style}"` : ''} t="inlineStr"><is><t xml:space="preserve">${escapeXml(text)}</t></is></c>`;

/**
 * Writes text into cells of one sheet. writes: [{ ref: 'D7', text }]. Existing cell styles are kept; cells holding a
 * formula are left alone (reported in `skipped`). Every other part of the workbook is copied unchanged.
 * Returns { buffer, written, skipped }.
 */
export function fillXlsx(buf, sheetPath, writes, { date } = {}) {
  const entries = readZip(buf);
  const entry = entries.find((e) => e.name === sheetPath);
  if (!entry) throw new ZipError(`Sheet ${sheetPath} is missing from the workbook.`);
  let xml = entry.data.toString('utf8');
  const byRow = new Map();
  for (const w of writes) {
    const ref = parseRef(w.ref);
    if (!ref) continue;
    if (!byRow.has(ref.row)) byRow.set(ref.row, new Map());
    byRow.get(ref.row).set(ref.col, String(w.text ?? ''));
  }
  const skipped = [];
  let written = 0;
  let maxRow = 0;
  let maxCol = 0;

  const rebuildRow = (rowNum, openAttrs, inner, cols) => {
    const cells = [];
    let nextCol = 0;
    for (const cm of (inner || '').matchAll(CELL_RE)) {
      const ref = parseRef(attr(cm[1], 'r'));
      const c = ref ? ref.col : nextCol;
      nextCol = c + 1;
      // Cells without r="" get one, so the merged row stays ordered and explicit.
      const raw = ref ? cm[0] : cm[0].replace(/^<c\b/, `<c r="${colName(c)}${rowNum}"`);
      cells.push({ c, raw, attrs: cm[1], body: cm[2] || '' });
    }
    for (const [c, text] of cols) {
      const i = cells.findIndex((x) => x.c === c);
      const ref = `${colName(c)}${rowNum}`;
      if (i >= 0) {
        if (/<f[\s>]/.test(cells[i].body)) {
          skipped.push({ ref, reason: 'formula' });
          continue;
        }
        cells[i].raw = cellXml(ref, text, attr(cells[i].attrs, 's'));
      } else {
        // A new cell borrows the style of its nearest neighbour on the left (borders, wrapping), as Excel does.
        const left = cells.filter((x) => x.c < c && x.attrs).sort((a, b) => b.c - a.c)[0];
        cells.push({ c, raw: cellXml(ref, text, left ? attr(left.attrs, 's') : null) });
      }
      written++;
      maxCol = Math.max(maxCol, c);
    }
    maxRow = Math.max(maxRow, rowNum);
    cells.sort((a, b) => a.c - b.c);
    // "spans" is only an optimisation hint and may now be wrong; drop it.
    const open = openAttrs.replace(/\sspans="[^"]*"/, '');
    return `<row${open}>${cells.map((x) => x.raw).join('')}</row>`;
  };

  const done = new Set();
  xml = xml.replace(ROW_RE, (whole, a, inner) => {
    const r = Number(attr(a, 'r'));
    if (!byRow.has(r)) return whole;
    done.add(r);
    return rebuildRow(r, a.replace(/\/$/, ''), inner, byRow.get(r));
  });
  const missing = [...byRow.keys()].filter((r) => !done.has(r)).sort((a, b) => a - b);
  if (missing.length) {
    if (!/<sheetData\b[^>]*\/>/.test(xml) && !/<sheetData\b[^>]*>/.test(xml)) throw new ZipError('The sheet has no data section.');
    xml = xml.replace(/<sheetData\b([^>]*)\/>/, '<sheetData$1></sheetData>');
    for (const r of missing) {
      const rowXml = rebuildRow(r, ` r="${r}"`, '', byRow.get(r));
      // Insert before the first existing row with a higher number, so rows stay in order.
      let placed = false;
      xml = xml.replace(ROW_RE, (whole, a) => {
        if (!placed && Number(attr(a, 'r')) > r) {
          placed = true;
          return rowXml + whole;
        }
        return whole;
      });
      if (!placed) xml = xml.replace('</sheetData>', `${rowXml}</sheetData>`);
    }
  }
  // Widen the <dimension> hint if we wrote outside it.
  xml = xml.replace(/<dimension ref="([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?"\s*\/>/, (m, c1, r1, c2, r2) => {
    const endCol = Math.max(colIndex(c2 || c1), maxCol);
    const endRow = Math.max(Number(r2 || r1), maxRow);
    return `<dimension ref="${c1}${r1}:${colName(endCol)}${endRow}"/>`;
  });
  entry.data = Buffer.from(xml, 'utf8');
  return { buffer: writeZip(entries, { date }), written, skipped };
}

/**
 * Builds a one-sheet workbook. rows: string[][]; opts: { sheetName, widths: number[], headerRow (1-based),
 * titleRows: number[] (1-based), wrapFrom (1-based first wrapped row) }. Strings go to sharedStrings.xml, like
 * Excel does, so the reader's main path is exercised.
 */
export function buildXlsx(rows, { sheetName = 'Sheet1', widths = [], headerRow = 1, titleRows = [], date } = {}) {
  const strings = [];
  const index = new Map();
  const si = (s) => {
    if (!index.has(s)) {
      index.set(s, strings.length);
      strings.push(s);
    }
    return index.get(s);
  };
  const lastCol = Math.max(...rows.map((r) => r.length)) - 1;
  const sheetRows = rows
    .map((r, i) => {
      const n = i + 1;
      const style = n === headerRow ? 1 : titleRows.includes(n) ? 3 : n > headerRow ? 2 : 0;
      const cells = r
        .map((v, c) => (v === '' || v == null ? (n > headerRow ? `<c r="${colName(c)}${n}" s="${style}"/>` : '') : `<c r="${colName(c)}${n}" s="${style}" t="s"><v>${si(String(v))}</v></c>`))
        .join('');
      return `<row r="${n}">${cells}</row>`;
    })
    .join('');
  const cols = widths.length ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><dimension ref="A1:${colName(lastCol)}${rows.length}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="${headerRow}" topLeftCell="A${headerRow + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/>${cols}<sheetData>${sheetRows}</sheetData><autoFilter ref="A${headerRow}:${colName(lastCol)}${rows.length}"/><pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>`;
  const sst = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">${strings.map((s) => `<si><t xml:space="preserve">${escapeXml(s)}</t></si>`).join('')}</sst>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="3"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="14"/><name val="Calibri"/><family val="2"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1F3A5F"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFBFBFBF"/></left><right style="thin"><color rgb="FFBFBFBF"/></right><top style="thin"><color rgb="FFBFBFBF"/></top><bottom style="thin"><color rgb="FFBFBFBF"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  const files = [
    ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>`],
    ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets><sheet name="${escapeXml(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`],
    ['xl/worksheets/sheet1.xml', sheet],
    ['xl/styles.xml', styles],
    ['xl/sharedStrings.xml', sst],
  ];
  return writeZip(files.map(([name, data]) => ({ name, data })), { date });
}
