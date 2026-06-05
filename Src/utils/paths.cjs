// 路径管理工具
const path = require("path");
const os = require("os");

// 获取当前文件路径
const __filename = require("url").fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pkgDir = path.resolve(__dirname, "..", "..");
const sapniDir = path.join(os.homedir(), ".sapni");

// ── 显示 Sapni 扩展路径 ──────────
function expandPaths() {
  try {
    const memDir = path.join(sapniDir, "mem");
    const histDir = path.join(sapniDir, "history");
    const customToolsDir = path.join(sapniDir, "Tools", "custom");
    const apiTokens = path.join(sapniDir, "api_tokens.json");
    const skillsDir = path.join(pkgDir, "Skills");
    const logosDir = path.join(pkgDir, "Logos");
    const bin = path.join(os.homedir(), ".npm-global", "bin", "sapni");

    const entries = [
      { label: "包目录 / Package",  path: pkgDir },
      { label: "用户配置 / Config",  path: path.join(sapniDir, "config.json") },
      { label: "记忆存储 / Memory",  path: memDir },
      { label: "历史会话 / History", path: histDir },
    ];

    entries.push({ label: "自定义工具 / Tools", path: customToolsDir });
    entries.push({ label: "API令牌 / Tokens", path: apiTokens });
    entries.push({ label: "内置技能 / Skills", path: skillsDir });
    entries.push({ label: "Logo资源 / Logos", path: logosDir });
    entries.push({ label: "启动入口 / Binary", path: bin });

    return { entries };
  } catch (_) { 
    return { entries: [{ label: "路径解析失败 / Path error", path: String(sapniDir) }] }; 
  }
}

module.exports = {
  expandPaths,
};
