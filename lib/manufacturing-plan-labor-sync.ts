import type { SupabaseClient } from '@supabase/supabase-js'
import { bulkRecalculateConfirmedAssignments } from '@/lib/line-part-labor-cost'

/** 製造計画保存後、確認済みの共通部品労賃按分を再計算する */
export async function syncConfirmedLaborFromManufacturingPlan(
  supabase: SupabaseClient,
  planId: string
) {
  return bulkRecalculateConfirmedAssignments(supabase, {
    planId,
    onlyConfirmed: true,
  })
}
