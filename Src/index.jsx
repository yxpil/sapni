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
const presets = require("./presets.cjs");
const { listRecentTurns, searchHistory, getFileList, loadFileTurns, listSessions, getSession, loadSessionTurns, globalSearch, endSession, startSession } = require("../Mem/history");
const kao = require("../Tools/kaomoji");
import { ToolLog, Msg, Thinking, Streaming, StatusBar } from "./components";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SAPNI_DIR = path.join(os.homedir(), ".sapni");
const SAPNI_CONFIG = path.join(SAPNI_DIR, "config.json");
const PKG_CONFIG = path.join(__dirname, "..", "config.json");
const LOGO_PATH = path.join(__dirname, "..", "Logos", "StartLogo.txt");

const VER = "1.1.17";

function ensureDir() { if (!fs.existsSync(SAPNI_DIR)) fs.mkdirSync(SAPNI_DIR, { recursive: true }); }
function loadConfig() {
  ensureDir();
  if (fs.existsSync(SAPNI_CONFIG)) return JSON.parse(fs.readFileSync(SAPNI_CONFIG, "utf-8"));
  const cfg = JSON.parse(fs.readFileSync(PKG_CONFIG, "utf-8"));
  fs.writeFileSync(SAPNI_CONFIG, JSON.stringify(cfg, null, 2), "utf-8");
  return cfg;
}
function saveConfig(cfg) {
  ensureDir();
  fs.writeFileSync(SAPNI_CONFIG, JSON.stringify(cfg, null, 2), "utf-8");
  // 自动重载 LLM 配置，无需重启
  if (_agent && _agent.llm) {
    _agent.llm.reloadConfig(cfg.llm);
    // 同步上下文窗口估算
    if (cfg.llm?.contextWindow) {
      _agent.actualContextWindow = cfg.llm.contextWindow;
      _agent.maxContextTokens = cfg.llm.contextWindow * 0.8;
    }
  }
}

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

// ── 统一绘图框 (Unicode box-drawing, 自适应宽度, Win32 降级) ──────────
const _isLegacyWin = (() => {
  try {
    if (process.platform !== "win32") return false;
    // Windows 10+ ConPTY 支持 VT/Unicode, 旧版 cmd/powershell 不支持
    const wt = process.env.WT_SESSION || "";
    const term = (process.env.TERM || "").toLowerCase();
    const conpty = process.env.ConPTY || "";
    if (wt || term.includes("xterm") || conpty) return false;
    return true;
  } catch (_) { return false; }
})();

const BOX = _isLegacyWin
  ? { TL: "+", TR: "+", BL: "+", BR: "+", H: "-", V: "|" }
  : { TL: "\u256d", TR: "\u256e", BL: "\u2570", BR: "\u256f", H: "\u2500", V: "\u2502" };

function drawBox(lines, maxW) {
  try {
    const w = Math.min(maxW || 80, 80);
    const innerW = w - 4;
    const top = `${BOX.TL}${BOX.H.repeat(w - 2)}${BOX.TR}`;
    const body = (lines || []).map((l) => {
      try {
        const clean = String(l);
        const pad = Math.max(0, innerW - termLen(clean));
        return `${BOX.V}  ${clean}${" ".repeat(pad)}${BOX.V}`;
      } catch (_) { return `${BOX.V}  (err)${" ".repeat(innerW - 6)}${BOX.V}`; }
    });
    const bot = `${BOX.BL}${BOX.H.repeat(w - 2)}${BOX.BR}`;
    return [top, ...body, bot].join("\n");
  } catch (_) { return (lines || []).join("\n"); }
}

function drawBoxTitle(title, maxW) {
  return drawBox([title], maxW);
}

