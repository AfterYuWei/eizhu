import { isValidElement, useEffect, useState, type ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion, type PanInfo } from 'motion/react'
import {
  CircleCheck,
  Info,
  Loader2,
  OctagonX,
  TriangleAlert,
  X,
} from 'lucide-react'
import { toast, useSonner, type Action, type ToastT } from 'sonner'
import {
  mobileFeedbackDuration,
  mobileFeedbackPresentation,
  pickMobileFeedbackIndex,
} from '@/lib/mobileFeedback'

const FEEDBACK_SPRING = { type: 'spring', bounce: 0, duration: 0.26 } as const
const FEEDBACK_FADE = { duration: 0.16, ease: 'easeOut' } as const

const ICONS = {
  success: CircleCheck,
  info: Info,
  warning: TriangleAlert,
  error: OctagonX,
  loading: Loader2,
  action: Info,
  normal: Info,
  default: Info,
} as const

function hasAction(value: ToastT['action'] | ToastT['cancel']): value is Action {
  return Boolean(value && typeof value === 'object' && 'onClick' in value && 'label' in value)
}

function renderNode(value: ToastT['title'] | ToastT['description']): ReactNode {
  return typeof value === 'function' ? value() : value
}

function feedbackCandidate(item: ToastT) {
  return {
    type: item.type,
    hasDescription: Boolean(item.description),
    hasAction: Boolean(item.action || item.cancel),
    duration: item.duration,
  }
}

function primitiveNodeKey(value: ToastT['title'] | ToastT['description']): string | null {
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  return value === undefined || value === null ? '' : null
}

function dedupeKey(item: ToastT): string {
  const title = primitiveNodeKey(item.title)
  const description = primitiveNodeKey(item.description)
  if (title === null || description === null) return `id:${item.id}`
  return `${item.type ?? 'normal'}\u0000${title}\u0000${description}`
}

/**
 * 移动端全局反馈宿主。继续订阅 Sonner 的业务事件，但不渲染 Sonner Toast：
 * 轻成功、可操作通知、长任务分别使用胶囊、操作条和活动条。
 */
