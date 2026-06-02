const https = require("https");

class LLMClient {
  constructor(config) {
    this.apiKey = config.apiKey;
    this.baseURL = config.baseURL;
    this.model = config.model;
    this.maxTokens = config.maxTokens;
    this.temperature = config.temperature;
    this.topP = config.topP;
    this.totalPromptTokens = 0;
    this.totalCompletionTokens = 0;
  }

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

  async chat(messages, tools = null, signal = null) {
    const body = {
      model: this.model,
      messages,
      max_tokens: this.maxTokens,
      temperature: this.temperature,
      top_p: this.topP,
      stream: false,
    };

    if (tools && tools.length > 0) {
      body.tools = tools;
      body.tool_choice = "auto";
    }

    const result = await this._request("/chat/completions", JSON.stringify(body), signal);
    this._accumulateUsage(result.usage);
    return result;
  }

  async chatStream(messages, onToken, tools = null, signal = null) {
    const body = {
      model: this.model,
      messages,
      max_tokens: this.maxTokens,
      temperature: this.temperature,
      top_p: this.topP,
      stream: true,
      stream_options: { include_usage: true },
    };

    if (tools && tools.length > 0) {
      body.tools = tools;
      body.tool_choice = "auto";
    }

    return this._requestStream("/chat/completions", JSON.stringify(body), onToken, signal);
  }

  _accumulateUsage(usage) {
    if (!usage) return;
    if (usage.prompt_tokens) this.totalPromptTokens += usage.prompt_tokens;
    if (usage.completion_tokens) this.totalCompletionTokens += usage.completion_tokens;
  }

  _request(path, body, signal = null) {
    const url = new URL(path, this.baseURL);

    const options = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
    };
    if (signal) options.signal = signal;

    return new Promise((resolve, reject) => {
      const req = https.request(options, (res) => {
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

      req.on("error", reject);
      req.write(body);
      req.end();
    });
  }

  _requestStream(path, body, onToken, signal = null) {
    const url = new URL(path, this.baseURL);

    const options = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
    };
    if (signal) options.signal = signal;

    return new Promise((resolve, reject) => {
      const req = https.request(options, (res) => {
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
            toolCalls: toolCalls.length > 0 ? toolCalls : null,
          });
        });

        res.on("error", reject);
      });

      req.on("error", reject);
      req.write(body);
      req.end();
    });
  }
}

module.exports = LLMClient;
