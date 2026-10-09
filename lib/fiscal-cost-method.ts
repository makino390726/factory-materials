import { laborIndirectRateForFiscalYear, LABOR_INDIRECT_RATE_CHANGE_FISCAL_YEAR } from '@/lib/labor-indirect-rate'

/** 材料費の間接費を一律5%にする年度（工費の間接費40%と同じ令和9年度） */
export const NEW_COST_METHOD_FROM_FISCAL_YEAR = LABOR_INDIRECT_RATE_CHANGE_FISCAL_YEAR
export const MATERIAL_INDIRECT_FLAT_RATE = 0.05

export function usesNewCostMethod(fiscalYear?: number | null): boolean {
  const year = Number(fiscalYear)
  return Number.isFinite(year) && year >= NEW_COST_METHOD_FROM_FISCAL_YEAR
}

export function costMethodLabel(fiscalYear?: number | null): string {
  if (usesNewCostMethod(fiscalYear)) {
    return 'パーツごとに材料費の5%＋そのパーツの工賃の40%（保存データは変更しません）'
  }
  return '保存済みの原価（加工は材料費と工賃の合計の30%、それ以外は5%）'
}

/**
 * 明細1行の間接費。
 * 27年度以降は材料費の5%＋工賃の40%（区分は使わない）。
 * 26年度以前は区分「加」が材料費と工賃の合計の30%、「直」が5%。30%は過去データを見るための計算。
 */
export function calcComponentIndirect(
  material: number,
  labor: number,
  costType: string | null | undefined,
  fiscalYear?: number | null
): number {
  const materialCost = Math.round(Number(material) || 0)
  const laborCost = Math.round(Number(labor) || 0)
  if (usesNewCostMethod(fiscalYear)) {
    return (
      Math.round(materialCost * MATERIAL_INDIRECT_FLAT_RATE) +
      Math.round(laborCost * laborIndirectRateForFiscalYear(fiscalYear))
    )
  }
  const rate = (costType || '加') === '加' ? 0.3 : 0.05
  return Math.round((materialCost + laborCost) * rate)
}

/** ヘッダ工賃の間接費。27年度以降は工賃の40%、それ以前は加工が年度率・直接が5% */
export function calcHeaderLaborIndirect(
  labor: number,
  costType: string | null | undefined,
  fiscalYear?: number | null
): number {
  const laborCost = Math.round(Number(labor) || 0)
  if (laborCost <= 0) return 0
  if (usesNewCostMethod(fiscalYear)) {
    return Math.round(laborCost * laborIndirectRateForFiscalYear(fiscalYear))
  }
  const rate = (costType || '加') === '加' ? laborIndirectRateForFiscalYear(fiscalYear) : 0.05
  return Math.round(laborCost * rate)
}

export type DisplayCost = {
  material: number
  labor: number
  indirect: number
  total: number
}

/**
 * 画面表示用。27年度以降は材料費・工賃から間接費を付け替える。
 * 内訳のない一式金額（工賃も間接費もない）はそのまま返す。
 */
export function repriceLine(
  fiscalYear: number,
  material: number,
  labor: number,
  indirect: number,
  total?: number
): DisplayCost {
  const materialCost = Math.round(Number(material) || 0)
  const laborCost = Math.round(Number(labor) || 0)
  const indirectCost = Math.round(Number(indirect) || 0)
  const storedTotal = Math.round(Number(total) || materialCost + laborCost + indirectCost)
  if (!usesNewCostMethod(fiscalYear)) {
    return {
      material: materialCost,
      labor: laborCost,
      indirect: indirectCost,
      total: storedTotal,
    }
  }
  if (laborCost === 0 && indirectCost === 0 && materialCost > 0 && Math.abs(storedTotal - materialCost) < 1) {
    return { material: materialCost, labor: 0, indirect: 0, total: storedTotal }
  }
  const nextIndirect = calcComponentIndirect(materialCost, laborCost, '加', fiscalYear)
  return {
    material: materialCost,
    labor: laborCost,
    indirect: nextIndirect,
    total: materialCost + laborCost + nextIndirect,
  }
}
