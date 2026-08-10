import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  analyzeProcessManagement,
  analyzeProductionLots,
  aggregateTargetWorkGroupSummariesBySpecInFiscalYear,
  createProductionLot,
  deleteProductionLot,
  getProcessScheduleStSource,
  listLinkedInstructionsForModel,
  listModelsForProcessTarget,
  listProcessScheduleStSources,
  listProcessTargets,
  normalizeTargetCode,
  normalizeWorkDate,
  resolveTargetStandardDurationMinutes,
  setProcessScheduleStSource,
  type ProcessTargetType,
} from '@/lib/process-management'
import { getCurrentFiscalYear } from '@/lib/fiscal-year'

export const runtime = 'nodejs'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

function parseTargetType(value: string | null): ProcessTargetType | null {
  if (value === 'line' || value === 'instruction' || value === 'model') return value
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

    if (list === 'linked-instructions') {
      const model = searchParams.get('model')?.trim() || ''
      if (!model) {
        return NextResponse.json({ error: 'model が必要です' }, { status: 400 })
      }
      const linked = await listLinkedInstructionsForModel(supabase, model)
      return NextResponse.json({ model, instructions: linked })
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

      const normalizedCode = normalizeTargetCode(targetCode)
      const model = searchParams.get('model')?.trim() || ''
      const [{ overall, by_spec }, scheduleStSources, scheduleModels] = await Promise.all([
        aggregateTargetWorkGroupSummariesBySpecInFiscalYear(
          supabase,
          targetType,
          normalizedCode,
          fiscalYear
        ),
        listProcessScheduleStSources(supabase, targetType, normalizedCode),
        listModelsForProcessTarget(supabase, targetType, normalizedCode),
      ])
      const scheduleStSource = model
        ? scheduleStSources.find((row) => row.model === model) ?? null
        : null
      return NextResponse.json({
        ...overall,
        by_spec,
        schedule_st_source: scheduleStSource,
        schedule_st_sources: scheduleStSources,
        schedule_models: scheduleModels,
      })
    }

    if (list === 'schedule-st-source') {
      const targetType = parseTargetType(searchParams.get('target_type'))
      const targetCode = searchParams.get('target_code')?.trim()
      const model = searchParams.get('model')?.trim() || ''
      if (!targetType) {
        return NextResponse.json({ error: 'target_type が必要です' }, { status: 400 })
      }
      if (!targetCode) {
        return NextResponse.json({ error: 'target_code が必要です' }, { status: 400 })
      }
      const normalizedCode = normalizeTargetCode(targetCode)
      const [source, sources] = await Promise.all([
        getProcessScheduleStSource(supabase, targetType, normalizedCode, model || null),
        listProcessScheduleStSources(supabase, targetType, normalizedCode),
      ])
      return NextResponse.json({
        schedule_st_source: source,
        schedule_st_sources: sources,
      })
    }

    if (list === 'schedule-models') {
      const targetType = parseTargetType(searchParams.get('target_type'))
      const targetCode = searchParams.get('target_code')?.trim()
      if (!targetType) {
        return NextResponse.json({ error: 'target_type が必要です' }, { status: 400 })
      }
      if (!targetCode) {
        return NextResponse.json({ error: 'target_code が必要です' }, { status: 400 })
      }
      const models = await listModelsForProcessTarget(
        supabase,
        targetType,
        normalizeTargetCode(targetCode)
      )
      return NextResponse.json({ models })
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

    if (body?.action === 'set-schedule-st-source') {
      const targetType = parseTargetType(String(body?.target_type || ''))
      const targetCode = String(body?.target_code || '').trim()
      const model = String(body?.model || '').trim()
      const fiscalYear = Number(body?.fiscal_year)
      const apply = Boolean(body?.apply_to_schedule)
      const specKey =
        body?.spec_key === undefined || body?.spec_key === null
          ? ''
          : String(body.spec_key)

      if (!targetType) {
        return NextResponse.json({ error: 'target_type が必要です' }, { status: 400 })
      }
      if (!targetCode) {
        return NextResponse.json({ error: 'target_code が必要です' }, { status: 400 })
      }
      if (!model) {
        return NextResponse.json({ error: '適用する機種を指定してください' }, { status: 400 })
      }

      const source = await setProcessScheduleStSource(supabase, {
        target_type: targetType,
        target_code: targetCode,
        model,
        fiscal_year: fiscalYear,
        spec_key: specKey === '__ALL__' ? '' : specKey,
        apply_to_schedule: apply,
      })
      const sources = await listProcessScheduleStSources(
        supabase,
        targetType,
        normalizeTargetCode(targetCode)
      )
      const standardDuration = apply
        ? await resolveTargetStandardDurationMinutes(
            supabase,
            targetType,
            normalizeTargetCode(targetCode),
            {
              fiscalYear,
              specKey: specKey === '__ALL__' ? '' : specKey,
              model,
            }
          )
        : null
      return NextResponse.json({
        success: true,
        schedule_st_source: source,
        schedule_st_sources: sources,
        standard_duration: standardDuration,
      })
    }

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

    const lotResult = await createProductionLot(
      supabase,
      targetType,
      targetCode,
      normalizeWorkDate(periodEnd),
      completedQty,
      receiptSlipNo,
      notes
    )

    // 重い全ロット再集計はクライアント側の GET に分離し、保存レスポンスを速く返す
    return NextResponse.json({
      success: true,
      lot_id: lotResult.lot_id,
      target_type: targetType,
      target_code: normalizeTargetCode(targetCode),
      period_start: lotResult.period_start,
      period_end: lotResult.period_end,
      assembly_labor: lotResult.assembly_labor,
    })
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
