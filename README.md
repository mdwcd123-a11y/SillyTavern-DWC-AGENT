# Sillytavern DWC AGENT V1.0

**面向 SillyTavern 私聊与群聊的角色 Agent 扩展。**

**A per-character agent extension for SillyTavern private and group chats.**

Version: **1.0.0** · Status: **Experimental / 实验版** · License: **AGPL-3.0-only**

[中文介绍](#中文介绍) · [English](#english)

## 中文介绍

DWC AGENT 为每次角色发言加入独立的工具循环与版本化私有记忆。它复用当前 Chat Completion API、角色卡、用户设定、预设与世界书；群聊中的发言顺序仍由 SillyTavern 决定。

角色先读取自己的记忆，再按需检索公开历史、记录状态或掷骰子，最后提交完整回复。程序检查可识别的输出格式，再将结果交回 ST。它不会自动提升模型能力，也不保证所有写作规则都能通过程序强制执行。

### 功能

- 私聊与顺序群聊均可使用，支持全角色启用或逐角色选择。
- 按场景及角色隔离记忆，版本关联聊天消息与当前 swipe，支持分支回溯。
- 五种工具：读取记忆、写入记忆、搜索公开历史、掷骰子、提交回复。
- 提交前拦截工具标签泄漏，并对已识别的状态块与正文结构进行有限格式检查。
- 提供停止按钮、模型调用轮数上限、运行日志与合成双角色试跑。
- 无需填写第二份模型密钥，继续使用 ST 当前连接。

### 安装要求

- 本次接入目标为 **SillyTavern 1.19.0**；其他版本未经完整验证。
- 使用 ST 所支持的 Node.js 版本；本项目自动化测试使用 Node.js 22。
- Chat Completion 模型及服务商必须支持 **OpenAI 格式的原生工具调用**。
- **前端扩展和本地服务端插件都必须安装。**仅通过扩展管理器安装前端不够。

### 安装

1. 备份聊天及 `data/<user>/character-agent/` 记忆目录。
2. 在 ST 扩展管理器选择“安装扩展”，输入：

   ```text
   https://github.com/mdwcd123-a11y/SillyTavern-DWC-AGENT
   ```

3. 完全停止 ST。把刚安装扩展中的 **`server` 文件夹内容**复制到 ST 根目录的 **`plugins/character-agent/`**，该目录下应直接包含 `index.mjs`、`store.mjs` 和 `package.json`。
4. 在 ST 的 `config.yaml` 中将 `enableServerPlugins` 设为 `true`。服务端插件在本机执行代码，安装前请审阅源码。
5. 启动 ST 并刷新页面，在扩展设置中打开 **Sillytavern DWC AGENT V1.0**，点击“检查后端”。
6. 开启“启用角色 Agent”，选用支持工具调用的模型，然后正常发送消息。

也可以下载 Release 中的 ZIP，解压后将根目录前端文件放入 `data/<user>/extensions/SillyTavern-DWC-AGENT/`，将 `server/` 内文件放入 `plugins/character-agent/`。不要将整个压缩包根目录当作服务端插件。

从旧的本地 `ST-Character-Agent` 原型迁移时，先在扩展管理器停用旧前端；不要同时启用两份扩展。内部设置键、服务端 ID 与记忆格式保持兼容，但仍应提前备份。已安装同名服务端目录时，应在 ST 停止期间更新其中的源码文件，保留用户记忆目录。

### 使用与成本

一次发言的常见最短路径为“读记忆 → 提交回复”，通常需要两次模型响应，不等于两次审稿。写记忆是按需调用，并非每轮强制执行。默认最多 6 轮模型调用、40 次工具调用，单次角色发言超时为 5 分钟。多次请求会增加延迟和 API 费用；当前使用非流式响应。

“补充工作偏好”是全局选项，不是逐角色独立提示词。角色身份仍来自角色卡；选择查看记忆的角色不会切换当前聊天。

### 已知限制

- **WorldInfo Info 显示兼容**：Agent 使用 ST 的 dry-run 提示词组装，世界书可能进入提示词，但正式激活事件不会由该路径正常发出，触发列表可能不更新。
- **输出规则识别有限**：两段式检查依赖 `OUTPUT_FORMAT` 内的“必须且只能由两个段落组成”；第一人称检查依赖旧句式“叙述内容：以第一人称”；状态要求依赖最新用户提示中的固定协议文本。改写规则后，程序检查可能不启用。语义判断、文笔与人物一致性仍依赖模型。
- **工具互通有限**：循环只开放本插件的工具，不自动接入其他扩展的函数工具。
- 历史搜索是文字包含匹配，不是向量语义检索。
- 没有 MCP、Skill、Shell、子 Agent、后台持续运行或完整文件工作区。
- 普通回复、重新生成和新 swipe 可接管；继续写作、冒充用户和 quiet 请求仍走 ST 原流程。
- 私有记忆不会经本插件的记忆工具提供给其他角色，但模型仍可能看到公开上下文中的场外信息。
- 手工编辑旧正文不会自动重算记忆；角色头像文件名变更可能被视为新身份。
- 关闭页面、切换聊天或停止会中断运行。若记忆文件已写入但聊天保存失败，可能留下未被消息引用的版本；后续不会自动采用这些孤立版本。

### 数据说明

插件没有自建云服务或遥测。模型请求使用你的 ST 连接，发给模型的上下文、记忆和工具结果受该服务商的数据政策约束。记忆与工具日志保存在 ST 用户目录的 `character-agent/`。发布包不包含个人聊天、角色卡、预设、密钥或本机配置。

### 开发与反馈

```sh
npm test
```

测试使用合成数据及模拟模型，不消耗 API 额度。报告问题请提供 ST 版本、模型与接口类型、复现步骤、脱敏报错；不要上传 API Key 或完整私聊记录。欢迎通过 Issues 和 Pull Requests 反馈。

## English

DWC AGENT adds a separate tool loop and versioned private memory to each character turn. It reuses your current Chat Completion connection, character card, persona, preset and world information. SillyTavern continues to choose the speaking order in group chats.

Each turn reads the character's own memory, optionally searches public history, writes notes or rolls dice, then submits a complete public reply. Recognized output-format rules are checked before the result is saved to ST. This does not increase the underlying model's intelligence or guarantee semantic compliance with every preset rule.

### Features

- Private chats and sequential group turns; global or per-character enablement.
- Scene- and character-scoped memory, with immutable versions linked to messages and selected swipes.
- Five tools: memory read, memory write, public-history search, dice and final submission.
- Tool-wrapper filtering and limited checks for recognized status blocks and output structures.
- Cancellation, model-round limits, local tool logs and a synthetic two-character API trial.
- Your existing ST API connection and credentials; no second model key is needed.

### Requirements and installation

Integration target: **SillyTavern 1.19.0**. Other versions have not been fully validated. Use a Node.js version supported by ST; automated tests run on Node.js 22. Your Chat Completion model/provider must support **native OpenAI-format tool calls**.

**Both components are required:** the frontend extension and the local server plugin.

1. Back up your chats and `data/<user>/character-agent/`.
2. In ST's extension manager, install `https://github.com/mdwcd123-a11y/SillyTavern-DWC-AGENT`.
3. Fully stop ST. Copy the **contents of `server/`** from the installed extension to **`plugins/character-agent/`** under the ST root. This destination must directly contain `index.mjs`, `store.mjs` and `package.json`.
4. Set `enableServerPlugins: true` in ST's `config.yaml`. Server plugins execute local code; review the source before enabling them.
5. Start ST, reload its page, open **Sillytavern DWC AGENT V1.0**, and click **检查后端** (Check backend).
6. Enable **启用角色 Agent** (Enable character Agent), choose a tool-capable model and chat normally.

For ZIP installation, put the frontend files in `data/<user>/extensions/SillyTavern-DWC-AGENT/` and the contents of `server/` in `plugins/character-agent/`. The release root itself is not a server plugin. When migrating from the local `ST-Character-Agent` prototype, disable the old frontend first. Do not enable both copies. Existing internal IDs and memory formats remain compatible. Update backend files only while ST is stopped; preserve the user memory directory.

### Behavior, cost and limitations

The shortest normal path is memory read followed by submission: usually two model responses, **not two review passes**. Memory writes are optional. Defaults are six model rounds, forty tool calls and a five-minute timeout per character turn. Requests are non-streaming and consume your provider's API credits. Additional working preferences are global, not per-character.

This is an **experimental first release**:

- WorldInfo Info's active-entry display may not update because ST dry-run assembly does not emit the normal activation event.
- Output validation recognizes specific existing prompt wording, not arbitrary natural-language rules. The two-paragraph detector expects `必须且只能由两个段落组成` inside `OUTPUT_FORMAT`; first-person detection expects `叙述内容：以第一人称`; status detection expects the existing injected status protocol. Rewritten presets may bypass these checks.
- The loop uses its own tools; tools registered by unrelated extensions are not automatically available.
- History search is substring matching, not vector search.
- No MCP, Skills, shell access, sub-agents, background execution or full file workspace.
- Normal replies, regeneration and new swipes are intercepted. Continue, impersonation and quiet requests use ST's normal flow.
- Private memory is not exposed to other characters through this plugin's memory tools. Public context can still contain information a character should not know; epistemic boundaries depend on your prompt and model.
- Editing old messages does not recompute memory. Renaming an avatar file may change character identity.
- Closing the page, switching chats or stopping cancels the run. A failed chat save can leave an unreferenced memory version; subsequent turns do not automatically select it.

### Data and development

There is no DWC-hosted cloud service or telemetry. Requests use your ST connection; context, memory and tool results sent to the model are subject to your provider's data policy. Memory and tool logs are stored in `character-agent/` inside the ST user directory. No personal chats, cards, presets, credentials or local settings are included in this repository.

Run `npm test` for synthetic offline tests; no API credits are required. The settings UI is currently primarily Chinese, with a bilingual project description. For issues, include your ST version, model/provider, reproduction steps and sanitized errors. Do not attach API keys or private chat histories.

## License / 许可证

GNU Affero General Public License v3.0 only (`AGPL-3.0-only`). See [LICENSE](LICENSE). This is a third-party extension, not an official SillyTavern product. SillyTavern and model/provider names belong to their respective owners.
