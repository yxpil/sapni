#!/usr/bin/env node
import React, { useState, useCallback, useRef, useEffect } from "react";
import { render, Box, Text, useInput, useStdout } from "ink";
import TextInput from "ink-text-input";
import Spinner from "ink-spinner";
import { createRequire } from "module";
import path from "path";
import fs from "fs";
import os from "os";

const require = createRequire(import.meta.url);

const Tools = require("../Tools");
const { listRecentTurns, searchHistory, getFileList, loadFileTurns, listSessions, getSession, loadSessionTurns, globalSearch, endSession, startSession } = require("../Mem/history");
const kao = require("../Tools/kaomoji");

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);

const SAPNI_DIR = path.join(os.homedir(), ".sapni");
const SAPNI_CONFIG = path.join(SAPNI_DIR, "config.json");
const PKG_CONFIG = path.join(__dirname, "..", "config.json");
const LOGO_PATH = path.join(__dirname, "..", "Logos", "StartLogo.txt");

const VER = "1.0.0";

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

function Msg({ role, content }) {
  const C = {
    user: "greenBright",
    system: "yellow",
    assistant: "cyanBright",
  };
  const label = role === "user" ? "你" : role === "system" ? "系统" : "Sapni";
  const face = content._kao || kao.matchFace(content, role);
  const displayLabel = `${face} ${label}`;
  const bodyColor = role === "user" ? "white" : role === "system" ? "yellow" : undefined;

  const MAX = role === "user" ? 300 : 99999;
  const folded = content.length > MAX;
  const lines = (folded ? content.slice(0, 200) : content).split("\n");
  const hidden = folded ? content.length - 200 : 0;

  return (
    <Box flexDirection="column">
      <Text color={C[role]} bold>{displayLabel}</Text>
      <Text color={bodyColor}>
        {lines.map((l, i) => (i === 0 ? "" : "\n") + "   " + (l || " ")).join("")}
      </Text>
      {folded && (
        <Text color="gray" dimColor>
          {"   [+" + Math.ceil(hidden / 100) * 100 + " MORE]"}
        </Text>
      )}
    </Box>
  );
}

function Streaming({ content }) {
  const lines = content.split("\n");
  const face = kao.timeBased().includes("zzz") ? "(。-ω-)zzz" : "(。-ω-)";
  return (
    <Box flexDirection="column">
      <Box>
        <Text color="magentaBright" bold>{face} Sapni</Text>
        <Box marginLeft={1}>
          <Text color="magenta"><Spinner type="dots" /></Text>
        </Box>
      </Box>
      <Text>{lines.map((l, i) => (i === 0 ? "" : "\n") + "   " + (l || " ")).join("")}</Text>
    </Box>
  );
}

