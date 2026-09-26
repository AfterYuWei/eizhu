export type MobileFeedbackType =
  | 'normal'
  | 'action'
  | 'success'
  | 'info'
  | 'warning'
  | 'error'
  | 'loading'
  | 'default'

export type MobileFeedbackPresentation = 'capsule' | 'notice' | 'activity'

export interface MobileFeedbackCandidate {
  type?: MobileFeedbackType
  hasDescription?: boolean
  hasAction?: boolean
  duration?: number
}

/**
 * 移动端不再把所有消息都显示成同一种 Toast：
 * 短成功用胶囊，有上下文或操作的消息用操作条，长任务用活动条。
 */
export function mobileFeedbackPresentation(
  candidate: MobileFeedbackCandidate,
): MobileFeedbackPresentation {
  if (candidate.type === 'loading') return 'activity'
  if (
    (candidate.type === 'success'
      || candidate.type === 'normal'
      || candidate.type === 'default'
      || candidate.type === undefined)
    && !candidate.hasDescription
    && !candidate.hasAction
  ) {
    return 'capsule'
  }
  return 'notice'
}

/** 自定义移动端时长；显式 duration 始终优先，带操作的消息默认常驻。 */
export function mobileFeedbackDuration(candidate: MobileFeedbackCandidate): number {
  if (candidate.duration !== undefined) return candidate.duration
  if (candidate.type === 'loading' || candidate.hasAction) return Number.POSITIVE_INFINITY
  if (
    (candidate.type === 'success'
      || candidate.type === 'normal'
      || candidate.type === 'default'
      || candidate.type === undefined)
    && !candidate.hasDescription
  ) {
    return 1_600
  }
  if (candidate.type === 'success') return 3_000
  if (candidate.type === 'warning') return 5_000
  if (candidate.type === 'error') return 6_000
  return 4_000
}

/**
 * 同一时刻只展示一个全局反馈。需要处理或失败的消息优先于活动状态，
 * 活动状态优先于普通瞬时消息；同级保留输入列表中更新的一项。
 */
export function pickMobileFeedbackIndex(
  candidates: readonly MobileFeedbackCandidate[],
): number {
  let selected = -1
  let selectedPriority = -1
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index]
    const priority = mobileFeedbackPriority(candidate)
    if (priority > selectedPriority) {
      selected = index
      selectedPriority = priority
    }
  }
  return selected
}

function mobileFeedbackPriority(candidate: MobileFeedbackCandidate): number {
  if (candidate.type === 'error') return 5
  if (candidate.type === 'warning') return 5
  if (candidate.type === 'loading') return 4
  if (candidate.hasAction || candidate.type === 'action') return 3
  if (candidate.type === 'info') return 2
  return 1
}
