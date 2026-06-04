# Sapni（栖梦）— 自进化AI编程助手
[网址](https://sapni.yxpil.com)
> v1.1.0-rc1 · Self-Evolving AI · Terminal Agent · OpenAI Compatible API Server · Windows/macOS/Linux

```
███████╗ █████╗ ██████╗ ███╗   ██╗██╗
██╔════╝██╔══██╗██╔══██╗████╗  ██║██║
███████╗███████║██████╔╝██╔██╗ ██║██║
╚════██║██╔══██║██╔═══╝ ██║╚██╗██║██║
███████║██║  ██║██║     ██║ ╚████║██║
╚══════╝╚═╝  ╚═╝╚═╝     ╚═╝  ╚═══╝╚═╝
```

**Sapni（中文名：栖梦）** 是一个自进化 AI 编程助手。支持 **终端交互模式** 和 **OpenAI 兼容 API 服务器模式**，拥有 50+ 工具、持久记忆、会话管理、自定义技能等能力。

---

## 📦 安装

```bash
# 全局安装
npm install -g sapni-ai

# 启动
sapni

# 首次使用需配置 LLM API（进入聊天后输入）
/llm key <你的 API Key>
/llm url <API 地址>
/llm model <模型名>
```

### 系统要求

- **Node.js** >= 18
- **任意的 OpenAI 兼容 API Key**（见下方支持的 LLM 提供商）
- **可选**: Chrome/Chromium（用于 `browse_page` 网页抓取），如无则自动使用 `web_fetch` 降级

### 文件结构

```
~/.sapni/                    # 用户配置目录（首次启动自动生成）
├── config.json              # 配置文件（API Key、URL、模型、温度等）
└── mem/                     # 记忆存储
    ├── history/             # 历史会话记录
    ├── entries/             # 记忆条目
    └── sessions.json        # 会话索引

（包安装目录）
├── config.json              # 默认配置模板
├── Src/                     # 核心源码
│   ├── cli.js               # CLI入口
│   ├── index.jsx            # 终端界面（React Ink）
│   ├── agent.cjs            # Agent大脑
│   ├── llm.cjs              # LLM客户端
│   └── api/server.js        # API服务器
├── Tools/                   # 50+ 工具模块
├── Mem/                     # 记忆引擎
├── Skills/                  # 预置技能
└── bin/                     # 启动脚本
```

---

## 🧠 支持的 LLM 提供商

Sapni 使用 **OpenAI 兼容 API**，因此任何提供 OpenAI 兼容接口的 LLM 服务商都可以使用。只需修改 `/llm url` 和 `/llm key` 即可切换：

| 提供商 | 默认 API 地址 | 推荐模型 | 获取 Key |
|--------|--------------|----------|----------|
| **DeepSeek** | `https://api.deepseek.com/v1` | `deepseek-chat`、`deepseek-reasoner`、`deepseek-v3`、`deepseek-v4-pro`、`deepseek-r1` | [platform.deepseek.com](https://platform.deepseek.com/) |
| **OpenAI** | `https://api.openai.com/v1` | `gpt-4o`、`gpt-4-turbo`、`gpt-4`、`gpt-3.5-turbo`、`gpt-4o-mini` | [platform.openai.com](https://platform.openai.com/) |
| **Anthropic Claude**（通过 API 代理） | `https://api.anthropic.com/v1` | `claude-3-opus`、`claude-3-sonnet`、`claude-3-haiku` | [console.anthropic.com](https://console.anthropic.com/) |
| **Google Gemini**（通过 OpenAI 兼容中转） | `https://generativelanguage.googleapis.com/v1beta/openai` | `gemini-pro`、`gemini-2.0-flash` | [makersuite.google.com](https://makersuite.google.com/) |
| **Groq** | `https://api.groq.com/openai/v1` | `llama-3.3-70b-versatile`、`mixtral-8x7b-32768` | [console.groq.com](https://console.groq.com/) |
| **Together AI** | `https://api.together.xyz/v1` | `mistralai/Mixtral-8x22B-Instruct-v0.1` | [together.ai](https://together.ai/) |
| **Fireworks AI** | `https://api.fireworks.ai/inference/v1` | `accounts/fireworks/models/llama-v3p3-70b-instruct` | [fireworks.ai](https://fireworks.ai/) |
| **OpenRouter** | `https://openrouter.ai/api/v1` | `anthropic/claude-3.5-sonnet`、`openai/gpt-4o` 等 | [openrouter.ai](https://openrouter.ai/) |
| **本地 Ollama** | `http://localhost:11434/v1` | `llama3`、`qwen2`、`mistral` 等 | 无需 Key |
| **本地 vLLM** | `http://localhost:8000/v1` | 自行部署的模型 | 无需 Key |
| **自定义** | 任意 OpenAI 兼容地址 | 任意模型名 | 依服务商而定 |

> 所有兼容 OpenAI Chat API 格式的服务均可使用。只需设置对应的 `/llm url` 和 `/llm key` 即可。

### 配置示例

```bash
# DeepSeek
/llm key sk-xxxxxxxx
/llm url https://api.deepseek.com/v1
/llm model deepseek-chat

# OpenAI
/llm key sk-xxxxxxxx
/llm url https://api.openai.com/v1
/llm model gpt-4o

# Groq（免费！）
/llm key gsk_xxxxxxxx
/llm url https://api.groq.com/openai/v1
/llm model llama-3.3-70b-versatile

# 本地 Ollama
/llm key sk-dummy
/llm url http://localhost:11434/v1
/llm model llama3

# OpenRouter
/llm key sk-or-xxxxxxxx
/llm url https://openrouter.ai/api/v1
/llm model openai/gpt-4o
```

---

## 🎮 使用方式

### 方式一：终端交互模式（默认）

```bash
sapni                      # 直接进入交互式终端
```

交互式终端提供：
- 彩色 TUI 界面（React Ink 渲染）
- 按 `/` 弹出命令菜单
- 实时流式输出
- 工具调用可视化（显示调用参数、返回结果）
- 上下文用量监控
- 自动压缩历史

### 方式二：API 服务器模式

```bash
sapni -s                   # 默认端口 27262
sapni -s -p 8080          # 自定义端口 8080
sapni --server            # 完整参数
```

启动后提供 **OpenAI 兼容** 的 REST API，可用任何 OpenAI 客户端（ChatBox、NextChat、OpenCat、自定义脚本等）连接。

---

## 🔌 API 服务器 — 远程调用

### 认证方式

API 使用 **Bearer Token** 认证（非 LLM API Key），通过 `/sp_token` 命令管理：

```bash
# 启动服务器后，在 sapni 终端中输入：
/sp_token generate 我的客户端    # 生成 Token，label 任意
/sp_token list                    # 查看所有 Token
/sp_token revoke <token>         # 吊销 Token
```

> 首次启动服务器时会自动生成一个默认 Token，显示在控制台日志中。

### API 端点

| 方法 | 端点 | 说明 | 需Token |
|------|------|------|---------|
| `GET` | `/api/health` | 健康检查 | ❌ |
| `GET` | `/api/v1/models` | 模型列表 | ✅ |
| `GET` | `/api/v1/models/:id` | 模型详情 | ✅ |
| `POST` | `/api/v1/chat/completions` | 聊天（支持 stream） | ✅ |
| `GET` | `/api/v1/tools` | 工具列表 | ✅ |
| `POST` | `/api/v1/tools/execute` | 执行工具 | ✅ |
| `GET` | `/api/v1/system/status` | 系统状态 | ✅ |

也支持无 `/api/v1` 前缀的路径：`/v1/models`、`/v1/chat/completions` 等。

### API 调用示例

#### 1. 普通聊天

```bash
curl http://localhost:27262/api/v1/chat/completions \
  -H "Authorization: Bearer sp_your_token_here" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "sapni",
    "messages": [
      {"role": "system", "content": "You are a helpful assistant."},
      {"role": "user", "content": "Hello, tell me about yourself"}
    ],
    "stream": false
  }'
```

#### 2. 流式聊天（SSE）

```bash
curl http://localhost:27262/api/v1/chat/completions \
  -H "Authorization: Bearer sp_your_token_here" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "sapni",
    "messages": [{"role": "user", "content": "列出当前目录"}],
    "stream": true
  }'
```

流式响应中，工具调用会以 Markdown 格式实时输出，例如：

```
data: {"choices":[{"delta":{"content":"**🔧 Executing tool**: `ls`\n\nArguments:\n```json\n{\"path\": \".\"}\n```\n\n"}}]}
data: {"choices":[{"delta":{"content":"**Tool: `ls`**\n\n当前目录内容：\n\n- `Src/` - 源代码\n- `Tools/` - 工具模块\n- `config.json` - 配置\n..."}}]}
data: [DONE]
```

#### 3. Python 调用

```python
import requests

response = requests.post(
    "http://localhost:27262/api/v1/chat/completions",
    headers={
        "Authorization": "Bearer sp_your_token_here",
        "Content-Type": "application/json"
    },
    json={
        "model": "sapni",
        "messages": [{"role": "user", "content": "帮我搜索当前目录有哪些文件"}],
        "stream": False
    }
)

print(response.json()["choices"][0]["message"]["content"])
```

#### 4. JavaScript 调用

```javascript
const response = await fetch("http://localhost:27262/api/v1/chat/completions", {
  method: "POST",
  headers: {
    "Authorization": "Bearer sp_your_token_here",
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    model: "sapni",
    messages: [{ role: "user", content: "你好" }],
    stream: false
  })
});

const data = await response.json();
console.log(data.choices[0].message.content);
```

#### 5. 使用 ChatBox（桌面客户端）

1. 打开 ChatBox → 设置 → **API Provider**
2. 添加自定义 Provider
3. 配置：
   - **Base URL**: `http://<服务器IP>:27262`
   - **API Key**: 你的 `sp_xxx` Token（不是 LLM Key）
   - **Model**: `sapni`
4. 保存后即可聊天

> 支持 **流式输出**，工具调用结果会以 Markdown 格式显示。

#### 6. 远程访问

```bash
# 安全方式：SSH 隧道
ssh -L 27262:localhost:27262 user@your-server
# 然后本地连接 http://localhost:27262

# 危险方式：直接暴露（生产环境请加反向代理和 HTTPS）
sapni -s -p 27262
# 其他机器用 http://<服务器公网IP>:27262 访问
```

### Token 管理

服务器启动后可通过终端命令管理 Token：

```bash
/sp_token generate <标签>   # 生成
/sp_token list              # 列表
/sp_token revoke <token>    # 吊销
```

Token 持久化保存在 `~/.sapni/api_tokens.json`。

---

## ⚙️ 配置

### 首次配置

```bash
sapni
# 进入聊天后执行：
/llm key sk-xxxxxxxxxxxxxxx     # 设置 API Key
/llm url https://api.deepseek.com/v1  # 设置 API 地址
/llm model deepseek-chat        # 设置模型
```

也可以使用简写别名 `/api`：

```bash
/api key <KEY>
/api url <URL>
/api model <MODEL>
```

### 配置文件 `~/.sapni/config.json`

```json
{
  "llm": {
    "provider": "deepseek",
    "apiKey": "sk-xxx",
    "baseURL": "https://api.deepseek.com/v1",
    "model": "deepseek-v4-flash",
    "maxTokens": 8000,
    "temperature": 0.7,
    "topP": 0.9
  },
  "api": {
    "port": 27262,
    "host": "localhost",
    "enabled": true
  },
  "tools": {
    "enabled": true,
    "trustedTools": ["exec_console", "edit_lines"]
  }
}
```

---

## 🛠️ 全部功能

### 内置命令

| 命令 | 说明 |
|------|------|
| `/help` | 查看帮助 |
| `/reset` | 重置当前会话 |
| `/clear` | 清除屏幕消息 |
| `/ctx` | 查看上下文用量 |
| `/status` | 查看当前状态 |
| `/tools` | 工具列表概览 |
| `/tools_more` | 完整工具列表 |
| `/tool_search <query>` | 搜索工具 |
| `/history [n]` | 最近 n 条历史 |
| `/history search <q>` | 搜索历史记录 |
| `/history files` | 列出历史文件 |
| `/sessions` | 列出所有会话 |
| `/session <id>` | 查看指定会话 |
| `/session_search <q>` | 全局搜索 |
| `/memory` | 记忆统计 |
| `/memory_list` | 记忆列表 |
| `/memory_search <q>` | 搜索记忆 |
| `/compress` | 手动压缩上下文 |
| `/trust <tool_name>` | 永久信任某个工具 |
| `/forget` | 遗忘当前对话 |
| `/llm` | 查看 LLM 配置 |
| `/llm key <KEY>` | 设置 API Key |
| `/llm url <URL>` | 设置 API 地址 |
| `/llm model <MODEL>` | 设置模型 |
| `/api` | 查看 API 配置（同 /llm） |
| `/api key <KEY>` | 设置 API Key |
| `/api url <URL>` | 设置 API 地址 |
| `/api model <MODEL>` | 设置模型 |
| `/temp <0-2>` | 设置温度 |
| `/token <n>` | 设置最大输出 token |
| `/version` | 查看版本 |
| `/exit` | 退出 |

### 50+ 工具列表

#### 文件操作
| 工具 | 说明 |
|------|------|
| `read(filePath, offset?, limit?)` | 读取文件（支持行范围） |
| `write(filePath, content)` | 创建/覆写文件，自动创建目录 |
| `delete_file(filePath)` | 删除文件 |
| `move_file(source, target)` | 移动/重命名文件 |
| `copy_file(source, target)` | 复制文件 |
| `file_info(filePath)` | 文件元信息 |
| `search_replace(filePath, oldStr, newStr)` | 精确文本替换 |
| `edit_lines(filePath, edits)` | 编辑指定行 |
| `read_lines(filePath, start, end)` | 读取指定行范围 |

#### 目录操作
| 工具 | 说明 |
|------|------|
| `ls(dirPath?, ignore?)` | 目录列表（分组显示） |
| `list_dir(dirPath, recursive?)` | 目录列表（可递归） |
| `tree(dirPath, maxDepth?, ignore?)` | 目录树（推荐优先使用） |
| `glob(pattern, dirPath?)` | 文件模式匹配 |
| `find_files(pattern, dirPath?)` | 按文件名搜索 |

#### 搜索
| 工具 | 说明 |
|------|------|
| `grep(pattern, path?, options)` | 全文搜索（ripgrep引擎） |
| `search_in_files(pattern, path?, opts)` | 文件内搜索 |
| `search_in_range(file, start, end, pat)` | 行范围搜索 |

#### 终端
| 工具 | 说明 |
|------|------|
| `exec_console(command, cwd?, timeout?)` | 执行命令（返回码+输出） |
| `wait_command(command, args?, cwd?, timeout?)` | 异步执行长命令 |
| `check_command_status(commandId)` | 检查后台命令状态 |

#### 网络
| 工具 | 说明 |
|------|------|
| `web_search(query, num?)` | Bing 网页搜索 |
| `web_fetch(url, extractMode?)` | 抓取网页内容 |
| `open_preview(url)` | 在浏览器中打开 |
| `browse_page(url, waitMs?, extractLinks?)` | 无头浏览器渲染页面 |
| `browse_page_text(url, waitMs?)` | 提取页面纯文本 |

#### 诊断
| 工具 | 说明 |
|------|------|
| `get_diagnostics()` | 运行 TypeScript/ESLint 诊断 |

#### 记忆
| 工具 | 说明 |
|------|------|
| `search_memory(query, limit?)` | 搜索记忆 |
| `save_memory(content, tags?)` | 保存永久记忆 |
| `mem_rom(content, tags?)` | 保存永久记忆（同 save_memory） |
| `mem_ram(content, tags?)` | 保存临时会话记忆 |
| `list_memory(limit?)` | 列出记忆 |
| `delete_memory(id)` | 删除记忆 |
| `compress_context()` | 压缩历史到摘要 |
| `forget_conversation(keepSummary?)` | 清空，可选保留摘要 |
| `restart_session()` | 完全重置 |

#### 任务管理
| 工具 | 说明 |
|------|------|
| `todo_write(todos)` | 创建任务列表 |
| `set_timer(seconds, message)` | 设置异步定时器 |
| `skill(name)` | 执行预置技能 |

#### 工具管理
| 工具 | 说明 |
|------|------|
| `save_tool(name, code)` | 持久化自定义工具 |
| `delete_tool_file(name)` | 删除自定义工具 |
| `list_saved_tools()` | 列出所有自定义工具 |

#### 历史/会话
| 工具 | 说明 |
|------|------|
| `search_history(query, limit?)` | 搜索历史 |
| `list_history_files()` | 列出历史文件 |
| `list_sessions(limit?)` | 列出会话 |
| `view_session(session_id, limit?)` | 查看会话详情 |
| `search_sessions(query, limit?)` | 全局搜索 |

### 预置技能

| 技能 | 说明 |
|------|------|
| `code_review` | 代码审查 |
| `git_workflow` | Git 工作流辅助 |
| `systematic_debug` | 系统化调试 |
| `test_first` | 测试驱动开发 |
| `refactor` | 代码重构 |
| `更多模板` | cli-tool, express-api, react-component, python-script, test-jest |

---

## 📝 使用示例

### 终端模式

```
$ sapni

(・∀・)/  User
  帮我创建一个 Node.js HTTP 服务器

( ´ ▽ ` )ﾉ  Sapni
**🔧 Executing tool**: `write`
Arguments:
```json
{"path": "./server.js", "content": "const http = require('http');\n..."}
```

**Tool: `write`**
文件已创建 (156 bytes)

**🔧 Executing tool**: `exec_console`
Arguments:
```json
{"command": "node server.js &", "cwd": "."}
```

**Tool: `exec_console`**
进程已启动，PID: 12345
```

### API 模式（通过 curl）

```bash
# 原生调用工具
curl -X POST http://localhost:27262/api/v1/tools/execute \
  -H "Authorization: Bearer sp_xxx" \
  -H "Content-Type: application/json" \
  -d '{"name": "exec_console", "args": {"command": "ls -la"}}'

# 返回 Markdown 格式结果
# {"success":true,"result":"**Tool: `exec_console`**\n\ntotal 24\ndrwxr-xr-x ..."}
```

---

## 🔒 安全说明

| 风险 | 说明 |
|------|------|
| **API Key** | Token 仅用于 API 认证，不包含你的 LLM API Key。用户需自行配置 Key |
| **网络** | 默认监听 `localhost`，不暴露到公网。远程访问建议用 SSH 隧道或 HTTPS 反代 |
| **工具** | 默认需要手动授权危险操作（`exec_console` 等支持信任白名单） |
| **Token** | 可随时吊销/生成，Token 文件存储在用户本地 |

---

## 📄 许可证

Apache-2.0
