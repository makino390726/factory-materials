import type { SupabaseClient } from '@supabase/supabase-js'

/** L指令の工費は日報の指令コード単位で全体計上する。パーツ別の労賃按分は行わない。 */
export async function syncConfirmedLaborFromManufacturingPlan(
  _supabase: SupabaseClient,
  _planId: string
) {
  return null
}
