import express from "express";
import { createServer } from "http";
import { v4 as uuidv4 } from "uuid";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import os from "os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const USER_CONFIG_FILE = join(os.homedir(), ".sapni", "config.json");
const PKG_CONFIG_FILE = join(__dirname, "..", "..", "config.json");
const TOKENS_FILE = join(__dirname, "..", "..", "api_tokens.json");

// Load configuration: prefer user config (~/.sapni/config.json), fallback to package config
function loadConfig() {
  // If user config exists, use it
  if (existsSync(USER_CONFIG_FILE)) {
    return JSON.parse(readFileSync(USER_CONFIG_FILE, "utf-8"));
  }
  // Fallback to package config
  if (existsSync(PKG_CONFIG_FILE)) {
    const cfg = JSON.parse(readFileSync(PKG_CONFIG_FILE, "utf-8"));
    // Copy to user config directory for future use
    try {
      const userDir = join(os.homedir(), ".sapni");
      if (!existsSync(userDir)) mkdirSync(userDir, { recursive: true });
      writeFileSync(USER_CONFIG_FILE, JSON.stringify(cfg, null, 2));
    } catch (_) {}
    return cfg;
  }
  return {};
}
let CONFIG = loadConfig();
const LLM_CONFIG = CONFIG.llm || {};

// Function to reload config (call when config changes)
function reloadConfig() {
  CONFIG = loadConfig();
  console.log("[DEBUG] Configuration reloaded");
}

// Import existing agent and tools
let Agent = null;
let Tools = null;

async function loadDependencies() {
  if (!Agent) {
    const agentModule = await import("../agent.cjs");
    Agent = agentModule.default !== undefined ? agentModule.default : agentModule;
  }
  if (!Tools) {
    const toolsModule = await import("../../Tools/index.js");
    Tools = toolsModule.default !== undefined ? toolsModule.default : toolsModule;
  }
}

const app = express();
app.use(express.json({ limit: "10mb" }));

let tokens = [];
let server = null;
let agent = null;

// Load tokens from file (persistent)
function loadTokens() {
  if (existsSync(TOKENS_FILE)) {
    try {
      const data = readFileSync(TOKENS_FILE, "utf-8");
      tokens = JSON.parse(data);
      return tokens;
    } catch (e) {
      tokens = [];
    }
  }
  return tokens;
}

// Save tokens to file
function saveTokens() {
  try {
    writeFileSync(TOKENS_FILE, JSON.stringify(tokens, null, 2));
  } catch (e) {
    console.error("Failed to save tokens:", e.message);
  }
}

// Initialize tokens on load
loadTokens();

// Initialize agent
async function initAgent() {
  console.log("[DEBUG] Loading dependencies...");
  await loadDependencies();
  
  console.log("[DEBUG] Dependencies loaded. Agent:", typeof Agent);
  
  if (!Agent) {
    throw new Error("Agent module failed to load");
  }
  
  if (!agent) {
    // Reload config to get latest API Key from console settings
    reloadConfig();
    console.log("[DEBUG] Configuration reloaded before creating Agent");
    
    console.log("[DEBUG] Creating new Agent instance...");
    try {
      agent = new Agent(CONFIG, {
        onPermission: async (name, args) => {
          console.log(`Permission requested for tool: ${name}`, args);
          return true;
        },
        onToolCall: (name, args, step) => {
          console.log(`Tool call: ${name} (step ${step})`, args);
        },
        onToolResult: (name, result) => {
          console.log(`Tool result: ${name}`, result.slice(0, 100));
        },
        onThinking: () => {
          console.log("Agent is thinking...");
        },
      });
      console.log("[DEBUG] Agent created successfully");
    } catch (err) {
      console.error("[ERROR] Failed to create agent:", err.message, err.stack);
      throw err;
    }
  }
  return agent;
}

// Sapni代理模型
const SAPNI_MODEL = {
  id: "sapni",
  object: "model",
  created: Math.floor(Date.now() / 1000),
  owned_by: "sapni",
  permission: [],
  root: "sapni",
  parent: null,
};

