import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveOutputContract, validateOutput } from '../output-contract.mjs';
import { runAgent } from '../runtime.mjs';

// Synthetic fixture: never read or publish a user's preset or chat.
const format = '<format name="OUTPUT_FORMAT">正文必须且只能由两个段落组成。叙述内容：以第一人称。</format>';
const statusRule = '本轮回复必须以以下状态块开头\n<status>\ntime: 当前时间\nlocation: 当前地点\ntarget: 互动对象\nscene: 当前活动\nemotion: 当前情绪\nattitude: 当前态度\nguard: 留意\ncontrol: 清醒\ndesire: 平淡\npleasure: 无感\n</status>';
const contract = deriveOutputContract([{role:'system',content:format},{role:'user',content:statusRule}], '测试角色');
const status = '<status>\ntime: 未知\nlocation: 前台\ntarget: 访客\nscene: 寒暄\nemotion: 气定神闲\nattitude: 不卑不亢\nguard: 留意\ncontrol: 清醒\ndesire: 平淡\npleasure: 无感\n</status>';
const valid = status + '\n\n*我转过身，向你轻轻点头。*\n\n[light, composed] 你好，请坐。';

test('derive the active two-paragraph, first-person and status contracts from a synthetic preset',()=>{
    assert.equal(contract.twoParagraphs,true); assert.equal(contract.firstPersonNarration,true); assert.equal(contract.statusRequired,true);
    assert.deepEqual(contract.statusFields,['time','location','target','scene','emotion','attitude','guard','control','desire','pleasure']);
    assert.deepEqual(validateOutput(valid,contract),[]);
});
test('the exact reported suffix and third-person self narration are rejected',()=>{
    const sample=status+'\n\n*她转过身，向你点头。*\n\n你好。</tool';
    const errors=validateOutput(sample,contract);
    assert.ok(errors.some(e=>e.includes('工具传输标签')));
    assert.ok(errors.some(e=>e.includes('第一人称')));
});
test('do not impose disabled or unknown format modules; preserve legitimate story words and markup',()=>{
    const inactive=deriveOutputContract([{role:'user',content:'Hello'}],'测试角色');
    assert.equal(inactive.twoParagraphs,false);
    assert.deepEqual(validateOutput('她拿起一把 tool，走进 <toolbox> 工具箱旁。',inactive),[]);
    assert.deepEqual(validateOutput(valid,contract),[]);
});
test('full and partial tool wrappers cannot leak, while TTS labels remain untouched',()=>{
    for(const tag of ['</tool','</tool>','<tool_call>','</tool_calls>','<function=agent_submit>']) assert.ok(validateOutput(valid+tag,contract).length,tag);
    assert.deepEqual(validateOutput(valid.replace('你好，请坐。','[short pause] ……'),contract),[]);
    assert.deepEqual(validateOutput(valid.replace('你好，请坐。','“朋友”这个称呼可以，请坐。'),contract),[]);
});
test('paragraph, status order and outer quotation mistakes are detected',()=>{
    assert.ok(validateOutput(valid.replace('前台\ntarget','前台\nunknown'),contract).length);
    assert.ok(validateOutput(valid.replace('*我转过身，向你轻轻点头。*','我转过身，向你轻轻点头。'),contract).length);
    assert.ok(validateOutput(valid+'\n\n又一段。',contract).length);
    assert.ok(validateOutput(valid.replace('你好，请坐。','“你好，请坐。”'),contract).length);
});
const call=(name,args,id)=>({id,type:'function',function:{name,arguments:JSON.stringify(args)}});
test('a rejected submit stays private and a later repaired submit becomes the public reply',async()=>{
    let round=0; const events=[];
    const result=await runAgent({name:'测试角色',messages:[],maxRounds:4,validateSubmission:t=>validateOutput(t,contract),onEvent:e=>events.push(e),request:async turns=>{
        round++;
        if(round===1)return {tool_calls:[call('agent_memory_read',{},'read')]};
        if(round===2)return {tool_calls:[call('agent_submit',{text:valid+'</tool'},'bad')]};
        assert.match(turns.at(-1).content,/格式校验/);
        return {tool_calls:[call('agent_submit',{text:valid},'good')]};
    }});
    assert.equal(result.text,valid); assert.equal(result.rounds,3);
    assert.equal(events.filter(e=>e.type==='submitted').length,1);
});
test('duplicate final submissions reject the entire batch rather than publish the first candidate',async()=>{
    let round=0;
    const result=await runAgent({name:'A',messages:[],request:async turns=>{
        round++;
        if(round===1)return {tool_calls:[call('agent_memory_read',{},'read')]};
        if(round===2)return {tool_calls:[call('agent_submit',{text:'wrong-first'},'one'),call('agent_submit',{text:'wrong-second'},'two')]};
        assert.match(turns.at(-1).content,/重复/);
        return {tool_calls:[call('agent_submit',{text:'single-repaired'},'three')]};
    }});
    assert.equal(result.text,'single-repaired'); assert.equal(result.rounds,3);
});
