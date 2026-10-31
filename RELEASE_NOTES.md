# Sillytavern DWC AGENT V1.0

**首次公开实验版 / First public experimental release**

## 中文

为 SillyTavern 私聊与群聊增加逐角色工具循环、版本化私有记忆和有限格式检查。继续使用你当前的 API、角色卡和预设；无需另配模型密钥。

安装前请阅读 README：前端扩展与 `server/` 后端必须同时安装，并启用 ST 的服务端插件。模型必须支持原生工具调用。旧本地原型请先停用，避免双份扩展同时运行。

已知限制包括 WorldInfo Info 触发显示兼容、依赖固定措辞的格式识别、其他扩展工具未互通及非流式请求。详细说明见 README。此次发布不包含个人聊天、角色卡、预设或密钥。

## English

Adds per-character tool loops, versioned private memory and limited output checks to SillyTavern private and group chats, using your existing API connection, cards and preset.

Read the README before installing: both the frontend and the local `server/` backend are required. ST server plugins must be enabled, and your model must support native tool calls. Disable the old local prototype before enabling this extension.

Known limitations include WorldInfo Info activation display, wording-dependent format detection, lack of unrelated extension-tool integration and non-streaming requests. See the README for details. No personal chats, cards, presets or credentials are distributed.
