# deck 交接（2026-11-13）

新对话先读这份，再读 `docs/plan.md`。

## 项目

- 位置：`/Users/dip/Desktop/project/deck`。个人的消息和项目中枢：用 `tools/dws/dws` 拉钉钉，用 `drlee` 拉 channel。
- 技术：后端是 Python 标准库 + SQLite（`src/deck`），前端是 React 19 + Vite + Tailwind v4（`web`）。
- 运行：deck 由 launchd 常驻运行。改完用 `scripts/publish.sh --restart` 发布，脚本会自检。
- 截图：`scripts/ui-shots.sh [输出目录] [页面名]` 用演示数据截电脑和手机两种宽度，不碰 `~/.deck`。
- Git：远端 origin 是 `https://github.com/shuishani/deck.git`，最新提交 `a944cf6`。之后的改动都还没提交。
  - 要提交，需要用户明确同意。
  - 另有对话也在改 deck 前端，提交前要先核对文件范围。

## 规则

- 改完、验证完直接发布，不用问。
- 发消息、改路由、数据保留、git 操作，都要先确认。
- 只往测试群发消息：钉钉 `management-x-dev-TEST`，channel `测试dev-1023`。
- 不读 `channel/要求.txt` 和 secrets 目录，不打印登录码、token 或 Webhook。
- 不扩展聊天功能，已读状态只记在本地或以平台为准。
- 只跑和改动相关的测试（`uv run pytest -q tests/<相关文件>`；前端用 `pnpm run typecheck`、`lint`、`test`）。
- 迁移只能在 `migrations.STEPS` 末尾追加，不改已有步骤。数据库现在是第 8 版。

## 这次做完的

- **MCP**（`deck mcp`，`src/deck/mcp.py`）：
  - 是 stdio 服务，工具由操作注册表 `deck/api` 生成。
  - 发送、编辑、撤回各拆成 `*_preview` 和 `*_confirm` 两步，确认时要带群名，生产群还要带 `prod=true`。
  - 用户说 MCP 还没想好，没定稿。
- **登录**：修了同一设备反复生成新会话的问题。
  - 原因：`SimpleCookie` 遇到不规范的 cookie 会把后面的都丢掉。
  - 修法：手动解析 Cookie；重新登录时撤销旧会话；cookie 名字按端口区分。
- **钥匙串**（`src/deck/keychain.py`）：
  - 密钥统一放在钥匙串：`deck-ai`、`deck-notify-webhook`、`deck-notify-secret`。
  - 原因：launchd 启动的进程拿不到 shell 的环境变量。
- **AI**（`src/deck/ai.py`）：
  - 模型用 LiteLLM 上的 gpt-5.5。
  - 每月预算 200 万 token，单次输出上限 8192 token（最多 32768）。
  - 设置页重新设计过。AI 没配好时，界面上不显示 AI 入口（看 `config.ai_ready`）。
- **推送设置**（`src/deck/notify.py`，设置 → 提醒）：
  - 机器人：钉钉个人群里的「deck管家」，用加签方式。
  - 级别：紧急 / 高 / 中 / 低，和任务优先级同一套。每级分别设上班时间和下班后多少分钟没处理就推送，默认只推「紧急」（15 / 30 分钟）。
  - 工作时间是周一到周五 09:30–18:30；每日汇报 09:30。
  - **推送后台还没做**，这些设置目前只保存，不起作用。
- **「超时」标记**：「需回复」里的「超时」跟「高」级别的推送等待时间走（`notify.wait`）。「高」设成「不推送」时不标。原来的「回复超时」设置已经删掉。
- **会话状态**：
  - `conversations.mode` 有三个值：`ai`（监听并 AI 分析）、`listen`（监听，AI 不读）、`off`（停止监听）。
  - `conversations.chat` 区分群聊 `group` 和单聊 `direct`。
  - 弹窗里用「监听」「AI 分析」两个开关来设 mode。
- **单聊**：
  - 来源：钉钉 `+chat-list --types group,p2p`，channel 的 `channel list`（类型为 dm）。
  - 自动接入，归在「个人」项目下（`store.PERSONAL`），默认 `listen`。
  - 移除后，对方再发新消息才会重新出现。
- **平台已读同步**（用户选的方案 A）：在平台上读过的消息移出「需回复」。
  - channel 看 `last_read_message_created_at`；钉钉看 `unreadPoint`，最近 n 条以外的都算已读。
  - 记在 `conversations.seen_at`。
- **机器人消息**：channel 的 agent、拍档代发（`ai_assisted` 且 automatic），以及钉钉的 `messageAiSendFlag`，都记成 `messages.bot = 1`。这类消息不算未读、不进「需回复」。
- **删掉的「不提醒的发送人」（`ignore_senders`）**：
  - 钉钉通知机器人 `management-x-dev` 没有机器人标记，只出现在测试群里。
  - 改成把测试群 `management-x-dev-TEST` 的提醒设为「不提醒」（`scope = off`）。
  - 以后遇到认不出的通知机器人，也这样处理它所在的群。
- **设置页**：改成 会话 / 提醒 / AI / 访问 四页。
  - 会话：平台卡片（channel 卡片上直接填拉取间隔，单位分钟）、会话列表（群聊 / 单聊）、消息保留。
  - 提醒：提醒级别和工作时间、推送到钉钉。
  - 访问：访问地址、已登录设备。
- **配置文件**：`~/.deck/config.toml` 里已不用的 `reply_reminder_hours` 和 `ignore_senders` 删掉了。

## 接下来要做的

1. **推送后台**（下一步）。先在对话里出设计，用户看过再写代码。
   - 规则推送：单聊、@我、超过等待时间。
   - AI 分级：新消息排队、批量交给 AI，每个群记住上下文；判为「紧急」的提前发。
   - 每日汇报：9:30 用 `notify.send` 发 Markdown。
   - 遵守级别设置、工作时间、各会话的提醒范围和安静时段；不能重复推送。
2. **二期**：问题研判，结合聊天记录判断。**三期**：自动修复小 bug 并推送。小问题代回复先一键确认，稳定后再按白名单自动发。
3. **MCP**：方案待定。
4. **每月预算**：一期估计要 800 万～1000 万 token，现在是 200 万，用户还没确认。
5. **可选**：项目列表里是否隐藏「个人」项目，用户还没回答。

## 本机问题（只告诉了用户，没处理）

- `com.dip.local-gateway`（127.0.0.1:15722）起不来，原因是缺 `~/.local-gateway/server.mjs`。
- `com.dip.env-litellm-key.plist` 里有明文的云端密钥。
