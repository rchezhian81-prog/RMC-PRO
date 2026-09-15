/**
 * The tab a printed document opens in is titled with the document's number
 * and saves under it — not the random id of the in-browser blob it is shown
 * from ("3d798575-7587-…pdf" for a receipt, as first seen on the live system).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { documentFilename, documentViewerHtml } from '../../dist/index.js';

test('the file name comes from Content-Disposition, else the caller, else "document" — always .pdf', () => {
  assert.equal(documentFilename('inline; filename="RCPT-0001.pdf"'), 'RCPT-0001.pdf');
  assert.equal(documentFilename('inline; filename=RCPT-0001.pdf'), 'RCPT-0001.pdf');
  assert.equal(documentFilename("attachment; filename*=UTF-8''INV-0017.pdf"), 'INV-0017.pdf');
  assert.equal(documentFilename('inline; filename="RCPT0056/26-27.pdf"'), 'RCPT0056-26-27.pdf', 'a slash in a number cannot be in a file name');
  assert.equal(documentFilename(null, 'RCPT-0001'), 'RCPT-0001.pdf', 'the caller\'s name when the header is not readable');
  assert.equal(documentFilename(undefined, ''), 'document.pdf');
  assert.equal(documentFilename('inline', null), 'document.pdf');
});

test('the viewer page is titled with the number, prints the PDF, and saves under the real name', () => {
  const html = documentViewerHtml({ url: 'blob:https://app.example/abc-123', filename: 'RCPT-0001.pdf' });
  assert.ok(html.includes('<title>RCPT-0001</title>'), 'the tab title is the document number');
  assert.ok(html.includes('download="RCPT-0001.pdf"'), 'Save uses the real name');
  assert.ok(html.includes('<iframe id="pdf" src="blob:https://app.example/abc-123"'), 'the PDF fills the page');
  assert.ok(html.includes("contentWindow.print()"), 'Print prints the PDF, not the wrapper');
});

test('a document name is escaped on the way into the page', () => {
  const html = documentViewerHtml({ url: 'blob:x', filename: 'Statement - <BuildCo & Sons>.pdf' });
  assert.ok(html.includes('<title>Statement - &lt;BuildCo &amp; Sons&gt;</title>'));
  assert.ok(!html.includes('<BuildCo'), 'no raw angle brackets from the name');
});

test('a phone browser with no PDF viewer is told to save the file instead of shown a blank frame', () => {
  const html = documentViewerHtml({ url: 'blob:x', filename: 'CN-0001.pdf' });
  assert.ok(html.includes("navigator.pdfViewerEnabled === false"), 'detects the missing viewer (Android Chrome)');
  assert.ok(html.includes('id="nopdf" class="nopdf gone"'), 'the notice is hidden until then');
  assert.ok(html.includes('cannot show a PDF on the page'), 'and says what to do');
  assert.ok(html.includes('download="CN-0001.pdf">Save CN-0001.pdf</a>'), 'with the file under its own name');
  assert.ok(html.includes('.gone{display:none!important}'), 'hiding beats the iframe\'s display:block');
});
