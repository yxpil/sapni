// 配置管理工具
const fs = require("fs");
const path = require("path");
const os = require("os");

const SAPNI_DIR = path.join(os.homedir(), ".sapni");
const SAPNI_CONFIG = path.join(SAPNI_DIR, "config.json");

function ensureDir() { 
  if (!fs.existsSync(SAPNI_DIR)) fs.mkdirSync(SAPNI_DIR, { recursive: true }); 
}

function loadConfig(pkgConfigPath) {
  ensureDir();
  if (fs.existsSync(SAPNI_CONFIG)) {
    return JSON.parse(fs.readFileSync(SAPNI_CONFIG, "utf-8"));
  }
  const cfg = JSON.parse(fs.readFileSync(pkgConfigPath, "utf-8"));
  fs.writeFileSync(SAPNI_CONFIG, JSON.stringify(cfg, null, 2), "utf-8");
  return cfg;
}

function saveConfig(cfg, _agent) {
  ensureDir();
  fs.writeFileSync(SAPNI_CONFIG, JSON.stringify(cfg, null, 2), "utf-8");
  // 自动重载 LLM 配置，无需重启
  if (_agent && _agent.llm) {
    _agent.llm.reloadConfig(cfg.llm);
    // 同步上下文窗口估算
    if (cfg.llm?.contextWindow) {
      _agent.actualContextWindow = cfg.llm.contextWindow;
      _agent.maxContextTokens = cfg.llm.contextWindow * 0.8;
    }
  }
}

module.exports = {
  SAPNI_DIR,
  SAPNI_CONFIG,
  ensureDir,
  loadConfig,
  saveConfig,
};
