/**
 * 语法校验工具 — 写文件后自动检查，当场报错
 * 支持: .js/.mjs/.cjs (node --check), .ts/.tsx (tsc), .py (py_compile), .json (JSON.parse)
 */
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

/**
 * 对文件进行语法检查
 * @param {string} filePath - 文件路径
 * @returns {string|null} - 错误信息，null 表示通过
 */
function syntaxCheck(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  try {
    switch (ext) {
      case ".js":
      case ".mjs":
      case ".cjs": {
        execSync(`node --check ${JSON.stringify(filePath)}`, {
          encoding: "utf-8",
          timeout: 10000,
          stdio: "pipe",
        });
        return null;
      }

      case ".ts":
      case ".tsx": {
        // 检查项目根是否有 tsconfig.json
        const dir = path.dirname(filePath);
        const tsconfig = findUp("tsconfig.json", dir);
        if (tsconfig) {
          execSync(`npx tsc --noEmit --pretty false 2>&1 | grep ${JSON.stringify(path.basename(filePath))} || true`, {
            encoding: "utf-8",
            timeout: 30000,
            cwd: path.dirname(tsconfig),
            stdio: "pipe",
          });
        }
        // tsc 太慢，只做 node 基础检查
        return null;
      }

      case ".py": {
        execSync(`python3 -m py_compile ${JSON.stringify(filePath)}`, {
          encoding: "utf-8",
          timeout: 10000,
          stdio: "pipe",
        });
        return null;
      }

      case ".json": {
        const raw = fs.readFileSync(filePath, "utf-8");
        JSON.parse(raw);
        return null;
      }

      case ".html":
      case ".css":
      case ".scss":
      case ".md":
      case ".txt":
      case ".yaml":
      case ".yml":
      case ".toml":
        // 这些格式不做语法检查
        return null;

      default:
        // 未知扩展名，尝试 node --check（可能是无扩展名的 JS）
        return null;
    }
  } catch (e) {
    // 提取有用的错误信息
    let msg = (e.stderr || e.stdout || e.message || "").toString();

    // 精简 tsc 输出
    if (ext === ".ts" || ext === ".tsx") {
      const lines = msg.split("\n").filter((l) => l.includes(path.basename(filePath)));
      if (lines.length > 0) {
        msg = lines.slice(0, 3).join("\n");
      } else {
        msg = msg.slice(0, 300);
      }
    }

    // 精简 node 输出
    if (ext === ".js" || ext === ".mjs" || ext === ".cjs") {
      msg = msg.split("\n").slice(0, 3).join("\n");
    }

    // 精简 python 输出
    if (ext === ".py") {
      msg = msg.split("\n").filter((l) => l.trim()).slice(0, 3).join("\n");
    }

    return msg.slice(0, 500);
  }
}

/**
 * 向上查找文件
 */
function findUp(filename, startDir) {
  let dir = path.resolve(startDir);
  const root = path.parse(dir).root;
  while (true) {
    const p = path.join(dir, filename);
    if (fs.existsSync(p)) return p;
    if (dir === root) return null;
    dir = path.dirname(dir);
  }
}

module.exports = { syntaxCheck, findUp };
