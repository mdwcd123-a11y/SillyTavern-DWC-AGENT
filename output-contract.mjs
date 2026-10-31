// Enforce only recognizable rules present in ST's assembled prompt. Never enable
// a disabled preset module merely because it exists in the saved settings.
const textOf = message => typeof message.content === 'string' ? message.content : Array.isArray(message.content) ? message.content.filter(part => part.type === 'text').map(part => part.text).join('\n') : '';
const escapeRegex = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function deriveOutputContract(messages, characterName = '') {
    const systemText = messages.filter(message => message.role === 'system').map(textOf).join('\n');
    const formatBlock = systemText.match(/<format\b[^>]*\bname\s*=\s*["']OUTPUT_FORMAT["'][^>]*>[\s\S]*?<\/format>/i)?.[0] || '';
    const latestUser = [...messages].reverse().find(message => message.role === 'user');
    const userText = latestUser ? textOf(latestUser) : '';
    const statusRequired = userText.includes('本轮回复必须以以下状态块开头');
    const statusTemplate = statusRequired ? userText.match(/<status>\s*([\s\S]*?)<\/status>/)?.[1] : null;
    return {
        characterName,
        twoParagraphs: /必须且只能由两个段落组成/.test(formatBlock),
        firstPersonNarration: /叙述内容：以第一人称/.test(formatBlock),
        formatBlock,
        statusRequired,
        statusFields: statusTemplate ? [...statusTemplate.matchAll(/^([a-z_]+):/gm)].map(match => match[1]) : [],
    };
}

// Match protocol markup, including the incomplete '</tool' reported in the bug.
// Ordinary story text about a tool and the preset's own <status> are preserved.
const transportTag = /<\/?(?:tool(?:_calls?|_results?|_response)?|function(?:_call)?|arg_key|arg_value)(?=[\s>/=:]|$)[^<>]*(?:>|$)|<\|(?:tool|assistant|im_end|im_start)[^<>]*(?:\|>|$)/i;

export function validateOutput(text, contract = {}) {
    const errors = [];
    if (typeof text !== 'string' || !text.trim()) return ['公开回复不能为空'];
    if (transportTag.test(text)) errors.push('正文含有工具传输标签（例如 </tool 或 <tool_call>）。通过原生 JSON 工具调用传参，text 中只放预设要求的公开回复');
    let body = text.replace(/\r\n?/g, '\n').trim();
    const status = body.match(/^<status>\n([\s\S]*?)\n<\/status>/);
    if (contract.statusRequired && !status) errors.push('当前状态协议要求回复以完整的 <status> 状态块开头');
    if (status) {
        if (contract.statusFields?.length) {
            const fields = status[1].split('\n').map(line => line.match(/^([a-z_]+):[^\n]+$/)?.[1] ?? null);
            if (JSON.stringify(fields) !== JSON.stringify(contract.statusFields)) errors.push('状态字段必须按当前预设的顺序逐行填写，值不得换行');
        }
        body = body.slice(status[0].length);
        if (contract.twoParagraphs && !body.startsWith('\n\n')) errors.push('状态块后应空一行再写正文');
        body = body.trim();
    }
    if (contract.twoParagraphs) {
        const paragraphs = body.split('\n\n');
        if (paragraphs.length !== 2 || paragraphs.some(paragraph => !paragraph.trim() || paragraph.includes('\n'))) {
            errors.push('除状态块外，正文必须恰好两段，每段内部不换行，两段间只留一处空行');
        } else {
            const [narration, speech] = paragraphs;
            if (!/^\*[^*\n]+\*$/.test(narration)) errors.push('第1段叙述必须由一对半角星号完整包裹：*叙述*');
            const spoken = speech.replace(/^(?:\[[^\]\n]*\]\s*)+/, '').trim();
            if ([['*','*'],['“','”'],['"','"'],['「','」'],['『','』']].some(([open,close]) => spoken.startsWith(open) && spoken.endsWith(close))) errors.push('第2段发声正文不得整体包裹在星号或引号内，保留预设允许的 TTS 方括号标签');
            if (contract.firstPersonNarration) {
                const prose = narration.replace(/^\*|\*$/g, '');
                const selfThird = new RegExp(`(?:^|[，。！？；：\\s])(?:她|他|它${contract.characterName ? '|' + escapeRegex(contract.characterName) : ''})(?=[^们])`);
                if (!/(?:我|咱|本人)/.test(prose) && selfThird.test(prose)) errors.push('当前预设要求叙述以第一人称指代当前角色；请把当前角色的第三人称自指改为第一人称，勿改写其他参与者的行动');
            }
        }
    }
    return errors;
}

export function submissionReminder(contract = {}) {
    return `提交边界：agent_submit.text 是完整的公开回复，必须保留当前预设要求的状态块、正文结构、叙述视角和 TTS 标签。工具调用只使用原生 JSON；不要在 text 内加入 <tool>、</tool>、函数名、工具过程或私有记忆。一次只调用一个 agent_submit，且作为该轮唯一的最终提交。${contract.twoParagraphs ? '\n当前有效 OUTPUT_FORMAT：状态元数据之外，正文恰好两段；第1段 *叙述*，第2段发声文本，两段之间空一行，段内不换行。' : ''}${contract.firstPersonNarration ? '\n叙述与发声中指代当前角色时遵循第一人称，不改为第三人称旁白。' : ''}${contract.statusRequired ? '\n当前有效状态协议：公开回复以 <status> 状态块开始，按原注入规则填写，状态块结束后空一行再写两段正文。' : ''}`;
}
