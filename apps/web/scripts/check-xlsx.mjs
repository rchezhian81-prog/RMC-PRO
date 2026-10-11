#!/usr/bin/env node
/**
 * Proves the dependency-free .xlsx writer (src/lib/xlsx.ts) produces a file
 * that unzips cleanly: it transpiles the module with the workspace's
 * TypeScript, builds a small workbook, writes it to a temp folder and asks
 * Python's zipfile (an independent reader) to test every entry's CRC. It also
 * checks the parts Excel needs are present and that the sheet XML holds the
 * header row bold and the numbers as numbers.
 *
 *   node apps/web/scripts/check-xlsx.mjs
 *
 * Exits non-zero on any failure. Needs python3 on the PATH for the CRC check;
 * without it the structural checks still run and the CRC check is reported as
 * skipped.
 */
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const ts = require('typescript');

async function loadTs(relPath) {
  const src = readFileSync(join(here, '..', relPath), 'utf8');
  const out = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(out).toString('base64')}`);
}

let failed = 0;
const ok = (name, cond) => {
  console.log(`${cond ? '  PASS ' : '  FAIL '}${name}`);
  if (!cond) failed++;
};

const xlsx = await loadTs('src/lib/xlsx.ts');
const labels = await loadTs('src/lib/column-labels.ts');
const print = await loadTs('src/lib/print-table.ts');

// ---- CRC-32 against a known vector ----
ok('crc32("123456789") is the IEEE check value', xlsx.crc32(new TextEncoder().encode('123456789')) === 0xcbf43926);
ok('column letters run A, Z, AA, AB', [0, 25, 26, 27].map(xlsx.columnLetter).join(',') === 'A,Z,AA,AB');

// ---- a workbook ----
const columns = labels.columnsWithLabels(['material', 'materialCode', 'uom', 'totalIn', 'totalOut', 'gstRate', 'flag'], { uom: 'Unit' });
ok('labels read from the keys', columns.map((c) => c.label).join('|') === 'Material|Material code|Unit|Total in|Total out|GST rate|Flag');
const rows = [
  { material: 'OPC 53 <cement> & "sand"', materialCode: 'MAT-001', uom: 'MT', totalIn: 120.5, totalOut: '30.250', gstRate: 18, flag: true },
  { material: 'River sand', materialCode: '0012', uom: 'MT', totalIn: 0, totalOut: null, gstRate: '5', flag: false },
];
const bytes = xlsx.buildXlsx({ name: 'Stock movement: [test]/2026', columns, rows }, new Date(2026, 9, 11, 10, 30));
ok('workbook starts with the local-header signature', bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 3 && bytes[3] === 4);
const text = Buffer.from(bytes).toString('latin1');
for (const part of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/worksheets/sheet1.xml', 'xl/styles.xml']) {
  ok(`contains ${part}`, text.includes(part));
}
ok('header cells carry the bold style', text.includes('<c r="A1" t="inlineStr" s="1">'));
ok('a number is written as a number', text.includes('<c r="D2"><v>120.5</v></c>'));
ok('a numeric string is written as a number', text.includes('<c r="E2"><v>30.25</v></c>'));
ok('a code with a leading zero stays text', text.includes('<t xml:space="preserve">0012</t>'));
ok('a boolean is written as a boolean', text.includes('<c r="G2" t="b"><v>1</v></c>'));
ok('markup in a value is escaped', text.includes('OPC 53 &lt;cement&gt; &amp; &quot;sand&quot;'));
ok('the sheet name drops the characters Excel forbids', text.includes('name="Stock movement test 2026"'));

const dir = mkdtempSync(join(tmpdir(), 'rmc-xlsx-'));
const file = join(dir, 'check.xlsx');
writeFileSync(file, bytes);
const py = spawnSync('python3', ['-I', '-c', [
  'import sys, zipfile',
  'from xml.etree import ElementTree',
  'z = zipfile.ZipFile(sys.argv[1])',
  'bad = z.testzip()',
  'names = z.namelist()',
  'for n in names: ElementTree.fromstring(z.read(n))',
  'print("BAD" if bad else "OK", len(names))',
  'sys.exit(1 if bad else 0)',
].join('\n'), file], { encoding: 'utf8' });
if (py.error) {
  console.log('  SKIP python3 not available for the independent CRC check');
} else {
  ok(`python zipfile reads every entry and every part parses as XML (${(py.stdout || py.stderr).trim()})`, py.status === 0 && py.stdout.startsWith('OK 6'));
}

// ---- the print page ----
const html = print.printTableHtml({ title: 'Stock movement', columns, rows, companyName: 'Kovai RMC', subtitle: 'This month' }, new Date(2026, 9, 11, 10, 30));
ok('print page is landscape for more than six columns', html.includes('size:A4 landscape'));
ok('print page carries the company and the title', html.includes('Kovai RMC') && html.includes('<h1>Stock movement</h1>'));
ok('print page right-aligns a numeric column', html.includes('<th class="n">Total in</th>'));
ok('print page escapes markup', html.includes('OPC 53 &lt;cement&gt; &amp; &quot;sand&quot;'));
const narrow = print.printTableHtml({ title: 'T', columns: columns.slice(0, 3), rows: [] });
ok('print page is portrait for six columns or fewer', narrow.includes('size:A4 portrait') && narrow.includes('No rows.'));

console.log(failed ? `\n${failed} check(s) failed` : '\nxlsx + print checks passed');
process.exit(failed ? 1 : 0);
