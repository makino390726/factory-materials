import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getCurrentFiscalYear } from '@/lib/fiscal-year'
import {
  buildProductionSchedule,
  listSavedProductionSchedules,
  loadSavedProductionSchedule,
  saveProductionSchedule,
  suggestTargetsForModel,
  type ScheduleLotInput,
  type SavedScheduleLotInput,
} from '@/lib/production-schedule'
import { listProcessTargets, normalizeSpecKey, type ProcessTargetType } from '@/lib/process-management'

export const runtime = 'nodejs'
export const maxDuration = 120

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

function parseTargetType(value: unknown): ProcessTargetType | null {
  if (value === 'line' || value === 'instruction') return value
  return null
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const list = searchParams.get('list')

    if (list === 'schedules') {
      const schedules = await listSavedProductionSchedules(supabase)
      return NextResponse.json({ schedules })
    }

    if (list === 'schedule') {
      const id = searchParams.get('id')?.trim()
      if (!id) {
        return NextResponse.json({ error: 'id が必要です' }, { status: 400 })
      }
      const schedule = await loadSavedProductionSchedule(supabase, id)
      return NextResponse.json({ schedule })
    }

    if (list === 'plans') {
      const { data, error } = await supabase
        .from('heater_manufacturing_plans')
        .select('id, plan_name, fiscal_year, plan_period, created_at')
        .order('created_at', { ascending: false })
      if (error) throw error
      return NextResponse.json({ plans: data || [] })
    }

    if (list === 'plan-details') {
      const planId = searchParams.get('plan_id')?.trim()
      if (!planId) {
        return NextResponse.json({ error: 'plan_id が必要です' }, { status: 400 })
      }
      const { data, error } = await supabase
        .from('heater_manufacturing_plan_details')
        .select('model, quantity')
        .eq('plan_id', planId)
        .gt('quantity', 0)
        .order('model', { ascending: true })
      if (error) throw error

      const details = []
      for (const row of data || []) {
        const suggestions = await suggestTargetsForModel(supabase, String(row.model || ''))
        details.push({
          model: row.model,
          quantity: row.quantity,
          suggested_notes: normalizeSpecKey(String(row.model || '')) || null,
          suggested_target: suggestions[0] || null,
          suggestions,
        })
      }
      return NextResponse.json({ details })
    }

    if (list === 'targets') {
      const targets = await listProcessTargets(supabase)
      return NextResponse.json({ targets })
    }

    if (list === 'suggest') {
      const model = searchParams.get('model')?.trim() || ''
      const suggestions = await suggestTargetsForModel(supabase, model)
      return NextResponse.json({ suggestions })
    }

    return NextResponse.json({
      fiscal_year: getCurrentFiscalYear(),
      hint: 'list=schedules | schedule | plans | plan-details | targets | suggest',
    })
  } catch (error) {
    console.error('production-schedule GET error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '取得に失敗しました' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const action = String(body.action || 'calculate').trim()

    if (action === 'save') {
      if (!body.result || typeof body.result !== 'object') {
        return NextResponse.json({ error: 'result が必要です' }, { status: 400 })
      }
      const rawLots = Array.isArray(body.lots) ? body.lots : []
      const lots: SavedScheduleLotInput[] = []
      for (const raw of rawLots) {
        const targetType = parseTargetType(raw?.target_type)
        const targetCode = String(raw?.target_code || '').trim()
        const quantity = Number(raw?.quantity)
        if (!targetType || !targetCode || !Number.isFinite(quantity) || quantity <= 0) continue
        lots.push({
          key: String(raw?.key || `${targetType}:${targetCode}:${raw?.model || ''}`),
          model: String(raw?.model || targetCode),
          quantity,
          sequence: Number(raw?.sequence) || lots.length + 1,
          target_type: targetType,
          target_code: targetCode,
          label: raw?.label ? String(raw.label) : null,
          notes: raw?.notes != null && String(raw.notes).trim() ? String(raw.notes).trim() : null,
          suggestions: Array.isArray(raw?.suggestions) ? raw.suggestions : undefined,
        })
      }

      const saved = await saveProductionSchedule(supabase, {
        start_date: String(body.start_date || body.result.start_date || ''),
        minutes_per_day: Number(body.minutes_per_day || body.result.minutes_per_day) || 480,
        fiscal_year: Number(body.fiscal_year || body.result.fiscal_year) || getCurrentFiscalYear(),
        source_plan_id: body.source_plan_id ? String(body.source_plan_id) : null,
        source_plan_name: body.source_plan_name ? String(body.source_plan_name) : null,
        lots,
        result: body.result,
      })
      return NextResponse.json({ schedule: saved })
    }

    const startDate = String(body.start_date || '').trim()
    if (!startDate) {
      return NextResponse.json({ error: 'start_date が必要です' }, { status: 400 })
    }

    const rawLots = Array.isArray(body.lots) ? body.lots : []
    const lots: ScheduleLotInput[] = []
    for (const raw of rawLots) {
      const targetType = parseTargetType(raw?.target_type)
      const targetCode = String(raw?.target_code || '').trim()
      const quantity = Number(raw?.quantity)
      if (!targetType || !targetCode || !Number.isFinite(quantity) || quantity <= 0) continue
      lots.push({
        key: String(raw?.key || `${targetType}:${targetCode}:${raw?.model || ''}`),
        model: String(raw?.model || targetCode),
        quantity,
        sequence: Number(raw?.sequence) || lots.length + 1,
        target_type: targetType,
        target_code: targetCode,
        label: raw?.label ? String(raw.label) : null,
        notes: raw?.notes != null && String(raw.notes).trim() ? String(raw.notes).trim() : null,
      })
    }

    const result = await buildProductionSchedule(supabase, {
      start_date: startDate,
      minutes_per_day: body.minutes_per_day ? Number(body.minutes_per_day) : undefined,
      fiscal_year: body.fiscal_year ? Number(body.fiscal_year) : undefined,
      lots,
    })

    return NextResponse.json(result)
  } catch (error) {
    console.error('production-schedule POST error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'スケジュール算出に失敗しました' },
      { status: 500 }
    )
  }
}
