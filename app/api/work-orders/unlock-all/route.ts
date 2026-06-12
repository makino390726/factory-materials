import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST() {
  try {
    const { data: orders, error: fetchError } = await supabase
      .from('work_orders')
      .select('id, order_no, status, completed, completed_date')

    if (fetchError) {
      console.error('unlock-all fetch error:', fetchError)
      return NextResponse.json({ error: fetchError.message }, { status: 500 })
    }

    const targets = (orders || []).filter(
      (order: any) =>
        order.completed === true ||
        order.status === '完了' ||
        Boolean(order.completed_date)
    )

    if (targets.length === 0) {
      return NextResponse.json({ success: true, updated_count: 0 })
    }

    const now = new Date().toISOString()

    for (const order of targets) {
      const nextStatus = order.status === '完了' ? '未開始' : order.status
      const { error: updateError } = await supabase
        .from('work_orders')
        .update({
          completed: false,
          completed_date: null,
          status: nextStatus,
          updated_at: now,
        })
        .eq('id', order.id)

      if (updateError) {
        console.error('unlock-all update error:', updateError, order.id)
        return NextResponse.json({ error: updateError.message }, { status: 500 })
      }
    }

    return NextResponse.json({
      success: true,
      updated_count: targets.length,
      updated_orders: targets.map((order: any) => order.order_no),
    })
  } catch (error) {
    console.error('unlock-all error:', error)
    return NextResponse.json({ error: '一括編集可能化に失敗しました' }, { status: 500 })
  }
}