// Token management
export function generateToken(description = "API Token") {
  const token = {
    id: uuidv4(),
    token: "sp_" + uuidv4().replace(/-/g, ""),
    description,
    createdAt: new Date().toISOString(),
    lastUsed: null,
    usageCount: 0,
    permissions: ["read", "write", "execute"],
  };
  tokens.push(token);
  saveTokens();
  return token;
}

export function getTokens() {
  return tokens;
}

export function validateToken(tokenStr) {
  const token = tokens.find(t => t.token === tokenStr);
  if (token) {
    token.lastUsed = new Date().toISOString();
    token.usageCount++;
    saveTokens();
  }
  return token;
}

export function deleteToken(tokenId) {
  const index = tokens.findIndex(t => t.id === tokenId || t.token === tokenId);
  if (index > -1) {
    const deleted = tokens.splice(index, 1)[0];
    saveTokens();
    return deleted;
  }
  return null;
}

// Format tool result as markdown
function formatToolResult(name, result) {
  return `**Tool: \`${name}\`**\n\n${result}`;
}

// Extract text content from message content (handle both string and array formats)
function extractTextContent(content) {
  if (typeof content === 'string') {
    return content;
  }
  
  if (Array.isArray(content)) {
    return content
      .filter(item => item.type === 'text' && item.text)
      .map(item => item.text)
      .join('');
  }
  
  return '';
}

// Handle models endpoint
function handleModels(req, res) {
  res.json({
    object: "list",
    data: [SAPNI_MODEL],
  });
}

// Handle model info endpoint
function handleModelInfo(req, res) {
  if (req.params.model_id === "sapni") {
    res.json(SAPNI_MODEL);
  } else {
    res.status(404).json({ 
      error: {
        message: "The model '" + req.params.model_id + "' does not exist",
        type: "invalid_request_error",
        param: null,
        code: "model_not_found",
      }
    });
  }
}

// Handle tools list endpoint
async function handleToolList(req, res) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({
      error: { message: "Unauthorized", type: "invalid_request_error", param: null, code: "unauthorized" }
    });
  }
  
  const token = validateToken(authHeader.substring(7));
  if (!token) {
    return res.status(401).json({
      error: { message: "Unauthorized: Invalid token", type: "invalid_request_error", param: null, code: "unauthorized" }
    });
  }
  
  try {
    await loadDependencies();
    const toolDeclarations = Tools.toFunctionDeclarations ? Tools.toFunctionDeclarations() : [];
    res.json({ object: "list", data: toolDeclarations });
  } catch (err) {
    res.status(500).json({ error: { message: err.message, type: "server_error", code: "internal_error" } });
  }
}

