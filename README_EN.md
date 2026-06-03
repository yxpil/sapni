# Sapni（栖梦）— Self-Evolving AI Programming Assistant

> v1.1.0-rc1 · Self-Evolving AI · Terminal Agent · OpenAI Compatible API Server · Windows/macOS/Linux

```
███████╗ █████╗ ██████╗ ███╗   ██╗██╗
██╔════╝██╔══██╗██╔══██╗████╗  ██║██║
███████╗███████║██████╔╝██╔██╗ ██║██║
╚════██║██╔══██║██╔═══╝ ██║╚██╗██║██║
███████║██║  ██║██║     ██║ ╚████║██║
╚══════╝╚═╝  ╚═╝╚═╝     ╚═╝  ╚═══╝╚═╝
```

**Sapni (Chinese name: 栖梦)** is a self-evolving AI programming assistant. It supports **terminal interactive mode** and **OpenAI-compatible API server mode**, with 50+ built-in tools, persistent memory, session management, and custom skills.

---

## 📦 Installation

```bash
# Global install via npm
npm install -g sapni-ai

# Start the terminal
sapni

# On first use, configure your LLM API (type these in the chat):
/llm key <your API Key>
/llm url <API endpoint>
/llm model <model name>
```

### Requirements

- **Node.js** >= 18
- **Any OpenAI-compatible API Key** (see supported providers below)
- **Optional**: Chrome/Chromium (for `browse_page` web scraping; falls back to `web_fetch` automatically)

### Project Structure

```
~/.sapni/                    # User config directory (auto-created on first run)
├── config.json              # Configuration (API Key, URL, model, temperature, etc.)
└── mem/                     # Memory storage
    ├── history/             # Conversation history
    ├── entries/             # Memory entries
    └── sessions.json        # Session index

(Install directory)
├── config.json              # Default config template
├── Src/                     # Core source
│   ├── cli.js               # CLI entry point
│   ├── index.jsx            # Terminal UI (React Ink)
│   ├── agent.cjs            # Agent core
│   ├── llm.cjs              # LLM client
│   └── api/server.js        # API server
├── Tools/                   # 50+ tool modules
├── Mem/                     # Memory engine
├── Skills/                  # Built-in skills
└── bin/                     # Launch scripts
```

---

## 🧠 Supported LLM Providers

Sapni uses the **OpenAI-compatible API** format, so any provider with an OpenAI-compatible endpoint works. Just change `/llm url` and `/llm key`:

