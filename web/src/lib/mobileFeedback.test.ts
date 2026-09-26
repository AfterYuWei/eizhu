import { describe, expect, it } from 'vitest'
import {
  mobileFeedbackDuration,
  mobileFeedbackPresentation,
  pickMobileFeedbackIndex,
} from './mobileFeedback'

describe('mobileFeedbackPresentation', () => {
  it('把无详情的短成功显示为轻量胶囊', () => {
    expect(mobileFeedbackPresentation({ type: 'success' })).toBe('capsule')
    expect(mobileFeedbackPresentation({ type: 'normal' })).toBe('capsule')
  })

  it('把任务与带上下文的消息分层显示', () => {
    expect(mobileFeedbackPresentation({ type: 'loading' })).toBe('activity')
    expect(mobileFeedbackPresentation({ type: 'success', hasDescription: true })).toBe('notice')
    expect(mobileFeedbackPresentation({ type: 'info', hasAction: true })).toBe('notice')
  })
})

describe('mobileFeedbackDuration', () => {
  it('短成功 1.6 秒，任务和操作默认常驻', () => {
    expect(mobileFeedbackDuration({ type: 'success' })).toBe(1_600)
    expect(mobileFeedbackDuration({})).toBe(1_600)
    expect(mobileFeedbackDuration({ type: 'success', hasDescription: true })).toBe(3_000)
    expect(mobileFeedbackDuration({ type: 'loading' })).toBe(Number.POSITIVE_INFINITY)
    expect(mobileFeedbackDuration({ type: 'info', hasAction: true })).toBe(Number.POSITIVE_INFINITY)
  })

  it('尊重业务显式设置的时长', () => {
    expect(mobileFeedbackDuration({ type: 'error', duration: 10_000 })).toBe(10_000)
  })
})

describe('pickMobileFeedbackIndex', () => {
  it('错误优先；进行中的任务优先于普通和可操作通知', () => {
    expect(pickMobileFeedbackIndex([
      { type: 'success' },
      { type: 'loading' },
      { type: 'error' },
    ])).toBe(2)
    expect(pickMobileFeedbackIndex([
      { type: 'loading' },
      { type: 'info', hasAction: true },
    ])).toBe(0)
  })

  it('同级选择列表中更新的一项', () => {
    expect(pickMobileFeedbackIndex([{ type: 'success' }, { type: 'success' }])).toBe(0)
  })
})
