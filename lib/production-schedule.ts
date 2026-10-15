import type { SupabaseClient } from '@supabase/supabase-js'
import { getCurrentFiscalYear } from '@/lib/fiscal-year'
import {
  getSavedModelRealtimeCost,
  type SavedModelRealtimeCost,
} from '@/lib/heater-model-realtime-cost'
import { quoteLaborFromStMinutes } from '@/lib/line-part-labor-cost'
import { canonicalScheduleModel, scheduleModelLookupCodes } from '@/lib/schedule-model-alias'
import {
  aggregateTargetWorkGroupMinutesByDateInRange,
  aggregateTargetWorkGroupMinutesInRange,
  aggregateTargetWorkGroupSummariesBySpecInFiscalYear,
  composeUfTotalStMap,
  getFiscalYearAverageStByWorkGroupForSpec,
  getProcessScheduleStSource,
  listProcessScheduleStSourcesByModel,
  listProductionLotRecords,
  lotMatchesSpec,
  normalizeSpecKey,
  normalizeTargetCode,
  normalizeWorkDate,
  resolveTargetContext,
  type ProcessTargetType,
} from '@/lib/process-management'

export const DEFAULT_MINUTES_PER_DAY = 480

export type ScheduleLotInput = {
  key: string
  model: string
  quantity: number
  sequence: number
  target_type: ProcessTargetType
  target_code: string
  label?: string | null
  /** 規格（UF/DF）。ST解決時に備考一致ロットを優先 */
  notes?: string | null
  /** 原価一覧の機種一覧から、工費（時間）を借りる機種。空なら工程管理のST */
  labor_model?: string | null
}

export type ScheduleStSource = 'lot' | 'fiscal' | 'standard' | 'cost_list' | 'none'

export type ScheduleWorkGroupPlan = {
  work_group_code: string
  work_group_name: string
  st_minutes: number
  total_minutes: number
  days: number
  start_date: string
  end_date: string
  dates: string[]
  actual_minutes: number
  progress_pct: number | null
}

export type ScheduleLotProgress = {
  planned_qty: number
  completed_qty: number
  qty_progress_pct: number | null
  planned_minutes: number
  actual_minutes: number
  minutes_progress_pct: number | null
}

export type ScheduleLotResult = {
  key: string
  model: string
  quantity: number
  sequence: number
  target_type: ProcessTargetType
  target_code: string
  label: string | null
  notes: string | null
  st_source: ScheduleStSource
  st_note: string | null
  /** 工費の根拠にした1台あたりST（分） */
  unit_st_minutes: number | null
  /** 1台あたり工費 */
  unit_labor_cost: number | null
  /** 1台あたり工費間接費 */
  unit_indirect_cost: number | null
  /** 工費（時間）を適用した原価一覧の機種 */
  labor_model: string | null
  start_date: string
  end_date: string
  /** 工程占有稼働日の合計（パイプライン上の所要稼働日） */
  total_days: number
  /** 着手〜完了の稼働日数（土日除く・両端含む） */
  lead_time_working_days: number
  /** 着手〜完了の暦日数（両端含む） */
  lead_time_calendar_days: number
  work_groups: ScheduleWorkGroupPlan[]
  progress: ScheduleLotProgress
}

export type ScheduleOccupancyCell = {
  date: string
  work_group_code: string
  work_group_name: string
  lot_key: string | null
  model: string | null
  sequence: number | null
  color_index: number
  planned_minutes_per_day: number
  actual_minutes: number
  has_plan: boolean
  has_actual: boolean
}

export type ProductionScheduleResult = {
  start_date: string
  minutes_per_day: number
  fiscal_year: number
  as_of_date: string
  lots: ScheduleLotResult[]
  calendar: {
    dates: string[]
    work_groups: Array<{ work_group_code: string; work_group_name: string }>
    cells: ScheduleOccupancyCell[]
  }
  progress_summary: {
    planned_qty: number
    completed_qty: number
    planned_minutes: number
    actual_minutes: number
    qty_progress_pct: number | null
    minutes_progress_pct: number | null
  }
  warnings: string[]
}

function pct(actual: number, planned: number): number | null {
  if (!Number.isFinite(planned) || planned <= 0) return null
  return Math.round((actual / planned) * 1000) / 10
}

function todayIsoLocal() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function withLotLeadTimes(lot: ScheduleLotResult): ScheduleLotResult {
  const working =
    lot.lead_time_working_days ?? countWorkingDaysInclusive(lot.start_date, lot.end_date)
  const calendar =
    lot.lead_time_calendar_days ?? countCalendarDaysInclusive(lot.start_date, lot.end_date)
  return {
    ...lot,
    lead_time_working_days: working,
    lead_time_calendar_days: calendar,
  }
}

function maxIsoDate(a: string, b: string) {
  return a >= b ? a : b
}

function minIsoDate(a: string, b: string) {
  return a <= b ? a : b
}

