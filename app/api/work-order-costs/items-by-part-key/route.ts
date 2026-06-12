import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// 특定の part_key に紐づく work_order_cost_items を取得（LINE分のみ）
export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const part_key = url.searchParams.get('part_key')

    if (!part_key) {
      return NextResponse.json({ error: 'part_key required' }, { status: 400 })
    }

    // master_type='ライン原価' && master_id=part_key で検索
    const { data: items, error } = await supabase
      .from('work_order_cost_items')
      .select('*')
      .eq('master_type', 'ライン原価')
      .eq('master_id', part_key)

    if (error) {
      console.error('get items by part_key error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(items || [])
  } catch (err) {
    console.error('work_order_cost_items by part_key error:', err)
    return NextResponse.json({ error: 'failed' }, { status: 500 })
  }
}
