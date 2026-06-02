const fs = require("fs");
const path = require("path");
const os = require("os");

const MEM_DIR = path.join(os.homedir(), ".sapni", "mem");
const PERSIST_FILE = path.join(MEM_DIR, "persistent-memory.json");

function _ensureDir() {
  if (!fs.existsSync(MEM_DIR)) fs.mkdirSync(MEM_DIR, { recursive: true });
}

function _loadPersist() {
  _ensureDir();
  try {
    if (!fs.existsSync(PERSIST_FILE)) return [];
    const raw = fs.readFileSync(PERSIST_FILE, "utf-8");
    if (!raw.trim()) return [];
    return JSON.parse(raw);
  } catch (_) {
    return [];
  }
}

function _savePersist(entries) {
  _ensureDir();
  try {
    const clean = entries
      .slice(-500)
      .map(({ id, text, tags, createdAt }) => ({
        id,
        time: new Date(createdAt).toISOString(),
        content: text.slice(0, 300),
        tags: tags || [],
      }));
    fs.writeFileSync(PERSIST_FILE, JSON.stringify(clean, null, 2), "utf-8");
  } catch (_) {}
}

class ConversationMemory {
  constructor(options = {}) {
    this.maxHistory = options.maxHistory || 30;
    this.maxEntries = options.maxEntries || 800;
    this.maxEntryChars = options.maxEntryChars || 200;
    this.history = [];

    // ROM: 持久化记忆 (落盘)
    this.romEntries = [];
    // RAM: 会话记忆 (仅本次窗口)
    this.ramEntries = [];
    this._idCounter = 0;

    // 从磁盘加载 ROM
    const persisted = _loadPersist();
    for (const p of persisted) {
      this.romEntries.push({
        id: ++this._idCounter,
        text: p.content || "",
        tags: p.tags || [],
        createdAt: p.time ? new Date(p.time).getTime() : Date.now(),
      });
    }
    if (this.romEntries.length > this.maxEntries) {
      this.romEntries = this.romEntries.slice(-this.maxEntries);
    }
  }

  addUser(content) {
    this.history.push({ role: "user", content });
    this._trimHistory();
  }

  addAssistant(content) {
    this.history.push({ role: "assistant", content });
    this._trimHistory();
  }

  getHistory() {
    return [...this.history];
  }

  _trimHistory() {
    while (this.history.length > this.maxHistory * 2) {
      this.history.shift();
    }
  }

  setMaxHistory(n) {
    this.maxHistory = Math.max(2, Math.min(n, 200));
  }

  // ── ROM (永久保存, 落盘) ──

  addRomEntry(content, tags = []) {
    const text = String(content).slice(0, this.maxEntryChars);
    if (!text.trim()) return null;
    const entry = {
      id: ++this._idCounter,
      text,
      tags,
      createdAt: Date.now(),
    };
    this.romEntries.push(entry);
    if (this.romEntries.length > this.maxEntries) {
      this.romEntries.shift();
    }
    _savePersist(this.romEntries);
    return entry;
  }

  // ── RAM (本次窗口, 不落盘) ──

  addRamEntry(content, tags = []) {
    const text = String(content).slice(0, this.maxEntryChars);
    if (!text.trim()) return null;
    const entry = {
      id: ++this._idCounter,
      text,
      tags,
      createdAt: Date.now(),
    };
    this.ramEntries.push(entry);
    if (this.ramEntries.length > this.maxEntries) {
      this.ramEntries.shift();
    }
    return entry;
  }

  // ── 搜索 (搜 ROM + RAM) ──

  searchEntries(query, limit = 5) {
    const all = [
      ...this.romEntries.map(e => ({ ...e, _type: "rom" })),
      ...this.ramEntries.map(e => ({ ...e, _type: "ram" })),
    ];
    if (!query || !query.trim()) return all.slice(-limit);
    const q = query.toLowerCase();
    const scored = all.map((e) => {
      const lower = e.text.toLowerCase();
      let score = 0;
      if (lower === q) score = 100;
      else if (lower.includes(q)) score = 80;
      else {
        const words = q.split(/\s+/);
        for (const w of words) {
          if (w && lower.includes(w)) score += 20;
        }
      }
      const tagMatch = e.tags.some((t) => t.toLowerCase().includes(q));
      if (tagMatch) score += 30;
      return { entry: e, score };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored.filter((s) => s.score > 0).slice(0, limit).map((s) => s.entry);
  }

  getAllEntries() {
    return [
      ...this.romEntries.map(e => ({ ...e, _type: "rom" })),
      ...this.ramEntries.map(e => ({ ...e, _type: "ram" })),
    ];
  }

  getEntryCount() {
    return this.romEntries.length + this.ramEntries.length;
  }

  // ── 删除 (搜 ROM + RAM) ──

  removeEntry(id) {
    let idx = this.romEntries.findIndex((e) => e.id === id);
    if (idx !== -1) {
      this.romEntries.splice(idx, 1);
      _savePersist(this.romEntries);
      return true;
    }
    idx = this.ramEntries.findIndex((e) => e.id === id);
    if (idx !== -1) {
      this.ramEntries.splice(idx, 1);
      return true;
    }
    return false;
  }

  // ── 清空 ──

  clearRamEntries() {
    this.ramEntries = [];
  }

  clearRomEntries() {
    this.romEntries = [];
    _savePersist(this.romEntries);
  }

  clearAllEntries() {
    this.romEntries = [];
    this.ramEntries = [];
    _savePersist(this.romEntries);
  }

  compressHistory(agentInstance) {
    if (this.history.length < 4) return null;
    const content = this.history.map((m) => `[${m.role}]: ${m.content}`).join("\n");
    return content;
  }

  clear() {
    this.history = [];
  }

  stats() {
    return {
      historyMessages: this.history.length,
      romEntries: this.romEntries.length,
      ramEntries: this.ramEntries.length,
      entries: this.romEntries.length + this.ramEntries.length,
      maxEntries: this.maxEntries,
    };
  }
}

module.exports = { ConversationMemory };