async function attachScheduleProgress(
  supabase: SupabaseClient,
  result: ProductionScheduleResult
): Promise<ProductionScheduleResult> {
  if (result.lots.length === 0 || result.calendar.dates.length === 0) {
    return result
  }

  const asOf = result.as_of_date
  const planRangeStart = result.calendar.dates[0]
  const planRangeEnd = result.calendar.dates[result.calendar.dates.length - 1]
  // 計画期間＋開始日〜本日までの実績も拾う（計画のない日の実績表示用）
  const rangeStart = minIsoDate(result.start_date, planRangeStart)
  const rangeEnd = maxIsoDate(planRangeEnd, asOf)

  const targetKeys = new Map<
    string,
    { target_type: ProcessTargetType; target_code: string; lineId: string | null }
  >()
  for (const lot of result.lots) {
    if (!String(lot.target_code || '').trim()) continue
    const key = `${lot.target_type}:${lot.target_code}`
    if (targetKeys.has(key)) continue
    const { lineId } = await resolveTargetContext(supabase, lot.target_type, lot.target_code)
    targetKeys.set(key, {
      target_type: lot.target_type,
      target_code: lot.target_code,
      lineId,
    })
  }

  /** targetKey -> Map<`${date}|${workGroup}`, minutes> */
  const actualByTarget = new Map<string, Map<string, number>>()
  for (const [key, target] of targetKeys) {
    const daily = await aggregateTargetWorkGroupMinutesByDateInRange(
      supabase,
      target.target_type,
      target.target_code,
      rangeStart,
      rangeEnd,
      target.lineId
    )
    actualByTarget.set(key, daily)
  }

  /** スケジュール対象全体の日×班実績（対象の重複加算なし） */
  const mergedActual = new Map<string, number>()
  for (const daily of actualByTarget.values()) {
    for (const [key, minutes] of daily) {
      if (minutes <= 0) continue
      mergedActual.set(key, (mergedActual.get(key) || 0) + minutes)
    }
  }

  const completedByTargetSpec = new Map<string, number>()
  for (const [key, target] of targetKeys) {
    const lots = await listProductionLotRecords(
      supabase,
      target.target_type,
      target.target_code
    )
    const matching = lots.filter(
      (lot) => lot.period_end >= rangeStart && lot.period_start <= rangeEnd
    )
    // 規格別に集計（キーに spec を付ける）
    for (const lot of matching) {
      const spec = normalizeSpecKey(lot.notes)
      const specKey = `${key}::${spec}`
      completedByTargetSpec.set(
        specKey,
        (completedByTargetSpec.get(specKey) || 0) + lot.completed_qty
      )
      completedByTargetSpec.set(
        `${key}::`,
        (completedByTargetSpec.get(`${key}::`) || 0) + lot.completed_qty
      )
    }
  }

  const lotByKey = new Map(result.lots.map((lot) => [lot.key, lot]))
  const workGroupMaster = await fetchWorkGroupOrder(supabase)
  const nameByCode = new Map(workGroupMaster.map((g) => [g.work_group_code, g.work_group_name]))
  const groupNoByCode = new Map(workGroupMaster.map((g) => [g.work_group_code, g.group_no]))

  const cellByKey = new Map<string, ScheduleOccupancyCell>()
  for (const cell of result.calendar.cells) {
    const mapKey = `${cell.work_group_code}__${cell.date}`
    const lot = cell.lot_key ? lotByKey.get(cell.lot_key) : null
    const group = lot?.work_groups.find((g) => g.work_group_code === cell.work_group_code)
    const plannedPerDay =
      group && group.days > 0 ? Math.round((group.total_minutes / group.days) * 10) / 10 : 0
    const actual = mergedActual.get(`${cell.date}|${cell.work_group_code}`) || 0
    cellByKey.set(mapKey, {
      ...cell,
      lot_key: cell.lot_key,
      model: cell.model,
      sequence: cell.sequence,
      planned_minutes_per_day: plannedPerDay,
      actual_minutes: Math.round(actual * 10) / 10,
      has_plan: true,
      has_actual: actual > 0,
    })
  }

  for (const [dailyKey, minutes] of mergedActual) {
    if (minutes <= 0) continue
    const sep = dailyKey.indexOf('|')
    if (sep < 0) continue
    const date = dailyKey.slice(0, sep)
    const work_group_code = dailyKey.slice(sep + 1)
    if (!date || !work_group_code) continue
    if (date < rangeStart || date > rangeEnd) continue
    const mapKey = `${work_group_code}__${date}`
    if (cellByKey.has(mapKey)) continue
    const work_group_name = nameByCode.get(work_group_code) || work_group_code
    cellByKey.set(mapKey, {
      date,
      work_group_code,
      work_group_name,
      lot_key: null,
      model: null,
      sequence: null,
      color_index: 0,
      planned_minutes_per_day: 0,
      actual_minutes: Math.round(minutes * 10) / 10,
      has_plan: false,
      has_actual: true,
    })
  }

  const dates = Array.from(
    new Set([
      ...result.calendar.dates,
      ...Array.from(cellByKey.values()).map((cell) => cell.date),
    ])
  ).sort()

  const usedGroupCodes = new Set<string>([
    ...result.calendar.work_groups.map((g) => g.work_group_code),
    ...Array.from(cellByKey.values()).map((c) => c.work_group_code),
  ])
  const workGroups = Array.from(usedGroupCodes)
    .map((work_group_code) => {
      const fromCalendar = result.calendar.work_groups.find(
        (g) => g.work_group_code === work_group_code
      )
      const work_group_name =
        fromCalendar?.work_group_name || nameByCode.get(work_group_code) || work_group_code
      const group_no = groupNoByCode.get(work_group_code) ?? 0
      return {
        work_group_code,
        work_group_name,
        process_order: getScheduleProcessOrder(work_group_code, work_group_name, group_no),
      }
    })
    .sort(
      (a, b) =>
        a.process_order - b.process_order ||
        a.work_group_code.localeCompare(b.work_group_code)
    )
    .map(({ work_group_code, work_group_name }) => ({ work_group_code, work_group_name }))

  const cells = Array.from(cellByKey.values()).sort(
    (a, b) =>
      a.date.localeCompare(b.date) || a.work_group_code.localeCompare(b.work_group_code)
  )

  const lots: ScheduleLotResult[] = result.lots.map((lot) => {
    const targetKey = `${lot.target_type}:${lot.target_code}`
    const daily = actualByTarget.get(targetKey) || new Map<string, number>()
    const workGroupsForLot = lot.work_groups.map((group) => {
      let actualMinutes = 0
      for (const date of group.dates) {
        if (date > asOf) continue
        actualMinutes += daily.get(`${date}|${group.work_group_code}`) || 0
      }
      return {
        ...group,
        actual_minutes: Math.round(actualMinutes * 10) / 10,
        progress_pct: pct(actualMinutes, group.total_minutes),
      }
    })

    const plannedMinutes = workGroupsForLot.reduce((sum, g) => sum + g.total_minutes, 0)
    const actualMinutes = workGroupsForLot.reduce((sum, g) => sum + g.actual_minutes, 0)
    const spec = normalizeSpecKey(lot.notes)
    const completedQty =
      completedByTargetSpec.get(`${targetKey}::${spec}`) ??
      (spec ? 0 : completedByTargetSpec.get(`${targetKey}::`) || 0)

    return withLotLeadTimes({
      ...lot,
      work_groups: workGroupsForLot,
      progress: {
        planned_qty: lot.quantity,
        completed_qty: completedQty,
        qty_progress_pct: pct(completedQty, lot.quantity),
        planned_minutes: Math.round(plannedMinutes * 10) / 10,
        actual_minutes: Math.round(actualMinutes * 10) / 10,
        minutes_progress_pct: pct(actualMinutes, plannedMinutes),
      },
    })
  })

  const plannedQty = lots.reduce((sum, lot) => sum + lot.progress.planned_qty, 0)
  const completedQty = lots.reduce((sum, lot) => sum + lot.progress.completed_qty, 0)
  const plannedMinutes = lots.reduce((sum, lot) => sum + lot.progress.planned_minutes, 0)
  const actualMinutes = lots.reduce((sum, lot) => sum + lot.progress.actual_minutes, 0)

  return {
    ...result,
    lots,
    calendar: {
      dates,
      work_groups: workGroups,
      cells,
    },
    progress_summary: {
      planned_qty: plannedQty,
      completed_qty: completedQty,
      planned_minutes: Math.round(plannedMinutes * 10) / 10,
      actual_minutes: Math.round(actualMinutes * 10) / 10,
      qty_progress_pct: pct(completedQty, plannedQty),
      minutes_progress_pct: pct(actualMinutes, plannedMinutes),
    },
  }
}

