/**
 * 动态颜文字引擎 — 让 Sapni 的表情活起来
 * 根据时间、状态、上下文自动切换不同的颜文字
 */

// ========== 表情库 ==========
const POOLS = {
  // 状态栏/吉祥物 — 循环，每隔几秒换一个
  mascot: [
    "(｀・ω・´)",   // 认真模式
    "(◕‿◕✿)",      // 开心
    "(￣▽￣)",      // 得意
    "(๑•̀ㅂ•́)و✧",  // 干劲十足
    "( ´_ゝ`)",     // 悠闲
    "(◍•ᴗ•◍)",     // 可爱
    "(。-ω-)",      // 专注
    "( ´∀｀)",      // 满足
    "(｡･ω･｡)",     // 乖巧
    "(╯°□°)╯",     // 燃起来了(稀有)
  ],

  // 回答时 — 随机选一个
  assistant: [
    "(｀・ω・´)",   // 认真回答
    "(๑˃̵ᴗ˂̵)و",   // 兴奋
    "(◍•ᴗ•◍)",     // 可爱
    "(￣ω￣)",      // 轻松
    "( ´∀｀)",      // 满意
    "(・∀・)",      // 活泼
    "( ✧ω✧)",      // 眼睛发光
    "ᕦ(ò_óˇ)ᕤ",   // 强壮
  ],

  // 思考/流式输出时 — 专注系列
  thinking: [
    "(。-ω-)",      // 眯眼思考
    "(-ω- )",       // 思考(左)
    "(  -ω-)",      // 思考(中)
    "(´-ω-`)",      // 困倦思考
    "(。-ˍ-。)",     // 认真
    "φ(・ω・ )",    // 记笔记
    "(ˇ_ˇ” )",      // 困惑思考
  ],

  // 输入框 — 随时间切换
  prompt: [
    "( ´ ▽ ` )ﾉ",   // 欢快挥手
    "(｡･ω･)ﾉﾞ",     // 可爱挥手
    "ヾ(＾∇＾)",      // 开心
    "(　ﾟ∀ﾟ)ﾉ",     // 激动挥手
    "(*´▽｀)ﾉﾉ",    // 害羞挥手
    "ヽ(・∀・)ﾉ",    // 兴奋
    "(๑´ڡ`๑)ﾉ",    // 流口水(饿了?)
    "(´・ω・)ﾉ",     // 温柔挥手
  ],

  // 系统消息 — 各种状态
  system: [
    "◉‿◉",          // 观察
    "(・-・*)",      // 提示
    "✧(・∀・)✧",     // 通知
    "【・_・?】",     // 疑惑
    "(・∧・)",       // 确认
  ],

  // 用户 — 温暖系列
  user: [
    "(●'◡'●)ﾉ",     // 可爱
    "(｡･ω･｡)ﾉ",     // 乖巧
    "(・∀・)ﾉ",       // 活泼
    "(◕ᴗ◕✿)ﾉ",      // 温柔
    "ヽ(・∀・)ﾉ",     // 兴奋
  ],
};

// ========== 引擎 ==========

/**
 * 根据消息内容匹配颜文字
 * @param {string} text - 消息文本
 * @param {string} role - 角色: 'user'|'system'|'assistant'
 * @returns {string} 匹配的颜文字
 */
