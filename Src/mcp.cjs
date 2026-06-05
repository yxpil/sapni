const http = require("http");
const https = require("https");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

class MCPClient {
  constructor(options = {}) {
    this.url = options.url;
    this.apiKey = options.apiKey;
    this.mode = options.mode || "http"; // "http" or "stdio"
    this.process = null;
    this._discoveredTools = null;
    this._lastDiscovery = 0;
    this._discoveryInterval = 300000;
    this._requestId = 0;
    this._pendingRequests = new Map();
  }

  static async discover(options = {}) {
    const discoveries = [];

    // 1. 检查环境变量
    if (process.env.MCP_URL) {
      discoveries.push({
        url: process.env.MCP_URL,
        source: "environment",
        priority: 1,
        mode: "http"
      });
    }

    // 2. 检查本地 mcp.json 配置文件
    const mcpConfigPath = path.join(require("os").homedir(), ".sapni", "mcp.json");
    if (fs.existsSync(mcpConfigPath)) {
      try {
        const config = JSON.parse(fs.readFileSync(mcpConfigPath, "utf-8"));
        if (config.url) {
          discoveries.push({
            url: config.url,
            source: "config",
            priority: 2,
            mode: config.mode || "http"
          });
        }
      } catch (_) {}
    }

    // 3. 检查 DNS-SD
    try {
      const dns = require("dns");
      const services = await new Promise((resolve) => {
        dns.resolveTxt("_mcp._tcp.local", (err, records) => {
          if (err || !records || records.length === 0) {
            resolve([]);
            return;
          }
          const results = [];
          records.forEach(record => {
            const txt = record.join("");
            const urlMatch = txt.match(/url=([^,]+)/);
            if (urlMatch) {
              results.push({
                url: urlMatch[1],
                source: "dns-sd",
                priority: 3,
                mode: "http"
              });
            }
          });
          resolve(results);
        });
      });
      discoveries.push(...services);
    } catch (_) {}

    // 4. 检查本地安装的 MCP 服务（如 codegraph）
    const localServices = await MCPClient._discoverLocalServices();
    discoveries.push(...localServices);

    // 5. 默认本地 HTTP 服务
    if (options.includeLocal !== false) {
      const localUrls = [
        "http://localhost:8080/mcp",
        "http://localhost:3210/mcp",
        "http://127.0.0.1:8080/mcp"
      ];
      for (const url of localUrls) {
        discoveries.push({
          url,
          source: "default",
          priority: 10,
          mode: "http"
        });
      }
    }

    // 验证服务
    const validServices = [];
    for (const discovery of discoveries) {
      try {
        if (discovery.mode === "stdio") {
          validServices.push(discovery);
        } else {
          await MCPClient._validateHttpService(discovery.url);
          validServices.push(discovery);
        }
      } catch (_) {}
    }

    validServices.sort((a, b) => a.priority - b.priority);
    return validServices;
  }

  static async _discoverLocalServices() {
    const services = [];

    // 检查 codegraph
    try {
      const codegraphPath = require.resolve("@colbymchenry/codegraph");
      const pkgJson = require(path.join(path.dirname(codegraphPath), "package.json"));
      services.push({
        url: "codegraph",
        source: "npm-package",
        priority: 4,
        mode: "stdio",
        name: pkgJson.name,
        version: pkgJson.version
      });
    } catch (_) {}

    // 检查其他常见 MCP 服务...
    return services;
  }

  static async _validateHttpService(url) {
    return new Promise((resolve, reject) => {
      try {
        const parsedUrl = new URL(url);
        const protocol = parsedUrl.protocol === "https:" ? https : http;
        const options = {
          hostname: parsedUrl.hostname,
          port: parsedUrl.port || (parsedUrl.protocol === "https:" ? 443 : 80),
          path: parsedUrl.pathname + "/health" || "/health",
          method: "GET",
          timeout: 3000
        };

        const req = protocol.request(options, (res) => {
          if (res.statusCode === 200) {
            resolve(url);
          } else {
            reject(new Error("Service not healthy"));
          }
        });

        req.on("timeout", () => { req.destroy(); reject(new Error("Timeout")); });
        req.on("error", reject);
        req.end();
      } catch (e) {
        reject(e);
      }
    });
  }