export function MobileFeedbackHost() {
  const reducedMotion = useReducedMotion()
  useSonner()
  // 捕获宿主挂载前极短窗口内已经发出的消息（例如启动阶段的本地读取失败）。
  const toasts = toast.getToasts().filter((item): item is ToastT => !('dismiss' in item))
  const [interacting, setInteracting] = useState(false)
  const [documentVisible, setDocumentVisible] = useState(document.visibilityState !== 'hidden')
  const seen = new Set<string>()
  const uniqueToasts: ToastT[] = []
  const duplicateIds: Array<string | number> = []
  for (const item of toasts) {
    const key = dedupeKey(item)
    if (seen.has(key)) duplicateIds.push(item.id)
    else {
      seen.add(key)
      uniqueToasts.push(item)
    }
  }
  const duplicateSignature = duplicateIds.join('\u0000')
  const activeIndex = pickMobileFeedbackIndex(uniqueToasts.map(feedbackCandidate))
  const active = activeIndex >= 0 ? uniqueToasts[activeIndex] : undefined

  useEffect(() => {
    const onVisibilityChange = () => setDocumentVisible(document.visibilityState !== 'hidden')
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [])

  useEffect(() => {
    for (const id of duplicateIds) toast.dismiss(id)
  // duplicateSignature 是稳定的标量，避免数组身份导致重复 dismiss。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [duplicateSignature])

  const dismiss = (item: ToastT, force = false) => {
    if (!force && item.dismissible === false) return
    item.onDismiss?.(item)
    toast.dismiss(item.id)
  }

  const onDragEnd = (item: ToastT, info: PanInfo) => {
    if (info.offset.y > 42 || info.velocity.y > 520) dismiss(item)
  }

  return (
    <div className="m-feedback-host" aria-live="polite" aria-atomic="true">
      {uniqueToasts.map((item) => (
        <MobileFeedbackTimer
          key={item.id}
          item={item}
          paused={!documentVisible || (interacting && item.id === active?.id)}
        />
      ))}
      <AnimatePresence initial={false} mode="popLayout">
        {active && (
          <MobileFeedback
            key={active.id}
            item={active}
            reducedMotion={Boolean(reducedMotion)}
            onDismiss={(force) => dismiss(active, force)}
            onInteractionChange={setInteracting}
            onDragEnd={(_, info) => {
              setInteracting(false)
              onDragEnd(active, info)
            }}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

function MobileFeedbackTimer({ item, paused }: { item: ToastT; paused: boolean }) {
  useEffect(() => {
    if (paused) return
    const duration = mobileFeedbackDuration(feedbackCandidate(item))
    if (!Number.isFinite(duration)) return
    const timer = window.setTimeout(() => {
      item.onAutoClose?.(item)
      toast.dismiss(item.id)
    }, duration)
    return () => window.clearTimeout(timer)
  }, [item, paused])
  return null
}

function MobileFeedback({
  item,
  reducedMotion,
  onDismiss,
  onInteractionChange,
  onDragEnd,
}: {
  item: ToastT
  reducedMotion: boolean
  onDismiss: (force?: boolean) => void
  onInteractionChange: (interacting: boolean) => void
  onDragEnd: (_event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => void
}) {
  const presentation = mobileFeedbackPresentation(feedbackCandidate(item))
  const tone = item.type ?? 'normal'
  const Icon = ICONS[tone]
  const cancelAction = hasAction(item.cancel) ? item.cancel : null
  const primaryAction = hasAction(item.action) ? item.action : null
  const cancelNode = isValidElement(item.cancel) ? item.cancel : null
  const actionNode = isValidElement(item.action) ? item.action : null
  const dismissible = item.dismissible !== false && item.type !== 'loading'
  const showClose = dismissible && (
    item.closeButton
    || Boolean(item.action || item.cancel)
    || item.type === 'error'
    || item.type === 'warning'
  )

  return (
    <motion.section
      layout
      className="m-feedback"
      data-presentation={presentation}
      data-tone={tone}
      role={item.type === 'error' || item.type === 'warning' ? 'alert' : 'status'}
      initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.98 }}
      transition={reducedMotion ? FEEDBACK_FADE : FEEDBACK_SPRING}
      drag={dismissible ? 'y' : false}
      dragConstraints={{ top: 0, bottom: 88 }}
      dragElastic={{ top: 0, bottom: 0.32 }}
      onPointerDown={() => onInteractionChange(true)}
      onPointerUp={() => onInteractionChange(false)}
      onPointerCancel={() => onInteractionChange(false)}
      onDragEnd={onDragEnd}
    >
      <span className="m-feedback-icon">
        {item.icon ?? <Icon className={item.type === 'loading' ? 'is-spinning' : ''} aria-hidden="true" />}
      </span>
      <span className="m-feedback-content">
        {item.jsx ?? (
          <>
            <strong className="m-feedback-title">{renderNode(item.title)}</strong>
            {item.description && (
              <span className="m-feedback-description">{renderNode(item.description)}</span>
            )}
          </>
        )}
      </span>
      {(primaryAction || cancelAction || actionNode || cancelNode) && (
        <span className="m-feedback-actions">
          {cancelNode}
          {cancelAction && (
            <button type="button" onClick={(event) => { cancelAction.onClick(event); onDismiss(true) }}>
              {cancelAction.label}
            </button>
          )}
          {actionNode}
          {primaryAction && (
            <button
              type="button"
              className="is-primary"
              onClick={(event) => {
                primaryAction.onClick(event)
                if (!event.defaultPrevented) onDismiss(true)
              }}
            >
              {primaryAction.label}
            </button>
          )}
        </span>
      )}
      {showClose && (
        <button type="button" className="m-feedback-close" aria-label="关闭提示" onClick={() => onDismiss()}>
          <X aria-hidden="true" />
        </button>
      )}
    </motion.section>
  )
}
