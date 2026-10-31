import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import * as runtime from '../runtime.mjs';
import * as outputContract from '../output-contract.mjs';
import { StateStore } from '../server/store.mjs';

test('ST adapter intercepts private and sequential group turns, saves swipe state and fails closed', async () => {
    const settings = {};
    const elements = new Map();
    const element = id => {
        if (!elements.has(id)) elements.set(id, { value: '', textContent: '', checked: false, disabled: false, style: {}, options: [], addEventListener() {}, replaceChildren() { this.options = []; }, appendChild(child) { this.options.push(child); } });
        return elements.get(id);
    };
    const listeners = new Map();
    const eventSource = { on(name, callback) { const list = listeners.get(name) || []; list.push(callback); listeners.set(name, list); }, async emit(name, ...args) { for (const callback of listeners.get(name) || []) await callback(...args); } };
    const eventTypes = Object.fromEntries(['GENERATION_STARTED','CHAT_COMPLETION_PROMPT_READY','GENERATION_STOPPED','CHAT_CHANGED','CHARACTER_PAGE_LOADED','APP_READY'].map(x => [x,x]));
    const captured = [];
    let stops = 0;
    let fail = false;
    const ctx = {
        chat: [{ is_user: true, name: 'God', mes: 'Meet at the station.' }], chatMetadata: {},
        characters: [{ name: 'A', avatar: 'A.png' }, { name: 'B', avatar: 'B.png' }],
        characterId: 0, groupId: null, mainApi: 'openai', eventSource, eventTypes,
        getCurrentChatId() { return this.groupId ? 'group-chat' : 'private-chat'; },
        getRequestHeaders() { return { 'Content-Type': 'application/json' }; }, saveMetadata: async () => {}, saveSettingsDebounced() {}, saveChat: async () => {},
        stopGeneration() { stops++; eventSource.emit('GENERATION_STOPPED'); },
        async generate(type, options, dryRun) {
            assert.equal(dryRun, true); assert.ok(options.signal);
            await eventSource.emit('GENERATION_STARTED', type, options, true);
            await eventSource.emit('CHAT_COMPLETION_PROMPT_READY', { dryRun: true, chat: [{ role: 'system', content: 'card:' + this.characters[this.characterId].name }, ...this.chat.map(m => ({ role: m.is_user ? 'user' : 'assistant', content: m.mes }))] });
        },
        async saveReply({ type, getMessage }) {
            if (type === 'swipe') {
                const last = this.chat.at(-1); last.swipe_id++; last.mes = getMessage; last.swipes.push(getMessage); last.swipe_info.push({ extra: {} });
            } else this.chat.push({ name: this.characters[this.characterId].name, mes: getMessage, extra: {}, swipes: [getMessage], swipe_id: 0, swipe_info: [{ extra: {} }] });
        },
    };
    const store = new StateStore(path.resolve('test-output', randomUUID()));
    const fetch = async (url, opts) => {
        if (url.endsWith('/health')) return { ok: true, json: async () => ({ ok: true, version: 'test' }) };
        const body = JSON.parse(opts.body);
        const scope = { sceneId: body.sceneId, characterKey: body.characterKey };
        const data = url.endsWith('/read') ? await store.load(scope, body.stateId) : await store.commit(scope, body);
        return { ok: true, json: async () => data };
    };
    const service = { async sendRequest(payload) {
        if (fail) throw new Error('simulated provider failure');
        captured.push(structuredClone(payload.messages));
        const name = ctx.characters[ctx.characterId].name;
        const last = payload.messages.at(-1);
        let nameTool, args;
        if (last.role !== 'tool') { nameTool = 'agent_memory_read'; args = {}; }
        else if (last.content.includes('"memory"')) { nameTool = 'agent_memory_write'; args = { key: 'secret', value: name + '-private-only' }; }
        else { nameTool = 'agent_submit'; args = { text: name + ': hello' }; }
        return { choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: randomUUID(), type: 'function', function: { name: nameTool, arguments: JSON.stringify(args) } }] } }] };
    } };
    const modules = {
        '/scripts/extensions.js': { getContext: () => ctx, extension_settings: settings },
        '/scripts/openai.js': { createGenerationParameters: async (s,m,t,messages) => ({ generate_data: { messages, model: m, chat_completion_source: s.chat_completion_source } }), getChatCompletionModel: () => 'test-model', oai_settings: { chat_completion_source: 'openrouter' } },
        '/scripts/custom-request.js': { ChatCompletionService: service },
        '/script.js': { cleanUpMessage: ({getMessage}) => getMessage },
        './runtime.mjs': runtime,
        './output-contract.mjs': outputContract,
    };
    const sandbox = vm.createContext({ console, structuredClone, DOMException, AbortController, crypto: { randomUUID }, setTimeout, clearTimeout, fetch, toastr: { warning() {}, error() {} }, document: { querySelector(selector) { if (selector === '#character-agent-settings') return null; return element(selector); }, createElement(tag) { if (tag === 'option') return { value: '', textContent: '' }; return { querySelector: id => element(id), innerHTML: '', className: '', id: '' }; } } });
    const source = await readFile(new URL('../index.js', import.meta.url), 'utf8');
    const mod = new vm.SourceTextModule(source, { context: sandbox });
    await mod.link(async specifier => {
        assert.ok(modules[specifier], 'unknown ST dependency ' + specifier);
        const entries = Object.entries(modules[specifier]);
        return new vm.SyntheticModule(entries.map(([key]) => key), function () { for (const [key,value] of entries) this.setExport(key,value); }, { context: sandbox });
    });
    await mod.evaluate();
    settings['character-agent'].enabled = true;
    const intercept = sandbox.characterAgentIntercept;
    let aborted = false;
    await intercept(ctx.chat.slice(), 8192, () => { aborted = true; }, 'normal');
    assert.equal(aborted, true);
    assert.equal(ctx.chat.at(-1).name, 'A');
    const firstState = ctx.chat.at(-1).extra[runtime.META_KEY].stateId;
    assert.equal(ctx.chat.at(-1).swipe_info[0].extra[runtime.META_KEY].stateId, firstState);
    assert.ok(captured[0].some(m => m.content === 'card:A'));

    // ST chooses each group member and awaits its Generate call before the next.
    ctx.groupId = 'group1'; ctx.characterId = 1;
    const bStart = captured.length;
    await intercept(ctx.chat.slice(), 8192, () => {}, 'normal');
    assert.equal(ctx.chat.at(-1).name, 'B');
    const bPayloads = captured.slice(bStart);
    assert.ok(JSON.stringify(bPayloads[0]).includes('A: hello'));
    assert.ok(!JSON.stringify(bPayloads).includes('A-private-only'));

    const bMessage = ctx.chat.at(-1);
    const oldBState = bMessage.extra[runtime.META_KEY].stateId;
    await intercept(ctx.chat.slice(0,-1), 8192, () => {}, 'swipe');
    assert.equal(bMessage.swipe_id, 1);
    assert.equal(bMessage.swipe_info[0].extra[runtime.META_KEY].stateId, oldBState);
    assert.notEqual(bMessage.swipe_info[1].extra[runtime.META_KEY].stateId, oldBState);

    const length = ctx.chat.length;
    fail = true; aborted = false;
    await intercept(ctx.chat.slice(), 8192, () => { aborted = true; }, 'normal');
    assert.equal(aborted, true);
    assert.equal(ctx.chat.length, length);
    assert.equal(stops, 1);
});
