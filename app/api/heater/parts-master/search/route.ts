import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// GET /api/heater/parts-master/search?q=xxx&limit=50&offset=0
export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const q = String(url.searchParams.get('q') || '').trim()
    const limit = Math.min(Number(url.searchParams.get('limit') || '50'), 200)
    const offset = Math.max(Number(url.searchParams.get('offset') || '0'), 0)

    if (!q) {
      // q が空なら空配列を返す（クライアントで初期ロードを行う設計のため）
      return NextResponse.json([])
    }

    const { data, error } = await supabase
      .from('heater_parts_master')
      .select('part_key, product_code, part_name, spec, cost_price')
      .or(`product_code.ilike.%${q}%,part_name.ilike.%${q}%`)
      .order('product_code', { ascending: true })
      .range(offset, offset + limit - 1)

    if (error) {
      console.error('parts-master search supabase error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(data || [])
  } catch (err: any) {
    console.error('parts-master search error:', err)
    return NextResponse.json({ error: err.message || 'unknown' }, { status: 500 })
  }
}
