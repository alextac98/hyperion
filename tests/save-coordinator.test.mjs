import assert from 'node:assert/strict';
import test from 'node:test';
import { transform } from 'esbuild';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../app/lib/save-coordinator.ts', import.meta.url), 'utf8');
const { code } = await transform(source, { loader: 'ts', format: 'esm' });
const { SaveCoordinator } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

test('flush persists the newest debounced record before acknowledging saved', async () => {
  const saves = new SaveCoordinator(); const written = [];
  saves.enqueue('note', async()=>written.push('old'), 60000);
  saves.enqueue('note', async()=>written.push('new'), 60000);
  assert.equal(saves.getState(), 'saving'); await saves.flush();
  assert.deepEqual(written,['new']); assert.equal(saves.getState(),'saved');
});
test('failed saves remain visible and retry persists the retained job', async()=>{
  const saves=new SaveCoordinator(); let failed=true;let writes=0;
  saves.enqueue('note',async()=>{if(failed)throw new Error('disk full'); writes++;},60000);
  await assert.rejects(saves.flush(),/disk full/);assert.equal(saves.getState(),'error');
  failed=false;await saves.flush();assert.equal(writes,1);assert.equal(saves.getState(),'saved');
});
test('edits queued during an in-flight save are drained in order',async()=>{
  const saves=new SaveCoordinator();let release;const written=[];
  const blocked=new Promise(resolve=>{release=resolve;});
  saves.enqueue('note',async()=>{await blocked;written.push('first');},60000);
  const flush=saves.flush();await Promise.resolve();
  saves.enqueue('note',async()=>written.push('second'),60000);release();await flush;
  assert.deepEqual(written,['first','second']);assert.equal(saves.getState(),'saved');
});
test('flush waits for assets and retries failed external writes',async()=>{
  const saves=new SaveCoordinator();let failure=true;
  await assert.rejects(saves.track(async()=>{if(failure)throw new Error('asset write failed');}));
  assert.equal(saves.getState(),'error');failure=false;await saves.flush();assert.equal(saves.getState(),'saved');
});
