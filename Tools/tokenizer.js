const fs = require("fs");
const path = require("path");

let _wordFreq = {};
let _totalFreq = 0;
const _MIN_FREQ = 1;
let _maxWordLen = 6;

function _loadConfigWords() {
  try {
    const configPath = path.join(__dirname, "..", "config.json");
    const cfg = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    const tz = cfg.tokenizer || {};
    _maxWordLen = tz.maxWordLen || 6;
    return tz.commonWords || [];
  } catch (_) {
    return [];
  }
}

let _commonWords = _loadConfigWords();

function _initBaseDict() {
  _wordFreq = {};
  for (const w of _commonWords) {
    _wordFreq[w] = (_wordFreq[w] || 0) + 3;
  }
  _totalFreq = Object.values(_wordFreq).reduce((a, b) => a + b, 0);
}

_initBaseDict();

function reloadConfig() {
  _commonWords = _loadConfigWords();
  _initBaseDict();
}

function buildDictFromKeywords(keywordsList) {
  _initBaseDict();
  for (const kws of keywordsList) {
    for (const kw of kws) {
      if (kw.length < 2) continue;
      _wordFreq[kw] = (_wordFreq[kw] || 0) + 10;
    }
  }
  _totalFreq = Object.values(_wordFreq).reduce((a, b) => a + b, 0);
}

function _getFreq(word) {
  return _wordFreq[word] || _MIN_FREQ;
}

function _buildDAG(text) {
  const dag = {};
  const n = text.length;
  for (let i = 0; i < n; i++) {
    dag[i] = [];
    let candidate = "";
    for (let j = i; j < n && j - i < _maxWordLen; j++) {
      candidate += text[j];
      if (_wordFreq[candidate]) {
        dag[i].push(j);
      }
    }
    if (dag[i].length === 0) {
      dag[i].push(i);
    }
  }
  return dag;
}

function _calcRoute(text, dag) {
  const n = text.length;
  const route = {};
  route[n] = { freq: 0, next: null };

  function logProb(word) {
    const f = _getFreq(word);
    return Math.log(f > 0 ? f : _MIN_FREQ) - Math.log(_totalFreq);
  }

  for (let i = n - 1; i >= 0; i--) {
    let bestFreq = -Infinity;
    let bestEnd = i;
    for (const j of dag[i]) {
      const word = text.slice(i, j + 1);
      const score = logProb(word) + route[j + 1].freq;
      if (score > bestFreq) {
        bestFreq = score;
        bestEnd = j;
      }
    }
    route[i] = { freq: bestFreq, next: bestEnd };
  }

  return route;
}

function _cutByRoute(text, route) {
  const words = [];
  let i = 0;
  while (i < text.length) {
    const end = route[i].next;
    words.push(text.slice(i, end + 1));
    i = end + 1;
  }
  return words;
}

function segment(text) {
  if (!text) return [];

  const tokens = [];
  let buf = "";
  let isChinese = null;

  for (const ch of text) {
    const isCh = /[\u4e00-\u9fa5]/.test(ch);
    if (isChinese === null) {
      isChinese = isCh;
      buf = ch;
    } else if (isCh === isChinese) {
      buf += ch;
    } else {
      if (isChinese) {
        const dag = _buildDAG(buf);
        const route = _calcRoute(buf, dag);
        tokens.push(..._cutByRoute(buf, route));
      } else {
        tokens.push(...buf.split(/[\s,，。.!！?？;；:：、\-\–—/\\|]+/).filter(Boolean));
      }
      buf = ch;
      isChinese = isCh;
    }
  }

  if (buf) {
    if (isChinese) {
      const dag = _buildDAG(buf);
      const route = _calcRoute(buf, dag);
      tokens.push(..._cutByRoute(buf, route));
    } else {
      tokens.push(...buf.split(/[\s,，。.!！?？;；:：、\-\–—/\\|]+/).filter(Boolean));
    }
  }

  return tokens.filter((t) => t.length >= 1);
}

module.exports = { segment, buildDictFromKeywords, reloadConfig };
