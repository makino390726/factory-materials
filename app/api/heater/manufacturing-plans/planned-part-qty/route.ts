import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getPlannedPartQuantity } from '@/lib/manufacturing-plan-quantity'

export const runtime = 'nodejs'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

/**
 * GET /api/heater/manufacturing-plans/planned-part-qty?part_key=SK11-08B0004
 * 最新製造計画×BOMから部品の年間計画必要数を返す
 */
export async function GET(req: NextRequest) {
  try {
    const partKey = req.nextUrl.searchParams.get('part_key')?.trim()
    const planId = req.nextUrl.searchParams.get('plan_id')?.trim() || null

    if (!partKey) {
      return NextResponse.json({ error: 'part_key が必要です' }, { status: 400 })
    }

    const result = await getPlannedPartQuantity(supabase, partKey, planId)
    return NextResponse.json(result)
  } catch (err) {
    console.error('planned-part-qty error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '取得に失敗しました' },
      { status: 500 }
    )
  }
}
