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

/** 画面の年度セレクト（来年度〜過去4年） */
export function listSelectableFiscalYears(now = new Date()) {
  const current = getCurrentFiscalYear(now)
  return [current + 1, current, current - 1, current - 2, current - 3, current - 4]
}

export function parseFiscalYearParam(value: unknown, fallback = getCurrentFiscalYear()) {
  const parsed = typeof value === 'number' ? value : Number(String(value || '').trim())
  if (!Number.isFinite(parsed) || parsed < 2000 || parsed > 2100) return fallback
  return Math.round(parsed)
}

/**
 * 指令選択・一覧で見せる年度。
 * 当年度はマスタ全件を出すため、前年度と未設定も含める（年度替わり直後に空にしない）。
 */
export function fiscalYearsVisibleOnSelect(selectedYear: number, now = new Date()) {
  const current = getCurrentFiscalYear(now)
  if (selectedYear === current) {
    return { years: [selectedYear, selectedYear - 1], includeNull: true }
  }
  return { years: [selectedYear], includeNull: false }
}

export function workOrderFiscalYearOrFilter(selectedYear: number, now = new Date()) {
  const { years, includeNull } = fiscalYearsVisibleOnSelect(selectedYear, now)
  const parts = years.map((year) => `fiscal_year.eq.${year}`)
  if (includeNull) parts.push('fiscal_year.is.null')
  return parts.join(',')
}

export function matchesVisibleFiscalYear(
  rowYear: number | null | undefined,
  selectedYear: number,
  createdAt?: string | null,
  now = new Date()
) {
  const { years, includeNull } = fiscalYearsVisibleOnSelect(selectedYear, now)
  const year = Number(rowYear)
  if (Number.isFinite(year) && year > 0) return years.includes(year)
  if (includeNull) return true
  const createdYear = getFiscalYearFromDate(String(createdAt || ''))
  return createdYear === selectedYear
}
