import { useState } from 'react'
import { aiConnectionSchema, type AiModelCatalog } from '@eizhu/contracts'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

type Models = AiModelCatalog['models']
export function AiModelCandidates({
  models,
  value,
  discovered,
  disabled,
  onChange,
  onDiscover,
}: {
  models: Models
  value: string
  discovered: Models
  disabled: boolean
  onChange: (models: Models, value: string) => void
  onDiscover: () => void
}) {
  const [manual, setManual] = useState('')
  const [detected, setDetected] = useState('')
  const [message, setMessage] = useState('')
  const selectedDiscovery = discovered.find((m) => m.id === detected && !models.some((p) => p.id === m.id))
  const add = (entry: Models[number]) => {
    if (models.some((m) => m.id === entry.id)) {
      setMessage('模型已在候选池中')
      return
    }
    const next = [...models, entry]
    if (!aiConnectionSchema.shape.models.safeParse(next).success) {
      setMessage('候选池最多保留1000个模型')
      return
    }
    onChange(next, value)
    setManual('')
    setDetected('')
    setMessage('已加入候选池，请选择模型并保存')
  }
  const addManual = () => {
    const result = aiConnectionSchema.shape.model.safeParse(manual.trim())
    if (!result.success) {
      setMessage('请输入1–160个字符的模型名称')
      document.getElementById('ai-model-name')?.focus()
      return
    }
    add({ id: result.data, name: result.data })
  }
  return (
    <div className="settings-select ai-settings-controls">
      <Select
        value={value}
        disabled={disabled || !models.length}
        onValueChange={(model) => onChange(models, model)}
      >
        <SelectTrigger id="ai-model" className="w-full">
          <SelectValue placeholder={models.length ? '选择候选模型' : '先添加候选模型'} />
        </SelectTrigger>
        <SelectContent>
          {models.map((m) => (
            <SelectItem key={m.id} value={m.id}>
              {m.name || m.id}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Popover>
        <PopoverTrigger asChild>
          <Button id="ai-model-manage" variant="ghost" disabled={disabled}>
            管理候选模型
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="ai-model-manager"
          align="end"
          collisionPadding={8}
          aria-labelledby="ai-model-manager-title"
          onOpenAutoFocus={(e) => {
            e.preventDefault()
            document.getElementById('ai-model-name')?.focus()
          }}
        >
          <h3 id="ai-model-manager-title">候选模型（{models.length}）</h3>
          {models.length ? (
            <ul className="ai-model-pool" aria-label="候选模型列表">
              {models.map((model) => (
                <li key={model.id}>
                  <span title={model.id}>
                    {model.name || model.id}
                    {model.name && model.name !== model.id && <small>{model.id}</small>}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={disabled}
                    aria-label={'删除模型 ' + model.id}
                    onClick={() => {
                      onChange(
                        models.filter((m) => m.id !== model.id),
                        value === model.id ? '' : value,
                      )
                      setMessage('已从候选池移除，保存后生效')
                    }}
                  >
                    删除
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="ai-model-hint">先从探测结果选择模型，或手动添加。</p>
          )}
          <Label htmlFor="ai-model-name">手动添加</Label>
          <div className="ai-model-add-row">
            <Input
              id="ai-model-name"
              value={manual}
              disabled={disabled}
              placeholder="输入模型名称"
              onChange={(e) => setManual(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  addManual()
                }
              }}
            />
            <Button id="ai-add-model" variant="ghost" disabled={disabled} onClick={addManual}>
              添加
            </Button>
          </div>
          <Button
            id="ai-discover-models"
            variant="ghost"
            disabled={disabled}
            onClick={() => {
              setMessage('')
              onDiscover()
            }}
          >
            自动发现模型
          </Button>
          {!!discovered.length && (
            <div className="ai-model-add-row">
              <Select value={selectedDiscovery?.id ?? ''} disabled={disabled} onValueChange={setDetected}>
                <SelectTrigger id="ai-discovered-model" className="w-full" aria-label="探测到的模型">
                  <SelectValue placeholder="选择探测到的模型" />
                </SelectTrigger>
                <SelectContent>
                  {discovered.map((m) => (
                    <SelectItem key={m.id} value={m.id} disabled={models.some((p) => p.id === m.id)}>
                      {m.name || m.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                id="ai-add-detected"
                variant="ghost"
                disabled={disabled || !selectedDiscovery}
                onClick={() => {
                  if (selectedDiscovery) add(selectedDiscovery)
                }}
              >
                加入候选池
              </Button>
            </div>
          )}
          {message && (
            <p className="ai-model-hint" role="status">
              {message}
            </p>
          )}
        </PopoverContent>
      </Popover>
    </div>
  )
}
