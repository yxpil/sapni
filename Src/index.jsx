#!/usr/bin/env node
import React, { useState, useCallback, useRef, useEffect, useMemo, useDeferredValue } from "react";
import { render, Box, Text, useInput, useStdout } from "ink";
import TextInput from "ink-text-input-improved";
import Spinner from "ink-spinner";
import { createRequire } from "module";
import path from "path";
import fs from "fs";
import os from "os";

const require = createRequire(import.meta.url);
const { fileURLToPath } = require("url");

const Tools = require("../Tools");
const presets = require("./presets");
const { listRecentTurns, searchHistory, getFileList, loadFileTurns, listSessions, getSession, loadSessionTurns, globalSearch, endSession, startSession } = require("../Mem/history");
const kao = require("../Tools/kaomoji");
import { ToolLog, Msg, Thinking, Streaming, StatusBar } from "./components";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SAPNI_DIR = path.join(os.homedir(), ".sapni");
const SAPNI_CONFIG = path.join(SAPNI_DIR, "config.json");
const PKG_CONFIG = path.join(__dirname, "..", "config.json");
const LOGO_PATH = path.join(__dirname, "..", "Logos", "StartLogo.txt");

const VER = "1.1.0-rc4";

function ensureDir() { if (!fs.existsSync(SAPNI_DIR)) fs.mkdirSync(SAPNI_DIR, { recursive: true }); }
function loadConfig() {
  ensureDir();
  if (fs.existsSync(SAPNI_CONFIG)) return JSON.parse(fs.readFileSync(SAPNI_CONFIG, "utf-8"));
  const cfg = JSON.parse(fs.readFileSync(PKG_CONFIG, "utf-8"));
  fs.writeFileSync(SAPNI_CONFIG, JSON.stringify(cfg, null, 2), "utf-8");
  return cfg;
}
function saveConfig(cfg) { ensureDir(); fs.writeFileSync(SAPNI_CONFIG, JSON.stringify(cfg, null, 2), "utf-8"); }

const CONFIG = loadConfig();

const LOGO_LINES = (() => {
  try {
    const raw = fs.readFileSync(LOGO_PATH, "utf-8");
    return raw.replace(/0\.\d+\.\d+/, VER).split("\n").filter(l => l.trim() || l === "");
  } catch (_) { return ["SAPNI"]; }
})();

const MAX_MSG = 200;

function isWide(cp) {
  return (cp >= 0x1100 && cp <= 0x115F) ||
    (cp >= 0x2329 && cp <= 0x232A) ||
    (cp >= 0x2E80 && cp <= 0x4DBF) ||
    (cp >= 0x4E00 && cp <= 0xA4CF) ||
    (cp >= 0xA960 && cp <= 0xA97F) ||
    (cp >= 0xAC00 && cp <= 0xD7AF) ||
    (cp >= 0xF900 && cp <= 0xFAFF) ||
    (cp >= 0xFE10 && cp <= 0xFE1F) ||
    (cp >= 0xFE30 && cp <= 0xFE6F) ||
    (cp >= 0xFF01 && cp <= 0xFF60) ||
    (cp >= 0xFFE0 && cp <= 0xFFE6) ||
    (cp >= 0x1B000 && cp <= 0x1B2FF) ||
    (cp >= 0x1F200 && cp <= 0x1F2FF) ||
    (cp >= 0x20000 && cp <= 0x2FFFF);
}

function termLen(s) {
  let w = 0;
  for (const ch of s) w += isWide(ch.codePointAt(0)) ? 2 : 1;
  return w;
}

function padTerm(s, n) {
  const d = n - termLen(s);
  return s + (d > 0 ? " ".repeat(d) : "");
}

function formatMd(text, maxW) {
  const w = maxW || 80;
  const lines = text.split("\n");
  const out = [];
  let tableBuf = [];
  let inCode = false;
  const isTR = (s) => /^\|[\s\S]+\|$/.test(s.trim());
  const isTS = (s) => /^\|[\s\-:|]+\|$/.test(s.trim());
  const isCF = (s) => s.trim().startsWith("```");

  function flush() {
    if (tableBuf.length < 2) { tableBuf = []; return; }
    const rows = tableBuf.map(r =>
      r.split("|").filter((_, i, a) => i > 0 && i < a.length - 1).map(c => c.trim())
    );
    const hd = rows[0];
    const data = rows.filter((r, i) => i > 0 && !r.every(c => /^:?-+:?$/.test(c)));
    if (!hd.length || !data.length) { tableBuf = []; return; }

    const maxCol = hd.map((c, ci) =>
      Math.max(termLen(c), ...data.map(r => termLen(r[ci] || "")))
    );
    const widths = maxCol.map(x => x + 2);
    const totalW = widths.reduce((a, b) => a + b, 0) + hd.length - 1;

    if (totalW <= w) {
      const hdrLine = "\u2500".repeat(totalW);
      out.push(hd.map((c, i) => " " + padTerm(c, widths[i] - 1)).join(" "));
      out.push(hdrLine);
      for (const row of data) {
        out.push(row.map((c, i) => " " + padTerm(c || "", widths[i] - 1)).join(" "));
      }
    } else {
      for (const row of data) {
        const parts = [];
        for (let i = 0; i < hd.length && i < row.length; i++) {
          if (row[i]) parts.push(hd[i] + ": " + row[i]);
        }
        out.push(parts.join(" \u00b7 "));
      }
    }
    tableBuf = [];
  }

  for (const line of lines) {
    if (isCF(line)) { flush(); inCode = !inCode; continue; }
    if (inCode) { out.push("  " + line); continue; }
    if (isTR(line)) { tableBuf.push(line); continue; }
    if (isTS(line) && tableBuf.length >= 1) { tableBuf.push(line); continue; }
    if (tableBuf.length) flush();
    out.push(line);
  }
  flush();
  return out.join("\n")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/^#{1,4}\s+/gm, "")
    .replace(/^>\s?/gm, "  ");
}



