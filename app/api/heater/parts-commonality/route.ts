import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getPartCommonalityFromBom } from '@/lib/part-commonality'

export const runtime = 'nodejs'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

/** GET /api/heater/parts-commonality?part_key=SK11-08B0004 */
export async function GET(req: NextRequest) {
  try {
    const partKey = req.nextUrl.searchParams.get('part_key')?.trim()
    if (!partKey) {
      return NextResponse.json({ error: 'part_key が必要です' }, { status: 400 })
    }

    const result = await getPartCommonalityFromBom(supabase, partKey)
    return NextResponse.json(result)
  } catch (err) {
    console.error('parts-commonality error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '取得に失敗しました' },
      { status: 500 }
    )
  }
}
