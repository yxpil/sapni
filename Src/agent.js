const os = require("os");
const LLMClient = require("./llm");
const Tools = require("../Tools");
const { ConversationMemory } = require("../Mem");
const { saveTurn, searchHistory, getFileList, loadFileTurns } = require("../Mem/history");

const MAX_ITERATIONS = 500;
const MAX_TOOL_RESULT_CHARS = 3000;

function buildSystemInfo() {
  const home = os.homedir();
  const cwd = process.cwd();
  return [
    `系统: ${os.type()} ${os.release()} (${os.arch()})`,
    `主机: ${os.hostname()}`,
    `用户主目录: ${home}`,
    `当前工作目录: ${cwd}`,
    `终端宽度: ${process.stdout.columns || 80} 列`,
    `Node: ${process.version}`,
    `时间: ${new Date().toISOString()}`,
  ].join(" | ");
}

function estimateTokens(text) {
  let chars = 0;
  let cjk = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0);
    if (code > 127) cjk++;
    chars++;
  }
  return Math.ceil(cjk * 1.5 + (chars - cjk) * 0.35);
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
    this.systemPrompt = `${config.systemPrompt}\n\n[模型身份] ${config.llm?.model || 'unknown'} (Provider: ${config.llm?.provider || 'unknown'})\n\n[系统环境]\n${this.systemInfo}`;
    if (config.persona) {
      this.systemPrompt = `[身份设定] ${config.persona}\n\n${this.systemPrompt}`;
    }
    this.autoCompressThreshold = config.memory?.autoCompressThreshold || 5000;
    this.maxContextTokens = (config.llm?.maxTokens || 65536) * 0.75;
    this._lastToolCalls = [];

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
      "compress_context", "agent_self_invoke", "set_timer",
      "save_tool", "delete_tool_file", "list_saved_tools",
      "forget_conversation", "restart_session",
      "search_history", "list_history_files",
      "list_sessions", "view_session", "search_sessions",
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
      case "save_memory": {
        const tags = args.tags ? args.tags.split(",").map((t) => t.trim()) : [];
        const entry = this.memory.addEntry(args.content, tags);
        return entry ? `[OK] 已保存 #${entry.id}: ${entry.text}` : "[失败] 内容为空";
      }
      case "list_memory": {
        const all = this.memory.getAllEntries().slice(-(args.limit || 20));
        return this._fmtEntries(all);
      }
      case "delete_memory": {
        const ok = this.memory.removeEntry(args.id);
        return ok ? `[OK] 已删除 #${args.id}` : `[不存在] #${args.id}`;
      }
      case "compress_context": {
        const compressed = this.memory.compressHistory();
        if (!compressed) return "[跳过] 对话太短";
        const summary = await this._summarize(compressed);
        this.memory.addEntry(summary, ["auto-summary"]);
        this.memory.clear();
        return `[OK] 上下文已压缩, 摘要存入记忆: ${summary}`;
      }
      case "agent_self_invoke": {
        if (this.callbacks.onSelfInvoke) return this.callbacks.onSelfInvoke(args.task, args.context);
        return "[跳过] self_invoke 未配置回调";
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
        if (summary) { this.memory.addEntry(summary, ["auto-summary"]); }
        return summary
          ? `[OK] 对话已遗忘, 摘要已保存: ${summary}`
          : "[OK] 对话历史已清空, 像全新对话一样";
      }
      case "restart_session": {
        this.memory.clear();
        this.memory.clearEntries();
        this.llm.resetUsage();
        return "[OK] 会话已完全重启: 历史+记忆+token计数均已重置. 可以开始全新任务.";
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
        return viewListSessions(args.limit || 20);
      }
      case "view_session": {
        return viewSession(args.session_id, args.limit || 50);
      }
      case "search_sessions": {
        return viewSearchSessions(args.query, args.limit || 10);
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
      const res = await this.llm.chat(msgs);
      return (res.choices?.[0]?.message?.content || text.slice(0, 190)).slice(0, 190);
    } catch (_) {
      return text.slice(0, 190);
    }
  }

  _fmtEntries(entries) {
    if (!entries || entries.length === 0) return "(无记忆条目)";
    return entries.map((e) => `#${e.id} [${e.tags?.join(",") || "-"}] ${e.text}`).join("\n");
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

  /**
   * 检测用户消息是否为"操作类请求"（建文件、运行代码等）
   * 如果是，强制模型必须调用工具，不能只回文本
   */
  _isActionRequest(msg) {
    if (!msg || typeof msg !== "string") return false;
    const msgTrimmed = msg.trim();
    // 纯知识性问题排除 — 这些只是问概念，不需要调工具
    if (/^(怎么(用|写|学|配置|设置|改|实现|安装|编译|跑|调|看)|如何|什么是|为什么(要|会|不|没有)|哪个(是|更|比较)|有哪些|有没有(什么|人|办法|方法|工具|项目)|能不能解释|可不可以解释|请问(什么是|怎么|如何|什么是|什么叫做))/.test(msgTrimmed)) return false;
    // 操作类关键词匹配
    const actionPatterns = [
      /建|创建|生成|新建|搭建|部署/,
      /写|写入|保存|输出|导出|输出到/,
      /删|除|移除|清理|清空|粉碎/,
      /移动|复制|重命名|拷贝/,
      /运行|执行|跑|启动|安装|编译|构建|发布/,
      /修改|编辑|替换|追加|插入|更新|改/,
      /搜索|查找|查一?下|找一?下|读取|打开|查看/,
      /下载|上传|克隆|拉取|推送|同步/,
      /测试|调试|检查|验证|确认|lint|格式化|分析/,
      /桌面|目录|文件夹|文件|代码|项目|仓库|脚本/,
    ];
    for (const re of actionPatterns) {
      if (re.test(msg)) return true;
    }
    return false;
  }

  _retryPredicate(userMsg, allMsgs, finalResponse) {
    // 如果最终只有文本回复且没有调用任何工具，需要重试
    if (!finalResponse) return false;
    const calledTools = allMsgs.filter(m => m.role === "tool");
    return calledTools.length === 0 && this._isActionRequest(userMsg);
  }

  async run(userMessage, opts = {}) {
    const { onContent, onToolCall, onToolResult, onThinking, onContextPct } = opts;
    this.memory.addUser(userMessage);
    let messages = this._buildMessages();
    let finalResponse = "";
    this._lastSig = null;
    this._repeatCount = 0;
    let allMsgs = [];
    let warned90 = false;
    let warned95 = false;

    const activeTools = Tools.filterToolDeclarations(userMessage);
    const isAction = this._isActionRequest(userMessage);
    this._retried = false;

    for (let i = 0; i < this.maxIterations; i++) {
      if (onContextPct || onThinking) {
        const baseMsgs = this._buildMessages();
        const curEst = estimateMessagesTokens(baseMsgs);
        const pct = Math.min(100, Math.ceil((curEst / this.maxContextTokens) * 100));
        if (onContextPct) onContextPct(pct);
      }

      if (onThinking) onThinking();

      // 操作请求首次调用强制 required，否则 auto
      const toolChoice = (isAction && i === 0 && !this._retried) ? "required" : "auto";
      const result = await this.llm.chatStream(messages, onContent || null, activeTools, toolChoice);

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

          let toolResult;
          try { toolResult = await Tools.executeTool(fnName, fnArgs); }
          catch (e) { toolResult = `error: ${e.message}`; }

          const capped = String(toolResult).slice(0, MAX_TOOL_RESULT_CHARS);
          if (onToolResult) onToolResult(fnName, capped.slice(0, 300));
          toolMsgs.push({ role: "tool", tool_call_id: tc.id, name: fnName, content: capped });
          allMsgs.push({ role: "tool", name: fnName, content: capped.slice(0, 500) });
        }

        messages.push(stepAssistant);
        messages.push(...toolMsgs);
        continue;
      }

      if (result.content) {
        allMsgs.push({ role: "assistant", content: result.content, reasoning_content: result.reasoningContent || "" });
        finalResponse = result.content; break;
      }
      allMsgs.push({ role: "assistant", content: "(empty)", reasoning_content: result.reasoningContent || "" });
      finalResponse = "(empty)"; break;
    }

    // 重试兜底: 操作请求但模型只回了文本且没调过工具 → 强制再试一次
    if (isAction && !this._retried && finalResponse && finalResponse !== "(empty)") {
      const calledTools = allMsgs.filter(m => m.role === "tool" || m.tool_calls);
      if (calledTools.length === 0) {
        this._retried = true;
        // 重置会话状态, 从原始 history 重建 messages (不含失败的回复)
        messages = this._buildMessages();
        allMsgs = [];
        finalResponse = "";

        for (let i = 0; i < this.maxIterations; i++) {
          if (onThinking) onThinking();
          const result = await this.llm.chatStream(messages, onContent || null, activeTools, "required");

          if (result.toolCalls && result.toolCalls.length > 0) {
            if (this._detectLoop(result.toolCalls)) {
              finalResponse = "(检测到工具调用循环, 已自动终止)";
              break;
            }
            const stepAssistant = {
              role: "assistant", content: null,
              reasoning_content: result.reasoningContent || "",
              tool_calls: result.toolCalls.map((tc) => ({
                id: tc.id, type: "function",
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
              let toolResult;
              try { toolResult = await Tools.executeTool(fnName, fnArgs); }
              catch (e) { toolResult = `error: ${e.message}`; }
              const capped = String(toolResult).slice(0, MAX_TOOL_RESULT_CHARS);
              if (onToolResult) onToolResult(fnName, capped.slice(0, 300));
              toolMsgs.push({ role: "tool", tool_call_id: tc.id, name: fnName, content: capped });
              allMsgs.push({ role: "tool", name: fnName, content: capped.slice(0, 500) });
            }
            messages.push(stepAssistant);
            messages.push(...toolMsgs);
            continue;
          }
          if (result.content) {
            allMsgs.push({ role: "assistant", content: result.content, reasoning_content: result.reasoningContent || "" });
            finalResponse = result.content; break;
          }
          allMsgs.push({ role: "assistant", content: "(empty)", reasoning_content: result.reasoningContent || "" });
          finalResponse = "(empty)"; break;
        }
      }
    }

    this.memory.addAssistant(finalResponse);

    try {
      saveTurn(userMessage, finalResponse, process.cwd(), allMsgs);
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
          const res = await this.llm.chat(msgs);
          const habit = res.choices?.[0]?.message?.content?.trim().slice(0, 100);
          if (habit) this.memory.addEntry(habit, ["habit"]);
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

  getMaxContextTokens() { return this.maxContextTokens; }
}

module.exports = Agent;
