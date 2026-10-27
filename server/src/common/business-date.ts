import { businessTzOffsetMinutes } from './config'

const MS_PER_DAY = 86_400_000
const MS_PER_MINUTE = 60_000

/**
 * 取业务时区下的日期键（YYYY-MM-DD）。
 *
 * 统计口径必须统一走这里：写入端（访问上报）和查询端（趋势图）任何一边
 * 换成 toISOString() 都会退回 UTC 日期，导致凌晨的访问被记到前一天。
 */
export function dayKey(date: Date = new Date()): string {
  const shifted = new Date(date.getTime() + businessTzOffsetMinutes() * MS_PER_MINUTE)
  return shifted.toISOString().slice(0, 10)
}

/** 业务时区下 N 天前的日期键。固定偏移无夏令时，等价于自然日减 N。 */
export function dayKeyDaysAgo(days: number, from: Date = new Date()): string {
  return dayKey(new Date(from.getTime() - days * MS_PER_DAY))
}
