const fs = require("fs");
const path = require("path");
const fileTools = require("./file_tools");
const searchTools = require("./search_tools");
const editTools = require("./edit_tools");
const extendedTools = require("./extended_tools");
const browserTools = require("./browser");
const tokenizer = require("./tokenizer");
const templateTools = require("./template_engine");

let toolRegistry = {
  ...fileTools,
  ...searchTools,
  ...editTools,
  ...extendedTools,
  ...browserTools,
  ...templateTools,
};

let permissionCallback = null;
let trustedNames = new Set();
let sessionTrust = false; // 会话级信任: true=本轮免确认
const CUSTOM_DIR = path.join(require("os").homedir(), ".sapni", "Tools", "custom");

function loadCustomTools() {
  if (!fs.existsSync(CUSTOM_DIR)) return;
  const files = fs.readdirSync(CUSTOM_DIR).filter((f) => f.endsWith(".js"));
  for (const file of files) {
    try {
      const mod = require(path.join(CUSTOM_DIR, file));
      if (typeof mod === "object" && mod !== null) {
        Object.assign(toolRegistry, mod);
      }
    } catch (e) {
      // skip broken custom tools
    }
  }
}

loadCustomTools();

function saveToolToFile(name, code) {
  if (!fs.existsSync(CUSTOM_DIR)) fs.mkdirSync(CUSTOM_DIR, { recursive: true });
  if (!/^[a-z_][a-z0-9_]*$/i.test(name)) return `[失败] 工具名不合法: ${name}, 只允许字母数字下划线`;

  const sanitized = code.trim();
  if (!sanitized) return "[失败] 代码不能为空";
  if (sanitized.length > 50000) return "[失败] 代码过长, 最大50000字符";

  const filePath = path.join(CUSTOM_DIR, name + ".js");
  fs.writeFileSync(filePath, sanitized, "utf-8");

  try {
    delete require.cache[require.resolve(filePath)];
    const mod = require(filePath);
    if (typeof mod !== "object" || mod === null) {
      fs.unlinkSync(filePath);
      return `[失败] 模块必须导出对象, 如 module.exports = { tool_name: { name, description, parameters, execute } }`;
    }
    Object.assign(toolRegistry, mod);
  } catch (e) {
    fs.unlinkSync(filePath);
    return `[失败] 语法错误: ${e.message}`;
  }

  const keys = Object.keys(require(filePath));
  return `[OK] 工具已持久化: ${name}.js (导出: ${keys.join(", ")}) | 路径: ${filePath}`;
}

function deleteToolFile(name) {
  const filePath = path.join(CUSTOM_DIR, name + ".js");
  if (!fs.existsSync(filePath)) return `[不存在] ${name}.js`;
  if (!filePath.startsWith(CUSTOM_DIR)) return "[拒绝] 路径越界";

  const keys = Object.keys(require(filePath));
  fs.unlinkSync(filePath);
  delete require.cache[require.resolve(filePath)];

  for (const k of keys) {
    delete toolRegistry[k];
    trustedNames.delete(k);
  }

  return `[OK] 已删除持久化工具: ${name}.js (移除: ${keys.join(", ")})`;
}

function listCustomTools() {
  if (!fs.existsSync(CUSTOM_DIR)) return [];
  const files = fs.readdirSync(CUSTOM_DIR).filter((f) => f.endsWith(".js"));
  const result = [];
  for (const f of files) {
    const name = f.replace(/\.js$/, "");
    const p = path.join(CUSTOM_DIR, f);
    let mod = null;
    try { mod = require(p); } catch (_) {}
    const tools = [];
    if (mod && typeof mod === "object") {
      for (const [key, val] of Object.entries(mod)) {
        if (val && typeof val === "object" && typeof val.name === "string") {
          tools.push({
            key,
            name: val.name,
            desc: val.description || "",
          });
        }
      }
    }
    result.push({ file: f, name, tools });
  }
  return result;
}

function setPermissionCallback(cb) { permissionCallback = cb; }
function setTrusted(names) { trustedNames = new Set(names); }
function addTrusted(name) { trustedNames.add(name); }
function removeTrusted(name) { trustedNames.delete(name); }

// 会话级信任管理
function setSessionTrust(on) { sessionTrust = on; }
function getSessionTrust() { return sessionTrust; }
function getTrustStatus() {
  if (sessionTrust) return { level: "session", label: "会话信任 / Session Trust", all: true };
  if (trustedNames.has("*") || trustedNames.has("all")) return { level: "all", label: "全部信任 / All Trusted", all: true };
  if (trustedNames.size > 0) return { level: "partial", label: "部分信任 / Partial Trust", all: false, tools: [...trustedNames] };
  return { level: "none", label: "无信任 / No Trust", all: false, tools: [] };
}

