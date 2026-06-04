#!/usr/bin/env node
// 测试: 用 npm view 检查最新版本
import { execSync } from "child_process";

const CURRENT = "1.1.6-1";

try {
  const stdout = execSync("npm view sapni-ai version", {
    timeout: 10000,
    encoding: "utf-8",
  }).trim();

  const latest = stdout;
  console.log("当前版本:", CURRENT);
  console.log("最新版本:", latest);

  if (latest !== CURRENT) {
    console.log("⬆ 新版本可用:", latest, "(当前:", CURRENT, ")");
    console.log("   更新: npm install -g sapni-ai@latest");
  } else {
    console.log("✓ 已是最新版");
  }
} catch (e) {
  console.log("⚠ 检查更新失败:", e.message);
}
