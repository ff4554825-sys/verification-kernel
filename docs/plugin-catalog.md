# 插件库清单 / Plugin Catalog

> 生成时间：2026-11-01  
> 范围：当前 `desktop` profile + `verification-kernel` 本地插件。  
> 重要：`@local/dsh-verification-kernel` **没有 GitHub remote**，它是本地 `link:` 插件；本清单不是 GitHub 仓库索引。

## 1. 当前 profile 已安装的插件

| 类别 | 插件 / Bundle | 版本 | 描述 | 状态 |
|---|---|---|---|---|
| 验证系统 | `@local/dsh-verification-kernel` | 0.1.0 | 确定性验证内核 + turn-stopping gate；`verification_run`、`knowledge_search`、auto-load、advisor、auto feedback | enabled / installed |
| Agent 预设 | `@local/dsh-verification-preset` | 0.1.0 | Verification agent preset，标准 coding toolset + accuracy-first persona | enabled / installed |
| Web UI | `@local/dsh-session-view` | 1.0.0 | Session overview view，在 DSH Web 对话里看会话概览 | enabled / installed |
| 浏览器 | `@local/dsh-browser-automation` | 0.1.0 | 独立 headless Edge 的 Playwright 浏览器自动化工具 | enabled / installed |
| IM 接入 | `@narratorz/dsh-im` | 4.38.0 | 微信/飞书/企微/钉钉/QQ/Telegram/WhatsApp/Slack/Discord/Matrix 接入 | enabled / installed |
| 会话管理 | `dsh-session-purge` | 0.5.6 | 会话删除回收站；可恢复，永久删除/保留策略回收空间 | enabled / installed |

## 2. Core / Web 基础 Bundle

这些是 profile 的系统底座，通常标为 `management-required`，不是普通可卸载插件。

| Bundle | 描述 |
|---|---|
| `@deepseek-ai/dsh-base` | DSH core profile bundle：LLM、session、agent、tools、sandbox、storage、telemetry 等 |
| `@deepseek-ai/dsh-web-app` | DSH Web surface bundle：Web UI、client modules、API controllers、web server、HMR 等 |

## 3. 可安装但当前未安装的官方实验 Bundle

| Bundle | 描述 | 当前 |
|---|---|---|
| `@deepseek-ai/dsh-experimental-auto-review` | Auto 权限预设的 per-tool LLM authorization review | 未安装 |
| `@deepseek-ai/dsh-experimental-inspector-profile` | raw session log / Chat node inspection Web bundle | 未安装 |
| `@deepseek-ai/dsh-experimental-agent-team-profile` | Agent Teams 协作、tools、Web UI | 未安装 |
| `@deepseek-ai/dsh-acp-app` | ACP automation-only JSON-RPC stdio profile | 未安装/disabled |
| `@deepseek-ai/dsh-headless` | 无 Host/HTTP/browser 的 one-shot 核心 runner | 未安装 |
| `@deepseek-ai/dsh-sdk-app` | SDK stdio JSON-RPC profile | 未安装 |
| `@deepseek-ai/dsh-sdk-minimal` | 最小 SDK profile，JSON-RPC + 一个 DeepSeek adapter | 未安装 |
| `@deepseek-ai/dsh-experimental-voice-input-bundle` | 本地 SenseVoice 语音输入 | 未安装 |
| `@deepseek-ai/dsh-experimental-cot-translation-bundle` | expanded reasoning 机器翻译 | 未安装 |
| `@deepseek-ai/dsh-experimental-badge-skill-bundle` | 给文档/PR 加 “powered by dsh” badge 的 skill | 未安装 |
| `@deepseek-ai/dsh-experimental-ralph-bundle` | 用户显式请求的重复工作，用 fresh agents 执行 | 未安装 |
| `@deepseek-ai/dsh-experimental-session-titles-bundle` | 每个新 human prompt 到达时刷新 session title | 未安装 |
| `@deepseek-ai/dsh-experimental-terminal-bundle` | 跨 tool call 保持 shell 进程 | 未安装 |
| `@deepseek-ai/dsh-experimental-session-search` | Agent 搜索/读取当前 workspace 的历史 session | 未安装 |
| `@deepseek-ai/dsh-experimental-tool-worktree` | 创建并进入新 Git worktree 的 model tool | 未安装 |
| `@deepseek-ai/dsh-experimental-plugin-market-bundle` | Discover tab：从 plugin market index 浏览/安装 bundle | 未安装 |
| `@deepseek-ai/dsh-subagent-claude-code` | Claude Code subagent | missing |
| `@deepseek-ai/dsh-subagent-codex` | Codex subagent | missing |

## 4. `verification-kernel` 内部模块分类

这不是多个 Cordis 插件；它是**一个插件包**，内部按职责拆模块。

### 4.1 Host 入口与工具

| 文件 | 说明 |
|---|---|
| `index.js` | Cordis Host plugin：注册 `verification_run`、`knowledge_search`、`agent/turn-stopping` gate、auto-load、advisor、auto feedback |
| `lib/kernel.js` | plan 校验、verdict 聚合、flaky/retry、gate ladder |
| `lib/dsh.js` | DSH config/project router、Host runner、工具渲染 |
| `lib/exec.js` | Node child_process runner |
| `lib/artifacts.js` | latest/history/trace/evidence、hash、redaction |

