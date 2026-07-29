import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  applyCostTemplateToWorkOrder,
  findCostTemplateForWorkOrder,
  setWorkOrderAsCostTemplate,
} from '@/lib/work-order-cost-template'

export const runtime = 'nodejs'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(request: NextRequest) {
  try {
    const workOrderId = request.nextUrl.searchParams.get('work_order_id')?.trim()
    if (!workOrderId) {
      return NextResponse.json({ error: 'work_order_id が必要です' }, { status: 400 })
    }

    const template = await findCostTemplateForWorkOrder(supabase, workOrderId)
    return NextResponse.json({ template })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'テンプレート取得に失敗しました'
    console.error('cost-template GET error:', error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const action = String(body?.action || '')
    const workOrderId = String(body?.work_order_id || '').trim()
    const templateWorkOrderId = String(body?.template_work_order_id || '').trim()

    if (!workOrderId) {
      return NextResponse.json({ error: 'work_order_id が必要です' }, { status: 400 })
    }

    if (action === 'set_template') {
      const enabled = Boolean(body?.enabled)
      const row = await setWorkOrderAsCostTemplate(supabase, workOrderId, enabled)
      return NextResponse.json({ success: true, work_order: row })
    }

    if (action === 'apply_template') {
      const sourceId = templateWorkOrderId || ''
      let resolvedTemplateId = sourceId
      if (!resolvedTemplateId) {
        const found = await findCostTemplateForWorkOrder(supabase, workOrderId)
        if (!found) {
          return NextResponse.json(
            { error: '適用できる原価テンプレートが見つかりません' },
            { status: 404 }
          )
        }
        resolvedTemplateId = found.work_order_id
      }

      const result = await applyCostTemplateToWorkOrder(
        supabase,
        workOrderId,
        resolvedTemplateId
      )
      return NextResponse.json({ success: true, ...result })
    }

    return NextResponse.json({ error: '不明な action です' }, { status: 400 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'テンプレート操作に失敗しました'
    console.error('cost-template POST error:', error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