// ── 显示 Sapni 扩展路径 ──────────
function expandPaths() {
  try {
    const pkgDir = path.resolve(__dirname, "..");
  const memDir = path.join(SAPNI_DIR, "mem");
  const histDir = path.join(SAPNI_DIR, "history");
  const customToolsDir = path.join(SAPNI_DIR, "Tools", "custom");
  const apiTokens = path.join(SAPNI_DIR, "api_tokens.json");
  const skillsDir = path.join(pkgDir, "Skills");
  const logosDir = path.join(pkgDir, "Logos");
  const bin = path.join(os.homedir(), ".npm-global", "bin", "sapni");

  const entries = [
    { label: "包目录 / Package",  path: pkgDir },
    { label: "用户配置 / Config",  path: SAPNI_CONFIG },
    { label: "记忆存储 / Memory",  path: memDir },
    { label: "历史会话 / History", path: histDir },
  ];

  entries.push({ label: "自定义工具 / Tools", path: customToolsDir });
  entries.push({ label: "API令牌 / Tokens", path: apiTokens });
  entries.push({ label: "内置技能 / Skills", path: skillsDir });
  entries.push({ label: "Logo资源 / Logos", path: logosDir });
  entries.push({ label: "启动入口 / Binary", path: bin });

  return { entries };
  } catch (_) { return { entries: [{ label: "路径解析失败 / Path error", path: String(SAPNI_DIR) }] }; }
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
  _agent = new Agent(CONFIG, {
    onPermission: (name, args) => {
      const trusted = CONFIG.tools?.trustedTools || [];
      return trusted.includes(name);
    },
  });
  return _agent;
}

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
  { cmd: "/provider", desc: "一键切换 AI 提供商（自动导入推荐值）/ Switch provider" },
  { cmd: "/persona", desc: "查看当前身份 / View persona" },
  { cmd: "/persona reset", desc: "重置身份为默认 / Reset persona" },
  { cmd: "/persona show", desc: "显示当前身份 / Show persona" },
  { cmd: "/persona off", desc: "关闭自定义身份, 使用默认提示 / Disable persona" },
  { cmd: "/trusted", desc: "受信任工具 / Trusted tools" },
  { cmd: "/trust", desc: "信任工具 / Trust: on(会话级) / off / status / all / <name>" },
  { cmd: "/untrust", desc: "取消信任 / Untrust" },
  { cmd: "/update", desc: "更新到最新版 / Update to latest" },
  { cmd: "/retry", desc: "重试设置 / Retry config" },
  { cmd: "/network", desc: "网络检测 / Network check" },
  { cmd: "/histoken", desc: "历史token统计 / Token history" },
  { cmd: "/llm", desc: "查看 LLM 配置 / LLM config" },
  { cmd: "/llm key", desc: "设置 API Key" },
  { cmd: "/llm url", desc: "设置 API 地址 / Set URL" },
  { cmd: "/llm model", desc: "设置模型名称 / Set model" },
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
  const [tokenUsage, setTokenUsage] = useState({ prompt: 0, completion: 0 }); // 本会话
  const [toolActive, setToolActive] = useState(false);
  const [progress, setProgress] = useState({ active: false, pct: 0, label: "", remaining: 0 });
  const progressRef = useRef(null); // 进度条定时器
  const PROGRESS_TIMEOUT = 30; // 默认30s倒计时

  const startProgress = useCallback((label, timeoutSec = PROGRESS_TIMEOUT) => {
    if (progressRef.current) clearInterval(progressRef.current);
    const start = Date.now();
    const total = timeoutSec * 1000;
    setProgress({ active: true, pct: 0, label, remaining: timeoutSec });
    progressRef.current = setInterval(() => {
      const elapsed = Date.now() - start;
      const pct = Math.min(100, Math.round((elapsed / total) * 100));
      const remaining = Math.max(0, Math.ceil((total - elapsed) / 1000));
      setProgress({ active: true, pct, label, remaining });
      if (pct >= 100) {
        clearInterval(progressRef.current);
        progressRef.current = null;
        setProgress({ active: false, pct: 0, label: "", remaining: 0 });
      }
    }, 250);
  }, []);

  const stopProgress = useCallback(() => {
    if (progressRef.current) { clearInterval(progressRef.current); progressRef.current = null; }
    setProgress({ active: false, pct: 0, label: "", remaining: 0 });
  }, []);

  const statusBlink = useRef(0);
  // 状态块闪烁: 多状态并行时交替
  useEffect(() => {
    const t = setInterval(() => { statusBlink.current = (statusBlink.current + 1) % 4; }, 600);
    return () => clearInterval(t);
  }, []);
  
  const statusBlock = useMemo(() => {
    const degraded = Tools.getDegraded();
    const active = [];
    if (degraded && degraded.length > 0) active.push("red");
    if (thinking) active.push("blue");
    if (toolActive) active.push("green");
    if (!active.length) return { char: "\u25a1", color: "#6e7681", label: "idle" };
    if (active.length === 1) {
      const c = active[0];
      return { char: "\u25a0", color: c === "red" ? "#f85149" : c === "green" ? "#3fb950" : "#58a6ff", label: c };
    }
    const pick = active[statusBlink.current % active.length];
    return { char: "\u25a0", color: pick === "red" ? "#f85149" : pick === "green" ? "#3fb950" : "#58a6ff", label: active.join("+") };
  }, [thinking, toolActive]);
  const [blocked, setBlocked] = useState(false);
  const [slashIdx, setSlashIdx] = useState(0);
  const [slashScroll, setSlashScroll] = useState(0); // 菜单滚动偏移
  const SLASH_PAGE = 8; // 每页显示条数
  const [mascotFace, setMascotFace] = useState(kao.mascotForFrame());
  const [promptFace, setPromptFace] = useState(kao.promptFace(""));
  const queueRef = useRef([]);
  const [queueLen, setQueueLen] = useState(0);
  const abortRef = useRef(null);
  const blockedRef = useRef(false);


  const [msgs, setMsgs] = useState([]);
  const [started, setStarted] = useState(false);
  const [updateMsg, setUpdateMsg] = useState(null);

  useEffect(() => {
    setCtxPct(getAgent().estimateContextPct());
  }, []);

  // 启动时检查 npm 最新版本
  useEffect(() => {
    const { exec } = require("child_process");
    exec("npm view sapni-ai version", { timeout: 10000 }, (err, stdout) => {
      if (err) return;
      const latest = stdout.trim();
      if (!latest || latest === VER) return;
      const msg = "⬆ 新版本可用: " + latest + " (当前 " + VER + ")\n  更新: npm install -g sapni-ai@latest";
      setUpdateMsg(msg);
      addMsg("system", msg);
    });
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
    if (blockedRef.current) {
      // 如果已经在执行，重新入队而非丢弃（防御性保险）
      queueRef.current = [...queueRef.current, query];
      setQueueLen(queueRef.current.length);
      return;
    }
    blockedRef.current = true;
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
          setToolActive(true);
          startProgress("工具: " + name, 30);
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
          // all tools done?
          if ([...toolMap.values()].every(x => x.status === "done")) { setToolActive(false); stopProgress(); }
        },
        onContextPct: (pct) => setCtxPct(pct),
        onUsage: (u) => setTokenUsage({ prompt: u.prompt, completion: u.completion }),
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
        // 自动提交错误反馈
        try {
          const https = require("https");
          const body = JSON.stringify({ message: "Sapni 运行错误: " + e.message + "\n版本: " + VER, version: VER });
          const req = https.request("https://sapni.yxpil.com/api/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, timeout: 5000 });
          req.on("timeout", () => { req.destroy(); });
          req.write(body); req.end();
        } catch (_) {}
      }
      // Make sure blocked is cleared on error/abort
      blockedRef.current = false;
      setBlocked(false);
    }

    if (buf) addMsg("assistant", formatMd(buf, cols - 4));
    setStreaming("");
    setThinking(false);
    setToolActive(false);
    stopProgress();
    setToolsCollapsed(true);
    abortRef.current = null;
    

    blockedRef.current = false;
    setBlocked(false);
    // Process next in queue (即时执行，消除 setTimeout 竞态窗口)
    const q = queueRef.current;
    if (q.length > 0) {
      const [next, ...rest] = q;
      queueRef.current = rest;
      setQueueLen(rest.length);
      addMsg("user", next);
      run(next);
    }
  }, [addMsg, cols]);

  const slashRef = useRef({ filtered: [], clamped: 0 });

  const handleSubmit = useCallback((val) => {
    try {
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
    if (blockedRef.current || thinking) {
      if (v.startsWith("/") || v.startsWith("／")) {
        // 所有斜杠命令不阻塞，直接执行
      } else {
        queueRef.current = [...queueRef.current, v];
        setQueueLen(queueRef.current.length);
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
      say(drawBox([
        "Sapni 帮助 / Sapni Help",
        "/help          帮助 / Help",
        "/exit          退出 / Exit",
        "/reset         重置 / Reset",
        "/clear         清空 / Clear",
        "/version       版本 / Version",
        "/status        状态 / Status",
        "/ctx           上下文 / Context",
        "/tools         工具 / Tools",
        "/tools_more    全部工具 / All tools",
        "/tool_search   搜索工具 / Search",
        "/temp          温度 / Temp",
        "/topp          TopP",
        "/token         最大 tokens / Max tokens",
        "/memory        记忆 / Memory",
        "/memory_list   列出 / List",
        "/memory_search 搜索 / Search",
        "/memory_del    删除 / Delete",
        "/memory_clear  清空 / Clear",
        "/compress      压缩 / Compress",
        "/history       历史 / History",
        "/sessions      会话 / Sessions",
        "/session       查看 / View",
        "/provider      切换提供商 / Provider",
        "/persona       身份设定 / Persona",
        "/llm           LLM 配置 / LLM config",
        "/sp_server     API 服务 / Server",
        "/trusted       信任管理 / Trust",
        "/update        更新 / Update",
      ], cols));
    }
    else if (cmd === "exit") {
      // 保存累计 token
      try {
        const histFile = path.join(SAPNI_DIR, "history-tokens.json");
        let hist = { prompt: 0, completion: 0, sessions: 0 };
        try { if (fs.existsSync(histFile)) hist = JSON.parse(fs.readFileSync(histFile, "utf-8")); } catch (_) {}
        const cur = getAgent().llm.getUsage();
        hist.prompt = (hist.prompt || 0) + (cur.prompt || 0);
        hist.completion = (hist.completion || 0) + (cur.completion || 0);
        hist.sessions = (hist.sessions || 0) + 1;
        fs.writeFileSync(histFile, JSON.stringify(hist), "utf-8");
      } catch (_) {}
      process.exit(0);
    }
    else if (cmd === "reset") {
      const a = getAgent();
      // 先保存累计
      try {
        const histFile = path.join(SAPNI_DIR, "history-tokens.json");
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
      setTokenUsage({ prompt: 0, completion: 0 });
      a.sessionId = startSession();
      setMsgs([{ role: "system", content: "对话已重置，新会话已创建。" }]);
      setCtxPct(0);
      say("对话已重置，新会话已创建 / Chat reset");
    }
    else if (cmd === "clear") {
      setMsgs([{ role: "system", content: "对话已清空。" }]);
      setCtxPct(0);
    }
    else if (cmd === "version") {
      say("Sapni v" + VER + " — " + CONFIG.llm.model);
    }
    else if (cmd === "status") {
      const a = getAgent();
      const usage = a.getUsage();
      const mem = a.memory.stats();
      const pct = a.estimateContextPct();
      const names = Tools.listToolNames();
      say(drawBox([
        "模型: " + CONFIG.llm.model + "  温度: " + CONFIG.llm.temperature,
        "Token: 输入 " + usage.prompt + " · 输出 " + usage.completion,
        "上下文: " + pct + "% (上限 " + a.getMaxContextTokens() + " tokens)",
        "记忆: ROM" + (mem.romEntries || mem.entries) + " RAM" + (mem.ramEntries || 0) + " · 历史 " + mem.historyMessages + " 轮",
        "工具: " + names.length + " 个 — " + names.slice(0, 8).join(", ") + (names.length > 8 ? " ..." : ""),
      ], cols));
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
        "Total: Prompt " + usage.prompt + " · 输出 / Completion " + usage.completion + " · Sum " + (usage.prompt + usage.completion),
        ">80%: Use /compress or let AI call forget_conversation",
      ].join("\n"));
    }
    else if (cmd === "memory") {
      const s = getAgent().memory.stats();
      say("Memory: ROM" + (s.romEntries || s.entries) + " RAM" + (s.ramEntries || 0) + " · 历史 / History " + s.historyMessages + " 轮 / turns");
    }
    else if (cmd === "memory_list") {
      const n = parseInt(rest) || 20;
      const all = getAgent().memory.getAllEntries().slice(-n);
      if (!all.length) { say("(无记忆条目 / No memory entries)"); return; }
      say(all.map((e) => {
        const tag = e._type === "ram" ? "[RAM]" : "[ROM]";
        return tag + " #" + e.id + " [" + (e.tags?.join(",") || "-") + "] " + e.text;
      }).join("\n"));
    }
    else if (cmd === "memory_search") {
      if (!rest) { say("用法: /memory_search <关键词> / Usage: <keyword>"); return; }
      const found = getAgent().memory.searchEntries(rest, 10);
      if (!found.length) { say("无匹配记忆 / No memory matching \"" + rest + " / Not found"); return; }
      say(found.map((e) => "#" + e.id + " [" + (e.tags?.join(",") || "-") + "] " + e.text).join("\n"));
    }
    else if (cmd === "memory_del") {
      const id = parseInt(rest);
      if (isNaN(id)) { say("用法: /memory_del <ID> / Usage: <id>"); return; }
      const ok = getAgent().memory.removeEntry(id);
      say(ok ? "已删除 #" + id + " / Deleted" : "#" + id + " 未找到 / Not found");
    }
    else if (cmd === "memory_clear") {
      getAgent().memory.clearAllEntries();
      say("记忆已清空 (ROM+RAM) / Memory cleared");
    }
    else if (cmd === "compress") {
      const a = getAgent();
      const compressed = a.memory.compressHistory();
      if (!compressed) { say("对话太短，无需压缩 / Too short to compress"); return; }
      a.memory.clear();
      a.memory.addRamEntry("手动压缩: " + compressed.slice(0, 180), ["manual-summary"]);
      say("上下文已压缩，已保存摘要 / Context compressed");
    }
    else if (cmd === "tools") {
      const names = Tools.listToolNames();
      const base = names.filter((n) => !["forget_conversation", "restart_session", "todo_write", "search_replace", "glob", "grep", "read", "write", "ls", "web_search", "check_command_status", "open_preview", "get_diagnostics", "skill", "exec_console", "wait_command", "web_fetch"].includes(n));
      const lines = base.map((n) => {
        const t = Tools.getTool(n);
        return "  " + n + (t?.description ? " — " + t.description.slice(0, 40) : "");
      });
      say(lines.join("\n") + "\n\n" + base.length + " 个核心工具 + " + (names.length - base.length) + " 个扩展工具 (use /tools_more for all)");
    }
    else if (cmd === "tools_more") {
      const names = Tools.listToolNames();
      say(names.map((n) => {
        const t = Tools.getTool(n);
        return "  " + n + (t?.description ? " — " + t.description.slice(0, 60) : "");
      }).join("\n") + "\n\n共 " + names.length + " 个工具");
    }
    else if (cmd === "tool_search") {
      if (!rest) { say("用法: /tool_search <关键词> / Usage: /tool_search <keyword>"); return; }
      const found = Tools.searchToolRegistry(rest);
      if (!found.length) { say("无匹配工具 / No match: \"" + rest + " / Not found"); return; }
      say(found.map((t) => t.name + " — " + t.description).join("\n"));
    }
    else if (cmd === "tool_list_saved") {
      const saved = Tools.listCustomTools();
      if (!saved.length) { say("(无已保存工具 / No saved tools)"); return; }
      const lines = [];
      for (const s of saved) {
        lines.push("[" + s.file + "]");
        if (s.tools.length === 0) {
          lines.push("  (无工具导出 / no tool exports)");
        } else {
          for (const t of s.tools) {
            lines.push("  " + t.name + (t.desc ? "  —  " + t.desc : ""));
          }
        }
      }
      say(lines.join("\n"));
    }
    else if (cmd === "tool_del_saved") {
      if (!rest) { say("用法: /tool_del_saved <名称> / Usage: /tool_del_saved <name>"); return; }
      const result = Tools.deleteToolFile(rest);
      if (result.startsWith("[OK]")) getAgent().refreshTools();
      say(result);
    }
    else if (cmd === "temp") {
      const n = parseFloat(rest);
      if (isNaN(n) || n < 0 || n > 2) { say("温度范围: 0-2 / Range: 0-2"); return; }
      CONFIG.llm.temperature = n; saveConfig(CONFIG);
      say("温度已设为 / Temp set to " + n);
    }
    else if (cmd === "token") {
      const n = parseInt(rest, 10);
      if (isNaN(n) || n < 1 || n > 128000) { say("范围: 1-128000 / Range: 1-128000"); return; }
      CONFIG.llm.maxTokens = n; saveConfig(CONFIG);
      say("MaxTokens 已设为 / Set to " + n);
    }
    else if (cmd === "topp") {
      const n = parseFloat(rest);
      if (isNaN(n) || n < 0 || n > 1) { say("TopP 范围: 0-1 / Range: 0-1"); return; }
      CONFIG.llm.topP = n; saveConfig(CONFIG);
      say("TopP 已设为 / Set to " + n);
    }
    else if (cmd === "history") {
      const subParts = rest.trim().split(/\s+/);
      const sub = subParts[0]?.toLowerCase();
      const arg = subParts.slice(1).join(" ");
      if (sub === "files") {
        const files = getFileList();
        if (!files.length) { say("(无历史文件 / No history files)"); return; }
        say(files.map((f) => f.file + " | " + f.turns + " 轮 / turns | " + f.size + "KB | " + f.created.slice(0, 10)).join("\n"));
      } else if (sub === "search") {
        if (!arg) { say("用法: /history search <关键词> / Usage: /history search <keyword>"); return; }
        const results = searchHistory(arg, 10);
        if (!results.length) { say("无匹配 / No match for \"" + arg + "\""); return; }
        say(results.map((r, i) => (i + 1) + ". [" + r.file + "] " + (r.time?.slice(0, 16) || "?") + "\n  " + r.user.slice(0, 120)).join("\n\n"));
      } else if (sub === "read") {
        if (!arg) { say("用法: /history read <文件名> / Usage: /history read <filename>"); return; }
        const turns = loadFileTurns(arg, 10);
        if (!turns.length) { say("文件未找到: " + arg); return; }
        say(turns.map((t, i) => (i + 1) + ". [" + (t.time?.slice(0, 16) || "?") + "]\n  Q: " + (t.user || "").slice(0, 200) + "\n  A: " + (t.assistant || "").slice(0, 200)).join("\n\n"));
      } else {
        const n = parseInt(sub) || 10;
        const turns = listRecentTurns(n);
        if (!turns.length) { say("(无最近对话历史 / No recent history)"); return; }
        say(turns.map((t, i) => (i + 1) + ". [" + (t.time?.slice(0, 16) || "?") + "] " + (t.user || "").slice(0, 120)).join("\n"));
      }
    }
    else if (cmd === "sp_server") {
      import("./api/server.js").then(async (server) => {
        const subCmd = rest.split(" ")[0];
        const subRest = rest.split(" ").slice(1).join(" ");
        
        if (subCmd === "start") {
          if (server.isServerRunning()) {
            say("API 服务已在运行 / Server already running");
            return;
          }
          const defaultPort = CONFIG.api?.port || 27262;
          const port = parseInt(subRest) || defaultPort;
          try {
            await server.startServer(port);
            say(drawBoxTitle("Sapni API Server Started", cols) + "\n\n" + [
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
            say("启动服务失败 / Failed to start server: " + err.message);
          }
        }
        else if (subCmd === "stop") {
          const stopped = await server.stopServer();
          say(stopped ? "API 服务已停止 / Server stopped" : "服务未运行 / Server was not running");
        }
        else {
          // Default: show status
          const running = server.isServerRunning();
          const tokens = server.getTokens();
          say(drawBoxTitle("Sapni API Server Status", cols) + "\n\n" + [
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
        say(drawBoxTitle("New API Token Created", cols) + "\n\n" + [
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
          say(drawBoxTitle("No API Tokens", cols) + "\n\n" + [
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
        say(drawBox(["API Tokens (" + tokens.length + ")"], cols) + "\n\n" + [
          ...lines,
        ].join("\n"));
      });
    }
    else if (cmd === "sp_token_del") {
      if (!rest) { 
        say(drawBoxTitle("Usage: /sp_token_del <token_id>", cols));
        return;
      }
      import("./api/server.js").then((server) => {
        const deleted = server.deleteToken(rest);
        if (deleted) {
          say(drawBoxTitle("Token Deleted", cols) + "\n\n" + [
            "Token: " + deleted.token,
          ].join("\n"));
        } else {
          say(drawBoxTitle("Token Not Found", cols));
        }
      });
    }
    else if (cmd === "sessions") {
      const n = parseInt(rest) || 20;
      const sessions = listSessions(n);
      if (!sessions.length) { say("(无会话 / No sessions)"); return; }
      const lines = sessions.map((s, i) => {
        const marker = s.status === "active" ? "\u25cf" : "\u25cb";
        return (i + 1) + ". " + marker + " [" + (s.started || "?").slice(0, 16) + "] " +
          (s.title || "(untitled)") + " | " + s.turnCount + " 轮 / turns" +
          (s.status === "active" ? " \u25c0 current" : "");
      });
      say("会话 / Sessions (" + sessions.length + "):\n" + lines.join("\n") +
        "\n\nUse /session <number> to view, /session_search <keyword> to search");
    }
    else if (cmd === "session") {
      if (!rest) { say("Usage: /session <session_id or list number>\nUse /sessions to see list first"); return; }
      const sessions = listSessions(999);
      let sid = rest.trim();
      if (/^\d+$/.test(sid)) {
        const idx = parseInt(sid) - 1;
        if (idx < 0 || idx >= sessions.length) { say("编号超出范围 / Number out of range (1-" + sessions.length + ")"); return; }
        sid = sessions[idx].id;
      }
      const session = getSession(sid);
      if (!session) { say("会话未找到 / Session not found: " + sid); return; }
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
      if (!results.length) { say("无匹配 / No match for \"" + query + "\" in history"); return; }
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
      if (trusted.includes("all") || trusted.includes("*")) {
        say("(全部工具已永久信任 / All tools permanently trusted)");
        return;
      }
      const sessionOn = Tools.getSessionTrust();
      if (sessionOn) {
        say("(会话信任已开启 / Session trust is ON — 本轮全部免确认)");
        return;
      }
      if (!trusted.length) { say("(无信任工具 / No trusted tools)"); return; }
      say("Trusted tools (" + trusted.length + "):\n" + trusted.join("\n"));
    }
    else if (cmd === "trust") {
      if (!rest) { say("用法: /trust on|off|status|<工具名> / Usage: /trust on|off|status|<name>"); return; }
      if (rest === "on") {
        Tools.setSessionTrust(true);
        say("✅ 会话信任已开启 / Session trust ON — 本轮所有工具免确认");
        return;
      }
      if (rest === "off") {
        Tools.setSessionTrust(false);
        say("🔒 会话信任已关闭 / Session trust OFF — 恢复每次确认");
        return;
      }
      if (rest === "status") {
        const s = Tools.getTrustStatus();
        say(s.label + (s.all ? "" : "\n已信任: " + (s.tools?.join(", ") || "(无)")));
        return;
      }
      if (rest === "all" || rest === "*") {
        CONFIG.tools.trustedTools = ["all"];
        CONFIG.tools.permissionMode = "trust_all";
        saveConfig(CONFIG);
        say("已永久信任全部工具 / All tools permanently trusted");
        return;
      }
      Tools.addTrusted(rest);
      CONFIG.tools.trustedTools = [...new Set([...(CONFIG.tools?.trustedTools || []), rest])];
      saveConfig(CONFIG);
      say("已信任 / Trusted: " + rest);
    }
    else if (cmd === "untrust") {
      if (!rest) { say("用法: /untrust on|off|<工具名> / Usage: /untrust on|off|<name>"); return; }
      if (rest === "on" || rest === "off") {
        Tools.setSessionTrust(false);
        say("🔒 会话信任已关闭 / Session trust OFF");
        return;
      }
      Tools.removeTrusted(rest);
      CONFIG.tools.trustedTools = (CONFIG.tools?.trustedTools || []).filter((n) => n !== rest);
      saveConfig(CONFIG);
      say("已取消信任 / Untrusted: " + rest);
    }
    else if (cmd === "update") {
      say("正在更新... / Updating...");
      const { exec } = require("child_process");
      exec("npm install -g sapni-ai@latest", { timeout: 60000 }, (err, stdout, stderr) => {
        if (err) {
          say("更新失败 / Update failed: " + (stderr || err.message).trim());
          return;
        }
        const out = (stdout || stderr || "").trim();
        say("✅ 更新完成! / Update complete!\n" + out.split("\n").slice(-3).join("\n") + "\n请重启 Sapni 生效 / Please restart Sapni");
      });
    }
    else if (cmd === "retry") {
      if (!CONFIG.llm) CONFIG.llm = {};
      const sub = rest.split(/\s+/)[0]?.toLowerCase();
      const val = rest.slice(sub ? sub.length : 0).trim();
      if (sub === "max" || sub === "次数") {
        const n = parseInt(val);
        if (isNaN(n) || n < 1 || n > 40) { say("重试次数: 1-40 / Retries: 1-40"); return; }
        CONFIG.llm.maxRetries = n; saveConfig(CONFIG);
        say(drawBoxTitle("✓ 最大重试 / Max retries: " + n, cols));
      } else if (sub === "delay" || sub === "间隔") {
        const n = parseInt(val);
        if (isNaN(n) || n < 200 || n > 30000) { say("间隔: 200-30000ms / Delay: 200-30000ms"); return; }
        CONFIG.llm.retryDelay = n; saveConfig(CONFIG);
        say(drawBoxTitle("✓ 重试间隔 / Retry delay: " + n + "ms", cols));
      } else {
        const max = CONFIG.llm.maxRetries ?? 3;
        const delay = CONFIG.llm.retryDelay ?? 1500;
        say(drawBox([
          "重试配置 / Retry Config",
          "最大次数 / Max:  " + max + " (范围 1-40)",
          "间隔延迟 / Delay: " + delay + "ms (范围 200-30000)",
          "",
          "  /retry max 10     设置重试次数",
          "  /retry delay 2000 设置间隔2秒",
        ], cols));
      }
    }
    else if (cmd === "network") {
      say("检测中... / Checking...");
      const a = getAgent();
      const llm = a.llm;
      llm.checkNetwork().then((ok) => {
        if (ok) {
          say(drawBoxTitle("✓ 网络正常 / Network OK", cols) + "\n  " + CONFIG.llm.baseURL);
        } else {
          say(drawBoxTitle("✗ 网络不可达 / Network unreachable", cols) + "\n  检查: " + CONFIG.llm.baseURL + "\n  /retry 可增加重试次数");
        }
      }).catch((e) => {
        say("检测失败: " + e.message);
      });
    }
    else if (cmd === "histoken") {
      // 累计历史 token: ~/.sapni/history-tokens.json
      const histFile = path.join(SAPNI_DIR, "history-tokens.json");
      let hist = { prompt: 0, completion: 0, sessions: 0 };
      try {
        if (fs.existsSync(histFile)) hist = JSON.parse(fs.readFileSync(histFile, "utf-8"));
      } catch (_) {}
      // 加上当前会话
      const cur = getAgent().llm.getUsage();
      const totalP = (hist.prompt || 0) + (cur.prompt || 0);
      const totalC = (hist.completion || 0) + (cur.completion || 0);
      say(drawBox([
        "Token 统计 / Token Stats",
        "本次会话 / Session:  ▲" + (cur.prompt || 0).toLocaleString() + " ▼" + (cur.completion || 0).toLocaleString(),
        "历史累计 / History:   ▲" + totalP.toLocaleString() + " ▼" + totalC.toLocaleString(),
        "会话数   / Sessions:  " + ((hist.sessions || 0) + 1),
      ], cols));
    }
    else if (cmd === "provider" || cmd === "preset") {
      const choice = parseInt(rest.trim(), 10);
      
      // 无参数: 显示提供商列表
      if (!choice || choice < 1 || choice > presets.PRESETS.length) {
        say(drawBoxTitle("AI 提供商 / AI Provider", cols) + "\n\n" + [
          presets.PRESETS.map((p, i) => {
            return [
              `  ${String(i + 1).padEnd(3)} ${p.name}`,
              `        ${p.note}`,
              `        默认: ${p.defaultModel || p.models[0].id} · Temp ${p.temperature} · TopP ${p.topP}`,
            ].join("\n");
          }).join("\n\n"),
          "",
          "用法: /provider <编号>",
          "示例: /provider 3     → 一键切换到 OpenAI (gpt-4o-mini)",
        ].join("\n"));
        return;
      }

      const idx = choice - 1;
      const p = presets.PRESETS[idx];
      // 自动选择默认模型 (第一个)
      const result = presets.applyPreset(CONFIG, idx, 0);
      if (result.error) { say(result.error); return; }
      saveConfig(CONFIG);
      say(drawBoxTitle("✓ 已切换 / Switched", cols) + "\n\n" + [
        `  提供商: ${p.name}`,
        `  模型:   ${CONFIG.llm.model}`,
        `  URL:    ${CONFIG.llm.baseURL}`,
        `  Temp:   ${CONFIG.llm.temperature}`,
        `  TopP:   ${CONFIG.llm.topP}`,
        `  上下文: ${(CONFIG.llm.contextWindow || 0).toLocaleString()} tokens`,
        "",
        "下一步: /llm key <你的API Key>",
        "换模型: /llm model <模型名>",
      ].join("\n"));
    }
    else if (cmd === "persona" || cmd === "identity") {
      const raw = rest.trim();
      const text = raw.toLowerCase();
      if (!raw || raw === "show") {
        if (CONFIG.persona) {
          say(drawBoxTitle("当前身份 / Current Persona", cols) + "\n\n" + [
            "  " + CONFIG.persona,
            "",
            "子命令 / Subcommands:",
            "  /persona <描述>    设置新身份 / Set persona",
            "  /persona show      查看当前 / Show",
            "  /persona reset     恢复默认 / Reset",
            "  /persona off       关闭身份 / Disable",
          ].join("\n"));
        } else {
          say(drawBoxTitle("无自定义身份 / No Custom Persona", cols) + "\n\n" + [
            "  当前使用默认系统提示。",
            "",
            "子命令 / Subcommands:",
            "  /persona 你是一个...  设置身份 / Set persona",
            "  /persona reset        恢复默认 / Reset",
          ].join("\n"));
        }
      } else if (text === "reset" || text === "default" || text === "off") {
        delete CONFIG.persona; saveConfig(CONFIG);
        say(drawBoxTitle("✓ 身份已重置为默认 / Identity reset", cols));
      } else {
        CONFIG.persona = raw; saveConfig(CONFIG);
        say(drawBoxTitle("✓ 身份已更新 / Identity updated", cols) + "\n\n" + [
          "  " + raw,
        ].join("\n"));
      }
    }
    else if (cmd === "llm") {
      const sub = rest.split(/\s+/)[0]?.toLowerCase();
      const val = rest.slice(sub ? sub.length : 0).trim();
      if (sub === "key") {
        if (!val) { say("用法: /llm key <API_Key> / Usage: /llm key <key>"); return; }
        if (val.length < 10) { say("Key 太短 / Key too short"); return; }
        CONFIG.llm.apiKey = val; saveConfig(CONFIG);
        say("API Key 已更新 (" + val.slice(0, 8) + "...)");
      } else if (sub === "url") {
        if (!val) { say("用法: /llm url <API_URL> / Usage: /llm url <url>"); return; }
        CONFIG.llm.baseURL = val.replace(/\/+$/, ""); saveConfig(CONFIG);
        say("API 地址已更新: " + CONFIG.llm.baseURL);
      } else if (sub === "model") {
        if (!val) { say("用法: /llm model <模型名> / Usage: /llm model <name>"); return; }
        CONFIG.llm.model = val; saveConfig(CONFIG);
        say("模型已更新: " + CONFIG.llm.model);
      } else {
        const masked = CONFIG.llm.apiKey ? CONFIG.llm.apiKey.slice(0, 8) + "..." + CONFIG.llm.apiKey.slice(-4) : "(not set)";
        say(drawBoxTitle("LLM Configuration", cols) + "\n\n" + [
          "提供商: " + CONFIG.llm.provider,
          "API Key:  " + masked,
          "API URL:  " + CONFIG.llm.baseURL,
          "Model:    " + CONFIG.llm.model,
          "Temp:     " + CONFIG.llm.temperature,
          "TopP:     " + (CONFIG.llm.topP || "-"),
          "MaxTokens:" + (CONFIG.llm.maxTokens || "-"),
          "",
          "Commands:",
          "  /llm key <key>    设置 Key / Set API key",
          "  /llm url <url>    设置地址 / Set URL",
          "  /llm model <name> 设置模型 / Set model",
        ].join("\n"));
      }
    }
    else { run(v); }
    } catch (e) {
      addMsg("system", "✗ 内部错误: " + e.message);
      // 自动提交错误反馈
      const https = require("https");
      try {
        const body = JSON.stringify({ message: "Sapni 内部错误: " + e.message + "\n版本: " + VER, version: VER });
        const req = https.request("https://sapni.yxpil.com/api/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, timeout: 5000 });
        req.on("timeout", () => { req.destroy(); });
        req.write(body); req.end();
      } catch (_) {}
    }
  }, [addMsg, run]);

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

  useInput((inputVal, key) => {
    if (key.escape) {
      if (abortRef.current) {
        abortRef.current.abort();
        queueRef.current = [];
        setQueueLen(0);
        return;
      }
      if (input.length > 0) { setInput(""); return; }
      return;
    }
    if (!slashInput || !slashFiltered.length) return;
    if (key.upArrow) {
      const next = (slashClamped - 1 + slashFiltered.length) % slashFiltered.length;
      setSlashIdx(next);
      // 自动滚动：保持在可视区内
      if (next < slashScroll) setSlashScroll(next);
      if (next >= slashScroll + SLASH_PAGE) setSlashScroll(next - SLASH_PAGE + 1);
    }
    if (key.downArrow || key.tab) {
      const next = (slashClamped + 1) % slashFiltered.length;
      setSlashIdx(next);
      if (next < slashScroll) setSlashScroll(next);
      if (next >= slashScroll + SLASH_PAGE) setSlashScroll(next - SLASH_PAGE + 1);
    }
    // 鼠标滚轮: mouseDown/mouseUp events
    if (key.mouseDown) {
      setSlashScroll(Math.min(slashFiltered.length - SLASH_PAGE, Math.max(0, slashScroll + 3)));
      setSlashIdx(Math.min(slashIdx + 3, slashFiltered.length - 1));
    }
    if (key.mouseUp) {
      setSlashScroll(Math.max(0, slashScroll - 3));
      setSlashIdx(Math.max(0, slashIdx - 3));
    }
  });

  return (
    <Box flexDirection="column" paddingLeft={1}>
      {!started ? (
        <Box flexDirection="column" flexShrink={0}>
          {/* Auto-wrap layout: logo left, info right, paths below — one frame */}
          <Box 
            flexDirection="column"
            borderStyle="round" 
            borderColor="cyan"
            paddingX={2}
            paddingY={1}
            bg="#1a1a2e"
          >
            <Box flexDirection="row" flexWrap="wrap" alignItems="center">
              <Box flexDirection="column" paddingRight={4}>
                {LOGO_LINES.map((line, i) => (
                  <Text key={i} color="magentaBright">{line}</Text>
                ))}
                <Text color="green">{CONFIG.llm.model} · {(CONFIG.llm.contextWindow || 1048576).toLocaleString()} tokens</Text>
                {updateMsg && (
                  <Text color="yellow">{updateMsg.split("\n")[0]}</Text>
                )}
              </Box>
              <Box flexGrow={1} flexShrink={1} flexDirection="column" paddingX={3} minWidth={40}>
                <Text color="cyanBright" bold>Sapni v{VER}</Text>
                <Text color="cyan" dimColor>自进化 AI · 终端助手 / Self-Evolving AI · Terminal Agent</Text>
                <Text>{"\n"}</Text>
                <Text color="white">终端原生 AI 编程助手 / Terminal-native AI coding assistant</Text>
                <Text>{"\n"}</Text>
                <Text color="gray">/ 命令菜单 · ↑↓ 选择 · Enter 确认 / command menu · select · confirm</Text>
              </Box>
            </Box>
            <Box marginTop={1}>
              <Text color="#30363d">{"─".repeat(Math.max(0, cols - 7))}</Text>
            </Box>
            {/* 信任提醒 + 降级工具警告 */}
            {(() => {
              const trust = Tools.getTrustStatus();
              const degraded = Tools.getDegraded();
              if (trust.level === "none" || degraded.length > 0) {
                const warnings = [];
                if (trust.level === "none") {
                  warnings.push("⚠ 未信任任何工具 / No tools trusted — 每次调用需确认, 性能降级");
                  warnings.push("  使用 /trust on 开启会话信任 或 /trust all 永久信任");
                }
                if (degraded.length > 0) {
                  warnings.push("🔴 已熔断工具 / Degraded: " + degraded.join(", "));
                  warnings.push("  这些工具上次出错, 仍可用但建议检查");
                }
                return (
                  <Box marginTop={1}>
                    {warnings.map((w, i) => (
                      <Text key={i} color={i === 0 && trust.level === "none" ? "#d29922" : "#f85149"}>{w}</Text>
                    ))}
                  </Box>
                );
              }
              return null;
            })()}
            <Box marginTop={1}>
              <Text color="#58a6ff" bold>路径 / Paths</Text>
              {(() => {
                const p = expandPaths();
                const avail = Math.max(20, (cols || 80) - 8);
                const wrapPath = (label, val) => {
                  const head = `  ${label}: ${val}`;
                  const w = termLen(head);
                  if (w <= avail) return [head];
                  // 折行：label 单独一行，路径下一行缩进
                  return [
                    `  ${label}:`,
                    `    ${val}`,
                  ];
                };
                const lines = [];
                for (const e of p.entries) {
                  lines.push(...wrapPath(e.label, e.path));
                  // 自定义工具：列出安装的工具
                  if (e.label === "自定义工具 / Tools") {
                    try {
                      const saved = Tools.listCustomTools();
                      if (!saved.length) {
                        lines.push("    (无 / none)");
                      } else {
                        for (const s of saved) {
                          if (!s.tools || s.tools.length === 0) {
                            lines.push(`    [${s.file}] (无工具导出)`);
                          } else {
                            for (const t of s.tools) {
                              const toolLine = `    ${t.name}${t.desc ? "  —  " + t.desc : ""}`;
                              if (termLen(toolLine) <= avail) {
                                lines.push(toolLine);
                              } else {
                                lines.push(`    ${t.name}:`);
                                if (t.desc) lines.push(`      ${t.desc}`);
                              }
                            }
                          }
                        }
                      }
                    } catch (_) {}
                  }
                }
                return (
                  <Text color="#c9d1d9">{lines.join("\n")}</Text>
                );
              })()}
            </Box>
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
          <Text color="cyan" dimColor>自进化 AI · 终端助手 / Self-Evolving AI · Terminal Agent</Text>
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
          {slashScroll > 0 && (
            <Box paddingLeft={1}><Text color="#6e7681">  ▲ {slashScroll} more above</Text></Box>
          )}
          {slashFiltered.slice(slashScroll, slashScroll + SLASH_PAGE).map((c, i) => {
            const realIdx = slashScroll + i;
            const sel = realIdx === slashClamped;
            return (
              <Box key={c.cmd} flexDirection="row" paddingLeft={1}>
                <Text color={sel ? "cyanBright" : "gray"}>{sel ? "▸ " : "  "}</Text>
                <Text color={sel ? "cyanBright" : "white"} bold={sel}>{c.cmd}</Text>
                <Text color="gray"> · {c.desc}</Text>
              </Box>
            );
          })}
          {slashFiltered.length > slashScroll + SLASH_PAGE && (
            <Box paddingLeft={1}><Text color="#6e7681">  ▼ {slashFiltered.length - slashScroll - SLASH_PAGE} more below</Text></Box>
          )}
          <Box paddingLeft={1}>
            <Text color="cyan" dimColor>  ↑↓ Navigate · Enter Select · 🖱 Scroll</Text>
          </Box>
        </Box>
      )}
      <Box flexDirection="column" flexShrink={0}>
        <Box bg="#21262d" paddingY={0}><Text color="#58a6ff">{"─".repeat(cols - 2)}</Text></Box>
        
        {/* StatusBar - simplified */}
        <Box bg="#161b22" paddingX={2} paddingY={1}>
          <Text>
            <Text color={statusBlock.color}>{statusBlock.char}</Text>
            <Text color="#6e7681"> </Text>
            <Text color="#f783ac">{mascotFace}</Text>
            <Text color="#6e7681"> </Text>
            <Text color="#c9d1d9">{CONFIG.llm.model}</Text>
            <Text color="#484f58"> · </Text>
            <Text color="#58a6ff">msg {msgs.length}</Text>
            {(tokenUsage.prompt > 0 || tokenUsage.completion > 0) && (<>
              <Text color="#484f58"> · </Text>
              <Text color="#3fb950">▲{tokenUsage.prompt.toLocaleString()}</Text>
              <Text color="#484f58"> </Text>
              <Text color="#f85149">▼{tokenUsage.completion.toLocaleString()}</Text>
            </>)}
          </Text>
        </Box>

        {/* Token 容量进度条 / Context capacity bar */}
        <Box bg="#161b22" paddingX={2} paddingY={1} flexDirection="column">
          <Box flexDirection="row">
            <Text color="#8b949e">上下文 / Context:</Text>
            <Text color="#f783ac" bold> {Math.round(ctxPct)}%</Text>
            <Text color="#484f58"> · </Text>
            <Text color="#c9d1d9">▲{tokenUsage.prompt.toLocaleString()}</Text>
            <Text color="#484f58"> </Text>
            <Text color="#c9d1d9">▼{tokenUsage.completion.toLocaleString()}</Text>
          </Box>
          <Box flexDirection="row" marginTop={0}>
            {(() => {
              const pct = Math.round(ctxPct);
              const barW = Math.min(40, Math.max(8, cols - 10));
              const filled = Math.max(0, Math.round(pct / 100 * barW));
              const empty = barW - filled;
              return (<>
                <Text color="#0d1117" backgroundColor="#f783ac">{" ".repeat(filled)}</Text>
                <Text color="#0d1117" backgroundColor="#c9d1d9">{" ".repeat(empty)}</Text>
              </>);
            })()}
          </Box>
        </Box>

        {/* 进度条 / Progress bar */}
        {progress.active && (
          <Box bg="#161b22" paddingX={2} paddingY={0} flexDirection="column">
            <Box flexDirection="row">
              <Text color="#58a6ff">{progress.label}</Text>
              <Text color="#6e7681">  ⏳ {progress.remaining}s</Text>
            </Box>
            <Box flexDirection="row">
              <Text color="#0d1117" backgroundColor="#f783ac">{" ".repeat(Math.round(progress.pct / 5))}</Text>
              <Text color="#0d1117" backgroundColor="#c9d1d9">{" ".repeat(20 - Math.round(progress.pct / 5))}</Text>
              <Text color="#8b949e"> {progress.pct}%</Text>
            </Box>
          </Box>
        )}

        {queueLen > 0 && (
          <Box bg="#161b22" paddingX={2} paddingBottom={1}>
            <Text color="#d29922" dimColor>
{"│ "}Queue: {queueLen} pending
              {queueRef.current.slice(0, 3).map((q, i) => (
                <Text key={i} color="#6e7681">{" · "}{q.slice(0, 30)}{q.length > 30 ? "…" : ""}</Text>
              ))}
              {queueLen > 3 ? <Text color="#6e7681"> ...</Text> : null}
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
              placeholder={thinking ? "思考中…" : "> "}
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

// 全局未捕获异常自动提交反馈
process.on("uncaughtException", (e) => {
  console.error("Sapni 崩溃:", e.message);
  try {
    // 保存累计 token
    const histFile = path.join(SAPNI_DIR, "history-tokens.json");
    try {
      let hist = { prompt: 0, completion: 0, sessions: 0 };
      try { if (fs.existsSync(histFile)) hist = JSON.parse(fs.readFileSync(histFile, "utf-8")); } catch (_) {}
      if (_agent && _agent.llm) {
        const cur = _agent.llm.getUsage();
        hist.prompt = (hist.prompt || 0) + (cur.prompt || 0);
        hist.completion = (hist.completion || 0) + (cur.completion || 0);
        hist.sessions = (hist.sessions || 0) + 1;
        fs.writeFileSync(histFile, JSON.stringify(hist), "utf-8");
      }
    } catch (_) {}
    const https = require("https");
    const body = JSON.stringify({ message: "Sapni 崩溃: " + e.message + "\n" + (e.stack || "").slice(0, 200), version: "1.1.5-4" });
    const req = https.request("https://sapni.yxpil.com/api/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, timeout: 5000 });
    req.on("timeout", () => { req.destroy(); });
    req.write(body); req.end();
  } catch (_) {}
  process.exit(1);
});
process.on("unhandledRejection", (e) => {
  console.error("Sapni 未捕获的Promise拒绝:", e?.message || e);
});
