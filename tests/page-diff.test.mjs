import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
// Bundle the same Yjs instance as the diff utility for the fixtures.
const result = await build({ stdin: { contents: 'export { pageChanges } from "./app/lib/page-diff.ts"; export * as Y from "yjs";', resolveDir: process.cwd() }, bundle: true, format: 'esm', platform: 'node', write: false });
const { pageChanges, Y } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
const note = { title: 'Title', body: 'Hello', tags: [], icon: null };
function page() {
  const doc = new Y.Doc();
  doc.getMap('blocks').set('root', new Y.Map([['sys:flavour', 'affine:page'], ['prop:title', new Y.Text('Title')], ['sys:children', Y.Array.from(['p'])]]));
  doc.getMap('blocks').set('p', new Y.Map([['sys:flavour', 'affine:paragraph'], ['prop:text', new Y.Text('Hello')]]));
  return doc;
}
const snapshot = doc => ({ note, document: Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64') });
test('equal visible content ignores Yjs client clocks', () => {
  const a = page(); const b = page();
  assert.deepEqual(pageChanges(snapshot(a), snapshot(b)), []); a.destroy(); b.destroy();
});
test('text, formatting, attachments and layout changes remain visible', () => {
  const doc = page(); const before = snapshot(doc);
  doc.getMap('blocks').get('p').get('prop:text').insert(5, ' world');
  assert.ok(pageChanges(before, snapshot(doc)).some(c=>c.before==='Hello' && c.after==='Hello world'));
  const text = snapshot(doc);
  doc.getMap('blocks').get('p').get('prop:text').format(0,5,{bold:true});
  assert.ok(pageChanges(text, snapshot(doc)).some(c=>c.detail?.includes('Formatting')));
  const formatted = snapshot(doc);
  doc.getMap('blocks').set('image', new Y.Map([['sys:flavour','affine:image'],['prop:sourceId','asset-1']]));
  assert.ok(pageChanges(formatted,snapshot(doc)).some(c=>c.label==='image' && c.detail==='Block added'));
  const image = snapshot(doc);
  doc.getMap('blocks').get('image').set('prop:sourceId','asset-2');
  assert.ok(pageChanges(image,snapshot(doc)).some(c=>c.label==='image'));
  const replaced = snapshot(doc);
  doc.getMap('blocks').get('root').get('sys:children').insert(0,['image']);
  assert.ok(pageChanges(replaced,snapshot(doc)).some(c=>c.detail?.includes('layout')));
  doc.destroy();
});
test('metadata and legacy text are compared, excluding edit timestamps', () => {
  const a = { note: { ...note, updatedAt:'yesterday' } };
  const b = { note: { ...note, updatedAt:'today', tags:['new'], body:'New text' } };
  assert.deepEqual(pageChanges(a,b).map(c=>c.key), ['tags','body']);
});

const textBundle = await build({ entryPoints: ['app/lib/text-diff.ts'], bundle: true, format: 'esm', platform: 'node', write: false });
const { compareText } = await import(`data:text/javascript;base64,${Buffer.from(textBundle.outputFiles[0].text).toString('base64')}`);

test('word-level comparison highlights only edits and preserves both original texts', () => {
  for (const [before, after] of [
    ['The red fox rests.', 'The blue fox rests.'],
    ['a  b\n\tc\r\n', 'a b\n  c\n'],
    ['', 'A new paragraph'], ['Removed paragraph', ''],
    ['你好世界 👋 café', '你好朋友 👋 cafés'],
    ['<script>alert("old")</script>', '<script>alert("new")</script>'],
  ]) {
    const diff = compareText(before, after);
    assert.equal(diff.before.map(part=>part.text).join(''), before);
    assert.equal(diff.after.map(part=>part.text).join(''), after);
  }
  const diff = compareText('The red fox rests.', 'The blue fox rests.');
  assert.deepEqual(diff.before.filter(part=>part.changed).map(part=>part.text), ['red']);
  assert.deepEqual(diff.after.filter(part=>part.changed).map(part=>part.text), ['blue']);
});

test('large comparisons and exhausted time budgets fall back without omitting text', () => {
  const before = 'old '.repeat(30_000); const after = 'new '.repeat(30_000);
  assert.deepEqual(compareText(before, after), { before: [{text:before,changed:true}], after: [{text:after,changed:true}] });
  assert.deepEqual(compareText('a','b',0), { before: [{text:'a',changed:true}], after: [{text:'b',changed:true}] });
  assert.deepEqual(compareText('same','same'), { before: [{text:'same',changed:false}], after: [{text:'same',changed:false}] });
});
