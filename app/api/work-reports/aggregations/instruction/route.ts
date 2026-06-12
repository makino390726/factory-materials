import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const from = searchParams.get('from')
    const to = searchParams.get('to')

    if (!from || !to) {
      return NextResponse.json(
        { error: 'from と to が必要です' },
        { status: 400 }
      )
    }

    const { data: reports, error } = await supabase
      .from('work_reports')
      .select('id')
      .gte('work_date', from)
      .lte('work_date', to)

    if (error) {
      console.error('Supabaseエラー:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const reportIds = (reports || []).map((report) => report.id)

    if (reportIds.length === 0) {
      return NextResponse.json([])
    }

    const { data: items, error: itemError } = await supabase
      .from('work_report_items')
      .select('line_id, instruction_text, duration_minutes')
      .in('report_id', reportIds)

    if (itemError) {
      console.error('Supabaseエラー:', itemError)
      return NextResponse.json({ error: itemError.message }, { status: 500 })
    }

    const lineIdSet = new Set<string>()
    const instructionSet = new Set<string>()
    for (const item of items || []) {
      if (item.line_id) {
        lineIdSet.add(item.line_id)
      }
      if (item.instruction_text && item.instruction_text.trim()) {
        instructionSet.add(item.instruction_text.trim())
      }
    }

    const lineIds = Array.from(lineIdSet)
    const instructionIds = Array.from(instructionSet)

    const { data: lines, error: lineError } = lineIds.length
      ? await supabase.from('lines').select('id, line_code, name').in('id', lineIds)
      : { data: [], error: null }

    if (lineError) {
      console.error('Supabaseエラー:', lineError)
      return NextResponse.json({ error: lineError.message }, { status: 500 })
    }

    const { data: orders, error: orderError } = instructionIds.length
      ? await supabase
          .from('work_orders')
          .select('order_no, product_name')
          .in('order_no', instructionIds)
      : { data: [], error: null }

    if (orderError) {
      console.error('Supabaseエラー:', orderError)
      return NextResponse.json({ error: orderError.message }, { status: 500 })
    }

    const lineMap = new Map(
      (lines || []).map((line) => [line.id, { code: line.line_code, name: line.name }])
    )
    const orderMap = new Map(
      (orders || []).map((order) => [order.order_no, { name: order.product_name }])
    )

    const lineTotals = new Map<string, number>()
    const instructionTotals = new Map<string, number>()

    for (const item of items || []) {
      if (item.line_id) {
        const current = lineTotals.get(item.line_id) || 0
        lineTotals.set(item.line_id, current + (item.duration_minutes || 0))
      }

      if (item.instruction_text && item.instruction_text.trim()) {
        const key = item.instruction_text.trim()
        const current = instructionTotals.get(key) || 0
        instructionTotals.set(key, current + (item.duration_minutes || 0))
      }
    }

    const result = [
      ...Array.from(lineTotals.entries()).map(([lineId, duration]) => {
        const lineInfo = lineMap.get(lineId)
        return {
          category: 'line',
          code: lineInfo?.code || lineId,
          name: lineInfo?.name || '',
          duration_minutes: duration,
        }
      }),
      ...Array.from(instructionTotals.entries()).map(([instruction, duration]) => {
        const orderInfo = orderMap.get(instruction)
        return {
          category: 'instruction',
          code: instruction,
          name: orderInfo?.name || '',
          duration_minutes: duration,
        }
      }),
    ]

    return NextResponse.json(result)
  } catch (error) {
    console.error('作業指示別集計エラー:', error)
    return NextResponse.json({ error: '作業指示別集計に失敗しました' }, { status: 500 })
  }
}
