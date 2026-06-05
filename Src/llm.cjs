const http = require("http");
const https = require("https");

class LLMClient {
  constructor(config) {
    this.apiKey = config.apiKey;
    this.baseURL = config.baseURL.endsWith('/') ? config.baseURL : config.baseURL + '/';
    this.model = config.model;
    this.provider = config.provider;
    this.maxTokens = config.maxTokens;
    this.temperature = config.temperature;
    this.topP = config.topP;
    this.totalPromptTokens = 0;
    this.totalCompletionTokens = 0;
    // 重试配置
    this.maxRetries = config.maxRetries ?? 3;
    this.retryDelay = config.retryDelay ?? 1500;
    this._networkOk = true; // 网络状态缓存
    this._supportsTools = null; // null: 未检测, true: 支持, false: 不支持
  }

  // 获取工具支持状态
  supportsTools() {
    return this._supportsTools !== false;
  }

  // 是否已检测过工具支持
  hasToolSupportInfo() {
    return this._supportsTools !== null;
  }

  // 快速网络检测: DNS 解析 API 主机
  async checkNetwork() {
    const dns = require("dns");
    try {
      const url = new URL(this.baseURL);
      await new Promise((resolve, reject) => {
        dns.lookup(url.hostname, { timeout: 3000 }, (err) => err ? reject(err) : resolve());
      });
      this._networkOk = true;
      return true;
    } catch (_) {
      this._networkOk = false;
      return false;
    }
  }

  isNetworkOk() { return this._networkOk; }

  getUsage() {
    return {
      prompt: this.totalPromptTokens,
      completion: this.totalCompletionTokens,
    };
  }

  resetUsage() {
    this.totalPromptTokens = 0;
    this.totalCompletionTokens = 0;
  }

  reloadConfig(config) {
    this.apiKey = config.apiKey;
    this.baseURL = config.baseURL.endsWith('/') ? config.baseURL : config.baseURL + '/';
    this.model = config.model;
    this.maxTokens = config.maxTokens;
    this.temperature = config.temperature;
    this.topP = config.topP;
    this.contextWindow = config.contextWindow;
    this.maxRetries = config.maxRetries ?? this.maxRetries;
    this.retryDelay = config.retryDelay ?? this.retryDelay;
  }

  // 判断是否应重试
  _shouldRetry(err, attempt) {
    if (attempt >= this.maxRetries) return false;
    const msg = (err.message || "").toLowerCase();
    // 不重试: 认证错误
    if (msg.includes("401") || msg.includes("403") || msg.includes("api key")) return false;
    if (msg.includes("invalid") && msg.includes("key")) return false;
    // 重试: 网络/超时/服务端错误/限流
    return /econnrefused|etimedout|enotfound|econnreset|socket|502|503|504|429|timeout|network|dns/.test(msg);
  }

