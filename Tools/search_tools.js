const { execSync, spawn } = require("child_process");
const https = require("https");
const http = require("http");

const execConsoleTool = {
  name: "exec_console",
  description: "执行终端命令/运行程序/启动服务/跑脚本 并返回结果. 始终返回: exit code + stdout + stderr + 耗时 (支持: 运行/执行/跑/启动/安装/编译/构建/测试/部署)",
  dangerous: true,
  parameters: {
    command: { type: "string", required: true, description: "要执行的命令" },
    cwd: { type: "string", required: false, description: "工作目录, 默认当前目录" },
    timeout: { type: "number", required: false, description: "超时毫秒, 默认30000" },
  },
  execute: async ({ command, cwd, timeout }) => {
    const cwdPath = cwd || process.cwd();
    const start = Date.now();
    try {
      const output = execSync(command, {
        cwd: cwdPath,
        encoding: "utf-8",
        timeout: timeout || 30000,
        maxBuffer: 2 * 1024 * 1024,
      });
      const ms = Date.now() - start;
      const out = output || "(无输出)";
      return `[exit 0 | ${ms}ms | ${cwdPath}]\n${out.slice(0, 3500)}`;
    } catch (e) {
      const ms = Date.now() - start;
      const code = e.status != null ? e.status : "?";
      const stderr = (e.stderr || e.message || "").slice(0, 1500);
      const stdout = (e.stdout || "").slice(0, 1000);
      let result = `[exit ${code} | ${ms}ms | ${cwdPath}]\n`;
      if (stderr) result += `[stderr]\n${stderr}\n`;
      if (stdout) result += `[stdout]\n${stdout}`;
      if (!stderr && !stdout) result += `执行失败: ${e.message}`;
      return result.slice(0, 3500);
    }
  },
};

const waitCommandTool = {
  name: "wait_command",
  description: "执行长时间命令并返回结果. 返回: exit code + stdout + stderr + 耗时",
  dangerous: true,
  parameters: {
    command: { type: "string", required: true, description: "要执行的命令" },
    args: { type: "string", required: false, description: "命令参数(空格分隔), 可选" },
    cwd: { type: "string", required: false, description: "工作目录" },
    timeout: { type: "number", required: false, description: "超时毫秒, 默认60000" },
  },
  execute: async ({ command, args, cwd, timeout }) => {
    const cwdPath = cwd || process.cwd();
    const start = Date.now();
    return new Promise((resolve) => {
      const argList = args ? args.split(/\s+/) : [];
      const child = spawn(command, argList, {
        cwd: cwdPath,
        shell: true,
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d) => (stdout += d.toString()));
      child.stderr.on("data", (d) => (stderr += d.toString()));
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        const ms = Date.now() - start;
        resolve(`[timeout ${timeout || 60000}ms | ${ms}ms | ${cwdPath}]\n${stdout.slice(0, 1500)}${stderr ? "\n[stderr]\n" + stderr.slice(0, 500) : ""}`);
      }, timeout || 60000);
      child.on("close", (code) => {
        clearTimeout(timer);
        const ms = Date.now() - start;
        let result = `[exit ${code} | ${ms}ms | ${cwdPath}]\n`;
        if (stdout) result += stdout;
        if (stderr) result += `\n[stderr]\n${stderr}`;
        resolve(result.slice(0, 3500));
      });
      child.on("error", (e) => {
        clearTimeout(timer);
        const ms = Date.now() - start;
        resolve(`[error | ${ms}ms | ${cwdPath}] ${e.message}`);
      });
    });
  },
};

