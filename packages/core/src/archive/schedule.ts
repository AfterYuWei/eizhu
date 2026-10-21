import type { BackupSettings } from '@eizhu/contracts/models/backup'
/** Compare against local wall-clock time; missed runs collapse into one current snapshot. */
export function scheduledDue(settings: BackupSettings, last: number, now = new Date()): boolean {
  if (!settings.scheduled_enabled) return false
  if (
    settings.scheduled_interval_hours > 0 &&
    now.getTime() - last >= settings.scheduled_interval_hours * 3600000
  )
    return true
  if (!settings.scheduled_daily_time) return false
  const [hour, minute] = settings.scheduled_daily_time.split(':').map(Number),
    daily = new Date(now)
  daily.setHours(hour, minute, 0, 0)
  return now.getTime() >= daily.getTime() && last < daily.getTime()
}
