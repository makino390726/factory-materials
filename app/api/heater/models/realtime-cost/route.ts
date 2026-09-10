import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { formatFiscalYearLabel, getCurrentFiscalYear } from '@/lib/fiscal-year'
import {
  calcLaborCostFromMinutes,
  calcLaborIndirectFromLabor,
  UNIT_LABOR_COST,
  UNIT_MINUTES,
} from '@/lib/line-part-labor-cost'
import {
  getSavedModelRealtimeCost,
  saveModelRealtimeCost,
} from '@/lib/heater-model-realtime-cost'
import {
  getFiscalYearAverageStByWorkGroupForSpec,
  listLinkedInstructionsForModel,
  listProcessScheduleStSourcesByModel,
  listProcessTargets,
  normalizeTargetCode,
  sumFiscalAverageStMinutes,
  type FiscalYearWorkGroupSummary,
  type ProcessTargetType,
} from '@/lib/process-management'

export const runtime = 'nodejs'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

type WorkGroupSt = {
  work_group_code: string
  work_group_name: string
  avg_st_minutes: number
}

type CandidateRelation = 'self' | 'linked' | 'field' | 'family' | 'schedule' | 'other'

export type RealtimeCostCandidate = {
  id: string
  target_type: ProcessTargetType
  target_code: string
  target_name: string
  fiscal_year: number
  fiscal_year_label: string
  st_minutes: number
  labor_cost: number
  indirect_cost: number
  model_labor_total: number
  annual_completed_qty: number
  formula: string
  relation: CandidateRelation
  relation_label: string
  applied_label: string
  note: string | null
  work_groups: WorkGroupSt[]
}

function workGroupsFromSummary(summary: FiscalYearWorkGroupSummary | null | undefined): WorkGroupSt[] {
  if (!summary) return []
  return summary.rows
    .filter((row) => row.avg_st_minutes != null && row.avg_st_minutes > 0)
    .map((row) => ({
      work_group_code: row.work_group_code,
      work_group_name: row.work_group_name,
      avg_st_minutes: Number(row.avg_st_minutes),
    }))
}

function preferredFiscalYears(scheduleYears: number[]): number[] {
  const currentFy = getCurrentFiscalYear()
  return [
    ...new Set(
      [...scheduleYears.filter((y) => Number.isFinite(y) && y > 0), currentFy, currentFy - 1, currentFy - 2]
    ),
  ]
}

function containsModelToken(text: string, alias: string): boolean {
  const t = String(text || '').replace(/\s+/g, '')
  const a = String(alias || '').replace(/\s+/g, '')
  if (!t || !a) return false
  let from = 0
  while (from < t.length) {
    const idx = t.toLowerCase().indexOf(a.toLowerCase(), from)
    if (idx < 0) return false
    const after = t[idx + a.length] || ''
    if (!/[A-Za-z0-9]/.test(after)) return true
    from = idx + 1
  }
  return false
}

function familyModelsFromText(text: string): string[] {
  const t = String(text || '').replace(/\s+/g, '')
  const found = new Set<string>()
  const mixed = t.match(/SP-?(\d{2,4})[,・\/](\d{2,4})(AT|A)?/i)
  if (mixed) {
    const suffix = (mixed[3] || '').toUpperCase()
    found.add(`${mixed[1]}${suffix}`)
    found.add(`${mixed[2]}${suffix}`)
  }
  return Array.from(found)
}

function buildModelAliases(model: string, modelName: string | null): string[] {
  const aliases = new Set<string>([model])
  const name = String(modelName || '')
  const sp = name.match(/SP[-‐]?\s*[A-Z0-9]+/i)
  if (sp) aliases.add(sp[0].replace(/\s+/g, ''))
  if (/^\d/.test(model)) aliases.add(`SP-${model}`)
  return Array.from(aliases)
}

function relationLabel(relation: CandidateRelation): string {
  switch (relation) {
    case 'self':
      return '選択中の機種'
    case 'linked':
      return '機種に紐づくD指令'
    case 'field':
      return '型式・品名が一致'
    case 'family':
      return '関連機種のD指令'
    case 'schedule':
      return 'スケジュール適用'
    default:
      return 'その他（平均STあり）'
  }
}

function appliedLabel(targetType: ProcessTargetType, targetCode: string): string {
  if (targetType === 'model') return `機種 ${targetCode} の年間平均`
  if (targetType === 'line') return `L指令 ${targetCode} の年間平均`
  return `D指令 ${targetCode} の年間平均`
}

