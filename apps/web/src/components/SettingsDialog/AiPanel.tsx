import { useEffect, useState, type ReactNode } from 'react'
import type { AiConnection, AiModelCatalog, AiCli, AiBackend, AiSettings } from '@eizhu/contracts'
import { bridge } from '@/lib/bridge'
import { useAiStore } from '@/store/ai'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { aiProviderPresets } from './aiProviderPresets'
import '../Agent/ai.css'
const fresh = (): AiConnection => ({
  id: crypto.randomUUID(),
  name: '自定义模型',
  protocol: 'responses',
  endpoint: '',
  model: '',
  contextWindow: 64000,
  clearKey: false,
})
const cliNames = { codex: 'Codex', claude: 'Claude Code', deepseek: 'DeepSeek Harness' }
function Field({
  id,
  label,
  description,
  children,
}: {
  id: string
  label: string
  description?: string
  children: ReactNode
}) {
  return (
    <div className="settings-field">
      <div className="settings-field-info">
        <Label htmlFor={id} className="settings-field-label">
          {label}
        </Label>
        {description && <p className="settings-field-desc">{description}</p>}
      </div>
      {children}
    </div>
  )
}
export function AiPanel() {
  const { settings, setSettings } = useAiStore()
  const [draft, setDraft] = useState<AiConnection>(fresh)
  const [source, setSource] = useState('official')
  const [cli, setCli] = useState<AiCli>({ kind: 'codex', path: '', model: '' })
  const [catalog, setCatalog] = useState<AiModelCatalog | null>(null)
  const [official, setOfficial] = useState<AiModelCatalog | null>(null)
  const [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false)
  const [cliMessage, setCliMessage] = useState('')
  const loadProvider = (s: AiSettings, id: string) => {
    const provider = s.providers.find((p) => p.id === id)
    if (provider) {
      setDraft({
        id: provider.id,
        name: provider.name,
        protocol: provider.protocol,
        endpoint: provider.endpoint,
        model: provider.model,
        contextWindow: provider.contextWindow,
        clearKey: false,
      })
    }
    setCatalog(null)
  }
  useEffect(() => {
    let live = true
    void bridge()
      .ai.settings()
      .then(
        (s) => {
          if (!live) return
          setSettings(s)
          if (s.defaultBackend.kind === 'custom') {
            setSource(s.defaultBackend.providerId ?? 'new')
            loadProvider(s, s.defaultBackend.providerId ?? '')
          } else if (s.defaultBackend.kind !== 'official') {
            const kind = s.defaultBackend.kind
            setCli(s.clis.find((c) => c.kind === kind) ?? { kind, path: '', model: '' })
          }
        },
        (e) => {
          if (live) setMessage(e instanceof Error ? e.message : '无法读取AI设置')
        },
      )
    return () => {
      live = false
    }
  }, [setSettings])
  const run = async (work: () => Promise<void>) => {
    if (busy) return
    setBusy(true)
    setMessage('')
    try {
      await work()
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '操作失败')
    } finally {
      setBusy(false)
    }
  }
  const applyBackend = async (backend: AiBackend) => setSettings(await bridge().ai.setDefault(backend))
  const engine =
    settings?.defaultBackend.kind === 'official' || settings?.defaultBackend.kind === 'custom'
      ? 'builtin'
      : (settings?.defaultBackend.kind ?? 'builtin')
  if (!settings)
    return (
      <div className="settings-section ai-settings">
        <p role="status">{message || '正在读取AI设置…'}</p>
      </div>
    )
  return (
    <div className="settings-section ai-settings">
      <div className="settings-card">
        <Field
          id="ai-enabled"
          label="启用AI助手"
          description="关闭后停止当前AI任务，保留已保存的配置和对话。"
        >
          <Switch
            id="ai-enabled"
            checked={settings.enabled}
            disabled={busy}
            onCheckedChange={(enabled) =>
              void run(async () => {
                setSettings(await bridge().ai.setEnabled({ enabled }))
              })
            }
          />
        </Field>
        {settings.enabled && (
          <>
            <Field
              id="ai-engine"
              label="使用方式"
              description="在这里选择内置助手或外部Agent，对话中沿用此设置。"
            >
              <Select
                value={engine}
                disabled={busy}
                onValueChange={(value) =>
                  void run(async () => {
                    setCatalog(null)
                    setCliMessage('')
                    if (value === 'builtin') {
                      const provider = settings.providers.find((p) => p.id === source)
                      setSource(provider?.id ?? 'official')
                      await applyBackend(
                        provider
                          ? { kind: 'custom', providerId: provider.id, model: provider.model }
                          : { kind: 'official', model: '' },
                      )
                    } else if (value === 'codex' || value === 'claude' || value === 'deepseek') {
                      const next = settings.clis.find((c) => c.kind === value) ?? {
                        kind: value,
                        path: '',
                        model: '',
                      }
                      setCli(next)
                      await applyBackend({ kind: value, model: next.model })
                    }
                  })
                }
              >
                <SelectTrigger id="ai-engine" className="settings-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="builtin">内置助手</SelectItem>
                  {Object.entries(cliNames).map(([kind, name]) => (
                    <SelectItem key={kind} value={kind}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            {engine === 'builtin' && (
              <Field id="ai-source" label="模型来源" description="选择要使用和配置的供应商。">
                <Select
                  value={source}
                  disabled={busy}
                  onValueChange={(value) => {
                    setSource(value)
                    setCatalog(null)
                    setMessage('')
                    if (value === 'new') {
                      setDraft(fresh())
                      return
                    }
                    if (value === 'official') void run(() => applyBackend({ kind: 'official', model: '' }))
                    else {
                      loadProvider(settings, value)
                      const provider = settings.providers.find((p) => p.id === value)!
                      void run(() =>
                        applyBackend({ kind: 'custom', providerId: value, model: provider.model }),
                      )
                    }
                  }}
                >
                  <SelectTrigger id="ai-source" className="settings-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="official">官方AI</SelectItem>
                    {settings.providers.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                    <SelectItem value="new">新增供应商</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            )}
          </>
        )}
      </div>
      {settings.enabled && engine === 'builtin' && source === 'official' && (
        <section className="ai-config-section" aria-label="官方AI配置">
          <h2 className="settings-section-title">官方AI</h2>
          <div className="settings-card">
            <Field id="ai-official-model" label="模型" description="使用账号额度，无需填写API Key。">
              <Select
                value={settings.defaultBackend.model || 'default'}
                disabled={busy}
                onValueChange={(model) =>
                  void run(() => applyBackend({ kind: 'official', model: model === 'default' ? '' : model }))
                }
              >
                <SelectTrigger id="ai-official-model" className="settings-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">官方默认模型</SelectItem>
                  {official?.models.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name}
                    </SelectItem>
                  ))}
                  {settings.defaultBackend.model &&
                    !official?.models.some((m) => m.id === settings.defaultBackend.model) && (
                      <SelectItem value={settings.defaultBackend.model}>
                        {settings.defaultBackend.model}
                      </SelectItem>
                    )}
                </SelectContent>
              </Select>
            </Field>
            {official && (
              <p className="settings-empty">
                今日剩余额度：{official.remainingTokens}。{official.message}
              </p>
            )}
            <div className="settings-card-footer">
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    setOfficial(await bridge().ai.capabilities())
                  })
                }
              >
                查询模型与额度
              </Button>
            </div>
          </div>
        </section>
      )}
      {settings.enabled && engine === 'builtin' && source !== 'official' && (
        <section className="ai-config-section" aria-label="自定义供应商配置">
          <h2 className="settings-section-title">供应商配置</h2>
          <div className="settings-card">
            <Field id="ai-platform" label="平台预设" description="选择平台创建新配置，填入密钥和模型后保存。">
              <Select
                value={
                  aiProviderPresets.find(
                    (p) => p.endpoint === draft.endpoint && p.protocol === draft.protocol,
                  )?.key ?? 'custom'
                }
                disabled={busy}
                onValueChange={(key) => {
                  const preset = aiProviderPresets.find((p) => p.key === key)
                  setDraft({
                    ...fresh(),
                    ...(preset && {
                      name: preset.name,
                      protocol: preset.protocol,
                      endpoint: preset.endpoint,
                    }),
                  })
                  setSource('new')
                  setCatalog(null)
                  setMessage('')
                }}
              >
                <SelectTrigger id="ai-platform" className="settings-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {aiProviderPresets.map((p) => (
                    <SelectItem key={p.key} value={p.key}>
                      {p.name}
                    </SelectItem>
                  ))}
                  <SelectItem value="custom">自定义</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field id="ai-name" label="名称">
              <Input
                id="ai-name"
                className="settings-select"
                value={draft.name}
                disabled={busy}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </Field>
            <Field id="ai-protocol" label="接口协议">
              <Select
                value={draft.protocol}
                disabled={busy}
                onValueChange={(protocol) => {
                  if (protocol === 'responses' || protocol === 'chat' || protocol === 'anthropic') {
                    setDraft({ ...draft, protocol })
                    setCatalog(null)
                  }
                }}
              >
                <SelectTrigger id="ai-protocol" className="settings-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="responses">Responses</SelectItem>
                  <SelectItem value="chat">Chat Completions</SelectItem>
                  <SelectItem value="anthropic">Anthropic Messages</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field id="ai-endpoint" label="接口基础地址" description="可按地域、套餐或私有部署修改。">
              <Input
                id="ai-endpoint"
                className="settings-select"
                placeholder="https://api.example.com/v1"
                value={draft.endpoint}
                disabled={busy}
                onChange={(e) => {
                  setDraft({ ...draft, endpoint: e.target.value })
                  setCatalog(null)
                }}
              />
            </Field>
            <Field
              id="ai-key"
              label="API Key"
              description={
                settings.providers.find((p) => p.id === draft.id)?.hasApiKey
                  ? '已加密保存，同一地址留空保留原密钥。'
                  : '密钥仅在本机加密保存。'
              }
            >
              <Input
                id="ai-key"
                className="settings-select"
                type="password"
                autoComplete="off"
                placeholder="填写API Key"
                value={draft.apiKey ?? ''}
                disabled={busy}
                onChange={(e) => setDraft({ ...draft, apiKey: e.target.value || undefined, clearKey: false })}
              />
            </Field>
            {settings.providers.find((p) => p.id === draft.id)?.hasApiKey && (
              <Field id="ai-clear-key" label="清除已保存密钥" description="保存配置后生效。">
                <Switch
                  id="ai-clear-key"
                  checked={draft.clearKey}
                  disabled={busy}
                  onCheckedChange={(clearKey) => setDraft({ ...draft, clearKey, apiKey: undefined })}
                />
              </Field>
            )}
            <Field id="ai-model" label="模型" description="可手动填写，或先自动发现模型。">
              {catalog?.models.length ? (
                <Select
                  value={draft.model}
                  disabled={busy}
                  onValueChange={(model) => setDraft({ ...draft, model })}
                >
                  <SelectTrigger id="ai-model" className="settings-select">
                    <SelectValue placeholder="选择模型" />
                  </SelectTrigger>
                  <SelectContent>
                    {catalog.models.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  id="ai-model"
                  className="settings-select"
                  value={draft.model}
                  disabled={busy}
                  onChange={(e) => setDraft({ ...draft, model: e.target.value })}
                />
              )}
            </Field>
            <Field id="ai-context" label="上下文窗口">
              <Input
                id="ai-context"
                className="settings-select"
                type="number"
                min={4096}
                max={2000000}
                value={draft.contextWindow}
                disabled={busy}
                onChange={(e) => setDraft({ ...draft, contextWindow: Number(e.target.value) })}
              />
            </Field>
            <div className="settings-card-footer">
              {settings.providers.some((p) => p.id === draft.id) && (
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const next = await bridge().ai.removeProvider({ providerId: draft.id })
                      setSettings(next)
                      setSource('official')
                      await applyBackend({ kind: 'official', model: '' })
                      setDraft(fresh())
                      setCatalog(null)
                    })
                  }
                >
                  删除供应商
                </Button>
              )}
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    setCatalog(await bridge().ai.discover(draft))
                    setMessage('模型发现完成；尚未保存配置')
                  })
                }
              >
                自动发现模型
              </Button>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => void run(async () => setMessage((await bridge().ai.test(draft)).message))}
              >
                测试连接
              </Button>
              <Button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    setSettings(await bridge().ai.configure(draft))
                    await applyBackend({ kind: 'custom', providerId: draft.id, model: draft.model })
                    setSource(draft.id)
                    setDraft({ ...draft, apiKey: undefined, clearKey: false })
                    setMessage('已保存并使用此供应商')
                  })
                }
              >
                保存并使用
              </Button>
            </div>
          </div>
        </section>
      )}
      {settings.enabled && engine !== 'builtin' && (
        <section className="ai-config-section" aria-label="外部Agent配置">
          <h2 className="settings-section-title">{cliNames[cli.kind]}</h2>
          <div className="settings-card">
            <Field
              id="ai-cli-path"
              label="可执行路径"
              description="使用已安装的CLI及其原生登录，不自动安装。"
            >
              <Input
                id="ai-cli-path"
                className="settings-select"
                value={cli.path}
                placeholder="留空从PATH查找"
                disabled={busy}
                onChange={(e) => setCli({ ...cli, path: e.target.value })}
              />
            </Field>
            <Field
              id="ai-cli-model"
              label="模型"
              description={
                cli.kind === 'deepseek'
                  ? '填写原生模型名，并在CLI环境中配置DEEPSEEK_API_KEY。'
                  : '留空使用CLI默认模型。'
              }
            >
              <Input
                id="ai-cli-model"
                className="settings-select"
                value={cli.model}
                disabled={busy}
                onChange={(e) => setCli({ ...cli, model: e.target.value })}
              />
            </Field>
            {cliMessage && (
              <p className="settings-empty" role="status">
                {cliMessage}
              </p>
            )}
            <div className="settings-card-footer">
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const rows = await bridge().ai.cliStatus()
                    setCliMessage(rows.find((row) => row.kind === cli.kind)?.message ?? '未找到可用CLI')
                  })
                }
              >
                检查可用状态
              </Button>
              <Button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    setSettings(await bridge().ai.configureCli(cli))
                    await applyBackend({ kind: cli.kind, model: cli.model })
                    setMessage('已保存Agent配置')
                  })
                }
              >
                保存配置
              </Button>
            </div>
          </div>
        </section>
      )}
      {message && (
        <p className="ai-settings-message" role="status">
          {message}
        </p>
      )}
    </div>
  )
}