function matchFace(text, role) {
  if (!text || typeof text !== "string") return defaultForRole(role);
  const t = text.toLowerCase();

  // ====== 通用关键词 (所有角色) ======
  // 修复/修正 (必须在失败/错误之前!)
  if (/修复|fix|修正|修好|解决|debug/.test(t)) {
    return "ᕙ(⇀‸↼‶)ᕗ";  // 认真干活
  }
  // 成功/完成
  if (/成功|完成|好了|ok|pass|通过|done|搞定|正确|没问题/.test(t)) {
    return "ヽ(´▽`)ノ";  // 庆祝
  }
  // 失败/错误/报错
  if (/失败|错误|报错|挂了|不行|error|fail|出错|异常|不对|bug/.test(t)) {
    return role === "assistant" ? "(´；ω；`)" : "(╥﹏╥)";  // 难过
  }
  // 感谢/称赞
  if (/谢谢|感谢|厉害|好棒|nice|great|good|不错/.test(t)) {
    return role === "user" ? "(●'◡'●)♡" : "(◍•ᴗ•◍)♡";  // 开心感动
  }
  // 疑问/怎么
  if (/怎么|为什么|如何|啥|what|why|how|？|\?/.test(t) && text.length < 50) {
    return "(・_・?)";  // 疑惑
  }

  // ====== 用户专属关键词 ======
  if (role === "user") {
    if (/急|快|赶紧|马上|立刻|urgent|hurry/.test(t)) return "(；・∀・)ﾉ";  // 着急
    if (/搜索|搜|找|查|search|find|grep/.test(t)) return "(・ω・ )🔍";    // 搜索
    if (/写|创建|生成|新建|create|make|build/.test(t)) return "(๑•̀ㅂ•́)و✧";  // 动手
    if (/测试|试试|尝试|test|try/.test(t)) return "(｡･ω･｡)ﾉ";           // 尝试
    if (/删|删掉|移除|remove|delete|rm/.test(t)) return "(´・ω・`)";     // 小心
    if (/看|读|打开|read|cat|open|view/.test(t)) return "(◉‿◉)";        // 观察
    return pickFrom(["user"], text);
  }

  // ====== 系统专属关键词 ======
  if (role === "system") {
    if (/欢迎|hello|hi|启动/.test(t)) return "( ´ ▽ ` )ﾉ";               // 欢迎
    if (/提示|注意|提醒|warning|warn/.test(t)) return "【・_・】";         // 提醒
    if (/错误|失败|error|fail/.test(t)) return "✗(・∧・)";                // 警告
    if (/成功|完成|ok|通过/.test(t)) return "✓(・∀・)";                   // 确认
    if (/帮助|help|用法/.test(t)) return "◉‿◉";                           // 帮助
    return pickFrom(["system"], text);
  }

  // ====== 助手专属关键词 ======
  if (role === "assistant") {
    if (/搜索|search|查找|grep|find/.test(t)) return "(・ω・ )🔍";       // 搜索中
    if (/代码|函数|文件|创建|生成|写/.test(t)) return "φ(・ω・ )";        // 码农
    if (/分析|检查|review|审查/.test(t)) return "(｀・ω・´)";              // 认真
    if (/解释|说明|意思是/.test(t)) return "◉‿◉";                         // 讲解
    if (/安装|install|npm|pip/.test(t)) return "ᕙ(⇀‸↼‶)ᕗ";              // 干活
    if (/测试|运行|执行|run|test/.test(t)) return "(。-ω-)";              // 观察
    return pickFrom(["assistant"], text);
  }

  return defaultForRole(role);
}

/**
 * 角色的默认脸
 */
function defaultForRole(role) {
  if (role === "user") return "(●'◡'●)ﾉ";
  if (role === "system") return "◉‿◉";
  return "(｀・ω・´)";
}

/**
 * 从指定池取一个，用文本哈希做伪随机以保证同一消息不跳变
 */
function pickFrom(poolNames, seed) {
  const all = [];
  for (const name of poolNames) {
    if (POOLS[name]) all.push(...POOLS[name]);
  }
  if (all.length === 0) return "(・ω・)";
  // 用文本哈希做确定性选择
  let hash = 0;
  for (let i = 0; i < (seed || "").length; i++) {
    hash = ((hash << 5) - hash) + seed.charCodeAt(i);
    hash |= 0;
  }
  return all[Math.abs(hash) % all.length];
}

/**
 * 根据时间返回氛围颜文字
 */
function timeBased() {
  const h = new Date().getHours();
  if (h < 6) return "(。-ω-)zzz";   // 深夜
  if (h < 9) return "( ´ ▽ ` )ﾉ☕";  // 早晨
  if (h < 12) return "(๑•̀ㅂ•́)و✧"; // 上午干劲
  if (h < 14) return "(๑´ڡ`๑)";     // 午饭
  if (h < 18) return "( ´_ゝ`)";     // 下午摸鱼
  if (h < 21) return "ヽ(・∀・)ﾉ";   // 晚间活跃
  return "(´-ω-`)";                   // 夜猫子
}

