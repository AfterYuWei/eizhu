import type { AiConnection } from '@eizhu/contracts'

// 仅作为可编辑的配置模板；模型由用户填写或通过模型发现获取。
export const aiProviderPresets: ReadonlyArray<
  Pick<AiConnection, 'name' | 'protocol' | 'endpoint'> & { key: string }
> = [
  { key: 'openai', name: 'OpenAI', protocol: 'responses', endpoint: 'https://api.openai.com/v1' },
  {
    key: 'anthropic',
    name: 'Anthropic（Claude）',
    protocol: 'anthropic',
    endpoint: 'https://api.anthropic.com/v1',
  },
  { key: 'deepseek', name: 'DeepSeek', protocol: 'chat', endpoint: 'https://api.deepseek.com' },
  {
    key: 'qwen',
    name: '阿里云百炼（通义千问）',
    protocol: 'chat',
    endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  },
  { key: 'siliconflow', name: '硅基流动', protocol: 'chat', endpoint: 'https://api.siliconflow.cn/v1' },
  { key: 'moonshot', name: 'Moonshot（Kimi）', protocol: 'chat', endpoint: 'https://api.moonshot.cn/v1' },
  { key: 'zhipu', name: '智谱AI（GLM）', protocol: 'chat', endpoint: 'https://open.bigmodel.cn/api/paas/v4' },
  {
    key: 'volcengine',
    name: '火山方舟（豆包）',
    protocol: 'chat',
    endpoint: 'https://ark.cn-beijing.volces.com/api/v3',
  },
  {
    key: 'gemini',
    name: 'Google Gemini',
    protocol: 'chat',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai',
  },
  { key: 'openrouter', name: 'OpenRouter', protocol: 'chat', endpoint: 'https://openrouter.ai/api/v1' },
  { key: 'ollama', name: 'Ollama（本地）', protocol: 'chat', endpoint: 'http://localhost:11434/v1' },
]