function toCandidate(
  targetType: ProcessTargetType,
  targetCode: string,
  targetName: string,
  relation: CandidateRelation,
  resolved: { minutes: number; fiscal_year: number; summary: FiscalYearWorkGroupSummary }
): RealtimeCostCandidate {
  const minutes = Math.round(resolved.minutes)
  const laborCost = calcLaborCostFromMinutes(minutes)
  const indirectCost = calcLaborIndirectFromLabor(laborCost)
  return {
    id: `${targetType}:${targetCode}:${resolved.fiscal_year}`,
    target_type: targetType,
    target_code: targetCode,
    target_name: targetName,
    fiscal_year: resolved.fiscal_year,
    fiscal_year_label: formatFiscalYearLabel(resolved.fiscal_year),
    st_minutes: minutes,
    labor_cost: laborCost,
    indirect_cost: indirectCost,
    model_labor_total: laborCost + indirectCost,
    annual_completed_qty: Number(resolved.summary.annual_completed_qty || 0),
    formula: `(${minutes}分 ÷ ${UNIT_MINUTES}) × ¥${UNIT_LABOR_COST.toLocaleString('ja-JP')}`,
    relation,
    relation_label: relationLabel(relation),
    applied_label: appliedLabel(targetType, targetCode),
    note: resolved.summary.st_aggregation_note || null,
    work_groups: workGroupsFromSummary(resolved.summary),
  }
}

async function resolveTargetFiscalSt(
  targetType: ProcessTargetType,
  targetCode: string,
  years: number[]
): Promise<{
  minutes: number
  fiscal_year: number
  summary: FiscalYearWorkGroupSummary
} | null> {
  for (const fiscalYear of years) {
    const { map, summary } = await getFiscalYearAverageStByWorkGroupForSpec(
      supabase,
      targetType,
      targetCode,
      fiscalYear,
      null
    )
    const minutes = sumFiscalAverageStMinutes(map)
    if (minutes <= 0) continue
    return { minutes, fiscal_year: fiscalYear, summary }
  }
  return null
}

async function listRelatedDOrders(model: string): Promise<
  Array<{ order_no: string; product_name: string | null; reason: Exclude<CandidateRelation, 'self' | 'other'> }>
> {
  const linked = await listLinkedInstructionsForModel(supabase, model)
  const seen = new Set<string>()
  const rows: Array<{
    order_no: string
    product_name: string | null
    reason: Exclude<CandidateRelation, 'self' | 'other'>
  }> = []

  for (const item of linked) {
    const orderNo = normalizeTargetCode(item.order_no)
    if (!orderNo || seen.has(orderNo)) continue
    seen.add(orderNo)
    rows.push({ order_no: orderNo, product_name: item.product_name, reason: 'linked' })
  }

  const { data: heater } = await supabase
    .from('heater_models')
    .select('model, name')
    .eq('model', model)
    .maybeSingle()
  const aliases = buildModelAliases(model, heater?.name ?? null)

  let ordersQuery = await supabase
    .from('work_orders')
    .select('order_no, product_name, model, bom_model, heater_model')
    .order('order_no', { ascending: true })
  if (ordersQuery.error && String(ordersQuery.error.message || '').includes('heater_model')) {
    ordersQuery = await supabase
      .from('work_orders')
      .select('order_no, product_name, model, bom_model')
      .order('order_no', { ascending: true })
  }
  if (ordersQuery.error) throw ordersQuery.error

  for (const order of ordersQuery.data || []) {
    const orderNo = normalizeTargetCode(String(order.order_no || ''))
    if (!orderNo || seen.has(orderNo)) continue
    const haystack = [order.heater_model, order.model, order.bom_model, order.product_name]
      .map((v) => String(v || ''))
      .join(' ')
    if (
      String(order.heater_model || '').trim() === model ||
      aliases.some((alias) => containsModelToken(haystack, alias))
    ) {
      seen.add(orderNo)
      rows.push({ order_no: orderNo, product_name: order.product_name ?? null, reason: 'field' })
      continue
    }
    if (familyModelsFromText(haystack).includes(model)) {
      seen.add(orderNo)
      rows.push({ order_no: orderNo, product_name: order.product_name ?? null, reason: 'family' })
    }
  }

  return rows
}

