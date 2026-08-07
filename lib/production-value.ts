import type { SupabaseClient } from '@supabase/supabase-js'
import { buildLinePartCostUnitMap } from '@/lib/line-part-cost-breakdown'
import { aggregateWorkOrderSavedCost } from '@/lib/work-order-bom-cost-aggregate'
import {
  formatFiscalYearLabel,
  getFiscalYearDateRange,
  getFiscalYearFromDate,
} from '@/lib/fiscal-year'
import { normalizeSpecKey } from '@/lib/process-management'

/** 暖房機完成ロットとして扱う L指令コード */
export const HEATER_PRODUCTION_LINE_CODES = ['903', '904', '905', '906', '907', '908', '909'] as const

export type ProductionValuePeriodMode = 'month' | 'year'

export type UnitCostBreakdown = {
  material: number
  labor: number
  indirect: number
  total: number
  source: 'order' | 'model_bom' | 'none'
}

export type ProductionValueOrderRow = {
  order_no: string
  work_order_id: string | null
  model: string
  model_display: string
  product_name: string | null
  completed_qty: number
  lot_count: number
  unit_material: number
  unit_labor: number
  unit_indirect: number
  unit_total: number
  material_amount: number
  labor_amount: number
  indirect_amount: number
  total_amount: number
  has_saved_cost: boolean
  period_end_from: string | null
  period_end_to: string | null
}

export type ProductionValueModelRow = {
  model: string
  model_display: string
  model_name: string | null
  spec_key: string
  source: 'heater_line' | 'd_order' | 'mixed'
  completed_qty: number
  lot_count: number
  unit_material: number
  unit_labor: number
  unit_indirect: number
  unit_total: number
  material_amount: number
  labor_amount: number
  indirect_amount: number
  total_amount: number
  cost_source: 'order' | 'model_bom' | 'mixed' | 'none'
}

export type ProductionValueResult = {
  period_mode: ProductionValuePeriodMode
  year: number
  month: number | null
  period_label: string
  date_from: string
  date_to: string
  order_rows: ProductionValueOrderRow[]
  model_rows: ProductionValueModelRow[]
  totals: {
    completed_qty: number
    material_amount: number
    labor_amount: number
    indirect_amount: number
    total_amount: number
  }
  warnings: string[]
}

type LotRow = {
  id: string
  target_type: 'line' | 'instruction'
  target_code: string
  period_end: string
  completed_qty: number
  notes: string | null
}

type HeaterModelRef = {
  model: string
  name: string | null
}

function toNum(v: unknown) {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

function roundYen(n: number) {
  return Math.round(n || 0)
}

function inDateRange(dateStr: string, from: string, to: string) {
  return dateStr >= from && dateStr <= to
}

export function resolveProductionValueDateRange(
  mode: ProductionValuePeriodMode,
  year: number,
  month?: number | null
) {
  if (mode === 'year') {
    const range = getFiscalYearDateRange(year)
    return {
      date_from: range.start,
      date_to: range.end,
      period_label: formatFiscalYearLabel(year),
      year,
      month: null as number | null,
    }
  }

  const m = Number(month || 1)
  const padded = String(m).padStart(2, '0')
  const lastDay = new Date(year, m, 0).getDate()
  return {
    date_from: `${year}-${padded}-01`,
    date_to: `${year}-${padded}-${String(lastDay).padStart(2, '0')}`,
    period_label: `${year}年${m}月`,
    year,
    month: m,
  }
}

type ScheduleModelHint = {
  target_code: string
  model: string
  spec_key: string
}

function normalizeModelToken(value: string) {
  return String(value || '')
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/-/g, '')
}

