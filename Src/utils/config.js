import fs from "fs";
import path from "path";
import os from "os";

const SAPNI_DIR = path.join(os.homedir(), ".sapni");
const SAPNI_CONFIG = path.join(SAPNI_DIR, "config.json");

export function ensureDir() { 
  if (!fs.existsSync(SAPNI_DIR)) fs.mkdirSync(SAPNI_DIR, { recursive: true }); 
}

export function loadConfig(pkgConfigPath) {
  ensureDir();
  if (fs.existsSync(SAPNI_CONFIG)) {
    return JSON.parse(fs.readFileSync(SAPNI_CONFIG, "utf-8"));
  }
  const cfg = JSON.parse(fs.readFileSync(pkgConfigPath, "utf-8"));
  fs.writeFileSync(SAPNI_CONFIG, JSON.stringify(cfg, null, 2), "utf-8");
  return cfg;
}

export function saveConfig(cfg, _agent) {
  ensureDir();
  fs.writeFileSync(SAPNI_CONFIG, JSON.stringify(cfg, null, 2), "utf-8");
  if (_agent && _agent.llm) {
    _agent.llm.reloadConfig(cfg.llm);
    if (cfg.llm?.contextWindow) {
      _agent.actualContextWindow = cfg.llm.contextWindow;
      _agent.maxContextTokens = cfg.llm.contextWindow * 0.8;
    }
  }
}

export { SAPNI_DIR, SAPNI_CONFIG };
