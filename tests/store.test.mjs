import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { StateStore, validateScope, validateMemory } from '../server/store.mjs';
const root = path.resolve('test-output', randomUUID());
const scope = { sceneId: randomUUID(), characterKey: 'A.png' };

test('immutable state versions isolate characters, users and divergent branches', async () => {
    await mkdir(root, { recursive: true });
    const store = new StateStore(root);
    const base = await store.commit(scope, { memory: { goal: 'base' } });
    const a = await store.commit(scope, { parentStateId: base.stateId, memory: { goal: 'branch-a' } });
    const b = await store.commit(scope, { parentStateId: base.stateId, memory: { goal: 'branch-b' } });
    assert.equal((await store.load(scope, a.stateId)).memory.goal, 'branch-a');
    assert.equal((await store.load(scope, b.stateId)).memory.goal, 'branch-b');
    assert.equal((await store.load(scope, base.stateId)).memory.goal, 'base');
    await assert.rejects(store.load({ ...scope, characterKey: 'B.png' }, a.stateId), { code: 'ENOENT' });
    await assert.rejects(new StateStore(path.join(root,'other-user')).load(scope,a.stateId), { code: 'ENOENT' });
});

test('scope and version path traversal cannot escape the private data directory', async () => {
    assert.throws(() => validateScope({ sceneId: '../x', characterKey: 'A' }));
    const store = new StateStore(root);
    await assert.rejects(store.load(scope, '../../settings.json'), /Invalid state ID/);
    assert.ok(store.directory({ ...scope, characterKey: '../../secrets.json' }).startsWith(store.root));
    assert.throws(() => validateMemory(JSON.parse('{"__proto__":"bad"}')));
});
