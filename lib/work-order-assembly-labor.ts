import type { SupabaseClient } from '@supabase/supabase-js'
import { calcLaborCostFromMinutes } from '@/lib/line-part-labor-cost'

export type AssemblyLaborSnapshot = {
  assembly_labor_minutes: number
  assembly_labor_cost: number
  current_period_minutes: number
  labor_receipt_date: string | null
}

function hasMissingColumnError(error: { message?: string } | null, column: string) {
  const msg = String(error?.message || '')
  return msg.includes(column) && (msg.includes('column') || msg.includes('Could not find'))
}

/** 1台あたり制作工賃を自動計算（標準時間 or 指定分） */
export function calcAssemblyLaborFromMinutes(minutes: number): {
  assembly_labor_minutes: number
  assembly_labor_cost: number
} {
  const assembly_labor_minutes = Math.max(0, Math.round(Number(minutes) || 0))
  return {
    assembly_labor_minutes,
    assembly_labor_cost: calcLaborCostFromMinutes(assembly_labor_minutes),
  }
}

/** D指令の制作工賃を standard_duration / 指定分から更新（入庫リセットなし） */
export async function syncWorkOrderAssemblyLabor(
  supabase: SupabaseClient,
  workOrderId: string,
  minutes?: number
): Promise<AssemblyLaborSnapshot | null> {
  const { data: order, error } = await supabase
    .from('work_orders')
    .select('id, standard_duration_minutes, assembly_labor_minutes, current_period_minutes, labor_receipt_date')
    .eq('id', workOrderId)
    .maybeSingle()

  if (error) {
    if (hasMissingColumnError(error, 'assembly_labor_minutes')) return null
    throw error
  }
  if (!order) return null

  const sourceMinutes =
    minutes !== undefined
      ? minutes
      : Number(order.standard_duration_minutes || 0)
  const labor = calcAssemblyLaborFromMinutes(sourceMinutes)
  const now = new Date().toISOString()

  const { data: updated, error: updateError } = await supabase
    .from('work_orders')
    .update({
      assembly_labor_minutes: labor.assembly_labor_minutes,
      assembly_labor_cost: labor.assembly_labor_cost,
      updated_at: now,
    })
    .eq('id', workOrderId)
    .select(
      'assembly_labor_minutes, assembly_labor_cost, current_period_minutes, labor_receipt_date'
    )
    .maybeSingle()

  if (updateError) {
    if (hasMissingColumnError(updateError, 'assembly_labor_minutes')) return null
    throw updateError
  }

  return {
    assembly_labor_minutes: Number(updated?.assembly_labor_minutes || labor.assembly_labor_minutes),
    assembly_labor_cost: Number(updated?.assembly_labor_cost || labor.assembly_labor_cost),
    current_period_minutes: Number(updated?.current_period_minutes || 0),
    labor_receipt_date: updated?.labor_receipt_date
      ? String(updated.labor_receipt_date)
      : null,
  }
}

/** 入庫ロットの期間実績分から制作工賃を確定しリセット（1台あたり＝合計分÷完成台数） */
export async function applyInstructionReceiptLaborResetWithQty(
  supabase: SupabaseClient,
  orderNo: string,
  receiptDate: string,
  periodTotalMinutes: number,
  completedQty: number
): Promise<AssemblyLaborSnapshot | null> {
  const qty = Math.max(1, Math.round(Number(completedQty) || 1))
  const total = Math.max(0, Math.round(Number(periodTotalMinutes) || 0))
  const perUnit =
    total > 0 ? Math.round(total / qty) : 0

  const normalizedOrderNo = String(orderNo || '').trim()
  if (!normalizedOrderNo) return null

  const { data: orders, error } = await supabase
    .from('work_orders')
    .select('id, standard_duration_minutes')
    .eq('order_no', normalizedOrderNo)

  if (error) {
    if (hasMissingColumnError(error, 'assembly_labor_minutes')) return null
    throw error
  }
  if (!orders || orders.length === 0) return null

  const now = new Date().toISOString()
  let last: AssemblyLaborSnapshot | null = null

  for (const order of orders) {
    const minutesForLabor =
      perUnit > 0 ? perUnit : Math.max(0, Number(order.standard_duration_minutes || 0))
    const labor = calcAssemblyLaborFromMinutes(minutesForLabor)

    const { data: updated, error: updateError } = await supabase
      .from('work_orders')
      .update({
        assembly_labor_minutes: labor.assembly_labor_minutes,
        assembly_labor_cost: labor.assembly_labor_cost,
        current_period_minutes: 0,
        labor_receipt_date: receiptDate,
        // 確定した1台STを標準時間にも反映（次サイクルの自動計算ベース）
        standard_duration_minutes: labor.assembly_labor_minutes,
        updated_at: now,
      })
      .eq('id', order.id)
      .select(
        'assembly_labor_minutes, assembly_labor_cost, current_period_minutes, labor_receipt_date'
      )
      .maybeSingle()

    if (updateError) {
      if (hasMissingColumnError(updateError, 'assembly_labor_minutes')) return null
      // standard_duration だけ失敗した場合は制作工賃列のみ再試行
      if (hasMissingColumnError(updateError, 'standard_duration_minutes')) {
        continue
      }
      throw updateError
    }

    last = {
      assembly_labor_minutes: Number(
        updated?.assembly_labor_minutes || labor.assembly_labor_minutes
      ),
      assembly_labor_cost: Number(updated?.assembly_labor_cost || labor.assembly_labor_cost),
      current_period_minutes: 0,
      labor_receipt_date: receiptDate,
    }
  }

  return last
}
