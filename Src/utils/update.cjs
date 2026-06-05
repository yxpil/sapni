// 版本更新检测 — 缓存 + semver 比较 + HTTP 回退
const https = require("https");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { exec } = require("child_process");

const SAPNI_DIR = path.join(os.homedir(), ".sapni");
const CACHE_FILE = path.join(SAPNI_DIR, ".update-check");
const CHECK_INTERVAL = 24 * 60 * 60 * 1000; // 24小时检查一次

/** 读取当前版本（从 package.json） */
function getCurrentVersion() {
  try {
    const pkg = require(path.join(__dirname, "..", "..", "package.json"));
    return pkg.version || "0.0.0";
  } catch (_) { return "0.0.0"; }
}

/** 解析 semver 为数字数组 [major, minor, patch] */
function parseVersion(v) {
  const clean = String(v).replace(/^v/i, "").split("-")[0]; // 去掉 v 前缀和 pre-release
  const parts = clean.split(".").map(Number);
  return [
    isNaN(parts[0]) ? 0 : parts[0],
    isNaN(parts[1]) ? 0 : parts[1],
    isNaN(parts[2]) ? 0 : parts[2],
  ];
}

/** 返回: 负数 = a < b, 0 = 相等, 正数 = a > b */
function compareVersions(a, b) {
  const va = parseVersion(a);
  const vb = parseVersion(b);
  for (let i = 0; i < 3; i++) {
    if (va[i] !== vb[i]) return va[i] - vb[i];
  }
  return 0;
}

/** 读取缓存 */
function readCache() {
  try {
    if (!fs.existsSync(CACHE_FILE)) return null;
    const raw = fs.readFileSync(CACHE_FILE, "utf-8");
    return JSON.parse(raw);
  } catch (_) { return null; }
}

/** 写入缓存 */
function writeCache(data) {
  try {
    const dir = path.dirname(CACHE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify({ ...data, checkedAt: Date.now() }), "utf-8");
  } catch (_) {}
}

/** 通过 HTTPS 获取最新版本（比 npm view 更快） */
function fetchLatestFromRegistry(timeout = 5000) {
  return new Promise((resolve, reject) => {
    const req = https.get("https://registry.npmjs.org/sapni-ai/latest", {
      headers: { "Accept": "application/json" },
      timeout,
    }, (res) => {
      let body = "";
      res.on("data", (c) => body += c);
      res.on("end", () => {
        try {
          const json = JSON.parse(body);
          resolve(json.version || null);
        } catch (_) { resolve(null); }
      });
    });
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
    req.on("error", reject);
  });
}

/** 通过 npm view 获取最新版本（回退方案） */
function fetchLatestFromNpm(timeout = 8000) {
  return new Promise((resolve) => {
    exec("npm view sapni-ai version", { timeout, windowsHide: true }, (err, stdout) => {
      if (err) { resolve(null); return; }
      const v = String(stdout).trim();
      resolve(v && /^\d+\./.test(v) ? v : null);
    });
  });
}

/**
 * 检查更新（异步，非阻塞）
 * 返回: { current, latest, needsUpdate, reason, error? }
 */
async function checkUpdate(options = {}) {
  const force = options.force === true;
  const current = getCurrentVersion();
  
  // 1. 检查缓存（非强制模式）
  if (!force) {
    const cache = readCache();
    if (cache && cache.version && cache.checkedAt) {
      const age = Date.now() - cache.checkedAt;
      if (age < CHECK_INTERVAL) {
        const cmp = compareVersions(cache.version, current);
        if (cmp > 0) {
          return { current, latest: cache.version, needsUpdate: true, isDev: false, reason: "cache", changed: cache.changed };
        }
        if (cmp < 0) {
          return { current, latest: cache.version, needsUpdate: false, isDev: true, reason: "cache-dev" };
        }
        return { current, latest: current, needsUpdate: false, isDev: false, reason: "cache-fresh" };
      }
    }
  }

  // 2. 尝试从 registry 获取最新版本
  let latest = null;
  let source = null;
  try {
    latest = await fetchLatestFromRegistry(5000);
    source = "registry";
  } catch (_) {}

  // 3. 回退到 npm view
  if (!latest) {
    try {
      latest = await fetchLatestFromNpm(8000);
      source = "npm";
    } catch (_) {}
  }

  // 4. 获取失败，使用缓存（即使过期）
  if (!latest) {
    const cache = readCache();
    if (cache && cache.version) {
      const cmp = compareVersions(cache.version, current);
      if (cmp > 0) return { current, latest: cache.version, needsUpdate: true, isDev: false, reason: "cache-stale", error: "registry-unreachable" };
      if (cmp < 0) return { current, latest: cache.version, needsUpdate: false, isDev: true, reason: "cache-stale-dev", error: "registry-unreachable" };
      return { current, latest: cache.version, needsUpdate: false, isDev: false, reason: "cache-stale" };
    }
    return { current, latest: null, needsUpdate: false, isDev: false, reason: "offline", error: "unable-to-check" };
  }

  // 5. 更新缓存
  writeCache({
    version: latest,
    changed: new Date().toISOString(),
  });

  // 6. 比较版本
  const cmp = compareVersions(latest, current);
  return {
    current,
    latest,
    needsUpdate: cmp > 0,
    isDev: cmp < 0,
    reason: cmp > 0 ? "newer-available" : cmp < 0 ? "dev-preview" : "up-to-date",
    source,
  };
}

module.exports = { checkUpdate, compareVersions, getCurrentVersion };

/** 同步快速检查是否处于开发预览模式（读缓存，不联网） */
function isDevMode() {
  const current = getCurrentVersion();
  const cache = readCache();
  if (cache && cache.version) {
    return compareVersions(current, cache.version) > 0;
  }
  return false;
}
module.exports.isDevMode = isDevMode;
