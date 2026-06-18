import type { SupabaseClient } from '@supabase/supabase-js'

export type PlannedPartQuantityResult = {
  part_key: string
  plan_id: string | null
  plan_fiscal_year: string | null
  /** BOM×製造計画から算出した当該部品の年間必要数 */
  planned_part_qty: number
  /** 製造計画の全機種台数合計 */
  total_plan_qty: number
  model_count: number
}

/**
 * 最新の製造計画とBOMから、部品の年間計画必要数を算出する。
 * 計算式: Σ(機種の製造計画台数 × BOM使用数量)
 */
export async function getPlannedPartQuantity(
  supabase: SupabaseClient,
  partKey: string,
  planId?: string | null,
  allocationModels?: string[] | null
): Promise<PlannedPartQuantityResult> {
  const normalizedKey = partKey.trim()
  if (!normalizedKey) {
    return {
      part_key: normalizedKey,
      plan_id: null,
      plan_fiscal_year: null,
      planned_part_qty: 0,
      total_plan_qty: 0,
      model_count: 0,
    }
  }

  let resolvedPlanId = planId?.trim() || null
  let planFiscalYear: string | null = null

  if (resolvedPlanId) {
    const { data: plan, error } = await supabase
      .from('heater_manufacturing_plans')
      .select('id, fiscal_year')
      .eq('id', resolvedPlanId)
      .maybeSingle()

    if (error) throw error
    if (!plan) {
      resolvedPlanId = null
    } else {
      planFiscalYear = plan.fiscal_year ? String(plan.fiscal_year) : null
    }
  }

  if (!resolvedPlanId) {
    const { data: latestPlan, error } = await supabase
      .from('heater_manufacturing_plans')
      .select('id, fiscal_year')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) throw error
    if (!latestPlan) {
      return {
        part_key: normalizedKey,
        plan_id: null,
        plan_fiscal_year: null,
        planned_part_qty: 0,
        total_plan_qty: 0,
        model_count: 0,
      }
    }

    resolvedPlanId = latestPlan.id
    planFiscalYear = latestPlan.fiscal_year ? String(latestPlan.fiscal_year) : null
  }

  const [{ data: planDetails, error: detailsError }, { data: bomRows, error: bomError }] =
    await Promise.all([
      supabase
        .from('heater_manufacturing_plan_details')
        .select('model, quantity')
        .eq('plan_id', resolvedPlanId),
      supabase
        .from('heater_bom')
        .select('model, quantity')
        .eq('part_key', normalizedKey),
    ])

  if (detailsError) throw detailsError
  if (bomError) throw bomError

  const allocationSet =
    allocationModels && allocationModels.length > 0
      ? new Set(allocationModels.map((model) => model.trim()).filter(Boolean))
      : null

  const bomQtyByModel = new Map<string, number>()
  for (const row of bomRows || []) {
    const model = String(row.model || '').trim()
    if (!model) continue
    if (allocationSet && !allocationSet.has(model)) continue
    bomQtyByModel.set(model, Number(row.quantity || 0))
  }

  let plannedPartQty = 0
  let totalPlanQty = 0
  let modelCount = 0

  for (const detail of planDetails || []) {
    const model = String(detail.model || '').trim()
    const planQty = Number(detail.quantity || 0)
    if (!model || planQty <= 0) continue

    totalPlanQty += planQty

    const bomQty = bomQtyByModel.get(model)
    if (bomQty === undefined || bomQty <= 0) continue

    modelCount += 1
    plannedPartQty += planQty * bomQty
  }

  return {
    part_key: normalizedKey,
    plan_id: resolvedPlanId,
    plan_fiscal_year: planFiscalYear,
    planned_part_qty: plannedPartQty,
    total_plan_qty: totalPlanQty,
    model_count: modelCount,
  }
}

/** 1個あたりの制作時間（分）= 制作所要時間 ÷ 製造計画部品数 */
export function calcPerUnitDurationMinutes(
  totalDurationMinutes: number,
  plannedPartQty: number
): number | null {
  if (!Number.isFinite(totalDurationMinutes) || totalDurationMinutes <= 0) return null
  if (!Number.isFinite(plannedPartQty) || plannedPartQty <= 0) return null
  return Math.round((totalDurationMinutes / plannedPartQty) * 10) / 10
}
