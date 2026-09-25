import { getCurrentFiscalYear } from '@/lib/fiscal-year'

/**
 * 工費の間接費率。
 * 令和8年度（2026年度）まで 30%、令和9年度（2027年度 = 2026/09/01〜）以降 40%。
 * 当社年度の呼称は終了年。令和9年 = 2027。
 */
export const LABOR_INDIRECT_RATE = 0.3
export const LABOR_INDIRECT_RATE_FROM_REIWA9 = 0.4
export const LABOR_INDIRECT_RATE_CHANGE_FISCAL_YEAR = 2027

/** 年度別の工費間接費率。年度不明のときは当年度 */
export function laborIndirectRateForFiscalYear(fiscalYear?: number | null): number {
  const year = Number(fiscalYear)
  const resolved = Number.isFinite(year) && year > 0 ? year : getCurrentFiscalYear()
  return resolved >= LABOR_INDIRECT_RATE_CHANGE_FISCAL_YEAR
    ? LABOR_INDIRECT_RATE_FROM_REIWA9
    : LABOR_INDIRECT_RATE
}

/** 工費の間接費 = 工費 × 年度別間接費率 */
export function calcLaborIndirectFromLabor(laborCost: number, fiscalYear?: number | null): number {
  if (!Number.isFinite(laborCost) || laborCost <= 0) return 0
  return Math.round(laborCost * laborIndirectRateForFiscalYear(fiscalYear))
}
