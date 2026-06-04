const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { spawn } = require("child_process");
const Agent = require("./agent");
const Tools = require("../Tools");
const presets = require("./presets.cjs");
const { listRecentTurns, searchHistory, getFileList, loadFileTurns, listSessions, getSession, loadSessionTurns, globalSearch, endSession, startSession } = require("../Mem/history");

const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  gray: "\x1b[90m",
};

let config;
let agent;
let rl;
let pendingPermission = null;
let permissionResolve = null;
let isAgentRunning = false;
let sigintCount = 0;
let sigintTimer = null;

function emoji(key) {
  return config.ui?.emoji?.[key] || "";
}

function loadConfig() {
  const configPath = path.join(__dirname, "..", "config.json");
  const raw = fs.readFileSync(configPath, "utf-8");
  config = JSON.parse(raw);
}

function saveConfig() {
  const configPath = path.join(__dirname, "..", "config.json");
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
}

function maxWidth() {
  const cfgMax = config.ui?.maxWidth || 0;
  const termW = process.stdout.columns || 80;
  return cfgMax > 0 ? Math.min(cfgMax, termW) : termW;
}

function div(ch) {
  const c = ch || config.ui?.dividerChar || "─";
  return C.dim + c.repeat(Math.max(1, maxWidth() - 1)) + C.reset;
}

function pipeToPager(text) {
  return new Promise((resolve) => {
    const p = spawn("less", ["-R", "-F", "-X"], { stdio: ["pipe", "inherit", "inherit"] });
    p.stdin.write(text);
    p.stdin.end();
    p.on("close", resolve);
  });
}

function showLogo() {
  if (config.ui?.showLogo && config.ui?.logoPath) {
    const logoPath = path.resolve(__dirname, "..", config.ui.logoPath);
    if (fs.existsSync(logoPath)) {
      process.stdout.write(C.cyan + fs.readFileSync(logoPath, "utf-8") + C.reset);
    }
  }
}

