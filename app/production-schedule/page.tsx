'use client'

import Link from 'next/link'
import { Fragment, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { getCurrentFiscalYear } from '@/lib/fiscal-year'

type Plan = {
  id: string
  plan_name: string | null
  fiscal_year: number | null
  plan_period: string | null
  product_category?: string | null
}

type SavedSchedule = {
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

type TargetOption = {
  target_type: 'line' | 'instruction'
  target_code: string
  name: string
  subtitle: string | null
}

type LotRow = {
  key: string
  model: string
  quantity: number
  sequence: number
  target_type: 'line' | 'instruction'
  target_code: string
  label: string
  notes: string
  suggestions: Array<{ target_type: 'line' | 'instruction'; target_code: string; label: string }>
}

type ScheduleResult = {
  start_date: string
  minutes_per_day: number
  fiscal_year: number
  as_of_date: string
  lots: Array<{
    key: string
    model: string
    quantity: number
    sequence: number
    target_type: string
    target_code: string
    label: string | null
    notes: string | null
    st_source: string
    st_note: string | null
    start_date: string
    end_date: string
    total_days: number
    lead_time_working_days: number
    lead_time_calendar_days: number
    progress: {
      planned_qty: number
      completed_qty: number
      qty_progress_pct: number | null
      planned_minutes: number
      actual_minutes: number
      minutes_progress_pct: number | null
    }
    work_groups: Array<{
      work_group_code: string
      work_group_name: string
      st_minutes: number
      total_minutes: number
      actual_minutes: number
      progress_pct: number | null
      days: number
      start_date: string
      end_date: string
    }>
  }>
  calendar: {
    dates: string[]
    work_groups: Array<{ work_group_code: string; work_group_name: string }>
    cells: Array<{
      date: string
      work_group_code: string
      lot_key: string | null
      model: string | null
      sequence: number | null
      color_index: number
      planned_minutes_per_day: number
      actual_minutes: number
      has_plan: boolean
      has_actual: boolean
    }>
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

const LOT_COLORS = [
  'bg-sky-500',
  'bg-violet-500',
  'bg-emerald-500',
  'bg-amber-500',
  'bg-rose-500',
  'bg-cyan-500',
  'bg-fuchsia-500',
  'bg-lime-600',
]

const LOT_COLOR_HEX = [
  '#0ea5e9',
  '#8b5cf6',
  '#10b981',
  '#f59e0b',
  '#f43f5e',
  '#06b6d4',
  '#d946ef',
  '#65a30d',
]

function todayIso() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function formatShortDate(iso: string) {
  const m = iso.match(/^\d{4}-(\d{2})-(\d{2})$/)
  if (!m) return iso
  return `${Number(m[1])}/${Number(m[2])}`
}

function formatLeadBreakdown(
  workGroups: ScheduleResult['lots'][number]['work_groups']
): string {
  return workGroups
    .map((g) => `${g.work_group_name} ${g.days}日(${formatShortDate(g.start_date)}〜${formatShortDate(g.end_date)})`)
    .join(' → ')
}

function formatMonthLabel(iso: string) {
  const m = iso.match(/^(\d{4})-(\d{2})/)
  if (!m) return iso
  return `${m[1]}年${Number(m[2])}月`
}

/** 印刷用: カレンダー日付を月ごとに分割 */
function groupDatesByMonth(dates: string[]): Array<{ monthKey: string; label: string; dates: string[] }> {
  const groups: Array<{ monthKey: string; label: string; dates: string[] }> = []
  for (const date of dates) {
    const monthKey = date.slice(0, 7) // YYYY-MM
    const last = groups[groups.length - 1]
    if (last && last.monthKey === monthKey) {
      last.dates.push(date)
    } else {
      groups.push({
        monthKey,
        label: formatMonthLabel(date),
        dates: [date],
      })
    }
  }
  return groups
}

/** 印刷用: 月ブロックを N か月ずつ1ページにまとめる */
function chunkMonthsForPrint<T>(months: T[], perPage: number): T[][] {
  if (months.length === 0) return []
  const pages: T[][] = []
  for (let i = 0; i < months.length; i += perPage) {
    pages.push(months.slice(i, i + perPage))
  }
  return pages
}

const PRINT_MONTHS_PER_PAGE = 2

function ProgressBar({
  pctValue,
  label,
}: {
  pctValue: number | null
  label: string
}) {
  const width = pctValue == null ? 0 : Math.min(100, Math.max(0, pctValue))
  const tone =
    pctValue == null
      ? 'bg-slate-600'
      : pctValue >= 100
        ? 'bg-emerald-500'
        : pctValue >= 60
          ? 'bg-sky-500'
          : 'bg-amber-500'
  return (
    <div className="min-w-[8rem]">
      <div className="mb-0.5 flex justify-between text-[10px] text-slate-300">
        <span>{label}</span>
        <span>{pctValue == null ? '—' : `${pctValue}%`}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-700">
        <div className={`h-full ${tone}`} style={{ width: `${width}%` }} />
      </div>
    </div>
  )
}

export default function ProductionSchedulePage() {
  const [plans, setPlans] = useState<Plan[]>([])
  const [savedSchedules, setSavedSchedules] = useState<SavedSchedule[]>([])
  const [targets, setTargets] = useState<TargetOption[]>([])
  const [planId, setPlanId] = useState('')
  const [savedScheduleId, setSavedScheduleId] = useState('')
  const [startDate, setStartDate] = useState(todayIso())
  const [minutesPerDay, setMinutesPerDay] = useState(480)
  const [fiscalYear, setFiscalYear] = useState(getCurrentFiscalYear())
  const [lots, setLots] = useState<LotRow[]>([])
  const [result, setResult] = useState<ScheduleResult | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [progress, setProgress] = useState<{ pct: number; label: string } | null>(null)

  const refreshSavedSchedules = async () => {
    const res = await fetch('/api/production-schedule?list=schedules')
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || '保存スケジュール一覧の取得に失敗')
    setSavedSchedules(data.schedules || [])
    return data.schedules as SavedSchedule[]
  }

  useEffect(() => {
    const load = async () => {
      try {
        const [plansRes, targetsRes, schedulesRes] = await Promise.all([
          fetch('/api/production-schedule?list=plans'),
          fetch('/api/production-schedule?list=targets'),
          fetch('/api/production-schedule?list=schedules'),
        ])
        const plansData = await plansRes.json()
        const targetsData = await targetsRes.json()
        const schedulesData = await schedulesRes.json()
        if (!plansRes.ok) throw new Error(plansData.error || '計画一覧の取得に失敗')
        if (!targetsRes.ok) throw new Error(targetsData.error || '対象一覧の取得に失敗')
        setPlans(plansData.plans || [])
        setTargets(targetsData.targets || [])
        if (schedulesRes.ok) {
          setSavedSchedules(schedulesData.schedules || [])
        } else if (schedulesData.error) {
          setInfo(schedulesData.error)
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : '初期読込に失敗しました')
      }
    }
    void load()
  }, [])

  const targetOptions = useMemo(() => {
    return targets.map((t) => ({
      value: `${t.target_type}:${t.target_code}`,
      label: `${t.target_type === 'line' ? 'L' : 'D'} ${t.target_code} ${t.name}${
        t.subtitle ? ` / ${t.subtitle}` : ''
      }`,
      target_type: t.target_type,
      target_code: t.target_code,
    }))
  }, [targets])

  const loadPlan = async (id: string) => {
    setPlanId(id)
    setSavedScheduleId('')
    setResult(null)
    setInfo(null)
    if (!id) {
      setLots([])
      return
    }
    setIsLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/production-schedule?list=plan-details&plan_id=${encodeURIComponent(id)}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '計画明細の取得に失敗')
      const rows: LotRow[] = (data.details || []).map(
        (
          d: {
            model: string
            quantity: number
            suggested_notes: string | null
            suggested_target: { target_type: 'line' | 'instruction'; target_code: string; label: string } | null
            suggestions: LotRow['suggestions']
          },
          index: number
        ) => ({
          key: `${d.model}-${index}`,
          model: d.model,
          quantity: d.quantity,
          sequence: index + 1,
          // 指令は未選択のまま（画面の初期状態）。推奨は選択肢に残す
          target_type: 'instruction',
          target_code: '',
          label: '',
          notes: d.suggested_notes || '',
          suggestions: d.suggestions || [],
        })
      )
      setLots(rows)
      const plan = plans.find((p) => p.id === id)
      if (plan?.fiscal_year) setFiscalYear(plan.fiscal_year)
    } catch (e) {
      setError(e instanceof Error ? e.message : '計画読込に失敗しました')
    } finally {
      setIsLoading(false)
    }
  }

  const loadSavedSchedule = async (id: string) => {
    setSavedScheduleId(id)
    if (!id) return
    setIsLoading(true)
    setError(null)
    setInfo(null)
    setProgress({ pct: 20, label: '保存スケジュールを読み込んでいます…' })
    try {
      const res = await fetch(
        `/api/production-schedule?list=schedule&id=${encodeURIComponent(id)}`
      )
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '保存スケジュールの取得に失敗')
      const schedule = data.schedule
      setPlanId(schedule.source_plan_id || '')
      setStartDate(schedule.start_date || todayIso())
      setMinutesPerDay(schedule.minutes_per_day || 480)
      setFiscalYear(schedule.fiscal_year || getCurrentFiscalYear())
      const rows: LotRow[] = (schedule.lots || []).map(
        (
          lot: {
            key?: string
            model: string
            quantity: number
            sequence: number
            target_type: 'line' | 'instruction'
            target_code: string
            label?: string | null
            notes?: string | null
            suggestions?: LotRow['suggestions']
          },
          index: number
        ) => ({
          key: lot.key || `${lot.model}-${index}`,
          model: lot.model,
          quantity: lot.quantity,
          sequence: lot.sequence || index + 1,
          target_type: lot.target_type || 'instruction',
          target_code: lot.target_code || '',
          label: lot.label || '',
          notes: lot.notes || '',
          suggestions: lot.suggestions || [],
        })
      )
      setLots(rows)
      setResult(schedule.result as ScheduleResult)
      setProgress({ pct: 100, label: '読込完了' })
      setInfo(`「${schedule.schedule_name}」を呼び出しました（進捗は最新実績で再集計）`)
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存スケジュールの読込に失敗しました')
      setProgress(null)
    } finally {
      setIsLoading(false)
      window.setTimeout(() => setProgress(null), 500)
    }
  }

  const saveCurrentSchedule = async () => {
    if (!result) return
    setIsSaving(true)
    setError(null)
    setInfo(null)
    try {
      const plan = plans.find((p) => p.id === planId)
      const res = await fetch('/api/production-schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save',
          start_date: startDate,
          minutes_per_day: minutesPerDay,
          fiscal_year: fiscalYear,
          source_plan_id: planId || null,
          source_plan_name: plan?.plan_name || null,
          lots,
          result,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '保存に失敗しました')
      const schedules = await refreshSavedSchedules()
      const saved = data.schedule as SavedSchedule
      setSavedScheduleId(saved.id)
      if (!schedules.some((s) => s.id === saved.id)) {
        setSavedSchedules([saved, ...schedules])
      }
      setInfo(`「${saved.schedule_name}」として保存しました`)
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存に失敗しました')
    } finally {
      setIsSaving(false)
    }
  }

  const updateLot = (key: string, patch: Partial<LotRow>) => {
    setLots((prev) => prev.map((lot) => (lot.key === key ? { ...lot, ...patch } : lot)))
  }

  const calculate = async () => {
    setIsLoading(true)
    setError(null)
    setInfo(null)
    setSavedScheduleId('')
    setProgress({ pct: 12, label: 'スケジュールを算出しています…' })
    const progressTimer = setInterval(() => {
      setProgress((prev) => {
        if (!prev || prev.pct >= 88) return prev
        const next = Math.min(88, prev.pct + (prev.pct < 40 ? 6 : 3))
        const label =
          next < 45
            ? 'STを解決しリードタイムを積み上げています…'
            : '作業日報・工程管理の実績進捗を集計しています…'
        return { pct: next, label }
      })
    }, 350)
    try {
      const res = await fetch('/api/production-schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          start_date: startDate,
          minutes_per_day: minutesPerDay,
          fiscal_year: fiscalYear,
          lots: lots.map((lot) => ({
            key: lot.key,
            model: lot.model,
            quantity: lot.quantity,
            sequence: lot.sequence,
            target_type: lot.target_type,
            target_code: lot.target_code,
            label: lot.label,
            notes: lot.notes || null,
          })),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '算出に失敗しました')
      setProgress({ pct: 100, label: '完了' })
      setResult(data as ScheduleResult)
    } catch (e) {
      setError(e instanceof Error ? e.message : '算出に失敗しました')
      setResult(null)
      setProgress(null)
    } finally {
      clearInterval(progressTimer)
      setIsLoading(false)
      window.setTimeout(() => setProgress(null), 500)
    }
  }

  const cellMap = useMemo(() => {
    const map = new Map<string, ScheduleResult['calendar']['cells'][number]>()
    if (!result) return map
    for (const cell of result.calendar.cells) {
      map.set(`${cell.work_group_code}__${cell.date}`, cell)
    }
    return map
  }, [result])

  const selectedPlanName = useMemo(() => {
    const plan = plans.find((p) => p.id === planId)
    return plan?.plan_name || plan?.id || null
  }, [plans, planId])

  const scheduleSpan = useMemo(() => {
    if (!result || result.lots.length === 0) return null
    const starts = result.lots.map((l) => l.start_date).sort()
    const ends = result.lots.map((l) => l.end_date).sort()
    return { start: starts[0], end: ends[ends.length - 1] }
  }, [result])

  const printMonthPages = useMemo(
    () =>
      chunkMonthsForPrint(
        groupDatesByMonth(result?.calendar.dates || []),
        PRINT_MONTHS_PER_PAGE
      ),
    [result]
  )

  const handlePrint = () => {
    window.print()
  }

  const renderCalendarTable = (
    dates: string[],
    keyPrefix: string,
    options?: { compactDayHeader?: boolean }
  ) => {
    if (!result || dates.length === 0) return null
    const compact = Boolean(options?.compactDayHeader)
    return (
      <table className="min-w-full border-collapse text-xs text-white">
        <thead>
          <tr>
            <th className="sticky left-0 z-10 bg-slate-900 px-2 py-1 text-left text-white">
              作業班
            </th>
            {dates.map((date) => (
              <th
                key={`${keyPrefix}-h-${date}`}
                className="min-w-[2.2rem] px-1 py-1 text-center text-slate-200"
                title={date}
              >
                {compact ? Number(date.slice(8, 10)) : formatShortDate(date)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.calendar.work_groups.map((group) => (
            <Fragment key={`${keyPrefix}-${group.work_group_code}`}>
              <tr className="border-t border-slate-700">
                <td className="sticky left-0 z-10 whitespace-nowrap bg-slate-900 px-2 py-1 font-medium text-white">
                  <div>{group.work_group_name}</div>
                  <div className="text-[10px] font-normal text-sky-300">計画</div>
                </td>
                {dates.map((date) => {
                  const cell = cellMap.get(`${group.work_group_code}__${date}`)
                  const hasPlan = Boolean(cell?.has_plan)
                  const color =
                    LOT_COLOR_HEX[(cell?.color_index ?? 0) % LOT_COLOR_HEX.length]
                  return (
                    <td
                      key={`${keyPrefix}-${group.work_group_code}-plan-${date}`}
                      className="px-0.5 py-0.5"
                    >
                      {hasPlan && cell ? (
                        <div
                          title={`${cell.model || '—'}（順序${cell.sequence ?? '—'}）計画 ${cell.planned_minutes_per_day}分`}
                          className={`ps-bar h-5 rounded-sm ${LOT_COLORS[cell.color_index % LOT_COLORS.length]}`}
                          style={
                            {
                              ['--ps-bg']: color,
                              backgroundColor: color,
                            } as CSSProperties
                          }
                        />
                      ) : (
                        <div className="ps-empty h-5 rounded-sm bg-slate-800/60" />
                      )}
                    </td>
                  )
                })}
              </tr>
              <tr className="border-b border-slate-800">
                <td className="sticky left-0 z-10 whitespace-nowrap bg-slate-900 px-2 py-1 font-medium text-white">
                  <div className="text-[10px] font-normal text-emerald-300">実績</div>
                </td>
                {dates.map((date) => {
                  const cell = cellMap.get(`${group.work_group_code}__${date}`)
                  const hasActual = Boolean(cell?.has_actual)
                  const planned = cell?.planned_minutes_per_day || 0
                  const actual = cell?.actual_minutes || 0
                  const fillPct =
                    planned > 0
                      ? Math.min(100, (actual / planned) * 100)
                      : hasActual
                        ? 100
                        : 0
                  const fillColor = cell?.has_plan ? '#10b981' : '#f97316'
                  return (
                    <td
                      key={`${keyPrefix}-${group.work_group_code}-actual-${date}`}
                      className="px-0.5 py-0.5"
                    >
                      {hasActual && cell ? (
                        <div
                          title={
                            cell.has_plan
                              ? `${cell.model || '—'} 実績 ${actual}分 / 計画 ${planned}分`
                              : `計画外実績 ${actual}分`
                          }
                          className="ps-bar-track relative h-5 overflow-hidden rounded-sm bg-slate-800"
                        >
                          <div
                            className="ps-bar-fill absolute inset-y-0 left-0"
                            style={
                              {
                                width: `${fillPct}%`,
                                ['--ps-bg']: fillColor,
                                backgroundColor: fillColor,
                              } as CSSProperties
                            }
                          />
                        </div>
                      ) : (
                        <div className="ps-empty h-5 rounded-sm bg-slate-800/60" />
                      )}
                    </td>
                  )
                })}
              </tr>
            </Fragment>
          ))}
        </tbody>
      </table>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-indigo-950 to-slate-950 text-white">
      <style>{`
        @media print {
          @page {
            size: A4 landscape;
            margin: 0.6cm;
          }
          body {
            background: white !important;
            color: black !important;
          }
          .no-print {
            display: none !important;
          }
          .schedule-print-root {
            display: block !important;
            color: black !important;
            background: white !important;
          }
          .schedule-print-root,
          .schedule-print-root * {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          .schedule-print-root h1,
          .schedule-print-root h2,
          .schedule-print-root p,
          .schedule-print-root td,
          .schedule-print-root th,
          .schedule-print-root span,
          .schedule-print-root div {
            color: black !important;
            background: transparent !important;
          }
          .schedule-print-root table {
            width: 100% !important;
            border-collapse: collapse !important;
            font-size: 8pt !important;
          }
          .schedule-print-root th,
          .schedule-print-root td {
            border: 1px solid #333 !important;
            padding: 2px 4px !important;
          }
          .schedule-print-root thead th {
            background: #e5e7eb !important;
          }
          .schedule-print-root .ps-swatch {
            display: inline-block !important;
            width: 1.2rem !important;
            height: 0.7rem !important;
            border: 1px solid #333 !important;
            background-color: var(--ps-bg) !important;
          }
          .schedule-print-root .ps-bar {
            display: block !important;
            height: 0.55rem !important;
            border: 1px solid #555 !important;
            border-radius: 1px !important;
            background-color: var(--ps-bg) !important;
          }
          .schedule-print-root .ps-bar-track {
            display: block !important;
            height: 0.55rem !important;
            background: #e5e7eb !important;
            border: 1px solid #555 !important;
            position: relative !important;
            overflow: hidden !important;
          }
          .schedule-print-root .ps-bar-fill {
            display: block !important;
            height: 100% !important;
            background-color: var(--ps-bg) !important;
          }
          .schedule-print-root .ps-empty {
            display: block !important;
            height: 0.55rem !important;
            background: #f3f4f6 !important;
            border: 1px solid #d1d5db !important;
          }
          .schedule-print-section {
            break-inside: avoid;
            page-break-inside: avoid;
            margin-bottom: 12px !important;
          }
          .schedule-print-calendar {
            overflow: visible !important;
            break-inside: auto !important;
            page-break-inside: auto !important;
            page-break-before: always;
            break-before: page;
          }
          .schedule-print-calendar .sticky {
            position: static !important;
          }
          .schedule-print-only {
            display: block !important;
          }
          .schedule-print-calendar-page {
            break-inside: avoid;
            page-break-inside: avoid;
          }
          .schedule-print-calendar-page + .schedule-print-calendar-page {
            page-break-before: always;
            break-before: page;
          }
          .schedule-print-calendar-chunk {
            break-inside: avoid;
            page-break-inside: avoid;
            margin-bottom: 6px !important;
          }
          .schedule-print-calendar-chunk table {
            table-layout: fixed !important;
            width: 100% !important;
            font-size: 6pt !important;
          }
          .schedule-print-calendar-chunk th,
          .schedule-print-calendar-chunk td {
            padding: 0 !important;
            border: 1px solid #666 !important;
          }
          .schedule-print-calendar-chunk th:first-child,
          .schedule-print-calendar-chunk td:first-child {
            width: 3.8rem !important;
            white-space: normal !important;
            font-size: 5.5pt !important;
            padding: 0 1px !important;
          }
          .schedule-print-calendar-chunk th:not(:first-child),
          .schedule-print-calendar-chunk td:not(:first-child) {
            width: auto !important;
            min-width: 0 !important;
            max-width: 0.45cm !important;
            padding: 0 !important;
            font-size: 5pt !important;
            line-height: 1 !important;
            overflow: hidden !important;
          }
          .schedule-print-calendar-chunk .ps-bar,
          .schedule-print-calendar-chunk .ps-bar-track,
          .schedule-print-calendar-chunk .ps-empty {
            height: 0.26rem !important;
            min-height: 0.26rem !important;
            border-radius: 0 !important;
          }
          .schedule-print-month-title {
            font-size: 9pt !important;
            font-weight: 700 !important;
            margin: 0 0 2px 0 !important;
          }
        }
        .schedule-print-only {
          display: none;
        }
      `}</style>
      <div className="mx-auto max-w-7xl px-4 py-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 no-print">
          <div>
            <p className="text-sm text-sky-300">生産計画 → 班別占有カレンダー</p>
            <h1 className="text-2xl font-bold text-white">生産スケジュール</h1>
            <p className="mt-1 text-sm text-slate-200">
              製造計画の台数×工程STで所要日数を積み上げ、作業班が空き次第次機種を流し込むパイプラインでカレンダーに塗りつぶします。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!result}
              onClick={handlePrint}
              className="rounded-lg border border-emerald-500/60 bg-emerald-900/40 px-3 py-2 text-sm text-emerald-100 hover:bg-emerald-800/50 disabled:opacity-50"
            >
              リードタイム・カレンダー印刷
            </button>
            <Link
              href="/"
              className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-white hover:bg-slate-700"
            >
              ホームへ
            </Link>
          </div>
        </div>

        <div className="mb-6 grid gap-4 rounded-2xl border border-slate-700 bg-slate-900/80 p-5 shadow-xl no-print">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <label className="text-sm text-white">
              <span className="mb-1 block font-medium text-white">製造計画</span>
              <select
                className="w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-white"
                value={planId}
                onChange={(e) => void loadPlan(e.target.value)}
              >
                <option value="">選択してください</option>
                {plans.map((plan) => (
                  <option key={plan.id} value={plan.id}>
                    {plan.plan_name || plan.id}
                    {plan.product_category ? ` / ${plan.product_category}` : ''}
                    {plan.fiscal_year ? `（${plan.fiscal_year}年度）` : ''}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm text-white">
              <span className="mb-1 block font-medium text-white">保存済みスケジュール</span>
              <select
                className="w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-white"
                value={savedScheduleId}
                onChange={(e) => void loadSavedSchedule(e.target.value)}
              >
                <option value="">選択して呼び出し</option>
                {savedSchedules.map((schedule) => (
                  <option key={schedule.id} value={schedule.id}>
                    {schedule.schedule_name}
                    {schedule.lot_count ? `（${schedule.lot_count}ロット）` : ''}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm text-white">
              <span className="mb-1 block font-medium text-white">生産開始日</span>
              <input
                type="date"
                className="w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-white [color-scheme:dark]"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </label>
            <label className="text-sm text-white">
              <span className="mb-1 block font-medium text-white">1日稼働（分）</span>
              <input
                type="number"
                min={60}
                className="w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-white"
                value={minutesPerDay}
                onChange={(e) => setMinutesPerDay(Number(e.target.value) || 480)}
              />
            </label>
            <label className="text-sm text-white">
              <span className="mb-1 block font-medium text-white">参照年度（平均ST）</span>
              <input
                type="number"
                className="w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-white"
                value={fiscalYear}
                onChange={(e) => setFiscalYear(Number(e.target.value) || getCurrentFiscalYear())}
              />
            </label>
          </div>

          <p className="text-xs text-slate-300">
            ST優先順: 工程管理で機種×指令に「スケジュールに適用」した年平均ST → 直近製作ロット平均 → 年度平均 → D/L指令標準時間（年平均ST合計を優先採用）。
            指令の標準時間も工程管理の年平均ST合計を採用します。
            たばこ／食品／光合成／その他（D指令）は、工程管理の年平均に適用チェックを入れて根拠を確定してください。
            UFのSTは DF＋UF差分（UF=DF+UF）。工程順: 機械加工1班（板切り）→ 機械加工2班 → 組み立て1班 → 2班 → 3班。
            板切り完了後に後工程へ。班が空き次第、次順序の機種を流し込む（パイプライン）。
          </p>

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm text-white">
              <thead>
                <tr className="border-b border-slate-700 text-left text-slate-200">
                  <th className="px-2 py-2">順序</th>
                  <th className="px-2 py-2">機種</th>
                  <th className="px-2 py-2">台数</th>
                  <th className="px-2 py-2">規格</th>
                  <th className="px-2 py-2">D/L指令</th>
                </tr>
              </thead>
              <tbody>
                {lots.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-2 py-6 text-center text-slate-300">
                      製造計画を選択すると機種一覧が入ります
                    </td>
                  </tr>
                ) : (
                  lots.map((lot) => (
                    <tr key={lot.key} className="border-b border-slate-800">
                      <td className="px-2 py-2">
                        <input
                          type="number"
                          className="w-20 rounded border border-slate-600 bg-slate-950 px-2 py-1 text-white"
                          value={lot.sequence}
                          onChange={(e) =>
                            updateLot(lot.key, { sequence: Number(e.target.value) || 1 })
                          }
                        />
                      </td>
                      <td className="px-2 py-2 font-medium text-white">{lot.model}</td>
                      <td className="px-2 py-2">
                        <input
                          type="number"
                          min={1}
                          className="w-24 rounded border border-slate-600 bg-slate-950 px-2 py-1 text-white"
                          value={lot.quantity}
                          onChange={(e) =>
                            updateLot(lot.key, { quantity: Number(e.target.value) || 0 })
                          }
                        />
                      </td>
                      <td className="px-2 py-2">
                        <select
                          className="w-24 rounded border border-slate-600 bg-slate-950 px-2 py-1 text-white"
                          value={lot.notes}
                          onChange={(e) => updateLot(lot.key, { notes: e.target.value })}
                        >
                          <option value="">なし</option>
                          <option value="UF">UF</option>
                          <option value="DF">DF</option>
                        </select>
                      </td>
                      <td className="px-2 py-2 min-w-[22rem]">
                        <select
                          className="w-full rounded border border-slate-600 bg-slate-950 px-2 py-1 text-white"
                          value={
                            lot.target_code ? `${lot.target_type}:${lot.target_code}` : ''
                          }
                          onChange={(e) => {
                            const value = e.target.value
                            if (!value) {
                              updateLot(lot.key, { target_code: '', label: '' })
                              return
                            }
                            const [target_type, ...rest] = value.split(':')
                            const target_code = rest.join(':')
                            const opt = targetOptions.find((o) => o.value === value)
                            updateLot(lot.key, {
                              target_type: target_type as 'line' | 'instruction',
                              target_code,
                              label: opt?.label || value,
                            })
                          }}
                        >
                          <option value="">未選択</option>
                          {lot.suggestions.map((s) => (
                            <option
                              key={`sug-${s.target_type}:${s.target_code}`}
                              value={`${s.target_type}:${s.target_code}`}
                            >
                              推奨: {s.label}
                            </option>
                          ))}
                          {targetOptions.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              disabled={isLoading || isSaving || !result}
              onClick={() => void saveCurrentSchedule()}
              className="rounded-lg border border-emerald-500/60 bg-emerald-900/50 px-4 py-2 text-sm font-medium text-emerald-100 hover:bg-emerald-800/60 disabled:opacity-50"
            >
              {isSaving ? '保存中…' : 'スケジュールを保存（日付自動）'}
            </button>
            <button
              type="button"
              disabled={isLoading || isSaving || lots.length === 0}
              onClick={() => void calculate()}
              className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50"
            >
              {isLoading ? '算出中…' : 'スケジュール算出'}
            </button>
          </div>

          {progress && (
            <div className="rounded-xl border border-sky-500/40 bg-sky-950/50 px-4 py-3">
              <div className="mb-2 flex items-center justify-between gap-3 text-sm">
                <span className="font-medium text-sky-100">{progress.label}</span>
                <span className="tabular-nums text-sky-300">{progress.pct}%</span>
              </div>
              <div className="h-2.5 overflow-hidden rounded-full bg-slate-800">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-sky-500 to-indigo-500 transition-all duration-300"
                  style={{ width: `${progress.pct}%` }}
                />
              </div>
            </div>
          )}
        </div>

        {info && (
          <div className="mb-4 rounded-xl border border-emerald-500/40 bg-emerald-950/50 px-4 py-3 text-sm text-emerald-100 no-print">
            {info}
          </div>
        )}

        {error && (
          <div className="mb-4 rounded-xl border border-rose-500/50 bg-rose-950/60 px-4 py-3 text-sm text-rose-100 no-print">
            {error}
          </div>
        )}

        {result && (
          <div className="schedule-print-root space-y-6">
            <div className="mb-2 hidden print:block schedule-print-section">
              <h1 className="text-lg font-bold">生産スケジュール（リードタイム・カレンダー）</h1>
              <p className="text-xs mt-1">
                {selectedPlanName ? `計画: ${selectedPlanName} ／ ` : ''}
                開始日: {result.start_date} ／ 1日稼働: {result.minutes_per_day}分 ／ 参照年度:{' '}
                {result.fiscal_year} ／ 基準日: {result.as_of_date}
                {scheduleSpan ? ` ／ 全体期間: ${scheduleSpan.start} 〜 ${scheduleSpan.end}` : ''}
              </p>
            </div>

            {result.warnings.length > 0 && (
              <div className="rounded-xl border border-amber-500/40 bg-amber-950/50 px-4 py-3 text-sm text-amber-100 no-print">
                {result.warnings.map((w, i) => (
                  <p key={i}>{w}</p>
                ))}
              </div>
            )}

            <div className="grid gap-4 rounded-2xl border border-slate-700 bg-slate-900/80 p-5 shadow-xl sm:grid-cols-2 lg:grid-cols-4 no-print">
              <div>
                <p className="text-xs text-slate-300">基準日（実績集計）</p>
                <p className="text-lg font-semibold text-white">{result.as_of_date}</p>
              </div>
              <div>
                <p className="text-xs text-slate-300">完成台数進捗（工程管理）</p>
                <p className="text-lg font-semibold text-white">
                  {result.progress_summary.completed_qty} / {result.progress_summary.planned_qty} 台
                </p>
                <ProgressBar
                  pctValue={result.progress_summary.qty_progress_pct}
                  label="台数"
                />
              </div>
              <div>
                <p className="text-xs text-slate-300">工数進捗（作業日報）</p>
                <p className="text-lg font-semibold text-white">
                  {Math.round(result.progress_summary.actual_minutes)} /{' '}
                  {Math.round(result.progress_summary.planned_minutes)} 分
                </p>
                <ProgressBar
                  pctValue={result.progress_summary.minutes_progress_pct}
                  label="工数"
                />
              </div>
              <div className="text-xs text-slate-300 space-y-1">
                <p>稼働日LT: 着手〜完了の稼働日（土日除く）</p>
                <p>暦日LT: 着手〜完了のカレンダー日数</p>
                <p>工程内訳: 各班の占有日数と期間</p>
              </div>
            </div>

            <div className="overflow-x-auto rounded-2xl border border-slate-700 bg-slate-900/80 p-5 shadow-xl schedule-print-section">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-lg font-semibold text-white">ロット別リードタイム</h2>
                  <p className="mt-1 text-xs text-slate-300 no-print">
                    稼働日LTは着手〜完了の稼働日数、暦日LTは土日を含む日数です。工程内訳は各班の占有です。
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handlePrint}
                  className="rounded-lg border border-slate-500 bg-slate-800 px-3 py-1.5 text-xs text-white hover:bg-slate-700 no-print"
                >
                  印刷
                </button>
              </div>
              <table className="min-w-full text-sm text-white">
                <thead>
                  <tr className="border-b border-slate-700 text-left text-slate-200">
                    <th className="px-2 py-2">色</th>
                    <th className="px-2 py-2">順序</th>
                    <th className="px-2 py-2">機種</th>
                    <th className="px-2 py-2">規格</th>
                    <th className="px-2 py-2">指令</th>
                    <th className="px-2 py-2">着手</th>
                    <th className="px-2 py-2">完了</th>
                    <th className="px-2 py-2">稼働日LT</th>
                    <th className="px-2 py-2">暦日LT</th>
                    <th className="px-2 py-2">工程内訳</th>
                    <th className="px-2 py-2 no-print">台数進捗</th>
                    <th className="px-2 py-2 no-print">工数進捗</th>
                  </tr>
                </thead>
                <tbody>
                  {result.lots.map((lot, index) => (
                    <tr key={lot.key} className="border-b border-slate-800 align-top">
                      <td className="px-2 py-2">
                        <span
                          className={`ps-swatch inline-block h-3 w-6 rounded ${LOT_COLORS[index % LOT_COLORS.length]}`}
                          style={
                            {
                              ['--ps-bg']: LOT_COLOR_HEX[index % LOT_COLOR_HEX.length],
                              backgroundColor: LOT_COLOR_HEX[index % LOT_COLOR_HEX.length],
                            } as CSSProperties
                          }
                        />
                      </td>
                      <td className="px-2 py-2 text-white">{lot.sequence}</td>
                      <td className="px-2 py-2 text-white">
                        {lot.model} × {lot.quantity}
                        <div className="text-[10px] text-slate-400 no-print">
                          {lot.st_note || lot.st_source}
                        </div>
                      </td>
                      <td className="px-2 py-2 text-white">{lot.notes || '—'}</td>
                      <td className="px-2 py-2 text-white whitespace-nowrap">
                        {lot.target_type === 'line' ? 'L' : 'D'} {lot.target_code}
                      </td>
                      <td className="px-2 py-2 text-white whitespace-nowrap">{lot.start_date}</td>
                      <td className="px-2 py-2 text-white whitespace-nowrap">{lot.end_date}</td>
                      <td className="px-2 py-2 text-white tabular-nums font-semibold">
                        {lot.lead_time_working_days ?? lot.total_days}日
                      </td>
                      <td className="px-2 py-2 text-white tabular-nums">
                        {lot.lead_time_calendar_days ?? '—'}日
                      </td>
                      <td className="px-2 py-2 text-[11px] text-slate-200 max-w-xs">
                        {formatLeadBreakdown(lot.work_groups)}
                      </td>
                      <td className="px-2 py-2 no-print">
                        <div className="text-xs text-slate-200 mb-1">
                          {lot.progress.completed_qty} / {lot.progress.planned_qty} 台
                        </div>
                        <ProgressBar pctValue={lot.progress.qty_progress_pct} label="台数" />
                      </td>
                      <td className="px-2 py-2 no-print">
                        <div className="text-xs text-slate-200 mb-1">
                          {Math.round(lot.progress.actual_minutes)} /{' '}
                          {Math.round(lot.progress.planned_minutes)} 分
                        </div>
                        <ProgressBar pctValue={lot.progress.minutes_progress_pct} label="工数" />
                      </td>
                    </tr>
                  ))}
                </tbody>
                {scheduleSpan && (
                  <tfoot>
                    <tr className="border-t border-slate-600">
                      <td className="px-2 py-2 font-semibold" colSpan={5}>
                        全体（先頭着手〜最終完了）
                      </td>
                      <td className="px-2 py-2 whitespace-nowrap">{scheduleSpan.start}</td>
                      <td className="px-2 py-2 whitespace-nowrap">{scheduleSpan.end}</td>
                      <td className="px-2 py-2" colSpan={5} />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>

            <div className="overflow-x-auto rounded-2xl border border-slate-700 bg-slate-900/80 p-5 shadow-xl schedule-print-section schedule-print-calendar">
              <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
                <div>
                  <h2 className="text-lg font-semibold text-white">作業班カレンダー（計画＋実績）</h2>
                  <p className="mt-1 text-xs text-slate-300 no-print">
                    各班は上段が計画、下段が日報実績。計画のない日の実績も下段に表示します。
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex flex-wrap gap-3 text-[11px] text-slate-300 no-print">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-3 w-5 rounded-sm bg-sky-500" />
                      計画
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-3 w-5 rounded-sm bg-emerald-500" />
                      実績（計画あり）
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-3 w-5 rounded-sm bg-orange-500" />
                      実績（計画なし）
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={handlePrint}
                    className="rounded-lg border border-slate-500 bg-slate-800 px-3 py-1.5 text-xs text-white hover:bg-slate-700 no-print"
                  >
                    カレンダー印刷
                  </button>
                </div>
              </div>
              {result.calendar.dates.length === 0 ? (
                <p className="text-sm text-slate-300">表示する占有日がありません</p>
              ) : (
                <>
                  {/* 画面: 横スクロールの全体表 */}
                  <div className="overflow-x-auto no-print">
                    {renderCalendarTable(result.calendar.dates, 'screen')}
                  </div>
                  {/* 印刷: 日付を分割して折り返し表示 */}
                  <div className="schedule-print-only space-y-3">
                    <p className="text-xs mb-2">
                      {PRINT_MONTHS_PER_PAGE}か月ずつページ分割して印刷（全{' '}
                      {printMonthPages.reduce((n, p) => n + p.length, 0)} か月 /{' '}
                      {printMonthPages.length} ページ）
                    </p>
                    {printMonthPages.map((pageMonths, pageIndex) => (
                      <div
                        key={`print-page-${pageIndex}`}
                        className="schedule-print-calendar-page"
                      >
                        {pageMonths.map((chunk) => (
                          <div
                            key={`print-month-${chunk.monthKey}`}
                            className="schedule-print-calendar-chunk"
                          >
                            <p className="schedule-print-month-title">
                              {chunk.label}（{chunk.dates.length}日）
                              {printMonthPages.length > 1
                                ? `  ${pageIndex + 1}/${printMonthPages.length}`
                                : ''}
                            </p>
                            {renderCalendarTable(chunk.dates, `print-${chunk.monthKey}`, {
                              compactDayHeader: true,
                            })}
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
