import { getContext, extension_settings } from '/scripts/extensions.js';
import { createGenerationParameters, getChatCompletionModel, oai_settings } from '/scripts/openai.js';
import { ChatCompletionService } from '/scripts/custom-request.js';
import { cleanUpMessage } from '/script.js';
import { META_KEY, SUPPORTED_SOURCES, makeInstructions, previousState, publicHistory, runAgent } from './runtime.mjs';
import { deriveOutputContract, validateOutput, submissionReminder } from './output-contract.mjs';

const ID = 'character-agent';
const API = '/api/plugins/character-agent';
const defaults = { enabled: false, allCharacters: true, characters: [], maxRounds: 6, instructions: '' };
let active = null;
let capture = null;
let generateOptions = {};
let lastEvents = [];
let lastResult = null;
let root;
const settings = () => extension_settings[ID] ??= structuredClone(defaults);
const context = () => getContext();
const $id = suffix => root.querySelector('#ca-' + suffix);
const setStatus = text => { if (root) $id('status').textContent = text; };
const isEligible = character => settings().enabled && character && (settings().allCharacters || settings().characters.includes(character.avatar));
const isRunningHere = frame => {
    const ctx = context();
    return ctx.chat === frame.chat && ctx.getCurrentChatId() === frame.chatId && ctx.characters[ctx.characterId]?.avatar === frame.characterKey;
};
const assertHere = frame => { if (!isRunningHere(frame)) throw new Error('聊天或角色已切换，本轮结果没有写入'); };
const renderEvents = () => {
    if (root) $id('events').textContent = lastEvents.map(e => e.type === 'tool' ? `${e.round} · ${e.tool}\n${JSON.stringify(e.result, null, 2)}` : `${e.type}${e.round ? ' · 第 ' + e.round + ' 轮' : ''}${e.name ? ' · ' + e.name : ''}`).join('\n\n');
};
const record = event => {
    lastEvents.push({ at: new Date().toISOString(), ...event });
    lastEvents = lastEvents.slice(-100);
    renderEvents();
};

async function api(route, data, signal) {
    const response = await fetch(API + route, { method: 'POST', headers: context().getRequestHeaders(), body: JSON.stringify(data), signal });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `插件后端 HTTP ${response.status}`);
    return result;
}

async function health() {
    const response = await fetch(API + '/health');
    if (!response.ok) throw new Error('角色 Agent 后端未加载，请重启 ST');
    return response.json();
}

async function requestFactory(messages, { maxTokens } = {}) {
    const frozen = structuredClone(oai_settings);
    frozen.stream_openai = false;
    frozen.n = 1;
    frozen.function_calling = false; // Our loop owns its tool catalog; do not execute unrelated extensions.
    frozen.assistant_prefill = '';
    if (maxTokens) frozen.openai_max_tokens = maxTokens;
    if (!SUPPORTED_SOURCES.has(frozen.chat_completion_source)) throw new Error('首版支持 OpenAI 兼容来源；当前 API 来源暂未适配');
    const model = getChatCompletionModel(frozen);
    const { generate_data } = await createGenerationParameters(frozen, model, 'normal', messages);
    delete generate_data.json_schema;
    delete generate_data.logprobs;
    delete generate_data.top_logprobs;
    delete generate_data.stop;
    generate_data.n = 1;
    generate_data.stream = false;
    // A run has a fixed model/connection, independent of later UI changes.
    return async (turns, tools, signal, toolChoice) => {
        const payload = { ...structuredClone(generate_data), messages: turns, tools, tool_choice: toolChoice };
        const result = await ChatCompletionService.sendRequest(payload, false, signal);
        const message = result?.choices?.[0]?.message;
        if (!message) throw new Error('当前来源没有返回 OpenAI 格式的工具消息；首版暂不支持此响应格式');
        if (result.choices[0].finish_reason === 'length' && !message.content && !message.tool_calls?.length) throw new Error('模型在生成有效工具调用前耗尽了回复 Token 上限；请提高本次请求的最大回复长度');
        return message;
    };
}

async function assemblePrompt(type, signal) {
    capture = { messages: null };
    try {
        // ST builds the character, persona, world info, preset and macro-expanded prompt.
        // dryRun performs no model request and does not add a chat message.
        await context().generate(type, { ...generateOptions, signal }, true);
        if (!Array.isArray(capture.messages) || !capture.messages.length) throw new Error('没有取得 ST 组装的提示词');
        return capture.messages;
    } finally { capture = null; }
}

