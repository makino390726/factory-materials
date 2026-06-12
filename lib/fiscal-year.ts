/**
 * 当社の年度: 9月1日 〜 翌年8月31日
 * 年度の呼称 = 終了年（翌年8月を含む暦年）
 * 例: 2026年度（26年度）= 2025/09/01 〜 2026/08/31
 */

export const FISCAL_YEAR_START_MONTH = 9

/** 暦年・月から当社年度（4桁）を算出 */
export function getFiscalYear(calendarYear: number, month: number): number {
  return month >= FISCAL_YEAR_START_MONTH ? calendarYear + 1 : calendarYear
}

export function getFiscalYearFromDate(dateStr: string): number | null {
  const match = dateStr.match(/^(\d{4})-(\d{2})/)
  if (!match) return null
  const calendarYear = Number(match[1])
  const month = Number(match[2])
  if (!Number.isFinite(calendarYear) || !Number.isFinite(month)) return null
  return getFiscalYear(calendarYear, month)
}

/** 前年度における同じ暦月（年度替わり時に削除する行） */
export function getPreviousFiscalYearSameMonth(calendarYear: number, month: number) {
  const fiscalYear = getFiscalYear(calendarYear, month)
  return {
    year: calendarYear - 1,
    month,
    fiscalYear: fiscalYear - 1,
  }
}

/** 表示用（例: 26年度） */
export function formatFiscalYearLabel(fiscalYear: number) {
  const shortYear = String(fiscalYear).slice(-2)
  return `${shortYear}年度`
}

/** 表示用ラベル（例: 26年度 1月）※月は暦月 */
export function formatFiscalMonthLabel(calendarYear: number, month: number) {
  return `${formatFiscalYearLabel(getFiscalYear(calendarYear, month))} ${month}月`
}

export function getCurrentFiscalYear(date = new Date()) {
  return getFiscalYear(date.getFullYear(), date.getMonth() + 1)
}

/** 年度の開始日・終了日（YYYY-MM-DD） */
export function getFiscalYearDateRange(fiscalYear: number) {
  return {
    start: `${fiscalYear - 1}-09-01`,
    end: `${fiscalYear}-08-31`,
  }
}