/** 表示用: 400L-DF → SK400L-DF、既にSK付きならそのまま */
export function formatHeaterModelDisplay(
  model: string,
  modelName?: string | null
): string {
  const code = String(model || '').trim()
  if (!code || code === '未設定') return code || '未設定'
  if (/^(UF|DF)$/i.test(code)) {
    // 規格だけ残っている場合は品名から機種を拾う
    const fromName = String(modelName || '').match(/SK[- ]?\d+\s*L[- ]?(UF|DF)/i)
    if (fromName) {
      return fromName[0].replace(/\s+/g, '').replace(/SK-/i, 'SK').toUpperCase()
    }
    return code.toUpperCase()
  }
  if (/^SK/i.test(code)) {
    return code.replace(/\s+/g, '')
  }
  // 400L-DF / 600LM-DF → SK400L-DF
  if (/^\d+[A-Z]*L(-|)?(UF|DF)$/i.test(code.replace(/\s+/g, ''))) {
    return `SK${code.replace(/\s+/g, '')}`
  }
  const fromName = String(modelName || '').match(/SK[- ]?[A-Z0-9]+-?(UF|DF)?/i)
  if (fromName) {
    return fromName[0].replace(/\s+/g, '').replace(/SK-/i, 'SK')
  }
  return code
}

function findModelByFlexibleToken(
  token: string,
  models: HeaterModelRef[]
): HeaterModelRef | null {
  const compact = normalizeModelToken(token)
  if (!compact) return null

  const exact = models.find((m) => normalizeModelToken(m.model) === compact)
  if (exact) return exact

  // SK400LDF / SK-400L-DF → 400L-DF
  const withoutSk = compact.startsWith('SK') ? compact.slice(2) : compact
  const byCode = models.find((m) => normalizeModelToken(m.model) === withoutSk)
  if (byCode) return byCode

  const byContains = models
    .map((m) => ({ m, key: normalizeModelToken(m.model) }))
    .filter((x) => x.key && (compact.includes(x.key) || withoutSk.includes(x.key) || x.key.includes(withoutSk)))
    .sort((a, b) => b.key.length - a.key.length)[0]
  if (byContains) return byContains.m

  const byName = models.find((m) => normalizeModelToken(m.name || '').includes(compact) || normalizeModelToken(m.name || '').includes(withoutSk))
  return byName || null
}

function withSpecSibling(
  modelCode: string,
  spec: 'UF' | 'DF',
  models: HeaterModelRef[]
): HeaterModelRef | null {
  const base = String(modelCode || '').replace(/[-_]?(UF|DF)$/i, '')
  if (!base) return null
  const candidates = [
    `${base}-${spec}`,
    `${base}${spec}`,
    `${base}_${spec}`,
  ]
  for (const c of candidates) {
    const hit = models.find((m) => normalizeModelToken(m.model) === normalizeModelToken(c))
    if (hit) return hit
  }
  return (
    models.find((m) => {
      const key = normalizeModelToken(m.model)
      return key.startsWith(normalizeModelToken(base)) && key.endsWith(spec)
    }) || null
  )
}

