'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { getCurrentFiscalYear } from '@/lib/fiscal-year'

type Plan = {
  id: string
  plan_name: string | null
  fiscal_year: number | null
  plan_period: string | null
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
      lot_key: string
      model: string
      sequence: number
      color_index: number
      planned_minutes_per_day: number
      actual_minutes: number
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

function todayIso() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function formatShortDate(iso: string) {
  const m = iso.match(/^\d{4}-(\d{2})-(\d{2})$/)
  if (!m) return iso
  return `${Number(m[1])}/${Number(m[2])}`
}

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
  const [targets, setTargets] = useState<TargetOption[]>([])
  const [planId, setPlanId] = useState('')
  const [startDate, setStartDate] = useState(todayIso())
  const [minutesPerDay, setMinutesPerDay] = useState(480)
  const [fiscalYear, setFiscalYear] = useState(getCurrentFiscalYear())
  const [lots, setLots] = useState<LotRow[]>([])
  const [result, setResult] = useState<ScheduleResult | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const load = async () => {
      try {
        const [plansRes, targetsRes] = await Promise.all([
          fetch('/api/production-schedule?list=plans'),
          fetch('/api/production-schedule?list=targets'),
        ])
        const plansData = await plansRes.json()
        const targetsData = await targetsRes.json()
        if (!plansRes.ok) throw new Error(plansData.error || '計画一覧の取得に失敗')
        if (!targetsRes.ok) throw new Error(targetsData.error || '対象一覧の取得に失敗')
        setPlans(plansData.plans || [])
        setTargets(targetsData.targets || [])
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
    setResult(null)
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

  const updateLot = (key: string, patch: Partial<LotRow>) => {
    setLots((prev) => prev.map((lot) => (lot.key === key ? { ...lot, ...patch } : lot)))
  }

  const calculate = async () => {
    setIsLoading(true)
    setError(null)
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
      setResult(data as ScheduleResult)
    } catch (e) {
      setError(e instanceof Error ? e.message : '算出に失敗しました')
      setResult(null)
    } finally {
      setIsLoading(false)
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

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-indigo-950 to-slate-950 text-white">
      <div className="mx-auto max-w-7xl px-4 py-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm text-sky-300">生産計画 → 班別占有カレンダー</p>
            <h1 className="text-2xl font-bold text-white">生産スケジュール</h1>
            <p className="mt-1 text-sm text-slate-200">
              製造計画の台数×工程ST（なければ指令標準時間）で所要日数を積み上げ、作業班×日付に塗りつぶします。
            </p>
          </div>
          <Link
            href="/"
            className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-white hover:bg-slate-700"
          >
            ホームへ
          </Link>
        </div>

        <div className="mb-6 grid gap-4 rounded-2xl border border-slate-700 bg-slate-900/80 p-5 shadow-xl">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
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
                    {plan.fiscal_year ? `（${plan.fiscal_year}年度）` : ''}
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
            ST優先順: 直近製作ロット平均（規格一致） → 年度平均（UF/DF別） → D/L指令標準時間。平日のみ・ロット直列・班は工程順に積み上げ。
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

          <div className="flex justify-end">
            <button
              type="button"
              disabled={isLoading || lots.length === 0}
              onClick={() => void calculate()}
              className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50"
            >
              {isLoading ? '算出中…' : 'スケジュール算出'}
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-xl border border-rose-500/50 bg-rose-950/60 px-4 py-3 text-sm text-rose-100">
            {error}
          </div>
        )}

        {result && (
          <>
            {result.warnings.length > 0 && (
              <div className="mb-4 rounded-xl border border-amber-500/40 bg-amber-950/50 px-4 py-3 text-sm text-amber-100">
                {result.warnings.map((w, i) => (
                  <p key={i}>{w}</p>
                ))}
              </div>
            )}

            <div className="mb-6 grid gap-4 rounded-2xl border border-slate-700 bg-slate-900/80 p-5 shadow-xl sm:grid-cols-2 lg:grid-cols-4">
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
                <p>台数: スケジュール期間に重なる入庫ロット（規格一致）</p>
                <p>工数: 計画日の作業日報（指令一致・班別）</p>
                <p>カレンダーの白枠: 当日に日報実績あり</p>
              </div>
            </div>

            <div className="mb-6 overflow-x-auto rounded-2xl border border-slate-700 bg-slate-900/80 p-5 shadow-xl">
              <h2 className="mb-3 text-lg font-semibold text-white">ロット別リードタイム / 進捗</h2>
              <table className="min-w-full text-sm text-white">
                <thead>
                  <tr className="border-b border-slate-700 text-left text-slate-200">
                    <th className="px-2 py-2">色</th>
                    <th className="px-2 py-2">順序</th>
                    <th className="px-2 py-2">機種</th>
                    <th className="px-2 py-2">規格</th>
                    <th className="px-2 py-2">指令</th>
                    <th className="px-2 py-2">期間</th>
                    <th className="px-2 py-2">台数進捗</th>
                    <th className="px-2 py-2">工数進捗</th>
                  </tr>
                </thead>
                <tbody>
                  {result.lots.map((lot, index) => (
                    <tr key={lot.key} className="border-b border-slate-800 align-top">
                      <td className="px-2 py-2">
                        <span
                          className={`inline-block h-3 w-6 rounded ${LOT_COLORS[index % LOT_COLORS.length]}`}
                        />
                      </td>
                      <td className="px-2 py-2 text-white">{lot.sequence}</td>
                      <td className="px-2 py-2 text-white">
                        {lot.model} × {lot.quantity}
                        <div className="text-[10px] text-slate-400">{lot.st_note || lot.st_source}</div>
                      </td>
                      <td className="px-2 py-2 text-white">{lot.notes || '—'}</td>
                      <td className="px-2 py-2 text-white">
                        {lot.target_type === 'line' ? 'L' : 'D'} {lot.target_code}
                      </td>
                      <td className="px-2 py-2 text-white whitespace-nowrap">
                        {lot.start_date} 〜 {lot.end_date}
                        <div className="text-[10px] text-slate-400">{lot.total_days}日</div>
                      </td>
                      <td className="px-2 py-2">
                        <div className="text-xs text-slate-200 mb-1">
                          {lot.progress.completed_qty} / {lot.progress.planned_qty} 台
                        </div>
                        <ProgressBar pctValue={lot.progress.qty_progress_pct} label="台数" />
                      </td>
                      <td className="px-2 py-2">
                        <div className="text-xs text-slate-200 mb-1">
                          {Math.round(lot.progress.actual_minutes)} /{' '}
                          {Math.round(lot.progress.planned_minutes)} 分
                        </div>
                        <ProgressBar pctValue={lot.progress.minutes_progress_pct} label="工数" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="overflow-x-auto rounded-2xl border border-slate-700 bg-slate-900/80 p-5 shadow-xl">
              <h2 className="mb-3 text-lg font-semibold text-white">作業班カレンダー（計画＋実績）</h2>
              {result.calendar.dates.length === 0 ? (
                <p className="text-sm text-slate-300">表示する占有日がありません</p>
              ) : (
                <table className="min-w-full border-collapse text-xs text-white">
                  <thead>
                    <tr>
                      <th className="sticky left-0 z-10 bg-slate-900 px-2 py-1 text-left text-white">
                        作業班
                      </th>
                      {result.calendar.dates.map((date) => (
                        <th
                          key={date}
                          className="min-w-[2.2rem] px-1 py-1 text-center text-slate-200"
                        >
                          {formatShortDate(date)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.calendar.work_groups.map((group) => (
                      <tr key={group.work_group_code} className="border-t border-slate-800">
                        <td className="sticky left-0 z-10 whitespace-nowrap bg-slate-900 px-2 py-1 font-medium text-white">
                          {group.work_group_name}
                        </td>
                        {result.calendar.dates.map((date) => {
                          const cell = cellMap.get(`${group.work_group_code}__${date}`)
                          return (
                            <td key={`${group.work_group_code}-${date}`} className="px-0.5 py-0.5">
                              {cell ? (
                                <div
                                  title={`${cell.model}（順序${cell.sequence}）計画 ${cell.planned_minutes_per_day}分 / 実績 ${cell.actual_minutes}分`}
                                  className={`relative h-6 rounded-sm ${LOT_COLORS[cell.color_index % LOT_COLORS.length]} ${
                                    cell.has_actual ? 'ring-2 ring-white ring-offset-1 ring-offset-slate-900' : ''
                                  }`}
                                >
                                  {cell.has_actual && (
                                    <div
                                      className="absolute bottom-0 left-0 right-0 bg-white/70"
                                      style={{
                                        height: `${Math.min(
                                          100,
                                          cell.planned_minutes_per_day > 0
                                            ? (cell.actual_minutes / cell.planned_minutes_per_day) * 100
                                            : 100
                                        )}%`,
                                      }}
                                    />
                                  )}
                                </div>
                              ) : (
                                <div className="h-6 rounded-sm bg-slate-800/80" />
                              )}
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