const webFetchTool = {
  name: "web_fetch",
  description: "获取URL的网页内容, 自动回退到真实浏览器绕过反爬",
  parameters: {
    url: { type: "string", required: true, description: "要抓取的URL" },
    extractMode: { type: "string", required: false, description: "text/structure/links, 默认text" },
  },
  execute: async ({ url, extractMode }) => {
    const httpResult = await new Promise((resolve) => {
      const mod = url.startsWith("https") ? https : http;
      const start = Date.now();
      const req = mod.get(url, { headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36" } }, (res) => {
        const sc = res.statusCode;
        const ms = Date.now() - start;
        if (sc >= 300 && sc < 400 && res.headers.location) {
            // 自动跟随重定向(最多3次)
            resolve({ redirect: res.headers.location.startsWith("http") ? res.headers.location : new (require("url").URL)(res.headers.location, url).href });
            return;
          }
        if (sc === 404) { resolve({ ok: false, msg: `[HTTP 404 Not Found | ${ms}ms]` }); return; }
        if (sc === 403) { resolve({ ok: false, msg: `[HTTP 403 Forbidden | ${ms}ms]` }); return; }
        if (sc >= 500) { resolve({ ok: false, msg: `[HTTP ${sc} Server Error | ${ms}ms]` }); return; }
        if (sc !== 200) { resolve({ ok: false, msg: `[HTTP ${sc} | ${ms}ms]` }); return; }
        let data = "";
        res.on("data", (c) => (data += c.toString()));
        res.on("end", () => {
          const mode = extractMode || "text";
          const prefix = `[HTTP 200 OK | ${ms}ms]\n`;
          if (mode === "links") {
            const links = data.match(/href=["']([^"']+)["']/gi) || [];
            const urls = links.map((l) => l.replace(/href=["']/i, "").replace(/["']$/, "")).filter((u) => u.length > 1);
            resolve({ ok: true, msg: prefix + `[${urls.length} 个链接]\n${urls.slice(0, 100).join("\n")}` });
          } else if (mode === "structure") {
            const title = (data.match(/<title[^>]*>([^<]+)<\/title>/i) || [])[1] || "(无标题)";
            const h1s = (data.match(/<h1[^>]*>([^<]+)<\/h1>/gi) || []).map((h) => h.replace(/<\/?h1[^>]*>/gi, "").trim());
            const h2s = (data.match(/<h2[^>]*>([^<]+)<\/h2>/gi) || []).map((h) => h.replace(/<\/?h2[^>]*>/gi, "").trim());
            resolve({ ok: true, msg: prefix + `标题: ${title}\n--- h1 ---\n${h1s.join("\n")}\n--- h2 ---\n${h2s.join("\n")}` });
          } else {
            let text = data
              .replace(/<script[\s\S]*?<\/script>/gi, "")
              .replace(/<style[\s\S]*?<\/style>/gi, "")
              .replace(/<[^>]+>/g, " ")
              .replace(/&nbsp;/g, " ")
              .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
              .replace(/\s+/g, " ").trim();
            resolve({ ok: true, msg: prefix + text.slice(0, 3000) });
          }
        });
      });
      req.on("error", (e) => resolve({ ok: false, msg: `[抓取失败 | ${Date.now() - start}ms] ${e.message}` }));
      req.setTimeout(15000, () => { req.destroy(); resolve({ ok: false, msg: "[超时 15s]" }); });
    });

    if (httpResult.ok) return httpResult.msg;

    try {
      const { browse_page: bp } = require("./browser");
      const browserResult = await bp.execute({ url, extractLinks: extractMode === "links" });
      return `[浏览器回退] ${httpResult.msg}\n\n${browserResult}`;
    } catch (_) {
      return httpResult.msg + "\n[提示] 可尝试用 browse_page 工具以真实浏览器打开";
    }
  },
};

const setTimerTool = {
  name: "set_timer",
  description: "设置定时器: 在指定秒数后通知AI. AI调用后可以继续其他工作, 时间到达时会收到通知. 用于轮询等待异步任务完成",
  parameters: {
    seconds: { type: "number", required: true, description: "延迟秒数, 范围1-300" },
    message: { type: "string", required: false, description: "定时触发时的提示语, 如 '检查构建结果'" },
  },
  execute: async ({ seconds, message }) => {
    const s = Math.max(1, Math.min(seconds || 5, 300));
    return `[timer set | ${s}s] ${message || "定时器已设置"}`;
  },
};

const searchMemoryTool = {
  name: "search_memory",
  description: "搜索本地记忆条目(关键词匹配)",
  parameters: {
    query: { type: "string", required: true, description: "搜索关键词" },
    limit: { type: "number", required: false, description: "返回条数, 默认5" },
  },
  execute: () => { return "search_memory must be injected"; },
};

const saveMemoryTool = {
  name: "save_memory",
  description: "保存一条关键信息到 ROM(永久记忆, 重启不丢). 等价于 mem_rom",
  parameters: {
    content: { type: "string", required: true, description: "记忆内容" },
    tags: { type: "string", required: false, description: "标签,逗号分隔" },
  },
  execute: () => { return "save_memory must be injected"; },
};

const memRomTool = {
  name: "mem_rom",
  description: "保存一条 ROM 记忆(永久保存, 写入磁盘, 重启后仍存在). 用于身份、偏好、配置等跨会话信息",
  parameters: {
    content: { type: "string", required: true, description: "记忆内容, 不超过200字" },
    tags: { type: "string", required: false, description: "标签,逗号分隔, 如 habit,config" },
  },
  execute: () => { return "mem_rom must be injected"; },
};

const memRamTool = {
  name: "mem_ram",
  description: "保存一条 RAM 记忆(仅本次窗口, 关闭即丢失). 用于临时上下文、当前任务状态等",
  parameters: {
    content: { type: "string", required: true, description: "记忆内容, 不超过200字" },
    tags: { type: "string", required: false, description: "标签,逗号分隔" },
  },
  execute: () => { return "mem_ram must be injected"; },
};

const listMemoryTool = {
  name: "list_memory",
  description: "列出所有记忆条目",
  parameters: {
    limit: { type: "number", required: false, description: "返回条数, 默认20" },
  },
  execute: () => { return "list_memory must be injected"; },
};

const deleteMemoryTool = {
  name: "delete_memory",
  description: "按ID删除一条记忆",
  parameters: {
    id: { type: "number", required: true, description: "记忆ID" },
  },
  execute: () => { return "delete_memory must be injected"; },
};

const searchHistoryTool = {
  name: "search_history",
  description: "搜索 mem/ 文件夹中的历史对话记录, 可以找到过去的对话内容",
  parameters: {
    query: { type: "string", required: true, description: "搜索关键词" },
    limit: { type: "number", required: false, description: "返回条数, 默认10" },
  },
  execute: () => { return "search_history must be injected"; },
};

const listHistoryTool = {
  name: "list_history_files",
  description: "列出 mem/ 文件夹中的历史对话文件列表",
  parameters: {},
  execute: () => { return "list_history_files must be injected"; },
};

const listSessionsTool = {
  name: "list_sessions",
  description: "列出所有对话 session（会话分组），每次 /new 或重启算一个新 session。可以看到过去的对话主题、时间、轮数。用这个来回答「之前聊过什么」类问题。",
  parameters: {
    limit: { type: "number", required: false, description: "返回数量, 默认20" },
  },
  execute: () => { return "list_sessions must be injected"; },
};

const viewSessionTool = {
  name: "view_session",
  description: "查看某个 session 的完整对话内容，包括用户消息和 AI 回复。用 list_sessions 获取 session_id 后再调用此工具。",
  parameters: {
    session_id: { type: "string", required: true, description: "Session ID (从 list_sessions 获取)" },
    limit: { type: "number", required: false, description: "返回轮数上限, 默认50" },
  },
  execute: () => { return "view_session must be injected"; },
};

const searchSessionsTool = {
  name: "search_sessions",
  description: "在全部历史 session 中全文搜索。比 search_history 更好——会按 session 分组、显示匹配得分和上下文。用这个来回答「你记得关于 X 的哪次对话？」类问题。",
  parameters: {
    query: { type: "string", required: true, description: "搜索关键词，支持多词空格分隔" },
    limit: { type: "number", required: false, description: "返回数量, 默认10" },
  },
  execute: () => { return "search_sessions must be injected"; },
};

const compressContextTool = {
  name: "compress_context",
  description: "压缩当前上下文: 将历史对话摘要存入记忆并清空对话历史",
  parameters: {},
  execute: () => { return "compress_context must be injected"; },
};

const truncateContextTool = {
  name: "truncate_context",
  description: "截断旧对话: 提取关键词保留上下文, 删除旧消息释放 token 空间. 比 compress_context 快(无需 AI 总结)",
  parameters: {
    keywords: { type: "string", required: false, description: "提取的关键词, 注入作为上下文提示" },
    keep: { type: "number", required: false, description: "保留最近几条消息 (默认 10)" },
  },
  execute: () => { return "truncate_context must be injected"; },
};

const agentSelfInvokeTool = {
  name: "agent_self_invoke",
  description: "Agent自我递归调用: 将子任务交给另一个Sapni实例处理并返回结果",
  dangerous: true,
  parameters: {
    task: { type: "string", required: true, description: "要交给子Agent的任务描述" },
    context: { type: "string", required: false, description: "额外上下文" },
  },
  execute: () => { return "agent_self_invoke must be injected"; },
};

const saveToolTool = {
  name: "save_tool",
  description: "编写并持久化一个JS工具模块. 代码必须是完整的CommonJS模块, 导出工具对象. 下次启动自动加载. 模块格式: module.exports = { tool_a: { name, description, parameters, execute: async (args) => '...' }, tool_b: { ... } }",
  dangerous: true,
  parameters: {
    name: { type: "string", required: true, description: "工具文件名(不含.js), 如 'my_utils'" },
    code: { type: "string", required: true, description: "完整的JS模块代码, CommonJS格式, 导出工具对象" },
  },
  execute: () => { return "save_tool must be injected"; },
};

const deleteToolFileTool = {
  name: "delete_tool_file",
  description: "删除一个持久化工具文件并卸载其导出的所有工具",
  dangerous: true,
  parameters: {
    name: { type: "string", required: true, description: "工具文件名(不含.js), 如 'my_utils'" },
  },
  execute: () => { return "delete_tool_file must be injected"; },
};

const listSavedToolsTool = {
  name: "list_saved_tools",
  description: "列出所有持久化保存的工具文件及其导出的工具名",
  parameters: {},
  execute: () => { return "list_saved_tools must be injected"; },
};

module.exports = {
  exec_console: execConsoleTool,
  wait_command: waitCommandTool,
  web_fetch: webFetchTool,
  set_timer: setTimerTool,
  search_memory: searchMemoryTool,
  save_memory: saveMemoryTool,
  mem_rom: memRomTool,
  mem_ram: memRamTool,
  list_memory: listMemoryTool,
  delete_memory: deleteMemoryTool,
  search_history: searchHistoryTool,
  list_history_files: listHistoryTool,
  list_sessions: listSessionsTool,
  view_session: viewSessionTool,
  search_sessions: searchSessionsTool,
  compress_context: compressContextTool,
  truncate_context: truncateContextTool,
  agent_self_invoke: agentSelfInvokeTool,
  save_tool: saveToolTool,
  delete_tool_file: deleteToolFileTool,
  list_saved_tools: listSavedToolsTool,
};
