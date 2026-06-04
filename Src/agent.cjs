const os = require("os");
const LLMClient = require("./llm.cjs");
const Tools = require("../Tools");
const { ConversationMemory } = require("../Mem");
const {
  saveTurn, searchHistory, getFileList, loadFileTurns,
  startSession, endSession, listSessions, getSession,
  loadSessionTurns, searchSessions, globalSearch,
  migrateLegacySessions,
} = require("../Mem/history");

const MAX_ITERATIONS = 500;
const MAX_TOOL_RESULT_CHARS = 3000;

function buildSystemInfo() {
  const home = os.homedir();
  const cwd = process.cwd();
  return [
    `System: ${os.type()} ${os.release()} (${os.arch()})`,
    `Host: ${os.hostname()}`,
    `Home: ${home}`,
    `CWD: ${cwd}`,
    `Term Width: ${process.stdout.columns || 80} cols`,
    `Node: ${process.version}`,
    `Time: ${new Date().toISOString()}`,
  ].join(" | ");
}

function estimateTokens(text) {
  if (!text) return 0;
  let cjk = 0;
  let ascii = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0);
    if (code > 127) cjk++;
    else ascii++;
  }
  // DeepSeek tokenizer: 中文约 0.6-0.8 token/字, 英文约 0.25-0.3 token/字符
  // 保守估计: 中文 0.8, 英文 0.3
  return Math.ceil(cjk * 0.8 + ascii * 0.3);
}

/**
 * 根据模型名估算上下文窗口大小
 */
function getContextWindow(model) {
  const known = {
    "deepseek-chat": 1048576,
    "deepseek-reasoner": 1048576,
    "deepseek-v3": 1048576,
    "deepseek-v4-pro": 1048576,
    "deepseek-r1": 1048576,
    "gpt-4": 8192,
    "gpt-4-turbo": 128000,
    "gpt-4o": 128000,
    "gpt-4o-mini": 128000,
    "gpt-3.5-turbo": 16384,
    "claude-3-opus": 200000,
    "claude-3-sonnet": 200000,
    "claude-3-haiku": 200000,
  };
  if (!model) return 1048576;
  const key = model.toLowerCase();
  for (const [k, v] of Object.entries(known)) {
    if (key.includes(k)) return v;
  }
  return 65536;
}

function estimateMessagesTokens(messages) {
  let total = 0;
  for (const m of messages) {
    total += estimateTokens(m.role) + estimateTokens(m.content || "");
  }
  return total;
}

class Agent {
  constructor(config, callbacks = {}) {
    this.config = config;
    this.llm = new LLMClient(config.llm);
    this.memory = new ConversationMemory(config.memory);
    this.callbacks = callbacks;
    this.maxIterations = MAX_ITERATIONS;
    this.systemInfo = buildSystemInfo();
    this.systemPrompt = `${config.systemPrompt}\n\n[Model Identity] ${config.llm?.model || 'unknown'} (Provider: ${config.llm?.provider || 'unknown'})\n\n[System Info]\n${this.systemInfo}`;
    if (config.persona) {
      this.systemPrompt = `[Identity] ${config.persona}\n\n${this.systemPrompt}`;
    }
    this.autoCompressThreshold = config.memory?.autoCompressThreshold || 5000;
    // Use actual context window (inferred from model name), not maxTokens (that's output limit)
    this.actualContextWindow = config.llm?.contextWindow || getContextWindow(config.llm?.model);
    this.maxContextTokens = this.actualContextWindow * 0.8;
    this._lastToolCalls = [];

    // session management
    migrateLegacySessions();
    this.sessionId = startSession();

    Tools.setTrusted(config.tools?.trustedTools || []);
    Tools.setPermissionCallback(async (name, args) => {
      if (callbacks.onPermission) return callbacks.onPermission(name, args);
      return false;
    });

    this._injectAgentTools();
    this.toolDeclarations = Tools.toFunctionDeclarations();
  }

  _injectAgentTools() {
    const self = this;
    const memTools = [
      "search_memory", "save_memory", "list_memory", "delete_memory",
      "mem_rom", "mem_ram",
      "compress_context", "truncate_context", "agent_self_invoke", "set_timer",
      "save_tool", "delete_tool_file", "list_saved_tools",
      "forget_conversation", "restart_session",
      "search_history", "list_history_files",
      "list_sessions", "view_session", "search_sessions",
      "submit_feedback",
    ];
    for (const name of memTools) {
      const tool = Tools.getTool(name);
      if (!tool) continue;
      tool.execute = (args) => self._handleAgentTool(name, args);
    }
  }

