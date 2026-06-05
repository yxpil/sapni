const path = require("path");
const os = require("os");

class MCPBuiltinService {
  constructor() {
    this._codegraph = null;
    this._projectPath = null;
    this._initialized = false;
    this._tools = [];
  }

  async initialize(projectPath = null) {
    if (this._initialized) return;

    try {
      // 尝试加载 codegraph SDK
      this._codegraph = require("@colbymchenry/codegraph");
      console.log("[Sapni] CodeGraph SDK loaded successfully");
      
      // 设置默认项目路径
      this._projectPath = projectPath || process.cwd();
      
      // 初始化项目（如果需要）
      await this._initProjectIfNeeded();
      
      // 发现工具
      await this._discoverTools();
      
      this._initialized = true;
      console.log("[Sapni] MCP built-in service initialized");
    } catch (e) {
      console.warn(`[Sapni] Failed to initialize built-in MCP: ${e.message}`);
      throw e;
    }
  }

  async _initProjectIfNeeded() {
    const graphPath = path.join(this._projectPath, ".codegraph");
    const fs = require("fs");
    
    if (!fs.existsSync(graphPath)) {
      console.log(`[Sapni] Initializing CodeGraph project at: ${this._projectPath}`);
      try {
        // 尝试初始化项目
        if (this._codegraph && this._codegraph.CodeGraph) {
          const graph = await this._codegraph.CodeGraph.create(graphPath);
          await graph.index();
          await graph.close();
        }
      } catch (e) {
        console.warn(`[Sapni] CodeGraph init failed (may need manual setup): ${e.message}`);
      }
    }
  }

  async _discoverTools() {
    this._tools = [];

    // 基础代码分析工具
    this._tools.push({
      name: "code_search",
      description: "在代码库中搜索符号、函数、类等",
      parameters: [
        { name: "query", type: "string", description: "搜索关键词", required: true },
        { name: "limit", type: "number", description: "结果数量限制", required: false }
      ]
    });

    this._tools.push({
      name: "code_definition",
      description: "查找符号的定义位置",
      parameters: [
        { name: "symbol", type: "string", description: "符号名称", required: true }
      ]
    });

    this._tools.push({
      name: "code_references",
      description: "查找符号的所有引用",
      parameters: [
        { name: "symbol", type: "string", description: "符号名称", required: true },
        { name: "limit", type: "number", description: "结果数量限制", required: false }
      ]
    });

    this._tools.push({
      name: "code_callers",
      description: "查找调用指定函数的所有位置",
      parameters: [
        { name: "function", type: "string", description: "函数名称", required: true }
      ]
    });

    this._tools.push({
      name: "code_callees",
      description: "查找函数调用的所有其他函数",
      parameters: [
        { name: "function", type: "string", description: "函数名称", required: true }
      ]
    });

    this._tools.push({
      name: "code_impact",
      description: "分析修改某个符号会影响哪些代码",
      parameters: [
        { name: "symbol", type: "string", description: "符号名称", required: true }
      ]
    });

    this._tools.push({
      name: "code_files",
      description: "获取项目文件结构",
      parameters: []
    });

    this._tools.push({
      name: "code_status",
      description: "获取代码库索引状态和统计信息",
      parameters: []
    });

    console.log(`[Sapni] Discovered ${this._tools.length} built-in MCP tools`);
  }

  async getTools() {
    if (!this._initialized) await this.initialize();
    return this._tools;
  }

  async invokeTool(toolName, parameters = {}) {
    if (!this._initialized) await this.initialize();

    switch (toolName) {
      case "code_search":
        return await this._search(parameters);
      case "code_definition":
        return await this._definition(parameters);
      case "code_references":
        return await this._references(parameters);
      case "code_callers":
        return await this._callers(parameters);
      case "code_callees":
        return await this._callees(parameters);
      case "code_impact":
        return await this._impact(parameters);
      case "code_files":
        return await this._files(parameters);
      case "code_status":
        return await this._status(parameters);
      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
  }

  async _withGraph(callback) {
    if (!this._codegraph?.CodeGraph) {
      return { error: "CodeGraph SDK not available" };
    }

    const graphPath = path.join(this._projectPath, ".codegraph");
    const fs = require("fs");
    
    if (!fs.existsSync(graphPath)) {
      return { 
        error: "CodeGraph project not initialized",
        hint: `Run 'npx codegraph init ${this._projectPath}' first`
      };
    }

    try {
      const graph = await this._codegraph.CodeGraph.open(graphPath);
      const result = await callback(graph);
      await graph.close();
      return result;
    } catch (e) {
      return { error: e.message };
    }
  }

  async _search(params) {
    const query = params.query || "";
    const limit = params.limit || 10;

    return this._withGraph(async (graph) => {
      const results = await graph.search(query, { limit });
      return {
        result: results.map(r => ({
          name: r.name,
          kind: r.kind,
          file: r.file,
          line: r.line,
          context: r.context
        }))
      };
    });
  }

  async _definition(params) {
    const symbol = params.symbol || "";

    return this._withGraph(async (graph) => {
      const def = await graph.definition(symbol);
      if (!def) return { result: null };
      return {
        result: {
          name: def.name,
          kind: def.kind,
          file: def.file,
          line: def.line,
          column: def.column
        }
      };
    });
  }

  async _references(params) {
    const symbol = params.symbol || "";
    const limit = params.limit || 20;

    return this._withGraph(async (graph) => {
      const refs = await graph.references(symbol, { limit });
      return {
        result: refs.map(r => ({
          file: r.file,
          line: r.line,
          context: r.context
        }))
      };
    });
  }

  async _callers(params) {
    const func = params.function || "";

    return this._withGraph(async (graph) => {
      const callers = await graph.callers(func);
      return {
        result: callers.map(c => ({
          name: c.name,
          file: c.file,
          line: c.line
        }))
      };
    });
  }

  async _callees(params) {
    const func = params.function || "";

    return this._withGraph(async (graph) => {
      const callees = await graph.callees(func);
      return {
        result: callees.map(c => ({
          name: c.name,
          file: c.file,
          line: c.line
        }))
      };
    });
  }

  async _impact(params) {
    const symbol = params.symbol || "";

    return this._withGraph(async (graph) => {
      const impact = await graph.impact(symbol);
      return {
        result: {
          affected_files: impact.files,
          affected_symbols: impact.symbols
        }
      };
    });
  }

  async _files(params) {
    return this._withGraph(async (graph) => {
      const files = await graph.files();
      return { result: files };
    });
  }

  async _status(params) {
    return this._withGraph(async (graph) => {
      const status = await graph.status();
      return { result: status };
    });
  }

  async health() {
    return this._initialized ? { status: "ok" } : { status: "not_initialized" };
  }

  async close() {
    // CodeGraph 使用完毕后会自动关闭
    this._initialized = false;
  }
}

module.exports = MCPBuiltinService;
