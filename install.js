#!/usr/bin/env node
"use strict";

const os = require("os");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const VER = "0.7.14";
const G = "\x1b[0;32m", C = "\x1b[0;36m", Y = "\x1b[0;33m", R = "\x1b[0;31m", N = "\x1b[0m", D = "\x1b[2m";

const IS_WIN = process.platform === "win32";
const HOME = os.homedir();
const SAPNI_HOME = path.join(HOME, ".sapni");
const SAPNI_CONFIG = path.join(SAPNI_HOME, "config.json");

function run(cmd, silent) {
  try { return execSync(cmd, { encoding: "utf-8", stdio: silent ? "pipe" : "inherit" }); }
  catch (_) { return ""; }
}

function panic(msg) {
  console.error(`${R}${msg}${N}`);
  process.exit(1);
}

console.log("");
console.log(`  ${C}============================================${N}`);
console.log(`  ${C}  Sapni v${VER} — 安装中...${N}`);
console.log(`  ${C}============================================${N}`);
console.log("");

try { run("node --version", true); } catch (_) { panic("Node.js >= 18 required"); }

function ensureSapniDir() {
  if (!fs.existsSync(SAPNI_HOME)) fs.mkdirSync(SAPNI_HOME, { recursive: true });
  const memDir = path.join(SAPNI_HOME, "mem");
  if (!fs.existsSync(memDir)) fs.mkdirSync(memDir, { recursive: true });
  const toolsDir = path.join(SAPNI_HOME, "Tools", "custom");
  if (!fs.existsSync(toolsDir)) fs.mkdirSync(toolsDir, { recursive: true });
}

let oldKey = "";
if (fs.existsSync(SAPNI_CONFIG)) {
  try { oldKey = require(SAPNI_CONFIG).llm?.apiKey || ""; } catch (_) {}
}

function cleanOldShellRC() {
  if (IS_WIN) return;
  for (const f of [".bashrc", ".zshrc", ".bash_profile", ".profile"]) {
    const p = path.join(HOME, f);
    if (!fs.existsSync(p)) continue;
    let content = fs.readFileSync(p, "utf-8");
    const oldLen = content.split("\n").length;
    content = content.split("\n").filter(l => !/sapni/i.test(l)).join("\n");
    if (content.split("\n").length !== oldLen) fs.writeFileSync(p, content, "utf-8");
  }
}

function getNpmBinDir() {
  if (IS_WIN) {
    return path.join(process.env.APPDATA || "", "npm");
  }
  try {
    const prefix = execSync("npm config get prefix", { encoding: "utf-8" }).trim();
    return path.join(prefix, "bin");
  } catch (_) {
    return "/usr/local/bin";
  }
}

function ensureNpmBinInPATH() {
  const npmBin = getNpmBinDir();
  if (IS_WIN) {
    const levels = ["User", "Machine"];
    for (const level of levels) {
      let raw = "";
      try {
        raw = execSync(`powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable('Path', '${level}')"`, { encoding: "utf-8", windowsHide: true }).trim();
      } catch (_) { continue; }
      const norm = npmBin.toLowerCase().replace(/\//g, "\\");
      const parts = raw.split(";").filter(p => {
        const lo = p.toLowerCase().replace(/\//g, "\\");
        return lo && !lo.includes("sapni") && !lo.includes("\\Sapni\\");
      });
      const has = parts.some(p => p.toLowerCase().replace(/\//g, "\\") === norm);
      if (!has) parts.push(npmBin);
      const clean = parts.join(";");
      try {
        execSync(`powershell -NoProfile -Command "[Environment]::SetEnvironmentVariable('Path', '${clean.replace(/\\/g, "\\\\")}', '${level}')"`, { windowsHide: true });
      } catch (_) {}
    }
    console.log(`  ${G}PATH 已注入:${N} ${D}${npmBin}${N}`);
  } else {
    const shellRC = process.env.SHELL?.includes("zsh") ? ".zshrc" : ".bashrc";
    const rcPath = path.join(HOME, shellRC);
    let content = "";
    if (fs.existsSync(rcPath)) content = fs.readFileSync(rcPath, "utf-8");
    const marker = "# npm global bin";
    if (!content.includes(`export PATH="${npmBin}:$PATH"`) && !content.includes(npmBin)) {
      content += `\n${marker}\nexport PATH="${npmBin}:$PATH"\n`;
      fs.writeFileSync(rcPath, content, "utf-8");
      console.log(`  ${G}PATH 已注入:${N} ${D}${npmBin} → ${rcPath}${N}`);
    }
  }
}

cleanOldShellRC();
ensureNpmBinInPATH();

ensureSapniDir();

if (!fs.existsSync(SAPNI_CONFIG)) {
  const pkgCfg = path.join(__dirname, "config.json");
  if (fs.existsSync(pkgCfg)) {
    const cfg = JSON.parse(fs.readFileSync(pkgCfg, "utf-8"));
    if (oldKey && oldKey !== "YOUR_API_KEY" && oldKey !== "YOUR_DEEPSEEK_API_KEY_HERE") {
      cfg.llm.apiKey = oldKey;
    }
    fs.writeFileSync(SAPNI_CONFIG, JSON.stringify(cfg, null, 2), "utf-8");
    console.log(`  ${G}配置文件已创建:${N} ${D}${SAPNI_CONFIG}${N}`);
  }
}

console.log("");
console.log(`  ${G}============================================${N}`);
console.log(`  ${G}  安装完成! 打开新终端输入 sapni 即可启动${N}`);
console.log(`  ${G}============================================${N}`);
console.log("");
console.log(`  版本:    ${C}sapni --version${N}`);
console.log(`  配置:    ${C}${SAPNI_CONFIG}${N}`);
console.log(`  设置Key: ${C}sapni → /api key <你的Key>${N}`);
console.log("");
