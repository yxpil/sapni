const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");

const MEM_DIR = path.join(os.homedir(), ".sapni", "mem");
const SESSIONS_FILE = path.join(MEM_DIR, "sessions.json");

// ─── helpers ──────────────────────────────────────────────

function ensureDir() {
  if (!fs.existsSync(MEM_DIR)) fs.mkdirSync(MEM_DIR, { recursive: true });
}

function todayFile() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return path.join(MEM_DIR, `history-${yyyy}-${mm}-${dd}.json`);
}

function loadFile(filePath) {
  if (!fs.existsSync(filePath)) return [];
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    if (!raw.trim()) return [];
    return JSON.parse(raw);
  } catch (_) {
    return [];
  }
}

function saveFile(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

function loadSessions() {
  ensureDir();
  const data = loadFile(SESSIONS_FILE);
  return data.sessions || {};
}

function saveSessions(sessions) {
  saveFile(SESSIONS_FILE, { sessions });
}

/** generate a short session id: timestamp + random hex */
function genSessionId() {
  return Date.now().toString(36) + "-" + crypto.randomBytes(3).toString("hex");
}

// ─── session management ───────────────────────────────────

/** Start a new session. Called on sapni startup and /new. */
function startSession() {
  const sessions = loadSessions();

  // mark any previously active session as ended
  for (const [id, s] of Object.entries(sessions)) {
    if (s.status === "active") {
      s.status = "ended";
      s.ended = new Date().toISOString();
    }
  }

  const id = genSessionId();
  sessions[id] = {
    id,
    started: new Date().toISOString(),
    ended: null,
    turnCount: 0,
    title: null,
    firstMessage: null,
    status: "active",
  };
  saveSessions(sessions);
  return id;
}

/** End the current session. */
function endSession(sessionId) {
  if (!sessionId) return;
  const sessions = loadSessions();
  const s = sessions[sessionId];
  if (s && s.status === "active") {
    s.status = "ended";
    s.ended = new Date().toISOString();
    saveSessions(sessions);
  }
}

/** Update session metadata after each turn. */
function _updateSessionMeta(sessionId, userMessage) {
  const sessions = loadSessions();
  const s = sessions[sessionId];
  if (!s) return;
  s.turnCount = (s.turnCount || 0) + 1;
  if (!s.title && userMessage) {
    s.title = userMessage.slice(0, 80);
    s.firstMessage = userMessage;
  }
  saveSessions(sessions);
}

// ─── turn saving (backward-compat: sessionId optional) ─────

function saveTurn(userMessage, assistantResponse, cwd, allMessages, sessionId) {
  ensureDir();
  const file = todayFile();
  const records = loadFile(file);
  records.push({
    id: Date.now(),
    time: new Date().toISOString(),
    cwd: cwd || process.cwd(),
    user: userMessage,
    assistant: assistantResponse,
    messages: allMessages || [],
    sessionId: sessionId || null,
  });
  saveFile(file, records);

  if (sessionId) _updateSessionMeta(sessionId, userMessage);
}

// ─── listing / browsing ────────────────────────────────────

function listHistoryFiles() {
  ensureDir();
  try {
    return fs.readdirSync(MEM_DIR)
      .filter((f) => f.startsWith("history-") && f.endsWith(".json"))
      .sort()
      .reverse();
  } catch (_) {
    return [];
  }
}

function getFileList() {
  const files = listHistoryFiles();
  return files.map((f) => {
    const filePath = path.join(MEM_DIR, f);
    const records = loadFile(filePath);
    const stat = fs.statSync(filePath);
    return {
      file: f,
      turns: records.length,
      size: Math.round(stat.size / 1024),
      created: stat.birthtime.toISOString(),
    };
  });
}

function listRecentTurns(limit = 20) {
  const files = listHistoryFiles();
  const turns = [];
  for (const file of files) {
    const records = loadFile(path.join(MEM_DIR, file));
    for (let i = records.length - 1; i >= 0; i--) {
      turns.push({ ...records[i], file });
      if (turns.length >= limit) return turns;
    }
  }
  return turns;
}

function loadFileTurns(fileName, limit = 50) {
  const filePath = path.join(MEM_DIR, fileName);
  const records = loadFile(filePath);
  return records.slice(-limit);
}

// ─── session listing ──────────────────────────────────────

/** List sessions ordered by start time (newest first). */
function listSessions(limit = 20) {
  const sessions = loadSessions();
  return Object.values(sessions)
    .sort((a, b) => new Date(b.started) - new Date(a.started))
    .slice(0, limit);
}

/** Get a single session by id. */
function getSession(sessionId) {
  const sessions = loadSessions();
  return sessions[sessionId] || null;
}

/** Load all turns belonging to a session (from all history files). */
function loadSessionTurns(sessionId, maxTurns = 200) {
  const files = listHistoryFiles();
  const turns = [];
  for (const file of files) {
    const records = loadFile(path.join(MEM_DIR, file));
    for (const r of records) {
      if (r.sessionId === sessionId) {
        turns.push({ ...r, file });
      }
    }
  }
  turns.sort((a, b) => a.id - b.id);
  return turns.length > maxTurns ? turns.slice(-maxTurns) : turns;
}

// ─── enhanced search ──────────────────────────────────────

/**
 * Score a text against a query. Tokens get partial match scores.
 * Returns 0 if no match.
 */
function _scoreText(text, queryLower, queryTokens) {
  if (!text) return 0;
  const lower = text.toLowerCase();
  let score = 0;
  // exact phrase match
  if (lower.includes(queryLower)) score += 50;
  // token match
  for (const tok of queryTokens) {
    if (tok && lower.includes(tok)) score += 15;
  }
  // full exact match (highest)
  if (lower === queryLower) score = 100;
  return score;
}

/**
 * Search turns across history files with relevance scoring.
 * Returns matches with surrounding context.
 */
function searchHistory(query, limit = 10) {
  const files = listHistoryFiles();
  const results = [];
  const q = query.toLowerCase();
  const tokens = q.split(/\s+/).filter(Boolean);

  for (const file of files) {
    if (results.length >= limit * 3) break; // buffer for scoring
    const records = loadFile(path.join(MEM_DIR, file));
    for (let i = records.length - 1; i >= 0; i--) {
      const r = records[i];
      const userScore = _scoreText(r.user || "", q, tokens);
      const asstScore = _scoreText(r.assistant || "", q, tokens);
      const msgScore = _scoreText(JSON.stringify(r.messages || []), q, tokens);
      const totalScore = Math.max(userScore, asstScore, msgScore);

      if (totalScore > 0) {
        results.push({
          file,
          cwd: r.cwd || "",
          user: r.user ? r.user.slice(0, 200) : "",
          assistant: r.assistant ? r.assistant.slice(0, 300) : "",
          time: r.time,
          sessionId: r.sessionId || null,
          score: totalScore,
        });
      }
    }
  }

  // sort by score desc then time desc
  results.sort((a, b) => b.score - a.score || b.time.localeCompare(a.time));
  return results.slice(0, limit);
}

/**
 * Search sessions by keyword (title + first message).
 * Returns ranked sessions.
 */
function searchSessions(query, limit = 10) {
  const sessions = listSessions(500);
  const q = query.toLowerCase();
  const tokens = q.split(/\s+/).filter(Boolean);

  const scored = sessions.map((s) => {
    const titleScore = _scoreText(s.title || "", q, tokens);
    const firstMsgScore = _scoreText(s.firstMessage || "", q, tokens);
    const totalScore = Math.max(titleScore, firstMsgScore);
    return { session: s, score: totalScore };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.session);
}

/**
 * Full-text search with context: return matched turns + session info.
 * Best for "what did we talk about X" queries.
 */
function searchHistoryWithContext(query, limit = 10) {
  const matches = searchHistory(query, limit);
  const sessions = loadSessions();

  return matches.map((m) => {
    const session = m.sessionId ? sessions[m.sessionId] : null;
    return {
      ...m,
      sessionTitle: session ? session.title : "(旧记录, 无 session)",
      sessionStarted: session ? session.started : null,
    };
  });
}

/**
 * Global full-text search that scans raw history JSON files
 * and returns results organized by session.
 */
function globalSearch(query, limit = 10) {
  const files = listHistoryFiles();
  const q = query.toLowerCase();
  const tokens = q.split(/\s+/).filter(Boolean);
  const sessions = loadSessions();
  const bySession = {};

  for (const file of files) {
    const records = loadFile(path.join(MEM_DIR, file));
    for (let i = 0; i < records.length; i++) {
      const r = records[i];
      const raw = JSON.stringify(r).toLowerCase();
      const score = _scoreText(raw, q, tokens);

      if (score > 0) {
        const sid = r.sessionId || "legacy";
        if (!bySession[sid]) {
          const s = sessions[sid];
          bySession[sid] = {
            sessionId: sid,
            sessionTitle: s ? s.title : (sid === "legacy" ? "(旧记录)" : "(未知)"),
            sessionStarted: s ? s.started : null,
            totalScore: 0,
            matchCount: 0,
            topMatches: [],
          };
        }
        const grp = bySession[sid];
        grp.totalScore += score;
        grp.matchCount++;
        if (grp.topMatches.length < 3) {
          grp.topMatches.push({
            time: r.time,
            user: r.user ? r.user.slice(0, 120) : "",
            file,
          });
        }
      }
    }
  }

  return Object.values(bySession)
    .sort((a, b) => b.totalScore - a.totalScore)
    .slice(0, limit);
}

// ─── migration: add sessionId to old records ───────────────

/**
 * Migrate legacy turns (without sessionId) — assigns a synthetic
 * session per file to keep searches working.
 */
function migrateLegacySessions() {
  const sessions = loadSessions();
  const files = listHistoryFiles();
  let migrated = 0;

  for (const file of files) {
    const filePath = path.join(MEM_DIR, file);
    const records = loadFile(filePath);
    let needsSave = false;

    // gather turns that need a sessionId
    const legacyNeeding = records.filter((r) => !r.sessionId);
    if (legacyNeeding.length === 0) continue;

    // assign a per-file synthetic session
    const fakeId = "migrated-" + file.replace("history-", "").replace(".json", "");
    if (!sessions[fakeId]) {
      sessions[fakeId] = {
        id: fakeId,
        started: legacyNeeding[0].time,
        ended: legacyNeeding[legacyNeeding.length - 1].time,
        turnCount: legacyNeeding.length,
        title: legacyNeeding[0].user ? legacyNeeding[0].user.slice(0, 80) : "(旧记录)",
        firstMessage: legacyNeeding[0].user || "",
        status: "ended",
      };
    }

    for (const r of records) {
      if (!r.sessionId) {
        r.sessionId = fakeId;
        needsSave = true;
        migrated++;
      }
    }

    if (needsSave) saveFile(filePath, records);
  }

  if (migrated > 0) saveSessions(sessions);
  return migrated;
}

// ─── exports ───────────────────────────────────────────────

module.exports = {
  // turn-level
  saveTurn,
  listRecentTurns,
  searchHistory,
  searchHistoryWithContext,
  getFileList,
  loadFileTurns,
  listHistoryFiles,

  // session-level (NEW)
  startSession,
  endSession,
  listSessions,
  getSession,
  loadSessionTurns,
  searchSessions,
  globalSearch,

  // migration
  migrateLegacySessions,

  // paths
  MEM_DIR,
};
