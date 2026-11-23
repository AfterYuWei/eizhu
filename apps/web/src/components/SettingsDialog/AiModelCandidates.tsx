import { useRef, useState } from 'react'
import { Check, RefreshCw, Search, Trash2 } from 'lucide-react'
import { aiConnectionSchema, type AiModelCatalog } from '@eizhu/contracts'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loading } from '@/components/ui/loading'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

type Models = AiModelCatalog['models']

function ModelName({ model }: { model: Models[number] }) {
  return (
    <span className="ai-model-name" title={model.id}>
      {model.name || model.id}
      {model.name && model.name !== model.id && <small>{model.id}</small>}
    </span>
  )
}

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
  discovered: Models | null
  disabled: boolean
  onChange: (models: Models, value: string) => void
  onDiscover: (onError: (message: string) => void) => void
}) {
  const searchInput = useRef<HTMLInputElement>(null)
  const manualInput = useRef<HTMLInputElement>(null)
  const [tab, setTab] = useState('pool')
  const [query, setQuery] = useState('')
  const [manual, setManual] = useState('')
  const [checked, setChecked] = useState<Set<string>>(() => new Set())
  const [message, setMessage] = useState('')
  const [discoveryError, setDiscoveryError] = useState('')
  const modelIds = new Set(models.map((model) => model.id))
  const available = discovered?.filter((model) => !modelIds.has(model.id)) ?? []
  const selected = available.filter((model) => checked.has(model.id))
  const term = query.trim().toLowerCase()
  const visibleModels = (tab === 'pool' ? models : available).filter(
    (model) => model.name.toLowerCase().includes(term) || model.id.toLowerCase().includes(term),
  )
  const allVisibleChecked = visibleModels.every((model) => checked.has(model.id))
  const discoveryEmpty = !discovered
    ? '点击「获取模型」读取上游模型列表。'
    : discovered.length
      ? '获取到的模型均已在列表中'
      : '未发现可用模型，可手动添加模型 ID。'

  const add = (entries: Models) => {
    const next = [...models, ...entries]
    if (!aiConnectionSchema.shape.models.safeParse(next).success) {
      setMessage('模型列表最多可添加 1000 个模型')
      return false
    }
    onChange(next, value)
    setQuery('')
    setMessage(`已加入 ${entries.length} 个模型，保存后生效`)
    return true
  }

  const addManual = () => {
    const result = aiConnectionSchema.shape.model.safeParse(manual.trim())
    if (!result.success) {
      setMessage('请输入1–160个字符的模型 ID')
      manualInput.current?.focus()
      return
    }
    if (modelIds.has(result.data)) {
      setMessage('模型已在列表中')
      return
    }
    if (add([{ id: result.data, name: result.data }])) setManual('')
  }

  return (
    <div className="settings-select ai-settings-controls">
      <Select
        value={value}
        disabled={disabled || !models.length}
        onValueChange={(model) => onChange(models, model)}
      >
        <SelectTrigger id="ai-model" className="w-full">
          <SelectValue placeholder={models.length ? '选择模型' : '请先添加模型'} />
        </SelectTrigger>
        <SelectContent>
          {models.map((model) => (
            <SelectItem key={model.id} value={model.id}>
              {model.name || model.id}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Dialog
        onOpenChange={(open) => {
          if (open) {
            setDiscoveryError('')
            return
          }
          setTab('pool')
          setQuery('')
          setManual('')
          setChecked(new Set())
          setMessage('')
        }}
      >
        <DialogTrigger asChild>
          <Button id="ai-model-manage" variant="ghost" disabled={disabled}>
            管理模型
          </Button>
        </DialogTrigger>
        <DialogContent
          className="ai-model-manager"
          showCloseButton={false}
          aria-describedby={undefined}
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            searchInput.current?.focus()
          }}
        >
          <DialogHeader className="ai-model-manager-header">
            <DialogTitle>模型管理</DialogTitle>
            <Button
              id="ai-discover-models"
              variant="outline"
              disabled={disabled}
              onClick={() => {
                setTab('available')
                setDiscoveryError('')
                setMessage('')
                setChecked(new Set())
                searchInput.current?.focus()
                onDiscover(setDiscoveryError)
              }}
            >
              <RefreshCw aria-hidden="true" />
              {discovered ? '重新获取' : '获取模型'}
            </Button>
          </DialogHeader>

          <Tabs
            value={tab}
            onValueChange={(next) => {
              setTab(next)
              setMessage('')
            }}
            className="ai-model-tabs"
          >
            <TabsList variant="line" aria-label="模型来源">
              <TabsTrigger value="pool">模型列表（{models.length}）</TabsTrigger>
              <TabsTrigger value="available">可添加{discovered && `（${available.length}）`}</TabsTrigger>
            </TabsList>
            <div className="ai-model-toolbar">
              <div className="ai-model-search">
                <Search size={16} aria-hidden="true" />
                <Input
                  id="ai-model-search"
                  ref={searchInput}
                  type="search"
                  aria-label="搜索模型"
                  placeholder="搜索模型名称或 ID"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
              {tab === 'available' && visibleModels.length > 0 && (
                <Button
                  variant="ghost"
                  disabled={disabled}
                  onClick={() => {
                    const next = new Set(checked)
                    for (const model of visibleModels) {
                      if (allVisibleChecked) next.delete(model.id)
                      else next.add(model.id)
                    }
                    setChecked(next)
                  }}
                >
                  {allVisibleChecked ? '取消全选结果' : '全选结果'}
                </Button>
              )}
            </div>

            <TabsContent value="pool" className="ai-model-tab-panel">
              <div className="ai-model-toolbar">
                <Input
                  ref={manualInput}
                  id="ai-model-name"
                  aria-label="手动添加模型 ID"
                  value={manual}
                  disabled={disabled}
                  placeholder="手动输入模型 ID"
                  onChange={(event) => setManual(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                      event.preventDefault()
                      addManual()
                    }
                  }}
                />
                <Button id="ai-add-model" variant="outline" disabled={disabled} onClick={addManual}>
                  添加
                </Button>
              </div>
              {visibleModels.length ? (
                <ul className="ai-model-pool" aria-label="已添加的模型">
                  {visibleModels.map((model) => (
                    <li key={model.id} className="ai-model-pool-row">
                      <Button
                        variant="ghost"
                        aria-pressed={model.id === value}
                        className="ai-model-use"
                        disabled={disabled}
                        onClick={() => onChange(models, model.id)}
                      >
                        <ModelName model={model} />
                        {model.id === value && (
                          <span className="ai-model-current">
                            <Check aria-hidden="true" />
                            当前
                          </span>
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="ai-model-remove"
                        disabled={disabled}
                        aria-label={`删除模型 ${model.id}`}
                        title="移除模型"
                        onClick={() => {
                          onChange(
                            models.filter((entry) => entry.id !== model.id),
                            value === model.id ? '' : value,
                          )
                          setMessage('已移除模型，保存后生效')
                        }}
                      >
                        <Trash2 aria-hidden="true" />
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="ai-model-empty">
                  {models.length ? '没有匹配的模型' : '获取上游模型，或手动添加模型 ID。'}
                </p>
              )}
            </TabsContent>

            <TabsContent value="available" className="ai-model-tab-panel" aria-busy={disabled}>
              {disabled ? (
                <Loading />
              ) : (
                <>
                  {discoveryError && (
                    <p className="ai-model-discovery-error" role="alert">
                      {discoveryError}
                    </p>
                  )}
                  {visibleModels.length ? (
                    <ul id="ai-discovered-model" className="ai-model-pool" aria-label="可添加的模型">
                      {visibleModels.map((model, index) => (
                        <li key={model.id}>
                          <Label className="ai-model-option" htmlFor={`ai-discovered-option-${index}`}>
                            <Checkbox
                              id={`ai-discovered-option-${index}`}
                              checked={checked.has(model.id)}
                              onCheckedChange={(nextChecked) => {
                                const next = new Set(checked)
                                if (nextChecked) next.add(model.id)
                                else next.delete(model.id)
                                setChecked(next)
                              }}
                            />
                            <ModelName model={model} />
                          </Label>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    !discoveryError && (
                      <p className="ai-model-empty">
                        {available.length ? '没有匹配的模型' : discoveryEmpty}
                      </p>
                    )
                  )}
                </>
              )}
            </TabsContent>
          </Tabs>

          <div className="ai-model-footer">
            <p role="status" className="ai-model-hint">
              {message || '供应商配置保存后生效'}
            </p>
            <DialogClose asChild>
              <Button id="ai-model-done" variant="outline">
                完成
              </Button>
            </DialogClose>
            {tab === 'available' && (
              <Button
                id="ai-add-detected"
                disabled={disabled || !selected.length}
                onClick={() => {
                  if (add(selected)) {
                    setChecked(new Set())
                    setTab('pool')
                    searchInput.current?.focus()
                  }
                }}
              >
                {selected.length ? `添加所选模型（${selected.length}）` : '添加所选模型'}
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