async function listRealtimeCostCandidates(model: string): Promise<RealtimeCostCandidate[]> {
  const scheduleSources = await listProcessScheduleStSourcesByModel(supabase, model)
  const years = preferredFiscalYears(scheduleSources.map((row) => Number(row.fiscal_year)))
  const pending = new Map<
    string,
    { target_type: ProcessTargetType; target_code: string; target_name: string; relation: CandidateRelation }
  >()

  const addPending = (
    targetType: ProcessTargetType,
    targetCode: string,
    targetName: string,
    relation: CandidateRelation
  ) => {
    const code = normalizeTargetCode(targetCode)
    if (!code) return
    const key = `${targetType}:${code}`
    const current = pending.get(key)
    const rank = (r: CandidateRelation) =>
      r === 'self' ? 5 : r === 'schedule' ? 4 : r === 'linked' ? 3 : r === 'field' ? 2 : r === 'family' ? 1 : 0
    if (!current || rank(relation) > rank(current.relation)) {
      pending.set(key, { target_type: targetType, target_code: code, target_name: targetName, relation })
    }
  }

  addPending('model', model, model, 'self')

  for (const row of scheduleSources) {
    addPending(
      row.target_type,
      row.target_code,
      row.target_code,
      'schedule'
    )
  }

  for (const order of await listRelatedDOrders(model)) {
    addPending(
      'instruction',
      order.order_no,
      order.product_name ? `${order.order_no} ${order.product_name}` : order.order_no,
      order.reason
    )
  }

  const targets = await listProcessTargets(supabase)
  for (const target of targets) {
    if (target.target_type !== 'model') continue
    if ((target.lot_count || 0) <= 0) continue
    addPending(
      'model',
      target.target_code,
      target.name ? `${target.target_code} ${target.name}` : target.target_code,
      'other'
    )
  }

  const resolved = await Promise.all(
    Array.from(pending.values()).map(async (item) => {
      const hit = await resolveTargetFiscalSt(item.target_type, item.target_code, years)
      if (!hit) return null
      return toCandidate(item.target_type, item.target_code, item.target_name, item.relation, hit)
    })
  )

  const relationRank = (r: CandidateRelation) =>
    r === 'self' ? 5 : r === 'schedule' ? 4 : r === 'linked' ? 3 : r === 'field' ? 2 : r === 'family' ? 1 : 0

  return resolved
    .filter((row): row is RealtimeCostCandidate => Boolean(row && row.st_minutes > 0))
    .sort((a, b) => {
      const rel = relationRank(b.relation) - relationRank(a.relation)
      if (rel !== 0) return rel
      if (b.annual_completed_qty !== a.annual_completed_qty) {
        return b.annual_completed_qty - a.annual_completed_qty
      }
      return b.st_minutes - a.st_minutes
    })
}

/**
 * GET /api/heater/models/realtime-cost?model=SGR-300
 * 平均STがある工程管理対象を一覧する。適用は画面で選択する。
 */
export async function GET(request: NextRequest) {
  try {
    const model = request.nextUrl.searchParams.get('model')?.trim() || ''
    if (!model) {
      return NextResponse.json({ error: 'model が必要です' }, { status: 400 })
    }

    if (request.nextUrl.searchParams.get('saved') === '1') {
      const saved = await getSavedModelRealtimeCost(supabase, model)
      return NextResponse.json({ model, saved })
    }

    const [candidates, saved] = await Promise.all([
      listRealtimeCostCandidates(model),
      getSavedModelRealtimeCost(supabase, model),
    ])
    if (candidates.length === 0 && !saved) {
      return NextResponse.json(
        {
          error: `機種 ${model} に関連する工程管理対象で、平均STがあるものがありません`,
          model,
          candidates: [],
          saved: null,
        },
        { status: 404 }
      )
    }

    return NextResponse.json({
      model,
      display_only: false,
      candidates,
      saved,
    })
  } catch (error) {
    console.error('realtime-cost GET error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'リアルタイム原価の候補取得に失敗しました' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const model = String(body?.model || '').trim()
    if (!model) {
      return NextResponse.json({ error: 'model が必要です' }, { status: 400 })
    }
    const saved = await saveModelRealtimeCost(supabase, {
      model,
      st_minutes: Number(body.st_minutes || 0),
      labor_cost: Number(body.labor_cost || 0),
      indirect_cost: Number(body.indirect_cost || 0),
      applied_label: body.applied_label || null,
      formula: body.formula || null,
      fiscal_year_label: body.fiscal_year_label || null,
      target_type: body.target_type || null,
      target_code: body.target_code || null,
      note: body.note || null,
    })
    return NextResponse.json({ ok: true, saved })
  } catch (error) {
    console.error('realtime-cost POST error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'リアルタイム原価の保存に失敗しました' },
      { status: 500 }
    )
  }
}
