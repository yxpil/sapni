import { v4 as uuidv4 } from 'uuid';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const TOKENS_FILE = join(process.cwd(), 'api_tokens.json');

function loadTokens() {
  if (existsSync(TOKENS_FILE)) {
    try {
      const data = readFileSync(TOKENS_FILE, "utf-8");
      return JSON.parse(data);
    } catch (e) {
      return [];
    }
  }
  return [];
}

function saveTokens(tokens) {
  writeFileSync(TOKENS_FILE, JSON.stringify(tokens, null, 2));
}

const tokens = loadTokens();
const newToken = {
  id: uuidv4(),
  token: "sp_" + uuidv4().replace(/-/g, ""),
  description: "User Token",
  createdAt: new Date().toISOString(),
  lastUsed: null,
  usageCount: 0,
  permissions: ["read", "write", "execute"],
};

tokens.push(newToken);
saveTokens(tokens);

console.log("New API Token generated:");
console.log("Token:", newToken.token);
console.log("Description:", newToken.description);
console.log("Created at:", newToken.createdAt);