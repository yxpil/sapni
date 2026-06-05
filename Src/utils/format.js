// 格式化工具函数

export function isWide(cp) {
  return (cp >= 0x1100 && cp <= 0x115F) ||
    (cp >= 0x2329 && cp <= 0x232A) ||
    (cp >= 0x2E80 && cp <= 0x4DBF) ||
    (cp >= 0x4E00 && cp <= 0xA4CF) ||
    (cp >= 0xA960 && cp <= 0xA97F) ||
    (cp >= 0xAC00 && cp <= 0xD7AF) ||
    (cp >= 0xF900 && cp <= 0xFAFF) ||
    (cp >= 0xFE10 && cp <= 0xFE1F) ||
    (cp >= 0xFE30 && cp <= 0xFE6F) ||
    (cp >= 0xFF01 && cp <= 0xFF60) ||
    (cp >= 0xFFE0 && cp <= 0xFFE6) ||
    (cp >= 0x1B000 && cp <= 0x1B2FF) ||
    (cp >= 0x1F200 && cp <= 0x1F2FF) ||
    (cp >= 0x20000 && cp <= 0x2FFFF);
}

export function termLen(s) {
  let w = 0;
  for (const ch of s) w += isWide(ch.codePointAt(0)) ? 2 : 1;
  return w;
}

export function padTerm(s, n) {
  const d = n - termLen(s);
  return s + (d > 0 ? " ".repeat(d) : "");
}

const _isLegacyWin = (() => {
  try {
    if (process.platform !== "win32") return false;
    const wt = process.env.WT_SESSION || "";
    const term = (process.env.TERM || "").toLowerCase();
    const conpty = process.env.ConPTY || "";
    if (wt || term.includes("xterm") || conpty) return false;
    return true;
  } catch (_) { return false; }
})();

export const BOX = _isLegacyWin
  ? { TL: "+", TR: "+", BL: "+", BR: "+", H: "-", V: "|" }
  : { TL: "\u256d", TR: "\u256e", BL: "\u2570", BR: "\u256f", H: "\u2500", V: "\u2502" };

export function drawBox(lines, maxW) {
  try {
    const w = Math.min(maxW || 80, 80);
    const innerW = w - 4;
    const top = `${BOX.TL}${BOX.H.repeat(w - 2)}${BOX.TR}`;
    const body = (lines || []).map((l) => {
      try {
        const clean = String(l);
        const pad = Math.max(0, innerW - termLen(clean));
        return `${BOX.V}  ${clean}${" ".repeat(pad)}${BOX.V}`;
      } catch (_) { return `${BOX.V}  (err)${" ".repeat(innerW - 6)}${BOX.V}`; }
    });
    const bot = `${BOX.BL}${BOX.H.repeat(w - 2)}${BOX.BR}`;
    return [top, ...body, bot].join("\n");
  } catch (_) { return (lines || []).join("\n"); }
}

export function drawBoxTitle(title, maxW) {
  return drawBox([title], maxW);
}

export function parseToken(s) {
  const v = String(s).toLowerCase().trim();
  const m = v.match(/^(\d+(?:\.\d+)?)\s*(k|m|g)?$/);
  if (!m) return parseInt(v) || 0;
  const n = parseFloat(m[1]);
  if (m[2] === "k") return Math.round(n * 1024);
  if (m[2] === "m") return Math.round(n * 1048576);
  if (m[2] === "g") return Math.round(n * 1073741824);
  return Math.round(n);
}

export function formatToken(n) {
  if (n >= 1073741824) return (n / 1073741824).toFixed(1) + "G";
  if (n >= 1048576) return (n / 1048576).toFixed(1) + "M";
  if (n >= 1024) return Math.round(n / 1024) + "K";
  return String(n);
}

export function formatMd(text, maxW) {
  const w = maxW || 80;
  const lines = text.split("\n");
  const out = [];
  let tableBuf = [];
  let inCode = false;
  const isTR = (s) => /^\|[\s\S]+\|$/.test(s.trim());
  const isTS = (s) => /^\|[\s\-:|]+\|$/.test(s.trim());
  const isCF = (s) => s.trim().startsWith("```");

  function flush() {
    if (tableBuf.length < 2) { tableBuf = []; return; }
    const rows = tableBuf.map(r =>
      r.split("|").filter((_, i, a) => i > 0 && i < a.length - 1).map(c => c.trim())
    );
    const hd = rows[0];
    const data = rows.filter((r, i) => i > 0 && !r.every(c => /^:?-+:?$/.test(c)));
    if (!hd.length || !data.length) { tableBuf = []; return; }

    const maxCol = hd.map((c, ci) =>
      Math.max(termLen(c), ...data.map(r => termLen(r[ci] || "")))
    );
    const widths = maxCol.map(x => x + 2);
    const totalW = widths.reduce((a, b) => a + b, 0) + hd.length - 1;

    if (totalW <= w) {
      const hdrLine = "\u2500".repeat(totalW);
      out.push(hd.map((c, i) => " " + padTerm(c, widths[i] - 1)).join(" "));
      out.push(hdrLine);
      for (const row of data) {
        out.push(row.map((c, i) => " " + padTerm(c || "", widths[i] - 1)).join(" "));
      }
    } else {
      for (const row of data) {
        const parts = [];
        for (let i = 0; i < hd.length && i < row.length; i++) {
          if (row[i]) parts.push(hd[i] + ": " + row[i]);
        }
        out.push(parts.join(" \u00b7 "));
      }
    }
    tableBuf = [];
  }

  for (const line of lines) {
    if (isCF(line)) { flush(); inCode = !inCode; continue; }
    if (inCode) { out.push("  " + line); continue; }
    if (isTR(line)) { tableBuf.push(line); continue; }
    if (isTS(line) && tableBuf.length >= 1) { tableBuf.push(line); continue; }
    if (tableBuf.length) flush();
    out.push(line);
  }
  flush();
  return out.join("\n")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/^#{1,4}\s+/gm, "")
    .replace(/^>\s?/gm, "  ");
}

export function colorResult(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  let color = "gray";
  let sym = "";
  if (/error|失败|错误|eacces|eperm|enoent/i.test(lower)) { color = "red"; sym = "✗ "; }
  else if (/\[ok\]|完成|成功|created|wrote|写入|创建|已保存|passed/i.test(lower)) { color = "green"; sym = "  "; }
  else if (/deleted|删除|移除|removed/i.test(lower)) { color = "red"; sym = "✗ "; }
  else if (/modified|修改|更新|patched|changed/i.test(lower)) { color = "yellow"; sym = "~ "; }
  else if (/not found|未找到|不存在|no match/i.test(lower)) { color = "red"; sym = "? "; }
  return { text: sym + text.slice(0, 100), color };
}
