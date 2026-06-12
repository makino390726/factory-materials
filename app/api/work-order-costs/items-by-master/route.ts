import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// GET: master_id(単体 or カンマ区切り複数) で明細取得
// master_type は任意（指定時のみ絞り込み）
// master_id に % を含む場合は LIKE（前方一致）で検索
export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const master_type = url.searchParams.get('master_type')
    const master_id = url.searchParams.get('master_id')

    if (!master_id) {
      return NextResponse.json({ error: 'master_id required' }, { status: 400 })
    }

    let query = supabase
      .from('work_order_cost_items')
      .select('*')
      .order('line_no', { ascending: true })

    if (master_type) {
      query = query.eq('master_type', master_type)
    }

    // % を含む場合は前方一致
    if (master_id.includes('%')) {
      query = query.like('master_id', master_id)
    } else {
      const masterIds = master_id
        .split(',')
        .map((v) => v.trim())
        .filter((v) => v.length > 0)

      if (masterIds.length === 0) {
        return NextResponse.json([])
      }

      query = masterIds.length === 1
        ? query.eq('master_id', masterIds[0])
        : query.in('master_id', masterIds)
    }

    const { data, error } = await query

    if (error) {
      console.error('get items by master error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(data || [])
  } catch (err) {
    console.error('get items by master error:', err)
    return NextResponse.json({ error: 'failed' }, { status: 500 })
  }
}

// DELETE: master_type と master_id で既存の明細を削除
export async function DELETE(req: Request) {
  try {
    const url = new URL(req.url)
    const master_type = url.searchParams.get('master_type')
    const master_id = url.searchParams.get('master_id')

    if (!master_type || !master_id) {
      return NextResponse.json({ error: 'master_type and master_id required' }, { status: 400 })
    }

    // master_type と master_id に一致する明細を削除
    const { error } = await supabase
      .from('work_order_cost_items')
      .delete()
      .eq('master_type', master_type)
      .eq('master_id', master_id)

    if (error) {
      console.error('delete items by master error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('delete items by master error:', err)
    return NextResponse.json({ error: 'failed' }, { status: 500 })
  }
}