/** 備考（UF/DF/SK400L-DF 等）から機種を解決 */
export function resolveModelFromLotNotes(
  notes: string | null | undefined,
  models: HeaterModelRef[],
  options?: {
    lineCode?: string
    scheduleHints?: ScheduleModelHint[]
  }
): { model: string; model_name: string | null; spec_key: string; display: string } {
  const raw = String(notes || '').trim()
  const spec = normalizeSpecKey(raw) || ''
  const lineCode = String(options?.lineCode || '').trim()
  const hints = (options?.scheduleHints || []).filter(
    (h) => !lineCode || h.target_code === lineCode
  )

  if (!raw) {
    // 備考なし → 当該Lのスケジュール適用機種（最新）
    const hint = hints[0]
    if (hint?.model) {
      const hit = findModelByFlexibleToken(hint.model, models)
      const model = hit?.model || hint.model
      const model_name = hit?.name || null
      return {
        model,
        model_name,
        spec_key: hint.spec_key || '',
        display: formatHeaterModelDisplay(model, model_name),
      }
    }
    return { model: '未設定', model_name: null, spec_key: '', display: '未設定' }
  }

  // 1) 備考そのものが機種コード（SK400L-DF / 400L-DF 等）
  const flexible = findModelByFlexibleToken(raw, models)
  if (flexible && !/^(UF|DF)$/i.test(raw)) {
    return {
      model: flexible.model,
      model_name: flexible.name,
      spec_key: spec || normalizeSpecKey(flexible.model),
      display: formatHeaterModelDisplay(flexible.model, flexible.name),
    }
  }

  // 2) 備考が UF/DF のみ → スケジュール適用機種 + 規格で兄弟機種を解決
  if (spec === 'UF' || spec === 'DF') {
    const hintSameSpec =
      hints.find((h) => (h.spec_key || normalizeSpecKey(h.model)) === spec) ||
      hints[0]

    if (hintSameSpec?.model) {
      const sibling =
        withSpecSibling(hintSameSpec.model, spec, models) ||
        findModelByFlexibleToken(hintSameSpec.model, models)
      if (sibling) {
        const resolved =
          normalizeSpecKey(sibling.model) === spec
            ? sibling
            : withSpecSibling(sibling.model, spec, models) || sibling
        return {
          model: resolved.model,
          model_name: resolved.name,
          spec_key: spec,
          display: formatHeaterModelDisplay(resolved.model, resolved.name),
        }
      }
    }

    // 3) 同規格の機種が1件だけなら採用
    const candidates = models.filter((m) => {
      const code = String(m.model).toUpperCase()
      return code.endsWith(`-${spec}`) || code.endsWith(spec)
    })
    if (candidates.length === 1) {
      return {
        model: candidates[0].model,
        model_name: candidates[0].name,
        spec_key: spec,
        display: formatHeaterModelDisplay(candidates[0].model, candidates[0].name),
      }
    }
  }

  // 最終フォールバック: 規格だけの表示は避け、可能な限り機種コード化
  if (spec === 'UF' || spec === 'DF') {
    return {
      model: raw,
      model_name: null,
      spec_key: spec,
      display: raw.toUpperCase(),
    }
  }

  return {
    model: raw,
    model_name: null,
    spec_key: spec,
    display: formatHeaterModelDisplay(raw, null),
  }
}

async function loadLotsInRange(
  supabase: SupabaseClient,
  dateFrom: string,
  dateTo: string
): Promise<LotRow[]> {
  const { data, error } = await supabase
    .from('process_production_lots')
    .select(
      'id, target_type, target_code, period_end, completed_qty, notes'
    )
    .gte('period_end', dateFrom)
    .lte('period_end', dateTo)
    .gt('completed_qty', 0)
    .order('period_end', { ascending: true })

  if (error) {
    if (String(error.message || '').includes('process_production_lots')) {
      throw new Error(
        'process_production_lots テーブルがありません。Supabaseで create-process-production-lots.sql を実行してください。'
      )
    }
    throw error
  }

  return (data || [])
    .map((row) => ({
      id: String(row.id),
      target_type: row.target_type as 'line' | 'instruction',
      target_code: String(row.target_code || '').trim(),
      period_end: String(row.period_end || '').slice(0, 10),
      completed_qty: toNum(row.completed_qty),
      notes: row.notes ?? null,
    }))
    .filter((row) => row.target_code && inDateRange(row.period_end, dateFrom, dateTo))
}