async function getScope(ctx) {
    if (!ctx.chatMetadata[META_KEY]?.sceneId) {
        ctx.chatMetadata[META_KEY] = { sceneId: crypto.randomUUID() };
        await ctx.saveMetadata();
    }
    return { sceneId: ctx.chatMetadata[META_KEY].sceneId, characterKey: ctx.characters[ctx.characterId].avatar };
}

globalThis.characterAgentIntercept = async (coreChat, _contextSize, abort, type) => {
    const ctx = context();
    const character = ctx.characters[ctx.characterId];
    if (!isEligible(character) || capture) return;
    if (!['normal', 'regenerate', 'swipe'].includes(type)) return;
    // Fail closed: an Agent failure must never silently issue a second ordinary request.
    abort(true);
    if (active) { setStatus('已有 Agent 在运行，请等待或停止'); return; }
    if (ctx.mainApi !== 'openai') { toastr.warning('角色 Agent 首版需要聊天补全 API'); ctx.stopGeneration(); return; }
    const controller = new AbortController();
    const frame = { chat: ctx.chat, chatId: ctx.getCurrentChatId(), characterKey: character.avatar, controller };
    active = frame;
    lastEvents = [];
    lastResult = null;
    $id('events').textContent = '';
    $id('stop').disabled = false;
    setStatus(`${character.name} · 正在准备独立 Agent`);
    // ST has not reached its own showStopButton yet, so expose both stop controls.
    const stop = document.querySelector('#mes_stop');
    if (stop) stop.style.display = 'flex';
    const startedAt = Date.now();
    const timer = setTimeout(() => controller.abort(new DOMException('单轮运行超过 5 分钟', 'TimeoutError')), 300000);
    try {
        await health();
        const scope = await getScope(ctx);
        const parentStateId = previousState(coreChat, character.avatar);
        const state = await api('/state/read', { ...scope, stateId: parentStateId }, controller.signal);
        const prompt = await assemblePrompt(type, controller.signal);
        assertHere(frame);
        const outputContract = deriveOutputContract(prompt, character.name);
        record({ type: 'output_contract', twoParagraphs: outputContract.twoParagraphs, firstPersonNarration: outputContract.firstPersonNarration, statusRequired: outputContract.statusRequired });
        const workingInstructions = makeInstructions(character.name, settings().instructions) + '\n' + submissionReminder(outputContract);
        // Insert after ST's system prompt; retain its complete assembled prompt and style.
        const instructionIndex = Math.max(0, prompt.findIndex(m => m.role !== 'system'));
        prompt.splice(instructionIndex, 0, { role: 'system', content: workingInstructions });
        const request = await requestFactory(prompt);
        const result = await runAgent({ messages: prompt, name: character.name, memory: state.memory, history: publicHistory(coreChat), request, signal: controller.signal, maxRounds: Number(settings().maxRounds) || 6, onEvent: record, validateSubmission: text => validateOutput(text, outputContract) });
        assertHere(frame);
        controller.signal.throwIfAborted();
        // Mirror ST's normal non-streaming path: stops, output regex, markdown,
        // name trimming and group cleanup run once before saving the reply.
        const text = cleanUpMessage({ getMessage: result.text, isImpersonate: false, isContinue: false, displayIncompleteSentences: false });
        const finalViolations = validateOutput(text, outputContract);
        if (finalViolations.length) throw new Error('ST 正文处理后的格式校验失败：' + finalViolations.join('；'));
        const saved = await api('/state/commit', { ...scope, parentStateId, memory: result.memory, rounds: result.rounds, calls: result.calls, events: lastEvents }, controller.signal);
        assertHere(frame);
        controller.signal.throwIfAborted();
        await ctx.saveReply({ type, getMessage: text, title: `DWC AGENT · ${result.rounds} rounds / ${result.calls} tools` });
        const message = ctx.chat[ctx.chat.length - 1];
        const metadata = { ...scope, stateId: saved.stateId, parentStateId, rounds: result.rounds, calls: result.calls, elapsedMs: Date.now() - startedAt };
        message.extra ??= {};
        message.extra[META_KEY] = metadata;
        if (message.swipe_info?.[message.swipe_id]) {
            message.swipe_info[message.swipe_id].extra ??= {};
            message.swipe_info[message.swipe_id].extra[META_KEY] = structuredClone(metadata);
        }
        await ctx.saveChat();
        lastResult = { name: character.name, ...metadata };
        setStatus(`${character.name} · 已提交，${result.rounds} 轮 / ${result.calls} 次工具调用`);
    } catch (error) {
        const cancelled = controller.signal.aborted;
        record({ type: cancelled ? 'cancelled' : 'failed', name: character.name });
        setStatus(cancelled ? '本轮已停止，未提交的记忆不会生效' : `运行失败：${error.message}`);
        if (!cancelled) { console.error('[Character Agent]', error); toastr.error(error.message, '角色 Agent'); }
        ctx.stopGeneration(); // Also stops the remaining ST group queue.
    } finally {
        clearTimeout(timer);
        active = null;
        $id('stop').disabled = true;
        // Let ST's outer unblockGeneration hide the native stop button and emit
        // GENERATION_ENDED, so other extensions receive the normal lifecycle.
    }
};