function wordWrap(text, width) {
  if (!text) return "";
  const w = width || maxWidth() - 4;
  const plainLen = (s) => s.replace(/\x1b\[[0-9;]*m/g, "").length;
  const lines = [];
  for (const para of text.split("\n")) {
    if (!para.trim()) { lines.push(""); continue; }
    let cur = "";
    for (const ch of para) {
      if (plainLen(cur + ch) >= w) { lines.push(cur); cur = ""; }
      cur += ch;
    }
    if (cur) lines.push(cur);
  }
  return lines.join("\n");
}

function typeset(text) {
  const w = Math.max(40, maxWidth() - 2);
  const lines = text.split("\n");
  const out = [];
  let inCode = false;
  let codeLines = [];
  let codeMinIndent = Infinity;
  let inTable = false;
  let tableRows = [];
  let tableAlign = [];

  function flushCode() {
    if (codeLines.length === 0) return;
    const maxW = Math.min(w - 4, 50);
    out.push(C.dim + "  ┌" + "─".repeat(maxW) + C.reset);
    for (const cl of codeLines) {
      const trimmed = cl.slice(codeMinIndent).replace(/\t/g, "  ");
      out.push(`  ${C.dim}│${C.reset} ${C.green}${trimmed}${C.reset}`);
    }
    out.push(C.dim + "  └" + "─".repeat(maxW) + C.reset);
    codeLines = [];
    codeMinIndent = Infinity;
  }

  function flushTable() {
    if (tableRows.length === 0) return;
    const ncols = tableRows[0].length;
    const colW = new Array(ncols).fill(0);
    for (const row of tableRows) {
      for (let i = 0; i < row.length; i++) {
        colW[i] = Math.max(colW[i], row[i].replace(/\x1b\[[0-9;]*m/g, "").length);
      }
    }
    const totalW = colW.reduce((a, b) => a + b, 0) + ncols * 3 + 1;
    const maxColW = w - 2;
    let scale = 1;
    if (totalW > maxColW) {
      scale = maxColW / totalW;
      for (let i = 0; i < colW.length; i++) colW[i] = Math.max(3, Math.floor(colW[i] * scale));
    }
    for (let ri = 0; ri < tableRows.length; ri++) {
      const row = tableRows[ri];
      const cells = row.map((c, ci) => {
        const plain = c.replace(/\x1b\[[0-9;]*m/g, "");
        const pad = colW[ci] - plain.length;
        const align = tableAlign[ci] || "left";
        if (align === "right") return " ".repeat(pad) + c;
        if (align === "center") return " ".repeat(Math.floor(pad / 2)) + c + " ".repeat(Math.ceil(pad / 2));
        return c + " ".repeat(pad);
      });
      const cellStyle = ri === 0 ? C.bold : C.reset;
      out.push(`  ${cellStyle}${cells.join(` ${C.dim}│${C.reset} `)}${C.reset}`);
    }
    tableRows = [];
    tableAlign = [];
  }

  for (const raw of lines) {
    if (raw.trim().startsWith("```")) {
      if (inCode) { flushCode(); inCode = false; }
      else { inCode = true; flushTable(); }
      continue;
    }
    if (inCode) {
      const stripped = raw.replace(/\t/g, "  ");
      const indent = stripped.match(/^ */)[0].length;
      if (stripped.trim()) codeMinIndent = Math.min(codeMinIndent, indent);
      codeLines.push(stripped);
      continue;
    }
    const isSep = /^\|[\s\-:|]+\|$/.test(raw.trim());
    const isRow = /^\|[\s\S]+\|$/.test(raw.trim());
    if (isSep && tableRows.length === 1) {
      const cells = raw.split("|").filter((c) => c.trim() !== "").map((c) => c.trim());
      tableAlign = cells.map((c) => {
        if (c.startsWith(":") && c.endsWith(":")) return "center";
        if (c.endsWith(":")) return "right";
        return "left";
      });
      continue;
    }
    if (isRow) {
      if (!inTable) { flushCode(); inTable = true; }
      const parts = raw.split("|");
      const start = parts[0].trim() ? 0 : 1;
      const end = parts[parts.length - 1].trim() ? parts.length : parts.length - 1;
      tableRows.push(parts.slice(start, end).map((c) => c.trim()));
      continue;
    }
    if (inTable && tableRows.length > 0) { flushTable(); inTable = false; }

    let line = raw;
    if (/^#{1,6}\s/.test(line)) {
      const level = line.match(/^(#+)/)[1].length;
      const title = line.replace(/^#+\s*/, "");
      out.push("");
      if (level === 1) {
        out.push(C.bold + C.cyan + `  ━━ ${title} ━━` + C.reset);
      } else if (level === 2) {
        out.push(C.bold + `  ▎${title}` + C.reset);
        out.push(C.dim + "  " + "─".repeat(Math.min(w - 4, title.replace(/\x1b\[[0-9;]*m/g, "").length)) + C.reset);
      } else {
        out.push(C.bold + `  ${title}` + C.reset);
      }
      continue;
    }
    if (/^\s*[-*]\s/.test(line)) {
      out.push(`  ${C.yellow}•${C.reset} ${wordWrap(line.replace(/^\s*[-*]\s*/, ""), w - 4)}`);
      continue;
    }
    if (/^\s*\d+[.)]\s/.test(line)) {
      const num = line.match(/^\s*(\d+)[.)]/)[1];
      out.push(`  ${C.yellow}${num}.${C.reset} ${wordWrap(line.replace(/^\s*\d+[.)]\s*/, ""), w - 5)}`);
      continue;
    }
    if (/^>\s/.test(line)) {
      out.push(`${C.dim}  ▎ ${wordWrap(line.replace(/^>\s*/, ""), w - 5)}${C.reset}`);
      continue;
    }
    if (/^[-\*]{3,}\s*$/.test(line.trim())) {
      out.push(C.dim + "  · · · · ·" + C.reset);
      continue;
    }
    line = line.replace(/`([^`]+)`/g, C.green + "$1" + C.reset);
    line = line.replace(/\*\*\*(.+?)\*\*\*/g, C.bold + C.yellow + "$1" + C.reset);
    line = line.replace(/\*\*(.+?)\*\*/g, C.bold + "$1" + C.reset);
    line = line.replace(/\*(.+?)\*/g, C.dim + "$1" + C.reset);
    line = line.replace(/~~(.+?)~~/g, C.dim + C.red + "$1" + C.reset);
    line = line.replace(/\[([^\]]+)\]\(([^)]+)\)/g, C.cyan + "$1" + C.reset + C.dim + " ($2)" + C.reset);
    if (!line.trim()) {
      flushCode();
      out.push("");
      continue;
    }
    out.push("  " + "\x1b[38;5;248m" + wordWrap(line, w - 2) + C.reset);
  }
  flushCode();
  flushTable();
  return out.join("\n");
}

function inlineTypeset(line) {
  if (/^#{1,6}\s/.test(line)) {
    const level = line.match(/^(#+)/)[1].length;
    const title = line.replace(/^#+\s*/, "");
    if (level === 1) return `\n${C.bold}${C.cyan}  ━━ ${title} ━━${C.reset}`;
    if (level === 2) return `\n${C.bold}  ▎${title}${C.reset}`;
    return `\n${C.bold}  ${title}${C.reset}`;
  }
  if (/^\s*[-*]\s/.test(line)) {
    return `  ${C.yellow}•${C.reset} ${line.replace(/^\s*[-*]\s*/, "")}`;
  }
  if (/^\s*\d+[.)]\s/.test(line)) {
    const num = line.match(/^\s*(\d+)[.)]/)[1];
    return `  ${C.yellow}${num}.${C.reset} ${line.replace(/^\s*\d+[.)]\s*/, "")}`;
  }
  if (/^>\s/.test(line)) {
    return `${C.dim}  ▎ ${line.replace(/^>\s*/, "")}${C.reset}`;
  }
  if (/^[-\*]{3,}\s*$/.test(line.trim())) {
    return C.dim + "  · · · · ·" + C.reset;
  }
  let l = line;
  l = l.replace(/`([^`]+)`/g, C.green + "$1" + C.reset);
  l = l.replace(/\*\*\*(.+?)\*\*\*/g, C.bold + C.yellow + "$1" + C.reset);
  l = l.replace(/\*\*(.+?)\*\*/g, C.bold + "$1" + C.reset);
  l = l.replace(/\*(.+?)\*/g, C.dim + "$1" + C.reset);
  l = l.replace(/~~(.+?)~~/g, C.dim + C.red + "$1" + C.reset);
  l = l.replace(/\[([^\]]+)\]\(([^)]+)\)/g, C.cyan + "$1" + C.reset + C.dim + " ($2)" + C.reset);
  if (!l.trim()) return "";
  return "  " + "\x1b[38;5;248m" + l + C.reset;
}

function ctxBar(pct) {
  const w = maxWidth();
  const barW = Math.min(w - 4, 30);
  const filled = Math.max(1, Math.round((pct / 100) * barW));
  const empty = barW - filled;
  const barChar = emoji("ctxBar") || "━";
  const color = pct > 80 ? C.red : pct > 60 ? C.yellow : C.green;
  return C.dim + "[" + C.reset + color + barChar.repeat(filled) + C.reset
    + C.dim + "─".repeat(empty) + "]" + C.reset
    + ` ${color}${pct}%${C.reset}`;
}

ctxBar._frame = 0;
ctxBar.live = function (pct, maxBarW) {
  const barW = maxBarW || Math.min(maxWidth() - 4, 30);
  const filled = Math.max(1, Math.round((pct / 100) * barW));
  const empty = barW - filled;
  const color = pct > 80 ? C.red : pct > 60 ? C.yellow : C.green;
  const brightColor = pct > 80 ? "\x1b[91m" : pct > 60 ? "\x1b[93m" : "\x1b[92m";
  ctxBar._frame++;
  const phase = ctxBar._frame % 6;
  const breatheColor = phase < 3 ? brightColor : "\x1b[2m";
  const bar = "\x1b[1m█\x1b[0m" + color + "━".repeat(Math.max(0, filled - 1)) + C.reset;
  return C.dim + "[" + C.reset + bar
    + C.dim + "─".repeat(Math.max(0, empty)) + "]" + C.reset
    + ` ${breatheColor}${pct}%${C.reset}`;
};

function tokenBar(promptTokens, completionTokens, elapsedMs, ctxPct) {
  const w = maxWidth();
  const elapsed = (elapsedMs / 1000).toFixed(1) + "s";
  const parts = [
    `${emoji("tokenIn")}${C.cyan}${promptTokens}${C.reset}`,
    `${emoji("tokenOut")}${C.magenta}${completionTokens}${C.reset}`,
    `${emoji("clock")}${C.yellow}${elapsed}${C.reset}`,
    `${C.dim}∑${promptTokens + completionTokens}${C.reset}`,
  ];
  let line = parts.join("  ");
  if (ctxPct != null) {
    line += "  " + ctxBar(ctxPct);
  }
  const plainLen = line.replace(/\x1b\[[0-9;]*m/g, "").length;
  const dashTotal = Math.max(0, w - plainLen - 2);
  return C.dim + "─".repeat(Math.max(0, Math.floor(dashTotal / 2))) + C.reset
    + " " + line + " "
    + C.dim + "─".repeat(Math.max(0, Math.ceil(dashTotal / 2))) + C.reset;
}

function toolEmoji(name) {
  const em = config.ui?.emoji || {};
  if (name.startsWith("read_") || name === "list_dir" || name === "read" || name === "file_info" || name === "ls" || name === "tree") return em.fileRead || "";
  if (name.startsWith("write_") || name === "copy_file" || name === "move_file" || name === "write") return em.fileWrite || "";
  if (name.startsWith("search_") || name.startsWith("find_") || name === "grep" || name === "glob") return em.search || "";
  if (name === "exec_console" || name === "wait_command" || name === "check_command_status") return em.exec || "";
  if (name === "web_fetch" || name === "web_search" || name === "open_preview") return em.web || "";
  if (name === "todo_write") return em.todo || "";
  if (name === "forget_conversation") return em.forget || "";
  if (name === "restart_session") return em.restart || "";
  if (name === "search_replace" || name === "edit_lines") return "✏";
  return em.toolCall || "";
}

function inputValidator(line) {
  const sanitized = line.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "");
  if (sanitized.length > 10000) return sanitized.slice(0, 10000);
  return sanitized;
}

function showHelp() {
  console.log(div("="));
  console.log(C.bold + C.cyan + "  Sapni 控制台命令" + C.reset);
  console.log(div("="));
  const cmds = [
    ["/help", "显示此帮助"], ["/exit", "退出程序"], ["/reset", "重置当前对话"],
    ["/tools", "列出所有工具"], ["/tool_search <q>", "搜索工具"],
    ["/tools_more", "查看全部工具(含扩展)"],
    ["/temp <0-2>", "设置温度"], ["/topp <0-1>", "设置 TopP"], ["/token <n>", "设置最大输出token"],
    ["/provider", "一键切换 AI 提供商"],
    ["/persona <描述>", "设置 AI 身份/性格"],
    ["/persona reset", "重置身份为默认"],
    ["/memory", "查看记忆统计"], ["/memory_list [n]", "列出记忆条目"],
    ["/memory_search <q>", "搜索记忆"], ["/memory_del <id>", "删除记忆"],
    ["/memory_clear", "清空所有记忆"], ["/compress", "手动压缩上下文"],
    ["/history [n]", "查看最近n条历史对话"], ["/history files", "查看历史文件列表"],
    ["/history search <q>", "搜索历史对话"], ["/history read <f>", "读取文件含完整工具调用"],
    ["/sessions [n]", "列出对话session"], ["/session <id>", "查看某个session"],
    ["/session_search <q>", "全局搜索session"],
    ["/tool_save <name>", "持久化保存工具"], ["/tool_list_saved", "列出持久化工具"],
    ["/tool_del_saved <name>", "删除持久化工具"],
    ["/trusted", "查看受信任工具"], ["/trust <name>", "永久信任工具"],
    ["/untrust <name>", "取消信任"], ["/status", "查看当前状态"],
    ["/ctx", "查看上下文使用量"],
    ["/api", "查看/配置 API 设置"],
    ["/api key <KEY>", "设置 API Key"],
    ["/api url <URL>", "设置 API 地址"],
    ["/api model <MODEL>", "设置模型名称"], ["/version", "显示版本号"],
  ];
  for (const [cmd, desc] of cmds) {
    console.log(`  ${C.yellow + cmd.padEnd(22) + C.reset} ${desc}`);
  }
  console.log(div("="));
}

function showStatus() {
  const usage = agent ? agent.getUsage() : { prompt: 0, completion: 0 };
  const mem = agent ? agent.memory.stats() : {};
  const ctxPct = agent ? agent.estimateContextPct() : 0;
  console.log(div("="));
  console.log(`  模型: ${C.bold}${config.llm.model}${C.reset}  温度: ${config.llm.temperature}`);
  console.log(`  Tokens 累计: ${emoji("tokenIn")}${C.cyan}${usage.prompt}${C.reset}  ${emoji("tokenOut")}${C.magenta}${usage.completion}${C.reset}`);
  console.log(`  上下文使用: ${ctxBar(ctxPct)}`);
  console.log(`  记忆: ROM${mem.romEntries || mem.entries || 0} RAM${mem.ramEntries || 0}  · 历史 ${mem.historyMessages || 0} 条`);
  const tools = Tools.listToolNames();
  console.log(`  工具: ${tools.length} 个 — ${tools.slice(0, 8).join(", ")}${tools.length > 8 ? " ..." : ""}`);
  console.log(div("="));
}

async function askPermission(name, args) {
  return new Promise((resolve) => {
    const argStr = JSON.stringify(args).slice(0, 120);
    console.log(`\n  ${C.yellow}${emoji("warn")} 权限请求 ${name}${C.reset}  ${C.dim}${argStr}${C.reset}`);
    console.log(`  ${C.green}[Y]${C.reset}放行  ${C.blue}[A]${C.reset}永久  ${C.red}[N]${C.reset}拒绝`);
    process.stdout.write("  > ");
    permissionResolve = (answer) => resolve(answer);
  });
}

function handlePermissionResponse(line) {
  if (!permissionResolve) return false;
  const l = line.trim().toLowerCase();
  if (l === "y" || l === "yes") { permissionResolve("once"); permissionResolve = null; return true; }
  if (l === "a" || l === "always") { permissionResolve("always"); permissionResolve = null; return true; }
  if (l === "n" || l === "no") { permissionResolve("deny"); permissionResolve = null; return true; }
  return false;
}

async function onPermission(name, args) {
  const result = await askPermission(name, args);
  if (result === "always") {
    Tools.addTrusted(name);
    config.tools.trustedTools = [...new Set([...(config.tools?.trustedTools || []), name])];
    saveConfig();
    console.log(`  ${C.green}已永久信任 ${name}${C.reset}\n`);
    return true;
  }
  if (result === "once") { console.log(`  ${C.green}本次放行${C.reset}\n`); return true; }
  console.log(`  ${C.red}已拒绝${C.reset}\n`);
  return false;
}

function buildAgent() {
  agent = new Agent(config, {
    onPermission,
    onTimer: (seconds, message) => {
      setTimeout(() => {
        console.log(`\n  ${C.magenta}[定时通知 ${seconds}s]${C.reset} ${message}`);
        if (agent) {
          runUserInput(`[系统定时通知 | ${seconds}秒前] ${message}`).catch((e) => {
            console.log(`${C.red}${emoji("error")} 定时任务错误: ${e.message}${C.reset}`);
            rl.prompt();
          });
        }
      }, seconds * 1000);
    },
  });
}

async function handleSlashCommand(input) {
  const parts = input.slice(1).trim().split(/\s+/);
  const cmd = parts[0].toLowerCase();
  const rest = parts.slice(1).join(" ");

  switch (cmd) {
    case "help": showHelp(); break;
    case "exit":
      console.log(C.dim + `再见~ ${emoji("done")}` + C.reset);
      process.exit(0);
    case "reset":
      endSession(agent.sessionId);
      agent.reset();
      agent.sessionId = startSession();
      console.log(`${C.green}对话已重置, 新会话已创建${C.reset}`);
      break;
    case "tools": {
      const names = Tools.listToolNames();
      const baseTools = names.filter((n) => !["forget_conversation", "restart_session", "todo_write", "search_replace", "glob", "grep", "read", "write", "ls", "web_search", "check_command_status", "open_preview", "get_diagnostics", "skill"].includes(n));
      console.log(div());
      for (const n of baseTools) {
        const t = Tools.getTool(n);
        const mark = t?.dangerous ? C.yellow + "⚠" + C.reset : " ";
        console.log(`  ${mark} ${C.cyan}${n}${C.reset} ${C.dim}${t?.description || ""}${C.reset}`);
      }
      console.log(C.dim + `  还有 ${names.length - baseTools.length} 个扩展工具, 输入 /tools_more 查看全部` + C.reset);
      console.log(div());
      break;
    }
    case "tools_more": {
      const names = Tools.listToolNames();
      console.log(div());
      for (const n of names) {
        const t = Tools.getTool(n);
        const mark = t?.dangerous ? C.yellow + "⚠" + C.reset : " ";
        console.log(`  ${mark} ${C.cyan}${n}${C.reset} ${C.dim}${t?.description || ""}${C.reset}`);
      }
      console.log(div());
      console.log(`  共 ${names.length} 个工具`);
      break;
    }
    case "ctx": {
      const pct = agent.estimateContextPct();
      const maxCtx = agent.getMaxContextTokens();
      const usage = agent.getUsage();
      console.log(div());
      console.log(`  上下文: ${ctxBar(pct)}  上限: ${maxCtx} tokens`);
      console.log(`  累计消耗: ▾${usage.prompt}  ▴${usage.completion}  ∑${usage.prompt + usage.completion}`);
      console.log(`  提示: 上下文 >80% 时可输入 /compress 压缩或让AI调用 forget_conversation`);
      console.log(div());
      break;
    }
    case "api": {
      const subParts = rest.trim().split(/\s+/);
      const sub = subParts[0]?.toLowerCase();
      const val = subParts.slice(1).join(" ").trim();
      if (sub === "key") {
        if (!val) { console.log(`用法: /api key <你的API Key>`); break; }
        if (val.length < 10) { console.log(`${C.red}Key 太短，请检查${C.reset}`); break; }
        config.llm.apiKey = val;
        saveConfig();
        buildAgent();
        console.log(`${C.green}API Key 已更新 (${val.slice(0, 8)}...)${C.reset}`);
      } else if (sub === "url") {
        if (!val) { console.log(`用法: /api url <API地址>\n  例: /api url https://api.deepseek.com/v1`); break; }
        config.llm.baseURL = val.replace(/\/+$/, "");
        saveConfig();
        buildAgent();
        console.log(`${C.green}API 地址已更新: ${config.llm.baseURL}${C.reset}`);
      } else if (sub === "model") {
        if (!val) { console.log(`用法: /api model <模型名>\n  例: /api model deepseek-chat`); break; }
        config.llm.model = val;
        saveConfig();
        buildAgent();
        console.log(`${C.green}模型已更新: ${config.llm.model}${C.reset}`);
      } else if (sub === "topp") {
        const v = parseFloat(val);
        if (isNaN(v) || v < 0 || v > 1) { console.log(`用法: /api topp <0-1>\n  例: /api topp 0.95`); break; }
        config.llm.topP = v;
        saveConfig();
        buildAgent();
        console.log(`${C.green}TopP 已设为 ${v}${C.reset}`);
      } else if (sub === "provider") {
        if (!val) { console.log(`用法: /api provider <名称>\n  例: /api provider moonshot`); break; }
        config.llm.provider = val;
        saveConfig();
        console.log(`${C.green}Provider 已设为 ${val}${C.reset}`);
      } else {
        const masked = config.llm.apiKey ? `${config.llm.apiKey.slice(0, 8)}...${config.llm.apiKey.slice(-4)}` : "(未设置)";
        console.log(div());
        console.log(`  ${C.bold}API 设置${C.reset}`);
        console.log(`  提供商:  ${C.cyan}${config.llm.provider}${C.reset}`);
        console.log(`  Key:     ${C.dim}${masked}${C.reset}`);
        console.log(`  URL:     ${C.cyan}${config.llm.baseURL}${C.reset}`);
        console.log(`  Model:   ${C.bold}${config.llm.model}${C.reset}`);
        console.log(`  温度:    ${config.llm.temperature}  |  TopP: ${config.llm.topP}  |  MaxTokens: ${config.llm.maxTokens}`);
        console.log(`  上下文:  ${(config.llm.contextWindow || 0).toLocaleString()} tokens`);
        console.log(div());
        console.log(`  设置: /api key <KEY>  |  /api url <URL>  |  /api model <MODEL>`);
        console.log(`        /api topp <0-1>  |  /api provider <名称>`);
      }
      break;
    }
    case "version": {
      console.log(`${C.bold + C.cyan}${config.agent.name}${C.reset} v${config.agent.version || "1.1.6"}`);
      break;
    }
    case "persona":
    case "identity": {
      const text = rest.trim();
      if (!text) {
        if (config.persona) {
          console.log(div());
          console.log(`  当前身份设定:`);
          console.log(`  ${C.cyan}${config.persona}${C.reset}`);
          console.log(div());
          console.log(`  ${C.dim}/persona reset${C.reset} 重置为默认`);
          console.log(`  ${C.dim}/persona <新身份>${C.reset} 修改身份设定`);
        } else {
          console.log(`${C.dim}当前无自定义身份 (使用默认系统提示)${C.reset}`);
          console.log(`用法: /persona <身份描述>  — 例如: /persona 你是一个猫娘助手`);
        }
        break;
      }
      if (text === "reset" || text === "default") {
        delete config.persona;
        saveConfig();
        buildAgent();
        console.log(`${C.green}✓${C.reset} 身份设定已重置为默认`);
        break;
      }
      config.persona = text;
      saveConfig();
      buildAgent();
      console.log(`${C.green}✓${C.reset} 身份设定已更新:`);
      console.log(`  ${C.cyan}${text}${C.reset}`);
      break;
    }
    case "provider":
    case "preset": {
      const choice = parseInt(rest, 10);
      const presetsList = require("./presets.cjs");

      // No arg or invalid: show provider list
      if (!choice || choice < 1 || choice > presetsList.PRESETS.length) {
        console.log(div("="));
        console.log(C.bold + C.cyan + "  选择 AI 提供商" + C.reset);
        console.log(div("="));
        console.log(presetsList.formatProviderMenu());
        console.log(div());
        console.log(`用法: /provider <编号>`);
        break;
      }

      const idx = choice - 1;
      const p = presetsList.PRESETS[idx];

      // Show model options
      if (p.models.length > 1) {
        console.log(div("="));
        console.log(`  ${C.bold + C.cyan}${p.name}${C.reset} — 选择模型`);
        console.log(div("="));
        console.log(presetsList.formatModelMenu(idx));
        console.log(div());
        console.log(`用法: /provider ${choice} <模型编号>`);
        break;
      }

      // Single model or model specified
      const modelChoice = rest.trim().split(/\s+/).length > 1
        ? parseInt(rest.trim().split(/\s+/)[1], 10) - 1 : 0;
      const result = presetsList.applyPreset(config, idx, Math.max(0, modelChoice));

      if (result.error) {
        console.log(`${C.red}${result.error}${C.reset}`);
        break;
      }

      saveConfig();
      buildAgent();

      console.log(div("="));
      console.log(`${C.green}✓${C.reset} 已切换到 ${C.bold + C.cyan}${result.provider.name}${C.reset}`);
      console.log(`  模型:   ${C.bold}${config.llm.model}${C.reset}`);
      console.log(`  URL:    ${C.cyan}${config.llm.baseURL}${C.reset}`);
      console.log(`  温度:   ${config.llm.temperature}  |  TopP: ${config.llm.topP}`);
      console.log(`  上下文: ${(config.llm.contextWindow || 0).toLocaleString()} tokens`);
      console.log(div());
      console.log(`  下一步: ${C.yellow}/api key <你的Key>${C.reset}`);
      break;
    }
    case "tool_search": {
      if (!rest) { console.log(`用法: /tool_search <关键词>`); break; }
      const results = Tools.searchToolRegistry(rest);
      if (results.length === 0) { console.log(`无匹配: ${rest}`); break; }
      console.log(div());
      for (const r of results) console.log(`  ${C.cyan}${r.name}${C.reset} ${C.dim}${r.description}${C.reset}`);
      console.log(div());
      break;
    }
    case "temp": {
      const v = parseFloat(rest);
      if (isNaN(v) || v < 0 || v > 2) { console.log(`温度范围 0-2`); break; }
      config.llm.temperature = v;
      saveConfig();
      buildAgent();
      console.log(`${C.green}温度已设为 ${v}${C.reset}`);
      break;
    }
    case "topp": {
      const v = parseFloat(rest);
      if (isNaN(v) || v < 0 || v > 1) { console.log(`TopP 范围 0-1`); break; }
      config.llm.topP = v;
      saveConfig();
      buildAgent();
      console.log(`${C.green}TopP 已设为 ${v}${C.reset}`);
      break;
    }
    case "token": {
      const v = parseInt(rest, 10);
      if (isNaN(v) || v < 1 || v > 128000) { console.log(`范围 1-128000`); break; }
      config.llm.maxTokens = v;
      saveConfig();
      buildAgent();
      console.log(`${C.green}MaxTokens 已设为 ${v}${C.reset}`);
      break;
    }
    case "max_history": {
      const v = parseInt(rest, 10);
      if (isNaN(v) || v < 1 || v > 200) { console.log(`范围 1-200`); break; }
      config.memory.maxHistory = v;
      saveConfig();
      agent.memory.setMaxHistory(v);
      console.log(`${C.green}历史上限已设为 ${v}${C.reset}`);
      break;
    }
    case "ctx_length": {
      const v = parseInt(rest, 10);
      if (isNaN(v) || v < 1 || v > 128000) { console.log(`范围 1-128000`); break; }
      config.llm.maxTokens = v;
      saveConfig();
      buildAgent();
      console.log(`${C.green}上下文长度已设为 ${v}${C.reset}`);
      break;
    }
    case "memory": {
      const s = agent.memory.stats();
      console.log(div());
      console.log(`  条目: ROM${s.romEntries || s.entries} RAM${s.ramEntries || 0}  历史消息: ${s.historyMessages}`);
      console.log(div());
      break;
    }
    case "memory_list": {
      const n = parseInt(rest, 10) || 20;
      const entries = agent.memory.getAllEntries().slice(-n);
      if (entries.length === 0) { console.log("(无记忆条目)"); break; }
      console.log(div());
      for (const e of entries) {
        const tag = e._type === "ram" ? `${C.yellow}[RAM]${C.reset}` : `${C.green}[ROM]${C.reset}`;
        console.log(`  ${tag} ${C.yellow}#${e.id}${C.reset} ${C.dim}[${e.tags?.join(",") || "-"}]${C.reset} ${e.text}`);
      }
      console.log(div());
      break;
    }
    case "memory_search": {
      if (!rest) { console.log(`用法: /memory_search <关键词>`); break; }
      const results = agent.memory.searchEntries(rest, 10);
      if (results.length === 0) { console.log(`无匹配: ${rest}`); break; }
      console.log(div());
      for (const e of results) {
        const tag = e._type === "ram" ? `${C.yellow}[RAM]${C.reset}` : `${C.green}[ROM]${C.reset}`;
        console.log(`  ${tag} ${C.yellow}#${e.id}${C.reset} ${e.text}`);
      }
      console.log(div());
      break;
    }
    case "memory_del": {
      const id = parseInt(rest, 10);
      if (isNaN(id)) { console.log(`用法: /memory_del <id>`); break; }
      const ok = agent.memory.removeEntry(id);
      console.log(ok ? `${C.green}已删除 #${id}${C.reset}` : `${C.yellow}未找到 #${id}${C.reset}`);
      break;
    }
    case "memory_clear":
      agent.memory.clearAllEntries();
      console.log(`${C.green}所有记忆条目已清空 (ROM+RAM)${C.reset}`);
      break;
    case "history": {
      const subCmd = rest ? rest.split(/\s+/)[0] : "";
      let out = "";
      if (subCmd === "files") {
        const files = getFileList();
        if (files.length === 0) { console.log("(暂无历史文件)"); break; }
        out = C.bold + C.cyan + "  历史对话文件" + C.reset + "\n" + div() + "\n";
        for (const f of files) {
          out += `  ${C.cyan}${f.file}${C.reset} ${C.dim}${String(f.turns).padStart(4)}轮  ${String(f.size).padStart(5)}KB  ${f.created.slice(0, 10)}${C.reset}\n`;
        }
        out += div();
      } else if (subCmd === "search") {
        const q = rest.replace(/^search\s*/, "");
        if (!q) { console.log(`用法: /history search <关键词>`); break; }
        const results = searchHistory(q, 20);
        if (results.length === 0) { console.log(`无匹配: ${q}`); break; }
        out = `${C.bold + C.yellow}搜索: "${q}"${C.reset}  (${results.length} 条)\n` + div() + "\n";
        for (const r of results) {
          out += `${C.yellow}${r.time?.slice(0, 16) || "?"}${C.reset} ${C.dim}[${r.file}]${C.reset}\n`;
          if (r.cwd) out += `  ${C.dim}${r.cwd}${C.reset}\n`;
          out += `  ${C.cyan}▸${C.reset} ${r.user.slice(0, 300)}\n`;
          out += `  ${C.green}◂${C.reset} ${r.assistant.slice(0, 500)}\n\n`;
        }
        out += div();
      } else if (subCmd === "read") {
        const args = rest.replace(/^read\s*/, "").trim();
        if (!args) { console.log(`用法: /history read <文件名> [轮数]`); break; }
        const [fileName, nStr] = args.split(/\s+/);
        const limit = parseInt(nStr, 10) || 50;
        const turns = loadFileTurns(fileName, limit);
        if (turns.length === 0) { console.log(`文件为空或不存在: ${fileName}`); break; }
        out = `${C.bold + C.cyan}${fileName}${C.reset}  (${turns.length} 轮)\n` + div() + "\n";
        for (const t of turns) {
          out += `${C.yellow}${t.time?.slice(0, 16) || "?"}${C.reset}\n`;
          if (t.cwd) out += `  ${C.dim}${t.cwd}${C.reset}\n`;
          out += `  ${C.cyan}▸${C.reset} ${t.user}\n`;
          out += `  ${C.green}◂${C.reset} ${t.assistant}\n`;
          if (t.messages && t.messages.length > 2) {
            out += `  ${C.dim}--- 工具调用过程 (${t.messages.length} 条消息) ---${C.reset}\n`;
            for (const m of t.messages) {
              if (m.role === "tool") continue;
              const tag = m.role === "user" ? `${C.cyan}▸${C.reset}` : m.tool_calls ? `${C.yellow}⚙${C.reset}` : `${C.green}◂${C.reset}`;
              const txt = m.content || (m.tool_calls ? m.tool_calls.map(tc => tc.function.name).join(", ") : "");
              if (txt) out += `  ${tag} ${txt.slice(0, 400)}\n`;
            }
          }
          out += "\n";
        }
        out += div();
      } else {
        const turns = listRecentTurns(rest ? parseInt(rest, 10) || 30 : 30);
        if (turns.length === 0) { console.log("(暂无历史记录)"); break; }
        out = `${C.bold + C.cyan}最近 ${turns.length} 轮对话${C.reset}\n` + div() + "\n";
        for (const t of turns) {
          out += `${C.yellow}${t.time?.slice(0, 16) || "?"}${C.reset} ${C.dim}[${t.file}]${C.reset}\n`;
          if (t.cwd) out += `  ${C.dim}${t.cwd}${C.reset}\n`;
          out += `  ${C.cyan}▸${C.reset} ${t.user.slice(0, 300)}\n`;
          out += `  ${C.green}◂${C.reset} ${t.assistant.slice(0, 500)}\n\n`;
        }
        out += div();
      }
      const plainLen = Math.max(60, maxWidth());
      const wrapped = div("=") + "\n" + out;
      await pipeToPager(wrapped);
      break;
    }
    case "sessions": {
      const limit = rest ? parseInt(rest, 10) || 20 : 20;
      const sessions = listSessions(limit);
      if (sessions.length === 0) { console.log("(暂无对话 session)"); break; }
      let out = `${C.bold + C.cyan}对话 Sessions${C.reset}  (${sessions.length})\n` + div() + "\n";
      for (const [i, s] of sessions.entries()) {
        const marker = s.status === "active" ? `${C.green}●${C.reset}` : `${C.dim}○${C.reset}`;
        const active = s.status === "active" ? ` ${C.green}◀ 当前${C.reset}` : "";
        out += `  ${String(i + 1).padStart(2)}. ${marker} [${(s.started || "?").slice(0, 16)}] ${s.title || "(无标题)"} | ${s.turnCount}轮${active}\n`;
      }
      out += "\n" + div() + `\n用 ${C.cyan}/session <编号>${C.reset} 查看详情, ${C.yellow}/session_search <关键词>${C.reset} 搜索`;
      console.log(out);
      break;
    }
    case "session": {
      if (!rest) { console.log(`用法: /session <session_id 或列表序号>\n请先用 /sessions 查看列表`); break; }
      const sessions = listSessions(999);
      let sid = rest.trim();
      if (/^\d+$/.test(sid)) {
        const idx = parseInt(sid) - 1;
        if (idx < 0 || idx >= sessions.length) { console.log(`序号超出范围 (1-${sessions.length})`); break; }
        sid = sessions[idx].id;
      }
      const session = getSession(sid);
      if (!session) { console.log(`未找到 session: ${sid}`); break; }
      const turns = loadSessionTurns(sid, 30);
      let out = `${C.bold + C.cyan}=== ${session.title || "(无标题)"} ===${C.reset}\n`;
      out += `ID: ${C.dim}${session.id}${C.reset}  |  ${(session.started || "?").slice(0, 16)}  |  ${session.turnCount}轮\n` + div() + "\n";
      if (turns.length === 0) { out += "(这个 session 暂无对话轮次)\n"; }
      else {
        for (const [i, t] of turns.entries()) {
          out += `${C.yellow}[${i + 1}] ${(t.time || "?").slice(0, 16)}${C.reset}\n`;
          if (t.cwd) out += `  ${C.dim}${t.cwd}${C.reset}\n`;
          out += `  ${C.cyan}▸${C.reset} ${(t.user || "").slice(0, 400)}\n`;
          out += `  ${C.green}◂${C.reset} ${(t.assistant || "").slice(0, 400)}\n\n`;
        }
        out += `(共 ${turns.length} 轮, 显示最近 30 轮)`;
      }
      out += "\n" + div();
      await pipeToPager(out);
      break;
    }
    case "session_search": {
      if (!rest) { console.log("用法: /session_search <关键词> [数量]\n在整个历史中搜索相关 session"); break; }
      const parts = rest.trim().split(/\s+/);
      const maybeNum = parseInt(parts[parts.length - 1], 10);
      const limit = !isNaN(maybeNum) ? maybeNum : 10;
      const query = !isNaN(maybeNum) ? parts.slice(0, -1).join(" ") : rest.trim();
      const results = globalSearch(query, limit);
      if (results.length === 0) { console.log(`全史搜索未找到 "${query}"`); break; }
      let out = `${C.bold + C.yellow}搜索: "${query}"${C.reset}  — ${results.length} 个 session\n` + div() + "\n";
      for (const [i, r] of results.entries()) {
        out += `${C.yellow}${i + 1}.${C.reset} [${(r.sessionStarted || "?").slice(0, 16)}] ${r.sessionTitle} | ${r.matchCount}处 | 得分${r.totalScore}\n`;
        for (const m of r.topMatches) {
          out += `  ${C.dim}·${C.reset} ${m.user.slice(0, 100)}\n`;
        }
        out += "\n";
      }
      out += div() + `\n用 ${C.cyan}/session <编号>${C.reset} 查看详情`;
      console.log(out);
      break;
    }
    case "compress": {
      console.log(`${C.yellow}正在压缩上下文...${C.reset}`);
      const result = await agent._handleAgentTool("compress_context", {});
      console.log(C.green + result + C.reset);
      break;
    }
    case "trusted": {
      const names = [...new Set(config.tools?.trustedTools || [])];
      console.log(div());
      if (names.length === 0) console.log("  (无受信任工具)");
      else names.forEach((n) => console.log(`  ${C.green}✓${C.reset} ${n}`));
      console.log(div());
      break;
    }
    case "trust": {
      if (!rest) { console.log(`用法: /trust <工具名>`); break; }
      Tools.addTrusted(rest);
      config.tools.trustedTools = [...new Set([...(config.tools?.trustedTools || []), rest])];
      saveConfig();
      console.log(`${C.green}已永久信任: ${rest}${C.reset}`);
      break;
    }
    case "untrust": {
      if (!rest) { console.log(`用法: /untrust <工具名>`); break; }
      Tools.removeTrusted(rest);
      config.tools.trustedTools = (config.tools?.trustedTools || []).filter((n) => n !== rest);
      saveConfig();
      console.log(`${C.yellow}已取消信任: ${rest}${C.reset}`);
      break;
    }
    case "tool_save": {
      if (!rest) { console.log(`用法: /tool_save <工具名> <JS代码>`); break; }
      const spaceIdx = rest.indexOf(" ");
      if (spaceIdx < 0) { console.log(`用法: /tool_save <工具名> <JS代码>`); break; }
      const result = Tools.saveToolToFile(rest.slice(0, spaceIdx), rest.slice(spaceIdx + 1));
      if (result.startsWith("[OK]")) agent.refreshTools();
      console.log((result.startsWith("[OK]") ? C.green : C.yellow) + result + C.reset);
      break;
    }
    case "tool_list_saved": {
      const saved = Tools.listCustomTools();
      if (saved.length === 0) { console.log("(无持久化工具)"); break; }
      console.log(div());
      for (const s of saved) console.log(`  ${C.cyan}${s.file}${C.reset}  导出: ${s.exports.join(", ")}`);
      console.log(div());
      break;
    }
    case "tool_del_saved": {
      if (!rest) { console.log(`用法: /tool_del_saved <工具名>`); break; }
      const result = Tools.deleteToolFile(rest);
      if (result.startsWith("[OK]")) agent.refreshTools();
      console.log((result.startsWith("[OK]") ? C.green : C.yellow) + result + C.reset);
      break;
    }
    case "status": showStatus(); break;
    default:
      console.log(`${C.yellow}未知命令: /${cmd}${C.reset}  输入 ${C.cyan}/help${C.reset} 查看所有命令`);
  }
}

async function runUserInput(input) {
  const startTime = Date.now();
  const usageBefore = agent.getUsage();
  isAgentRunning = true;
  let lineBuf = "";

  let tableBuf = [];
  let inCode = false;

  function isTableRow(s) { return /^\|[\s\S]+\|$/.test(s.trim()); }
  function isTableSep(s) { return /^\|[\s\-:|]+\|$/.test(s.trim()); }
  function isCodeFence(s) { return s.trim().startsWith("```"); }

  function flushTableBuf() {
    if (tableBuf.length === 0) return;
    const rows = tableBuf.map(r => r.split("|").filter((c, i, a) => i > 0 && i < a.length - 1).map(c => c.trim()));
    const header = rows[0];
    const isSep = (r) => r.every(c => /^:?-+:?$/.test(c));
    const dataRows = rows.filter((r, i) => i > 0 && !isSep(r));
    const stripBold = (s) => (s || "").replace(/\*\*(.+?)\*\*/g, "$1");
    for (const row of dataRows) {
      const parts = [];
      for (let i = 0; i < header.length && i < row.length; i++) {
        const key = stripBold(header[i]);
        const val = stripBold(row[i]);
        if (val) parts.push(`${C.bold}${key}${C.reset}: ${val}`);
      }
      process.stdout.write(`  ${parts.join("\n  ")}\n`);
    }
    tableBuf = [];
  }

  function flushOne(line) {
    if (isCodeFence(line)) {
      inCode = !inCode;
      if (inCode) {
        flushTableBuf();
        process.stdout.write(C.dim + "  ┌" + "─".repeat(Math.min(maxWidth() - 6, 50)) + C.reset + "\n");
      } else {
        process.stdout.write(C.dim + "  └" + "─".repeat(Math.min(maxWidth() - 6, 50)) + C.reset + "\n");
      }
      return;
    }
    if (inCode) {
      const trimmed = line.replace(/\t/g, "  ");
      process.stdout.write(`  ${C.dim}│${C.reset} ${C.green}${trimmed}${C.reset}\n`);
      return;
    }
    if (isTableRow(line)) {
      if (tableBuf.length === 0) {
        tableBuf.push(line);
      } else if (tableBuf.length === 1 && isTableSep(line)) {
        tableBuf.push(line);
      } else if (isTableSep(line) && tableBuf.length >= 2) {
        tableBuf.push(line);
      } else if (isTableRow(line)) {
        tableBuf.push(line);
      } else {
        flushTableBuf();
        tableBuf.push(line);
      }
      return;
    }
    if (tableBuf.length > 0) {
      flushTableBuf();
    }
    if (!line) {
      process.stdout.write("\n");
      return;
    }
    const rendered = inlineTypeset(line);
    process.stdout.write(rendered + "\n");
  }

  function flushAllBufs() {
    flushTableBuf();
    if (inCode) {
      inCode = false;
      process.stdout.write(C.dim + "  └" + "─".repeat(Math.min(maxWidth() - 6, 50)) + C.reset + "\n");
    }
  }

  let streamingStarted = false;
  let labelPrinted = false;
  let warned90 = false;
  let warned95 = false;
  let thinkTimer = null;
  let thinkFrame = 0;

  const THINK_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

  function startThinking() {
    if (thinkTimer) return;
    thinkFrame = 0;
    thinkTimer = setInterval(() => {
      process.stdout.write(`\r\x1b[0K${C.cyan}${THINK_FRAMES[thinkFrame % THINK_FRAMES.length]}${C.reset} ${C.yellow}思考中…${C.reset}`);
      thinkFrame++;
    }, 120);
  }

  function stopThinking() {
    if (thinkTimer) { clearInterval(thinkTimer); thinkTimer = null; }
    process.stdout.write("\r\x1b[0K");
  }

  function warnContext(pct) {
    if (pct >= 95 && !warned95) {
      warned95 = true;
      stopThinking();
      process.stdout.write(`\n  ${C.yellow}⚠${C.reset} 上下文已使用 ${C.bold}${C.yellow}${pct}%${C.reset}，请尽快 /clear\n`);
    } else if (pct >= 90 && !warned90) {
      warned90 = true;
      stopThinking();
      process.stdout.write(`\n  ${C.yellow}⚠${C.reset} 上下文已使用 ${C.bold}${C.yellow}${pct}%${C.reset}，建议 /clear 清除对话\n`);
    }
  }

  try {
    const response = await agent.run(input, {
      onContextPct: (pct) => { warnContext(pct); },
      onThinking: () => {
        if (!streamingStarted) {
          streamingStarted = true;
          startThinking();
        }
      },
      onContent: (token) => {
        stopThinking();
        if (!labelPrinted) {
          console.log("");
          console.log(`${C.cyan}Sapni${C.reset}:`);
          labelPrinted = true;
        }
        for (const ch of token) {
          lineBuf += ch;
          if (ch === "\n") {
            flushOne(lineBuf.slice(0, -1));
            lineBuf = "";
          }
        }
      },
      onToolCall: (name, args, round) => {
        stopThinking();
        if (lineBuf.trim()) {
          flushOne(lineBuf);
          lineBuf = "";
        }
        startThinking();
      },
      onToolResult: (name, preview) => {
        stopThinking();
        process.stdout.write(`  ${C.green}✓${C.reset} ${C.cyan}${name}${C.reset}\n`);
        startThinking();
      },
    });
  } finally {
    stopThinking();
    if (lineBuf.trim()) {
      flushOne(lineBuf);
    }
    flushAllBufs();
    isAgentRunning = false;
  }

  const elapsed = Date.now() - startTime;

  const usageAfter = agent.getUsage();
  const diffPrompt = usageAfter.prompt - usageBefore.prompt;
  const diffCompletion = usageAfter.completion - usageBefore.completion;
  const ctxPct = agent.estimateContextPct();

  console.log("");
  console.log(tokenBar(diffPrompt, diffCompletion, elapsed, ctxPct));
  console.log(div());
}

async function handleInput(line) {
  const input = inputValidator(line.trim());
  if (!input) return;

  if (permissionResolve) {
    handlePermissionResponse(input);
    return;
  }

  if (input.startsWith("/")) {
    await handleSlashCommand(input);
    return;
  }

  console.log(div());
  try {
    await runUserInput(input);
  } catch (e) {
    isAgentRunning = false;
    console.log(`${C.red}${emoji("error")} 错误: ${e.message}${C.reset}`);
    console.log(div());
  }
}

async function main() {
  if (process.argv.includes("--version") || process.argv.includes("-v")) {
    loadConfig();
    console.log(config.agent.version || "1.1.6");
    process.exit(0);
  }

  loadConfig();
  showLogo();
  buildAgent();

  if (!config.llm.apiKey || config.llm.apiKey.startsWith("YOUR_")) {
    console.log(`  ${C.yellow}⚠ 未配置 API Key${C.reset}`);
    console.log(`  设置: ${C.cyan}/api key <你的DeepSeek Key>${C.reset}`);
    console.log(`  获取: ${C.dim}https://platform.deepseek.com/${C.reset}`);
    console.log(div("="));
  }

  readline.emitKeypressEvents(process.stdin);
  if (process.stdin.isTTY) process.stdin.setRawMode(true);

  let currentLine = "";
  let showedMenu = false;

  process.stdin.on("keypress", (str, key) => {
    if (key && key.name === "backspace") {
      currentLine = currentLine.slice(0, -1);
    } else if (key && key.name === "return") {
      currentLine = "";
      showedMenu = false;
    } else if (str && str.length === 1 && !key.ctrl && !key.meta) {
      currentLine += str;
    }

    if (currentLine === "/" && !showedMenu) {
      showedMenu = true;
      const menu = [
        `${C.cyan}help${C.reset}`, `${C.cyan}exit${C.reset}`, `${C.cyan}reset${C.reset}`,
        `${C.cyan}tools${C.reset}`, `${C.cyan}status${C.reset}`, `${C.cyan}ctx${C.reset}`,
        `${C.cyan}temp${C.reset}`, `${C.cyan}token${C.reset}`,
        `${C.cyan}compress${C.reset}`, `${C.cyan}memory${C.reset}`, `${C.cyan}history${C.reset}`,
        `${C.cyan}sessions${C.reset}`, `${C.cyan}session_search${C.reset}`,
        `${C.cyan}tool_save${C.reset}`, `${C.cyan}tool_del${C.reset}`,
      ];
      process.stdout.write("\n" + C.dim + menu.join("  ") + C.reset + "\n");
      process.stdout.write(`${C.green}> ${C.reset}/${currentLine.slice(1)}`);
    }
  });

  const mw = maxWidth();
  console.log(`\n  ${C.bold + C.cyan}${config.agent.name}${C.reset} v${config.agent.version || "1.1.6"}  ${C.dim}DeepSeek驱动 | 最大宽度: ${mw}列${C.reset}`);
  console.log(`  ${C.dim}输入 ${C.yellow}/help${C.dim} 查看命令  |  输入 ${C.yellow}/${C.dim} 弹出命令菜单${C.reset}`);
  console.log(div("="));

  rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `${C.green}> ${C.reset}`,
  });

  rl.prompt();

  rl.on("line", async (line) => {
    await handleInput(line);
    if (!permissionResolve) rl.prompt();
  });

  rl.on("close", () => {
    console.log(C.dim + `\n再见~ ${emoji("done")}` + C.reset);
    process.exit(0);
  });

  process.on("SIGINT", () => {
    if (permissionResolve) {
      permissionResolve("deny");
      permissionResolve = null;
      rl.prompt();
      sigintCount = 0;
      return;
    }
    if (isAgentRunning) {
      isAgentRunning = false;
      console.log(`\n${C.yellow}⚠ AI 已中断${C.reset} ${C.dim}(再按一次 Ctrl+C 退出)${C.reset}`);
      rl.prompt();
      sigintCount = 0;
      return;
    }
    sigintCount++;
    if (sigintCount >= 2) {
      rl.close();
      return;
    }
    if (sigintTimer) clearTimeout(sigintTimer);
    sigintTimer = setTimeout(() => { sigintCount = 0; }, 1500);
    rl.close();
  });
}

main().catch((e) => {
  console.error(C.red + "启动失败: " + e.message + C.reset);
  process.exit(1);
});