function colorResult(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  let color = "gray";
  let sym = "";
  if (/error|失败|错误|eacces|eperm|enoent/i.test(lower)) { color = "red"; sym = "✗ "; }
  else if (/\[ok\]|完成|成功|created|wrote|写入|创建|已保存|passed/i.test(lower)) { color = "green"; sym = "  "; }
  else if (/deleted|删除|移除|removed/i.test(lower)) { color = "red"; sym = "✗ "; }
  else if (/modified|修改|更新|patched|changed/i.test(lower)) { color = "yellow"; sym = "~ "; }
  else if (/not found|未找到|不存在|no match/i.test(lower)) { color = "red"; sym = "? "; }
  return { text: sym + text.slice(0, 100), color };
}



let _agent = null;
function getAgent() {
  if (_agent) return _agent;
  const Agent = require("./agent.cjs");
  _agent = new Agent(CONFIG, { onPermission: () => true });
  return _agent;
}

const COMMANDS = [
  { cmd: "/help", desc: "Show help" },
  { cmd: "/exit", desc: "Exit program" },
  { cmd: "/reset", desc: "Reset conversation" },
  { cmd: "/clear", desc: "Clear chat" },
  { cmd: "/version", desc: "Show version" },
  { cmd: "/status", desc: "Current status" },
  { cmd: "/ctx", desc: "Context usage" },
  { cmd: "/tools", desc: "List tools" },
  { cmd: "/tools_more", desc: "All tools (with extensions)" },
  { cmd: "/tool_search", desc: "Search tools" },
  { cmd: "/tool_list_saved", desc: "List saved tools" },
  { cmd: "/tool_save", desc: "Save tool to file" },
  { cmd: "/tool_del_saved", desc: "Delete saved tool" },
  { cmd: "/temp", desc: "Set temperature (0-2)" },
  { cmd: "/topp", desc: "Set TopP (0-1)" },
  { cmd: "/token", desc: "Set max output tokens" },
  { cmd: "/memory", desc: "Memory stats" },
  { cmd: "/memory_list", desc: "List memory entries" },
  { cmd: "/memory_search", desc: "Search memory" },
  { cmd: "/memory_del", desc: "Delete memory" },
  { cmd: "/memory_clear", desc: "Clear memory" },
  { cmd: "/compress", desc: "Compress context" },
  { cmd: "/history", desc: "Recent history" },
  { cmd: "/history files", desc: "History files" },
  { cmd: "/history search", desc: "Search history" },
  { cmd: "/history read", desc: "Read history file" },
  { cmd: "/sp_server", desc: "Sapni API server status" },
  { cmd: "/sp_server start", desc: "Start Sapni API server" },
  { cmd: "/sp_server stop", desc: "Stop Sapni API server" },
  { cmd: "/sp_token", desc: "Create Sapni API token" },
  { cmd: "/sp_tokens", desc: "List Sapni API tokens" },
  { cmd: "/sp_token_del", desc: "Delete Sapni API token" },
  { cmd: "/sessions", desc: "List sessions" },
  { cmd: "/session", desc: "View session" },
  { cmd: "/session_search", desc: "Search sessions" },
  { cmd: "/provider", desc: "Switch AI provider (one-click)" },
  { cmd: "/persona", desc: "Set AI identity/persona" },
  { cmd: "/persona reset", desc: "Reset identity to default" },
  { cmd: "/trusted", desc: "Trusted tools" },
  { cmd: "/trust", desc: "Trust tool" },
  { cmd: "/untrust", desc: "Untrust tool" },
  { cmd: "/llm", desc: "View LLM config" },
  { cmd: "/llm key", desc: "Set LLM API key" },
  { cmd: "/llm url", desc: "Set LLM API URL" },
  { cmd: "/llm model", desc: "Set LLM model" },
];