function loadTools() { return { ...toolRegistry }; }

function registerTool(name, tool) { toolRegistry[name] = tool; }

function unregisterTool(name) {
  const filePath = path.join(CUSTOM_DIR, name + ".js");
  if (fs.existsSync(filePath)) {
    return `[提示] ${name} 是持久化工具, 请用 /tool_del_saved ${name} 或 delete_tool_file 删除`;
  }
  delete toolRegistry[name];
  trustedNames.delete(name);
}

function searchToolRegistry(query) {
  const q = query.toLowerCase();
  return Object.entries(toolRegistry)
    .filter(([name, tool]) => {
      if (name.toLowerCase().includes(q)) return true;
      if (tool.description && tool.description.toLowerCase().includes(q)) return true;
      return false;
    })
    .map(([name, tool]) => ({ name, description: tool.description || "", parameters: tool.parameters || {} }));
}

function getTool(name) { return toolRegistry[name] || null; }

async function checkPermission(name, args) {
  // 会话级信任优先: 开启后所有工具免确认
  if (sessionTrust) return true;
  if (trustedNames.has("*") || trustedNames.has("all") || trustedNames.has(name)) return true;
  if (permissionCallback) return permissionCallback(name, args);
  return false;
}

async function executeTool(name, args) {
  const tool = toolRegistry[name];
  if (!tool) throw new Error(`unknown tool: ${name}`);
  if (tool.dangerous) {
    const allowed = await checkPermission(name, args);
    if (!allowed) throw new Error(`permission denied: ${name}`);
  }
  return tool.execute(args);
}

function toFunctionDeclarations() {
  return Object.entries(toolRegistry).map(([key, tool]) => {
    const properties = {};
    const required = [];
    if (tool.parameters) {
      for (const [pn, pd] of Object.entries(tool.parameters)) {
        properties[pn] = { type: pd.type, description: pd.description };
        if (pd.required) required.push(pn);
      }
    }
    return {
      type: "function",
      function: {
        name: key,
        description: tool.description || "",
        parameters: { type: "object", properties, required },
      },
    };
  });
}
// ========== 动态工具过滤: 根据用户提示词正则匹配相关工具 ==========

// 预计算每个工具的关键词(启动时生成一次)
const _toolKeywordsCache = new Map();

function _extractKeywords(name, description) {
  const kws = new Set();
  for (const part of name.split("_")) {
    if (part.length >= 2) kws.add(part.toLowerCase());
  }
  if (description) {
    const tokens = tokenizer.segment(description.toLowerCase());
    for (const t of tokens) {
      if (t.length >= 2) kws.add(t);
    }
    const enMatches = description.match(/[a-zA-Z]{2,}/g);
    if (enMatches) {
      for (const m of enMatches) {
        kws.add(m.toLowerCase());
      }
    }
  }
  return [...kws];
}

function _rebuildKeywords() {
  _toolKeywordsCache.clear();
  for (const [name, tool] of Object.entries(toolRegistry)) {
    _toolKeywordsCache.set(name, _extractKeywords(name, tool.description || ""));
  }
  tokenizer.buildDictFromKeywords([..._toolKeywordsCache.values()]);
}

// 初始化构建
_rebuildKeywords();

/**
 * 根据用户提示词正则匹配动态过滤工具声明
 * @param {string} prompt - 用户原始提示词
 * @returns {Array} 匹配的工具 function_declarations 数组
 */
function filterToolDeclarations(prompt) {
  if (!prompt || typeof prompt !== "string" || prompt.trim().length === 0) {
    return toFunctionDeclarations();
  }

  const promptLower = prompt.toLowerCase();
  const promptTokens = tokenizer.segment(promptLower);
  const promptTokenSet = new Set(promptTokens.map((t) => t.toLowerCase()));

  const showAllTriggered = promptTokenSet.has("more") || promptTokenSet.has("全部") || promptTokenSet.has("所有") || promptLower.includes("更多工具") || promptLower.includes("show all") || promptLower.includes("all tools");

  if (showAllTriggered) {
    return toFunctionDeclarations();
  }

  const matched = new Set();

  for (const [name, keywords] of _toolKeywordsCache) {
    if (promptLower.includes(name)) {
      matched.add(name);
      continue;
    }
    for (const kw of keywords) {
      const kwLower = kw.toLowerCase();
      if (promptTokenSet.has(kwLower)) {
        matched.add(name);
        break;
      }
      if (promptLower.includes(kwLower)) {
        matched.add(name);
        break;
      }
    }
  }

  if (matched.size === 0) {
    return toFunctionDeclarations();
  }

  const alwaysInclude = ["search_memory", "save_memory", "list_memory", "delete_memory", "mem_rom", "mem_ram", "search_history", "list_history_files", "list_sessions", "view_session", "search_sessions", "browse_page", "browse_page_text", "compress_context", "truncate_context", "submit_feedback", "forget_conversation", "restart_session", "todo_write", "get_trust_status", "list_available_tools"];
  for (const name of alwaysInclude) {
    if (toolRegistry[name]) matched.add(name);
  }

  const filtered = {};
  for (const name of matched) {
    if (toolRegistry[name]) filtered[name] = toolRegistry[name];
  }

  return _declarationsFrom(filtered);
}

