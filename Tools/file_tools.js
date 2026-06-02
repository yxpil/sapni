const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { syntaxCheck } = require("./syntax_check");

const readFileTool = {
  name: "read_file",
  description: "读取指定路径的文件内容",
  parameters: {
    filePath: { type: "string", required: true, description: "文件路径" },
  },
  execute: async ({ filePath }) => {
    if (!fs.existsSync(filePath)) return `[不存在] ${filePath}`;
    return fs.readFileSync(filePath, "utf-8");
  },
};

const writeFileTool = {
  name: "write_file",
  description: "创建或覆盖文件(自动创建父目录)",
  dangerous: true,
  parameters: {
    filePath: { type: "string", required: true, description: "文件路径" },
    content: { type: "string", required: true, description: "写入内容" },
  },
  execute: async ({ filePath, content }) => {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, content, "utf-8");
    // 语法检查
    const err = syntaxCheck(filePath);
    if (err) {
      return `[OK] 已写入 ${filePath} (${content.length} 字符)\n[⚠ 语法警告] ${err}`;
    }
    return `[OK] 已写入 ${filePath} (${content.length} 字符) | ✓ 语法通过`;
  },
};

const deleteFileTool = {
  name: "delete_file",
  description: "删除指定文件或空目录",
  dangerous: true,
  parameters: {
    filePath: { type: "string", required: true, description: "要删除的文件或目录路径" },
  },
  execute: async ({ filePath }) => {
    if (!fs.existsSync(filePath)) return `[不存在] ${filePath}`;
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      const entries = fs.readdirSync(filePath);
      if (entries.length > 0) return `[失败] 目录非空, 包含 ${entries.length} 个条目, 拒绝删除`;
      fs.rmdirSync(filePath);
      return `[OK] 已删除空目录 ${filePath}`;
    }
    fs.unlinkSync(filePath);
    return `[OK] 已删除 ${filePath}`;
  },
};

const moveFileTool = {
  name: "move_file",
  description: "移动/重命名文件或目录",
  dangerous: true,
  parameters: {
    source: { type: "string", required: true, description: "源路径" },
    target: { type: "string", required: true, description: "目标路径" },
  },
  execute: async ({ source, target }) => {
    if (!fs.existsSync(source)) return `[不存在] ${source}`;
    const targetDir = path.dirname(target);
    if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
    fs.renameSync(source, target);
    return `[OK] ${source} -> ${target}`;
  },
};

const copyFileTool = {
  name: "copy_file",
  description: "复制文件到目标路径",
  dangerous: true,
  parameters: {
    source: { type: "string", required: true, description: "源文件路径" },
    target: { type: "string", required: true, description: "目标路径" },
  },
  execute: async ({ source, target }) => {
    if (!fs.existsSync(source)) return `[不存在] ${source}`;
    const targetDir = path.dirname(target);
    if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
    fs.copyFileSync(source, target);
    return `[OK] 已复制 ${source} -> ${target}`;
  },
};

const listDirTool = {
  name: "list_dir",
  description: "列出目录内容(支持递归)",
  parameters: {
    dirPath: { type: "string", required: true, description: "目录路径" },
    recursive: { type: "boolean", required: false, description: "是否递归, 默认false" },
  },
  execute: async ({ dirPath, recursive }) => {
    if (!fs.existsSync(dirPath)) return `[不存在] ${dirPath}`;
    if (!recursive) {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      return entries.map((e) => {
        const mark = e.isDirectory() ? "[DIR]" : "[FILE]";
        const size = e.isFile() ? ` ${fs.statSync(path.join(dirPath, e.name)).size}B` : "";
        return `${mark} ${e.name}${size}`;
      }).join("\n");
    }
    const lines = [];
    function walk(dir, prefix) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const e of entries) {
        const fp = path.join(dir, e.name);
        if (e.isDirectory()) { lines.push(prefix + "[DIR]  " + e.name + "/"); walk(fp, prefix + "  "); }
        else lines.push(prefix + "[FILE] " + e.name);
      }
    }
    walk(dirPath, "");
    return lines.join("\n");
  },
};