| Provider | Default API URL | Recommended Models | Get Key |
|----------|----------------|-------------------|---------|
| **DeepSeek** | `https://api.deepseek.com/v1` | `deepseek-chat`, `deepseek-reasoner`, `deepseek-v3`, `deepseek-v4-pro`, `deepseek-r1` | [platform.deepseek.com](https://platform.deepseek.com/) |
| **OpenAI** | `https://api.openai.com/v1` | `gpt-4o`, `gpt-4-turbo`, `gpt-4`, `gpt-3.5-turbo`, `gpt-4o-mini` | [platform.openai.com](https://platform.openai.com/) |
| **Anthropic Claude** (via proxy) | `https://api.anthropic.com/v1` | `claude-3-opus`, `claude-3-sonnet`, `claude-3-haiku` | [console.anthropic.com](https://console.anthropic.com/) |
| **Google Gemini** (via OpenAI bridge) | `https://generativelanguage.googleapis.com/v1beta/openai` | `gemini-pro`, `gemini-2.0-flash` | [makersuite.google.com](https://makersuite.google.com/) |
| **Groq** | `https://api.groq.com/openai/v1` | `llama-3.3-70b-versatile`, `mixtral-8x7b-32768` | [console.groq.com](https://console.groq.com/) |
| **Together AI** | `https://api.together.xyz/v1` | `mistralai/Mixtral-8x22B-Instruct-v0.1` | [together.ai](https://together.ai/) |
| **Fireworks AI** | `https://api.fireworks.ai/inference/v1` | `accounts/fireworks/models/llama-v3p3-70b-instruct` | [fireworks.ai](https://fireworks.ai/) |
| **OpenRouter** | `https://openrouter.ai/api/v1` | `anthropic/claude-3.5-sonnet`, `openai/gpt-4o`, etc. | [openrouter.ai](https://openrouter.ai/) |
| **Local Ollama** | `http://localhost:11434/v1` | `llama3`, `qwen2`, `mistral`, etc. | No key needed |
| **Local vLLM** | `http://localhost:8000/v1` | Any self-hosted model | No key needed |
| **Custom** | Any OpenAI-compatible URL | Any model name | Varies |

> Any service that supports the OpenAI Chat API format can be used. Just configure `/llm url` and `/llm key` accordingly.

### Configuration Examples

```bash
# DeepSeek
/llm key sk-xxxxxxxx
/llm url https://api.deepseek.com/v1
/llm model deepseek-chat

# OpenAI
/llm key sk-xxxxxxxx
/llm url https://api.openai.com/v1
/llm model gpt-4o

# Groq (free tier available!)
/llm key gsk_xxxxxxxx
/llm url https://api.groq.com/openai/v1
/llm model llama-3.3-70b-versatile

# Local Ollama
/llm key sk-dummy
/llm url http://localhost:11434/v1
/llm model llama3

# OpenRouter
/llm key sk-or-xxxxxxxx
/llm url https://openrouter.ai/api/v1
/llm model openai/gpt-4o
```

---

## 🎮 Usage

### Mode 1: Terminal Interactive (Default)

```bash
sapni
```

Features:
- Colorful TUI (React Ink)
- Press `/` for command menu
- Real-time streaming output
- Tool call visualization (arguments, results)
- Context usage monitoring
- Auto-compression of conversation history

### Mode 2: API Server

```bash
sapni -s                   # Default port 27262
sapni -s -p 8080          # Custom port 8080
sapni --server            # Full argument
```

Provides an **OpenAI-compatible** REST API — use with ChatBox, NextChat, OpenCat, custom scripts, or any OpenAI client.

---

## 🔌 API Server — Remote Usage

### Authentication

API uses **Bearer Token** (not your LLM API Key). Manage tokens with `/sp_token`:

```bash
# In the sapni terminal (after starting the server):
/sp_token generate MyClient    # Generate a token (label is optional)
/sp_token list                 # List all tokens
/sp_token revoke <token>       # Revoke a token
```

> A default token is auto-generated on first server startup, displayed in the console log.

### API Endpoints

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| `GET` | `/api/health` | Health check | ❌ |
| `GET` | `/api/v1/models` | List models | ✅ |
| `GET` | `/api/v1/models/:id` | Get model info | ✅ |
| `POST` | `/api/v1/chat/completions` | Chat (streaming supported) | ✅ |
| `GET` | `/api/v1/tools` | List tools | ✅ |
| `POST` | `/api/v1/tools/execute` | Execute a tool | ✅ |
| `GET` | `/api/v1/system/status` | System status | ✅ |

The non-prefixed paths also work: `/v1/models`, `/v1/chat/completions`, etc.

### API Examples

#### 1. Basic Chat

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

#### 2. Streaming Chat (SSE)

```bash
curl http://localhost:27262/api/v1/chat/completions \
  -H "Authorization: Bearer sp_your_token_here" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "sapni",
    "messages": [{"role": "user", "content": "List the current directory"}],
    "stream": true
  }'
```

Tool calls are streamed in real-time as Markdown:

```
data: {"choices":[{"delta":{"content":"**🔧 Executing tool**: `ls`\n\nArguments:\n```json\n{\"path\": \".\"}\n```\n\n"}}]}
data: {"choices":[{"delta":{"content":"**Tool: `ls`**\n\nCurrent directory:\n\n- `Src/` - Source\n- `Tools/` - Tools\n- `config.json` - Config\n..."}}]}
data: [DONE]
```

#### 3. Python

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
        "messages": [{"role": "user", "content": "Search files in current directory"}],
        "stream": False
    }
)

print(response.json()["choices"][0]["message"]["content"])
```

#### 4. JavaScript

```javascript
const response = await fetch("http://localhost:27262/api/v1/chat/completions", {
  method: "POST",
  headers: {
    "Authorization": "Bearer sp_your_token_here",
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    model: "sapni",
    messages: [{ role: "user", content: "Hello" }],
    stream: false
  })
});

const data = await response.json();
console.log(data.choices[0].message.content);
```

#### 5. Using ChatBox

1. Open ChatBox → Settings → **API Provider**
2. Add a custom provider:
   - **Base URL**: `http://<server-ip>:27262`
   - **API Key**: Your `sp_xxx` token (not your LLM key)
   - **Model**: `sapni`
3. Save and start chatting

> Streaming is supported. Tool call results are displayed in Markdown.

#### 6. Remote Access

```bash
# Secure: SSH tunnel
ssh -L 27262:localhost:27262 user@your-server
# Then connect to http://localhost:27262 locally

# Expose directly (use a reverse proxy + HTTPS in production)
sapni -s -p 27262
# Other machines connect via http://<server-public-ip>:27262
```

### Token Management

```bash
/sp_token generate <label>   # Create
/sp_token list               # List
/sp_token revoke <token>     # Revoke
```

Tokens are persisted in `~/.sapni/api_tokens.json`.

---

## ⚙️ Configuration

### First-Time Setup

```bash
sapni
# In the chat:
/llm key sk-xxxxxxxxxxxxxxx     # Set API Key
/llm url https://api.deepseek.com/v1  # Set API URL
/llm model deepseek-chat        # Set model
```

Short alias `/api` also works:

```bash
/api key <KEY>
/api url <URL>
/api model <MODEL>
```

### Config File `~/.sapni/config.json`

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

## 🛠️ Full Feature List

### Built-in Commands

| Command | Description |
|---------|-------------|
| `/help` | Show help |
| `/reset` | Reset current session |
| `/clear` | Clear screen messages |
| `/ctx` | Show context usage |
| `/status` | Show current status |
| `/tools` | Tool list overview |
| `/tools_more` | Full tool list |
| `/tool_search <query>` | Search tools |
| `/history [n]` | Recent n history items |
| `/history search <q>` | Search history |
| `/sessions` | List all sessions |
| `/session <id>` | View a specific session |
| `/session_search <q>` | Global search across sessions |
| `/memory` | Memory stats |
| `/memory_list` | List memory entries |
| `/memory_search <q>` | Search memory |
| `/compress` | Manually compress context |
| `/trust <tool_name>` | Permanently trust a tool |
| `/forget` | Forget current conversation |
| `/llm` | View LLM configuration |
| `/llm key <KEY>` | Set API Key |
| `/llm url <URL>` | Set API URL |
| `/llm model <MODEL>` | Set model |
| `/api` | View API config (alias for /llm) |
| `/api key <KEY>` | Set API Key |
| `/api url <URL>` | Set API URL |
| `/api model <MODEL>` | Set model |
| `/temp <0-2>` | Set temperature |
| `/token <n>` | Set max tokens |
| `/version` | Show version |
| `/exit` | Exit |

### 50+ Tools

#### File Operations
| Tool | Description |
|------|-------------|
| `read(filePath, offset?, limit?)` | Read file (with line range) |
| `write(filePath, content)` | Create/overwrite file, auto-create dirs |
| `delete_file(filePath)` | Delete file |
| `move_file(source, target)` | Move/rename file/directory |
| `copy_file(source, target)` | Copy file |
| `file_info(filePath)` | File metadata |
| `search_replace(filePath, oldStr, newStr)` | Precise text replacement |
| `edit_lines(filePath, edits)` | Edit specific lines |
| `read_lines(filePath, start, end)` | Read line range |

#### Directory Operations
| Tool | Description |
|------|-------------|
| `ls(dirPath?, ignore?)` | List directory (grouped) |
| `list_dir(dirPath, recursive?)` | List directory (recursive) |
| `tree(dirPath, maxDepth?, ignore?)` | Directory tree |
| `glob(pattern, dirPath?)` | File pattern matching |
| `find_files(pattern, dirPath?)` | Find files by name |

#### Search
| Tool | Description |
|------|-------------|
| `grep(pattern, path?, options)` | Full-text search (ripgrep) |
| `search_in_files(pattern, path?, opts)` | In-file search |
| `search_in_range(file, start, end, pat)` | Line-range search |

#### Terminal
| Tool | Description |
|------|-------------|
| `exec_console(command, cwd?, timeout?)` | Execute command (exit code + output) |
| `wait_command(command, args?, cwd?, timeout?)` | Async long-running command |
| `check_command_status(commandId)` | Check background command status |

#### Network
| Tool | Description |
|------|-------------|
| `web_search(query, num?)` | Bing web search |
| `web_fetch(url, extractMode?)` | Fetch web content |
| `open_preview(url)` | Open URL in browser |
| `browse_page(url, waitMs?, extractLinks?)` | Headless browser page render |
| `browse_page_text(url, waitMs?)` | Extract page plain text |

#### Diagnostics
| Tool | Description |
|------|-------------|
| `get_diagnostics()` | Run TypeScript/ESLint diagnostics |

#### Memory
| Tool | Description |
|------|-------------|
| `search_memory(query, limit?)` | Search memory |
| `save_memory(content, tags?)` | Save persistent memory |
| `mem_rom(content, tags?)` | Save persistent memory |
| `mem_ram(content, tags?)` | Save temporary session memory |
| `list_memory(limit?)` | List memory |
| `delete_memory(id)` | Delete memory |
| `compress_context()` | Compress history into summary |
| `forget_conversation(keepSummary?)` | Clear history |
| `restart_session()` | Full reset |

#### Task Management
| Tool | Description |
|------|-------------|
| `todo_write(todos)` | Create task list |
| `set_timer(seconds, message)` | Set async timer |
| `skill(name)` | Execute built-in skill |

#### Tool Management
| Tool | Description |
|------|-------------|
| `save_tool(name, code)` | Persist custom tool |
| `delete_tool_file(name)` | Delete custom tool |
| `list_saved_tools()` | List all custom tools |

#### History / Sessions
| Tool | Description |
|------|-------------|
| `search_history(query, limit?)` | Search history |
| `list_history_files()` | List history files |
| `list_sessions(limit?)` | List sessions |
| `view_session(session_id, limit?)` | View session detail |
| `search_sessions(query, limit?)` | Global search |

### Built-in Skills

| Skill | Description |
|-------|-------------|
| `code_review` | Code review |
| `git_workflow` | Git workflow assistant |
| `systematic_debug` | Systematic debugging |
| `test_first` | Test-driven development |
| `refactor` | Code refactoring |
| `Templates` | cli-tool, express-api, react-component, python-script, test-jest |

---

## 📝 Usage Examples

### Terminal Mode

```
$ sapni

(・∀・)/  User
  Create a Node.js HTTP server

( ´ ▽ ` )ﾉ  Sapni
**🔧 Executing tool**: `write`
Arguments:
```json
{"path": "./server.js", "content": "const http = require('http');\n..."}
```

**Tool: `write`**
File created (156 bytes)

**🔧 Executing tool**: `exec_console`
Arguments:
```json
{"command": "node server.js &", "cwd": "."}
```

**Tool: `exec_console`**
Process started, PID: 12345
```

### API Mode (curl)

```bash
# Execute a tool natively
curl -X POST http://localhost:27262/api/v1/tools/execute \
  -H "Authorization: Bearer sp_xxx" \
  -H "Content-Type: application/json" \
  -d '{"name": "exec_console", "args": {"command": "ls -la"}}'

# Returns Markdown-formatted result
# {"success":true,"result":"**Tool: `exec_console`**\n\ntotal 24\ndrwxr-xr-x ..."}
```

---

## 🔒 Security

| Risk | Mitigation |
|------|-----------|
| **API Key** | Tokens are for API auth only, they don't contain your LLM key. Users configure their own key. |
| **Network** | Default listens on `localhost` only. Use SSH tunnel or HTTPS reverse proxy for remote access. |
| **Tools** | Dangerous operations (like `exec_console`) require manual permission by default. Whitelist via `trust` command. |
| **Tokens** | Can be revoked/generated anytime. Token file stored locally. |

---

## 📄 License

Apache-2.0
