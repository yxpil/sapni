# Sapni — 粉色终端 AI 编程助手 🌸

> Self-Evolving Terminal AI · Ink TUI · Pink Theme · 50+ Tools · Session Memory

```bash
npm install -g @ghenya/sapni
sapni
```

```
██████  ██      ██ ███    ██ ███    ██
██      ██      ██ ████   ██ ████   ██
██      ██      ██ ██ ██  ██ ██ ██  ██
██      ██      ██ ██  ██ ██ ██  ██ ██
██████  ███████ ██ ██   ████ ██   █ 0.9
```

---

## 安装

```bash
# npm 全局安装
npm install -g @ghenya/sapni

# 或从 GitHub
git clone https://github.com/PillowBots/sapni.git
cd sapni && bash install.sh
```

- Node.js >= 18
- DeepSeek API Key ([获取](https://platform.deepseek.com/))

---

## 核心能力

| 类别 | 工具 |
|---|---|
| **文件操作** | read, write, delete_file, move_file, copy_file, search_replace, edit_lines |
| **搜索** | grep (ripgrep优先), glob, search_in_files, find_files |
| **终端** | exec_console, wait_command |
| **网络** | web_search (Bing), web_fetch, browse_page (Puppeteer) |
| **记忆** | mem_rom (永久), mem_ram (会话), search_memory, list_memory, delete_memory |
| **对话** | forget_conversation, restart_session, compress_context |
| **Session** | list_sessions, view_session, search_sessions — 全局历史搜索 |
| **工具管理** | save_tool, delete_tool_file, list_saved_tools — AI 自写工具持久化 |

---

## 内置命令

| 命令 | 说明 |
|---|---|
| `/help` | 查看帮助 |
| `/reset` | 重置对话 (新 session) |
| `/clear` | 清除消息 |
| `/ctx` | 上下文使用量 |
| `/status` | 当前状态 |
| `/tools` | 工具列表 |
| `/history [n]` | 最近历史 |
| `/history search <q>` | 搜索历史 |
| `/sessions` | 列出 session |
| `/session <id>` | 查看 session |
| `/session_search <q>` | 全局搜索 |
| `/memory` | 记忆统计 |
| `/memory_list [n]` | 记忆列表 |
| `/memory_search <q>` | 搜索记忆 |
| `/compress` | 压缩上下文 |
| `/trust <name>` | 信任工具 |
| `/api` | API 配置 |
| `/exit` | 退出 |

---

## 核心特性

### Ink 全屏 TUI (v0.9)

全屏终端界面，左侧 LOGO + 右侧欢迎框，消息折叠、工具调用折叠/展开、Ctrl+C 中断、消息队列排队执行。

### 双级记忆系统 (v0.9)

- **mem_rom**：永久记忆，落盘 `~/.sapni/mem/persistent-memory.json`，重启不丢
- **mem_ram**：会话记忆，仅本次窗口，关闭即丢
- 搜索同时覆盖 ROM + RAM，带 `[ROM]`/`[RAM]` 标签

### Session 回顾与全局搜索 (v0.9)

- 每次 `/reset` 或重启创建新 session
- `/sessions` 列出所有历史会话
- `/session_search` 全文搜索全部历史

### 虚拟浏览器

`browse_page` 基于 puppeteer-core + Chrome Headless，可绕过大部分反爬机制。

### 自定义工具持久化

AI 在对话中生成工具代码，通过 `save_tool` 持久化到 `~/.sapni/Tools/custom/`，下次启动自动加载。

---

## 配置

编辑 `~/.sapni/config.json` 或对话内 `/api` 命令：

```json
{
  "llm": {
    "apiKey": "YOUR_KEY",
    "baseURL": "https://api.deepseek.com/v1",
    "model": "deepseek-v4-pro",
    "contextWindow": 131072,
    "maxTokens": 16384,
    "temperature": 0.7
  }
}
```

---

## 更新日志

### v1.0.0 — 🌸 Pink Edition · Sapni 首发

- **粉色主题**：全界面 magenta/magentaBright 配色
- **独立品牌**：从 Clinn 分离，独立包名 @ghenya/sapni
- 修复首次按 `/` 不显示命令菜单的 bug
- 基于 Clinn v1.0.3 代码库

### v0.9.0 — Ink TUI · 双级记忆 · Session 搜索

- **Ink 7 全屏 TUI**：React 19 + Ink 7.0.5，左右分栏启动页，消息折叠，工具调用折叠/展开，颜色标记（红绿黄）
- **双级记忆**：mem_rom（永久落盘）+ mem_ram（会话级），重启不丢
- **Session 系统**：会话自动分组，全局全文搜索，历史回顾
- **消息队列**：AI 忙时消息自动排队，可视队列
- **Ctrl+C 中断**：不退出进程，中断执行或清空输入
- **输入框字符计数**：长文本自动缩略显示末尾
- **grep 升级**：ripgrep 优先，支持上下文行/files_only/count
- **分隔线终端宽度对齐**，不再刷屏

### v0.8.0 — 上下文修复 · 语法校验 · 颜文字

- 上下文窗口 6K→105K (×17)，模型感知检测
- Token 估算修正 (CJK ×0.8 + ASCII ×0.3)
- 写文件后自动 node/py/json 语法校验
- 动态颜文字引擎：关键词匹配，不再随机
- Glob 纯 Node.js 跨平台，模板引擎 + 5 技能

### v0.7.0 — 交互重构 · npm 发布

- npm 发布：`npm install -g @ghenya/sapni`
- `/api` 命令链式配置，上下文三级预警
- web_search 切换 Bing，虚拟浏览器

---

MIT License
