// 命令处理器
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");
const { 
  listRecentTurns, searchHistory, getFileList, loadFileTurns, 
  listSessions, getSession, loadSessionTurns, globalSearch, 
  endSession, startSession 
} = require("../Mem/history");
const Tools = require("../Tools");
const presets = require("./presets.cjs");

const COMMANDS = [
  { cmd: "/help", desc: "显示帮助 / Show help" },
  { cmd: "/exit", desc: "退出程序 / Exit" },
  { cmd: "/reset", desc: "重置对话 / Reset" },
  { cmd: "/clear", desc: "清空对话 / Clear" },
  { cmd: "/version", desc: "显示版本 / Version" },
  { cmd: "/status", desc: "查看状态 / Status" },
  { cmd: "/ctx", desc: "上下文用量 / Context" },
  { cmd: "/tools", desc: "列出工具 / List tools" },
  { cmd: "/tools_more", desc: "全部工具(含扩展) / All tools" },
  { cmd: "/tool_search", desc: "搜索工具 / Search tools" },
  { cmd: "/tool_list_saved", desc: "已保存的工具 / Saved tools" },
  { cmd: "/tool_save", desc: "保存工具到文件 / Save tool" },
  { cmd: "/tool_del_saved", desc: "删除已保存工具 / Delete tool" },
  { cmd: "/temp", desc: "设置温度 (0-2) / Set temp" },
  { cmd: "/topp", desc: "设置 TopP (0-1)" },
  { cmd: "/token", desc: "设置最大输出 tokens / Max tokens" },
  { cmd: "/memory", desc: "记忆统计 / Memory stats" },
  { cmd: "/memory_list", desc: "列出记忆条目 / List memory" },
  { cmd: "/memory_search", desc: "搜索记忆 / Search memory" },
  { cmd: "/memory_del", desc: "删除记忆 / Delete memory" },
  { cmd: "/memory_clear", desc: "清空记忆 / Clear memory" },
  { cmd: "/compress", desc: "压缩上下文 / Compress" },
  { cmd: "/history", desc: "最近对话 / Recent history" },
  { cmd: "/history files", desc: "历史文件列表 / History files" },
  { cmd: "/history search", desc: "搜索历史 / Search history" },
  { cmd: "/history read", desc: "读取历史文件 / Read history" },
  { cmd: "/sp_server", desc: "API 服务状态 / Server status" },
  { cmd: "/sp_server start", desc: "启动 API 服务 / Start server" },
  { cmd: "/sp_server stop", desc: "停止 API 服务 / Stop server" },
  { cmd: "/sp_token", desc: "创建 API Token" },
  { cmd: "/sp_tokens", desc: "列出 API Tokens" },
  { cmd: "/sp_token_del", desc: "删除 API Token" },
  { cmd: "/sessions", desc: "列出会话 / List sessions" },
  { cmd: "/session", desc: "查看会话 / View session" },
  { cmd: "/session_search", desc: "搜索会话 / Search sessions" },
  { cmd: "/provider", desc: "切换 AI 提供商 / Provider" },
  { cmd: "/persona", desc: "设置对话角色 / Persona" },
  { cmd: "/llm", desc: "LLM 配置 / LLM config" },
  { cmd: "/retry", desc: "重试配置 / Retry config" },
  { cmd: "/network", desc: "网络检测 / Network check" },
  { cmd: "/histoken", desc: "历史 Token 统计 / Token history" },
  { cmd: "/trust", desc: "信任管理 / Trust management" },
  { cmd: "/untrust", desc: "取消信任 / Untrust" },
  { cmd: "/trusted", desc: "信任列表 / Trusted list" },
  { cmd: "/update", desc: "更新程序 / Update" },
  { cmd: "/mcp", desc: "MCP 服务状态 / MCP status" },
  { cmd: "/restore", desc: "恢复上次崩溃前的对话 / Restore session" },
];