function App() {
  const { stdout } = useStdout();
  const [cols, setCols] = useState(stdout ? stdout.columns : 80);

  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [thinkingText, setThinkingText] = useState("");
  const [thinkingIter, setThinkingIter] = useState(0);
  const [streaming, setStreaming] = useState("");
  const [tools, setTools] = useState([]);
  const [toolsCollapsed, setToolsCollapsed] = useState(false);
  const [ctxPct, setCtxPct] = useState(0);
  const [blocked, setBlocked] = useState(false);
  const [slashIdx, setSlashIdx] = useState(0);
  const [mascotFace, setMascotFace] = useState(kao.mascotForFrame());
  const [promptFace, setPromptFace] = useState(kao.promptFace(""));
  const [queue, setQueue] = useState([]);
  const abortRef = useRef(null);


  const [msgs, setMsgs] = useState([]);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    setCtxPct(getAgent().estimateContextPct());
  }, []);

  // Real-time resize listener
  useEffect(() => {
    if (!stdout) return;
    const handleResize = () => {
      if (stdout.columns) {
        setCols(stdout.columns);
      }
    };
    stdout.on("resize", handleResize);
    return () => {
      stdout.off("resize", handleResize);
    };
  }, [stdout]);

  const addMsg = useCallback((role, text) => {
    setMsgs(prev => {
      const next = [...prev, { role, content: text }];
      return next.length > MAX_MSG ? next.slice(-MAX_MSG) : next;
    });
  }, []);

  const run = useCallback(async (query) => {
    if (blocked) return;
    setBlocked(true);
    setThinking(true);
    setStreaming("");
    setTools([]);
    setToolsCollapsed(false);

    const controller = new AbortController();
    abortRef.current = controller;
    let abortedByUser = false;
    controller.signal.addEventListener("abort", () => { abortedByUser = true; });

    let buf = "";
    const toolMap = new Map();

    try {
      // Promise.race 用于 Esc 中断：abortRef.abort() → reject → 中断
      const abortPromise = new Promise((_, reject) => {
        const onAbort = () => {
          controller.signal.removeEventListener("abort", onAbort);
          reject(new DOMException("Aborted", "AbortError"));
        };
        controller.signal.addEventListener("abort", onAbort);
      });

      await Promise.race([
        getAgent().run(query, {
        signal: controller.signal,
        onContent: (tok) => {
          buf += tok;
          setStreaming(buf.replace(/\*\*(.+?)\*\*/g, "$1"));
        },
        onToolCall: (name, args = {}) => {
          const short = Object.entries(args).map(([k, v]) => {
            const s = String(v);
            return k + "=" + (s.length > 50 ? s.slice(0, 50) + "\u2026" : s);
          }).join(" ");
          toolMap.set(name, { name, args: short, status: "running", result: "" });
          setTools([...toolMap.values()]);
        },
        onToolResult: (name, result) => {
          const t = toolMap.get(name);
          if (t) {
            t.status = "done";
            t.result = String(result || "").slice(0, 500);
          }
          setTools([...toolMap.values()]);
        },
        onContextPct: (pct) => setCtxPct(pct),
        onThinking: (text, iter) => {
          setThinkingText(text);
          setThinkingIter(iter);
        },
        }),
        abortPromise,
      ]);
    } catch (e) {
      if (abortedByUser) {
        buf = "";
      } else {
        addMsg("system", "✗ " + e.message);
      }
    }

    if (buf) addMsg("assistant", formatMd(buf, cols - 4));
    setStreaming("");
    setThinking(false);
    setToolsCollapsed(true);
    abortRef.current = null;
    

    // 处理队列中的下一条
    setQueue(prev => {
      if (prev.length <= 1) {
        setBlocked(false);
        return [];
      }
      // delay next to allow React to update
      const [done, ...rest] = prev;
      setTimeout(() => {
        const next = rest[0];
        addMsg("user", next);
        run(next);
      }, 50);
      return rest;
    });
  }, [blocked, addMsg, cols]);

  const slashRef = useRef({ filtered: [], clamped: 0 });

  const handleSubmit = useCallback((val) => {
    const v = val.trim();
    if (!v) return;
    const { filtered, clamped } = slashRef.current;
    if (filtered.length > 0 && clamped < filtered.length) {
      const sel = filtered[clamped].cmd;
      if (v !== sel) {
        setInput(sel + " ");
        setSlashIdx(0);
        return;
      }
    }

    // 如果正在执行中，加入队列而非阻塞
    if (blocked || thinking) {
      if (v === "/reset" || v === "/clear" || v === "/exit" || v === "/help" || v === "/version" || v === "/status" || v === "/ctx") {
        // 这些命令仍可直接执行（不阻塞）
      } else {
        setQueue(prev => [...prev, v]);
        setInput("");
        return;
      }
    }

    addMsg("user", v);
    setInput("");
    setStarted(true);

    const parts = v.slice(1).trim().split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const rest = parts.slice(1).join(" ");

    const say = (t) => addMsg("system", t);

    if (v === "/help") {
      say([
        "\u256d\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500",
        "\u2502  /help              Show help      \u2502",
        "\u2502  /exit              Exit program   \u2502",
        "\u2502  /reset             Reset chat     \u2502",
        "\u2502  /clear             Clear chat     \u2502",
        "\u2502  /version           Show version   \u2502",
        "\u2502  /status            Current status \u2502",
        "\u2502  /ctx               Context usage  \u2502",
        "\u2502  /tools             List tools     \u2502",
        "\u2502  /tools_more        All tools      \u2502",
        "\u2502  /tool_search <q>   Search tools   \u2502",
        "\u2502  /tool_list_saved   List saved tools \u2502",
        "\u2502  /tool_save <name>  Save tool      \u2502",
        "\u2502  /tool_del <name>   Delete tool    \u2502",
        "│  /temp <0-2>        Set temp       │",
        "│  /topp <0-1>        Set TopP       │",
        "\u2502  /token <n>         Set max tokens \u2502",
        "\u2502  /memory            Memory stats   \u2502",
        "\u2502  /memory_list [n]   List memories  \u2502",
        "\u2502  /memory_search <q> Search memory  \u2502",
        "\u2502  /memory_del <id>   Delete memory  \u2502",
        "\u2502  /memory_clear      Clear memory   \u2502",
        "\u2502  /compress          Compress ctx   \u2502",
        "\u2502  /history [n]       Recent history \u2502",
        "\u2502  /history files     History files  \u2502",
        "\u2502  /history search <q>Search history \u2502",
        "\u2502  /history read <f>  Read history   \u2502",
        "\u2502  /sessions [n]      List sessions  \u2502",
        "\u2502  /session <id>      View session   \u2502",
        "\u2502  /session_search <q>Search sessions\u2502",
        "\u2502  /trusted           Trusted tools  \u2502",
        "\u2502  /trust <name>      Trust tool     \u2502",
        "\u2502  /untrust <name>    Untrust tool   \u2502",
        "\u2502  /sp_server         Sapni API status  \u2502",
        "\u2502  /sp_server start   Start Sapni API   \u2502",
        "\u2502  /sp_server stop    Stop Sapni API    \u2502",
        "\u2502  /sp_token [desc]   Create Sapni token\u2502",
        "\u2502  /sp_tokens         List Sapni tokens \u2502",
        "\u2502  /sp_token_del <id> Delete Sapni token\u2502",
        "\u2502  /llm               View LLM config   \u2502",
        "\u2502  /llm key/url/model Set LLM settings  \u2502",
        "\u2570\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500",
      ].join("\n"));
    }
    else if (cmd === "exit") process.exit(0);
    else if (cmd === "reset") {
      const a = getAgent();
      endSession(a.sessionId);
      a.reset();
      a.sessionId = startSession();
      setMsgs([{ role: "system", content: "Conversation reset, new session created." }]);
      setCtxPct(0);
      say("Conversation reset, new session created");
    }
    else if (cmd === "clear") {
      setMsgs([{ role: "system", content: "Chat cleared." }]);
      setCtxPct(0);
    }
    else if (cmd === "version") {
      say("Sapni v" + VER + " — Ink Edition · " + CONFIG.llm.model);
    }
    else if (cmd === "status") {
      const a = getAgent();
      const usage = a.getUsage();
      const mem = a.memory.stats();
      const pct = a.estimateContextPct();
      const names = Tools.listToolNames();
      say([
        "\u256d\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500",
        "  Model: " + CONFIG.llm.model + "  Temp: " + CONFIG.llm.temperature,
        "  Tokens: Prompt " + usage.prompt + " · Completion " + usage.completion,
        "  Context: " + pct + "% (Limit " + a.getMaxContextTokens() + " tokens)",
        "  Memory: ROM" + (mem.romEntries || mem.entries) + " RAM" + (mem.ramEntries || 0) + " · History " + mem.historyMessages + " turns",
        "  Tools: " + names.length + " tools — " + names.slice(0, 8).join(", ") + (names.length > 8 ? " ..." : ""),
        "\u2570\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500",
      ].join("\n"));
    }
    else if (cmd === "ctx") {
      const a = getAgent();
      const pct = a.estimateContextPct();
      const usage = a.getUsage();
      const barW = 30;
      const filled = Math.max(1, Math.round(pct / 100 * barW));
      const empty = barW - filled;
      const bar = "\u2588".repeat(filled) + "\u2500".repeat(empty);
      say([
        "Context: [" + bar + "] " + pct + "%",
        "Limit: " + a.getMaxContextTokens() + " tokens",
        "Total: Prompt " + usage.prompt + " · Completion " + usage.completion + " · Sum " + (usage.prompt + usage.completion),
        ">80%: Use /compress or let AI call forget_conversation",
      ].join("\n"));
    }
    else if (cmd === "memory") {
      const s = getAgent().memory.stats();
      say("Memory: ROM" + (s.romEntries || s.entries) + " RAM" + (s.ramEntries || 0) + " · History " + s.historyMessages + " turns");
    }
    else if (cmd === "memory_list") {
      const n = parseInt(rest) || 20;
      const all = getAgent().memory.getAllEntries().slice(-n);
      if (!all.length) { say("(No memory entries)"); return; }
      say(all.map((e) => {
        const tag = e._type === "ram" ? "[RAM]" : "[ROM]";
        return tag + " #" + e.id + " [" + (e.tags?.join(",") || "-") + "] " + e.text;
      }).join("\n"));
    }
    else if (cmd === "memory_search") {
      if (!rest) { say("Usage: /memory_search <keyword>"); return; }
      const found = getAgent().memory.searchEntries(rest, 10);
      if (!found.length) { say("No memory matching \"" + rest + "\" found"); return; }
      say(found.map((e) => "#" + e.id + " [" + (e.tags?.join(",") || "-") + "] " + e.text).join("\n"));
    }
    else if (cmd === "memory_del") {
      const id = parseInt(rest);
      if (isNaN(id)) { say("Usage: /memory_del <id>"); return; }
      const ok = getAgent().memory.removeEntry(id);
      say(ok ? "Deleted #" + id : "#" + id + " not found");
    }
    else if (cmd === "memory_clear") {
      getAgent().memory.clearAllEntries();
      say("Memory cleared (ROM+RAM)");
    }
    else if (cmd === "compress") {
      const a = getAgent();
      const compressed = a.memory.compressHistory();
      if (!compressed) { say("Conversation too short, no compression needed"); return; }
      a.memory.clear();
      a.memory.addRamEntry("Manual compress: " + compressed.slice(0, 180), ["manual-summary"]);
      say("Context compressed, history cleared, summary saved to memory");
    }
    else if (cmd === "tools") {
      const names = Tools.listToolNames();
      const base = names.filter((n) => !["forget_conversation", "restart_session", "todo_write", "search_replace", "glob", "grep", "read", "write", "ls", "web_search", "check_command_status", "open_preview", "get_diagnostics", "skill", "exec_console", "wait_command", "web_fetch"].includes(n));
      const lines = base.map((n) => {
        const t = Tools.getTool(n);
        return "  " + n + (t?.description ? " — " + t.description.slice(0, 40) : "");
      });
      say(lines.join("\n") + "\n\n" + base.length + " core tools, " + (names.length - base.length) + " extended tools (use /tools_more for all)");
    }
    else if (cmd === "tools_more") {
      const names = Tools.listToolNames();
      say(names.map((n) => {
        const t = Tools.getTool(n);
        return "  " + n + (t?.description ? " — " + t.description.slice(0, 60) : "");
      }).join("\n") + "\n\nTotal " + names.length + " tools");
    }
    else if (cmd === "tool_search") {
      if (!rest) { say("Usage: /tool_search <keyword>"); return; }
      const found = Tools.searchToolRegistry(rest);
      if (!found.length) { say("No tools matching \"" + rest + "\" found"); return; }
      say(found.map((t) => t.name + " — " + t.description).join("\n"));
    }
    else if (cmd === "tool_list_saved") {
      const saved = Tools.listCustomTools();
      if (!saved.length) { say("(No saved tools)"); return; }
      say(saved.map((s) => "[" + s.file + "] exports: " + s.exports.join(", ")).join("\n"));
    }
    else if (cmd === "tool_del_saved") {
      if (!rest) { say("Usage: /tool_del_saved <name>"); return; }
      const result = Tools.deleteToolFile(rest);
      if (result.startsWith("[OK]")) getAgent().refreshTools();
      say(result);
    }
    else if (cmd === "temp") {
      const n = parseFloat(rest);
      if (isNaN(n) || n < 0 || n > 2) { say("Temperature range: 0-2"); return; }
      CONFIG.llm.temperature = n; saveConfig(CONFIG);
      say("Temperature set to " + n);
    }
    else if (cmd === "token") {
      const n = parseInt(rest, 10);
      if (isNaN(n) || n < 1 || n > 128000) { say("Range: 1-128000"); return; }
      CONFIG.llm.maxTokens = n; saveConfig(CONFIG);
      say("MaxTokens set to " + n);
    }
    else if (cmd === "history") {
      const subParts = rest.trim().split(/\s+/);
      const sub = subParts[0]?.toLowerCase();
      const arg = subParts.slice(1).join(" ");
      if (sub === "files") {
        const files = getFileList();
        if (!files.length) { say("(No history files)"); return; }
        say(files.map((f) => f.file + " | " + f.turns + " turns | " + f.size + "KB | " + f.created.slice(0, 10)).join("\n"));
      } else if (sub === "search") {
        if (!arg) { say("Usage: /history search <keyword>"); return; }
        const results = searchHistory(arg, 10);
        if (!results.length) { say("No matches for \"" + arg + "\""); return; }
        say(results.map((r, i) => (i + 1) + ". [" + r.file + "] " + (r.time?.slice(0, 16) || "?") + "\n  " + r.user.slice(0, 120)).join("\n\n"));
      } else if (sub === "read") {
        if (!arg) { say("Usage: /history read <filename>"); return; }
        const turns = loadFileTurns(arg, 10);
        if (!turns.length) { say("File not found: " + arg); return; }
        say(turns.map((t, i) => (i + 1) + ". [" + (t.time?.slice(0, 16) || "?") + "]\n  Q: " + (t.user || "").slice(0, 200) + "\n  A: " + (t.assistant || "").slice(0, 200)).join("\n\n"));
      } else {
        const n = parseInt(sub) || 10;
        const turns = listRecentTurns(n);
        if (!turns.length) { say("(No recent history)"); return; }
        say(turns.map((t, i) => (i + 1) + ". [" + (t.time?.slice(0, 16) || "?") + "] " + (t.user || "").slice(0, 120)).join("\n"));
      }
    }
    else if (cmd === "sp_server") {
      import("./api/server.js").then(async (server) => {
        const subCmd = rest.split(" ")[0];
        const subRest = rest.split(" ").slice(1).join(" ");
        
        if (subCmd === "start") {
          if (server.isServerRunning()) {
            say("Sapni API server is already running");
            return;
          }
          const defaultPort = CONFIG.api?.port || 27262;
          const port = parseInt(subRest) || defaultPort;
          try {
            await server.startServer(port);
            say([
              "╭──────────────────────────────────────────╮",
              "│  Sapni API Server Started                │",
              "╰──────────────────────────────────────────╯",
              "",
              "URL: http://localhost:" + port,
              "",
              "Endpoints:",
              "  GET  /api/v1/models          List models",
              "  GET  /api/v1/models/:id      Get model",
              "  POST /api/v1/chat/completions Chat",
              "  GET  /api/v1/tools           List tools",
              "  POST /api/v1/tools/execute   Execute tool",
              "",
              "Token: " + (server.getTokens()[0]?.token || "none"),
            ].join("\n"));
          } catch (err) {
            say("Failed to start server: " + err.message);
          }
        }
        else if (subCmd === "stop") {
          const stopped = await server.stopServer();
          say(stopped ? "Sapni API server stopped" : "Server was not running");
        }
        else {
          // Default: show status
          const running = server.isServerRunning();
          const tokens = server.getTokens();
          say([
            "╭──────────────────────────────────────────╮",
            "│  Sapni API Server Status                 │",
            "╰──────────────────────────────────────────╯",
            "",
            "Status: " + (running ? "🟢 Running" : "🔴 Stopped"),
            "Port: " + (CONFIG.api?.port || 27262),
            "Tokens: " + tokens.length,
            "",
            "Commands:",
            "  /sp_server start [port]  Start server",
            "  /sp_server stop          Stop server",
          ].join("\n"));
        }
      });
    }
    else if (cmd === "sp_token") {
      import("./api/server.js").then((server) => {
        const token = server.generateToken(rest || "API Token");
        say([
          "╭──────────────────────────────────────╮",
          "│  New API Token Created               │",
          "╰──────────────────────────────────────╯",
          "",
          "Token:       " + token.token,
          "ID:          " + token.id,
          "Description: " + token.description,
          "Created:     " + token.createdAt.slice(0, 19),
          "",
          "Use in Authorization header:",
          "  Authorization: Bearer " + token.token,
        ].join("\n"));
      });
    }
    else if (cmd === "sp_tokens") {
      import("./api/server.js").then((server) => {
        const tokens = server.getTokens();
        if (!tokens.length) { 
          say([
            "╭──────────────────────────────────────╮",
            "│  No API Tokens                       │",
            "╰──────────────────────────────────────╯",
            "",
            "Use /sp_token to create one.",
          ].join("\n"));
          return;
        }
        const lines = tokens.map((t, i) => [
          "─────────────────────────────────────────",
          "[" + (i + 1) + "] " + t.token,
          "    ID: " + t.id,
          "    Desc: " + t.description,
          "    Created: " + t.createdAt.slice(0, 19),
          "    Last Used: " + (t.lastUsed?.slice(0, 19) || "Never"),
          "    Usage: " + t.usageCount + " times",
        ].join("\n"));
        say([
          "╭──────────────────────────────────────╮",
          "│  API Tokens (" + tokens.length + ")                  │",
          "╰──────────────────────────────────────╯",
          "",
          ...lines,
        ].join("\n"));
      });
    }
    else if (cmd === "sp_token_del") {
      if (!rest) { 
        say([
          "╭──────────────────────────────────────╮",
          "│  Usage: /sp_token_del <token_id>     │",
          "╰──────────────────────────────────────╯",
        ].join("\n"));
        return;
      }
      import("./api/server.js").then((server) => {
        const deleted = server.deleteToken(rest);
        if (deleted) {
          say([
            "╭──────────────────────────────────────╮",
            "│  Token Deleted                       │",
            "╰──────────────────────────────────────╯",
            "",
            "Token: " + deleted.token,
          ].join("\n"));
        } else {
          say([
            "╭──────────────────────────────────────╮",
            "│  Token Not Found                     │",
            "╰──────────────────────────────────────╯",
          ].join("\n"));
        }
      });
    }
    else if (cmd === "sessions") {
      const n = parseInt(rest) || 20;
      const sessions = listSessions(n);
      if (!sessions.length) { say("(No sessions)"); return; }
      const lines = sessions.map((s, i) => {
        const marker = s.status === "active" ? "\u25cf" : "\u25cb";
        return (i + 1) + ". " + marker + " [" + (s.started || "?").slice(0, 16) + "] " +
          (s.title || "(untitled)") + " | " + s.turnCount + " turns" +
          (s.status === "active" ? " \u25c0 current" : "");
      });
      say("Sessions (" + sessions.length + "):\n" + lines.join("\n") +
        "\n\nUse /session <number> to view, /session_search <keyword> to search");
    }
    else if (cmd === "session") {
      if (!rest) { say("Usage: /session <session_id or list number>\nUse /sessions to see list first"); return; }
      const sessions = listSessions(999);
      let sid = rest.trim();
      if (/^\d+$/.test(sid)) {
        const idx = parseInt(sid) - 1;
        if (idx < 0 || idx >= sessions.length) { say("Number out of range (1-" + sessions.length + ")"); return; }
        sid = sessions[idx].id;
      }
      const session = getSession(sid);
      if (!session) { say("Session not found: " + sid); return; }
      const turns = loadSessionTurns(sid, 30);
      const header = "=== " + (session.title || "(untitled)") + " ===\n" +
        "ID: " + session.id + "  |  " + (session.started || "?").slice(0, 16) + "  |  " + session.turnCount + " turns\n";
      if (!turns.length) { say(header + "\n(No turns in this session)"); return; }
      const body = turns.map((t, i) => {
        return "[" + (i + 1) + "] " + (t.time || "?").slice(0, 16) + "\n" +
          "  Q: " + (t.user || "").slice(0, 300) + "\n" +
          "  A: " + (t.assistant || "").slice(0, 300);
      }).join("\n\n");
      say(header + "\n" + body + "\n\n(" + turns.length + " turns total, showing last 30)");
    }
    else if (cmd === "session_search") {
      if (!rest) { say("Usage: /session_search <keyword> [limit]\nSearch all history for sessions"); return; }
      const parts = rest.trim().split(/\s+/);
      const limit = parseInt(parts[parts.length - 1]) || 10;
      const query = isNaN(parseInt(parts[parts.length - 1])) ? rest.trim() : parts.slice(0, -1).join(" ");
      const results = globalSearch(query, limit);
      if (!results.length) { say("No matches for \"" + query + "\" in history"); return; }
      const lines = [];
      for (const [i, r] of results.entries()) {
        lines.push((i + 1) + ". [" + (r.sessionStarted || "?").slice(0, 16) + "] " +
          r.sessionTitle + " | " + r.matchCount + " matches | score " + r.totalScore);
        for (const m of r.topMatches) {
          lines.push("    · " + (m.user || "").slice(0, 100));
        }
      }
      say("Search \"" + query + "\" — " + results.length + " sessions:\n" + lines.join("\n") +
        "\n\nUse /session <number> to view");
    }
    else if (cmd === "trusted") {
      const trusted = CONFIG.tools?.trustedTools || [];
      if (!trusted.length) { say("(No trusted tools)"); return; }
      say("Trusted tools (" + trusted.length + "):\n" + trusted.join("\n"));
    }
    else if (cmd === "trust") {
      if (!rest) { say("Usage: /trust <toolname>"); return; }
      Tools.addTrusted(rest);
      CONFIG.tools.trustedTools = [...new Set([...(CONFIG.tools?.trustedTools || []), rest])];
      saveConfig(CONFIG);
      say("Trusted: " + rest);
    }
    else if (cmd === "untrust") {
      if (!rest) { say("Usage: /untrust <toolname>"); return; }
      Tools.removeTrusted(rest);
      CONFIG.tools.trustedTools = (CONFIG.tools?.trustedTools || []).filter((n) => n !== rest);
      saveConfig(CONFIG);
      say("Untrusted: " + rest);
    }
    else if (cmd === "provider" || cmd === "preset") {
      const choice = parseInt(rest, 10);
      if (!choice || choice < 1 || choice > presets.PRESETS.length) {
        say("== Select AI Provider ==\n" + presets.formatProviderMenu() + "\n\nUsage: /provider <number>");
        return;
      }
      const idx = choice - 1;
      const p = presets.PRESETS[idx];
      if (p.models.length > 1) {
        say(p.name + " — Select model:\n" + presets.formatModelMenu(idx) + "\n\nUsage: /provider " + choice + " <model_number>");
        return;
      }
      const modelChoice = rest.trim().split(/\s+/).length > 1
        ? parseInt(rest.trim().split(/\s+/)[1], 10) - 1 : 0;
      const result = presets.applyPreset(CONFIG, idx, Math.max(0, modelChoice));
      if (result.error) { say(result.error); return; }
      saveConfig(CONFIG);
      say("✓ Switched to " + p.name + "\n  Model: " + CONFIG.llm.model + "\n  URL: " + CONFIG.llm.baseURL + "\n  Temp: " + CONFIG.llm.temperature + "  TopP: " + CONFIG.llm.topP + "\n\nNext: /llm key <your_API_key>");
    }
    else if (cmd === "persona" || cmd === "identity") {
      const text = rest.trim();
      if (!text) {
        if (CONFIG.persona) {
          say("Current identity:\n" + CONFIG.persona + "\n\n/persona reset — reset to default\n/persona <text> — set new identity");
        } else {
          say("No custom identity set (using default system prompt)\nUsage: /persona <description>");
        }
      } else if (text === "reset" || text === "default") {
        delete CONFIG.persona; saveConfig(CONFIG);
        say("✓ Identity reset to default");
      } else {
        CONFIG.persona = text; saveConfig(CONFIG);
        say("✓ Identity updated:\n" + text);
      }
    }
    else if (cmd === "llm") {
      const sub = rest.split(/\s+/)[0]?.toLowerCase();
      const val = rest.slice(sub ? sub.length : 0).trim();
      if (sub === "key") {
        if (!val) { say("Usage: /llm key <API_Key>"); return; }
        if (val.length < 10) { say("Key too short"); return; }
        CONFIG.llm.apiKey = val; saveConfig(CONFIG);
        say("LLM API Key updated (" + val.slice(0, 8) + "...)");
      } else if (sub === "url") {
        if (!val) { say("Usage: /llm url <API_URL>"); return; }
        CONFIG.llm.baseURL = val.replace(/\/+$/, ""); saveConfig(CONFIG);
        say("LLM API URL updated: " + CONFIG.llm.baseURL);
      } else if (sub === "model") {
        if (!val) { say("Usage: /llm model <model_name>"); return; }
        CONFIG.llm.model = val; saveConfig(CONFIG);
        say("LLM Model updated: " + CONFIG.llm.model);
      } else {
        const masked = CONFIG.llm.apiKey ? CONFIG.llm.apiKey.slice(0, 8) + "..." + CONFIG.llm.apiKey.slice(-4) : "(not set)";
        say([
          "╭──────────────────────────────────────────╮",
          "│  LLM Configuration                       │",
          "╰──────────────────────────────────────────╯",
          "",
          "Provider: " + CONFIG.llm.provider,
          "API Key:  " + masked,
          "API URL:  " + CONFIG.llm.baseURL,
          "Model:    " + CONFIG.llm.model,
          "Temp:     " + CONFIG.llm.temperature,
          "MaxTokens:" + (CONFIG.llm.maxTokens || "-"),
          "",
          "Commands:",
          "  /llm key <key>    Set API key",
          "  /llm url <url>    Set API URL",
          "  /llm model <name> Set model",
        ].join("\n"));
      }
    }
    else { run(v); }
  }, [thinking, blocked, addMsg, run]);

  const slashInput = input.startsWith("/");
  const deferredInput = useDeferredValue(input);
  
  const slashFiltered = useMemo(() => {
    if (!slashInput) return [];
    return COMMANDS.filter(c => c.cmd.startsWith(deferredInput) || deferredInput === "/" || c.cmd.includes(deferredInput));
  }, [slashInput, deferredInput]);
  
  const slashClamped = useMemo(() => {
    return Math.max(0, Math.min(slashIdx, slashFiltered.length - 1));
  }, [slashIdx, slashFiltered.length]);
  
  useEffect(() => {
    slashRef.current = { filtered: slashFiltered, clamped: slashClamped };
  }, [slashFiltered, slashClamped]);
  
  const escRef = useRef(0);

  useInput((inputVal, key) => {
    if (key.escape) {
      if (abortRef.current) { abortRef.current.abort(); return; }
      if (input.length > 0) { setInput(""); return; }
      // 双击 Esc 退出
      const now = Date.now();
      if (now - escRef.current < 500) { process.exit(0); }
      escRef.current = now;
      return;
    }
    escRef.current = 0;
    if (!slashInput || !slashFiltered.length) return;
    if (key.upArrow) setSlashIdx((slashClamped - 1 + slashFiltered.length) % slashFiltered.length);
    if (key.downArrow || key.tab) setSlashIdx((slashClamped + 1) % slashFiltered.length);
  });

  return (
    <Box flexDirection="column" paddingLeft={1}>
      {!started ? (
        <Box flexDirection="column" flexShrink={0}>
          {/* Auto-wrap layout: logo left, info right, wraps on narrow terminals */}
          <Box 
            flexDirection="row" 
            flexWrap="wrap" 
            alignItems="center"
            borderStyle="round" 
            borderColor="cyan"
            paddingX={2}
            paddingY={1}
            bg="#1a1a2e"
          >
            <Box flexDirection="column" paddingRight={4}>
              {LOGO_LINES.map((line, i) => (
                <Text key={i} color="magentaBright">{line}</Text>
              ))}
              <Text color="green">{CONFIG.llm.model} · {(CONFIG.llm.contextWindow || 1048576).toLocaleString()} tokens</Text>
            </Box>
            <Box flexGrow={1} flexShrink={1} flexDirection="column" paddingX={3} minWidth={40}>
              <Text color="cyanBright" bold>Sapni v{VER}</Text>
              <Text color="cyan" dimColor>Self-Evolving AI · Terminal Agent · Ink</Text>
              <Text>{"\n"}</Text>
              <Text color="white">Terminal-native AI coding assistant</Text>
              <Text>{"\n"}</Text>
              <Text color="gray">/ command menu · ↑↓ select · Enter confirm</Text>
            </Box>
          </Box>
          <Box marginTop={1}>
            <Text color="gray" dimColor>{"─".repeat(cols - 2)}</Text>
          </Box>
        </Box>
      ) : (
      <Box flexDirection="column" flexGrow={1}>
      {/* Auto-wrap header with modern gradient look */}
      <Box 
        flexDirection="row" 
        flexWrap="wrap" 
        alignItems="center"
        paddingX={3}
        paddingY={2}
        bg="#0d1117"
        borderStyle="round"
        borderColor="#30363d"
      >
        <Box flexDirection="column" paddingRight={4} flexShrink={0}>
          {LOGO_LINES.map((line, i) => (
            <Text key={i} color="magentaBright">{line}</Text>
          ))}
          <Text color="green">{CONFIG.llm.model} · {(CONFIG.llm.contextWindow || 1048576).toLocaleString()} tokens</Text>
        </Box>
        <Box flexGrow={1} flexShrink={1} flexDirection="column" minWidth={30}>
          <Text color="cyanBright" bold>Sapni v{VER}</Text>
          <Text color="cyan" dimColor>Self-Evolving AI · Terminal Agent · Ink</Text>
        </Box>
      </Box>
      <Box bg="#21262d" paddingY={0}><Text color="#58a6ff">{"─".repeat(cols - 2)}</Text></Box>

      {/* Messages area */}
      <Box flexDirection="column" bg="#0d1117">
        {msgs.map((m, i) => (
          <Box key={i} marginBottom={2}>
            <Msg role={m.role} content={m.content} />
          </Box>
        ))}
        {streaming ? <Box marginBottom={2}><Streaming content={streaming} /></Box> : null}
        {thinking && !streaming ? <Box marginBottom={2}><Thinking text={thinkingText} iteration={thinkingIter} content={thinkingText} /></Box> : null}
        {tools.length > 0 && (
          <Box flexDirection="column" marginBottom={2}>
            <Box bg="#0f3460" paddingY={0}><Text color="yellow">{"\u2500\u2500\u2500".repeat(Math.floor(cols / 4))}</Text></Box>
            <ToolLog tools={tools} collapsed={toolsCollapsed} />
          </Box>
        )}
      </Box>

      </Box>
      )}
      {slashInput && slashFiltered.length > 0 && (
        <Box 
          flexDirection="column" 
          paddingLeft={2} 
          marginBottom={0}
          bg="#161b22"
          borderStyle="round"
          borderColor="#30363d"
        >
          {slashFiltered.map((c, i) => {
            const sel = i === slashClamped;
            return (
              <Box key={c.cmd} flexDirection="row" paddingLeft={1}>
                <Text color={sel ? "cyanBright" : "gray"}>{sel ? "▸ " : "  "}</Text>
                <Text color={sel ? "cyanBright" : "white"} bold={sel}>{c.cmd}</Text>
                <Text color="gray"> · {c.desc}</Text>
              </Box>
            );
          })}
          <Box paddingLeft={1}>
            <Text color="cyan" dimColor>  ↑↓ Navigate · Enter Select</Text>
          </Box>
        </Box>
      )}
      <Box flexDirection="column" flexShrink={0}>
        <Box bg="#21262d" paddingY={0}><Text color="#58a6ff">{"─".repeat(cols - 2)}</Text></Box>
        
        {/* StatusBar - simplified */}
        <Box bg="#161b22" paddingX={2} paddingY={1}>
          <Text>
            <Text color="#f783ac">{mascotFace}</Text>
            <Text color="#6e7681"> </Text>
            <Text color="#c9d1d9">{CONFIG.llm.model}</Text>
            <Text color="#484f58"> · </Text>
            <Text color="#58a6ff">msg {msgs.length}</Text>
            <Text color="#484f58"> · </Text>
            <Text color={ctxPct > 90 ? "#f85149" : ctxPct > 80 ? "#d29922" : "#3fb950"}>ctx {Math.round(ctxPct)}%</Text>
          </Text>
        </Box>

        {queue.length > 0 && (
          <Box bg="#161b22" paddingX={2} paddingBottom={1}>
            <Text color="#d29922" dimColor>
{"│ "}Queue: {queue.length} pending
              {queue.slice(0, 3).map((q, i) => (
                <Text key={i} color="#6e7681">{" · "}{q.slice(0, 30)}{q.length > 30 ? "…" : ""}</Text>
              ))}
              {queue.length > 3 ? <Text color="#6e7681"> ...</Text> : null}
            </Text>
          </Box>
        )}

        <Box bg="#21262d" paddingY={0}><Text color="#f783ac">{"─".repeat(cols - 2)}</Text></Box>

        {input.length > 200 && (
          <Box bg="#0d1117" paddingX={2}>
            <Text color="#6e7681" dimColor>  [{input.length} chars]</Text>
          </Box>
        )}

        {/* Input area with GitHub-style green */}
        <Box 
          paddingY={0} 
          flexDirection="row" 
          flexWrap="wrap"
          bg="#0d1117"
          borderStyle="round"
          borderColor="#30363d"
        >
          <Text color="#3fb950" bold flexShrink={0}>{promptFace} </Text>
          <Box flexGrow={1} flexShrink={1} minWidth={20}>
            <TextInput
              value={input.length > 500 ? "…" + input.slice(-499) : input}
              onChange={(v) => {
                setSlashIdx(0);
                if (v.length <= 500) {
                  setInput(v);
                  setPromptFace(kao.promptFace(v));
                }
              }}
              onSubmit={handleSubmit}
              placeholder={thinking ? "thinking..." : "> "}
              placeholderColor="gray"
            />
          </Box>
        </Box>

        <Box bg="#0f3460" paddingY={0}><Text color="magenta">{"─".repeat(cols - 2)}</Text></Box>
      </Box>
    </Box>
  );
}

const { waitUntilExit } = render(<App />);
