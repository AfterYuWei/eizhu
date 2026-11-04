import { useEffect, useRef, useState } from 'react'
import type { AiConnection, AiModelCatalog, AiSettings } from '@eizhu/contracts'
import { aiPreferencesSchema } from '@eizhu/contracts'
import { bridge } from '@/lib/bridge'
import { HelpIcon } from '@/lib/serverIcons'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import '../Agent/ai.css'

function AiSettingsHelp({ label, children }: { label: string; children: string }) {
  return (
    <Tooltip>
      <TooltipTrigger type="button" aria-label={label} className="ai-setting-help">
        <HelpIcon size={14} aria-hidden="true" />
      </TooltipTrigger>
      <TooltipContent>{children}</TooltipContent>
    </Tooltip>
  )
}

export function AiPanel() {
  const [settings, setSettings] = useState<AiSettings | null>(null)
  const [saved, setSaved] = useState<AiSettings | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [catalog, setCatalog] = useState<AiModelCatalog | null>(null)
  const [manual, setManual] = useState(false)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const locked = useRef(false)
  useEffect(() => {
    let live = true
    void bridge()
      .ai.settings()
      .then(
        (value) => {
          if (live) {
            setSettings(value)
            setSaved(value)
            setManual(value.source === 'custom' && !value.model)
          }
        },
        (error) => {
          if (live) setMessage(error.message)
        },
      )
    return () => {
      live = false
    }
  }, [])
  const run = async (action: () => Promise<void>) => {
    if (locked.current) return
    locked.current = true
    setBusy(true)
    setMessage('')
    try {
      await action()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '操作失败')
    } finally {
      locked.current = false
      setBusy(false)
    }
  }
  const connection = (): AiConnection => ({
    ...aiPreferencesSchema.strip().parse(settings),
    ...(apiKey ? { apiKey } : {}),
  })
  const choices = catalog?.models ?? []
  const models =
    settings?.model && !choices.some((model) => model.id === settings.model)
      ? [{ id: settings.model, name: settings.model }, ...choices]
      : choices
  return (
    <div className="settings-section ai-settings">
      <div className="settings-section-title">
        AI 助手
        <AiSettingsHelp label="AI 助手使用说明">
          仅支持 Responses API，每条命令均需确认。对话在本地加密保存，不参与同步或备份。
        </AiSettingsHelp>
      </div>
      {settings && (
        <div className="settings-card">
          <div className="settings-field">
            <div className="ai-setting-label">
              <Label htmlFor="ai-source">模型来源</Label>
              <AiSettingsHelp label="模型来源说明">
                官方 AI 使用现有账号登录。自定义模型直接连接填写的服务；接口地址改变后，请重新填写密钥。
              </AiSettingsHelp>
            </div>
            <Select
              value={settings.source}
              disabled={busy}
              onValueChange={(value) => {
                const source = value === 'official' ? 'official' : 'custom'
                setSettings({ ...settings, source, model: '' })
                setCatalog(null)
                setApiKey('')
                setManual(source === 'custom')
                setMessage('')
              }}
            >
              <SelectTrigger id="ai-source" className="settings-select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="official">官方 AI</SelectItem>
                <SelectItem value="custom">自定义</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {settings.source === 'custom' && (
            <>
              <div className="ai-setting-field">
                <div className="ai-setting-label">
                  <Label htmlFor="ai-endpoint">接口基础地址</Label>
                  <AiSettingsHelp label="接口基础地址说明">
                    填写 API 基础地址，客户端自动追加 /responses；本机服务可使用 HTTP。
                  </AiSettingsHelp>
                </div>
                <Input
                  id="ai-endpoint"
                  placeholder="https://api.example.com/v1"
                  value={settings.endpoint}
                  disabled={busy}
                  onChange={(event) => {
                    setSettings({ ...settings, endpoint: event.target.value })
                    setCatalog(null)
                    setMessage('')
                  }}
                />
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
                  onChange={(event) => {
                    setApiKey(event.target.value)
                    setCatalog(null)
                  }}
                />
                {settings.hasApiKey && saved && (
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        const value = await bridge().ai.configure({
                          ...aiPreferencesSchema.strip().parse(saved),
                          apiKey: '',
                        })
                        setSaved(value)
                        setSettings({ ...settings, hasApiKey: false })
                        setApiKey('')
                        setCatalog(null)
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
            <Label htmlFor="ai-model">模型</Label>
            <Select
              value={manual ? 'manual' : settings.model ? `model:${settings.model}` : 'default'}
              disabled={busy}
              onValueChange={(value) => {
                setManual(value === 'manual')
                if (value !== 'manual')
                  setSettings({ ...settings, model: value === 'default' ? '' : value.slice(6) })
              }}
            >
              <SelectTrigger id="ai-model" className="settings-select">
                <SelectValue placeholder="自动发现或手动填写模型" />
              </SelectTrigger>
              <SelectContent>
                {settings.source === 'official' && <SelectItem value="default">使用官方默认模型</SelectItem>}
                {models.map((model) => (
                  <SelectItem key={model.id} value={`model:${model.id}`}>
                    {model.name}
                  </SelectItem>
                ))}
                {settings.source === 'custom' && <SelectItem value="manual">手动输入模型名</SelectItem>}
              </SelectContent>
            </Select>
            {settings.source === 'custom' && manual && (
              <Input
                aria-label="手动模型名"
                placeholder="填写支持 Responses 工具调用的模型名"
                value={settings.model}
                disabled={busy}
                onChange={(event) => setSettings({ ...settings, model: event.target.value })}
              />
            )}
            {catalog && settings.source === 'official' && (
              <span className="settings-field-desc">
                今日剩余 {catalog.remainingTokens} / {catalog.dailyTokenLimit} Token。{catalog.message}
              </span>
            )}
          </div>
          <div className="ai-setting-actions">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const result = await bridge().ai.discover(connection())
                  setCatalog(result)
                  if (settings.source === 'custom') {
                    if (!settings.model && result.models.length) {
                      setSettings({ ...settings, model: result.defaultModel })
                      setManual(false)
                    } else setManual(!result.models.some((model) => model.id === settings.model))
                  }
                  setMessage(result.message || `已发现 ${result.models.length} 个模型`)
                })
              }
            >
              自动发现模型
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const result = await bridge().ai.test(connection())
                  setMessage(result.message)
                })
              }
            >
              测试连接
            </Button>
            <Button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const value = await bridge().ai.configure(connection())
                  setSettings(value)
                  setSaved(value)
                  setApiKey('')
                  setMessage('AI 设置已保存。切换模型后请新建对话。')
                })
              }
            >
              保存设置
            </Button>
            <AiSettingsHelp label="模型发现与连接测试说明">
              发现与测试使用当前填写的配置，不会自动保存。测试只发送固定请求，不执行命令。
            </AiSettingsHelp>
          </div>
        </div>
      )}
      {message && (
        <p role="status" className="ai-notice">
          {message}
        </p>
      )}
    </div>
  )
}