module.exports = {
  COMMANDS,
  handleCommand: async function(cmd, rest, config, getAgent, addMsg, cols, ver, saveConfig, drawBox, drawBoxTitle, formatToken) {
    const say = (t) => addMsg("system", t);
    const a = getAgent();

    if (cmd === "help") {
      say(drawBox([
        "Sapni 帮助 / Sapni Help",
        ...COMMANDS.map(c => `${c.cmd.padEnd(18)} ${c.desc}`),
      ], cols));
      return true;
    }
    else if (cmd === "exit") {
      try {
        const histFile = path.join(os.homedir(), ".sapni", "history-tokens.json");
        let hist = { prompt: 0, completion: 0, sessions: 0 };
        try { if (fs.existsSync(histFile)) hist = JSON.parse(fs.readFileSync(histFile, "utf-8")); } catch (_) {}
        const cur = a.llm.getUsage();
        hist.prompt = (hist.prompt || 0) + (cur.prompt || 0);
        hist.completion = (hist.completion || 0) + (cur.completion || 0);
        hist.sessions = (hist.sessions || 0) + 1;
        fs.writeFileSync(histFile, JSON.stringify(hist), "utf-8");
      } catch (_) {}
      process.exit(0);
    }
    else if (cmd === "reset") {
      try {
        const histFile = path.join(os.homedir(), ".sapni", "history-tokens.json");
        let hist = { prompt: 0, completion: 0, sessions: 0 };
        try { if (fs.existsSync(histFile)) hist = JSON.parse(fs.readFileSync(histFile, "utf-8")); } catch (_) {}
        const cur = a.llm.getUsage();
        hist.prompt = (hist.prompt || 0) + (cur.prompt || 0);
        hist.completion = (hist.completion || 0) + (cur.completion || 0);
        hist.sessions = (hist.sessions || 0) + 1;
        fs.writeFileSync(histFile, JSON.stringify(hist), "utf-8");
      } catch (_) {}
      endSession(a.sessionId);
      a.reset();
      saveConfig(config);
      say("对话已重置，新会话已创建 / Chat reset");
      return true;
    }
    else if (cmd === "clear") {
      say("对话已清空 / Chat cleared");
      return true;
    }
    else if (cmd === "version") {
      say("Sapni v" + ver + " — " + config.llm.model);
      return true;
    }
    else if (cmd === "status") {
      const usage = a.getUsage();
      const mem = a.memory.stats();
      const pct = a.estimateContextPct();
      const names = Tools.listToolNames();
      say(drawBox([
        "模型: " + config.llm.model + "  温度: " + config.llm.temperature,
        "Token: 输入 " + usage.prompt + " · 输出 " + usage.completion,
        "上下文: " + pct + "% (上限 " + formatToken(a.getMaxContextTokens()) + " tokens)",
        "记忆: ROM" + (mem.romEntries || mem.entries) + " RAM" + (mem.ramEntries || 0) + " · 历史 " + mem.historyMessages + " 轮",
        "工具: " + names.length + " 个 — " + names.slice(0, 8).join(", ") + (names.length > 8 ? " ..." : ""),
      ], cols));
      return true;
    }
    else if (cmd === "restore") {
      const Agent = require("./agent.cjs");
      if (!Agent.hasCheckpoint()) {
        say(drawBox(["(无可用恢复文件 / No checkpoint found)"], cols));
        return true;
      }
      const info = a.restoreFromCheckpoint();
      if (!info) {
        say(drawBox(["恢复失败 / Restore failed"], cols));
        return true;
      }
      const d = new Date(info.time).toLocaleString();
      say(drawBox([
        "✓ 对话已恢复 / Session restored",
        "模型: " + (info.model || "?") + " | 消息: " + info.messageCount + " 条",
        "记录时间: " + d,
      ], cols));
      a._clearCheckpoint();
      return true;
    }
    else if (cmd === "mcp") {
      try {
        const mcpStatus = a.getMCPStatus();
        const lines = [`=== MCP 服务状态 ===`];
        if (mcpStatus.enabled) {
          lines.push(`状态: 已启用`);
          lines.push(`类型: ${mcpStatus.clientType || "未知"}`);
          if (mcpStatus.url) lines.push(`地址: ${mcpStatus.url}`);
          if (mcpStatus.source) lines.push(`来源: ${mcpStatus.source}`);
          if (mcpStatus.mode) lines.push(`传输: ${mcpStatus.mode}`);
          lines.push(`已加载工具: ${mcpStatus.toolCount} 个`);
          if (mcpStatus.tools && mcpStatus.tools.length > 0) {
            lines.push(``);
            lines.push(`工具列表:`);
            for (const t of mcpStatus.tools) {
              const desc = (t.description || "").slice(0, 80);
              lines.push(`  · ${t.name}${desc ? " — " + desc : ""}`);
            }
          }
        } else {
          lines.push(`状态: 未启用`);
          lines.push(`提示: 在配置中启用 mcp (mcp.enabled = true)`);
        }
        say(drawBox(lines, cols));
      } catch (e) {
        say(drawBox([`MCP 错误: ${e.message}`], cols));
      }
      return true;
    }

    return false; // 未处理的命令
  }
};