async function buildModelUnitCostMap(
  supabase: SupabaseClient,
  modelCodes: string[]
): Promise<Map<string, UnitCostBreakdown>> {
  const map = new Map<string, UnitCostBreakdown>()
  const unique = [...new Set(modelCodes.map((m) => m.trim()).filter(Boolean))]
  if (unique.length === 0) return map

  const { data: bomRows, error: bomError } = await supabase
    .from('heater_bom')
    .select('model, part_key, quantity')
    .in('model', unique)
  if (bomError) throw bomError

  const partKeys = [...new Set((bomRows || []).map((b) => String(b.part_key)).filter(Boolean))]
  const fallback = new Map<
    string,
    { cost_price: number | null; material_cost_total: number | null; indirect_cost_total: number | null }
  >()

  if (partKeys.length > 0) {
    const { data: parts, error: partsError } = await supabase
      .from('heater_parts_master')
      .select('part_key, cost_price, material_cost_total, indirect_cost_total')
      .in('part_key', partKeys)
    if (partsError) throw partsError
    for (const p of parts || []) {
      fallback.set(String(p.part_key), {
        cost_price: p.cost_price ?? null,
        material_cost_total: p.material_cost_total ?? null,
        indirect_cost_total: p.indirect_cost_total ?? null,
      })
    }
  }

  const lineCostMap = await buildLinePartCostUnitMap(supabase, partKeys, fallback)

  for (const model of unique) {
    const rows = (bomRows || []).filter((b) => String(b.model) === model)
    let material = 0
    let labor = 0
    let indirect = 0
    let total = 0
    for (const bom of rows) {
      const qty = toNum(bom.quantity) || 1
      const key = String(bom.part_key)
      const unit = lineCostMap.get(key)
      const fb = fallback.get(key)
      const m = unit ? toNum(unit.material_unit) : toNum(fb?.material_cost_total)
      const l = unit ? toNum(unit.labor_unit) : 0
      const i = unit ? toNum(unit.indirect_unit) : toNum(fb?.indirect_cost_total)
      const t = unit
        ? toNum(unit.total_unit) || m + l + i
        : toNum(fb?.cost_price) || m + l + i
      material += m * qty
      labor += l * qty
      indirect += i * qty
      total += t * qty
    }
    map.set(model, {
      material: roundYen(material),
      labor: roundYen(labor),
      indirect: roundYen(indirect),
      total: roundYen(total),
      source: rows.length > 0 ? 'model_bom' : 'none',
    })
  }

  return map
}

async function buildOrderUnitCostMap(
  supabase: SupabaseClient,
  orderNos: string[]
): Promise<
  Map<
    string,
    UnitCostBreakdown & {
      work_order_id: string
      product_name: string | null
      model: string
      assembly_labor: number
    }
  >
> {
  const result = new Map<
    string,
    UnitCostBreakdown & {
      work_order_id: string
      product_name: string | null
      model: string
      assembly_labor: number
    }
  >()
  const unique = [...new Set(orderNos.map((o) => o.trim()).filter(Boolean))]
  if (unique.length === 0) return result

  let workOrders: any[] = []
  const primary = await supabase
    .from('work_orders')
    .select(
      'id, order_no, product_name, model, bom_model, heater_model, assembly_labor_cost'
    )
    .in('order_no', unique)

  if (primary.error) {
    const fb = await supabase
      .from('work_orders')
      .select('id, order_no, product_name, model, bom_model')
      .in('order_no', unique)
    if (fb.error) throw fb.error
    workOrders = (fb.data || []).map((r) => ({
      ...r,
      heater_model: null,
      assembly_labor_cost: 0,
    }))
  } else {
    workOrders = primary.data || []
  }

  const byOrderNo = new Map(workOrders.map((wo) => [String(wo.order_no), wo]))

  // 枝番付き指令番号にも対応（例: DR8-0026-01 → DR8-0026）
  const resolveWo = (orderNo: string) => {
    if (byOrderNo.has(orderNo)) return byOrderNo.get(orderNo)
    for (const [key, wo] of byOrderNo.entries()) {
      if (orderNo === key || orderNo.startsWith(`${key}-`) || orderNo.startsWith(`${key}_`)) {
        return wo
      }
    }
    return null
  }

  for (const orderNo of unique) {
    const wo = resolveWo(orderNo)
    if (!wo) continue

    const { data: branches } = await supabase
      .from('work_order_branches')
      .select('id, branch_no, part_key, part_name')
      .eq('work_order_id', wo.id)

    const saved = await aggregateWorkOrderSavedCost(supabase, wo, branches || [])
    const assembly = toNum(wo.assembly_labor_cost)
    const material = roundYen(saved.material_total)
    const labor = roundYen(saved.labor_total + assembly)
    const indirect = roundYen(saved.indirect_total)
    const total = roundYen(
      saved.has_saved_cost ? saved.grand_total + assembly : material + labor + indirect
    )

    const model =
      String(wo.heater_model || '').trim() ||
      String(wo.model || '').trim() ||
      String(wo.bom_model || '').trim() ||
      '未設定'

    result.set(orderNo, {
      work_order_id: String(wo.id),
      product_name: wo.product_name ?? null,
      model,
      assembly_labor: assembly,
      material,
      labor,
      indirect,
      total,
      source: saved.has_saved_cost || assembly > 0 ? 'order' : 'none',
    })
  }

  return result
}

