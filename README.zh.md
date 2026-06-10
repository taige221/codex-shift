# codex-model-router

在每次 Codex 请求开始前，先根据 prompt 判断任务复杂度，再选择 model 和 reasoning effort。

## 作用边界

Codex 的 model 和 effort 是请求参数，必须在一次 turn 开始前确定。本项目在 Codex 前面加一层 wrapper/proxy：

```text
prompt -> router -> model/effort -> Codex transport
```

支持三种主要路径：

- `exec`：生成并运行 `codex exec -m ... -c model_reasoning_effort=...`
- `app-server`：改写 app-server `turn/start` 请求，按 turn 注入 `model`、`effort`、`summary`
- `tui`：启动原生 Codex TUI，并通过本地 app-server proxy 路由每一轮连续对话

不能做到：

- 不能修改已经开始生成的那一轮 response
- 不能无缝修改已经打开的 Codex Desktop 会话
- 不能迁移模型内部 reasoning state

## 安装

```bash
npm install
npm link
```

会暴露这些命令：

- `codex-shift`
- `codex-router`
- `codex-shift-hud`
- `codex-shift-shim`

## 推荐用法

连续 TUI 自动切 effort：

```bash
codex-shift tui
codex-shift tui --hud
codex-shift tui --hud-verbose
```

带原生 Codex 参数：

```bash
codex-shift tui -- --no-alt-screen
codex-shift tui -- --no-alt-screen -C /Users/pengfeihao/code/codex-shift
```

只看路由结果，不执行：

```bash
codex-router route "解释一下这个函数"
codex-router dry-run "fix this failing test"
codex-router dry-run --json "review改修这个 PR"
```

单次 routed exec：

```bash
codex-shift exec "fix this failing test"
codex-shift exec --effort high "review改修这个 PR"
codex-shift exec --cwd /Users/pengfeihao/code/codex-shift "fix this failing test"
```

app-server turn：

```bash
codex-shift turn --thread <thread-id> "fix this failing test"
codex-shift dry-run --transport app-server --thread <thread-id> "fix this failing test"
```

查看 HUD：

```bash
codex-shift hud
codex-shift hud --once
codex-shift hud --verbose
codex-shift-hud --file /tmp/codex-shift-current.json
```

## TUI 与 HUD

`codex-shift tui` 的进程结构：

```text
native Codex TUI --remote ws://127.0.0.1:<proxyPort>
  -> codex-shift proxy
  -> real codex app-server --listen ws://127.0.0.1:<realPort>
```

proxy 会改写 `turn/start`，注入本轮选择的 `model`、`effort`、`summary`。

TUI 模式下还会补齐缺失或为 `null` 的 `thread/list.cwd`，让 `/resume` 默认按启动目录过滤。`resume --all` 会禁用这个 cwd filter。

HUD 相关命令：

```bash
codex-shift tui --hud
codex-shift tui --hud --hud-launcher tmux
codex-shift tui --hud --hud-launcher terminal
codex-shift tui --hud-verbose
```

默认状态文件：

```text
/tmp/codex-shift-current.json
```

它只保存路由元数据和 token 计数，不保存完整 prompt。

## 让 `codex` 命令走 shim

如果想在终端里直接输入 `codex` 也进入 codex-shift：

```bash
export CODEX_SHIFT_REAL_CODEX=/Applications/Codex.app/Contents/Resources/codex
alias codex='codex-shift-shim'
```

之后这些命令会经过 shim：

```bash
codex
codex resume
codex exec "fix this failing test"
codex "review改修这个 PR"
```

这些原生 Codex 子命令会直接透传：

```bash
codex app-server proxy
codex mcp list
codex login
codex doctor
```

临时绕过 shim：

```bash
CODEX_SHIFT_BYPASS=1 codex
```

PATH shim 方式：

```bash
mkdir -p ~/.local/bin
ln -sf /Users/pengfeihao/code/codex-shift/src/cli/shim.js ~/.local/bin/codex
export CODEX_SHIFT_REAL_CODEX=/Applications/Codex.app/Contents/Resources/codex
export PATH="$HOME/.local/bin:$PATH"
```

注意：alias 和 PATH shim 主要影响 shell 里的 `codex` 命令，不会自动影响 Codex Desktop 客户端内部调用。

## 强制 effort

支持的 effort：

- `minimal`
- `low`
- `medium`
- `high`
- `xhigh`

shell / exec / turn 可以用 `/...` 指令：

```bash
codex-shift exec "/high fix this failing test"
codex-shift turn --thread <thread-id> "/xhigh diagnose production data loss"
```

原生 Codex TUI 里 `/` 是 Codex 自己的 slash command，所以要用 `#...`：

```text
#low 解释一下这个函数
#medium fix this failing test
#high review改修这个 PR
#xhigh diagnose production data loss
```

## 配置

在项目根目录创建 `.codex-model-router.json`，或者创建 `~/.codex-model-router.json`：

```json
{
  "defaultModel": "gpt-5.5",
  "defaultEffort": "medium",
  "efforts": {
    "simple": "low",
    "coding": "medium",
    "complex": "high",
    "critical": "xhigh"
  },
  "budget": {
    "enabled": true,
    "weeklySoftLimitPercent": 85,
    "whenOverLimit": "downgrade_noncritical"
  },
  "modelCapabilities": {
    "gpt-lite": {
      "efforts": ["minimal", "low", "medium", "high"]
    }
  }
}
```

## 隐私

默认不会在 route decision、dry-run preview、HUD status file 里记录完整 prompt。

只有显式传 `--include-prompt` 时，`route` / `dry-run` 才会显示完整 prompt。

## 开发

```bash
npm test
node --test test/router.test.js
node --test test/tui.test.js
```

router eval fixture 在：

```text
test/fixtures/router-eval.json
```