const searchInFilesTool = {
  name: "search_in_files",
  description: "grep: 在目录中搜索内容, 返回 文件:行号:匹配行",
  parameters: {
    pattern: { type: "string", required: true, description: "搜索模式(纯文本或正则)" },
    dirPath: { type: "string", required: true, description: "搜索目录" },
    fileGlob: { type: "string", required: false, description: "文件过滤, 如 '*.js', 默认所有" },
    maxResults: { type: "number", required: false, description: "最大结果数, 默认50" },
    ignoreCase: { type: "boolean", required: false, description: "忽略大小写, 默认true" },
  },
  execute: async ({ pattern, dirPath, fileGlob, maxResults, ignoreCase }) => {
    if (!fs.existsSync(dirPath)) return `[不存在] ${dirPath}`;
    const max = maxResults || 50;
    const ic = ignoreCase !== false;
    try {
      const cmd = `grep -rn ${ic ? "-i" : ""} --include="${fileGlob || "*"}" -m ${max} "${pattern.replace(/"/g, '\\"')}" "${dirPath}"`;
      const output = execSync(cmd, { cwd: dirPath, encoding: "utf-8", timeout: 10000, maxBuffer: 1024 * 1024 });
      const lines = output.trim().split("\n").slice(0, max);
      return lines.length > 0 ? lines.join("\n") : `[无匹配] "${pattern}" 在 ${dirPath}`;
    } catch (e) {
      if (e.stdout) return e.stdout.trim().split("\n").slice(0, max).join("\n");
      return `[无匹配] "${pattern}" 在 ${dirPath}`;
    }
  },
};

const findFilesTool = {
  name: "find_files",
  description: "按文件名模式查找文件(glob), 如 '*.js' 或 'test*.ts'",
  parameters: {
    pattern: { type: "string", required: true, description: "glob模式, 如 '*.js' 或 '**/*.test.js'" },
    dirPath: { type: "string", required: true, description: "搜索起始目录" },
    maxResults: { type: "number", required: false, description: "最大结果数, 默认100" },
  },
  execute: async ({ pattern, dirPath, maxResults }) => {
    if (!fs.existsSync(dirPath)) return `[不存在] ${dirPath}`;
    const max = maxResults || 100;
    try {
      const cmd = `find "${dirPath}" -name "${pattern}" -not -path '*/node_modules/*' -not -path '*/.git/*' | head -n ${max}`;
      const output = execSync(cmd, { encoding: "utf-8", timeout: 5000, maxBuffer: 1024 * 1024 });
      return output.trim() || `[无匹配] ${pattern} 在 ${dirPath}`;
    } catch (e) {
      if (e.stdout) return e.stdout.trim() || `[无匹配] ${pattern}`;
      return `[无匹配] ${pattern} 在 ${dirPath}`;
    }
  },
};

const fileInfoTool = {
  name: "file_info",
  description: "获取文件元信息: 大小/修改时间/权限/行数",
  parameters: {
    filePath: { type: "string", required: true, description: "文件路径" },
  },
  execute: async ({ filePath }) => {
    if (!fs.existsSync(filePath)) return `[不存在] ${filePath}`;
    const stat = fs.statSync(filePath);
    const ext = path.extname(filePath);
    let lines = "?";
    try { lines = fs.readFileSync(filePath, "utf-8").split("\n").length; } catch (_) {}
    return [
      `路径: ${filePath}`,
      `类型: ${stat.isDirectory() ? "目录" : "文件"} (${ext || "无扩展名"})`,
      `大小: ${stat.size} B (${(stat.size / 1024).toFixed(1)} KB)`,
      `行数: ${lines}`,
      `权限: ${stat.mode.toString(8).slice(-3)}`,
      `修改: ${stat.mtime.toISOString()}`,
      `创建: ${stat.birthtime.toISOString()}`,
    ].join("\n");
  },
};

module.exports = {
  read_file: readFileTool,
  write_file: writeFileTool,
  delete_file: deleteFileTool,
  move_file: moveFileTool,
  copy_file: copyFileTool,
  list_dir: listDirTool,
  search_in_files: searchInFilesTool,
  find_files: findFilesTool,
  file_info: fileInfoTool,
};
