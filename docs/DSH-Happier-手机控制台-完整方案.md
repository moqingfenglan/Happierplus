# DSH × Happier 手机统一控制台 — 完整方案

> 版本：v1.0（2026-10-31）
> 工作目录：`C:\Users\<you>\Documents\Happierplus`
> 实测对象：DeepSeek Harness 桌面版 44.7.0（内置 `@deepseek-ai/dsh-acp` 0.2.1-rc.5）、Happier `main`（Expo 54 / RN 0.81.5）
> 结论：**可行，建议先做“原版 Happier + 自研 ACP 桥”拿 P0，再 fork 做 P1 的会话浏览与原生体验。**

---

## 0. 一页结论

### 0.1 能不能做？

**能。** 而且比预想更顺：DeepSeek Harness 的桌面安装包**已经自带 ACP 服务**，不需要装任何插件：

```powershell
dsh --profile acp
```

我在当前机器上做了真实协议验证（不是看文档推测）：

- `initialize` 成功，声明 `session/list`、`session/resume`、`session/close`；
- 列出了 **27 个已存在会话**，且与桌面 App 共用 `~/.dsh/sessions`；
- 新建会话、切换模型、发 prompt、流式收消息、结束，全部跑通；
- `session/request_permission` 真实触发，返回 `allow-once` / `reject-once`；
- 对桌面端创建的旧会话执行 `session/resume` 成功，会话状态与配置恢复（但不向客户端回放旧消息，需要桥读日志补）；
- 但 `session/load` 返回 `-32601 Method not found`——这正是需要桥接层补上的一个洞。

Happier 侧也确认：它支持 **Custom ACP** 后端（Settings → AI & Agents → AI backends → 底部 Custom backends），并可声明 `supportsLoadSession`；手机端推送、Allow/Deny 按钮、多机、E2E、自托管 relay 都是现成的。

### 0.2 最快能到什么程度？

| 目标 | 原版 Happier + ACP 桥 | Fork Happier |
|---|---|---|
| 手机收 DSH 完成通知 | ✅ 2 周内 | ✅ |
| 手机批准/拒绝 DSH 工具调用 | ✅ | ✅ |
| 手机发后续指令 / 开新会话 | ✅ | ✅ |
| 多台电脑汇聚、区分来源 | ✅ | ✅ |
| 公网 + 端到端加密 | ✅（自托管 relay / Tailscale） | ✅ |
| 浏览 DSH 历史会话并续接 | ⚠️ 只能粘贴 Session ID 续接 | ✅ 列表浏览 |
| 看 DSH 的 todo / plan / 交付物卡片 | ❌ 通用 ACP UI | ✅ 原生卡片 |
| 手机看桌面端正在跑的会话 | ❌（ACP 无法接管运行中会话） | ✅ 只读跟随（Phase 5 读日志） |
| 手机审批“桌面端已启动”的会话 | ❌（见 1.3） | ⚠️ 需进程内插件，Phase 7 |
| 自己的品牌/包名/上架 | ❌ | ✅ |

### 0.3 推荐路线

1. **Phase 1–3（约 4 周 / 20 个工作日）**：不 fork。写一个 `dsh-acp-bridge`，把 DSH 的 ACP 包成 Happier 能吃的标准 ACP；自托管 relay；两台电脑 + 一台手机跑通 P0。
2. **Phase 4–5（约 6–8 周）**：fork Happier，加一等公民 `dsh` provider + 直接读 DSH 会话日志的 direct-session 源，补上“浏览现有会话 / 历史回放 / todo 卡片 / 缓存清理”。
3. **Phase 6（约 2 周）**：品牌、CI 出包、TestFlight/Play 内测、硬化。
4. **Phase 7（可选，R&D）**：写 DSH 进程内插件，接管桌面端会话的审批，实现真正的“全量群控”。这一步不确定性最高，建议放到最后。

### 0.4 当前机器能不能开发？

**能开发 70%，但原生 App 的编译建议交给 CI。**

- 本机已具备：Node 24、npm、git、Python、VS Code、WSL2 Ubuntu、winget、Hyper-V。
- 本机缺少：Node 22（Happier/Expo 推荐）、yarn、JDK 17、Android SDK/adb、Docker、Rust、gh。
- 本机可直接做并有实测证据：DSH ACP 桥、Happier CLI/daemon、relay 服务端、协议测试、日志解析。
- 本机不适合：iOS 编译（必须 macOS）、完整 Happier Monorepo 的移动端原生构建（16GB 内存偏紧、依赖 5–8GB）。
- **推荐组合**：本地写代码 + 真机/局域网验证；Android APK 用 GitHub Actions（ubuntu）或 EAS；iOS 用 GitHub Actions 的 macOS runner 或 EAS Build + TestFlight。

---

## 1. 需求拆解与验收标准

### 1.1 角色与场景

- **用户**：一个人，拥有 2–5 台电脑（家里 Windows、公司 Mac/Windows、云上 Linux devbox），手机上希望像看 Slack 一样看所有 agent。
- **Agent**：Codex（Happier 已原生支持）、DeepSeek Harness（本方案要接）、后续可扩展 OpenCode/Claude。
- **核心动作**：收通知 → 看结果 → 批准/拒绝 → 回一句话 → 开下一个会话。
- **非目标**：不监控子 agent 的细粒度执行；不做 IDE；不做云端代码执行。

### 1.2 P0 / P1 / P2 验收表

| 优先级 | 需求 | 验收标准（可测试） | 方案归属 |
|---|---|---|---|
| P0 | 任务完成通知 | 手机锁屏收到推送，含会话名/机器名/摘要；点开进入对应会话 | Happier 原生 + bridge |
| P0 | 批准/拒绝 | DSH 触发需审批的工具调用，手机 3 秒内收到；点 Allow 后工具成功，点 Deny 后工具失败 | ACP `request_permission` |
| P0 | 回复新内容 | 运行中可发消息；会话结束后可继续发；消息出现在 DSH 会话里 | ACP `session/prompt` |
| P0 | 结束后开新会话 | 手机选机器/目录/模型，新建 DSH 会话并收到回复 | Happier new session + ACP |
| P1 | 多机汇聚 | 两台电脑的会话在同一列表；标题/机器名可区分；单台离线不影响另一台 | Happier machines |
| P1 | 公网可用 | 手机关掉 Wi-Fi 用 5G 也能收到/操作；relay 在 VPS 或 Tailscale | 自托管 relay |
| P1 | 管理现有会话 | 手机能看到 DSH 历史会话列表、标题、目录；能续接 | Fork + 日志/ACP list |
| P1 | 结果附件 | 手机能打开 DSH 产出的图片/文档；可缓存；设置里可清理 | Happier 文件/附件 + 新缓存页 |
| P2 | 端到端加密 | relay 数据库看不到 prompt/回复明文；仅元数据 | Happier 默认 E2E |
| P2 | 非目标 | 不展示子 agent 过程；只保留根会话完成状态与最终结果 | 过滤 `delegationDepth>0` |

### 1.3 关键边界（先说清楚，避免后期扯皮）

| 会话状态 | 手机能看到 | 手机能发消息 | 手机能审批 |
|---|---|---|---|
| Happier/桥启动的 DSH 会话（运行中） | ✅ 实时 | ✅ | ✅ |
| DSH 桌面端正在跑的会话 | ✅ 只读跟随（读日志） | ❌ 需先接管，接管需会话空闲 | ❌ 审批在桌面端本地 |
| DSH 已结束的持久化会话 | ✅ | ✅ 续接（ACP `session/resume`） | 不适用 |
| DSH 子 agent | ❌ 按非目标过滤 | ❌ | ❌ |

> 这张表描述的是 **Phase 5 完成后的目标状态**。如果只用“原版 Happier + ACP 桥”（Phase 1–3），只有第一行成立；桌面端运行中的会话在手机上看不到（因为 Custom ACP 没有会话浏览入口，运行中的会话又不能被 resume 接管）。
>
> 这不是实现偷懒，而是 DSH 的进程模型决定的：一个会话同一时刻只有一个“写者”。桌面端正在写，ACP 进程就不能同时写；但读日志可以。要打破这个限制，只能在 DSH 进程内装插件（Phase 7）。

---

## 2. 调研结论（可验证的事实）

### 2.1 Happier 的架构与可复用能力

Happier 是 MIT 开源的 TypeScript Monorepo，包含：

