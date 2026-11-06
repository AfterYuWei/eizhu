import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import type { AiTarget, AiToolCall } from '@eizhu/contracts'
import { AiCodeBlock } from './AiCodeBlock'

const states = {
  pending: '等待确认',
  running: '执行中',
  completed: '已完成',
  unknown: '结果未知',
  rejected: '已拒绝',
  expired: '已失效',
  failed: '失败',
}
const labels: Record<AiToolCall['name'], string> = {
  session_info: '查看连接',
  terminal_read_context: '读取终端',
  terminal_execute: '执行命令',
  terminal_start: '启动任务',
  terminal_poll: '查看任务输出',
  terminal_stop: '停止任务',
  file_list: '列出目录',
  file_stat: '查看文件信息',
  file_read: '读取文件',
  file_write: '写入文件',
  file_edit: '编辑文件',
  file_mkdir: '新建目录',
  file_rename: '重命名文件',
  file_delete: '删除文件',
  output_read: '读取完整输出',
}
function titleOf(call: AiToolCall) {
  if (typeof call.args.purpose === 'string') return call.args.purpose
  return labels[call.name] + (typeof call.args.path === 'string' ? ' · ' + call.args.path : '')
}

function AiToolRecord({
  call,
  target,
  initiallyExpanded,
  onError,
}: {
  call: AiToolCall
  target?: AiTarget
  initiallyExpanded: boolean
  onError: (message: string) => void
}) {
  const [expanded, setExpanded] = useState(initiallyExpanded)
  const commandCall = call.name === 'terminal_execute' || call.name === 'terminal_start'
  const command = commandCall && typeof call.args.command === 'string' ? call.args.command : undefined
  const cwd = typeof call.args.cwd === 'string' ? call.args.cwd : undefined
  const purpose = titleOf(call)
  const result =
    call.result && typeof call.result === 'object' && !Array.isArray(call.result) ? call.result : undefined
  const stdout = typeof result?.stdout === 'string' ? result.stdout : undefined
  const stderr = typeof result?.stderr === 'string' ? result.stderr : undefined
  const content = typeof result?.content === 'string' ? result.content : undefined
  const excerpt = typeof result?.excerpt === 'string' ? result.excerpt : undefined
  const notice = typeof result?.message === 'string' ? result.message : undefined
  const readable =
    stdout !== undefined || stderr !== undefined || content !== undefined || excerpt !== undefined
  const attention = call.state === 'failed' || call.state === 'unknown'
  return (
    <details
      className="ai-tool-record"
      data-state={call.state}
      open={expanded}
      onToggle={(e) => setExpanded(e.currentTarget.open)}
    >
      <summary className="ai-command-summary">
        <ChevronRight size={14} aria-hidden="true" />
        <span className="ai-command-purpose" title={purpose}>
          {purpose}
        </span>
        <span className="ai-command-status" data-attention={attention}>
          {states[call.state]}
        </span>
      </summary>
      <div className="ai-tool-record-content">
        <div className="ai-command-context">
          {target && (
            <span className="ai-command-target">
              {target.username}@{target.host}:{target.port}
            </span>
          )}
          {cwd && <span className="ai-command-directory">目录：{cwd}</span>}
        </div>
        <AiCodeBlock
          label={command !== undefined ? '命令' : '操作预览'}
          content={command ?? call.preview}
          wrap
          onError={onError}
        />
        {result && (typeof result.exitCode === 'number' || typeof result.elapsedMs === 'number') && (
          <div className="ai-command-result-meta">
            {typeof result.exitCode === 'number' && (
              <span data-attention={result.exitCode !== 0}>退出码 {result.exitCode}</span>
            )}
            {typeof result.elapsedMs === 'number' && (
              <span>
                耗时{' '}
                {result.elapsedMs < 1000
                  ? `${Math.round(result.elapsedMs)} 毫秒`
                  : `${(result.elapsedMs / 1000).toFixed(1)} 秒`}
              </span>
            )}
          </div>
        )}
        {stdout && <AiCodeBlock label="输出" content={stdout} lineNumbers={false} onError={onError} />}
        {stderr && (
          <div className="ai-command-stderr">
            <AiCodeBlock label="错误输出" content={stderr} lineNumbers={false} onError={onError} />
          </div>
        )}
        {content !== undefined && (
          <AiCodeBlock label="内容" content={content} lineNumbers={false} onError={onError} />
        )}
        {excerpt !== undefined && (
          <>
            <p className="ai-command-hint">结果较长，以下为保留的原始摘要。</p>
            <AiCodeBlock label="输出摘要" content={excerpt} wrap lineNumbers={false} onError={onError} />
          </>
        )}
        {readable && !stdout && !stderr && content === undefined && excerpt === undefined && (
          <p className="ai-command-hint">暂无输出</p>
        )}
        {!readable && call.result !== undefined && (
          <AiCodeBlock
            label="结果"
            content={typeof call.result === 'string' ? call.result : JSON.stringify(call.result, null, 2)}
            wrap
            onError={onError}
          />
        )}
        {result?.truncated === true && <p className="ai-command-hint">输出已截断</p>}
        {notice && notice !== call.error && <p className="ai-command-hint">{notice}</p>}
        {call.error && <p className="ai-command-notice">{call.error}</p>}
        <details className="ai-command-raw">
          <summary>原始参数与结果</summary>
          <p className="ai-command-hint">{call.name}</p>
          <AiCodeBlock label="参数" content={JSON.stringify(call.args, null, 2)} wrap onError={onError} />
          {call.result !== undefined && (
            <AiCodeBlock
              label="原始结果"
              content={typeof call.result === 'string' ? call.result : JSON.stringify(call.result, null, 2)}
              wrap
              onError={onError}
            />
          )}
        </details>
      </div>
    </details>
  )
}

export function AiToolRecords({
  calls,
  targets,
  onError,
}: {
  calls: AiToolCall[]
  targets: AiTarget[]
  onError: (message: string) => void
}) {
  const first = calls[0]
  const active = calls.find((call) => call.state === 'pending' || call.state === 'running')
  const attention = calls.find((call) => call.state === 'failed' || call.state === 'unknown')
  const state =
    active?.state ??
    attention?.state ??
    calls.find((call) => call.state !== 'completed')?.state ??
    'completed'
  const single = calls.length === 1
  const title = single ? titleOf(first) : `执行记录（${calls.length} 项）`
  return (
    <details className={'ai-command ai-tool-records' + (single ? ' is-single' : '')} data-state={state}>
      <summary className="ai-command-summary">
        <ChevronRight size={14} aria-hidden="true" />
        <span className="ai-command-purpose" title={title}>
          {title}
        </span>
        <span className="ai-command-status" data-attention={Boolean(attention)}>
          {states[state]}
        </span>
      </summary>
      <div className="ai-tool-records-scroll" role="region" aria-label="执行记录，可滚动" tabIndex={0}>
        {calls.map((call) => (
          <AiToolRecord
            key={call.id}
            call={call}
            target={targets.find((target) => target.sessionId === call.sessionId)}
            initiallyExpanded={single}
            onError={onError}
          />
        ))}
      </div>
    </details>
  )
}
