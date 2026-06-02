const fs = require("fs");
const path = require("path");

let _puppeteer = null;
let _chromePath = null;

function _getChromePath() {
  if (_chromePath) return _chromePath;
  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) { _chromePath = c; return c; }
  }
  return null;
}

function _getPuppeteer() {
  if (_puppeteer) return _puppeteer;
  try {
    _puppeteer = require("puppeteer-core");
    return _puppeteer;
  } catch (_) {
    return null;
  }
}

let _browserPromise = null;
let _browser = null;

async function _ensureBrowser() {
  if (_browser && _browser.connected) return _browser;
  const pp = _getPuppeteer();
  if (!pp) throw new Error("puppeteer-core 未安装, 请运行 npm install puppeteer-core");
  const chromePath = _getChromePath();
  if (!chromePath) throw new Error("未找到 Chrome/Chromium 浏览器");
  if (!_browserPromise) {
    _browserPromise = pp.launch({
      executablePath: chromePath,
      headless: "new",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-web-security",
        "--disable-features=IsolateOrigins,site-per-process",
      ],
    });
  }
  _browser = await _browserPromise;
  return _browser;
}

async function _extractText(page) {
  return page.evaluate(() => {
    document.querySelectorAll("script, style, noscript, iframe, nav, footer, header, aside").forEach((el) => el.remove());
    return (document.body?.innerText || "").replace(/\n{3,}/g, "\n\n").trim();
  });
}

const browsePageTool = {
  name: "browse_page",
  description: "用真实浏览器(Chrome无头模式)打开网页并提取文字内容. 能绕过反爬、执行JS渲染的SPA页面",
  parameters: {
    url: { type: "string", required: true, description: "要打开的URL" },
    waitMs: { type: "number", required: false, description: "页面加载后额外等待毫秒, 默认2000" },
    extractLinks: { type: "boolean", required: false, description: "是否同时提取链接, 默认false" },
  },
  execute: async ({ url, waitMs, extractLinks }) => {
    const start = Date.now();
    let page = null;
    try {
      const browser = await _ensureBrowser();
      page = await browser.newPage();
      await page.setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36");
      await page.setViewport({ width: 1280, height: 800 });
      await page.setRequestInterception(true);
      const blockedTypes = new Set(["image", "media", "font", "stylesheet"]);
      page.on("request", (req) => {
        if (blockedTypes.has(req.resourceType())) req.abort();
        else req.continue();
      });

      const wait = waitMs != null ? waitMs : 2000;
      await page.goto(url, { waitUntil: "networkidle2", timeout: 20000 });
      await new Promise((r) => setTimeout(r, wait));

      const title = await page.title();
      const text = await _extractText(page);
      const ms = Date.now() - start;

      let result = `[浏览器 ${ms}ms] ${title}\n\n${text.slice(0, 4000)}`;

      if (extractLinks) {
        const links = await page.evaluate(() =>
          [...document.querySelectorAll("a[href]")].map((a) => a.href).filter((h) => h.startsWith("http"))
        );
        const unique = [...new Set(links)].slice(0, 30);
        result += `\n\n[链接 ${unique.length} 个]\n${unique.join("\n")}`;
      }

      await page.close();
      return result;
    } catch (e) {
      if (page) await page.close().catch(() => {});
      return `[浏览器失败 ${Date.now() - start}ms] ${e.message}`;
    }
  },
};

const browsePageTextTool = {
  name: "browse_page_text",
  description: "用浏览器打开网页, 只提取主体文字(自动过滤导航/页脚/脚本), 返回干净文本",
  parameters: {
    url: { type: "string", required: true, description: "要打开的URL" },
    waitMs: { type: "number", required: false, description: "额外等待毫秒, 默认2000" },
  },
  execute: async ({ url, waitMs }) => {
    return browsePageTool.execute({ url, waitMs, extractLinks: false });
  },
};

module.exports = {
  browse_page: browsePageTool,
  browse_page_text: browsePageTextTool,
};
