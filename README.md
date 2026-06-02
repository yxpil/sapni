# Sapni — 粉色终端 AI 编程助手 🌸

> Self-Evolving Terminal AI · Ink TUI · Pink Theme · 50+ Tools · Session Memory · **Stable**

```bash
npm install -g @sapni-ai
```

> ⚡ **稳定版** — 只发布 stable，不做 rc/beta。从 v1.0.0 开始，每个版本都是经过验证的稳定版本。

```
███████╗ █████╗ ██████╗ ███╗   ██╗██╗
██╔════╝██╔══██╗██╔══██╗████╗  ██║██║
███████╗███████║██████╔╝██╔██╗ ██║██║
╚════██║██╔══██║██╔═══╝ ██║╚██╗██║██║
███████║██║  ██║██║     ██║ ╚████║██║
╚══════╝╚═╝  ╚═╝╚═╝     ╚═╝  ╚═══╝╚═╝
```

---

## 安装

```bash
# npm 全局安装
npm install -g @sapni-ai

# 或从 GitHub
git clone https://github.com/yxpilsapni.git
cd sapni && bash install.sh
```

- **Node.js** >= 18
- **DeepSeek API Key**（[获取](https://platform.deepseek.com/)）

---

## 核心能力

| 类别 | 工具 |
|---|---|
| **文件操作** | read, write, delete_file, move_file, copy_file, search_replace, edit_lines |
| **搜索** | grep（ripgrep 优先）, glob, search_in_files, find_files |
| **终端** | exec_console, wait_command |
| **网络** | web_search（Bing）, web_fetch, browse_page（Puppeteer） |
| **记忆** | mem_rom（永久）, mem_ram（会话）, search_memory, list_memory, delete_memory |
| **对话** | forget_conversation, restart_session, compress_context |
| **Session** | list_sessions, view_session, search_sessions — 全局历史搜索 |
| **工具管理** | save_tool, delete_tool_file, list_saved_tools — AI 自写工具持久化 |

---

## 内置命令

按 `/` 弹出命令菜单，`↑↓` 选择，`回车` 确认。

| 命令 | 说明 |
|---|---|
| `/help` | 查看帮助 |
| `/reset` | 重置对话（新 session） |
| `/clear` | 清除消息 |
| `/ctx` | 上下文使用量 |
| `/status` | 当前状态 |
| `/tools` / `/tools_more` | 工具列表 |
| `/tool_search <q>` | 搜索工具 |
| `/history [n]` | 最近历史 |
| `/history search <q>` | 搜索历史 |
| `/sessions` | 列出 session |
| `/session <id>` | 查看 session |
| `/session_search <q>` | 全局搜索历史 |
| `/memory` / `/memory_list` | 记忆统计 / 列表 |
| `/memory_search <q>` | 搜索记忆 |
| `/compress` | 手动压缩上下文 |
| `/trust <name>` | 永久信任工具 |
| `/api` / `/api key` / `/api url` / `/api model` | API 配置 |
| `/temp <0-2>` | 设置温度 |
| `/token <n>` | 设置最大输出 token |
| `/version` | 查看版本 |
| `/exit` | 退出 |

---

## 核心特性

### 🌸 粉色主题（v1.0）

全界面 magenta/magentaBright 配色。LOGO、标题、工具名、分割线、选中高亮 — 全部粉色。

### Ink 全屏 TUI

React 19 + Ink 7.0.5。左右分栏启动页，消息折叠、工具调用折叠/展开、Ctrl+C 中断、消息队列排队执行。

### 双级记忆系统

- **mem_rom**：永久记忆，落盘 `~/.sapni/mem/persistent-memory.json`，重启不丢
- **mem_ram**：会话记忆，仅本次窗口，关闭即丢
- 搜索同时覆盖 ROM + RAM，带 `[ROM]` / `[RAM]` 标签

### Session 回顾与全局搜索

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
    "apiKey": "YOUR_DEEPSEEK_KEY",
    "baseURL": "https://api.deepseek.com/v1",
    "model": "deepseek-v4-pro",
    "contextWindow": 1048576,
    "maxTokens": 8000,
    "temperature": 0.7
  }
}
```

---

## 更新日志

### v1.0.0 — 🌸 Pink Edition · Sapni 首发稳定版

- **粉色主题**：全界面 magenta / magentaBright 配色
- **独立品牌**：包名 @ghenyasapni，命令 `sapni`，配置目录 `~/.sapni`
- **只做稳定版**：从 v1.0.0 起，不发布 rc/beta，每个版本经过充分验证
- 修复首次按 `/` 不显示命令菜单的 bug
- 基于 Clinn v1.0.3 代码库

---

Apache-2.0 License
