import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
const digest = value => createHash('sha256').update(value).digest('hex');
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export function validateScope(body) {
    if (!uuid(body?.sceneId) || typeof body?.characterKey !== 'string' || !body.characterKey || body.characterKey.length > 500) throw new Error('Invalid scene or character identity');
    return { sceneId: body.sceneId, characterKey: body.characterKey };
}
export function validateMemory(memory) {
    if (!memory || typeof memory !== 'object' || Array.isArray(memory) || Object.keys(memory).length > 40 || JSON.stringify(memory).length > 24000) throw new Error('Invalid memory size');
    for (const [key, value] of Object.entries(memory)) {
        if (!/^[\p{L}\p{N}_ .-]{1,80}$/u.test(key) || ['__proto__','prototype','constructor'].includes(key) || typeof value !== 'string' || value.length > 4000) throw new Error('Invalid memory entry');
    }
}
export class StateStore {
    constructor(userRoot) { this.root = path.join(userRoot, 'character-agent'); }
    directory(scope) { validateScope(scope); return path.join(this.root, scope.sceneId, digest(scope.characterKey)); }
    async load(scope, stateId) {
        if (!stateId) return { memory: {}, stateId: null };
        if (!uuid(stateId)) throw new Error('Invalid state ID');
        const data = JSON.parse(await readFile(path.join(this.directory(scope), stateId + '.json'), 'utf8'));
        if (data.sceneId !== scope.sceneId || data.characterKey !== scope.characterKey) throw new Error('State identity mismatch');
        validateMemory(data.memory);
        return data;
    }
    async commit(scope, { memory, parentStateId = null, rounds = 0, calls = 0, events = [] }) {
        validateScope(scope); validateMemory(memory);
        if (parentStateId) await this.load(scope, parentStateId);
        if (!Array.isArray(events) || events.length > 100 || JSON.stringify(events).length > 180000) throw new Error('Invalid event log size');
        const stateId = randomUUID();
        const data = { ...scope, stateId, parentStateId, memory, createdAt: new Date().toISOString(), rounds, calls, events };
        const directory = this.directory(scope);
        await mkdir(directory, { recursive: true });
        const finalPath = path.join(directory, stateId + '.json');
        const temporary = finalPath + '.tmp';
        await writeFile(temporary, JSON.stringify(data, null, 2), { flag: 'wx' });
        await rename(temporary, finalPath);
        return { stateId, createdAt: data.createdAt };
    }
}