/**
 * 从给定的工具注册表子集生成 function_declarations
 */
function _declarationsFrom(registry) {
  return Object.entries(registry).map(([key, tool]) => {
    const properties = {};
    const required = [];
    if (tool.parameters) {
      for (const [pn, pd] of Object.entries(tool.parameters)) {
        properties[pn] = { type: pd.type, description: pd.description };
        if (pd.required) required.push(pn);
      }
    }
    return {
      type: "function",
      function: {
        name: key,
        description: tool.description || "",
        parameters: { type: "object", properties, required },
      },
    };
  });
}

// 覆盖 registerTool / saveToolToFile / deleteToolFile 以保持关键词缓存同步
const _origRegisterTool = registerTool;
registerTool = function (name, tool) {
  _origRegisterTool(name, tool);
  _toolKeywordsCache.set(name, _extractKeywords(name, (tool && tool.description) || ""));
};

const _origSaveToFile = saveToolToFile;
saveToolToFile = function (name, code) {
  const result = _origSaveToFile(name, code);
  if (result && result.startsWith("[OK]")) _rebuildKeywords();
  return result;
};

const _origDelToolFile = deleteToolFile;
deleteToolFile = function (name) {
  const result = _origDelToolFile(name);
  if (result && result.startsWith("[OK]")) _rebuildKeywords();
  return result;
};

// ========== 模型自省工具: 让模型能查自己的信任状态和工具列表 ==========

registerTool("get_trust_status", {
  name: "get_trust_status",
  description: "查看当前信任状态: 会话级信任/永久信任/无信任/已信任哪些工具 (查自己有没有权限执行操作)",
  parameters: {},
  execute: async () => {
    const s = getTrustStatus();
    let msg = `[信任等级 / Trust Level] ${s.label}`;
    if (s.level === "session") msg += "\n所有工具当前免确认 / All tools are auto-trusted for this session";
    else if (s.level === "all") msg += "\n所有工具已永久信任 / All tools permanently trusted";
    else if (s.level === "partial") msg += `\n已信任 / Trusted: ${s.tools.join(", ")}`;
    else msg += "\n使用 /trust on 开启会话信任, 或 /trust <工具名> 信任特定工具";
    return msg;
  },
});

registerTool("list_available_tools", {
  name: "list_available_tools",
  description: "列出所有可用的工具(按分类), 查看完整工具列表. 如果当前注入的工具不够用可以用这个",
  parameters: {},
  execute: async () => {
    const all = toFunctionDeclarations();
    const cats = {};
    for (const t of all) {
      const desc = t.function.description;
      let cat = "其他";
      if (/file|写|创|删|移|复|查找|搜索/i.test(desc)) cat = "文件操作";
      else if (/执行|终端|命令|console/i.test(desc)) cat = "终端命令";
      else if (/搜索|网络|网页|浏览|fetch/i.test(t.function.name)) cat = "网络";
      else if (/记忆|mem|history|session/i.test(t.function.name)) cat = "记忆/历史";
      else if (/todo|timer|定时|skill|技能/i.test(t.function.name)) cat = "任务管理";
      else if (/trust|权限|工具/i.test(t.function.name)) cat = "自省工具";
      if (!cats[cat]) cats[cat] = [];
      cats[cat].push(`  ${t.function.name} — ${desc.slice(0, 60)}`);
    }
    const lines = Object.entries(cats).map(([cat, tools]) =>
      `[${cat}]\n${tools.join("\n")}`
    );
    return `可用工具 / Available Tools (${all.length} 个):\n\n${lines.join("\n\n")}`;
  },
});

function listToolNames() { return Object.keys(toolRegistry); }

function showAllToolDeclarations() { return toFunctionDeclarations(); }

module.exports = {
  loadTools, getTool, executeTool, checkPermission, toFunctionDeclarations,
  registerTool, unregisterTool, searchToolRegistry, listToolNames,
  setPermissionCallback, setTrusted, addTrusted, removeTrusted,
  setSessionTrust, getSessionTrust, getTrustStatus,
  saveToolToFile, deleteToolFile, listCustomTools,
  filterToolDeclarations, showAllToolDeclarations, _declarationsFrom,
  CUSTOM_DIR,
};
