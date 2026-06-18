import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  analyzeProcessManagement,
  analyzeProductionLots,
  aggregateTargetWorkGroupSummaryInFiscalYear,
  createProductionLot,
  deleteProductionLot,
  listProcessTargets,
  normalizeTargetCode,
  normalizeWorkDate,
  type ProcessTargetType,
} from '@/lib/process-management'
import { getCurrentFiscalYear } from '@/lib/fiscal-year'

export const runtime = 'nodejs'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

function parseTargetType(value: string | null): ProcessTargetType | null {
  if (value === 'line' || value === 'instruction') return value
  return null
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const list = searchParams.get('list')

    if (list === 'targets') {
      const targets = await listProcessTargets(supabase)
      return NextResponse.json({ targets })
    }

    if (list === 'fiscal-work-groups') {
      const targetType =
        parseTargetType(searchParams.get('target_type')) ?? 'line'
      const targetCode =
        searchParams.get('target_code')?.trim() ||
        searchParams.get('line_code')?.trim()
      const fiscalYearRaw = searchParams.get('fiscal_year')
      const fiscalYear = fiscalYearRaw ? Number(fiscalYearRaw) : getCurrentFiscalYear()

      if (!targetCode) {
        return NextResponse.json({ error: 'target_code が必要です' }, { status: 400 })
      }
      if (!Number.isFinite(fiscalYear)) {
        return NextResponse.json({ error: 'fiscal_year が不正です' }, { status: 400 })
      }

      const result = await aggregateTargetWorkGroupSummaryInFiscalYear(
        supabase,
        targetType,
        normalizeTargetCode(targetCode),
        fiscalYear
      )
      return NextResponse.json(result)
    }

    if (list === 'production-lots') {
      const targetType = parseTargetType(searchParams.get('target_type'))
      const targetCode = searchParams.get('target_code')?.trim()

      if (!targetType) {
        return NextResponse.json({ error: 'target_type が必要です' }, { status: 400 })
      }
      if (!targetCode) {
        return NextResponse.json({ error: 'target_code が必要です' }, { status: 400 })
      }

      const result = await analyzeProductionLots(supabase, targetType, targetCode)
      return NextResponse.json(result)
    }

    const workDate = searchParams.get('work_date')?.trim()
    const targetType = parseTargetType(searchParams.get('target_type'))
    const targetCode = searchParams.get('target_code')?.trim()

    if (!workDate) {
      return NextResponse.json({ error: 'work_date が必要です' }, { status: 400 })
    }
    if (!targetType) {
      return NextResponse.json({ error: 'target_type が必要です' }, { status: 400 })
    }
    if (!targetCode) {
      return NextResponse.json({ error: 'target_code が必要です' }, { status: 400 })
    }

    const result = await analyzeProcessManagement(
      supabase,
      normalizeWorkDate(workDate),
      targetType,
      targetCode
    )
    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : '工程管理の取得に失敗しました'
    console.error('工程管理GETエラー:', error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const targetType = parseTargetType(String(body?.target_type || ''))
    const targetCode = String(body?.target_code || '').trim()
    const periodEnd = String(body?.period_end || body?.work_date || '').trim()
    const completedQty = Number(body?.completed_qty)
    const receiptSlipNo = body?.receipt_slip_no ? String(body.receipt_slip_no) : null
    const notes = body?.notes ? String(body.notes) : null

    if (!targetType) {
      return NextResponse.json({ error: 'target_type が必要です' }, { status: 400 })
    }
    if (!targetCode) {
      return NextResponse.json({ error: 'target_code が必要です' }, { status: 400 })
    }
    if (!periodEnd) {
      return NextResponse.json({ error: 'period_end（完成日）が必要です' }, { status: 400 })
    }
    if (!Number.isFinite(completedQty) || completedQty <= 0) {
      return NextResponse.json({ error: 'completed_qty は1以上の数値です' }, { status: 400 })
    }

    await createProductionLot(
      supabase,
      targetType,
      targetCode,
      normalizeWorkDate(periodEnd),
      completedQty,
      receiptSlipNo,
      notes
    )

    const result = await analyzeProductionLots(
      supabase,
      targetType,
      normalizeTargetCode(targetCode)
    )
    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : '製作ロットの保存に失敗しました'
    console.error('工程管理POSTエラー:', error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const lotId = searchParams.get('lot_id')?.trim()
    if (!lotId) {
      return NextResponse.json({ error: 'lot_id が必要です' }, { status: 400 })
    }

    await deleteProductionLot(supabase, lotId)
    return NextResponse.json({ success: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : '製作ロットの削除に失敗しました'
    console.error('工程管理DELETEエラー:', error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
