import { useEffect, useState } from 'react'
import type { AiSettings, AiConnection, AiModelCatalog, AiCli } from '@eizhu/contracts'
import { bridge } from '@/lib/bridge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
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
export function AiPanel() {
  const [settings, setSettings] = useState<AiSettings | null>(null),
    [draft, setDraft] = useState<AiConnection>(fresh)
  const [catalog, setCatalog] = useState<AiModelCatalog | null>(null),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false)
  const [clis, setClis] = useState<AiCli[]>([]),
    [statuses, setStatuses] = useState<Array<{ kind: string; message: string }>>([])
  const [official, setOfficial] = useState<AiModelCatalog | null>(null)
  useEffect(() => {
    let live = true
    void bridge()
      .ai.settings()
      .then(
        (s) => {
          if (live) {
            setSettings(s)
            setClis(
              (['codex', 'claude', 'deepseek'] as const).map(
                (kind) => s.clis.find((v) => v.kind === kind) ?? { kind, path: '', model: '' },
              ),
            )
          }
        },
        (e) => {
          if (live) setMessage(e.message)
        },
      )
    return () => {
      live = false
    }
  }, [])
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
  const selectProvider = (id: string) => {
    const provider = settings?.providers.find((p) => p.id === id)
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
      setCatalog(null)
    }
  }
  return (
    <div className="settings-section ai-settings">
      <div className="settings-section-title">AI助手</div>
      <p>配置内置模型或已安装的CLI。eizhu记录在本地加密保存；CLI原生历史由对应CLI管理。</p>
      <div className="settings-card">
        <div className="settings-section-title">自定义供应商</div>
        <div className="ai-inline-actions">
          {settings?.providers.map((p) => (
            <Button key={p.id} variant="ghost" disabled={busy} onClick={() => selectProvider(p.id)}>
              {p.name}
            </Button>
          ))}
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => {
              setDraft(fresh())
              setCatalog(null)
            }}
          >
            新增供应商
          </Button>
        </div>
        <div className="settings-field">
          <Label htmlFor="ai-name">名称</Label>
          <Input
            id="ai-name"
            value={draft.name}
            disabled={busy}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </div>
        <div className="settings-field">
          <Label htmlFor="ai-protocol">协议</Label>
          <Select
            value={draft.protocol}
            disabled={busy}
            onValueChange={(value) => {
              if (value === 'responses' || value === 'chat' || value === 'anthropic') {
                setDraft({ ...draft, protocol: value })
                setCatalog(null)
              }
            }}
          >
            <SelectTrigger id="ai-protocol">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="responses">Responses</SelectItem>
              <SelectItem value="chat">Chat Completions</SelectItem>
              <SelectItem value="anthropic">Anthropic Messages</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="ai-setting-field">
          <Label htmlFor="ai-endpoint">接口基础地址</Label>
          <Input
            id="ai-endpoint"
            placeholder="https://api.example.com/v1"
            value={draft.endpoint}
            disabled={busy}
            onChange={(e) => {
              setDraft({ ...draft, endpoint: e.target.value })
              setCatalog(null)
            }}
          />
        </div>
        <div className="ai-setting-field">
          <Label htmlFor="ai-key">API Key</Label>
          <Input
            id="ai-key"
            type="password"
            autoComplete="off"
            placeholder={
              settings?.providers.find((p) => p.id === draft.id)?.hasApiKey
                ? '已保存；同一地址留空保留'
                : '本机免密服务可留空'
            }
            value={draft.apiKey ?? ''}
            disabled={busy}
            onChange={(e) => setDraft({ ...draft, apiKey: e.target.value || undefined, clearKey: false })}
          />
          <label>
            <input
              type="checkbox"
              checked={draft.clearKey}
              disabled={busy}
              onChange={(e) => setDraft({ ...draft, clearKey: e.target.checked, apiKey: undefined })}
            />
            清除已保存密钥
          </label>
        </div>
        <div className="settings-field">
          <Label htmlFor="ai-model">模型</Label>
          {catalog?.models.length ? (
            <Select
              value={draft.model}
              disabled={busy}
              onValueChange={(model) => setDraft({ ...draft, model })}
            >
              <SelectTrigger id="ai-model">
                <SelectValue />
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
              value={draft.model}
              disabled={busy}
              onChange={(e) => setDraft({ ...draft, model: e.target.value })}
            />
          )}
        </div>
        <div className="settings-field">
          <Label htmlFor="ai-context">上下文窗口</Label>
          <Input
            id="ai-context"
            type="number"
            min={4096}
            max={2000000}
            value={draft.contextWindow}
            disabled={busy}
            onChange={(e) => setDraft({ ...draft, contextWindow: Number(e.target.value) })}
          />
        </div>
        <div className="ai-inline-actions">
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                setCatalog(await bridge().ai.discover(draft))
                setMessage('模型发现完成；不代表工具协议测试通过')
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
                setDraft({ ...draft, apiKey: undefined, clearKey: false })
                setMessage('供应商已保存')
              })
            }
          >
            保存供应商
          </Button>
          {settings?.providers.some((p) => p.id === draft.id) && (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  setSettings(await bridge().ai.removeProvider({ providerId: draft.id }))
                  setDraft(fresh())
                  setCatalog(null)
                })
              }
            >
              删除供应商
            </Button>
          )}
        </div>
      </div>
      <div className="settings-card">
        <div className="settings-section-title">外部Agent</div>
        <p>
          使用已安装的CLI及其登录状态，不自动安装或修改全局配置。DeepSeek
          Harness需原生DEEPSEEK_API_KEY环境及模型名。
        </p>
        {clis.map((cli) => (
          <div key={cli.kind} className="ai-cli-config">
            <strong>
              {{ codex: 'Codex', claude: 'Claude Code', deepseek: 'DeepSeek Harness' }[cli.kind]}
            </strong>
            <Label htmlFor={'ai-cli-' + cli.kind}>可执行路径</Label>
            <Input
              id={'ai-cli-' + cli.kind}
              value={cli.path}
              placeholder="留空从PATH查找"
              disabled={busy}
              onChange={(e) =>
                setClis((all) => all.map((v) => (v.kind === cli.kind ? { ...v, path: e.target.value } : v)))
              }
            />
            <Label htmlFor={'ai-cli-model-' + cli.kind}>模型</Label>
            <Input
              id={'ai-cli-model-' + cli.kind}
              value={cli.model}
              disabled={busy}
              onChange={(e) =>
                setClis((all) => all.map((v) => (v.kind === cli.kind ? { ...v, model: e.target.value } : v)))
              }
            />
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  setSettings(await bridge().ai.configureCli(cli))
                  setMessage('CLI配置已保存')
                })
              }
            >
              保存CLI
            </Button>
            <p>{statuses.find((s) => s.kind === cli.kind)?.message}</p>
          </div>
        ))}
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() => void run(async () => setStatuses(await bridge().ai.cliStatus()))}
        >
          检查已安装CLI
        </Button>
      </div>
      <div className="settings-card">
        <div className="settings-section-title">官方AI</div>
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() => void run(async () => setOfficial(await bridge().ai.capabilities()))}
        >
          查询官方模型与额度
        </Button>
        {official && (
          <>
            <p>今日剩余额度：{official.remainingTokens}</p>
            <p>{official.message}</p>
            <div className="ai-inline-actions">
              {official.models.map((m) => (
                <Button
                  key={m.id}
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      setSettings(await bridge().ai.setDefault({ kind: 'official', model: m.id }))
                      setMessage('官方默认模型已更新')
                    })
                  }
                >
                  {m.name}
                </Button>
              ))}
            </div>
          </>
        )}
      </div>
      {message && <p role="status">{message}</p>}
    </div>
  )
}
