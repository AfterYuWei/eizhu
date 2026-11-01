import { useEffect, useState } from 'react'
import type { AiCapabilities, AiSettings } from '@eizhu/contracts'
import { aiPreferencesSchema } from '@eizhu/contracts'
import { bridge } from '@/lib/bridge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import '../Agent/ai.css'

export function AiPanel() {
  const [settings, setSettings] = useState<AiSettings | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [capabilities, setCapabilities] = useState<AiCapabilities | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let live = true
    void bridge()
      .ai.settings()
      .then(
        (v) => {
          if (live) setSettings(v)
        },
        (e) => {
          if (live) setMessage(e.message)
        },
      )
    return () => {
      live = false
    }
  }, [])
  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    setMessage('')
    try {
      await action()
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '操作失败')
    } finally {
      setBusy(false)
    }
  }
  const save = async () => {
    if (!settings) return
    const result = await bridge().ai.configure({
      ...aiPreferencesSchema.strip().parse(settings),
      ...(apiKey ? { apiKey } : {}),
    })
    setSettings(result)
    setApiKey('')
    setMessage('AI 设置已保存。切换模型后请新建对话。')
  }
  return (
    <div className="settings-section ai-settings">
      <div className="settings-section-title">AI 助手</div>
      <p className="settings-field-desc">每条命令均需确认。对话在当前空间本地加密保存，不参与同步或备份。</p>
      {settings && (
        <div className="settings-card">
          <div className="settings-field">
            <Label htmlFor="ai-source">模型来源</Label>
            <select
              id="ai-source"
              value={settings.source}
              disabled={busy}
              onChange={(e) => {
                setCapabilities(null)
                setSettings({
                  ...settings,
                  source: e.target.value === 'official' ? 'official' : 'custom',
                  model: '',
                })
              }}
            >
              <option value="official">官方 AI</option>
              <option value="custom">自配模型</option>
            </select>
          </div>
          {settings.source === 'custom' && (
            <>
              <div className="settings-field">
                <Label htmlFor="ai-protocol">接口协议</Label>
                <select
                  id="ai-protocol"
                  value={settings.protocol}
                  disabled={busy}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      protocol: e.target.value === 'responses' ? 'responses' : 'chat',
                    })
                  }
                >
                  <option value="chat">Chat Completions</option>
                  <option value="responses">Responses</option>
                </select>
              </div>
              <div className="ai-setting-field">
                <Label htmlFor="ai-endpoint">接口基础地址</Label>
                <Input
                  id="ai-endpoint"
                  placeholder="https://api.example.com/v1"
                  value={settings.endpoint}
                  disabled={busy}
                  onChange={(e) => setSettings({ ...settings, endpoint: e.target.value })}
                />
                <span className="settings-field-desc">填写 API 基础地址；本机服务可使用 HTTP。</span>
              </div>
              <div className="ai-setting-field">
                <Label htmlFor="ai-key">API Key</Label>
                <Input
                  id="ai-key"
                  type="password"
                  autoComplete="off"
                  placeholder={settings.hasApiKey ? '已保存；留空保留原密钥' : '本机免密服务可留空'}
                  value={apiKey}
                  disabled={busy}
                  onChange={(e) => setApiKey(e.target.value)}
                />
                {settings.hasApiKey && (
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        setSettings(
                          await bridge().ai.configure({
                            ...aiPreferencesSchema.strip().parse(settings),
                            apiKey: '',
                          }),
                        )
                        setApiKey('')
                        setMessage('已清除保存的密钥')
                      })
                    }
                  >
                    清除密钥
                  </Button>
                )}
              </div>
            </>
          )}
          <div className="ai-setting-field">
            <Label htmlFor="ai-model">模型名</Label>
            <Input
              id="ai-model"
              value={settings.model}
              disabled={busy}
              placeholder={
                settings.source === 'official' ? '留空使用官方默认模型' : '填写支持工具调用的模型名'
              }
              onChange={(e) => setSettings({ ...settings, model: e.target.value })}
            />
            {capabilities && (
              <span className="settings-field-desc">
                可用模型：{capabilities.models.map((m) => m.id).join('、') || '暂无'}；今日剩余{' '}
                {capabilities.remainingTokens} / {capabilities.dailyTokenLimit} Token。{capabilities.message}
              </span>
            )}
          </div>
          <div className="ai-setting-actions">
            <Button disabled={busy} onClick={() => void run(save)}>
              保存设置
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await save()
                  const result = await bridge().ai.test()
                  setMessage(result.message)
                })
              }
            >
              保存并测试
            </Button>
            {settings.source === 'official' && (
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => void run(async () => setCapabilities(await bridge().ai.capabilities()))}
              >
                查看模型与额度
              </Button>
            )}
          </div>
        </div>
      )}
      {message && (
        <p role="status" className="ai-notice">
          {message}
        </p>
      )}
      <p className="settings-field-desc">
        官方 AI 使用现有账号登录。自配模型直接连接填写的服务，切换来源前可在对话栏查看将发送的上下文。
      </p>
    </div>
  )
}
