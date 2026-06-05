const fs = require("fs");

const editLinesTool = {
  name: "edit_lines",
  description: "按行号编辑文件: insert_before/insert_after/replace/delete",
  dangerous: true,
  parameters: {
    filePath: { type: "string", required: true, description: "文件路径" },
    operation: { type: "string", required: true, description: "insert_before/insert_after/replace/delete" },
    lineNumber: { type: "number", required: true, description: "目标行号(从1开始)" },
    content: { type: "string", required: false, description: "新内容(insert/replace时必填, 支持\\n多行)" },
    count: { type: "number", required: false, description: "delete时删除的行数, 默认1" },
  },
  execute: async ({ filePath, operation, lineNumber, content, count }) => {
    if (!fs.existsSync(filePath)) return `[不存在] ${filePath}`;
    const lines = fs.readFileSync(filePath, "utf-8").split("\n");
    const idx = lineNumber - 1;
    if (idx < 0 || idx > lines.length) return `[越界] 行号 ${lineNumber}, 文件共 ${lines.length} 行`;

    switch (operation) {
      case "insert_before": lines.splice(idx, 0, ...(content || "").split("\n")); break;
      case "insert_after": lines.splice(idx + 1, 0, ...(content || "").split("\n")); break;
      case "replace": lines.splice(idx, 1, ...(content || "").split("\n")); break;
      case "delete": lines.splice(idx, count || 1); break;
      default: return `[错误] 未知操作: ${operation}, 可用: insert_before/insert_after/replace/delete`;
    }
    fs.writeFileSync(filePath, lines.join("\n"), "utf-8");
    return `[OK] ${operation} 行${lineNumber}, 文件现共 ${lines.length} 行`;
  },
};

const readLinesTool = {
  name: "read_lines",
  description: "读取文件指定行范围, 带行号",
  parameters: {
    filePath: { type: "string", required: true, description: "文件路径" },
    startLine: { type: "number", required: true, description: "起始行号(从1开始)" },
    endLine: { type: "number", required: false, description: "结束行号, 默认到文件末尾" },
  },
  execute: async ({ filePath, startLine, endLine }) => {
    if (!fs.existsSync(filePath)) return `[不存在] ${filePath}`;
    const lines = fs.readFileSync(filePath, "utf-8").split("\n");
    const s = Math.max(1, startLine) - 1;
    const e = endLine ? Math.min(lines.length, endLine) : lines.length;
    if (s >= lines.length) return `[越界] 起始 ${startLine}, 共 ${lines.length} 行`;
    return lines.slice(s, e).map((l, i) => `${s + i + 1}| ${l}`).join("\n");
  },
};

const searchInRangeTool = {
  name: "search_in_range",
  description: "在指定文件的行范围内搜索关键词, 返回匹配行+行号. 行列级别的精确搜索",
  parameters: {
    filePath: { type: "string", required: true, description: "文件路径" },
    pattern: { type: "string", required: true, description: "搜索关键词或正则" },
    startLine: { type: "number", required: false, description: "起始行号, 默认1" },
    endLine: { type: "number", required: false, description: "结束行号, 默认文件末尾" },
    ignoreCase: { type: "boolean", required: false, description: "忽略大小写, 默认true" },
    maxResults: { type: "number", required: false, description: "最大结果, 默认30" },
  },
  execute: async ({ filePath, pattern, startLine, endLine, ignoreCase, maxResults }) => {
    if (!fs.existsSync(filePath)) return `[不存在] ${filePath}`;
    const lines = fs.readFileSync(filePath, "utf-8").split("\n");
    const s = Math.max(1, (startLine || 1)) - 1;
    const e = endLine ? Math.min(lines.length, endLine) : lines.length;
    if (s >= lines.length) return `[越界] 起始 ${startLine || 1}, 共 ${lines.length} 行`;

    const max = maxResults || 30;
    const ic = ignoreCase !== false;
    const target = ic ? pattern.toLowerCase() : pattern;
    const results = [];

    for (let i = s; i < e && results.length < max; i++) {
      const line = lines[i];
      const cmp = ic ? line.toLowerCase() : line;
      if (cmp.includes(target)) {
        const col = cmp.indexOf(target) + 1;
        results.push(`${i + 1}:${col}| ${line}`);
      }
    }

    if (results.length === 0) {
      return `[无匹配] "${pattern}" 在 ${filePath} 第${s + 1}-${e}行 (共${e - s}行)`;
    }
    return `[${results.length} 处匹配 行${s + 1}-${e}]\n${results.join("\n")}`;
  },
};

module.exports = {
  edit_lines: editLinesTool,
  read_lines: readLinesTool,
  search_in_range: searchInRangeTool,
};