- `apps/ui`：Expo 54 / React Native 0.81.5，iOS/Android/Web/桌面（Tauri）；
- `apps/cli`：CLI + daemon + 各 agent backend（Claude、Codex、OpenCode、ACP 等）；
- `apps/server`：relay server（E2E，Socket.IO realtime）；
- `packages/agents`：agent manifest（能力声明、resume、session listing、媒体、工具）；
- `packages/protocol`：客户端/服务端协议与 ACP catalog schema；
- `apps/stack`：`hstack` 本地栈/自托管工具。

对本方案最重要的四个现成能力：

1. **Custom ACP**：任意 ACP CLI 都能作为 backend；字段包含 command/args/env、capabilities、defaultModel、auth、transport。源码里 `AcpBackendCapabilitiesV1Schema` 明确有 `supportsLoadSession` 开关，后端编辑器也有 “Supports session resume” 开关；但官方 feature matrix 目前仍把 Custom ACP 的 resume 标为 “—”，文档与实现不一致，**Phase 2 必须以真机为准**。
2. **通知**：Expo Push（FCM/APNs）+ 服务端存 token + CLI 发送；手机端 permission 通知直接带 `Allow` / `Deny` 动作按钮。
3. **多机**：每台机器装 daemon，登录同一账号，relay 只做加密内容转发和路由；App 按 machine 区分。
4. **Direct sessions**：Claude/Codex/OpenCode 可以“浏览 agent 自己的会话、跟随、接管、导入”。这套框架可以复用到 DSH（Phase 5）。

### 2.2 DSH 的 ACP 能力（我在本机实测）

安装包路径：

```
C:\Users\<you>\AppData\Local\Programs\DeepSeek Harness\
  resources\runtime\cli\bin\dsh.cmd
  resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-desktop-host\lib\cli.js
```

`dsh --profile acp` 是**随安装包自带**的 profile，不需要 `dsh plugin add`。启动方式（等价于 `dsh.cmd --profile acp`）：

```powershell
$env:ELECTRON_RUN_AS_NODE=1
& "C:\Users\<you>\AppData\Local\Programs\DeepSeek Harness\DeepSeek Harness.exe" `
  --expose-internals `
  "C:\Users\<you>\AppData\Local\Programs\DeepSeek Harness\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-desktop-host\lib\cli.js" `
  --profile acp
```

`initialize` 的真实返回（节选）：

```json
{
  "protocolVersion": 1,
  "agentInfo": { "name": "deepseek-harness-acp", "version": "0.0.1" },
  "agentCapabilities": {
    "mcpCapabilities": { "http": true },
    "promptCapabilities": { "image": false, "audio": false, "embeddedContext": false },
    "sessionCapabilities": { "close": {}, "list": {}, "resume": {} }
  },
  "authMethods": []
}
```

`session/list` 返回 27 个会话（与桌面 App 同一份存储）：

```json
[
  { "sessionId": "session-94d0345c-...", "cwd": "C:\\Users\\<you>\\Documents\\Happierplus" },
  { "sessionId": "session-36bfd7be-...", "cwd": "C:\\Users\\<you>\\Documents\\project" }
]
```

`session/new` 返回可选的模型与推理强度：

```json
{
  "configOptions": [
    {
      "id": "model",
      "currentValue": "[\"deepseek-official\",\"deepseek-v4-flash\"]",
      "options": [
        { "group": "deepseek-account", "options": [
          { "value": "[\"deepseek-account\",\"deepseek-flash\"]", "name": "DeepSeek-V4.1-Flash" },
          { "value": "[\"deepseek-account\",\"deepseek-v4-pro\"]", "name": "DeepSeek-V4-Pro" }
        ]}
      ]
    },
    { "id": "reasoning_effort", "currentValue": "high" }
  ]
}
```

实测结果汇总：

| 测试 | 结果 |
|---|---|
| `initialize` | ✅ 成功，声明 list/resume/close |
| `session/new` | ✅ 成功，返回 model / reasoning_effort |
| `session/set_config_option` | ✅ 可切到 `deepseek-account/deepseek-flash` |
| `session/prompt` | ✅ 流式返回 `PONG`，`stopReason=end_turn` |
| `session/request_permission` | ✅ 在 `DSH_PERMISSION_MODE=read-only` 下真实触发，选项 `allow-once`/`reject-once` |
| `session/list` | ✅ 27 个，含桌面端创建的会话 |
| `session/resume` | ✅ 对桌面端旧会话成功，返回历史恢复后的 configOptions |
| `session/load` | ❌ `-32601 Method not found` |
| 图片输入 | ❌ `promptCapabilities.image=false`（即使切到 v4-pro 也为 false） |

### 2.3 DSH 会话日志（这是“监听现有会话”的钥匙）

会话存储：

```
C:\Users\<you>\.dsh\sessions\<cwd-hash>\session-<uuid>\session.v4.jsonl.zstd
```

- 文件是**多个 zstd frame 首尾相接**（不是单个 frame，也不是 gzip）。
- Node 自带的 `zstdDecompressSync` 只解第一帧，流式解压会报 `Unknown frame descriptor`。
- `fzstd`（纯 JS）可以一次解完：实测 3MB 压缩 → 9.1MB、**4268 条事件**。
- 事件是 JSONL，类型包括：

```text
session, turn/start, step/start, user/message, assistant/message,
tool/call, tool/result, todo/write, deliverables/presented,
workspace/changes, session/title, turn/end, agent/inbox/spliced,
permission/preset, sandbox/mode, approval/policy, command/run ...
```

`assistant/message` 里带结构化 content（`reasoning`、`text`、`tool-call`），`tool/result` 带结果；`todo/write`、`deliverables/presented`、`workspace/changes` 可以直接映射成手机端的卡片。

这意味着：**即使桌面端正在跑，手机也能通过“读日志 + tail”实时看到根会话的消息、工具调用和最终结果**，不需要接管进程。

### 2.4 Happier 与本方案的差距

| 差距 | 影响 | 解决 |
|---|---|---|
| Happier 只认 `session/load` | DSH 只支持 `session/resume`，直接配 Custom ACP 无法续接 | 桥接层把 `session/load` 翻译成 `session/resume` |
| Custom ACP 不声明 session listing | App 里没有“浏览 DSH 会话”的入口 | Fork 加一等公民 provider，或先让用户粘贴 ID |
| DSH 的 `session/resume` 不回放历史 | 续接后手机上看不到旧消息 | 桥接层读 JSONL 合成 `session/update` 回放 |
| DSH ACP 不提供 title/plan/todo | Happier 通用 UI 不显示这些卡片 | 日志直读映射（Phase 5） |
| 桌面端运行中的会话不能双写 | 手机不能审批桌面会话 | 只读跟随；Phase 7 插件 |
| 手机端没有“清理缓存”入口 | P1 需求缺口 | Fork 加 Settings → Storage |
| 自建 App 需要自己的推送凭证 | 否则收不到推送 | 先用官方 App；fork 时配 FCM/APNs |

### 2.5 与你原始判断的差异（重要修正）

1. **不需要装 `@dsh-enhanced/acp` 或任何 ACP 插件。** DSH 桌面安装包已经自带 `acp` profile，`dsh --profile acp` 直接可跑。少一个依赖，也少一个版本兼容风险。
2. **真正的坑不是“体验素”，而是 `session/load` 缺失。** DSH 只实现 `session/resume`，Happier 只会调 `session/load`；不写桥，续接一定失败。这是 Phase 1 必须做的原因。
3. **“监听现有会话”要拆成两件事。** 历史会话可以 `resume` 后继续；桌面端**正在运行**的会话不能被 ACP 接管，只能读日志做只读跟随。手机审批只对“Happier/桥启动的会话”成立。
4. **Happier 的 Custom ACP resume 能力文档与源码不一致。** 源码有 `supportsLoadSession` 开关和 UI 开关，但 feature matrix 仍标 “—”。Phase 2 必须真机验证，不能只看文档。
5. **通知不需要自己接微信/Telegram。** Happier 自带 Expo Push + Allow/Deny 按钮；自托管 relay 也能用官方 App。只有 fork 出独立包名时，才需要自己配 FCM/APNs。
6. **Codex 侧不用开发。** Happier 已原生支持 Codex（含历史会话浏览）；本方案的工作量集中在 DSH 接入、跨机聚合、品牌与体验。

---

## 3. 可行性矩阵

| 需求 | 可行性 | 采用方案 | 主要风险 |
|---|---|---|---|
| DSH 完成通知 | 高 | Happier 原生通知 + ACP 桥 | DSH 版本升级导致 ACP 字段变化 |
| 手机批准/拒绝 | 高 | ACP `request_permission` | 仅对桥启动的会话有效 |
| 续接/发消息 | 高 | ACP `prompt` + `resume` | 运行中的桌面会话不可写 |
| 结束后开新会话 | 高 | Happier new session | 目录选择/权限 |
| 多机汇聚 | 高 | 每机 daemon + relay | 公网 relay 运维 |
| 公网/E2E | 高 | 自托管 relay + Tailscale/Caddy | 证书、WebSocket、防火墙 |
| 浏览历史会话 | 中 | Fork + ACP list / 日志索引 | Happier direct-session 框架复杂度 |
| 历史消息回放 | 中 | JSONL 解析 + ACP update 合成 | v4 格式变更 |
| 附件/图片结果 | 中 | Happier 文件浏览器 + 资源链接 | ACP image=false，内联图需额外映射 |
| 缓存清理 | 高 | Fork 加设置页 | 需要移动端文件系统 API |
| 桌面运行中会话审批 | 低 | DSH 进程内插件（Phase 7） | 插件 API 未公开、稳定性未知 |
| 子 agent 过滤 | 高 | 过滤 `delegationDepth>0` | 事件字段变化 |

---

## 4. 总体架构

### 4.1 三种方案对比

| 维度 | A. 原版 Happier + ACP 桥 | B. Fork + 一等公民 provider | C. DSH 进程内插件 |
|---|---|---|---|
| 上线时间 | 2–3 周 | 8–12 周 | 12 周+，高风险 |
| P0 | ✅ | ✅ | ✅ |
| 浏览现有会话 | ❌（粘贴 ID） | ✅ | ✅ |
| 桌面运行中会话只读 | ✅（日志） | ✅ | ✅ |
| 桌面运行中会话审批 | ❌ | ⚠️ 仍需插件 | ✅ |
| 品牌/上架 | ❌ | ✅ | ✅ |
| 维护成本 | 低 | 中高 | 高 |
| 推送凭证 | 复用官方 App | 自建 FCM/APNs | 自建 |
| 建议 | **先做** | **Phase 4 再做** | **Phase 7 可选** |

### 4.2 推荐：双平面 + 三阶段演进

**控制平面（Control Plane）**

```
手机 App → Happier Relay → Happier Daemon → dsh-acp-bridge → dsh --profile acp → DSH Agent
```

负责：新建会话、发消息、审批、取消、续接、模型切换。

**观测平面（Observe Plane）**

```
手机 App ← Happier Relay ← Happier Daemon ← DSH 会话日志（只读 tail）
```

负责：列出历史会话、标题、目录、历史消息、todo、交付物、运行中会话的实时跟随。

两个平面用同一个 `sessionId` 关联。控制平面写、观测平面读；互不抢锁。

### 4.3 组件图

```
┌──────────────────────────── 手机 (Happier App) ────────────────────────────┐
│  会话列表（按机器分组） · 审批 Inbox · 推送 Allow/Deny · 文件预览 · 缓存设置  │
└───────────────────────────────────▲─────────────────────────────────────────┘
                                    │ WSS + E2E（服务端只见元数据）
                         ┌──────────┴──────────┐
                         │   Happier Relay     │  VPS / Tailscale / Docker
                         │  （内容不可读）      │
                         └──────────▲──────────┘
                                    │ 出站长连接（无需公网入站）
        ┌───────────────────────────┴─────────────────────────────┐
        │ PC-01                                                    │
        │  Happier Daemon                                          │
        │    ├─ dsh-acp-bridge ──stdio──> dsh --profile acp        │
        │    │     └─ 读 ~/.dsh/sessions（回放/标题）              │
        │    └─ direct-session watcher ──> ~/.dsh/sessions (tail)  │
        └──────────────────────────────────────────────────────────┘
        ┌──────────────────────────────────────────────────────────┐
        │ PC-02 / Mac / Linux devbox（同样一套）                    │
        └──────────────────────────────────────────────────────────┘