  async connect() {
    if (this.mode === "stdio") {
      return this._connectStdio();
    } else {
      return this._connectHttp();
    }
  }

  async _connectStdio() {
    if (this.process) return;

    // 使用 npx 来调用本地安装的 npm 包
    const command = `npx ${this.url} serve --mcp`;
    this.process = spawn(command, {
      stdio: ["pipe", "pipe", "pipe"],
      shell: true
    });

    this.process.stdout.on("data", (data) => {
      this._handleStdioData(data.toString());
    });

    this.process.stderr.on("data", (data) => {
      console.debug(`[MCP stderr] ${data.toString().trim()}`);
    });

    this.process.on("close", (code) => {
      console.log(`[MCP] Process closed with code ${code}`);
      this.process = null;
    });

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  _handleStdioData(data) {
    const lines = data.trim().split("\n");
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const json = JSON.parse(line);
        if (json.id && this._pendingRequests.has(json.id)) {
          const callback = this._pendingRequests.get(json.id);
          this._pendingRequests.delete(json.id);
          if (json.error) {
            callback(new Error(json.error));
          } else {
            callback(null, json.result);
          }
        }
      } catch (_) {}
    }
  }

  async _connectHttp() {
    // HTTP 模式不需要显式连接
  }

  async getTools(refresh = false) {
    const now = Date.now();
    if (!refresh && this._discoveredTools && (now - this._lastDiscovery) < this._discoveryInterval) {
      return this._discoveredTools;
    }

    const tools = await this._request({ type: "list_tools" });
    this._discoveredTools = tools || [];
    this._lastDiscovery = now;
    return this._discoveredTools;
  }

  async invokeTool(toolName, parameters = {}) {
    const result = await this._request({
      type: "invoke_tool",
      name: toolName,
      parameters
    });
    return result;
  }

  async health() {
    try {
      await this._request({ type: "health" });
      return { status: "ok" };
    } catch {
      return { status: "error" };
    }
  }

  async _request(payload) {
    if (this.mode === "stdio") {
      return this._requestStdio(payload);
    } else {
      return this._requestHttp(payload);
    }
  }

  async _requestStdio(payload) {
    if (!this.process) {
      await this.connect();
    }

    return new Promise((resolve, reject) => {
      const id = String(++this._requestId);
      const request = { id, ...payload };

      this._pendingRequests.set(id, (err, result) => {
        if (err) reject(err);
        else resolve(result);
      });

      this.process.stdin.write(JSON.stringify(request) + "\n");
    });
  }

  async _requestHttp(payload) {
    const url = new URL(this.url);
    const isHttps = url.protocol === "https:";
    const protocol = isHttps ? https : http;

    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      timeout: 30000
    };

    if (this.apiKey) {
      options.headers.Authorization = `Bearer ${this.apiKey}`;
    }

    return new Promise((resolve, reject) => {
      const req = protocol.request(options, (res) => {
        let data = "";
        res.on("data", (chunk) => { data += chunk; });
        res.on("end", () => {
          try {
            const json = data ? JSON.parse(data) : {};
            if (res.statusCode >= 400) {
              reject(new Error(json.error || `HTTP ${res.statusCode}`));
            } else {
              resolve(json.result || json);
            }
          } catch (e) {
            reject(new Error("Invalid response"));
          }
        });
      });

      req.on("timeout", () => { req.destroy(); reject(new Error("Request timeout")); });
      req.on("error", reject);
      req.write(JSON.stringify(payload));
      req.end();
    });
  }

  async close() {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
  }
}

module.exports = MCPClient;
