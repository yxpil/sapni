#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const __filename = fileURLToPath(import.meta.url);
const tsxPath = path.join(__dirname, "..", "node_modules", "tsx", "dist", "esm", "index.mjs");
const entryPath = path.join(__dirname, "..", "Src", "index.jsx");

// Node 24+: register() is broken, re-exec with --import
// --import requires file:// URL on Windows (Node 24 ESM restriction)
if (!process.execArgv.some(a => a.includes("tsx"))) {
  const result = spawnSync(
    process.execPath,
    ["--import", pathToFileURL(tsxPath).href, __filename, ...process.argv.slice(2)],
    { stdio: "inherit" }
  );
  process.exit(result.status ?? 1);
}

// Running under tsx loader — file:// URL for Windows compat
await import(pathToFileURL(entryPath).href);