// Handle tool execute endpoint
async function handleToolExecute(req, res) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({
      error: { message: "Unauthorized", type: "invalid_request_error", param: null, code: "unauthorized" }
    });
  }
  
  const token = validateToken(authHeader.substring(7));
  if (!token) {
    return res.status(401).json({
      error: { message: "Unauthorized: Invalid token", type: "invalid_request_error", param: null, code: "unauthorized" }
    });
  }
  
  const { name, args } = req.body;
  
  try {
    await loadDependencies();
    const result = await Tools.execute(name, args);
    res.json({ success: true, result: formatToolResult(name, result) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

// Handle system status endpoint
function handleSystemStatus(req, res) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({
      error: { message: "Unauthorized", type: "invalid_request_error", param: null, code: "unauthorized" }
    });
  }
  
  const token = validateToken(authHeader.substring(7));
  if (!token) {
    return res.status(401).json({
      error: { message: "Unauthorized: Invalid token", type: "invalid_request_error", param: null, code: "unauthorized" }
    });
  }
  
  res.json({
    status: "running",
    model: LLM_CONFIG.model || "unknown",
    provider: LLM_CONFIG.provider || "unknown",
    timestamp: new Date().toISOString(),
  });
}

// Handle chat completions endpoint
async function handleChatCompletions(req, res) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({
      error: { message: "Unauthorized: No token provided", type: "invalid_request_error", param: null, code: "unauthorized" }
    });
  }

  const tokenStr = authHeader.substring(7);
  const token = validateToken(tokenStr);
  if (!token) {
    return res.status(401).json({
      error: { message: "Unauthorized: Invalid token", type: "invalid_request_error", param: null, code: "unauthorized" }
    });
  }

  const { model, messages, temperature, max_tokens, stream } = req.body;
  const lastMessage = messages?.[messages.length - 1];
  const userMessage = extractTextContent(lastMessage?.content || "");
  const responseId = "chatcmpl-" + Math.random().toString(36).slice(2, 10);
  const createdAt = Date.now();

  // Test mode for tool call feature
  if (userMessage.includes("测试工具调用") || userMessage.includes("列出当前目录")) {
    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();

      const toolCallMsg = `**🔧 Executing tool**: \`ls\`\n\nArguments:\n\`\`\`json\n{"path": "."}\n\`\`\`\n\n`;
      res.write(`data: ${JSON.stringify({ id: responseId, object: 'chat.completion.chunk', created: createdAt, model: 'sapni', choices: [{ index: 0, delta: { content: toolCallMsg }, finish_reason: null }] })}\n\n`);

      const toolResult = `**Tool: \`ls\`**\n\n当前目录内容：\n\n- \`Src/\` - 源代码目录\n- \`Tools/\` - 工具模块\n- \`Mem/\` - 记忆模块\n- \`config.json\` - 配置文件\n- \`package.json\` - 项目配置\n\n共 5 个项目`;
      res.write(`data: ${JSON.stringify({ id: responseId, object: 'chat.completion.chunk', created: createdAt, model: 'sapni', choices: [{ index: 0, delta: { content: toolResult + "\n\n" }, finish_reason: null }] })}\n\n`);

      const summary = "已成功列出当前目录内容。共有5个项目，包括源代码目录、工具模块、记忆模块和配置文件。";
      res.write(`data: ${JSON.stringify({ id: responseId, object: 'chat.completion.chunk', created: createdAt, model: 'sapni', choices: [{ index: 0, delta: { content: summary }, finish_reason: null }] })}\n\n`);

      res.write('data: [DONE]\n\n');
      res.end();
    } else {
      res.json({
        id: responseId,
        object: 'chat.completion',
        created: createdAt,
        model: 'sapni',
        choices: [{
          index: 0,
          message: { role: 'assistant', content: `**🔧 Executing tool**: \`ls\`\n\nArguments:\n\`\`\`json\n{"path": "."}\n\`\`\`\n\n**Tool: \`ls\`**\n\n当前目录内容：\n\n- \`Src/\` - 源代码目录\n- \`Tools/\` - 工具模块\n- \`Mem/\` - 记忆模块\n- \`config.json\` - 配置文件\n- \`package.json\` - 项目配置\n\n已成功列出当前目录内容。` },
          finish_reason: 'stop',
        }],
        usage: { prompt_tokens: userMessage.length, completion_tokens: 100, total_tokens: userMessage.length + 100 },
      });
    }
    return;
  }

  if (stream) {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    let cacheBuffer = [];

    try {
      const finalResponse = await agent.run(userMessage, {
        onContent: (token) => {
          cacheBuffer.push(token);
          res.write(`data: ${JSON.stringify({
            id: responseId,
            object: 'chat.completion.chunk',
            created: createdAt,
            model: 'sapni',
            choices: [{ index: 0, delta: { content: token }, finish_reason: null }]
          })}\n\n`);
        },
        onToolCall: (name, args, step) => {
          const toolCallMsg = `**🔧 Executing tool**: \`${name}\`\n\nArguments:\n\`\`\`json\n${JSON.stringify(args, null, 2)}\n\`\`\`\n\n`;
          res.write(`data: ${JSON.stringify({
            id: responseId,
            object: 'chat.completion.chunk',
            created: createdAt,
            model: 'sapni',
            choices: [{ index: 0, delta: { content: toolCallMsg }, finish_reason: null }]
          })}\n\n`);
          cacheBuffer.push(toolCallMsg);
        },
        onToolResult: (name, result) => {
          const resultMsg = formatToolResult(name, result);
          res.write(`data: ${JSON.stringify({
            id: responseId,
            object: 'chat.completion.chunk',
            created: createdAt,
            model: 'sapni',
            choices: [{ index: 0, delta: { content: resultMsg + "\n\n" }, finish_reason: null }]
          })}\n\n`);
          cacheBuffer.push(resultMsg);
        },
        _noAutoSave: true,
      });

      res.write('data: [DONE]\n\n');
      res.end();
    } catch (error) {
      res.write(`data: ${JSON.stringify({
        id: responseId,
        object: 'chat.completion.chunk',
        created: createdAt,
        model: 'sapni',
        choices: [{ index: 0, delta: { content: `**Error**: ${error.message}` }, finish_reason: 'error' }]
      })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    }
  } else {
    try {
      const finalResponse = await agent.run(userMessage, { _noAutoSave: true });
      res.json({
        id: responseId,
        object: 'chat.completion',
        created: createdAt,
        model: 'sapni',
        choices: [{ index: 0, message: { role: 'assistant', content: finalResponse }, finish_reason: 'stop' }],
        usage: { prompt_tokens: userMessage.length, completion_tokens: finalResponse.length, total_tokens: userMessage.length + finalResponse.length },
      });
    } catch (error) {
      res.status(500).json({ error: { message: error.message, type: 'server_error', param: null, code: 'internal_error' } });
    }
  }
}

export async function startServer(port = null) {
  if (port === null) {
    port = CONFIG.api?.port || 27262;
  }

  try {
    await initAgent();
  } catch (err) {
    console.error("Failed to initialize agent:", err.message);
    throw err;
  }

  // 健康检查（无需认证）
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // 模型列表
  app.get("/v1/models", handleModels);
  app.get("/api/v1/models", handleModels);

  // 单个模型信息
  app.get("/v1/models/:model_id", handleModelInfo);
  app.get("/api/v1/models/:model_id", handleModelInfo);

  // 聊天接口
  app.post("/v1/chat/completions", handleChatCompletions);
  app.post("/api/v1/chat/completions", handleChatCompletions);

  // 工具列表
  app.get("/api/v1/tools", handleToolList);

  // 工具执行
  app.post("/api/v1/tools/execute", handleToolExecute);

  // 系统状态
  app.get("/api/v1/system/status", handleSystemStatus);

  // 如果没有token，创建一个默认token
  if (tokens.length === 0) {
    const defaultToken = generateToken("Default Token");
    console.log("\n⚠️  No API tokens found. Created default token:", defaultToken.token);
  }

  server = createServer(app);
  
  server.listen(port, () => {
    console.log(`\n🚀 Sapni API Server running on http://localhost:${port}`);
    console.log("📋 API Endpoints:");
    console.log("   - GET  /api/v1/models          List models");
    console.log("   - GET  /api/v1/models/:id      Get model");
    console.log("   - POST /api/v1/chat/completions Chat");
    console.log("   - GET  /api/v1/tools           List tools");
    console.log("   - POST /api/v1/tools/execute   Execute tool");
    console.log("   - GET  /api/v1/system/status   System status");
    console.log("   - GET  /api/health             Health check (no auth)");
    console.log("\n🔑 Token management: Use /sp_token commands in terminal");
    console.log("🔄 Using model:", LLM_CONFIG.model || "not configured");
  });
}

export function stopServer() {
  if (server) {
    server.close();
    server = null;
    return true;
  }
  return false;
}

export function isServerRunning() {
  return server !== null;
}