export async function buildProductionValueReport(
  supabase: SupabaseClient,
  params: {
    period_mode: ProductionValuePeriodMode
    year: number
    month?: number | null
  }
): Promise<ProductionValueResult> {
  const warnings: string[] = []
  const range = resolveProductionValueDateRange(
    params.period_mode,
    params.year,
    params.month
  )

  const lots = await loadLotsInRange(supabase, range.date_from, range.date_to)

  const heaterLineSet = new Set(
    HEATER_PRODUCTION_LINE_CODES.map((c) => String(c))
  )

  const heaterLots = lots.filter(
    (lot) => lot.target_type === 'line' && heaterLineSet.has(lot.target_code)
  )
  const orderLots = lots.filter((lot) => lot.target_type === 'instruction')

  const { data: modelsData } = await supabase
    .from('heater_models')
    .select('model, name')
    .order('model')
  const models: HeaterModelRef[] = (modelsData || []).map((m) => ({
    model: String(m.model),
    name: m.name ?? null,
  }))
  const modelNameMap = new Map(models.map((m) => [m.model, m.name]))

  // L903〜909 のスケジュール適用機種（備考が UF/DF のみのときの解決用）
  const scheduleHints: ScheduleModelHint[] = []
  const { data: scheduleRows } = await supabase
    .from('process_schedule_st_sources')
    .select('target_type, target_code, model, spec_key, apply_to_schedule, updated_at')
    .eq('target_type', 'line')
    .in('target_code', [...heaterLineSet])
    .eq('apply_to_schedule', true)
    .order('updated_at', { ascending: false })

  for (const row of scheduleRows || []) {
    const model = String(row.model || '').trim()
    if (!model) continue
    scheduleHints.push({
      target_code: String(row.target_code || '').trim(),
      model,
      spec_key: normalizeSpecKey(row.spec_key || model),
    })
  }

  // --- D指令明細 ---
  const orderAgg = new Map<
    string,
    {
      completed_qty: number
      lot_count: number
      period_end_from: string | null
      period_end_to: string | null
    }
  >()
  for (const lot of orderLots) {
    const key = lot.target_code
    const cur = orderAgg.get(key) || {
      completed_qty: 0,
      lot_count: 0,
      period_end_from: null,
      period_end_to: null,
    }
    cur.completed_qty += lot.completed_qty
    cur.lot_count += 1
    cur.period_end_from =
      !cur.period_end_from || lot.period_end < cur.period_end_from
        ? lot.period_end
        : cur.period_end_from
    cur.period_end_to =
      !cur.period_end_to || lot.period_end > cur.period_end_to
        ? lot.period_end
        : cur.period_end_to
    orderAgg.set(key, cur)
  }

  const orderCostMap = await buildOrderUnitCostMap(supabase, [...orderAgg.keys()])

  const order_rows: ProductionValueOrderRow[] = [...orderAgg.entries()]
    .map(([order_no, agg]) => {
      const cost = orderCostMap.get(order_no)
      if (!cost) {
        warnings.push(`D指令 ${order_no}: 制作指令マスタまたは原価が見つかりません`)
      } else if (cost.source === 'none') {
        warnings.push(`D指令 ${order_no}: 保存原価がありません（金額0）`)
      }
      const qty = agg.completed_qty
      const unit_material = cost?.material || 0
      const unit_labor = cost?.labor || 0
      const unit_indirect = cost?.indirect || 0
      const unit_total = cost?.total || 0
      return {
        order_no,
        work_order_id: cost?.work_order_id || null,
        model: cost?.model || '未設定',
        model_display: formatHeaterModelDisplay(
          cost?.model || '未設定',
          modelNameMap.get(cost?.model || '') || cost?.product_name || null
        ),
        product_name: cost?.product_name || null,
        completed_qty: qty,
        lot_count: agg.lot_count,
        unit_material,
        unit_labor,
        unit_indirect,
        unit_total,
        material_amount: roundYen(unit_material * qty),
        labor_amount: roundYen(unit_labor * qty),
        indirect_amount: roundYen(unit_indirect * qty),
        total_amount: roundYen(unit_total * qty),
        has_saved_cost: cost?.source === 'order',
        period_end_from: agg.period_end_from,
        period_end_to: agg.period_end_to,
      }
    })
    .sort((a, b) => a.order_no.localeCompare(b.order_no, 'ja'))

  // --- 機種別（暖房機L + D指令） ---
  type ModelBucket = {
    model: string
    model_display: string
    model_name: string | null
    spec_key: string
    heater_qty: number
    order_qty: number
    lot_count: number
    order_material: number
    order_labor: number
    order_indirect: number
    order_total: number
    has_order: boolean
    has_heater: boolean
  }

  const modelBuckets = new Map<string, ModelBucket>()

  const ensureBucket = (
    model: string,
    model_name: string | null,
    spec_key: string,
    model_display?: string
  ) => {
    let b = modelBuckets.get(model)
    if (!b) {
      const name = model_name || modelNameMap.get(model) || null
      b = {
        model,
        model_display: model_display || formatHeaterModelDisplay(model, name),
        model_name: name,
        spec_key,
        heater_qty: 0,
        order_qty: 0,
        lot_count: 0,
        order_material: 0,
        order_labor: 0,
        order_indirect: 0,
        order_total: 0,
        has_order: false,
        has_heater: false,
      }
      modelBuckets.set(model, b)
    }
    return b
  }

  for (const lot of heaterLots) {
    const resolved = resolveModelFromLotNotes(lot.notes, models, {
      lineCode: lot.target_code,
      scheduleHints,
    })
    if (/^(UF|DF)$/i.test(resolved.model)) {
      warnings.push(
        `L${lot.target_code} ${lot.period_end}: 備考「${lot.notes || ''}」から機種コードを特定できません（スケジュール適用機種の設定を確認）`
      )
    }
    const b = ensureBucket(
      resolved.model,
      resolved.model_name,
      resolved.spec_key,
      resolved.display
    )
    b.heater_qty += lot.completed_qty
    b.lot_count += 1
    b.has_heater = true
    if (!b.spec_key && resolved.spec_key) b.spec_key = resolved.spec_key
    if (resolved.display && b.model_display !== resolved.display) {
      b.model_display = resolved.display
    }
  }

  for (const row of order_rows) {
    const b = ensureBucket(
      row.model,
      modelNameMap.get(row.model) || null,
      '',
      row.model_display
    )
    b.order_qty += row.completed_qty
    b.lot_count += row.lot_count
    b.order_material += row.material_amount
    b.order_labor += row.labor_amount
    b.order_indirect += row.indirect_amount
    b.order_total += row.total_amount
    b.has_order = true
  }

  const modelCodesForBom = [...modelBuckets.keys()].filter((m) =>
    models.some((x) => x.model === m)
  )
  const modelCostMap = await buildModelUnitCostMap(supabase, modelCodesForBom)

  const model_rows: ProductionValueModelRow[] = [...modelBuckets.values()]
    .map((b) => {
      const bom = modelCostMap.get(b.model)
      const heater_qty = b.heater_qty
      const heater_material = roundYen((bom?.material || 0) * heater_qty)
      const heater_labor = roundYen((bom?.labor || 0) * heater_qty)
      const heater_indirect = roundYen((bom?.indirect || 0) * heater_qty)
      const heater_total = roundYen((bom?.total || 0) * heater_qty)

      if (b.has_heater && (!bom || bom.source === 'none')) {
        warnings.push(
          `機種 ${b.model}: 暖房機ロットがありますがBOM原価がありません（材料・工費は0）`
        )
      }

      const material_amount = heater_material + b.order_material
      const labor_amount = heater_labor + b.order_labor
      const indirect_amount = heater_indirect + b.order_indirect
      const total_amount = heater_total + b.order_total
      const completed_qty = heater_qty + b.order_qty

      const unit_material =
        completed_qty > 0 ? roundYen(material_amount / completed_qty) : bom?.material || 0
      const unit_labor =
        completed_qty > 0 ? roundYen(labor_amount / completed_qty) : bom?.labor || 0
      const unit_indirect =
        completed_qty > 0 ? roundYen(indirect_amount / completed_qty) : bom?.indirect || 0
      const unit_total =
        completed_qty > 0 ? roundYen(total_amount / completed_qty) : bom?.total || 0

      let source: ProductionValueModelRow['source'] = 'mixed'
      if (b.has_heater && !b.has_order) source = 'heater_line'
      else if (!b.has_heater && b.has_order) source = 'd_order'

      let cost_source: ProductionValueModelRow['cost_source'] = 'none'
      if (b.has_heater && b.has_order) cost_source = 'mixed'
      else if (b.has_order) cost_source = 'order'
      else if (bom?.source === 'model_bom') cost_source = 'model_bom'

      return {
        model: b.model,
        model_display: b.model_display,
        model_name: b.model_name,
        spec_key: b.spec_key,
        source,
        completed_qty,
        lot_count: b.lot_count,
        unit_material,
        unit_labor,
        unit_indirect,
        unit_total,
        material_amount,
        labor_amount,
        indirect_amount,
        total_amount,
        cost_source,
      }
    })
    .sort((a, b) => a.model_display.localeCompare(b.model_display, 'ja'))

  // 合計は二重計上を避けるため D指令 + 暖房機L の金額をそのまま合算
  // （機種別は表示用で、D指令分と暖房機L分を内訳合算している）
  let heaterOnlyMaterial = 0
  let heaterOnlyLabor = 0
  let heaterOnlyIndirect = 0
  let heaterOnlyTotal = 0
  let heaterOnlyQty = 0
  for (const b of modelBuckets.values()) {
    if (b.heater_qty <= 0) continue
    const bom = modelCostMap.get(b.model)
    heaterOnlyQty += b.heater_qty
    heaterOnlyMaterial += roundYen((bom?.material || 0) * b.heater_qty)
    heaterOnlyLabor += roundYen((bom?.labor || 0) * b.heater_qty)
    heaterOnlyIndirect += roundYen((bom?.indirect || 0) * b.heater_qty)
    heaterOnlyTotal += roundYen((bom?.total || 0) * b.heater_qty)
  }

  const orderMaterial = order_rows.reduce((s, r) => s + r.material_amount, 0)
  const orderLabor = order_rows.reduce((s, r) => s + r.labor_amount, 0)
  const orderIndirect = order_rows.reduce((s, r) => s + r.indirect_amount, 0)
  const orderTotal = order_rows.reduce((s, r) => s + r.total_amount, 0)
  const orderQty = order_rows.reduce((s, r) => s + r.completed_qty, 0)

  return {
    period_mode: params.period_mode,
    year: range.year,
    month: range.month,
    period_label: range.period_label,
    date_from: range.date_from,
    date_to: range.date_to,
    order_rows,
    model_rows,
    totals: {
      completed_qty: orderQty + heaterOnlyQty,
      material_amount: orderMaterial + heaterOnlyMaterial,
      labor_amount: orderLabor + heaterOnlyLabor,
      indirect_amount: orderIndirect + heaterOnlyIndirect,
      total_amount: orderTotal + heaterOnlyTotal,
    },
    warnings: [...new Set(warnings)].slice(0, 50),
  }
}

export function getDefaultProductionValuePeriod(now = new Date()) {
  const year = now.getFullYear()
  const month = now.getMonth() + 1
  return { period_mode: 'month' as const, year, month }
}

/** 会計年度の検証用（年次） */
export function assertFiscalYear(year: number) {
  const fy = getFiscalYearFromDate(`${year}-08-01`)
  return fy
}
