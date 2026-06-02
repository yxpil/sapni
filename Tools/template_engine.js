/**
 * 模版引擎 — 类似 Trae 的代码骨架系统
 * 从 Skills/templates/ 加载预置模版，生成带语法检查的代码骨架
 */
const fs = require("fs");
const path = require("path");
const { syntaxCheck } = require("./syntax_check");

const TEMPLATES_DIR = path.join(__dirname, "..", "Skills", "templates");

function loadTemplates() {
  if (!fs.existsSync(TEMPLATES_DIR)) return {};
  const files = fs.readdirSync(TEMPLATES_DIR).filter((f) => f.endsWith(".cjs"));
  const templates = {};
  for (const file of files) {
    try {
      const mod = require(path.join(TEMPLATES_DIR, file));
      const name = file.replace(/\.cjs$/, "");
      templates[name] = {
        name,
        description: mod.description || "(无描述)",
        category: mod.category || "general",
        params: mod.params || {},
        generate: mod.generate,
      };
    } catch (_) {}
  }
  return templates;
}

const useTemplateTool = {
  name: "use_template",
  description: "代码模版引擎: 列出可用模版 或 按模版生成代码骨架. 类似 Trae 的模板系统",
  parameters: {
    action: { type: "string", required: true, description: "list(列出所有模版) 或 generate(按模版名生成代码)" },
    name: { type: "string", required: false, description: "模版名, generate 时必填, 如 'express-api' 或 'react-component'" },
    params: { type: "string", required: false, description: "模版参数, JSON 字符串, 如 '{\"name\":\"myApp\"}'" },
  },
  execute: async ({ action, name, params }) => {
    const templates = loadTemplates();

    if (action === "list") {
      const names = Object.keys(templates);
      if (names.length === 0) return "(暂无可用模版)\n提示: 将模版文件放入 Skills/templates/ 目录";

      // 按分类分组
      const groups = {};
      for (const [key, t] of Object.entries(templates)) {
        if (!groups[t.category]) groups[t.category] = [];
        groups[t.category].push(t);
      }

      const lines = [`可用模版 (${names.length} 个):`];
      for (const [cat, items] of Object.entries(groups)) {
        lines.push(`\n[${cat}]`);
        for (const t of items) {
          lines.push(`  ${t.name} — ${t.description}`);
        }
      }
      lines.push(`\n用法: use_template action=generate name=<模版名>`);
      return lines.join("\n");
    }

    if (action === "generate") {
      if (!name) return "[失败] 请指定模版名, 用 action=list 查看可用模版";

      const template = templates[name];
      if (!template) {
        const available = Object.keys(templates).join(", ");
        return `[不存在] 模版 "${name}"\n可用: ${available || "(无)"}`;
      }

      let parsedParams = {};
      if (params) {
        try {
          parsedParams = JSON.parse(params);
        } catch (_) {
          return `[失败] params 不是合法 JSON: ${params}`;
        }
      }

      try {
        const code = template.generate(parsedParams);
        return [
          `[模版: ${name}] ${template.description}`,
          `参数: ${JSON.stringify(parsedParams)}`,
          "",
          "```",
          code,
          "```",
          "",
          "提示: 用 write_file 将以上代码写入文件",
        ].join("\n");
      } catch (e) {
        return `[模版生成失败] ${name}: ${e.message}`;
      }
    }

    return `[错误] 未知 action: ${action}, 可用: list / generate`;
  },
};

module.exports = {
  use_template: useTemplateTool,
};
