// 主流 LLM 提供商预设配置
// 用户通过 /provider 一键选择 + 输入 API Key 即可

const PRESETS = [
  {
    id: "moonshot",
    name: "月之暗面 (MoonShot)",
    baseURL: "https://api.moonshot.cn/v1",
    models: [
      { id: "kimi-k2.6", desc: "旗舰推理模型 (256K ctx, 支持图片/视频)" },
      { id: "kimi-k2.5", desc: "推理模型 (256K ctx)" },
      { id: "moonshot-v1-128k", desc: "通用模型 (128K ctx)" },
      { id: "moonshot-v1-32k", desc: "通用模型 (32K ctx)" },
    ],
    defaultModel: "kimi-k2.6",
    temperature: 1,
    topP: 0.95,
    contextWindow: 262144,
    note: "国内直连, 长上下文强",
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    baseURL: "https://api.deepseek.com/v1",
    models: [
      { id: "deepseek-chat", desc: "V3 对话模型 (1M ctx, 性价比高)" },
      { id: "deepseek-reasoner", desc: "R1 推理模型 (1M ctx)" },
      { id: "deepseek-v4-pro", desc: "V4 Pro" },
      { id: "deepseek-v4-flash", desc: "V4 Flash (快速)" },
    ],
    defaultModel: "deepseek-chat",
    temperature: 0.7,
    topP: 0.9,
    contextWindow: 1048576,
    note: "国内可用, 性价比之王",
  },
  {
    id: "openai",
    name: "OpenAI",
    baseURL: "https://api.openai.com/v1",
    models: [
      { id: "gpt-4o", desc: "GPT-4o (旗舰)" },
      { id: "gpt-4o-mini", desc: "GPT-4o-mini (性价比)" },
      { id: "o3-mini", desc: "o3-mini (推理)" },
    ],
    defaultModel: "gpt-4o-mini",
    temperature: 0.7,
    topP: 0.9,
    contextWindow: 128000,
    note: "需海外网络/代理, 质量最高",
  },
  {
    id: "anthropic",
    name: "Anthropic (Claude)",
    baseURL: "https://api.anthropic.com/v1",
    models: [
      { id: "claude-sonnet-4-20250514", desc: "Claude Sonnet 4 (旗舰)" },
      { id: "claude-haiku-3-5-20241022", desc: "Claude Haiku 3.5 (快速)" },
    ],
    defaultModel: "claude-sonnet-4-20250514",
    temperature: 0.7,
    topP: 0.9,
    contextWindow: 200000,
    note: "需海外网络, 编程能力强",
  },
  {
    id: "google",
    name: "Google (Gemini)",
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
    models: [
      { id: "gemini-2.5-pro-exp-03-25", desc: "Gemini 2.5 Pro (旗舰)" },
      { id: "gemini-2.0-flash", desc: "Gemini 2.0 Flash (快速)" },
    ],
    defaultModel: "gemini-2.5-pro-exp-03-25",
    temperature: 0.7,
    topP: 0.9,
    contextWindow: 1048576,
    note: "需海外网络, 长上下文",
  },
  {
    id: "github",
    name: "GitHub (Copilot Models)",
    baseURL: "https://models.inference.ai.azure.com",
    models: [
      { id: "gpt-4o", desc: "GPT-4o (免费额度)" },
      { id: "gpt-4o-mini", desc: "GPT-4o-mini (免费)" },
      { id: "o3-mini", desc: "o3-mini (免费额度)" },
    ],
    defaultModel: "gpt-4o-mini",
    temperature: 0.7,
    topP: 0.9,
    contextWindow: 128000,
    note: "GitHub Copilot 子, 免费额度",
  },
  {
    id: "siliconflow",
    name: "硅基流动 (SiliconFlow)",
    baseURL: "https://api.siliconflow.cn/v1",
    models: [
      { id: "deepseek-ai/DeepSeek-V3", desc: "DeepSeek V3" },
      { id: "deepseek-ai/DeepSeek-R1", desc: "DeepSeek R1" },
      { id: "Qwen/Qwen2.5-72B-Instruct", desc: "Qwen2.5-72B" },
    ],
    defaultModel: "deepseek-ai/DeepSeek-V3",
    temperature: 0.7,
    topP: 0.9,
    contextWindow: 131072,
    note: "国内可用, 聚合多家模型",
  },
  {
    id: "custom",
    name: "自定义 (Custom)",
    baseURL: "https://",
    models: [
      { id: "", desc: "手动输入模型名" },
    ],
    defaultModel: "",
    temperature: 0.7,
    topP: 0.9,
    contextWindow: 65536,
    note: "手动配置所有参数",
  },
];

/**
 * 生成 provider 选择菜单文本（非交互式, 纯文本输出）
 */
function formatProviderMenu() {
  const lines = [];
  PRESETS.forEach((p, i) => {
    lines.push(`  ${String(i + 1).padEnd(3)} ${p.name}`);
    lines.push(`      ${p.note}`);
    lines.push(`      URL: ${p.baseURL}`);
  });
  return lines.join("\n");
}

/**
 * 生成某个 provider 的模型选择文本
 */
function formatModelMenu(providerIndex) {
  const p = PRESETS[providerIndex];
  if (!p) return "无效选择";
  return p.models.map((m, i) =>
    `  ${String(i + 1).padEnd(3)} ${m.id}  — ${m.desc}`
  ).join("\n");
}

/**
 * 根据 provider index + model index 应用预设到 config
 */
function applyPreset(config, providerIndex, modelIndex) {
  const p = PRESETS[providerIndex];
  if (!p) return { error: "无效提供商" };

  const m = p.models[modelIndex] || p.models[0];

  config.llm.provider = p.id;
  config.llm.baseURL = p.baseURL;
  config.llm.model = m.id || "";
  config.llm.temperature = p.temperature;
  config.llm.topP = p.topP;
  config.llm.contextWindow = p.contextWindow;

  return { provider: p, model: m };
}

module.exports = {
  PRESETS,
  formatProviderMenu,
  formatModelMenu,
  applyPreset,
};