/**
 * 状态栏更新——基于帧计数循环切换
 */
let _mascotIndex = 0;
let _mascotTimer = Date.now();
function mascotForFrame() {
  const now = Date.now();
  if (now - _mascotTimer > 8000) {  // 每 8 秒切换
    _mascotTimer = now;
    _mascotIndex = (_mascotIndex + 1) % POOLS.mascot.length;
  }
  return POOLS.mascot[_mascotIndex];
}

// 启动动画序列
const STARTUP_SEQUENCE = [
  { face: "( ´ ▽ ` )ﾉ",   ms: 0 },     // 挥手
  { face: "(｡･ω･)ﾉﾞ",     ms: 300 },   // 用力挥手
  { face: "(　ﾟ∀ﾟ)ﾉ",     ms: 600 },   // 激动挥手
  { face: "(●'◡'●)ﾉ",     ms: 900 },   // 可爱挥手
  { face: "◉‿◉",          ms: 1300 },  // 盯——  (稳定态)
];

let _startupStart = 0;
let _startupDone = false;

/**
 * 输入框颜文字 — 先播启动动画，然后根据用户输入内容匹配
 * @param {string} inputText - 当前输入框文本 (可选)
 */
function promptFace(inputText) {
  // 启动动画
  if (!_startupDone) {
    if (_startupStart === 0) _startupStart = Date.now();
    const elapsed = Date.now() - _startupStart;
    for (let i = STARTUP_SEQUENCE.length - 1; i >= 0; i--) {
      if (elapsed >= STARTUP_SEQUENCE[i].ms) {
        if (i === STARTUP_SEQUENCE.length - 1) {
          _startupDone = true;  // 动画结束，切到关键字模式
        }
        return STARTUP_SEQUENCE[i].face;
      }
    }
    return STARTUP_SEQUENCE[0].face;
  }

  // 关键字匹配 — 根据用户在输入框里正在打的内容
  if (!inputText || inputText.trim() === "") {
    return "◉‿◉";  // 空输入时呆呆看着
  }

  const t = inputText.toLowerCase();

  // 斜杠命令
  if (t.startsWith("/")) {
    if (/help|帮助/.test(t)) return "(・ω・ )?";
    if (/exit|退出/.test(t)) return "(´・ω・`)ﾉ~~";
    if (/clear|reset/.test(t)) return "(。-ω-)";
    if (/status|ctx/.test(t)) return "(。-ˍ-。)";
    return "(  -ω-)";  // 输入命令中
  }

  // 用户输入内容
  if (/急|快|赶紧|马上/.test(t)) return "(；・∀・)";
  if (/谢谢|感谢|thx/.test(t)) return "(●'◡'●)♡";
  if (/怎么写|怎么搞|怎么弄|怎么办|求助/.test(t)) return "(´；ω；`)";
  if (/搜|找|查|search|find|grep/.test(t)) return "(・ω・ )🔍";
  if (/写|创建|生成|新建|create|make/.test(t)) return "(๑•̀ㅂ•́)و✧";
  if (/改|修|fix|修复|优化|refactor/.test(t)) return "ᕙ(⇀‸↼‶)ᕗ";
  if (/删|删掉|移除|delete|rm/.test(t)) return "(´・ω・`)";
  if (/测|试|test|try/.test(t)) return "(｡･ω･｡)";
  if (/看|读|打开|view|read|cat/.test(t)) return "◉‿◉";
  if (/\?|？|为什么|怎么|啥|what|why/.test(t)) return "(・_・?)";
  if (/好|ok|行|可以|yes/.test(t)) return "(◍•ᴗ•◍)";
  if (t.length > 50) return "(｀・ω・´)";  // 长篇大论——认真模式

  // 默认：打字中
  return "(。-ω-)";
}

module.exports = {
  POOLS,
  matchFace,
  defaultForRole,
  mascotForFrame,
  promptFace,
  timeBased,
};