```

### 4.4 仓库规划

建议 4 个仓库（也可以先 monorepo）：

| 仓库 | 内容 | 语言 |
|---|---|---|
| `harnesslink-bridge` | ACP 桥、日志解析、安装器、协议测试 | TypeScript/Node 22 |
| `happier`（fork） | 一等公民 `dsh` provider、direct session、缓存页 | TypeScript/Expo |
| `harnesslink-deploy` | relay 的 docker-compose、Caddy/Tailscale、备份 | YAML/Shell |
| `harnesslink-docs` | 用户手册、故障排查、版本矩阵 | Markdown |

命名只是占位，避免使用 DeepSeek 商标做 App 名（见 10.6）。

---

## 5. 详细设计

### 5.1 `dsh-acp-bridge`（Phase 1 的核心）

#### 5.1.1 它到底是什么

一个 **stdio ACP v1 agent**：Happier 以为它在跟一个普通 ACP agent 说话，实际上它在跟 DSH 说话。

```
Happier Daemon ──spawn──> dsh-acp-bridge ──spawn──> dsh --profile acp
                     ACP JSON-RPC                    ACP JSON-RPC
```

为什么不让 Happier 直接连 `dsh --profile acp`？因为中间要补 4 个洞：

1. `session/load` → `session/resume` 翻译；
2. 历史回放（DSH resume 不 replay）；
3. stdout 过滤（DSH 的 `llm-deepseek-account` 会往 stdout 打日志，见附录 A.6）；
4. 默认模型/权限模式/标题/错误归一化。

#### 5.1.2 方法映射

| Happier → Bridge | Bridge → DSH | 说明 |
|---|---|---|
| `initialize` | `initialize` | 透传，补 `agentInfo` |
| `session/new` | `session/new` | 可选 `set_config_option` 应用默认模型 |
| `session/load` | `session/resume` | 核心翻译；失败返回明确错误 |
| `session/resume` | `session/resume` | 透传 |
| `session/list` | `session/list` | 补 title/updatedAt |
| `session/prompt` | `session/prompt` | 文本/资源链接；图片按能力降级 |
| `session/cancel` | `session/cancel` | 透传 |
| `session/close` | `session/close` | 透传 |
| `session/set_config_option` | 同名 | 模型/推理强度 |
| `session/update` | 同名 | 过滤 + 去重 + 资源链接映射 |
| `session/request_permission` | 同名 | `allow-once` / `reject-once` |
| `fs/*`、`terminal/*` | 不支持 | 返回 method not found，Happier 会走文件桥 |

**关键细节**：桥必须在 `initialize` 响应里把 `agentCapabilities.loadSession` 置为 `true`（上游 DSH 没有这个能力，但桥实现了 `session/load`）。否则 Happier 的 `getNegotiatedSessionLoadSupport()` 会判定未协商，即使 Custom ACP 后端勾了 “Supports session resume”，也不会真正调用 `session/load`。同时保留 DSH 的 `sessionCapabilities.list/resume/close` 和 `promptCapabilities`，不要伪造 `image=true`。

这一点在 Happier 的 `createConfiguredAcpResumePolicy.test.ts` 里有明确断言：只有“catalog 声明 + 运行时协商”同时为真，才会持久化 `customAcpSessionId` 并允许续接。

#### 5.1.3 代码骨架

```ts
// src/bridge.ts（示意，不是最终实现）
import { spawn } from 'node:child_process';
import readline from 'node:readline';

const upstream = spawn(dshBin, ['--profile', profile, ...extraArgs], {
  cwd,
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  stdio: ['pipe', 'pipe', 'pipe'],
  windowsHide: true,
});

const pendingLoad = new Map<number, any>();

// Happier → DSH
process.stdin.on('data', (chunk) => {
  for (const msg of parseNdjson(chunk)) {
    if (msg.method === 'session/load') {
      pendingLoad.set(msg.id, msg);
      upstream.stdin.write(ndjson({
        jsonrpc: '2.0', id: msg.id, method: 'session/resume', params: msg.params,
      }));
    } else {
      upstream.stdin.write(ndjson(msg));
    }
  }
});

// DSH → Happier
readline.createInterface({ input: upstream.stdout }).on('line', async (line) => {
  if (!line.startsWith('{')) return logToStderr(line);   // 关键：过滤非 JSON
  const msg = JSON.parse(line);
  if (msg.id && pendingLoad.has(msg.id)) {
    const req = pendingLoad.get(msg.id);
    pendingLoad.delete(msg.id);
    await replayHistory(req.params.sessionId);            // 先回放
    process.stdout.write(ndjson({ ...msg, id: req.id })); // 再响应 load
    return;
  }
  process.stdout.write(ndjson(msg));
});
```

#### 5.1.4 历史回放

`session/resume` 只恢复状态、不回放旧 update。桥在响应 `session/load` 前，读取：

```
%USERPROFILE%\.dsh\sessions\<cwd-hash>\session-<id>\session.v4.jsonl.zstd
```

用 `fzstd` 解压，按顺序把事件转成 ACP `session/update`：

| DSH 事件 | ACP update |
|---|---|
| `user/message` | `user_message_chunk` |
| `assistant/message` → `reasoning` | `agent_thought_chunk` |
| `assistant/message` → `text` | `agent_message_chunk` |
| `assistant/message` → `tool-call` | `tool_call`（pending） |
| `tool/result` | `tool_call_update`（completed/failed） |
| `todo/write` | `plan`（或 `_meta`） |
| `deliverables/presented` | `resource_link` |
| `session/title` | `session_info_update` |
| `turn/end` | 结束当前回放批次 |

限制：默认最多回放最近 N 条（例如 2000 条 / 5MB），避免大日志拖慢首屏；可在配置里调。

#### 5.1.5 stdout 纯净性

实测 DSH 在 `session/resume` 后会往 stdout 打：

```
[llm-deepseek-account] model listing from https://api.deepseek.com/models loaded 2 model(s), skipped 0 row(s)
```

严格 ACP 客户端会把它当协议错误。桥必须：

- 只把以 `{` 开头的行转发给 Happier；
- 其余写 stderr 或日志文件；
- 对上游 JSON 解析失败做容错，不崩溃。

Happier 自身有 `createAcpFilteredStdoutReadable.ts`，但桥不能依赖它，必须自己干净。

#### 5.1.6 默认模型与权限

- DSH 的 `acp` profile 默认是 `deepseek-official/deepseek-v4-flash`，没有 API key 时首个 prompt 会失败。桥在 `session/new` 后自动 `set_config_option` 到 `deepseek-account/deepseek-flash`（可配置），或在 profile patch 里改默认。
- 权限：`DSH_PERMISSION_MODE` 控制 DSH 的沙箱/审批策略。桥默认 `workspace-write`；需要“每个工具都问”时设 `read-only`。Happier 的会话级权限模式在 Custom ACP 路径下不能直接映射，Phase 4 再补。
- 图片：DSH 当前 `image=false`。手机发图走 Happier 的“附件落盘 + 路径告诉 agent”机制即可，不依赖 ACP 图片块。

#### 5.1.7 并发、崩溃与重启

- Happier 每个会话起一个桥进程；DSH 进程 ~1–3 秒启动，内存 ~100–200MB。10 个并发会话要预留 2GB。
- 桥监听 DSH 退出：把未决请求回 `-32000`，然后退出；Happier 会显示会话错误，用户可重试。
- 桥要处理 `SIGINT/SIGTERM`，先 `session/close` 再杀进程，避免会话锁残留。
- 启动锁：DSH 会话有“occupied”保护；桥在 `resume` 失败时返回可读错误（“该会话正在桌面端运行”），不要静默新建。

#### 5.1.8 安装与打包

- npm 包：`@harnesslink/dsh-acp-bridge`；
- Windows shim：`%LOCALAPPDATA%\HarnessLink\bin\dsh-acp-bridge.cmd`；
- 安装器：检测 DSH 安装路径、Node 版本、写 Happier Custom ACP 配置；
- 单文件二进制（可选）：Node SEA / `pkg`，避免用户装 Node。

#### 5.1.9 技术选型

| 选项 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| Node/TypeScript | 与 Happier、ACP SDK 同生态；类型直接复用；开发快 | 目标机需 Node，或打包二进制 | **首选** |
| Go | 单文件、启动快、跨平台 | 要重写 ACP 类型；与 Happier 生态远 | 备选（只做代理层） |
| Rust | 性能/体积最好 | 开发慢；团队成本高 | 不推荐 MVP |
| Python | 脚本快 | 依赖重；Windows 打包麻烦 | 不推荐 |

MVP 用 Node 22 + TypeScript；安装器检测 Node，缺失则引导安装或使用打包好的单文件。

### 5.2 Fork Happier：一等公民 `dsh` provider

#### 5.2.1 需要改哪些文件

| 层 | 文件 | 改动 |
|---|---|---|
| 协议 | `packages/protocol/src/providers/...` | 增加 `dsh` provider id / flavor |
| Manifest | `packages/agents/src/manifest.ts` | 新条目：resume、sessionListing、media、tools |
| ACP 常量 | `packages/agents/src/acp.ts` | 命令、能力、MCP 处理 |
| CLI backend | `apps/cli/src/backends/dsh/` | backend/transport/runtime/catalog |
| CLI 探测 | `apps/cli/src/capabilities/deps/dsh.ts` | 检测 DSH 安装、版本、登录 |
| Direct sessions | `apps/cli/src/backends/directSessions/dsh*` | list/read/follow/import |
| UI provider | `apps/ui/sources/agents/providers/dsh/` | core/ui/uiBehavior/settings/icon |
| 注册表 | `apps/ui/sources/agents/registry/*` | 注册新 provider |
| i18n | `apps/ui/sources/text/translations/*` | 名称、错误、设置文案 |
| 缓存页 | `apps/ui/sources/app/(app)/settings/storage.tsx` | 新增清理入口 |

#### 5.2.2 Manifest 关键字段（示意）

```ts
dsh: {
  id: 'dsh',
  cliSubcommand: 'dsh',
  flavorAliases: ['deepseek-harness', 'dsh'],
  resume: { vendorResume: 'supported', vendorResumeIdField: 'dshSessionId' },
  sessionStorage: { direct: true, persisted: true },
  sessionCapabilities: {
    sessionListing: 'supported',
    sessionListingSource: 'acp',
    sessionFork: { conversation: 'unsupported', fromMessage: 'unsupported' },
    sessionRollback: { conversation: 'unsupported' },
  },
  tools: { delivery: 'native_mcp', support: 'supported' },
  media: {
    acceptsImageInput: 'experimental',
    emitsSessionMedia: GENERIC_SESSION_MEDIA_OUTPUT,
    nativeImageGeneration: NO_NATIVE_IMAGE_GENERATION,
  },
}
```

#### 5.2.3 CLI backend（示意）

```ts
// apps/cli/src/backends/dsh/acp/backend.ts
export function createDshBackend(opts) {
  return createAcpBackend({
    agentName: 'dsh',
    cwd: opts.cwd,
    command: resolveDshBridgePath(),   // 或 dsh.cmd
    args: [],
    env: {
      DSH_PROFILE: 'acp',
      DSH_PERMISSION_MODE: mapPermissionMode(opts.permissionMode),
    },
    transportHandler: new DshTransport(),
    declaredSessionLoadSupport: true,  // 桥实现了 load
  });
}
```

#### 5.2.4 UI 效果

- 新建会话时 backend 选择器出现 **DeepSeek Harness**；
- 模型选择器显示 `DeepSeek-V4.1-Flash` / `DeepSeek-V4-Pro` / `Reasoning effort`；
- 会话列表出现 **Browse sessions**，列出 `~/.dsh/sessions` 的历史会话（标题、目录、更新时间）；
- 选中后续接，手机看到历史消息；
- 权限模式选择 `Read-only / Workspace / Full access`，映射到 `DSH_PERMISSION_MODE`。

#### 5.2.5 Fork 维护策略

- 从 Happier `dev` 拉分支，保持 `upstream/dev` 只读；
- 所有改动按“provider 插件化”组织，尽量不改公共协议；
- 每个 Phase 结束 rebase 一次，跑 Happier 自带 typecheck/单测；
- 优先把 `dsh` provider 做成可上游合并的 PR（Happier 已有 19 个 agent，新增一个是合理诉求）；
- 如果上游合并，fork 只保留品牌/缓存页/CI 差异，维护成本大降；
- 用 `git rerere` + 小 commit，避免大段冲突。

### 5.3 会话日志直读（观测平面）

#### 5.3.1 列表

扫描：

```
%USERPROFILE%\.dsh\sessions\*\session-*\session.v4.jsonl.zstd
```

每个会话读：

- 第一帧 `session` 事件 → `cwd`、`createdAt`、`delegationDepth`；
- 最后一个 `session/title` → 标题；
- 文件 mtime → `updatedAtMs`；
- `turn/end` 是否存在且晚于 `turn/start` → 运行/空闲。

#### 5.3.2 跟随

- `fs.watch` 监听文件变化；
- 记录已解压字节偏移；
- 新数据用 `fzstd` 流式解；
- 只处理 `delegationDepth === 0` 的根会话；
- 对 `assistant/message`、`tool/result`、`turn/end` 做增量映射。

#### 5.3.3 映射到 Happier 消息

Happier 已有 canonical tool 类型和消息模型。建议：

| DSH | Happier |
|---|---|
| `user/message` | user message |
| `assistant/message.text` | assistant message |
| `assistant/message.reasoning` | thinking block |
| `tool-call` | tool call（name/arguments） |
| `tool/result` | tool result |
| `todo/write` | todo card |
| `deliverables/presented` | attachment/resource card |
| `workspace/changes` | changed-files 摘要 |
| `turn/end.reason` | turn status（completed/cancelled/error） |

#### 5.3.4 接管/导入

- 会话空闲：调用 ACP `session/resume` 接管，手机可写；
- 会话运行中：只读跟随，UI 显示“桌面端正在运行”；
- 导入：把日志回放成 Happier 消息，后续用 ACP 续接；
- 子 agent：`delegationDepth>0` 或 `parentSessionId` 非空 → 过滤。

### 5.4 通知、审批、权限

Happier 的推送链路：

```
CLI/daemon → 读服务端 push tokens → Expo Push → FCM/APNs → 手机
```

- 完成通知：`ready`，可带摘要；建议 DSH 桥把最后一段 assistant 文本作为 summary；
- 审批通知：`permission_request`，手机带 `Allow` / `Deny`；
- 用户提问：`user_action_request`，带 `Answer`；
- 隐私：设置里关闭 preview，锁屏不显示代码/路径；
- 多服务器：通知里带 serverId，App 自动切服务器。

注意：通知由 **Happier CLI** 发，不是桥直接发。桥只要正确结束 ACP prompt，Happier 就会判定 turn 完成。

### 5.5 多机、公网、E2E

- **每台 PC**：DSH + Happier CLI + daemon + 桥；同一个账号；
- **relay**：VPS 上 Docker 单容器（SQLite + 本地文件），Caddy 终止 TLS，或 Tailscale Serve；
- **手机**：官方 App 里填 relay URL；
- **E2E**：Happier 默认内容加密，服务端只见 session id、时间、turn 状态、用量；
- **入站**：PC 不需要公网 IP，daemon 出站长连接；
- **离线**：单台机器离线，其他机器照常；Happier 会话仍可读（内容已同步），direct 会话不可读；
- **机器标识**：会话标题加 `[PC-01]` 前缀，或在 App 里按 machine 分组。

### 5.6 附件与缓存

**手机 → DSH**

Happier 把附件上传到工作区 `.happier/uploads`（或 OS temp），消息里给绝对路径；DSH 用文件工具读取。即使 ACP `image=false` 也能用。

**DSH → 手机**

- 产出文件在工作区：Happier 文件浏览器可打开/下载；
- 图片内联：需要 ACP `resource_link` 或日志里的 `deliverables/presented` 映射；
- 文档：Happier 支持 Markdown/图片/PDF 预览，Office 走 DSH 的 `office-to-pdf` 或手机端预览。

**缓存清理（P1 缺口）**

Happier 源码里没有找到面向用户的缓存清理页（只有开发者页的 “Clear Cache” 和语音缓存设置）。Fork 增加：

```
Settings → Storage
  ├─ 图片缓存   123 MB   [清理]
  ├─ 文件缓存    45 MB   [清理]
  └─ 全部缓存            [清理]
```

实现：`expo-file-system` 的 `cacheDirectory` + `expo-image` 的磁盘缓存；清理只删本地，不影响服务端/工作区文件。

### 5.7 兼容性与版本策略

- DSH 桌面 44.7.0 / npm 0.2.1-rc.5；ACP 协议 v1；
- 桥启动时执行 `dsh --version`（或读安装目录 `version`），记录到日志；
- 对 `session/list`、`resume` 做契约测试；
- DSH 升级后跑 `golden` 测试：initialize caps、list、new、prompt、permission、resume；
- Happier 升级后跑 Custom ACP 配置兼容测试；
- 版本矩阵写进 README：DSH 44.x / Happier 0.2.x / Bridge 1.x。

### 5.8 产品与交互设计

**信息架构（底部 4 Tab）**

```
Inbox（待办） | Sessions（会话） | Machines（机器） | Settings（设置）
```

- **Inbox**：跨机器聚合“需要你”的项——权限请求、agent 提问、失败/中断、@你 的消息。每条带机器徽标、agent 徽标、风险等级、剩余时间。
- **Sessions**：按机器分组；每组显示在线状态；会话卡片显示标题、cwd 末级目录、agent、最后一条消息摘要、未读数、运行中动画。
- **Machines**：机器名、OS、在线/离线、daemon 版本、DSH 版本、最近心跳；可重命名、重启 daemon、查看日志。
- **Settings**：服务器、通知、存储/缓存、Agent 配置、安全（生物识别锁）、关于。

**核心页面**

1. **会话详情**
   - 顶部：机器名 + agent + 状态（运行/空闲/离线）+ 更多菜单（重命名、复制 Session ID、结束）；
   - 中部：transcript（支持 Markdown、代码高亮、图片、文件卡片、todo/plan 卡片）；
   - 底部：composer（文本、附件、语音可选）+ 权限模式 chip + 模型 chip；
   - 运行中：显示“正在执行”，可排队/打断（取决于 DSH 能力）；
   - 桌面端运行中：显示“只读跟随”横幅，composer 禁用并解释原因。

2. **审批卡片**
   - 标题：`PC-01 · DSH · 写入文件`；
   - 详情：命令/路径/风险说明；
   - 按钮：`允许一次` / `拒绝`（不做“永远允许”，避免误点）；
   - 超时：显示倒计时；超时自动拒绝并通知。

3. **新建会话向导**
   - 机器 → 目录（最近/浏览）→ Agent（Codex/DSH/...）→ 模型 → 权限模式 → 首条消息；
   - 记住上次选择；支持“从历史会话复制配置”。

4. **存储设置**
   - 图片缓存、文件缓存、离线消息缓存；
   - 每项显示大小 + 清理按钮 + 二次确认；
   - “退出登录时清理”开关。

**状态设计**

- 空状态：没有机器 → 引导安装 daemon；没有会话 → “在电脑上运行 happier dsh 或从手机新建”；
- 离线：灰色机器徽标 + “消息将在恢复后同步”；
- 错误：可复制的错误码 + “查看日志” + “重试”；
- 弱网：乐观发送 + 发送中/失败重试标记。

**通知与深链**

- 点通知 → 直接进入 session + 定位到最新消息；
- 审批通知的 Allow/Deny 按钮 → 后台调用 API，失败时在 App 内提示；
- 多服务器：通知带 serverId，App 自动切换/提示添加服务器。

**设计约束**

- 单手可达：主要按钮在屏幕下半区；
- 3 击原则：从锁屏到“批准”不超过 3 次点击；
- 深色模式优先（夜间运维）；
- 中英双语（Happier 已有 i18n 框架）；
- 大字号/屏幕阅读器适配。

**数据模型（客户端视角）**

```ts
type Machine = { id: string; name: string; os: 'windows'|'macos'|'linux'; online: boolean; lastSeenAt: number; dshVersion?: string };
type Session = { id: string; machineId: string; agent: 'dsh'|'codex'|'claude'|'opencode'; title: string; cwd: string; status: 'running'|'idle'|'offline'|'error'; source: 'happier'|'direct'; updatedAt: number; unread: number };
type Approval = { id: string; sessionId: string; kind: 'permission'|'question'; tool?: string; risk: 'low'|'medium'|'high'; options: { id: string; label: string; kind: 'allow'|'reject' }[]; expiresAt?: number };
type Attachment = { id: string; sessionId: string; path: string; mime: string; size: number; cached: boolean };
```

---

## 6. 分阶段开发计划

> 估算按 1 名全栈 + 1 名兼职测试；如果你一个人做，取上限。

### Phase 0 — 可行性验证（3–5 天，已完成约 80%）

**目标**：证明 DSH ACP 能被标准客户端驱动。

- [x] 定位 `dsh --profile acp`；
- [x] initialize / new / prompt / permission / list / resume 实测；
- [x] 确认 `session/load` 缺失；
- [x] 确认会话日志格式与可解析性；
- [x] 确认 Happier Custom ACP / 通知 / 多机 / E2E 能力；
- [ ] 用 Happier 真机跑通一次（需要 relay + 手机）。

**交付**：`docs/feasibility.md` + 实测脚本。
**退出条件**：P0 happy path 在单机成立。

### Phase 1 — ACP 桥 MVP（10 个工作日）

**目标**：Happier 能像用 Codex 一样用 DSH。

任务：

1. 仓库/工程：TypeScript、Node 22、Vitest、ESLint；
2. ndjson 双向代理 + stdout 过滤；
3. `session/load` → `session/resume`；
4. 历史回放（fzstd + 事件映射）；
5. 默认模型/推理强度；
6. 权限请求映射；
7. 错误归一化 + 退出清理；
8. Windows `.cmd` shim + macOS/Linux 启动脚本；
9. 配置加载（`~/.harnesslink/config.json`）；
10. 契约测试（mock DSH + 真实 DSH 可选）。

**交付**：npm 包 + 安装脚本 + 协议测试报告。
**验收**：

- Happier 新建 DSH 会话 → 发 “hello” → 收到回复；
- 切模型 → 生效；
- 触发 read-only 写入 → 手机收到审批 → Allow 成功 / Deny 失败；
- `session/load` 一个旧会话 → 能看到历史 + 继续对话；
- DSH 打日志到 stdout 时桥不崩。

### Phase 2 — 单机端到端 + 手机验收（5 天）

**目标**：一台 Windows + 一台手机，P0 全通。

任务：

1. 本机装 Happier CLI/daemon；
2. 本机跑 relay（Node 或 Docker）；
3. 手机装官方 Happier，填 relay URL；
4. 配 Custom ACP backend 指向桥；
5. 推送/审批/续接/新会话逐项验收；
6. 写用户手册 + 故障排查。

**验收清单**：

- [ ] 手机锁屏收到 DSH 完成推送；
- [ ] 点通知进入正确会话；
- [ ] 审批 Allow/Deny 生效；
- [ ] 断网重连消息不丢；
- [ ] 杀 daemon/桥后能恢复；
- [ ] 会话结束后能开新会话；
- [ ] 延迟 < 3 秒（局域网）。

### Phase 3 — 多机 + 公网 + E2E（5 天）

**目标**：两台电脑、5G 网络、E2E 可验证。

任务：

1. VPS 部署 relay（Docker + Caddy 或 Tailscale）；
2. 第二台电脑装 daemon；
3. 机器命名/分组/来源标识；
4. 离线/重连/弱网测试；
5. 安全核查：relay 数据库无明文、token 不落地、日志脱敏；
6. 备份/恢复/升级演练。

**验收**：

- [ ] 两台机器会话同列表、可区分；
- [ ] 5G 下可收可发；
- [ ] relay 停机后恢复，会话不丢；
- [ ] 数据库抽查无 prompt/回复明文。

### Phase 4 — Fork + 一等公民 provider（20 天）

**目标**：App 里原生出现 DSH，能浏览并续接历史会话。

任务：

1. Fork/分支策略（跟踪 `dev`，小步 rebase）；
2. `packages/agents` manifest；
3. CLI backend / transport / runtime / capability probe；
4. UI provider（core/ui/settings/icon/i18n）；
5. ACP `session/list` 浏览入口；
6. 模型/推理强度/权限模式映射；
7. 单元/契约/UI 测试；
8. Android APK CI 出包。

**验收**：

- [ ] 新建会话 backend 列表有 DeepSeek Harness；
- [ ] Browse sessions 能列出 27 个历史会话；
- [ ] 选中后续接，历史可见；
- [ ] 权限模式三档生效；
- [ ] APK 能装到真机。

### Phase 5 — Direct 会话跟随 + 历史 + 缓存（20 天）

**目标**：桌面端正在跑的会话也能在手机上看；补齐 P1。

任务：

1. 日志扫描/索引（title、cwd、mtime、运行状态）；
2. 全量解析 + 折叠成消息；
3. tail 跟随（增量 frame、断点续读）；
4. `todo` / `deliverables` / `workspace changes` 卡片；
5. 接管（空闲）/ 导入（历史）；
6. 子 agent 过滤；
7. Settings → Storage 缓存清理；
8. 大日志性能测试（>10MB、>5000 事件）。

**验收**：

- [ ] 桌面端启动的会话 2 秒内出现在手机；
- [ ] 运行中消息实时跟随；
- [ ] 历史会话标题/目录正确；
- [ ] 缓存可清理且不影响服务端；
- [ ] 子 agent 不出现。

### Phase 6 — 品牌、发布、硬化（10 天）

**目标**：可长期用的内测版。

任务：

1. 品牌/图标/启动图/包名；
2. Expo 项目 + FCM + APNs；
3. GitHub Actions：Android APK、iOS TestFlight、relay 镜像、bridge 发布；
4. 隐私政策/服务条款/开源声明；
5. 崩溃上报/日志/指标；
6. 升级/迁移/回滚；
7. 内测（TestFlight/Play internal）。

**验收**：

- [ ] 新用户 10 分钟内部署完成；
- [ ] 崩溃率 < 1%；
- [ ] 升级不丢会话；
- [ ] 应用商店/TestFlight 可安装。

### Phase 7（可选）— 桌面实时审批插件（30–40 天 R&D）

**目标**：手机审批桌面端已启动的会话。

思路：

- 在 `desktop` profile 装一个 DSH 插件；
- 插件订阅 `session/event`、`userApproval`；
- 通过本地 WebSocket 暴露给桥；
- 桥把它映射成 ACP `request_permission`；
- 风险：DSH 插件 API 未公开、版本变化、双写冲突。

**决策**：先做 2 周 spike；如果插件能稳定拿到审批事件再继续，否则砍掉。

### 6.1 甘特图（按周）

```
Week  1  2  3  4  5  6  7  8  9 10 11 12 13 14
P0    ██
P1       ██████████
P2                █████
P3                     █████
P4                          ████████████████████
P5                                              ████████████████████
P6                                                                  ██████████
P7（可选）                                                                     ██████████...
```

### 6.2 人力与工期

| 阶段 | 人日 | 累计 |
|---|---|---|
| P0 | 4 | 4 |
| P1 | 10 | 14 |
| P2 | 5 | 19 |
| P3 | 5 | 24 |
| P4 | 20 | 44 |
| P5 | 20 | 64 |
| P6 | 10 | 74 |
| P7（可选） | 30–40 | 104–114 |

**MVP（P0–P3）约 5 周（24 人日）；完整 P1 约 14–15 周（74 人日）；含 P7 约 21–23 周。**

---

## 7. 当前机器开发环境评估

### 7.1 硬件/系统

| 项 | 实测 | 评价 |
|---|---|---|
| OS | Windows 11 家庭版 10.0.26200 | 可用；Home 版没有完整 Hyper-V 管理器，但 WSL2 正常 |
| CPU | 14 逻辑核 | 足够 |
| RAM | 15.5 GB | 够写代码/跑服务；Android Gradle + 模拟器 + Metro 同时跑会紧 |
| 磁盘 | C: 215 GB 可用 | 足够（依赖 + SDK + 缓存约 25–35GB） |
| 虚拟化 | Hyper-V present | 可跑 WSL2 / Android 模拟器（WHPX） |
| WSL | Ubuntu，已安装，未启动 | 可做 Linux 服务端/CI 对齐 |

### 7.2 工具链现状

| 工具 | 状态 | 说明 |
|---|---|---|
| Node | v24.18.0 | Happier/Expo 推荐 22.x；建议装 Node 22 LTS |
| npm | 11.16.0 | 可用 |
| pnpm | 缺失 | Happier 用 yarn；DSH 插件才需要 pnpm |
| yarn | 缺失 | Happier 需要 yarn 1.22.22 |
| git | 2.55.0 | 可用 |
| Python | 3.12.7 | 可用（日志/脚本） |
| VS Code | 1.143.1 | 可用 |
| JDK | 缺失 | Android 构建需要 17 |
| Android SDK/adb | 缺失 | 需要 commandline-tools + platform 36 |
| Docker | 缺失 | relay 本地测试需要；也可用 Node 直接跑 |
| Rust | 缺失 | 只有 Tauri 桌面需要；手机端不需要 |
| gh | 缺失 | CI 管理可选 |
| DSH CLI | 不在 PATH | 安装包内有，桥可直接调用绝对路径 |
| Happier CLI | 未安装 | Phase 2 安装 |

### 7.3 本地 vs CI 能力矩阵

| 工作 | 本机 | CI | 建议 |
|---|---|---|---|
| 桥/日志解析开发 | ✅ | ✅ | 本地 |
| DSH 真实协议测试 | ✅（已装 DSH） | ❌（DSH 不随 CI 分发） | 本地 |
| Happier CLI/daemon | ✅（Node） | ✅ | 本地 |
| relay 服务端 | ✅（Node） | ✅ | 本地 + VPS |
| Android APK | ⚠️ 装 SDK 后可 | ✅ ubuntu | **CI 优先** |
| iOS IPA/TestFlight | ❌ | ✅ macOS runner / EAS | **CI** |
| 完整 UI 热更新开发 | ⚠️ 16GB 偏紧 | ❌ | 本地 + 真机 |
| 推送/审批真机测试 | ✅ 真机 | ❌ | 手动 |
| 弱网/公网测试 | ✅ | 部分 | 手动 |

### 7.4 建议安装清单

```powershell
# 1) Node 22 LTS（与 EAS 的 22.14.0 对齐）
winget install OpenJS.NodeJS.LTS

# 2) yarn 1.22（Happier 要求）
winget install Yarn.Yarn
# 或 npm i -g yarn@1.22.22 --prefix "$env:LOCALAPPDATA\npm"

# 3) JDK 17（Android Gradle）
winget install EclipseAdoptium.Temurin.17.JDK

# 4) Android SDK（不装完整 Android Studio 也可以）
winget install Google.AndroidStudio
# 或 commandline-tools + sdkmanager:
#   platform-tools, platforms;android-36, build-tools;36.0.0, ndk;27.1.12297006

# 5) Docker Desktop（relay 本地测试，可选）
winget install Docker.DockerDesktop

# 6) GitHub CLI（可选）
winget install GitHub.cli
```

预计占用：Node 0.1GB、JDK 0.3GB、Android SDK 8–12GB、Docker 2GB、依赖 5–8GB，合计 20–25GB；下载 1–3 小时（当前网络约 1–1.5MB/s）。

> 建议用 `fnm` 或 `nvm-windows` 管理 Node 22/24 双版本，不要直接覆盖现有的 Node 24；`corepack enable` 在本机因 `C:\Program Files\nodejs` 权限失败过，yarn 用 winget/npm 本地前缀安装更稳。

### 7.5 结论

- **本机适合做 Phase 0–3 的全部开发与验证**（桥、CLI、relay、协议）。
- **Phase 4 的 Android 构建**建议装 JDK/SDK 本地跑一次，之后交给 CI；16GB 内存下 Gradle 要限 `-Xmx4g`。
- **iOS 完全依赖 CI/EAS**，本机无法替代。
- **CI 不能替代交互式开发**，但能替代“编译/签名/出包/回归”这些重活；真机推送与审批必须人工。

---

## 8. CI/CD 与人工测试

### 8.1 为什么需要 CI

- Windows 本机没有 macOS，iOS 无法本地编译；
- Happier Monorepo 依赖重、原生模块多，CI 的干净环境更可靠；
- 签名/证书/推送凭证适合放 Secrets；
- 每次 PR 跑类型检查/单测，避免 fork 漂移；
- 出 APK/IPA 后可给测试人员直接下载。

### 8.2 Workflow 设计

| Workflow | Runner | 触发 | 产物 |
|---|---|---|---|
| `bridge-ci.yml` | ubuntu/windows/macos | push/PR | 测试报告 + npm 包 |
| `happier-ci.yml` | ubuntu | PR | typecheck + 单测 |
| `android-apk.yml` | ubuntu-latest | 手动/ tag | 签名 APK |
| `ios-testflight.yml` | macos-15 | 手动/ tag | IPA → TestFlight |
| `relay-image.yml` | ubuntu | tag | GHCR 镜像 |
| `e2e.yml` | ubuntu | nightly | relay + 2 daemon + mock ACP |
| `release.yml` | ubuntu | tag | GitHub Release |

### 8.3 Android APK（GitHub Actions 草图）

```yaml
name: android-apk
on:
  workflow_dispatch:
  push:
    tags: ['v*']

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22.14.0
          cache: yarn
      - uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: 17
      - uses: android-actions/setup-android@v3
      - run: yarn install --frozen-lockfile
      - run: yarn workspace @happier-dev/app prebuild
      - name: Build release APK
        working-directory: apps/ui/android
        run: ./gradlew assembleRelease -x lintVitalRelease -x lintVitalAnalyzeRelease
      - uses: actions/upload-artifact@v4
        with:
          name: app-release-apk
          path: apps/ui/android/app/build/outputs/apk/release/*.apk
```

签名：

- 生成 keystore，Base64 存 `ANDROID_KEYSTORE_BASE64`；
- `key.properties` 在 CI 临时生成；
- `google-services.json` 存 Secret（FCM 必需）。

### 8.4 iOS TestFlight（要点）

- Runner：`macos-15`；
- 需要 Apple Developer 账号（$99/年）；
- Secrets：证书 `.p12`、Provisioning Profile、App Store Connect API Key；
- 步骤：`yarn install` → `pod install` → `xcodebuild archive` → `exportArchive` → `xcrun altool --upload-app`；
- 或者用 EAS：`eas build --platform ios --profile preview`，需要 `EXPO_TOKEN`；
- TestFlight 内部测试不需要审核，适合快速迭代。

### 8.5 Relay 镜像

```yaml
- run: docker build -t ghcr.io/<org>/harnesslink-relay:${{ github.sha }} .
- run: docker push ghcr.io/<org>/harnesslink-relay:${{ github.sha }}
```

VPS 上 `docker compose pull && up -d`；数据卷 `/data` 持久化；Caddy 自动 TLS。

### 8.6 人工测试闭环

```
开发机 push → CI 构建 APK → artifact/Release 下载链接
   → 手机安装（adb install -r 或直接下载）
   → 按 checklist 测试
   → 录屏/日志回传 → 修 → 下一轮
```

P0 人工 checklist（每轮必跑）：

1. 两台机器在线，会话列表按机器分组；
2. 新建 DSH 会话，选模型，发消息，收到流式回复；
3. read-only 模式下触发写文件 → 手机推送 → Allow → 文件生成；
4. 再触发一次 → Deny → 工具失败，会话继续；
5. 任务完成推送，摘要与最后回复一致；
6. 杀 App/断网 30 秒 → 重连 → 消息补齐；
7. 结束后再发一条 → 会话继续；
8. 新建第二个会话 → 两个会话互不干扰；
9. 重启 daemon + 桥 → 旧会话可续接；
10. relay 数据库抽查：无明文 prompt/回复。

### 8.7 限制与注意事项

- GitHub Actions 的 macOS runner 按 10 倍分钟计费（私有库）；公开库通常免费但有并发限制；
- CI 里**不能**跑真实 DSH（许可/体积/登录态），只能用 mock 做协议测试；真实回归在开发机；
- 推送必须真机 + 真实 FCM/APNs 凭证，CI 只能构建；
- iOS 不能“免签名安装”到普通 iPhone；必须 TestFlight/Ad Hoc/企业签；
- Fork 的 App 需要自己的 Expo 项目与 FCM/APNs；沿用官方包名会签名冲突。

---

## 9. 测试计划

### 9.1 分层

| 层 | 内容 | 工具 |
|---|---|---|
| 单元 | ndjson 解析、事件映射、日志解码、配置 | Vitest |
| 契约 | 桥 ↔ mock ACP；桥 ↔ 真实 DSH（本地） | ACP SDK + 自写 mock |
| 集成 | Happier CLI + relay + 桥 + DSH | Node 脚本 / Playwright? |
| E2E | 手机 App + 真机推送 + 审批 | 手动 + Maestro/Detox（可选） |
| 安全 | 明文扫描、token 泄露、越权 | 脚本 + 人工 |
| 性能 | 10MB 日志、10 并发会话、弱网 | 压测脚本 |

### 9.2 关键用例

- `session/load` 一个桌面端会话，历史 100 条，回放顺序正确；
- DSH stdout 混入日志行，桥不崩；
- 权限拒绝后，DSH 工具失败但会话可继续；
- 桥进程被杀，Happier 显示错误并可重试；
- 同一会话被桌面端占用时，`resume` 返回可读错误；
- 子 agent 事件不进入手机；
- relay 重启后 daemon 自动重连；
- 大日志（>5000 事件）首屏 < 2 秒。

---

## 10. 风险登记册

| # | 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|---|
| 1 | DSH ACP 是 automation-only，版本升级改字段 | 中 | 高 | 版本探测 + 契约测试 + 桥隔离 |
| 2 | `session/load` 永远不支持 | 高 | 中 | 桥翻译；已实测可行 |
| 3 | 日志 v4 格式变化 | 中 | 中 | 版本字段 + 回退到 ACP list |
| 4 | 桌面端运行中会话不能审批 | 高 | 高 | 明确边界；Phase 7 插件 |
| 5 | Happier pre-release 频繁变动 | 高 | 中 | 小 diff、跟踪 dev、上游 PR |
| 6 | 自建 App 推送凭证复杂 | 高 | 中 | 先用官方 App |
| 7 | iOS 签名/上架 | 中 | 高 | TestFlight 内测；预算 Apple 账号 |
| 8 | Windows 路径/编码/杀进程 | 中 | 中 | `resolveWindowsCommandInvocation`、UTF-8、任务计划 |
| 9 | 16GB 内存不够 Android 构建 | 中 | 低 | CI 构建；Gradle 限内存 |
| 10 | 安全：token/明文泄露 | 低 | 高 | E2E、日志脱敏、最小权限、Tailscale |
| 11 | 法律/商标 | 低 | 中 | MIT 保留声明；不打包 DSH；不用 DeepSeek 商标 |
| 12 | 多写者冲突 | 中 | 高 | 会话锁 + 只读跟随 + 明确 UI |

---

## 11. 成本

| 项 | 费用 | 说明 |
|---|---|---|
| Apple Developer | $99/年 | iOS 真机/TestFlight 必需 |
| Google Play | $25 一次性 | 上架需要 |
| VPS | $5–20/月 | 2C2G 足够；Hetzner/OCI/阿里云 |
| 域名 | $10/年 | 可选，Tailscale 可省 |
| GitHub Actions | 公开库免费 | 私有库按分钟；macOS 10x |
| EAS | 免费档有限 | 可选，CI 自建可替代 |
| 测试机 | 已有 | Android 优先 |

---

## 12. 下一步（7 天）

**Day 1–2：把 Phase 0 收尾**

- 本机装 Happier CLI/daemon；
- 本机跑 relay（Node 或 Docker）；
- 手机装官方 App，填 relay 地址；
- 配 Custom ACP backend 指向一个最小桥（先只做 `load→resume` 透传）。

**Day 3–4：桥 MVP**

- ndjson 代理 + stdout 过滤；
- 默认模型；
- 权限映射；
- 真实 DSH 跑通 new/prompt/permission。

**Day 5：历史回放**

- fzstd 解日志；
- 回放最近 200 条；
- 续接旧会话能看到历史。

**Day 6–7：真机验收**

- 推送、Allow/Deny、断网重连、新会话；
- 记录问题清单；
- 决定是否进入 Phase 3（多机）或先 fork。

**本周需要的账号/资源**

- 一台 VPS（或先用 Tailscale）；
- 一部 Android 手机；
- 可选：Apple Developer（如果先做 iOS）。

---

## 附录 A：实测记录

### A.1 ACP initialize

```json
{"protocolVersion":1,"agentInfo":{"name":"deepseek-harness-acp","version":"0.0.1"},
 "agentCapabilities":{"mcpCapabilities":{"http":true},
 "promptCapabilities":{"image":false,"audio":false,"embeddedContext":false},
 "sessionCapabilities":{"close":{},"list":{},"resume":{}}},"authMethods":[]}
```

### A.2 session/list

27 个会话，示例：

```json
{"sessionId":"session-94d0345c-8c00-4972-90c1-ea15d69c11d1","cwd":"C:\\Users\\<you>\\Documents\\Happierplus"}
```

### A.3 new + set model + prompt

```text
[newSession] configOptions: model=deepseek-official/deepseek-v4-flash, reasoning_effort=high
[setModel]   currentValue=["deepseek-account","deepseek-flash"]
[update]     agent_message_chunk "PONG"
[prompt]     stopReason=end_turn
```

### A.4 permission

```json
{
  "sessionId": "ebf91b70-...",
  "toolCall": { "toolCallId": "call_00_..." },
  "options": [
    { "optionId": "allow-once", "name": "Allow once", "kind": "allow_once" },
    { "optionId": "reject-once", "name": "Reject", "kind": "reject_once" }
  ]
}
```

### A.5 load / resume

```text
[load]   ERR {"code":-32601,"message":"\"Method not found\": session/load"}
[resume] OK  configOptions restored
[list]   count 27
```

### A.6 stdout 噪声

```text
[llm-deepseek-account] model listing from https://api.deepseek.com/models loaded 2 model(s), skipped 0 row(s)
```

### A.7 日志解码

```text
compressed 3,066,093 bytes → 9,152,051 bytes, 4,268 events
types: session 1, turn/start 25, assistant/message 552, tool/call 579,
       tool/result 579, todo/write 2, deliverables/presented 1, ...
```

### A.8 复现脚本

本次调研的临时脚本都在 `.research/acp-test/`：

- `spike.mjs`：initialize → list → new → set model → prompt；
- `perm-spike.mjs`：`DSH_PERMISSION_MODE=read-only` 下触发 `request_permission`；
- `resume-spike.mjs`：验证 `session/load` 缺失、`session/resume` 可用；
- `acp-model.patch.yml`：把 ACP 默认模型改为 `deepseek-account/deepseek-v4-pro`。

运行前需 `npm i @agentclientprotocol/sdk fzstd`，并确保 DSH 已登录。

### A.9 尚未验证的项（Phase 2 必须打勾）

- [ ] Happier Custom ACP 的 `supportsLoadSession` 在真机上确实出现“续接”入口；
- [ ] ACP 权限请求在 Happier App 里能弹出 Allow/Deny 推送；
- [ ] DSH 生成的图片/文档在手机端的展示与缓存路径；
- [ ] 桌面端运行中会话的日志 tail 在 Windows 文件锁/缓冲下的实时性；
- [ ] iOS 真机 TestFlight 安装；
- [ ] 两台机器同时在线时的机器标识与冲突处理。

---

## 附录 B：配置样例

### B.1 DSH profile 默认模型

`%USERPROFILE%\.dsh\profiles\acp\cordis.patch.yml`（或启动时 `--patch`）：

```yaml
- id: acp
  config:
    provider: deepseek-account
    model: deepseek-flash
```

### B.2 Happier Custom ACP（概念）

```json
{
  "id": "dsh",
  "name": "dsh",
  "title": "DeepSeek Harness",
  "command": "C:\\Users\\<you>\\AppData\\Local\\HarnessLink\\bin\\dsh-acp-bridge.cmd",
  "args": [],
  "env": {
    "DSH_PROFILE": "acp",
    "DSH_PERMISSION_MODE": "workspace-write",
    "DSH_DEFAULT_MODEL": "deepseek-account/deepseek-flash"
  },
  "capabilities": {
    "supportsLoadSession": true,
    "supportsModels": "yes",
    "supportsConfigOptions": "yes",
    "promptImageSupport": "no"
  }
}
```

### B.3 桥配置

```json
{
  "dsh": {
    "command": "C:\\Users\\<you>\\AppData\\Local\\Programs\\DeepSeek Harness\\DeepSeek Harness.exe",
    "cliEntry": "C:\\Users\\<you>\\AppData\\Local\\Programs\\DeepSeek Harness\\resources\\app.asar\\dsh\\node_modules\\@deepseek-ai\\dsh-desktop-host\\lib\\cli.js",
    "profile": "acp",
    "extraArgs": []
  },
  "defaults": {
    "provider": "deepseek-account",
    "model": "deepseek-flash",
    "reasoningEffort": "high",
    "permissionMode": "workspace-write"
  },
  "history": { "replay": true, "maxEvents": 2000 },
  "logging": { "level": "warn" }
}
```

---

## 附录 C：文件地图

| 用途 | 路径 |
|---|---|
| DSH CLI | `%LOCALAPPDATA%\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd` |
| DSH 会话日志 | `%USERPROFILE%\.dsh\sessions\<hash>\session-<id>\session.v4.jsonl.zstd` |
| DSH 桌面配置 | `%APPDATA%\@deepseek-ai\dsh-desktop` |
| DSH profile | `%USERPROFILE%\.dsh\profiles\<name>` |
| Happier ACP backend | `apps/cli/src/agent/acp/` |
| Happier agents manifest | `packages/agents/src/manifest.ts` |
| Happier UI providers | `apps/ui/sources/agents/providers/` |
| Happier ACP schema | `packages/protocol/src/acpCatalog/settingsV1.ts` |
| Happier direct sessions | `apps/cli/src/backends/directSessions/` |
| Happier 通知 | `apps/cli/src/...` + `apps/server` push routes |

---

## 附录 D：参考资料

- Happier 仓库：https://github.com/happier-dev/happier
- Happier 文档：https://docs.happier.dev
- Custom ACP：https://docs.happier.dev/agents/custom-acp
- Agent capabilities：https://docs.happier.dev/agents/capabilities
- 通知：https://docs.happier.dev/extras/notifications-setup
- 自托管 Docker：https://docs.happier.dev/self-hosting/docker
- 继续会话：https://docs.happier.dev/sessions/continuing-a-session
- 自定义移动构建：https://docs.happier.dev/apps/custom-mobile-build
- DSH ACP 包：https://www.npmjs.com/package/@deepseek-ai/dsh-acp
- ACP 协议：https://agentclientprotocol.com

---

## 附：一句话决策

**先花 3 周用“原版 Happier + ACP 桥”把 P0 跑通；确认手机端体验值得投入后，再 fork 补 P1。**