  // 带重试的请求包装
  async _retryRequest(fn, name) {
    let lastErr;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          const delay = this.retryDelay * attempt;
          // 输出重试信息
          console.warn(`[Sapni] 重试 ${attempt}/${this.maxRetries} - 等待 ${delay}ms...`);
          await new Promise(r => setTimeout(r, delay));
        }
        return await fn();
      } catch (e) {
        lastErr = e;
        if (!this._shouldRetry(e, attempt)) throw e;
      }
    }
    throw lastErr || new Error(`${name} 重试耗尽 / retries exhausted (共 ${this.maxRetries} 次)`);
  }

  async chat(messages, tools = null, signal = null) {
    const body = {
      model: this.model,
      messages,
      max_tokens: this.maxTokens,
      temperature: this.temperature,
      top_p: this.topP,
      stream: false,
    };

    if (tools && tools.length > 0 && this._supportsTools !== false) {
      body.tools = tools;
      body.tool_choice = "auto";
    }

    let result;
    try {
      result = await this._retryRequest(
        () => this._request("/chat/completions", JSON.stringify(body), signal),
        "chat"
      );
    } catch (err) {
      if (err.message && err.message.includes("does not support tools")) {
        this._supportsTools = false;
        delete body.tools;
        delete body.tool_choice;
        result = await this._retryRequest(
          () => this._request("/chat/completions", JSON.stringify(body), signal),
          "chat"
        );
      } else {
        throw err;
      }
    }
    this._accumulateUsage(result.usage);
    return result;
  }

  async chatStream(messages, onToken, tools = null, signal = null, onUsage = null) {
    const body = {
      model: this.model,
      messages,
      max_tokens: this.maxTokens,
      temperature: this.temperature,
      top_p: this.topP,
      stream: true,
      stream_options: { include_usage: true },
    };

    if (tools && tools.length > 0 && this._supportsTools !== false) {
      body.tools = tools;
      body.tool_choice = "auto";
    }

    try {
      return await this._retryRequest(
        () => this._requestStream("/chat/completions", JSON.stringify(body), onToken, signal, onUsage),
        "chatStream"
      );
    } catch (err) {
      if (err.message && err.message.includes("does not support tools")) {
        this._supportsTools = false;
        // 抛出特殊错误让 agent 捕获并显示通知
        const degradeErr = new Error("MODEL_DOES_NOT_SUPPORT_TOOLS");
        degradeErr.retryWithoutTools = (retryOnUsage = null) => {
          delete body.tools;
          delete body.tool_choice;
          return this._retryRequest(
            () => this._requestStream("/chat/completions", JSON.stringify(body), onToken, signal, retryOnUsage || onUsage),
            "chatStream"
          );
        };
        throw degradeErr;
      }
      throw err;
    }
  }

  _accumulateUsage(usage) {
    if (!usage) return;
    if (usage.prompt_tokens) this.totalPromptTokens += usage.prompt_tokens;
    if (usage.completion_tokens) this.totalCompletionTokens += usage.completion_tokens;
  }

  _request(path, body, signal = null) {
    const url = new URL("chat/completions", this.baseURL);
    const isHttps = url.protocol === "https:";
    const protocol = isHttps ? https : http;

    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
    };
    if (signal) options.signal = signal;

    return new Promise((resolve, reject) => {
      const req = protocol.request(options, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          if (res.statusCode === 401) {
            reject(new Error("API Key 无效或未设置 — 请用 /api key <你的Key> 设置"));
            return;
          }
          if (res.statusCode === 403) {
            reject(new Error("API Key 无权限 (403 Forbidden)"));
            return;
          }
          try {
            const json = JSON.parse(data);
            if (json.error) {
              reject(new Error(json.error.message));
            } else {
              resolve(json);
            }
          } catch (e) {
            reject(new Error(`parse error: ${data.slice(0, 200)}`));
          }
        });
      });

      req.on("error", (err) => {
        const url = new URL(this.baseURL);
        let friendlyMsg = err.message;
        if (err.code === "ECONNREFUSED") {
          friendlyMsg = `[ECONNREFUSED] 服务不可达 - ${url.hostname}:${url.port || (isHttps ? 443 : 80)} 未响应，请检查服务是否已启动`;
        } else if (err.code === "ETIMEDOUT") {
          friendlyMsg = `[ETIMEDOUT] 请求超时 - 连接到 ${url.hostname} 超时，请检查网络或稍后重试`;
        } else if (err.code === "ENOTFOUND") {
          friendlyMsg = `[ENOTFOUND] DNS解析失败 - 无法解析 ${url.hostname}，请检查网络连接`;
        } else if (err.code === "ECONNRESET") {
          friendlyMsg = `[ECONNRESET] 连接被重置 - 服务器意外断开连接，请重试`;
        } else if (err.code === "EAI_AGAIN") {
          friendlyMsg = `[EAI_AGAIN] 网络不可用 - DNS查询失败，请检查网络连接`;
        }
        reject(new Error(friendlyMsg));
      });
      req.write(body);
      req.end();
    });
  }

  _requestStream(path, body, onToken, signal = null, onUsage = null) {
    const url = new URL("chat/completions", this.baseURL);
    const isHttps = url.protocol === "https:";
    const protocol = isHttps ? https : http;

    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
    };
    if (signal) options.signal = signal;

    return new Promise((resolve, reject) => {
      const req = protocol.request(options, (res) => {
        if (res.statusCode === 401) {
          reject(new Error("API Key 无效或未设置 — 请用 /api key <你的Key> 设置"));
          return;
        }
        if (res.statusCode === 403) {
          reject(new Error("API Key 无权限 (403 Forbidden)"));
          return;
        }
        if (res.statusCode >= 400) {
          let body = "";
          res.on("data", (c) => (body += c));
          res.on("end", () => {
            try {
              const j = JSON.parse(body);
              reject(new Error(j.error?.message || `HTTP ${res.statusCode}`));
            } catch (_) {
              reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 200)}`));
            }
          });
          return;
        }
        let buffer = "";
        const toolCallsMap = {};
        let content = "";
        let reasoningContent = "";
        const self = this;

        res.on("data", (chunk) => {
          buffer += chunk.toString();
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith("data: ")) continue;
            const jsonStr = trimmed.slice(6);
            if (jsonStr === "[DONE]") continue;

            try {
              const json = JSON.parse(jsonStr);
              const delta = json.choices?.[0]?.delta;

              if (delta?.content) {
                content += delta.content;
                if (onToken) onToken(delta.content);
              }

              if (delta?.reasoning_content) {
                reasoningContent += delta.reasoning_content;
              }

              if (delta?.tool_calls) {
                for (const tc of delta.tool_calls) {
                  const idx = tc.index;
                  if (!toolCallsMap[idx]) {
                    toolCallsMap[idx] = {
                      id: tc.id || "",
                      type: "function",
                      function: { name: "", arguments: "" },
                    };
                  }
                  if (tc.id) toolCallsMap[idx].id = tc.id;
                  if (tc.function?.name) toolCallsMap[idx].function.name += tc.function.name;
                  if (tc.function?.arguments) toolCallsMap[idx].function.arguments += tc.function.arguments;
                }
              }

              if (json.usage) {
                self._accumulateUsage(json.usage);
                // 实时回调 token 用量
                if (onUsage) {
                  try {
                    onUsage(self.getUsage());
                  } catch (_) {}
                }
              }
            } catch (_) {}
          }
        });

        res.on("end", () => {
          const toolCalls = Object.keys(toolCallsMap)
            .sort((a, b) => a - b)
            .map((k) => toolCallsMap[k]);

          resolve({
            content: content || null,
            reasoningContent: reasoningContent || null,
            toolCalls: toolCalls.length > 0 ? toolCalls : null,
          });
        });

        res.on("error", (err) => {
          const url = new URL(self.baseURL);
          let friendlyMsg = err.message;
          if (err.code === "ECONNREFUSED") {
            friendlyMsg = `[ECONNREFUSED] 服务不可达 - ${url.hostname}:${url.port || (isHttps ? 443 : 80)} 未响应，请检查服务是否已启动`;
          } else if (err.code === "ETIMEDOUT") {
            friendlyMsg = `[ETIMEDOUT] 请求超时 - 连接到 ${url.hostname} 超时，请检查网络或稍后重试`;
          } else if (err.code === "ENOTFOUND") {
            friendlyMsg = `[ENOTFOUND] DNS解析失败 - 无法解析 ${url.hostname}，请检查网络连接`;
          } else if (err.code === "ECONNRESET") {
            friendlyMsg = `[ECONNRESET] 连接被重置 - 服务器意外断开连接，请重试`;
          } else if (err.code === "EAI_AGAIN") {
            friendlyMsg = `[EAI_AGAIN] 网络不可用 - DNS查询失败，请检查网络连接`;
          }
          reject(new Error(friendlyMsg));
        });
      });

      req.on("error", (err) => {
        const url = new URL(self.baseURL);
        let friendlyMsg = err.message;
        if (err.code === "ECONNREFUSED") {
          friendlyMsg = `[ECONNREFUSED] 服务不可达 - ${url.hostname}:${url.port || (isHttps ? 443 : 80)} 未响应，请检查服务是否已启动`;
        } else if (err.code === "ETIMEDOUT") {
          friendlyMsg = `[ETIMEDOUT] 请求超时 - 连接到 ${url.hostname} 超时，请检查网络或稍后重试`;
        } else if (err.code === "ENOTFOUND") {
          friendlyMsg = `[ENOTFOUND] DNS解析失败 - 无法解析 ${url.hostname}，请检查网络连接`;
        } else if (err.code === "ECONNRESET") {
          friendlyMsg = `[ECONNRESET] 连接被重置 - 服务器意外断开连接，请重试`;
        } else if (err.code === "EAI_AGAIN") {
          friendlyMsg = `[EAI_AGAIN] 网络不可用 - DNS查询失败，请检查网络连接`;
        }
        reject(new Error(friendlyMsg));
      });
      req.write(body);
      req.end();
    });
  }
}

module.exports = LLMClient;
