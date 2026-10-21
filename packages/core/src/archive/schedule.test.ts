import test from 'node:test'
import assert from 'node:assert/strict'
import { scheduledDue } from './schedule.ts'
import { defaults } from './repository.ts'
test('daily schedules use local time, run once after missed time and combine with interval schedules', () => {
  const now = new Date(2026, 9, 21, 10, 30),
    s = { ...defaults, scheduled_enabled: true, scheduled_interval_hours: 0, scheduled_daily_time: '10:00' }
  assert.equal(scheduledDue(s, new Date(2026, 9, 20, 10, 0).getTime(), now), true)
  assert.equal(scheduledDue(s, new Date(2026, 9, 21, 10, 0).getTime(), now), false)
  assert.equal(scheduledDue({ ...s, scheduled_daily_time: '11:00' }, 0, now), false)
  assert.equal(
    scheduledDue(
      { ...s, scheduled_interval_hours: 1, scheduled_daily_time: '' },
      now.getTime() - 3600000,
      now,
    ),
    true,
  )
  assert.equal(scheduledDue({ ...s, scheduled_enabled: false }, 0, now), false)
})
