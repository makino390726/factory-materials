import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// GET -> work_order_id優先でヘッダ+明細を取得。order_noはフォールバック。
export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const work_order_id = url.searchParams.get('work_order_id')
    const order_no = url.searchParams.get('order_no')

    let header: any = null

    if (work_order_id) {
      const { data } = await supabase
        .from('work_order_costs')
        .select('*')
        .eq('work_order_id', work_order_id)
        .order('updated_at', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(1)
      if (data && data.length > 0) header = data[0]
    } else if (order_no) {
      const { data } = await supabase
        .from('work_order_costs')
        .select('*')
        .eq('order_no', order_no)
        .order('updated_at', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(1)
      if (data && data.length > 0) header = data[0]
    }

    if (!header) {
      return NextResponse.json({ found: false })
    }

    const { data: items } = await supabase
      .from('work_order_cost_items')
      .select('*')
      .eq('work_order_cost_id', header.id)
      .order('line_no', { ascending: true })

    return NextResponse.json({ found: true, header, items: items || [] })
  } catch (error) {
    console.error('work-order-costs GET error:', error)
    return NextResponse.json({ error: 'failed' }, { status: 500 })
  }
}

// POST -> 新規登録
export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { order_no, work_order_id, header, items } = body

    if (!work_order_id && !order_no) {
      return NextResponse.json({ error: 'work_order_id or order_no required' }, { status: 400 })
    }

    // ヘッダ作成
    const { data: createdHeader, error: headerError } = await supabase
      .from('work_order_costs')
      .insert([{ order_no, work_order_id, ...header }])
      .select()
      .single()

    if (headerError || !createdHeader) {
      console.error('create header error:', headerError)
      return NextResponse.json({ error: 'header create failed' }, { status: 500 })
    }

    if (Array.isArray(items) && items.length > 0) {
      const itemsToInsert = items.map((it: any, idx: number) => ({
        work_order_cost_id: createdHeader.id,
        line_no: it.line_no ?? idx + 1,
        product_code: it.product_code,
        part_name: it.part_name,
        spec: it.spec,
        quantity: it.quantity,
        unit_price: it.unit_price,
        material_cost: it.material_cost,
        labor_cost: it.labor_cost,
        indirect_cost: it.indirect_cost,
        line_total: it.line_total,
        cost_type: it.cost_type ?? '加',
        master_type: it.master_type,
        master_id: it.master_id
      }))

      const { error: itemsError } = await supabase.from('work_order_cost_items').insert(itemsToInsert)
      if (itemsError) {
        console.error('insert items error:', itemsError)
        return NextResponse.json({ error: 'items insert failed' }, { status: 500 })
      }
    }

    return NextResponse.json({ success: true, id: createdHeader.id })
  } catch (error) {
    console.error('work-order-costs POST error:', error)
    return NextResponse.json({ error: 'failed' }, { status: 500 })
  }
}

// PUT -> 更新（order_no 指定で既存 header を更新＆明細は一旦削除して挿入）
export async function PUT(req: Request) {
  try {
    const body = await req.json()
    const { order_no, work_order_id, header, items } = body

    if (!work_order_id) return NextResponse.json({ error: 'work_order_id required' }, { status: 400 })

    const { data: existing } = await supabase
      .from('work_order_costs')
      .select('*')
      .eq('work_order_id', work_order_id)
      .order('updated_at', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1)

    if (!existing || existing.length === 0) {
      return NextResponse.json({ error: 'not found' }, { status: 404 })
    }

    const ex = existing[0]

    const { error: updateError } = await supabase
      .from('work_order_costs')
      .update(header)
      .eq('id', ex.id)

    if (updateError) {
      console.error('update header error:', updateError)
      return NextResponse.json({ error: 'header update failed' }, { status: 500 })
    }

    // 明細は既存を削除して再挿入（簡易実装）
    const { error: delError } = await supabase.from('work_order_cost_items').delete().eq('work_order_cost_id', ex.id)
    if (delError) {
      console.error('delete items error:', delError)
      return NextResponse.json({ error: 'delete items failed' }, { status: 500 })
    }

    if (Array.isArray(items) && items.length > 0) {
      const itemsToInsert = items.map((it: any, idx: number) => ({
        work_order_cost_id: ex.id,
        line_no: it.line_no ?? idx + 1,
        product_code: it.product_code,
        part_name: it.part_name,
        spec: it.spec,
        quantity: it.quantity,
        unit_price: it.unit_price,
        material_cost: it.material_cost,
        labor_cost: it.labor_cost,
        indirect_cost: it.indirect_cost,
        line_total: it.line_total,
        cost_type: it.cost_type ?? '加',
        master_type: it.master_type,
        master_id: it.master_id
      }))

      const { error: itemsError } = await supabase.from('work_order_cost_items').insert(itemsToInsert)
      if (itemsError) {
        console.error('insert items error:', itemsError)
        return NextResponse.json({ error: 'items insert failed' }, { status: 500 })
      }
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('work-order-costs PUT error:', error)
    return NextResponse.json({ error: 'failed' }, { status: 500 })
  }
}
