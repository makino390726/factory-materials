import { getFiscalYear } from '@/lib/fiscal-year'

/** 作業日報のマスター反映（月次集計）用ユーティリティ */

export type AggregationMonthRange = {
  monthStart: string
  monthEnd: string
  monthKey: string
  year: number
  month: number
}

/** from/to が同一暦月であることを確認し、その月の1日〜末日を返す */
export function resolveAggregationMonth(
  from: string,
  to: string
): AggregationMonthRange | { error: string } {
  const fromMatch = from.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  const toMatch = to.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!fromMatch || !toMatch) {
    return { error: '日付形式が不正です' }
  }

  const fromKey = `${fromMatch[1]}-${fromMatch[2]}`
  const toKey = `${toMatch[1]}-${toMatch[2]}`
  if (fromKey !== toKey) {
    return { error: 'マスター反映は同一月内の期間を指定してください' }
  }

  const year = Number(fromMatch[1])
  const month = Number(fromMatch[2])
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    return { error: '日付形式が不正です' }
  }

  const monthStart = `${fromKey}-01`
  const lastDay = new Date(year, month, 0).getDate()
  const monthEnd = `${fromKey}-${String(lastDay).padStart(2, '0')}`

  return { monthStart, monthEnd, monthKey: fromKey, year, month }
}

/** 当月の開始日・今日（または月末） */
export function getCurrentMonthDateRange(): { from: string; to: string } {
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth() + 1
  const monthKey = `${year}-${String(month).padStart(2, '0')}`
  const from = `${monthKey}-01`
  const today = now.toISOString().slice(0, 10)
  const lastDay = new Date(year, month, 0).getDate()
  const monthEnd = `${monthKey}-${String(lastDay).padStart(2, '0')}`
  const to = today <= monthEnd ? today : monthEnd
  return { from, to }
}

export function formatMonthLabel(monthKey: string) {
  const [year, month] = monthKey.split('-')
  return `${year}年${Number(month)}月`
}

/** 分を時間表示に変換（例: 6000 → "100h"） */
export function formatDurationHours(minutes: number) {
  const hours = minutes / 60
  if (!Number.isFinite(hours) || hours <= 0) return '0h'
  const rounded = Math.round(hours * 10) / 10
  return Number.isInteger(rounded) ? `${rounded}h` : `${rounded}h`
}

export type MonthlyDurationRow = {
  month: string
  month_label: string
  fiscal_year: number
  fiscal_year_label: string
  duration_minutes: number
  duration_hours: string
}

/** 一覧表示用の短い表記（例: 25年度1月-100h） */
export function formatMonthlySummary(rows: MonthlyDurationRow[], maxItems = 4) {
  if (!rows.length) return ''
  const sorted = [...rows].sort((a, b) => b.month.localeCompare(a.month))
  const visible = sorted.slice(0, maxItems)
  const text = visible
    .map((row) => {
      const [calendarYear, monthNum] = row.month.split('-').map(Number)
      const fyShort = String(getFiscalYear(calendarYear, monthNum)).slice(-2)
      return `${fyShort}年度${monthNum}月-${row.duration_hours}`
    })
    .join(' / ')
  if (sorted.length > maxItems) {
    return `${text} …`
  }
  return text
}

/** 作業日付から YYYY-MM を取得 */
export function toMonthKey(workDate: string) {
  return workDate.slice(0, 7)
}

/** 指定月（省略時は当月）の実績分数 */
export function getMonthMinutes(
  rows: MonthlyDurationRow[],
  monthKey = new Date().toISOString().slice(0, 7)
) {
  return rows.find((row) => row.month === monthKey)?.duration_minutes ?? 0
}