  async _handleAgentTool(name, args) {
    switch (name) {
      case "search_memory":
        return this._fmtEntries(this.memory.searchEntries(args.query, args.limit || 5));
      case "save_memory":
      case "mem_rom": {
        const tags = args.tags ? args.tags.split(",").map((t) => t.trim()) : [];
        const entry = this.memory.addRomEntry(args.content, tags);
        return entry ? `[ROM] Saved #${entry.id}: ${entry.text}` : "[Failed] Empty content";
      }
      case "mem_ram": {
        const tags = args.tags ? args.tags.split(",").map((t) => t.trim()) : [];
        const entry = this.memory.addRamEntry(args.content, tags);
        return entry ? `[RAM] Saved #${entry.id}: ${entry.text}` : "[Failed] Empty content";
      }
      case "list_memory": {
        const all = this.memory.getAllEntries().slice(-(args.limit || 20));
        return this._fmtEntries(all);
      }
      case "delete_memory": {
        const ok = this.memory.removeEntry(args.id);
        return ok ? `[OK] Deleted #${args.id}` : `[Not found] #${args.id}`;
      }
      case "compress_context": {
        const compressed = this.memory.compressHistory();
        if (!compressed) return "[Skipped] Conversation too short";
        const summary = await this._summarize(compressed);
        this.memory.addRamEntry(summary, ["auto-summary"]);
        this.memory.clear();
        return `[OK] Context compressed, summary saved: ${summary}`;
      }
      case "truncate_context": {
        const keywords = args.keywords || "";
        const keep = Math.max(0, parseInt(args.keep) || 10);
        const history = this.memory.getHistory();
        if (history.length <= keep) return `[Skipped] Only ${history.length} messages, no need to truncate`;
        const recent = history.slice(-keep);
        this.memory.clear();
        // Inject keywords as system context
        if (keywords) {
          this.memory.addRamEntry(`[对话关键词 / Keywords] ${keywords}`, ["keywords"]);
        }
        // Restore recent messages
        for (const msg of recent) {
          this.memory.history.push(msg);
        }
        return `[OK] 已截断上下文: 保留最近 ${keep} 条消息, 关键词已注入. 原有 ${history.length} 条 → 现有 ${this.memory.getHistory().length} 条`;
      }
      case "agent_self_invoke": {
        if (this.callbacks.onSelfInvoke) return this.callbacks.onSelfInvoke(args.task, args.context);
        return "[Skipped] self_invoke callback not configured";
      }
      case "set_timer": {
        const s = Math.max(1, Math.min(args.seconds || 5, 300));
        const msg = args.message || "定时器";
        if (this.callbacks.onTimer) this.callbacks.onTimer(s, msg);
        return `[OK] 定时器已设置 ${s}秒后通知: ${msg}`;
      }
      case "save_tool": {
        const code = args.code || "";
        const toolName = args.name || "";
        if (!toolName) return "[失败] 必须提供 name 参数";
        if (!code) return "[失败] 必须提供 code 参数";
        const result = Tools.saveToolToFile(toolName, code);
        if (result.startsWith("[OK]")) this.refreshTools();
        return result;
      }
      case "delete_tool_file": {
        const toolName = args.name || "";
        if (!toolName) return "[失败] 必须提供 name 参数";
        const result = Tools.deleteToolFile(toolName);
        if (result.startsWith("[OK]")) this.refreshTools();
        return result;
      }
      case "list_saved_tools": {
        const saved = Tools.listCustomTools();
        if (saved.length === 0) return "(无持久化工具)";
        return saved.map((s) => `[${s.file}] 导出: ${s.exports.join(", ")}`).join("\n");
      }
      case "forget_conversation": {
        const keepSummary = args.keepSummary !== false;
        let summary = "";
        if (keepSummary && this.memory.getHistory().length > 2) {
          const compressed = this.memory.compressHistory();
          if (compressed) summary = await this._summarize(compressed);
        }
        this.memory.clear();
        if (summary) { this.memory.addRamEntry(summary, ["auto-summary"]); }
        return summary
          ? `[OK] 对话已遗忘, 摘要已保存: ${summary}`
          : "[OK] 对话历史已清空, 像全新对话一样";
      }
      case "restart_session": {
        endSession(this.sessionId);
        this.memory.clear();
        this.memory.clearRamEntries();
        this.llm.resetUsage();
        this.sessionId = startSession();
        return "[OK] 会话已完全重启: 历史+记忆+token计数均已重置, 新session已创建. 可以开始全新任务.";
      }
      case "search_history": {
        const q = args.query || "";
        if (!q.trim()) return "[错误] 请提供搜索关键词";
        const results = searchHistory(q, args.limit || 10);
        if (results.length === 0) return `[无匹配] 在历史对话中未找到 "${q}"`;
        return results.map((r, i) =>
          `${i + 1}. [${r.file}] ${r.time?.slice(0, 16) || "?"}${r.cwd ? `\n  目录: ${r.cwd}` : ""}\n  用户: ${r.user}\n  回复: ${r.assistant}`
        ).join("\n\n");
      }
      case "list_history_files": {
        const files = getFileList();
        if (files.length === 0) return "(暂无历史对话文件)";
        return files.map((f) => `${f.file} | ${f.turns}轮 | ${f.size}KB | ${f.created.slice(0, 10)}`).join("\n");
      }
      case "list_sessions": {
        const sessions = listSessions(args.limit || 20);
        if (sessions.length === 0) return "(暂无对话 session)";
        const now = this.sessionId;
        return sessions.map((s, i) => {
          const marker = s.id === now ? " ◀ 当前" : "";
          const status = s.status === "active" ? "●" : "○";
          const date = s.started ? s.started.slice(0, 16) : "?";
          return `${i + 1}. ${status} [${date}] ${s.title || "(无标题)"} | ${s.turnCount}轮${marker}`;
        }).join("\n");
      }
      case "view_session": {
        const sid = args.session_id || "";
        if (!sid) return "[错误] 请提供 session_id (用 list_sessions 获取)";
        const session = getSession(sid);
        if (!session) return `[未找到] session ${sid}`;
        const turns = loadSessionTurns(sid, args.limit || 50);
        if (turns.length === 0) return `[空] session ${sid} 中没有对话轮次`;
        const header = [
          `=== Session: ${session.title || "(无标题)"} ===`,
          `ID: ${session.id}  |  开始: ${session.started?.slice(0, 16) || "?"}  |  共 ${session.turnCount} 轮`,
          ``,
        ];
        const body = turns.map((t, i) => {
          return `[${i + 1}] ${t.time?.slice(0, 16) || "?"}\n` +
            `  > 用户: ${t.user ? t.user.slice(0, 200) : ""}\n` +
            `  < 回复: ${t.assistant ? t.assistant.slice(0, 300) : ""}`;
        });
        return header.join("\n") + "\n" + body.join("\n\n");
      }
      case "search_sessions": {
        const q = args.query || "";
        if (!q.trim()) return "[错误] 请提供搜索关键词";
        const results = globalSearch(q, args.limit || 10);
        if (results.length === 0) return `[无匹配] 在所有历史 session 中未找到 "${q}"`;
        return results.map((r, i) => {
          const date = r.sessionStarted ? r.sessionStarted.slice(0, 16) : "?";
          const previews = r.topMatches.map((m) => `    · ${m.user.slice(0, 80)}`).join("\n");
          return `${i + 1}. [${date}] ${r.sessionTitle} | 匹配 ${r.matchCount} 处 | 得分 ${r.totalScore}\n${previews}`;
        }).join("\n\n");
      }
      case "submit_feedback": {
        const https = require("https");
        const msg = (args.message || "").trim();
        if (!msg || msg.length < 3) return "[错误] 反馈内容至少 3 个字";
        const data = JSON.stringify({
          message: msg,
          contact: (args.contact || "").trim(),
          version: "sapni-ai@" + (this.config?.llm?.model || "unknown"),
        });
        return new Promise((resolve) => {
          const req = https.request("https://sapni.yxpil.com/api/feedback", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            timeout: 5000,
          }, (res) => {
          req.on("timeout", () => { req.destroy(); });
            let body = "";
            res.on("data", (c) => body += c);
            res.on("end", () => {
              try {
                const j = JSON.parse(body);
                resolve(j.ok ? "[OK] 反馈已提交，感谢！开发者会看到并改进 Sapni" : `[失败] ${j.error || "未知错误"}`);
              } catch (_) { resolve("[OK] 反馈已提交"); }
            });
          });
          req.on("error", (e) => resolve(`[网络错误] ${e.message}`));
          req.write(data);
          req.end();
        });
      }
      default:
        return `[未知内部工具] ${name}`;
    }
  }

  async _summarize(text) {
    try {
      const msgs = [
        { role: "system", content: "将以下对话压缩为一条200字以内的中文摘要,只输出摘要。" },
        { role: "user", content: text.slice(0, 4000) },
      ];
      const res = await this.llm.chat(msgs, null);
      return (res.choices?.[0]?.message?.content || text.slice(0, 190)).slice(0, 190);
    } catch (_) {
      return text.slice(0, 190);
    }
  }

  _fmtEntries(entries) {
    if (!entries || entries.length === 0) return "(无记忆条目)";
    return entries.map((e) => {
      const tag = (e._type === "ram") ? "[RAM]" : "[ROM]";
      return `${tag} #${e.id} [${e.tags?.join(",") || "-"}] ${e.text}`;
    }).join("\n");
  }

  refreshTools() {
    this.toolDeclarations = Tools.toFunctionDeclarations();
  }

  _detectLoop(toolCalls) {
    const sig = toolCalls.map((t) => `${t.function.name}:${t.function.arguments}`).join("|");
    if (!this._lastSig || this._lastSig !== sig) {
      this._lastSig = sig;
      this._repeatCount = 1;
      return false;
    }
    this._repeatCount++;
    return this._repeatCount >= 300;
  }

  async run(userMessage, opts = {}) {
    const { onContent, onToolCall, onToolResult, onThinking, onContextPct, signal } = opts;
    this.memory.addUser(userMessage);
    let messages = this._buildMessages();
    let finalResponse = "";
    this._lastSig = null;
    this._repeatCount = 0;
    let allMsgs = [];
    let warned90 = false;
    let warned95 = false;
    const firstIteration = this._firstRun !== false;
    this._firstRun = false;
    let lastPct = -1;

    const activeTools = Tools.filterToolDeclarations(userMessage);

    for (let i = 0; i < this.maxIterations; i++) {
      if (onContextPct) {
        const baseMsgs = this._buildMessages();
        const curEst = estimateMessagesTokens(baseMsgs);
        const pct = Math.min(100, Math.ceil((curEst / this.maxContextTokens) * 100));
        if (pct !== lastPct) {
          onContextPct(pct);
          lastPct = pct;
        }
      }

      // Generate thinking message based on iteration count and context
      if (onThinking) {
        const thinkingMessages = [
          `Analyzing user request...`,
          `Checking available tools: ${activeTools.length} tools available`,
          `Evaluating context: ${allMsgs.length} messages`,
          `Planning response strategy...`,
          `Preparing to call tools if needed...`,
          `Reviewing conversation history...`,
          `Determining next action...`,
          `Processing information...`,
          `Synthesizing response...`,
          `Finalizing answer...`,
        ];
        const thinkingMsg = thinkingMessages[i % thinkingMessages.length];
        onThinking(thinkingMsg, i + 1);
      }

      const result = await this.llm.chatStream(messages, onContent || null, activeTools, signal);

      if (result.toolCalls && result.toolCalls.length > 0) {
        if (this._detectLoop(result.toolCalls)) {
          finalResponse = "(检测到工具调用循环, 已自动终止)";
          break;
        }

        const stepAssistant = {
          role: "assistant",
          content: null,
          reasoning_content: result.reasoningContent || "",
          tool_calls: result.toolCalls.map((tc) => ({
            id: tc.id,
            type: "function",
            function: { name: tc.function.name, arguments: tc.function.arguments },
          })),
        };
        allMsgs.push(stepAssistant);

        const toolMsgs = [];
        for (const tc of result.toolCalls) {
          const fnName = tc.function.name;
          let fnArgs = {};
          try { fnArgs = JSON.parse(tc.function.arguments); } catch (_) {}

          if (onToolCall) onToolCall(fnName, fnArgs, i + 1);

          const toolCheck = this._checkTool(fnName, fnArgs);
          if (toolCheck.status === "error") {
            const errorMsg = `[TOOL CHECK FAILED] ${toolCheck.message}`;
            if (onToolResult) onToolResult(fnName, errorMsg);
            toolMsgs.push({ role: "tool", tool_call_id: tc.id, name: fnName, content: errorMsg });
            allMsgs.push({ role: "tool", name: fnName, content: errorMsg });
            continue;
          }

          let toolResult;
          try { 
            toolResult = await Tools.executeTool(fnName, fnArgs); 
          }
          catch (e) { 
            toolResult = `error: ${e.message}`; 
          }

          const capped = String(toolResult).slice(0, MAX_TOOL_RESULT_CHARS);
          if (onToolResult) onToolResult(fnName, capped.slice(0, 300));
          toolMsgs.push({ role: "tool", tool_call_id: tc.id, name: fnName, content: capped });
          allMsgs.push({ role: "tool", name: fnName, content: capped.slice(0, 500) });
        }

        messages.push(stepAssistant);
        messages.push(...toolMsgs);

        // 智能压缩: 超过 8 轮工具调用后, 把旧结果截短
        if (i > 8) {
          for (let mi = 1; mi < messages.length - 2; mi++) {
            const m = messages[mi];
            if (m.role === "tool" && m.content && m.content.length > 200) {
              m.content = m.content.slice(0, 200) + "...(已截短)";
            }
          }
        }

        continue;
      }

      if (result.content) {
        allMsgs.push({ role: "assistant", content: result.content, reasoning_content: result.reasoningContent || "" });
        finalResponse = result.content; break;
      }
      allMsgs.push({ role: "assistant", content: "(empty)", reasoning_content: result.reasoningContent || "" });
      finalResponse = "(empty)"; break;
    }

    this.memory.addAssistant(finalResponse);

    try {
      saveTurn(userMessage, finalResponse, process.cwd(), allMsgs, this.sessionId);
    } catch (_) {}

    if (opts._noAutoSave) return finalResponse;

    setImmediate(async () => {
      try {
        const habitEntry = this.memory.searchEntries("habit", 3);
        if (habitEntry.length === 0) {
          const msgs = [
            { role: "system", content: "用户刚完成一个任务。请生成一条15字以内的用户偏好摘要(用save_memory保存, tags='habit')。只输出纯文本,不要任何格式。" },
            { role: "user", content: `任务: ${userMessage.slice(0, 300)}\n结果摘要: ${finalResponse.slice(0, 200)}` },
          ];
          const res = await this.llm.chat(msgs, null, signal);
          const habit = res.choices?.[0]?.message?.content?.trim().slice(0, 100);
          if (habit) this.memory.addRamEntry(habit, ["habit"]);
        }
      } catch (_) {}
    });

    return finalResponse;
  }

  _buildMessages() {
    return [
      { role: "system", content: this.systemPrompt },
      ...this.memory.getHistory(),
    ];
  }

  _emit(event, ...args) {
    if (this.callbacks[event]) this.callbacks[event](...args);
  }

  getUsage() { return this.llm.getUsage(); }
  reset() { this.memory.clear(); this.llm.resetUsage(); }

  estimateContextPct() {
    const msgs = this._buildMessages();
    const est = estimateMessagesTokens(msgs);
    return Math.min(100, Math.ceil((est / this.maxContextTokens) * 100));
  }

  getMaxContextTokens() { return this.actualContextWindow; }

  _checkTool(fnName, fnArgs) {
    const checks = [];
    
    const tool = Tools.getTool(fnName);
    if (!tool) {
      return { status: "error", message: `Tool "${fnName}" not found in registry` };
    }
    
    checks.push({ name: "Tool Exists", status: "OK" });
    
    if (tool.parameters && Array.isArray(tool.parameters)) {
      for (const param of tool.parameters) {
        if (param.required && !(param.name in fnArgs)) {
          checks.push({ name: `Param ${param.name}`, status: "MISSING", reason: "Required parameter" });
        }
      }
    }
    
    const fileTools = ["read", "write", "delete_file", "file_info", "search_replace"];
    if (fileTools.includes(fnName)) {
      if (!fnArgs.filePath && !fnArgs.path) {
        checks.push({ name: "File Path", status: "MISSING", reason: "filePath or path required" });
      }
    }
    
    const cmdTools = ["exec_console"];
    if (cmdTools.includes(fnName)) {
      if (!fnArgs.command) {
        checks.push({ name: "Command", status: "MISSING", reason: "command required" });
      }
    }
    
    const failed = checks.filter(c => c.status !== "OK");
    if (failed.length > 0) {
      const messages = failed.map(c => `${c.name}: ${c.status}${c.reason ? ` (${c.reason})` : ""}`);
      return { 
        status: "error", 
        message: `Pre-execution check failed:\n${messages.join("\n")}\n\nTool: ${fnName}\nArgs: ${JSON.stringify(fnArgs, null, 2)}`
      };
    }
    
    const passed = checks.filter(c => c.status === "OK").map(c => c.name).join(", ");
    return { 
      status: "ok", 
      message: `Pre-execution check passed: ${passed}` 
    };
  }
}

module.exports = Agent;