function isWeekend(dateStr: string) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const day = new Date(y, m - 1, d).getDay()
  return day === 0 || day === 6
}

function shiftCalendarDate(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  date.setDate(date.getDate() + days)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** 着手〜完了の暦日数（両端含む） */
export function countCalendarDaysInclusive(startDate: string, endDate: string): number {
  const start = normalizeWorkDate(startDate)
  const end = normalizeWorkDate(endDate)
  if (end < start) return 0
  const s = new Date(`${start}T00:00:00`)
  const e = new Date(`${end}T00:00:00`)
  return Math.round((e.getTime() - s.getTime()) / 86400000) + 1
}

/** 着手〜完了の稼働日数（土日除く・両端含む） */
export function countWorkingDaysInclusive(startDate: string, endDate: string): number {
  const start = normalizeWorkDate(startDate)
  const end = normalizeWorkDate(endDate)
  if (end < start) return 0
  let count = 0
  let current = start
  while (current <= end) {
    if (!isWeekend(current)) count += 1
    if (current === end) break
    current = shiftCalendarDate(current, 1)
  }
  return count
}

export function shiftWorkingDate(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  let remaining = days
  const step = remaining >= 0 ? 1 : -1
  remaining = Math.abs(remaining)
  while (remaining > 0) {
    date.setDate(date.getDate() + step)
    const next = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    if (!isWeekend(next)) remaining -= 1
  }
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function nextWorkingDateOnOrAfter(dateStr: string): string {
  let current = normalizeWorkDate(dateStr)
  while (isWeekend(current)) {
    current = shiftWorkingDate(current, 1)
  }
  return current
}

/** start から workingDays 日分の稼働日（start含む）。0日なら空 */
export function collectWorkingDates(startDate: string, workingDays: number): string[] {
  if (workingDays <= 0) return []
  const dates: string[] = []
  let current = nextWorkingDateOnOrAfter(startDate)
  while (dates.length < workingDays) {
    if (!isWeekend(current)) dates.push(current)
    if (dates.length >= workingDays) break
    current = shiftWorkingDate(current, 1)
  }
  return dates
}

function ceilDays(totalMinutes: number, minutesPerDay: number) {
  if (totalMinutes <= 0) return 0
  return Math.max(1, Math.ceil(totalMinutes / minutesPerDay))
}

/**
 * 生産スケジュールの工程順（固定）
 * 1 機械加工1班（板切り）→ 2 機械加工2 → 3〜5 組立1〜3
 * 板切りが終わらないと後工程はスタートできない。
 */
export const SCHEDULE_PROCESS_ORDER_LABELS = [
  '1. 機械加工1班（板切り）',
  '2. 機械加工2班',
  '3. 組み立て1班',
  '4. 組み立て2班',
  '5. 組み立て3班',
] as const

function normalizeGroupText(code: string, name: string) {
  return `${code} ${name}`
    .toUpperCase()
    .replace(/[‐−－—]/g, '-')
    .replace(/\s+/g, '')
}

/** 小さいほど先工程。未知の班は後ろ（マスタ group_no で微調整） */
export function getScheduleProcessOrder(
  workGroupCode: string,
  workGroupName: string,
  groupNo = 0
): number {
  if (workGroupCode === '_STANDARD') return 9000
  const t = normalizeGroupText(workGroupCode, workGroupName)
  const name = workGroupName.toUpperCase().replace(/\s+/g, '')

  // 1. 板切り / 機械加工1
  if (/板切/.test(name) || /板切/.test(t)) return 1
  if (
    (/機械加工|[Kk]機|機械/.test(name) || /K-?1\b|K1/.test(t)) &&
    (/[1１]班|[1１]（|第[1１]|K-?1(?:[^0-9]|$)/.test(t) || /機械加工第?[1１]/.test(name)) &&
    !(/[2２]班|第[2２]|K-?2(?:[^0-9]|$)|機械加工第?[2２]/.test(t) || /板切/.test(name))
  ) {
    return 1
  }
  if (/^K-?1$|^K1$/.test(workGroupCode.toUpperCase().replace(/\s/g, ''))) return 1

  // 2. 機械加工2
  if (
    (/機械加工|機械/.test(name) || /K-?2/.test(t)) &&
    (/[2２]班|第[2２]|K-?2(?:[^0-9]|$)|機械加工第?[2２]/.test(t) || /機械2/.test(name))
  ) {
    return 2
  }
  if (/^K-?2$|^K2$/.test(workGroupCode.toUpperCase().replace(/\s/g, ''))) return 2

  // 3-5. 組立1〜3
  const isAssembly = /組立|組み立て|ASSY|ASSEMBLY/.test(name) || /A-?[123１２３]/.test(t)
  if (isAssembly) {
    if (/[1１]班|第[1１]|A-?1(?:[^0-9]|$)|組立第?[1１]/.test(t) || /組立1|組み立て1/.test(name)) {
      return 3
    }
    if (/[2２]班|第[2２]|A-?2(?:[^0-9]|$)|組立第?[2２]/.test(t) || /組立2|組み立て2/.test(name)) {
      return 4
    }
    if (/[3３]班|第[3３]|A-?3(?:[^0-9]|$)|組立第?[3３]/.test(t) || /組立3|組み立て3/.test(name)) {
      return 5
    }
  }
  if (/^A-?1$|^A1$/.test(workGroupCode.toUpperCase().replace(/\s/g, ''))) return 3
  if (/^A-?2$|^A2$/.test(workGroupCode.toUpperCase().replace(/\s/g, ''))) return 4
  if (/^A-?3$|^A3$/.test(workGroupCode.toUpperCase().replace(/\s/g, ''))) return 5

  return 100 + groupNo
}

async function fetchWorkGroupOrder(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from('work_group_master')
    .select('work_group_code, work_name, group_no')
    .order('group_no', { ascending: true })
    .order('work_group_code', { ascending: true })
  if (error) throw error
  return (data || []).map((row) => {
    const work_group_code = String(row.work_group_code)
    const work_group_name = String(row.work_name || row.work_group_code)
    const group_no = Number(row.group_no) || 0
    return {
      work_group_code,
      work_group_name,
      group_no,
      process_order: getScheduleProcessOrder(work_group_code, work_group_name, group_no),
    }
  })
}

async function resolveWorkGroupStMinutes(
  supabase: SupabaseClient,
  targetType: ProcessTargetType,
  targetCode: string,
  fiscalYear: number,
  notes?: string | null,
  model?: string | null
): Promise<{ source: ScheduleStSource; note: string | null; stByGroup: Map<string, number> }> {
  const normalized = normalizeTargetCode(targetCode)
  const specKey = normalizeSpecKey(notes)
  const modelKey = String(model || '').trim()

  // 工程管理で「機種×指令」明示適用された年平均STを最優先
  const applied = modelKey
    ? await getProcessScheduleStSource(supabase, targetType, normalized, modelKey)
    : null
  if (applied) {
    const appliedSpec = applied.spec_key || null
    const { map: fiscalMap } = await getFiscalYearAverageStByWorkGroupForSpec(
      supabase,
      targetType,
      normalized,
      applied.fiscal_year,
      appliedSpec
    )
    if (fiscalMap.size > 0) {
      const specLabel = appliedSpec ? ` ${appliedSpec}` : '（全体）'
      return {
        source: 'fiscal',
        note: `工程管理適用 機種 ${applied.model} / ${String(applied.fiscal_year).slice(-2)}年度平均ST${specLabel}`,
        stByGroup: fiscalMap,
      }
    }
    // 指定はあるが平均が無い場合は警告付きで通常解決へフォールバックしない（根拠を明確に）
    return {
      source: 'none',
      note: `工程管理で機種 ${applied.model} の${String(applied.fiscal_year).slice(-2)}年度平均ST適用指定ありだが平均STが算出できません`,
      stByGroup: new Map(),
    }
  }

  // UF合計ST = DF基準ST + UF差分ST
  if (specKey === 'UF') {
    const dfResolved = await resolveWorkGroupStMinutesRaw(
      supabase,
      targetType,
      normalized,
      fiscalYear,
      'DF'
    )
    const ufResolved = await resolveWorkGroupStMinutesRaw(
      supabase,
      targetType,
      normalized,
      fiscalYear,
      'UF'
    )
    const composed = composeUfTotalStMap(dfResolved.stByGroup, ufResolved.stByGroup)
    if (composed.size > 0) {
      const source: ScheduleStSource =
        dfResolved.source !== 'none' || ufResolved.source !== 'none'
          ? dfResolved.source === 'lot' || ufResolved.source === 'lot'
            ? 'lot'
            : dfResolved.source === 'fiscal' || ufResolved.source === 'fiscal'
              ? 'fiscal'
              : dfResolved.source !== 'none'
                ? dfResolved.source
                : ufResolved.source
          : 'none'
      const parts = [
        dfResolved.source !== 'none' ? `DF:${dfResolved.note}` : 'DF:なし',
        ufResolved.source !== 'none' ? `UF差分:${ufResolved.note}` : 'UF差分:なし',
      ]
      return {
        source,
        note: `UF合計=DF+UF差分（${parts.join(' / ')}）`,
        stByGroup: composed,
      }
    }
    // DFが無い場合はUF差分のみ（従来互換）
    if (ufResolved.stByGroup.size > 0) {
      return {
        ...ufResolved,
        note: `${ufResolved.note || 'UF'}（DF基準なしのためUF差分のみ）`,
      }
    }
    return dfResolved.source !== 'none'
      ? {
          ...dfResolved,
          note: `${dfResolved.note || 'DF'}（UF差分なしのためDFのみ）`,
        }
      : { source: 'none', note: 'ST・標準時間なし', stByGroup: new Map() }
  }

  return resolveWorkGroupStMinutesRaw(supabase, targetType, normalized, fiscalYear, notes)
}

async function resolveWorkGroupStMinutesRaw(
  supabase: SupabaseClient,
  targetType: ProcessTargetType,
  targetCode: string,
  fiscalYear: number,
  notes?: string | null
): Promise<{ source: ScheduleStSource; note: string | null; stByGroup: Map<string, number> }> {
  const normalized = normalizeTargetCode(targetCode)
  const specKey = normalizeSpecKey(notes)
  const { lineId } = await resolveTargetContext(supabase, targetType, normalized)

  const lots = await listProductionLotRecords(supabase, targetType, normalized)
  const scopedLots = specKey
    ? lots.filter((lot) => lotMatchesSpec(lot.notes, specKey))
    : lots

  if (scopedLots.length > 0) {
    const last = scopedLots[scopedLots.length - 1]
    if (last.completed_qty > 0) {
      const samePeriodLots = lots.filter(
        (lot) => lot.period_start === last.period_start && lot.period_end === last.period_end
      )
      const periodTotalQty = samePeriodLots.reduce((sum, lot) => sum + lot.completed_qty, 0)
      const share = periodTotalQty > 0 ? last.completed_qty / periodTotalQty : 1
      const totals = await aggregateTargetWorkGroupMinutesInRange(
        supabase,
        targetType,
        normalized,
        last.period_start,
        last.period_end,
        lineId
      )
      const stByGroup = new Map<string, number>()
      for (const [code, minutes] of totals) {
        const allocated = minutes * share
        if (allocated > 0) {
          stByGroup.set(code, Math.round((allocated / last.completed_qty) * 10) / 10)
        }
      }
      if (stByGroup.size > 0) {
        const specLabel = specKey ? ` / ${specKey}` : ''
        return {
          source: 'lot',
          note: `直近ロット${specLabel} ${last.period_start}〜${last.period_end}（${last.completed_qty}台）`,
          stByGroup,
        }
      }
    }
  }

  const { map: fiscalMap, summary } = await getFiscalYearAverageStByWorkGroupForSpec(
    supabase,
    targetType,
    normalized,
    fiscalYear,
    specKey || null
  )
  // getFiscalYearAverageStByWorkGroupForSpec の UF は既に DF+UF 合成済み。
  // Raw 呼び出しで UF 差分のみが欲しい場合は by_spec 生データが必要なので、
  // ここでは fiscal の UF 合成を避けるため spec が UF のときは合成前行を使う。
  if (specKey === 'UF') {
    const { by_spec } = await aggregateTargetWorkGroupSummariesBySpecInFiscalYear(
      supabase,
      targetType,
      normalized,
      fiscalYear
    )
    // applyUfDfComposition 済みなので、差分のみが欲しい場合は再計算が必要。
    // Raw UF = 合成後から DF を引くのではなく、composition 前の集計を取る。
    // aggregate は composition 後を返すため、差分は UF.total から推定せず
    // composition 内の avg_st_uf_delta を使う。
    const ufItem = by_spec.find((item) => item.spec_key === 'UF')
    if (ufItem) {
      const deltaMap = new Map<string, number>()
      for (const row of ufItem.summary.rows) {
        const delta = row.avg_st_uf_delta_minutes
        if (delta != null && delta > 0) {
          deltaMap.set(row.work_group_code, delta)
        } else if (
          !ufItem.summary.uf_composed &&
          row.avg_st_minutes != null &&
          row.avg_st_minutes > 0
        ) {
          deltaMap.set(row.work_group_code, row.avg_st_minutes)
        }
      }
      if (deltaMap.size > 0) {
        return {
          source: 'fiscal',
          note: `${String(fiscalYear).slice(-2)}年度平均ST UF差分`,
          stByGroup: deltaMap,
        }
      }
    }
  } else if (fiscalMap.size > 0) {
    const specLabel = summary.spec_key ? ` ${summary.spec_key}` : ''
    return {
      source: 'fiscal',
      note: `${String(fiscalYear).slice(-2)}年度平均ST${specLabel}`,
      stByGroup: fiscalMap,
    }
  }

  if (targetType === 'instruction') {
    const { data: order, error } = await supabase
      .from('work_orders')
      .select('standard_duration_minutes, order_no, product_name')
      .eq('order_no', normalized)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) throw error
    const std = Number(order?.standard_duration_minutes || 0)
    if (std > 0) {
      return {
        source: 'standard',
        note: `D指令標準時間 ${std}分/台`,
        stByGroup: new Map([['_STANDARD', std]]),
      }
    }
  } else {
    const { data: line, error } = await supabase
      .from('lines')
      .select('standard_duration_minutes, line_code, name')
      .eq('line_code', normalized)
      .maybeSingle()
    if (error) throw error
    const std = Number(line?.standard_duration_minutes || 0)
    if (std > 0) {
      return {
        source: 'standard',
        note: `L指令標準時間 ${std}分/台`,
        stByGroup: new Map([['_STANDARD', std]]),
      }
    }
  }

  return { source: 'none', note: 'ST・標準時間なし', stByGroup: new Map() }
}

export async function suggestTargetsForModel(supabase: SupabaseClient, model: string) {
  const trimmed = model.trim()
  if (!trimmed) return [] as Array<{ target_type: ProcessTargetType; target_code: string; label: string }>

  const { data: orders, error } = await supabase
    .from('work_orders')
    .select('order_no, product_name, model, standard_duration_minutes')
    .ilike('model', `%${trimmed}%`)
    .order('order_no', { ascending: true })
    .limit(20)
  if (error) throw error

  const seen = new Set<string>()
  const suggestions: Array<{ target_type: ProcessTargetType; target_code: string; label: string }> = []
  for (const order of orders || []) {
    const code = normalizeTargetCode(order.order_no || '')
    if (!code || seen.has(code)) continue
    seen.add(code)
    suggestions.push({
      target_type: 'instruction',
      target_code: code,
      label: `${code} ${order.product_name || ''}`.trim(),
    })
  }
  return suggestions
}

function maxWorkDate(a: string, b: string) {
  return a >= b ? a : b
}

function sumStMinutes(stByGroup: Map<string, number>) {
  let total = 0
  for (const minutes of stByGroup.values()) total += minutes
  return total
}

function scaleStMap(stByGroup: Map<string, number>, targetMinutes: number) {
  const sum = sumStMinutes(stByGroup)
  if (sum <= 0 || targetMinutes <= 0) return stByGroup
  const scaled = new Map<string, number>()
  for (const [code, minutes] of stByGroup) {
    scaled.set(code, Math.round((minutes * targetMinutes) / sum * 10) / 10)
  }
  return scaled
}

function usableWorkGroupMap(stByGroup: Map<string, number>) {
  const real = new Map<string, number>()
  for (const [code, minutes] of stByGroup) {
    if (minutes > 0 && code !== '_STANDARD' && code !== '_LABOR') real.set(code, minutes)
  }
  if (real.size < 2) return null
  const sum = sumStMinutes(real)
  const significant = new Map<string, number>()
  for (const [code, minutes] of real) {
    if (sum <= 0 || minutes / sum >= 0.01) significant.set(code, minutes)
  }
  return significant.size >= 2 ? significant : real
}

function scheduleModelTokens(code: string, name?: string | null) {
  const tokens = new Set<string>()
  const add = (value: string) => {
    const token = value.trim().toUpperCase().replace(/\s+/g, '')
    if (token.length >= 3) tokens.add(token)
  }
  add(code)
  add(canonicalScheduleModel(code))
  add(String(name || ''))
  const source = `${code} ${name || ''}`
  for (const match of source.match(/[A-Z]{1,3}-?\d+[A-Z0-9-]*/gi) || []) add(match)
  for (const token of [...tokens]) add(token.replace(/-(DF|UF)$/i, ''))
  return [...tokens].sort((a, b) => b.length - a.length)
}

function textHasModelToken(text: string, token: string) {
  const hay = text.toUpperCase().replace(/\s+/g, '')
  const needle = token.toUpperCase().replace(/\s+/g, '')
  let from = 0
  while (from < hay.length) {
    const index = hay.indexOf(needle, from)
    if (index < 0) return false
    const next = hay[index + needle.length] || ''
    if (!/[A-Z0-9]/.test(next)) return true
    from = index + 1
  }
  return false
}

async function resolveGroupShape(
  supabase: SupabaseClient,
  targetType: ProcessTargetType,
  targetCode: string,
  fiscalYear: number,
  notes: string | null | undefined,
  model: string
) {
  const resolved = await resolveWorkGroupStMinutes(
    supabase,
    targetType,
    targetCode,
    fiscalYear,
    notes,
    model
  )
  const map = usableWorkGroupMap(resolved.stByGroup)
  if (!map) return null
  return { map, note: resolved.note }
}

function isManualLaborCost(saved: SavedModelRealtimeCost) {
  if (saved.target_type === 'manual') return true
  return String(saved.applied_label || '').trim().startsWith('手入力')
}

async function resolveCostListSt(
  supabase: SupabaseClient,
  saved: SavedModelRealtimeCost,
  fiscalYear: number,
  notes: string | null | undefined,
  lotModel: string,
  lines: Array<{ line_code: string; name: string }>
): Promise<{ stByGroup: Map<string, number>; splitNote: string | null }> {
  const fallback = () => ({
    stByGroup: new Map([['_LABOR', saved.st_minutes]]),
    splitNote: null as string | null,
  })

  // 手入力の工費は合計だけなので、作業班には分けず工費1行にする
  if (isManualLaborCost(saved)) return fallback()

  const savedType = saved.target_type === 'line' || saved.target_type === 'instruction'
    ? saved.target_type
    : null
  const savedCode = String(saved.target_code || '').trim()
  if (savedType && savedCode && savedCode !== saved.model) {
    const shaped = await resolveGroupShape(
      supabase,
      savedType,
      savedCode,
      fiscalYear,
      notes,
      lotModel || saved.model
    )
    if (shaped) {
      return {
        stByGroup: scaleStMap(shaped.map, saved.st_minutes),
        splitNote: shaped.note,
      }
    }
  }

  const modelCodes = [...new Set([...scheduleModelLookupCodes(saved.model), ...scheduleModelLookupCodes(lotModel)])]
  const sources = []
  for (const code of modelCodes) {
    sources.push(...(await listProcessScheduleStSourcesByModel(supabase, code)))
  }
  const spec = normalizeSpecKey(notes) || ''
  const orderedSources = [...sources].sort((a, b) => {
    const aSpec = (a.spec_key || '') === spec ? 0 : 1
    const bSpec = (b.spec_key || '') === spec ? 0 : 1
    return aSpec - bSpec
  })
  for (const source of orderedSources.slice(0, 4)) {
    const shaped = await resolveGroupShape(
      supabase,
      source.target_type,
      source.target_code,
      fiscalYear,
      notes || source.spec_key,
      source.model
    )
    if (!shaped) continue
    return {
      stByGroup: scaleStMap(shaped.map, saved.st_minutes),
      splitNote: shaped.note,
    }
  }

  let modelName = ''
  const nameCode = lotModel || saved.model
  if (nameCode) {
    const { data } = await supabase
      .from('heater_models')
      .select('name')
      .eq('model', nameCode)
      .maybeSingle()
    modelName = String(data?.name || '')
  }
  const tokens = scheduleModelTokens(nameCode, modelName)
  const matchedLine = lines
    .map((line) => {
      const text = `${line.line_code} ${line.name}`
      const token = tokens.find((item) => textHasModelToken(text, item))
      return token ? { line, token } : null
    })
    .filter((item): item is { line: { line_code: string; name: string }; token: string } => Boolean(item))
    .sort((a, b) => b.token.length - a.token.length)[0]
  if (matchedLine) {
    const shaped = await resolveGroupShape(
      supabase,
      'line',
      matchedLine.line.line_code,
      fiscalYear,
      notes,
      nameCode
    )
    if (shaped) {
      return {
        stByGroup: scaleStMap(shaped.map, saved.st_minutes),
        splitNote: shaped.note || `${matchedLine.line.name}の作業班比率`,
      }
    }
  }

  return fallback()
}

export async function buildProductionSchedule(
  supabase: SupabaseClient,
  input: {
    start_date: string
    minutes_per_day?: number
    fiscal_year?: number
    lots: ScheduleLotInput[]
  }
): Promise<ProductionScheduleResult> {
  const startDate = nextWorkingDateOnOrAfter(normalizeWorkDate(input.start_date))
  const minutesPerDay = input.minutes_per_day && input.minutes_per_day > 0
    ? input.minutes_per_day
    : DEFAULT_MINUTES_PER_DAY
  const fiscalYear = input.fiscal_year || getCurrentFiscalYear()
  const warnings: string[] = []

  const workGroupMaster = await fetchWorkGroupOrder(supabase)
  const { data: lineRows } = await supabase
    .from('lines')
    .select('line_code, name')
    .eq('is_active', true)
  const scheduleLines = (lineRows || [])
    .map((row) => ({
      line_code: String(row.line_code || '').trim(),
      name: String(row.name || '').trim(),
    }))
    .filter((row) => row.line_code)
  const nameByCode = new Map(workGroupMaster.map((g) => [g.work_group_code, g.work_group_name]))
  nameByCode.set('_STANDARD', '指令標準時間')
  nameByCode.set('_LABOR', '工費')
  const savedLaborByModel = new Map<string, SavedModelRealtimeCost | null>()

  const orderedLots = [...input.lots]
    .filter((lot) => lot.quantity > 0 && (lot.target_code?.trim() || lot.labor_model?.trim()))
    .sort((a, b) => a.sequence - b.sequence || a.model.localeCompare(b.model, 'ja'))

  if (orderedLots.length === 0) {
    throw new Error('スケジュール対象のロット（機種の工費、またはD/L指令）がありません')
  }

  const results: ScheduleLotResult[] = []
  /** 各作業班が次に着手可能な稼働日（パイプライン） */
  const groupAvailable = new Map<string, string>()
  const occupancy: ScheduleOccupancyCell[] = []
  const usedGroups = new Map<string, string>()

  for (let lotIndex = 0; lotIndex < orderedLots.length; lotIndex++) {
    const lot = orderedLots[lotIndex]
    const targetCode = normalizeTargetCode(lot.target_code)
    const laborModel = String(lot.labor_model || '').trim()
    let laborQuote: { st_minutes: number; labor_cost: number; indirect_cost: number } | null = null
    let appliedLaborModel: string | null = null
    let resolved: { source: ScheduleStSource; note: string | null; stByGroup: Map<string, number> }

    if (laborModel) {
      const lookupCodes = scheduleModelLookupCodes(laborModel)
      let saved: SavedModelRealtimeCost | null = null
      let savedModel = laborModel
      for (const code of lookupCodes) {
        if (!savedLaborByModel.has(code)) {
          savedLaborByModel.set(code, await getSavedModelRealtimeCost(supabase, code))
        }
        const candidate = savedLaborByModel.get(code) || null
        if (!saved) {
          saved = candidate
          savedModel = code
        }
        if (candidate && candidate.st_minutes > 0) {
          saved = candidate
          savedModel = code
          break
        }
      }
      if (saved && saved.st_minutes > 0) {
        laborQuote = {
          st_minutes: saved.st_minutes,
          labor_cost: saved.labor_cost,
          indirect_cost: saved.indirect_cost,
        }
        appliedLaborModel = savedModel
        const shaped = await resolveCostListSt(
          supabase,
          saved,
          fiscalYear,
          lot.notes,
          lot.model,
          scheduleLines
        )
        const label = saved.applied_label || '原価一覧'
        const split = shaped.splitNote ? `。作業班は工程管理の比率で按分（${shaped.splitNote}）` : ''
        resolved = {
          source: 'cost_list',
          note: `機種一覧 ${canonicalScheduleModel(savedModel)} の工費 ${saved.st_minutes}分/台（${label} / ¥${saved.labor_cost.toLocaleString('ja-JP')}）${split}`,
          stByGroup: shaped.stByGroup,
        }
      } else if (!targetCode) {
        warnings.push(
          `${canonicalScheduleModel(lot.model)}: 機種一覧に工費の時間がなく、D/L指令も未選択のためスキップ`
        )
        continue
      } else {
        warnings.push(
          `${canonicalScheduleModel(lot.model)}: 機種一覧の ${canonicalScheduleModel(laborModel)} に工費の時間がないため、工程管理のSTで算出します`
        )
        resolved = await resolveWorkGroupStMinutes(
          supabase,
          lot.target_type,
          targetCode,
          fiscalYear,
          lot.notes,
          lot.model
        )
      }
    } else if (!targetCode) {
      warnings.push(
        `${canonicalScheduleModel(lot.model)}: 機種一覧に工費がないため、D/L指令を選択してください`
      )
      continue
    } else {
      resolved = await resolveWorkGroupStMinutes(
        supabase,
        lot.target_type,
        targetCode,
        fiscalYear,
        lot.notes,
        lot.model
      )
    }

    if (resolved.source === 'none') {
      warnings.push(
        `${lot.model}${lot.notes ? `(${lot.notes})` : ''}（${targetCode}）: STも標準時間もないためスキップ`
      )
      continue
    }

    const groupEntries = Array.from(resolved.stByGroup.entries())
      .filter(([, st]) => st > 0)
      .map(([code, st]) => {
        const master = workGroupMaster.find((g) => g.work_group_code === code)
        const work_group_name = nameByCode.get(code) || code
        const group_no = code === '_STANDARD' || code === '_LABOR' ? 9999 : master?.group_no ?? 5000
        return {
          work_group_code: code,
          work_group_name,
          st_minutes: st,
          group_no,
          process_order:
            code === '_STANDARD' || code === '_LABOR'
              ? 9000
              : master?.process_order ??
                getScheduleProcessOrder(code, work_group_name, group_no),
        }
      })
      .sort(
        (a, b) =>
          a.process_order - b.process_order ||
          a.work_group_code.localeCompare(b.work_group_code)
      )

    if (groupEntries.length === 0) {
      warnings.push(`${lot.model}（${targetCode}）: 有効な班STがありません`)
      continue
    }

    // 機械加工1（板切り）がSTに無い場合は警告（後工程だけの計画になる）
    const laborOnly = groupEntries.length === 1 && groupEntries[0].work_group_code === '_LABOR'
    if (!laborOnly && !groupEntries.some((g) => g.process_order === 1)) {
      warnings.push(
        `${lot.model}: 機械加工1班（板切り）のSTが無いため、後工程のみで計画しています`
      )
    }

    const workGroups: ScheduleWorkGroupPlan[] = []
    // 同一機種内は工程順。前工程（板切り等）完了後に次工程へ
    let lotReady = startDate

    for (const group of groupEntries) {
      const totalMinutes = group.st_minutes * lot.quantity
      const days = ceilDays(totalMinutes, minutesPerDay)
      const groupFree = groupAvailable.get(group.work_group_code) || startDate
      // 班が空き、かつ前工程が終わってから着手（他機種とパイプライン）
      const begin = maxWorkDate(lotReady, groupFree)
      const dates = collectWorkingDates(begin, days)
      if (dates.length === 0) continue
      const start = dates[0]
      const end = dates[dates.length - 1]
      workGroups.push({
        work_group_code: group.work_group_code,
        work_group_name: group.work_group_name,
        st_minutes: group.st_minutes,
        total_minutes: Math.round(totalMinutes * 10) / 10,
        days,
        start_date: start,
        end_date: end,
        dates,
        actual_minutes: 0,
        progress_pct: null,
      })
      usedGroups.set(group.work_group_code, group.work_group_name)
      const plannedPerDay = days > 0 ? Math.round((totalMinutes / days) * 10) / 10 : 0
      for (const date of dates) {
        occupancy.push({
          date,
          work_group_code: group.work_group_code,
          work_group_name: group.work_group_name,
          lot_key: lot.key,
          model: lot.model,
          sequence: lot.sequence,
          color_index: lotIndex % 8,
          planned_minutes_per_day: plannedPerDay,
          actual_minutes: 0,
          has_plan: true,
          has_actual: false,
        })
      }
      const nextDay = shiftWorkingDate(end, 1)
      groupAvailable.set(group.work_group_code, nextDay)
      lotReady = nextDay
    }

    if (workGroups.length === 0) continue

    const lotStart = workGroups[0].start_date
    const lotEnd = workGroups[workGroups.length - 1].end_date
    results.push({
      key: lot.key,
      model: lot.model,
      quantity: lot.quantity,
      sequence: lot.sequence,
      target_type: lot.target_type,
      target_code: targetCode,
      label: lot.label || null,
      notes: normalizeSpecKey(lot.notes) || lot.notes || null,
      st_source: resolved.source,
      st_note: resolved.note,
      unit_st_minutes: laborQuote?.st_minutes ?? Math.round(sumStMinutes(resolved.stByGroup)),
      unit_labor_cost:
        laborQuote?.labor_cost ??
        quoteLaborFromStMinutes(sumStMinutes(resolved.stByGroup), fiscalYear).labor_cost,
      unit_indirect_cost:
        laborQuote?.indirect_cost ??
        quoteLaborFromStMinutes(sumStMinutes(resolved.stByGroup), fiscalYear).indirect_cost,
      labor_model: appliedLaborModel,
      start_date: lotStart,
      end_date: lotEnd,
      total_days: workGroups.reduce((sum, g) => sum + g.days, 0),
      lead_time_working_days: countWorkingDaysInclusive(lotStart, lotEnd),
      lead_time_calendar_days: countCalendarDaysInclusive(lotStart, lotEnd),
      work_groups: workGroups,
      progress: {
        planned_qty: lot.quantity,
        completed_qty: 0,
        qty_progress_pct: null,
        planned_minutes: workGroups.reduce((sum, g) => sum + g.total_minutes, 0),
        actual_minutes: 0,
        minutes_progress_pct: null,
      },
    })
  }

  const allDates = Array.from(new Set(occupancy.map((c) => c.date))).sort()
  const workGroups = Array.from(usedGroups.entries())
    .map(([work_group_code, work_group_name]) => ({
      work_group_code,
      work_group_name,
      process_order: getScheduleProcessOrder(
        work_group_code,
        work_group_name,
        workGroupMaster.find((g) => g.work_group_code === work_group_code)?.group_no ?? 0
      ),
    }))
    .sort(
      (a, b) =>
        a.process_order - b.process_order ||
        a.work_group_code.localeCompare(b.work_group_code)
    )
    .map(({ work_group_code, work_group_name }) => ({ work_group_code, work_group_name }))

  const base: ProductionScheduleResult = {
    start_date: startDate,
    minutes_per_day: minutesPerDay,
    fiscal_year: fiscalYear,
    as_of_date: todayIsoLocal(),
    lots: results,
    calendar: {
      dates: allDates,
      work_groups: workGroups,
      cells: occupancy,
    },
    progress_summary: {
      planned_qty: results.reduce((sum, lot) => sum + lot.quantity, 0),
      completed_qty: 0,
      planned_minutes: results.reduce((sum, lot) => sum + lot.progress.planned_minutes, 0),
      actual_minutes: 0,
      qty_progress_pct: null,
      minutes_progress_pct: null,
    },
    warnings,
  }

  try {
    return await attachScheduleProgress(supabase, base)
  } catch (error) {
    warnings.push(
      `実績進捗の取得に失敗: ${error instanceof Error ? error.message : 'unknown'}`
    )
    return { ...base, warnings }
  }
}

export type SavedScheduleLotInput = ScheduleLotInput & {
  suggestions?: Array<{ target_type: ProcessTargetType; target_code: string; label: string }>
}

export type SavedProductionScheduleSummary = {
  id: string
  schedule_name: string
  start_date: string
  minutes_per_day: number
  fiscal_year: number
  source_plan_id: string | null
  source_plan_name: string | null
  lot_count: number
  created_at: string
}

export type SavedProductionSchedule = SavedProductionScheduleSummary & {
  lots: SavedScheduleLotInput[]
  result: ProductionScheduleResult
}

function isMissingProductionSchedulesTable(error: { code?: string; message?: string }) {
  return (
    error.code === '42P01' ||
    error.code === 'PGRST205' ||
    (error.message || '').includes('production_schedules') ||
    (error.message || '').includes('does not exist')
  )
}

function formatProductionSchedulesTableError(error: unknown): Error {
  if (error && typeof error === 'object' && 'message' in error) {
    const record = error as { code?: string; message: string }
    if (isMissingProductionSchedulesTable(record)) {
      return new Error(
        'production_schedules テーブルがありません。Supabaseで create-production-schedules.sql を実行してください。'
      )
    }
    return new Error(record.message)
  }
  return error instanceof Error ? error : new Error('スケジュール保存の処理に失敗しました')
}

/** 保存名: スケジュール YYYY-MM-DD HH:mm（同一分は秒を付与） */
export function buildAutoScheduleName(now = new Date()) {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  const hh = String(now.getHours()).padStart(2, '0')
  const mm = String(now.getMinutes()).padStart(2, '0')
  const ss = String(now.getSeconds()).padStart(2, '0')
  return {
    base: `スケジュール ${y}-${m}-${d} ${hh}:${mm}`,
    withSeconds: `スケジュール ${y}-${m}-${d} ${hh}:${mm}:${ss}`,
  }
}

export async function listSavedProductionSchedules(
  supabase: SupabaseClient
): Promise<SavedProductionScheduleSummary[]> {
  const { data, error } = await supabase
    .from('production_schedules')
    .select(
      'id, schedule_name, start_date, minutes_per_day, fiscal_year, source_plan_id, source_plan_name, lots_json, created_at'
    )
    .order('created_at', { ascending: false })
  if (error) throw formatProductionSchedulesTableError(error)

  return (data || []).map((row) => {
    const lots = Array.isArray(row.lots_json) ? row.lots_json : []
    return {
      id: String(row.id),
      schedule_name: String(row.schedule_name),
      start_date: String(row.start_date),
      minutes_per_day: Number(row.minutes_per_day) || DEFAULT_MINUTES_PER_DAY,
      fiscal_year: Number(row.fiscal_year) || getCurrentFiscalYear(),
      source_plan_id: row.source_plan_id ? String(row.source_plan_id) : null,
      source_plan_name: row.source_plan_name ? String(row.source_plan_name) : null,
      lot_count: lots.length,
      created_at: String(row.created_at),
    }
  })
}

export async function saveProductionSchedule(
  supabase: SupabaseClient,
  input: {
    start_date: string
    minutes_per_day: number
    fiscal_year: number
    source_plan_id?: string | null
    source_plan_name?: string | null
    lots: SavedScheduleLotInput[]
    result: ProductionScheduleResult
  }
): Promise<SavedProductionScheduleSummary> {
  const names = buildAutoScheduleName()
  let scheduleName = names.base

  const { data: existing } = await supabase
    .from('production_schedules')
    .select('id')
    .eq('schedule_name', scheduleName)
    .limit(1)
  if (existing && existing.length > 0) {
    scheduleName = names.withSeconds
  }

  const { data, error } = await supabase
    .from('production_schedules')
    .insert({
      schedule_name: scheduleName,
      start_date: normalizeWorkDate(input.start_date),
      minutes_per_day: input.minutes_per_day,
      fiscal_year: input.fiscal_year,
      source_plan_id: input.source_plan_id || null,
      source_plan_name: input.source_plan_name || null,
      lots_json: input.lots,
      result_json: input.result,
    })
    .select(
      'id, schedule_name, start_date, minutes_per_day, fiscal_year, source_plan_id, source_plan_name, lots_json, created_at'
    )
    .single()

  if (error) throw formatProductionSchedulesTableError(error)

  const lots = Array.isArray(data.lots_json) ? data.lots_json : []
  return {
    id: String(data.id),
    schedule_name: String(data.schedule_name),
    start_date: String(data.start_date),
    minutes_per_day: Number(data.minutes_per_day) || DEFAULT_MINUTES_PER_DAY,
    fiscal_year: Number(data.fiscal_year) || getCurrentFiscalYear(),
    source_plan_id: data.source_plan_id ? String(data.source_plan_id) : null,
    source_plan_name: data.source_plan_name ? String(data.source_plan_name) : null,
    lot_count: lots.length,
    created_at: String(data.created_at),
  }
}

export async function loadSavedProductionSchedule(
  supabase: SupabaseClient,
  id: string,
  options?: { refreshProgress?: boolean }
): Promise<SavedProductionSchedule> {
  const { data, error } = await supabase
    .from('production_schedules')
    .select(
      'id, schedule_name, start_date, minutes_per_day, fiscal_year, source_plan_id, source_plan_name, lots_json, result_json, created_at'
    )
    .eq('id', id)
    .single()

  if (error) throw formatProductionSchedulesTableError(error)
  if (!data) throw new Error('保存スケジュールが見つかりません')

  const lots = (Array.isArray(data.lots_json) ? data.lots_json : []) as SavedScheduleLotInput[]
  let result = data.result_json as ProductionScheduleResult
  if (!result || typeof result !== 'object') {
    throw new Error('保存スケジュールの結果データが不正です')
  }

  if (options?.refreshProgress !== false) {
    try {
      result = await attachScheduleProgress(supabase, {
        ...result,
        as_of_date: todayIsoLocal(),
      })
    } catch (progressError) {
      const warning =
        progressError instanceof Error ? progressError.message : '実績進捗の再集計に失敗'
      result = {
        ...result,
        warnings: [...(result.warnings || []), `実績進捗の再集計に失敗: ${warning}`],
      }
    }
  }

  return {
    id: String(data.id),
    schedule_name: String(data.schedule_name),
    start_date: String(data.start_date),
    minutes_per_day: Number(data.minutes_per_day) || DEFAULT_MINUTES_PER_DAY,
    fiscal_year: Number(data.fiscal_year) || getCurrentFiscalYear(),
    source_plan_id: data.source_plan_id ? String(data.source_plan_id) : null,
    source_plan_name: data.source_plan_name ? String(data.source_plan_name) : null,
    lot_count: lots.length,
    created_at: String(data.created_at),
    lots,
    result,
  }
}
