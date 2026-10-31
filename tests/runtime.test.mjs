import test from 'node:test';
import assert from 'node:assert/strict';
import { META_KEY, runAgent, previousState, publicHistory, AgentLimitError } from '../runtime.mjs';
const call = (name, args, id = 'call_' + Math.random()) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });
const reply = (...calls) => ({ role: 'assistant', content: null, tool_calls: calls });
const read = () => reply(call('agent_memory_read', {}));
const finish = text => reply(call('agent_submit', { text }));
const scripted = responses => async () => { assert.ok(responses.length, 'unexpected extra model request'); return responses.shift(); };

test('private turn executes a real loop, stages memory and submits only public text', async () => {
    const events = [];
    const initial = { goal: 'Find umbrella owner' };
    const result = await runAgent({ name: 'A', messages: [{ role: 'user', content: 'hello' }], memory: initial, request: scripted([read(), reply(call('agent_memory_write', { key: 'goal', value: 'Ask B' })), finish('你好。')]), onEvent: e => events.push(e) });
    assert.equal(result.text, '你好。');
    assert.equal(result.memory.goal, 'Ask B');
    assert.equal(initial.goal, 'Find umbrella owner');
    assert.equal(result.rounds, 3);
    assert.deepEqual(events.filter(e => e.type === 'tool').map(e => e.tool), ['agent_memory_read','agent_memory_write','agent_submit']);
});

test('the first model turn reads memory and later turns must choose a tool including submit', async () => {
    let n = 0;
    await runAgent({ name: 'A', messages: [], request: async (_messages,_tools,_signal,choice) => {
        if (++n === 1) { assert.deepEqual(choice, { type: 'function', function: { name: 'agent_memory_read' } }); return read(); }
        assert.equal(choice,'required'); return finish('done');
    } });
});

test('sequential group members see public replies, never the other member private memory', async () => {
    const history = [{ name: 'God', text: 'Meet at the station' }];
    const a = await runAgent({ name: 'A', history, messages: [], memory: { secret: 'A-only' }, request: scripted([read(), finish('红伞是谁的？')]) });
    history.push({ name: 'A', text: a.text });
    const bEvents = [];
    const b = await runAgent({ name: 'B', history, messages: [], memory: { secret: 'B-only' }, request: scripted([read(), reply(call('agent_history_search', { query: '红伞' })), finish('我帮你找。')]), onEvent: e => bEvents.push(e) });
    assert.equal(b.memory.secret, 'B-only');
    assert.ok(!JSON.stringify(bEvents).includes('A-only'));
    assert.equal(bEvents.find(e => e.tool === 'agent_history_search').result.matches[0].text, a.text);
});

test('a cancelled turn cannot return provisional writes as a committed result', async () => {
    const abort = new AbortController();
    const initial = { goal: 'old' };
    let n = 0;
    await assert.rejects(runAgent({ name: 'A', messages: [], memory: initial, signal: abort.signal, request: async () => {
        n++;
        if (n === 1) return read();
        abort.abort(new DOMException('stopped', 'AbortError'));
        return reply(call('agent_memory_write', { key: 'goal', value: 'new' }), call('agent_submit', { text: 'never' }));
    } }), { name: 'AbortError' });
    assert.equal(initial.goal, 'old');
});

test('unknown tools, malformed arguments and premature submit are returned as tool errors', async () => {
    let n = 0;
    const result = await runAgent({ name: 'A', messages: [], request: async turns => {
        n++;
        if (n === 1) return finish('too soon');
        if (n === 2) { assert.match(turns.at(-1).content, /read memory/); return read(); }
        if (n === 3) return reply(call('shell', { command: 'anything' }), { id: 'bad', type: 'function', function: { name: 'agent_memory_write', arguments: '{' } });
        assert.match(turns.at(-1).content, /error/);
        return finish('safe');
    } });
    assert.equal(result.text, 'safe');
});

test('loop budget stops without publishing a partial reply', async () => {
    await assert.rejects(runAgent({ name: 'A', messages: [], maxRounds: 2, request: async () => read() }), AgentLimitError);
});

test('prototype pollution and oversized memory are blocked', async () => {
    const events = [];
    await runAgent({ name: 'A', messages: [], request: scripted([read(), reply(call('agent_memory_write', { key: '__proto__', value: 'bad' }), call('agent_memory_write', { key: 'huge', value: 'x'.repeat(4001) })), finish('ok')]), onEvent: e => events.push(e) });
    assert.equal(events.filter(e => e.type === 'tool' && e.result.error).length, 2);
    assert.equal({}.polluted, undefined);
});

test('visible swipe selects its own memory; deleting/regenerating uses only prior visible states', () => {
    const metadata = stateId => ({ [META_KEY]: { characterKey: 'A', stateId } });
    const a = { extra: metadata('state0'), swipe_id: 1, swipe_info: [{ extra: metadata('state0') }, { extra: metadata('state1') }] };
    const b = { extra: { [META_KEY]: { characterKey: 'B', stateId: 'B-state' } } };
    assert.equal(previousState([a,b], 'A'), 'state1');
    a.swipe_id = 0;
    assert.equal(previousState([a,b], 'A'), 'state0');
    a.swipe_info.push({ extra: {} }); a.swipe_id = 2;
    assert.equal(previousState([a,b], 'A'), null);
    assert.equal(previousState([], 'A'), null);
    assert.equal(previousState([a,b], 'B'), 'B-state');
});

test('search history excludes system/tool messages', () => {
    assert.deepEqual(publicHistory([{ is_system: true, mes: 'private tool data' }, { name: 'A', mes: 'public' }]), [{ name: 'A', text: 'public' }]);
});