async function apiTrial() {
    if (active) return;
    const controller = new AbortController();
    active = { controller, diagnostic: true };
    const timer = setTimeout(() => controller.abort(new DOMException('试跑超时', 'TimeoutError')), 180000);
    lastEvents = [];
    $id('stop').disabled = false;
    const sceneId = crypto.randomUUID();
    const publicMessages = [{ name: '上帝', text: '雨夜的旧车站里有一把红伞。你们第一次见面。每人用一到两句话行动或交谈。请在记忆中记录自己的目标。' }];
    try {
        await health();
        const results = [];
        for (const [name, role] of [['林舟', '你是谨慎的失物招领员，想查明红伞的主人。'], ['苏禾', '你是来寻找朋友的旅人，愿意帮助对方。']]) {
            setStatus(`API 试跑 · ${name}`);
            const messages = [{ role: 'system', content: makeInstructions(name) + '\n' + role }, { role: 'user', content: publicMessages.map(m => `${m.name}: ${m.text}`).join('\n') }];
            const request = await requestFactory(messages, { maxTokens: 1000 });
            const result = await runAgent({ messages, name, request, history: publicMessages, signal: controller.signal, maxRounds: 5, onEvent: record });
            const scope = { sceneId, characterKey: 'diagnostic:' + name };
            const saved = await api('/state/commit', { ...scope, memory: result.memory, rounds: result.rounds, calls: result.calls, events: lastEvents }, controller.signal);
            const loaded = await api('/state/read', { ...scope, stateId: saved.stateId }, controller.signal);
            if (JSON.stringify(loaded.memory) !== JSON.stringify(result.memory)) throw new Error('记忆持久化校验失败');
            publicMessages.push({ name, text: result.text });
            results.push({ name, rounds: result.rounds, calls: result.calls, text: result.text, memory: result.memory });
        }
        $id('trial-result').textContent = JSON.stringify({ ok: true, results }, null, 2);
        setStatus('API 双角色试跑成功：分别运行工具循环，第二位已收到第一位的公开发言');
    } catch (error) {
        $id('trial-result').textContent = '试跑失败：' + error.message;
        setStatus('API 试跑未完成：' + error.message);
    } finally { clearTimeout(timer); active = null; $id('stop').disabled = true; }
}

async function inspectMemory() {
    const ctx = context();
    const characterKey = $id('character').value;
    const stateId = previousState(ctx.chat, characterKey);
    if (!stateId) { $id('memory').textContent = '当前聊天中，此角色尚未提交 Agent 记忆。'; return; }
    const sceneId = ctx.chatMetadata[META_KEY]?.sceneId;
    const state = await api('/state/read', { sceneId, characterKey, stateId });
    $id('memory').textContent = JSON.stringify(state.memory, null, 2);
    if (!active) {
        lastEvents = state.events || [];
        renderEvents();
        setStatus(`${$id('character').selectedOptions?.[0]?.textContent || characterKey} · 已保存运行：${state.rounds} 轮 / ${state.calls} 次工具调用`);
    }
}

function refreshCharacters() {
    const select = $id('character');
    const old = select.value;
    select.replaceChildren();
    for (const character of context().characters) {
        const option = document.createElement('option');
        option.value = character.avatar;
        option.textContent = character.name;
        select.appendChild(option);
    }
    const current = context().characters[context().characterId]?.avatar;
    if ([...select.options].some(o => o.value === old)) select.value = old;
    else if (current) select.value = current;
    $id('role-enabled').checked = settings().characters.includes(select.value);
}

