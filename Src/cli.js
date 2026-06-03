#!/usr/bin/env node
import { parseArgs } from "util";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const configPath = join(__dirname, "..", "config.json");
let CONFIG = {};
try {
  CONFIG = JSON.parse(readFileSync(configPath, "utf-8"));
} catch (e) {
  // Config not found, use defaults
}

const defaultPort = CONFIG.api?.port || 27262;

const options = {
  server: {
    type: "boolean",
    short: "s",
    default: false,
    description: "Start API server only",
  },
  port: {
    type: "string",
    short: "p",
    default: String(defaultPort),
    description: "API server port",
  },
  help: {
    type: "boolean",
    short: "h",
    default: false,
    description: "Show help",
  },
};

// Handle -server as --server
const args = process.argv.slice(2).map(arg => {
  if (arg === "-server") return "--server";
  return arg;
});

const { values, positionals } = parseArgs({ options, args, allowPositionals: true });

if (values.help) {
  console.log(`
Sapni AI - Terminal AI Assistant

Usage: sapni [options]

Options:
  -s, --server      Start API server only
  -p, --port <port>  Set API server port (default: ${defaultPort} from config)
  -h, --help        Show this help message

Examples:
  sapni              Start interactive terminal
  sapni -s           Start API server on port ${defaultPort}
  sapni -s -p 8080   Start API server on port 8080

Config: Edit config.json to change default port:
  "api": { "port": 27262 }
  `);
  process.exit(0);
}

if (values.server) {
  import("./api/server.js").then(async (server) => {
    try {
      await server.startServer(parseInt(values.port));
    } catch (err) {
      console.error("Failed to start server:", err.message);
      process.exit(1);
    }
  });
} else {
  import("./index.jsx").catch(err => {
    console.error("Failed to start terminal:", err.message);
    process.exit(1);
  });
}
