import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { fetchByIdChunks, fetchWorkReportsInRange } from '@/lib/work-report-query'

export const runtime = 'nodejs'
export const maxDuration = 60

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

    const reports = await fetchWorkReportsInRange<{ id: string }>(supabase, from, to, 'id')
    const reportIds = reports.map((report) => String(report.id))
    if (reportIds.length === 0) {
      return NextResponse.json([])
    }

    const items = await fetchByIdChunks<{
      line_id: string | null
      instruction_text: string | null
      duration_minutes: number | null
    }>(supabase, 'work_report_items', 'line_id, instruction_text, duration_minutes', 'report_id', reportIds)

    const lineIdSet = new Set<string>()
    const instructionSet = new Set<string>()
    for (const item of items) {
      if (item.line_id) lineIdSet.add(item.line_id)
      if (item.instruction_text && item.instruction_text.trim()) {
        instructionSet.add(item.instruction_text.trim())
      }
    }

    const lineIds = Array.from(lineIdSet)
    const instructionIds = Array.from(instructionSet)

    const lines = await fetchByIdChunks<{ id: string; line_code: string; name: string }>(
      supabase,
      'lines',
      'id, line_code, name',
      'id',
      lineIds
    )
    const orders = await fetchByIdChunks<{ order_no: string; product_name: string }>(
      supabase,
      'work_orders',
      'order_no, product_name',
      'order_no',
      instructionIds
    )

    const lineMap = new Map(lines.map((line) => [line.id, { code: line.line_code, name: line.name }]))
    const orderMap = new Map(orders.map((order) => [order.order_no, { name: order.product_name }]))

    const lineTotals = new Map<string, number>()
    const instructionTotals = new Map<string, number>()

    for (const item of items) {
      if (item.line_id) {
        lineTotals.set(item.line_id, (lineTotals.get(item.line_id) || 0) + (item.duration_minutes || 0))
      }
      if (item.instruction_text && item.instruction_text.trim()) {
        const key = item.instruction_text.trim()
        instructionTotals.set(key, (instructionTotals.get(key) || 0) + (item.duration_minutes || 0))
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