function mount() {
    if (document.querySelector('#character-agent-settings')) return;
    root = document.createElement('div');
    root.id = 'character-agent-settings';
    root.className = 'extension_container';
    root.innerHTML = `<div class="inline-drawer"><div class="inline-drawer-toggle inline-drawer-header"><b>Sillytavern DWC AGENT V1.0</b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div><div class="inline-drawer-content">
      <p>V1.0：每个角色单独运行工具循环，复用当前 API、角色卡和预设；提交前校验正文格式。<br>Per-character tool loops, versioned memory and output checks using your current API, character cards and preset.</p>
      <label class="checkbox_label"><input id="ca-enabled" type="checkbox"><span>启用角色 Agent</span></label>
      <label class="checkbox_label"><input id="ca-all" type="checkbox"><span>对所有角色启用（包括群聊成员）</span></label>
      <label for="ca-character">角色配置 / 查看记忆</label><select id="ca-character" class="text_pole"></select>
      <label class="checkbox_label"><input id="ca-role-enabled" type="checkbox"><span>仅为选定角色启用（关闭“所有角色”后生效）</span></label>
      <label for="ca-rounds">每次发言最多模型轮数</label><input id="ca-rounds" class="text_pole" type="number" min="2" max="12">
      <label for="ca-instructions">补充工作偏好（可留空；角色身份仍来自角色卡）</label><textarea id="ca-instructions" class="text_pole" rows="3"></textarea>
      <div class="ca-buttons"><button id="ca-health" class="menu_button">检查后端</button><button id="ca-inspect" class="menu_button">查看所选角色记忆</button><button id="ca-stop" class="menu_button" disabled>停止 Agent</button></div>
      <p id="ca-status" role="status">默认关闭。开启后正常发送消息或启动群聊即可。</p>
      <details><summary>私有记忆</summary><pre id="ca-memory">尚未读取</pre></details>
      <details><summary>最近运行的工具过程（仅本机显示）</summary><pre id="ca-events"></pre></details>
      <details><summary>独立试跑</summary><p>双角色合成场景，调用当前 API 并消耗少量额度；不发送你的聊天记录，也不修改角色卡。</p><button id="ca-trial" class="menu_button">API 双角色试跑</button><pre id="ca-trial-result"></pre></details>
    </div></div>`;
    document.querySelector('#extensions_settings2, #extensions_settings').appendChild(root);
    const cfg = settings();
    $id('enabled').checked = cfg.enabled;
    $id('all').checked = cfg.allCharacters;
    $id('rounds').value = cfg.maxRounds;
    $id('instructions').value = cfg.instructions;
    setStatus(cfg.enabled ? '已启用：正常发送消息即可运行角色 Agent' : '已关闭：开启后正常发送消息或启动群聊即可');
    const save = () => context().saveSettingsDebounced();
    $id('enabled').addEventListener('change', event => { cfg.enabled = event.target.checked; save(); setStatus(cfg.enabled ? '已启用：正常发送消息即可运行角色 Agent' : '已关闭：使用 ST 原来的生成方式'); });
    $id('all').addEventListener('change', event => { cfg.allCharacters = event.target.checked; save(); });
    $id('rounds').addEventListener('change', event => { cfg.maxRounds = Math.max(2, Math.min(12, Number(event.target.value) || 6)); event.target.value = cfg.maxRounds; save(); });
    $id('instructions').addEventListener('change', event => { cfg.instructions = event.target.value.slice(0, 6000); save(); });
    $id('character').addEventListener('change', () => { $id('role-enabled').checked = cfg.characters.includes($id('character').value); });
    $id('role-enabled').addEventListener('change', event => { const key = $id('character').value; cfg.characters = cfg.characters.filter(k => k !== key); if (event.target.checked) cfg.characters.push(key); save(); });
    $id('health').addEventListener('click', () => health().then(data => setStatus(`后端正常 · ${data.version}`)).catch(error => setStatus(error.message)));
    $id('inspect').addEventListener('click', () => inspectMemory().catch(error => setStatus(error.message)));
    $id('stop').addEventListener('click', () => { active?.controller.abort(new DOMException('User cancelled', 'AbortError')); if (!active?.diagnostic) context().stopGeneration(); });
    $id('trial').addEventListener('click', apiTrial);
    refreshCharacters();
}

const events = context().eventTypes;
const source = context().eventSource;
source.on(events.GENERATION_STARTED, (_type, options, dryRun) => { if (!dryRun && !capture) generateOptions = options || {}; });
source.on(events.CHAT_COMPLETION_PROMPT_READY, data => { if (capture && data.dryRun) capture.messages = structuredClone(data.chat); });
source.on(events.GENERATION_STOPPED, () => active?.controller.abort(new DOMException('User cancelled', 'AbortError')));
source.on(events.CHAT_CHANGED, () => { if (active && !active.diagnostic) active.controller.abort(new DOMException('Chat changed', 'AbortError')); if (root) refreshCharacters(); });
source.on(events.CHARACTER_PAGE_LOADED, () => { if (root) refreshCharacters(); });
source.on(events.APP_READY, mount);
// Extension loading can happen after APP_READY on a manual reload.
if (document.querySelector('#extensions_settings')) mount();