function ToolLog({ tools, collapsed }) {
  if (!tools.length) return null;

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

  if (collapsed) {
    return (
      <Box flexDirection="column" paddingLeft={2}>
        <Text color="gray" dimColor>{"─".repeat(50)} 工具调用 ({tools.length})</Text>
        {tools.map((t, i) => {
          const cr = colorResult(t.result);
          return (
            <Box key={i} flexDirection="row">
              {t.status === "done"
                ? <Text color="green"> ✓ </Text>
                : <Text color="yellow"><Spinner /></Text>}
              <Text color="magenta">{t.name}</Text>
              {cr ? <Text color={cr.color}> {cr.text}</Text> : null}
            </Box>
          );
        })}
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingLeft={2}>
      <Text color="gray" dimColor>{"─".repeat(50)} 工具调用 ({tools.length})</Text>
      {tools.map((t, i) => (
        <Box key={i} flexDirection="column" marginBottom={1}>
          <Box flexDirection="row">
            {t.status === "done"
              ? <Text color="green">✓ </Text>
              : <Text color="yellow"><Spinner type="dots" /> </Text>}
            <Text color="magenta" bold>{t.name}</Text>
          </Box>
          {t.args ? (
            <Box paddingLeft={3}>
              <Text color="gray">{t.args}</Text>
            </Box>
          ) : null}
          {t.result ? (() => {
            const lines = t.result.split("\n").filter(l => l.trim());
            if (lines.length <= 1) {
              const cr = colorResult(t.result);
              return (
                <Box paddingLeft={3}>
                  <Text color={cr?.color || "gray"}>{t.result.slice(0, 200)}</Text>
                </Box>
              );
            }
            return (
              <Box flexDirection="column" paddingLeft={3}>
                {lines.map((l, j) => {
                  const cr = colorResult(l);
                  return (
                    <Text key={j} color={cr?.color || "gray"}>
                      {cr?.text || l.slice(0, 200)}
                    </Text>
                  );
                }).slice(0, 6)}
                {lines.length > 6 ? <Text color="gray" dimColor>... (+{lines.length - 6} 行)</Text> : null}
              </Box>
            );
          })() : null}
        </Box>
      ))}
    </Box>
  );
}

function Thinking() {
  return (
    <Box paddingLeft={3} flexDirection="row">
      <Text color="magenta"><Spinner type="dots" /></Text>
      <Text color="magenta"> 正在思考...</Text>
    </Box>
  );
}

let _agent = null;
function getAgent() {
  if (_agent) return _agent;
  const Agent = require("./agent.cjs");
  _agent = new Agent(CONFIG, { onPermission: () => true });
  return _agent;
}

const COMMANDS = [
  { cmd: "/help", desc: "查看帮助" },
  { cmd: "/exit", desc: "退出程序" },
  { cmd: "/reset", desc: "重置对话" },
  { cmd: "/clear", desc: "清除对话" },
  { cmd: "/version", desc: "查看版本" },
  { cmd: "/status", desc: "当前状态" },
  { cmd: "/ctx", desc: "上下文使用量" },
  { cmd: "/tools", desc: "列出工具" },
  { cmd: "/tools_more", desc: "全部工具(含扩展)" },
  { cmd: "/tool_search", desc: "搜索工具" },
  { cmd: "/tool_list_saved", desc: "列出持久化工具" },
  { cmd: "/tool_save", desc: "持久化保存工具" },
  { cmd: "/tool_del_saved", desc: "删除持久化工具" },
  { cmd: "/temp", desc: "设置温度 0-2" },
  { cmd: "/token", desc: "设置最大输出token" },
  { cmd: "/memory", desc: "记忆统计" },
  { cmd: "/memory_list", desc: "列出记忆条目" },
  { cmd: "/memory_search", desc: "搜索记忆" },
  { cmd: "/memory_del", desc: "删除记忆" },
  { cmd: "/memory_clear", desc: "清空记忆" },
  { cmd: "/compress", desc: "手动压缩上下文" },
  { cmd: "/history", desc: "查看最近历史" },
  { cmd: "/history files", desc: "历史文件列表" },
  { cmd: "/history search", desc: "搜索历史" },
  { cmd: "/history read", desc: "读取历史文件" },
  { cmd: "/sessions", desc: "列出对话 session" },
  { cmd: "/session", desc: "查看某个 session" },
  { cmd: "/session_search", desc: "全局搜索 session" },
  { cmd: "/trusted", desc: "查看受信任工具" },
  { cmd: "/trust", desc: "永久信任工具" },
  { cmd: "/untrust", desc: "取消信任" },
  { cmd: "/api", desc: "查看/配置API" },
  { cmd: "/api key", desc: "设置API Key" },
  { cmd: "/api url", desc: "设置API地址" },
  { cmd: "/api model", desc: "设置模型" },
];

function App() {
  const { stdout } = useStdout();
  const cols = stdout ? stdout.columns : 80;

  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
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


  useEffect(() => {
    const timer = setInterval(() => setMascotFace(kao.mascotForFrame()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setPromptFace(kao.promptFace(input)), 150);
    return () => clearInterval(timer);
  }, [input]);
  const [msgs, setMsgs] = useState([]);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    setCtxPct(getAgent().estimateContextPct());
  }, []);

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
        "\u2502  /help              查看帮助       \u2502",
        "\u2502  /exit              退出程序       \u2502",
        "\u2502  /reset             重置对话       \u2502",
        "\u2502  /clear             清除对话       \u2502",
        "\u2502  /version           查看版本       \u2502",
        "\u2502  /status            当前状态       \u2502",
        "\u2502  /ctx               上下文使用量   \u2502",
        "\u2502  /tools             列出工具       \u2502",
        "\u2502  /tools_more        全部工具       \u2502",
        "\u2502  /tool_search <q>   搜索工具       \u2502",
        "\u2502  /tool_list_saved   列出持久化工具 \u2502",
        "\u2502  /tool_save <name>  持久化保存工具 \u2502",
        "\u2502  /tool_del <name>   删除持久化工具 \u2502",
        "\u2502  /temp <0-2>        设置温度       \u2502",
        "\u2502  /token <n>         设置maxTokens  \u2502",
        "\u2502  /memory            记忆统计       \u2502",
        "\u2502  /memory_list [n]   列出记忆条目   \u2502",
        "\u2502  /memory_search <q> 搜索记忆       \u2502",
        "\u2502  /memory_del <id>   删除记忆       \u2502",
        "\u2502  /memory_clear      清空记忆       \u2502",
        "\u2502  /compress          手动压缩上下文 \u2502",
        "\u2502  /history [n]       最近历史       \u2502",
        "\u2502  /history files     历史文件列表   \u2502",
        "\u2502  /history search <q>搜索历史       \u2502",
        "\u2502  /history read <f>  读取历史文件   \u2502",
        "\u2502  /sessions [n]      列出对话session\u2502",
        "\u2502  /session <id>      查看session   \u2502",
        "\u2502  /session_search <q>全局搜索session\u2502",
        "\u2502  /trusted           受信任工具     \u2502",
        "\u2502  /trust <name>      永久信任工具   \u2502",
        "\u2502  /untrust <name>    取消信任       \u2502",
        "\u2502  /api               查看API配置    \u2502",
        "\u2502  /api key <K>       设置Key        \u2502",
        "\u2502  /api url <U>       设置地址       \u2502",
        "\u2502  /api model <M>     设置模型       \u2502",
        "\u2570\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500",
      ].join("\n"));
    }
    else if (cmd === "exit") process.exit(0);
    else if (cmd === "reset") {
      const a = getAgent();
      endSession(a.sessionId);
      a.reset();
      a.sessionId = startSession();
      setMsgs([{ role: "system", content: "对话已重置，新 session 已创建。" }]);
      setCtxPct(0);
      say("对话已重置, 新 session 已创建");
    }
    else if (cmd === "clear") {
      setMsgs([{ role: "system", content: "对话已清除。" }]);
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
        "  模型: " + CONFIG.llm.model + "  温度: " + CONFIG.llm.temperature,
        "  Tokens: 输入" + usage.prompt + " · 输出" + usage.completion,
        "  上下文: " + pct + "% (上限 " + a.getMaxContextTokens() + " tokens)",
        "  记忆: ROM" + (mem.romEntries || mem.entries) + " RAM" + (mem.ramEntries || 0) + " · 历史 " + mem.historyMessages + " 轮",
        "  工具: " + names.length + " 个 — " + names.slice(0, 8).join(", ") + (names.length > 8 ? " ..." : ""),
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
        "上下文: [" + bar + "] " + pct + "%",
        "上限: " + a.getMaxContextTokens() + " tokens",
        "累计: 输入" + usage.prompt + " · 输出" + usage.completion + " · 合计" + (usage.prompt + usage.completion),
        ">80% 时可 /compress 压缩或让 AI 调用 forget_conversation",
      ].join("\n"));
    }
    else if (cmd === "memory") {
      const s = getAgent().memory.stats();
      say("记忆: ROM" + (s.romEntries || s.entries) + " RAM" + (s.ramEntries || 0) + " · 历史消息 " + s.historyMessages + " 轮");
    }
    else if (cmd === "memory_list") {
      const n = parseInt(rest) || 20;
      const all = getAgent().memory.getAllEntries().slice(-n);
      if (!all.length) { say("(无记忆条目)"); return; }
      say(all.map((e) => {
        const tag = e._type === "ram" ? "[RAM]" : "[ROM]";
        return tag + " #" + e.id + " [" + (e.tags?.join(",") || "-") + "] " + e.text;
      }).join("\n"));
    }
    else if (cmd === "memory_search") {
      if (!rest) { say("用法: /memory_search <关键词>"); return; }
      const found = getAgent().memory.searchEntries(rest, 10);
      if (!found.length) { say("未找到匹配 \"" + rest + "\" 的记忆"); return; }
      say(found.map((e) => "#" + e.id + " [" + (e.tags?.join(",") || "-") + "] " + e.text).join("\n"));
    }
    else if (cmd === "memory_del") {
      const id = parseInt(rest);
      if (isNaN(id)) { say("用法: /memory_del <id>"); return; }
      const ok = getAgent().memory.removeEntry(id);
      say(ok ? "已删除 #" + id : "不存在 #" + id);
    }
    else if (cmd === "memory_clear") {
      getAgent().memory.clearAllEntries();
      say("记忆已全部清空 (ROM+RAM)");
    }
    else if (cmd === "compress") {
      const a = getAgent();
      const compressed = a.memory.compressHistory();
      if (!compressed) { say("对话太短, 无需压缩"); return; }
      a.memory.clear();
      a.memory.addRamEntry("手动压缩: " + compressed.slice(0, 180), ["manual-summary"]);
      say("上下文已压缩, 历史清空, 摘要已存入记忆");
    }
    else if (cmd === "tools") {
      const names = Tools.listToolNames();
      const base = names.filter((n) => !["forget_conversation", "restart_session", "todo_write", "search_replace", "glob", "grep", "read", "write", "ls", "web_search", "check_command_status", "open_preview", "get_diagnostics", "skill", "exec_console", "wait_command", "web_fetch"].includes(n));
      const lines = base.map((n) => {
        const t = Tools.getTool(n);
        return "  " + n + (t?.description ? " — " + t.description.slice(0, 40) : "");
      });
      say(lines.join("\n") + "\n\n共 " + base.length + " 个核心工具, " + (names.length - base.length) + " 个扩展工具 (输入 /tools_more 查看全部)");
    }
    else if (cmd === "tools_more") {
      const names = Tools.listToolNames();
      say(names.map((n) => {
        const t = Tools.getTool(n);
        return "  " + n + (t?.description ? " — " + t.description.slice(0, 60) : "");
      }).join("\n") + "\n\n共 " + names.length + " 个工具");
    }
    else if (cmd === "tool_search") {
      if (!rest) { say("用法: /tool_search <关键词>"); return; }
      const found = Tools.searchToolRegistry(rest);
      if (!found.length) { say("未找到匹配 \"" + rest + "\" 的工具"); return; }
      say(found.map((t) => t.name + " — " + t.description).join("\n"));
    }
    else if (cmd === "tool_list_saved") {
      const saved = Tools.listCustomTools();
      if (!saved.length) { say("(无持久化工具)"); return; }
      say(saved.map((s) => "[" + s.file + "] 导出: " + s.exports.join(", ")).join("\n"));
    }
    else if (cmd === "tool_del_saved") {
      if (!rest) { say("用法: /tool_del_saved <name>"); return; }
      const result = Tools.deleteToolFile(rest);
      if (result.startsWith("[OK]")) getAgent().refreshTools();
      say(result);
    }
    else if (cmd === "temp") {
      const n = parseFloat(rest);
      if (isNaN(n) || n < 0 || n > 2) { say("温度范围 0-2"); return; }
      CONFIG.llm.temperature = n; saveConfig(CONFIG);
      say("温度已设为 " + n);
    }
    else if (cmd === "token") {
      const n = parseInt(rest, 10);
      if (isNaN(n) || n < 1 || n > 128000) { say("范围 1-128000"); return; }
      CONFIG.llm.maxTokens = n; saveConfig(CONFIG);
      say("MaxTokens 已设为 " + n);
    }
    else if (cmd === "history") {
      const subParts = rest.trim().split(/\s+/);
      const sub = subParts[0]?.toLowerCase();
      const arg = subParts.slice(1).join(" ");
      if (sub === "files") {
        const files = getFileList();
        if (!files.length) { say("(暂无历史文件)"); return; }
        say(files.map((f) => f.file + " | " + f.turns + "轮 | " + f.size + "KB | " + f.created.slice(0, 10)).join("\n"));
      } else if (sub === "search") {
        if (!arg) { say("用法: /history search <关键词>"); return; }
        const results = searchHistory(arg, 10);
        if (!results.length) { say("未找到匹配 \"" + arg + "\""); return; }
        say(results.map((r, i) => (i + 1) + ". [" + r.file + "] " + (r.time?.slice(0, 16) || "?") + "\n  " + r.user.slice(0, 120)).join("\n\n"));
      } else if (sub === "read") {
        if (!arg) { say("用法: /history read <文件名>"); return; }
        const turns = loadFileTurns(arg, 10);
        if (!turns.length) { say("找不到文件 " + arg); return; }
        say(turns.map((t, i) => (i + 1) + ". [" + (t.time?.slice(0, 16) || "?") + "]\n  问: " + (t.user || "").slice(0, 200) + "\n  答: " + (t.assistant || "").slice(0, 200)).join("\n\n"));
      } else {
        const n = parseInt(sub) || 10;
        const turns = listRecentTurns(n);
        if (!turns.length) { say("(暂无历史记录)"); return; }
        say(turns.map((t, i) => (i + 1) + ". [" + (t.time?.slice(0, 16) || "?") + "] " + (t.user || "").slice(0, 120)).join("\n"));
      }
    }
    else if (cmd === "sessions") {
      const n = parseInt(rest) || 20;
      const sessions = listSessions(n);
      if (!sessions.length) { say("(暂无对话 session)"); return; }
      const lines = sessions.map((s, i) => {
        const marker = s.status === "active" ? "\u25cf" : "\u25cb";
        return (i + 1) + ". " + marker + " [" + (s.started || "?").slice(0, 16) + "] " +
          (s.title || "(无标题)") + " | " + s.turnCount + "轮" +
          (s.status === "active" ? " \u25c0 当前" : "");
      });
      say("对话 Sessions (" + sessions.length + "):\n" + lines.join("\n") +
        "\n\n用 /session <编号> 查看详情, /session_search <关键词> 搜索");
    }
    else if (cmd === "session") {
      if (!rest) { say("用法: /session <session_id 或列表序号>\n请先用 /sessions 查看列表"); return; }
      const sessions = listSessions(999);
      let sid = rest.trim();
      if (/^\d+$/.test(sid)) {
        const idx = parseInt(sid) - 1;
        if (idx < 0 || idx >= sessions.length) { say("序号超出范围 (1-" + sessions.length + ")"); return; }
        sid = sessions[idx].id;
      }
      const session = getSession(sid);
      if (!session) { say("未找到 session: " + sid); return; }
      const turns = loadSessionTurns(sid, 30);
      const header = "=== " + (session.title || "(无标题)") + " ===\n" +
        "ID: " + session.id + "  |  " + (session.started || "?").slice(0, 16) + "  |  " + session.turnCount + "轮\n";
      if (!turns.length) { say(header + "\n(这个 session 暂无对话轮次)"); return; }
      const body = turns.map((t, i) => {
        return "[" + (i + 1) + "] " + (t.time || "?").slice(0, 16) + "\n" +
          "  问: " + (t.user || "").slice(0, 300) + "\n" +
          "  答: " + (t.assistant || "").slice(0, 300);
      }).join("\n\n");
      say(header + "\n" + body + "\n\n(共 " + turns.length + " 轮, 显示最近 30 轮)");
    }
    else if (cmd === "session_search") {
      if (!rest) { say("用法: /session_search <关键词> [数量]\n在整个历史中搜索相关 session"); return; }
      const parts = rest.trim().split(/\s+/);
      const limit = parseInt(parts[parts.length - 1]) || 10;
      const query = isNaN(parseInt(parts[parts.length - 1])) ? rest.trim() : parts.slice(0, -1).join(" ");
      const results = globalSearch(query, limit);
      if (!results.length) { say("全史搜索未找到 \"" + query + "\""); return; }
      const lines = [];
      for (const [i, r] of results.entries()) {
        lines.push((i + 1) + ". [" + (r.sessionStarted || "?").slice(0, 16) + "] " +
          r.sessionTitle + " | " + r.matchCount + "处匹配 | 得分" + r.totalScore);
        for (const m of r.topMatches) {
          lines.push("    · " + (m.user || "").slice(0, 100));
        }
      }
      say("搜索 \"" + query + "\" — " + results.length + " 个 session:\n" + lines.join("\n") +
        "\n\n用 /session <编号> 查看详情");
    }
    else if (cmd === "trusted") {
      const trusted = CONFIG.tools?.trustedTools || [];
      if (!trusted.length) { say("(暂无受信任工具)"); return; }
      say("受信任工具 (" + trusted.length + " 个):\n" + trusted.join("\n"));
    }
    else if (cmd === "trust") {
      if (!rest) { say("用法: /trust <工具名>"); return; }
      Tools.addTrusted(rest);
      CONFIG.tools.trustedTools = [...new Set([...(CONFIG.tools?.trustedTools || []), rest])];
      saveConfig(CONFIG);
      say("已永久信任 " + rest);
    }
    else if (cmd === "untrust") {
      if (!rest) { say("用法: /untrust <工具名>"); return; }
      Tools.removeTrusted(rest);
      CONFIG.tools.trustedTools = (CONFIG.tools?.trustedTools || []).filter((n) => n !== rest);
      saveConfig(CONFIG);
      say("已取消信任 " + rest);
    }
    else if (cmd === "api") {
      const sub = rest.split(/\s+/)[0]?.toLowerCase();
      const val = rest.slice(sub ? sub.length : 0).trim();
      if (sub === "key") {
        if (!val) { say("用法: /api key <Key>"); return; }
        if (val.length < 10) { say("Key 太短"); return; }
        CONFIG.llm.apiKey = val; saveConfig(CONFIG);
        say("API Key 已更新 (" + val.slice(0, 8) + "...)");
      } else if (sub === "url") {
        if (!val) { say("用法: /api url <地址>"); return; }
        CONFIG.llm.baseURL = val.replace(/\/+$/, ""); saveConfig(CONFIG);
        say("API 地址已更新: " + CONFIG.llm.baseURL);
      } else if (sub === "model") {
        if (!val) { say("用法: /api model <模型名>"); return; }
        CONFIG.llm.model = val; saveConfig(CONFIG);
        say("模型已更新: " + CONFIG.llm.model);
      } else {
        const masked = CONFIG.llm.apiKey ? CONFIG.llm.apiKey.slice(0, 8) + "..." + CONFIG.llm.apiKey.slice(-4) : "(未设置)";
        say([
          "API 设置",
          "  Key:   " + masked,
          "  URL:   " + CONFIG.llm.baseURL,
          "  Model: " + CONFIG.llm.model,
          "  温度:  " + CONFIG.llm.temperature + "  |  MaxTokens: " + (CONFIG.llm.maxTokens || "-"),
          "  设置: /api key <K>  |  /api url <U>  |  /api model <M>",
        ].join("\n"));
      }
    }
    else { run(v); }
  }, [thinking, blocked, addMsg, run]);

  const slashInput = input.startsWith("/");
  const slashFiltered = slashInput
    ? COMMANDS.filter(c => c.cmd.startsWith(input) || input === "/" || c.cmd.includes(input))
    : [];
  const slashClamped = Math.max(0, Math.min(slashIdx, slashFiltered.length - 1));
  slashRef.current = { filtered: slashFiltered, clamped: slashClamped };
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
          {/* 启动页: LOGO + 欢迎框 */}
          <Box flexDirection="row">
            {/* 左边 LOGO */}
            <Box flexDirection="column" paddingRight={2}>
              {LOGO_LINES.map((line, i) => (
                <Text key={i} color="magentaBright">{line}</Text>
              ))}
              <Text color="green">{CONFIG.llm.model} · {CONFIG.llm.contextWindow || 1048576} tokens</Text>
            </Box>
            {/* 右边欢迎框 */}
            <Box borderStyle="round" borderColor="cyan" flexDirection="column" paddingX={2} paddingY={1}>
              <Text color="magentaBright" bold>Sapni v{VER}</Text>
              <Text color="magenta" dimColor>Self-Evolving AI · Terminal Agent · Ink</Text>
              <Text> </Text>
              <Text dimColor>Terminal-native AI coding assistant</Text>
              <Text> </Text>
              <Text dimColor>/ command menu · ↑↓ select · Enter confirm</Text>
            </Box>
          </Box>
          <Box marginTop={1}>
            <Text color="gray" dimColor>{"─".repeat(cols - 2)}</Text>
          </Box>
        </Box>
      ) : (
      <Box flexDirection="column" flexGrow={1}>
      <Box flexDirection="column" flexShrink={0}>
        {LOGO_LINES.map((line, i) => (
          <Text key={i} color="magentaBright">{line}</Text>
        ))}
        <Box marginTop={1}>
          <Text color="magenta" dimColor>Self-Evolving AI · Terminal Agent · Ink</Text>
        </Box>
        <Text color="gray" dimColor>{"─".repeat(cols - 2)}</Text>
      </Box>

      <Box flexDirection="column">
        {msgs.map((m, i) => (
          <Msg key={i} role={m.role} content={m.content} />
        ))}
        {streaming ? <Streaming content={streaming} /> : null}
        {thinking && !streaming ? <Thinking /> : null}
        {tools.length > 0 && (
          <Box flexDirection="column">
            <Text color="gray" dimColor>{"\u2500\u2500\u2500".repeat(8)}</Text>
            <ToolLog tools={tools} collapsed={toolsCollapsed} />
          </Box>
        )}
      </Box>

      </Box>
      )}
      {slashInput && slashFiltered.length > 0 && (
        <Box flexDirection="column" paddingLeft={2} marginBottom={0}>
          {slashFiltered.map((c, i) => {
            const sel = i === slashClamped;
            return (
              <Box key={c.cmd} paddingLeft={1}>
                <Text color={sel ? "magenta" : "gray"}>{sel ? "\u25b8 " : "  "}</Text>
                <Text color={sel ? "magentaBright" : undefined} bold={sel}>{c.cmd}</Text>
                <Text color="gray">{" \u00b7 " + c.desc}</Text>
              </Box>
            );
          })}
          <Box paddingLeft={1}>
            <Text color="gray">  \u2191\u2193 切换 \u00b7 回车 选取</Text>
          </Box>
        </Box>
      )}
      <Box flexDirection="column" flexShrink={0}>
        <Text color="gray" dimColor>{"─".repeat(cols - 2)}</Text>
        <Box paddingX={1}>
          <Text dimColor>
            <Text color="magenta">{mascotFace}</Text> {CONFIG.llm.model}
            {" │ "}
            <Text color="magenta">msg</Text> {msgs.length}
            {" │ "}
            <Text color={ctxPct > 80 ? "yellow" : ctxPct > 90 ? "red" : "green"}>ctx</Text> {ctxPct}%
            {" │ "}
            F1帮助 · Esc清空 · 双击退出
          </Text>
        </Box>

        {queue.length > 0 && (
          <Box paddingX={1} paddingBottom={1}>
            <Text color="yellow" dimColor>
              {"│ "}队列: {queue.length} 条待执行
              {queue.slice(0, 3).map((q, i) => (
                <Text key={i} color="gray">{" · "}{q.slice(0, 30)}{q.length > 30 ? "…" : ""}</Text>
              ))}
              {queue.length > 3 ? <Text color="gray"> ...</Text> : null}
            </Text>
          </Box>
        )}

        <Text color="magenta">{"─".repeat(cols - 2)}</Text>

        {input.length > 200 && (
          <Box paddingX={1}>
            <Text color="gray" dimColor>  [{input.length} chars]</Text>
          </Box>
        )}

        <Box paddingY={0} flexDirection="row">
          <Text color="greenBright" bold>{promptFace}  </Text>
          <Box flexGrow={1}>
            <TextInput
              value={input.length > 500 ? "…" + input.slice(-300) : input}
              onChange={v => {
                setSlashIdx(0);
                
                if (v.startsWith("…")) {
                  setInput(input.slice(0, Math.max(0, input.length - 300)) + v.slice(1));
                } else {
                  setInput(v);
                }
              }}
              onSubmit={handleSubmit}
              placeholder={thinking ? "thinking..." : "> "}
            />
          </Box>
        </Box>

        <Text color="magenta">{"─".repeat(cols - 2)}</Text>
      </Box>
    </Box>
  );
}

const { waitUntilExit } = render(<App />);