### 4.2 验证与证据

| 文件 | 说明 |
|---|---|
| `lib/outcomes.js` | append-only outcome JSONL、latency/cost proxy、checksDetail |
| `lib/calibration.js` | per-check reliability、p95、flaky/unknown、advisory 建议 |
| `lib/report.js` | trace metrics、verdict/flaky/override/latency |
| `lib/trace-export.js` | eval-friendly trace export |
| `lib/sign.js` | Ed25519 verdict signing/verification |
| `lib/contract.js` | acceptance contract validation |
| `lib/redact.js` | evidence secret redaction |

### 4.3 隔离与安全

| 文件 | 说明 |
|---|---|
| `lib/diff.js` | git diff + allow/deny/size scope audit |
| `lib/security.js` | Gitleaks/Semgrep/Trivy adapters |
| `lib/test-patch.js` | detached git worktree test-patch |
| `lib/test-patch-wsl.js` | WSL2 Linux test-patch |
| `lib/test-patch-docker.js` | network-disabled Docker test-patch |
| `lib/verify-wsl.js` | WSL2 独立验证边界（无网络、nobody、只读副本） |

### 4.4 L1 / L2 验证栈

| 文件 | 说明 |
|---|---|
| `lib/advisor.js` | L1 advisory critic：外部 command stdin/stdout JSON 或 heuristic fallback；不覆盖 L0 |
| `lib/trajectory.js` | heuristic trajectory critic |
| `lib/review.js` | read-only review packet；读取 `AGENTS.md`、`.agents/skills/custom-codereview-guide.md` 等 |
| `lib/pr-check.js` | L2 PR review + isolated QA test-patch |
| `lib/workflow.js` | resolve→execute→evidence→gate→report 五阶段 |

### 4.5 学习、检索与评测

| 文件 | 说明 |
|---|---|
| `lib/complexity.js` | git/snapshot 复杂度快路径 |
| `lib/knowledge.js` | SQLite FTS5 本地知识库，Latin + CJK bigram |
| `lib/local-learner.js` | 三因子本地 policy 更新 |
| `lib/feedback-loop.js` | knowledge_search → outcome 自动弱归因 |
| `lib/ab.js` | paired A/B + bootstrap CI |
| `lib/mutation.js` | mutation-based check-quality audit |
| `lib/benchmark.js` | patch-task benchmark runner |

### 4.6 CLI

| CLI | 用途 |
|---|---|
| `dsh-verify` | 直接跑验证计划 |
| `dsh-verification-workflow` | 五阶段 workflow |
| `dsh-calibrate` | outcome 校准 |
| `dsh-knowledge` | 构建/查询本地知识库 |
| `dsh-local-learn` | 本地三因子 policy 更新 |
| `dsh-ab` | paired A/B |
| `dsh-pr-check` | L2 PR review + QA |
| `dsh-verify-wsl` | WSL2 独立验证 |
| `dsh-test-patch` | worktree/WSL/Docker test-patch |
| `dsh-mutation` / `dsh-mutation-gate` | mutation 报告 / 阈值 |
| `dsh-outcomes` | outcome 汇总 |
| `dsh-security-audit` | 安全扫描 |
| `dsh-diff-audit` | diff scope 审计 |
| `dsh-critic` | 轨迹 critic |
| `dsh-review-packet` | review packet |
| `dsh-policy-check` | OPA 策略检查 |
| `dsh-benchmark` | benchmark runner |
| `dsh-export-trace` | trace 导出 |
| `dsh-verdict-verify` / `dsh-verification-keygen` | 签名验证/生成 |
| `dsh-verify-override` | human override |
| `dsh-verify-contract` | acceptance contract |
| `dsh-verify-report` | trace metrics |

### 4.7 Skills / Preset

| 名称 | 说明 |
|---|---|
| `verification-protocol` skill | accuracy-first 验证协议 |
| `repo-review` skill | 独立只读 review |
| `verification` preset | 标准 coding toolset + accuracy-first persona |

## 5. 数量说明

- 当前 profile：**206 个 plugin 行**，**26 个 bundle**；
- 其中真正以“可安装插件/bundle”形式存在的，是第 1–3 节列出的那些；
- 206 行里大量是 core/UI 内部组件（例如 `@deepseek-ai/dsh-client-ui-*`），不是 206 个独立 GitHub 项目；
- `verification-kernel` 是 **1 个插件包**，内部有 25+ 个模块和 20+ 个 CLI。

## 6. 关于 GitHub

- 当前 `verification-kernel` **没有 `.git`、没有 remote、没有公开 GitHub 仓库**；
- 若要在 GitHub 上做“插件库”，需要先：
  1. `git init` + 添加 `LICENSE` / `README` / `package.json`；
  2. 选择发布方式（npm package / GitHub release / plugin market index）；
  3. 加 `THIRD_PARTY_NOTICES.md`（Hermes/OpenHands 等 MIT 参考）；
  4. 用 CI 跑 `dsh-pr-check` + 测试；
  5. 再生成插件市场可读的 manifest/index。
