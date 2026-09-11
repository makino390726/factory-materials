import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { formatFiscalYearLabel, getCurrentFiscalYear, parseFiscalYearParam } from '@/lib/fiscal-year'
import { saveAnnualModelCost } from '@/lib/heater-model-annual-cost'
import { applyModelRealtimeOverlay, getSavedModelRealtimeCost, isLaborFeePartLabel } from '@/lib/heater-model-realtime-cost'
import { buildLinePartCostUnitMap } from '@/lib/line-part-cost-breakdown'

export const runtime = 'nodejs'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const toNumber = (value: unknown): number => {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

async function buildModelRealtimeSnapshot(model: string) {
  const modelCode = model.trim()
  const { data: bomRows, error: bomError } = await supabase
    .from('heater_bom')
    .select('part_key, part_name, quantity')
    .eq('model', modelCode)

  if (bomError) throw bomError

  const partKeys = [...new Set((bomRows || []).map((row) => String(row.part_key || '').trim()).filter(Boolean))]
  const partsFallbackMap = new Map<
    string,
    {
      cost_price: number | null
      material_cost_total: number | null
      indirect_cost_total: number | null
      part_name: string | null
    }
  >()

  if (partKeys.length > 0) {
    const { data: partsData, error: partsError } = await supabase
      .from('heater_parts_master')
      .select('part_key, part_name, cost_price, material_cost_total, indirect_cost_total')
      .in('part_key', partKeys)
    if (partsError) throw partsError
    for (const part of partsData || []) {
      partsFallbackMap.set(String(part.part_key), {
        cost_price: part.cost_price ?? null,
        material_cost_total: part.material_cost_total ?? null,
        indirect_cost_total: part.indirect_cost_total ?? null,
        part_name: part.part_name ?? null,
      })
    }
  }

  const lineCostMap = await buildLinePartCostUnitMap(supabase, partKeys, partsFallbackMap)
  let material = 0
  let labor = 0
  let indirect = 0
  let total = 0
  let feeLabor = 0
  let feeIndirect = 0
  let hasLaborFeeRow = false

  for (const item of bomRows || []) {
    const partKey = String(item.part_key || '').trim()
    if (!partKey) continue
    const qty = toNumber(item.quantity) || 1
    const unit = lineCostMap.get(partKey)
    const fallback = partsFallbackMap.get(partKey)
    const costPrice = Number(fallback?.cost_price || 0)
    const materialUnit = unit ? Number(unit.material_unit || 0) : Number(fallback?.material_cost_total || 0)
    const laborUnit = unit ? Number(unit.labor_unit || 0) : 0
    const indirectUnit = unit ? Number(unit.indirect_unit || 0) : Number(fallback?.indirect_cost_total || 0)
    const totalUnit = unit
      ? Number(unit.total_unit || materialUnit + laborUnit + indirectUnit)
      : costPrice
    const unitCost = totalUnit || costPrice
    material += materialUnit * qty
    labor += laborUnit * qty
    indirect += indirectUnit * qty
    total += unitCost * qty
    if (isLaborFeePartLabel(partKey, item.part_name, fallback?.part_name)) {
      hasLaborFeeRow = true
      feeLabor += laborUnit * qty
      feeIndirect += indirectUnit * qty
    }
  }

  const current = {
    material_cost: Math.round(material),
    labor_cost: Math.round(labor),
    indirect_cost: Math.round(indirect),
    total_cost: Math.round(total),
  }
  const saved = await getSavedModelRealtimeCost(supabase, modelCode)
  const overlay = saved
    ? applyModelRealtimeOverlay(
        {
          ...current,
          fee_labor_cost: feeLabor,
          fee_indirect_cost: feeIndirect,
          has_labor_fee_row: hasLaborFeeRow,
        },
        saved
      )
    : current

  return {
    model: modelCode,
    realtime_applied: Boolean(saved),
    st_minutes: saved?.st_minutes ?? null,
    applied_label: saved?.applied_label || null,
    material_cost: overlay.material_cost,
    labor_cost: overlay.labor_cost,
    indirect_cost: overlay.indirect_cost,
    total_cost: overlay.total_cost,
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const model = String(body?.model || '').trim()
    if (!model) {
      return NextResponse.json({ error: 'model が必要です' }, { status: 400 })
    }

    const fiscalYear = parseFiscalYearParam(body?.fiscal_year, getCurrentFiscalYear())
    const snapshot = await buildModelRealtimeSnapshot(model)
    if (!snapshot.realtime_applied) {
      return NextResponse.json(
        { error: `機種 ${model} のリアルタイム原価がまだありません。製品パーツ計算で適用してから本年原価に保存してください。` },
        { status: 400 }
      )
    }

    const saved = await saveAnnualModelCost(supabase, {
      model,
      fiscal_year: fiscalYear,
      material_cost: snapshot.material_cost,
      labor_cost: snapshot.labor_cost,
      indirect_cost: snapshot.indirect_cost,
      total_cost: snapshot.total_cost,
      st_minutes: snapshot.st_minutes,
      applied_label: `${formatFiscalYearLabel(fiscalYear)}原価`,
      note: snapshot.applied_label,
    })

    return NextResponse.json({ ok: true, saved })
  } catch (error) {
    console.error('annual-cost POST error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '本年原価の保存に失敗しました' },
      { status: 500 }
    )
  }
}
