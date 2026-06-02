#!/usr/bin/env node
const { spawnSync } = require("child_process");
const path = require("path");
const { pathToFileURL } = require("url");

const tsxPath = pathToFileURL(path.join(__dirname, "..", "node_modules", "tsx", "dist", "esm", "index.mjs")).href;
const srcIndex = path.join(__dirname, "..", "Src", "index.jsx");

const result = spawnSync(process.execPath, [
  "--import", tsxPath,
  srcIndex,
  ...process.argv.slice(2),
], { stdio: "inherit" });

process.exit(result.status ?? 1);
