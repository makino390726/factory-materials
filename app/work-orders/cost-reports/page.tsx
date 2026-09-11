'use client'

import Link from 'next/link'
import { Fragment, useEffect, useMemo, useState } from 'react'

type ReportType = 'order' | 'line' | 'model'

type CostReportRow = {
  order_no: string
  product_name: string
  spec: string
  quantity: number
  unit_cost: number
  material_cost: number
  labor_cost: number
  indirect_cost: number
  total_cost: number
}

type BomSummaryRow = {
  model: string
  product_code: string
  part_name: string
  material_cost: number
  labor_cost: number
  indirect_cost: number
  total_cost: number
}

type ModelReportRow = {
  model: string
  display_name: string
  part_count: number
  previous_year_available?: boolean
  previous_material_cost?: number | null
  previous_labor_cost?: number | null
  previous_indirect_cost?: number | null
  previous_total_cost?: number | null
  realtime_applied?: boolean
  realtime_label?: string | null
  realtime_st_minutes?: number | null
  realtime_material_cost?: number | null
  realtime_labor_cost?: number | null
  realtime_indirect_cost?: number | null
  realtime_total_cost?: number | null
  current_year_applied?: boolean
  current_year_updated_at?: string | null
}

const currency = (value: number) => `\u00a5${Math.round(value || 0).toLocaleString('ja-JP')}`
const unitValue = (total: number, quantity: number) => {
  const qty = Number(quantity || 0)
  if (qty <= 0) return 0
  return Number(total || 0) / qty
}

function formatCostAsOfJa(d: Date): string {
  const s = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d)
  return `${s} 時点の原価`
}

export default function CostReportsPage() {
  const [reportType, setReportType] = useState<ReportType>('order')
  const [rows, setRows] = useState<CostReportRow[]>([])
  const [modelRows, setModelRows] = useState<ModelReportRow[]>([])
  const [bomSummary, setBomSummary] = useState<BomSummaryRow[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [costAsOfLabel, setCostAsOfLabel] = useState<string | null>(null)
  const [fiscalYearLabel, setFiscalYearLabel] = useState('')
  const [previousFiscalYearLabel, setPreviousFiscalYearLabel] = useState('')
  const [applyingModel, setApplyingModel] = useState<string | null>(null)

  const reportTitle =
    reportType === 'order' ? 'D指令原価一覧' : reportType === 'line' ? 'L指令原価一覧' : '機種別原価一覧'
  const firstColumnTitle = reportType === 'order' ? 'D指令番号' : '部品キー'

  useEffect(() => {
    const controller = new AbortController()
    const requestedType = reportType

    const fetchReport = async () => {
      setIsLoading(true)
      setError(null)
      try {
        const response = await fetch(`/api/work-order-costs/print-report?type=${requestedType}`, {
          signal: controller.signal,
        })
        if (!response.ok) {
          const data = await response.json().catch(() => ({}))
          throw new Error(data?.error || '帳票データの取得に失敗しました')
        }
        const data = await response.json()
        if (controller.signal.aborted) return

        if (requestedType === 'model') {
          setModelRows(Array.isArray(data?.rows) ? data.rows : [])
          setFiscalYearLabel(String(data?.fiscal_year_label || ''))
          setPreviousFiscalYearLabel(String(data?.previous_fiscal_year_label || ''))
          setRows([])
          setBomSummary([])
        } else {
          setRows(Array.isArray(data?.rows) ? data.rows : [])
          setBomSummary(Array.isArray(data?.bomSummary) ? data.bomSummary : [])
          setModelRows([])
        }
      } catch (fetchError) {
        if (controller.signal.aborted) return
        setError(fetchError instanceof Error ? fetchError.message : 'Unknown error')
      } finally {
        if (!controller.signal.aborted) setIsLoading(false)
      }
    }

    fetchReport()
    return () => controller.abort()
  }, [reportType])

  const totals = useMemo(() => {
    return rows.reduce(
      (acc, row) => {
        acc.material_cost += Number(row.material_cost || 0)
        acc.labor_cost += Number(row.labor_cost || 0)
        acc.indirect_cost += Number(row.indirect_cost || 0)
        acc.total_cost += Number(row.total_cost || 0)
        return acc
      },
      { material_cost: 0, labor_cost: 0, indirect_cost: 0, total_cost: 0 }
    )
  }, [rows])

  const previousYearTotals = useMemo(() => {
    return modelRows.reduce(
      (acc, row) => {
        acc.material_cost += Number(row.previous_material_cost || 0)
        acc.labor_cost += Number(row.previous_labor_cost || 0)
        acc.indirect_cost += Number(row.previous_indirect_cost || 0)
        acc.total_cost += Number(row.previous_total_cost || 0)
        return acc
      },
      { material_cost: 0, labor_cost: 0, indirect_cost: 0, total_cost: 0 }
    )
  }, [modelRows])

  const realtimeModelTotals = useMemo(() => {
    return modelRows.reduce(
      (acc, row) => {
        const applied = Boolean(row.realtime_applied)
        if (applied) acc.applied_count += 1
        acc.material_cost += Number(
          applied ? row.realtime_material_cost ?? 0 : row.previous_material_cost || 0
        )
        acc.labor_cost += Number(applied ? row.realtime_labor_cost ?? 0 : row.previous_labor_cost || 0)
        acc.indirect_cost += Number(
          applied ? row.realtime_indirect_cost ?? 0 : row.previous_indirect_cost || 0
        )
        acc.total_cost += Number(applied ? row.realtime_total_cost ?? 0 : row.previous_total_cost || 0)
        return acc
      },
      { material_cost: 0, labor_cost: 0, indirect_cost: 0, total_cost: 0, applied_count: 0 }
    )
  }, [modelRows])

  const handleApplyCurrentYearCost = async (row: ModelReportRow) => {
    if (!row.realtime_applied) {
      setError('リアルタイム原価が未適用です。製品パーツ計算で適用してから保存してください。')
      return
    }
    const already = Boolean(row.current_year_applied)
    if (
      !confirm(
        already
          ? `${row.display_name} の${fiscalYearLabel || '本年'}原価をリアルタイム原価で上書きします。よろしいですか？`
          : `${row.display_name} のリアルタイム原価を${fiscalYearLabel || '本年'}原価として保存します。よろしいですか？`
      )
    ) {
      return
    }

    setApplyingModel(row.model)
    setError(null)
    try {
      const response = await fetch('/api/heater/models/annual-cost', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: row.model }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data?.error || '本年原価の保存に失敗しました')
      }
      setModelRows((prev) =>
        prev.map((item) =>
          item.model === row.model
            ? {
                ...item,
                current_year_applied: true,
                current_year_updated_at: data?.saved?.updated_at || new Date().toISOString(),
              }
            : item
        )
      )
    } catch (applyError) {
      setError(applyError instanceof Error ? applyError.message : '本年原価の保存に失敗しました')
    } finally {
      setApplyingModel(null)
    }
  }

  const handlePrint = () => {
    setCostAsOfLabel(formatCostAsOfJa(new Date()))
    // ラベル反映後に印刷
    requestAnimationFrame(() => window.print())
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 text-white px-4 py-8 print:bg-white print:text-black print:p-0">
      <div className="mx-auto max-w-screen-xl print:max-w-none">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4 print:hidden">
          <div>
            <div className="mb-2 flex items-center gap-3">
              <span className="rounded-full border border-violet-400/40 bg-violet-500/20 px-3 py-1 text-xs font-bold tracking-widest uppercase text-violet-300">
                PRINT MENU
              </span>
              <span className="text-sm text-slate-400">原価帳票出力</span>
            </div>
            <h1 className="text-3xl sm:text-4xl font-bold text-white">原価帳票印刷</h1>
            <p className="mt-2 text-sm text-slate-400">出力帳票を選択してPDF印刷を実行します。</p>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="rounded-full border border-slate-500/60 px-5 py-2 text-sm text-slate-300 transition hover:border-slate-400 hover:text-white"
            >
              ← メニューへ戻る
            </Link>
            <button
              onClick={handlePrint}
              className="rounded-full bg-emerald-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500"
            >
              PDF印刷
            </button>
          </div>
        </div>

        <div className="mb-6 rounded-2xl border border-slate-600/50 bg-slate-800/70 p-5 print:hidden">
          <p className="mb-3 text-sm font-semibold text-slate-300">出力帳票選択</p>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setReportType('order')}
              className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${reportType === 'order' ? 'border border-violet-400/50 bg-violet-600 text-white shadow-[0_0_16px_rgba(139,92,246,0.35)]' : 'border border-slate-600 bg-slate-900 text-slate-300 hover:border-slate-500 hover:text-white'}`}
            >
              D指令原価
            </button>
            <button
              onClick={() => setReportType('line')}
              className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${reportType === 'line' ? 'border border-violet-400/50 bg-violet-600 text-white shadow-[0_0_16px_rgba(139,92,246,0.35)]' : 'border border-slate-600 bg-slate-900 text-slate-300 hover:border-slate-500 hover:text-white'}`}
            >
              L指令原価
            </button>
            <button
              onClick={() => setReportType('model')}
              className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${reportType === 'model' ? 'border border-amber-400/50 bg-amber-600 text-white shadow-[0_0_16px_rgba(245,158,11,0.35)]' : 'border border-slate-600 bg-slate-900 text-slate-300 hover:border-slate-500 hover:text-white'}`}
            >
              機種別一覧
            </button>
          </div>
        </div>

        <div className="mb-4 hidden border-b border-slate-300 pb-2 print:block">
          <h2 className="text-xl font-bold">{reportTitle}</h2>
          <p className="text-xs text-slate-600">
            {costAsOfLabel || `印刷日時: ${new Date().toLocaleString('ja-JP')}`}
            {reportType === 'model'
              ? ` ／ 各機種 ${previousFiscalYearLabel || '前年度'}・リアルタイム 2段`
              : ''}
          </p>
        </div>

        {error && (
          <div className="mb-4 rounded-2xl border border-rose-500/50 bg-rose-900/40 p-4 text-sm text-rose-200 print:border-rose-300 print:bg-rose-50 print:text-rose-700">
            {error}
          </div>
        )}

        {isLoading && <div className="py-10 text-center text-slate-400">読込中...</div>}

        {!isLoading && !error && reportType === 'model' && (
          <div className="overflow-hidden rounded-3xl border-2 border-slate-700 bg-slate-900/80 print:rounded-none print:border print:border-slate-300 print:bg-white">
            <div className="border-b border-slate-700 bg-slate-800 px-6 py-4 print:hidden">
              <h2 className="text-xl font-bold text-white">機種別原価一覧</h2>
              <p className="mt-1 text-xs text-slate-400">
                各機種を2段で表示します。上段は{previousFiscalYearLabel || '前年度'}原価、下段はリアルタイム原価です（1台当たり）。
                リアルタイム原価を{fiscalYearLabel || '本年'}原価にする場合は、行末の「本年原価適用」で保存します。
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm print:text-xs">
                <thead className="bg-slate-800 text-slate-300 print:bg-slate-100 print:text-slate-700">
                  <tr>
                    <th className="border-b border-slate-700 px-4 py-3 text-left print:border-slate-300">機種名</th>
                    <th className="border-b border-slate-700 px-4 py-3 text-left print:border-slate-300">区分</th>
                    <th className="border-b border-slate-700 px-4 py-3 text-right print:border-slate-300">部品数</th>
                    <th className="border-b border-slate-700 px-4 py-3 text-right print:border-slate-300">材料費</th>
                    <th className="border-b border-slate-700 px-4 py-3 text-right print:border-slate-300">間接費</th>
                    <th className="border-b border-slate-700 px-4 py-3 text-right print:border-slate-300">工賃</th>
                    <th className="border-b border-slate-700 bg-slate-700 px-4 py-3 text-right font-bold text-yellow-300 print:border-slate-300 print:bg-slate-100 print:text-slate-700">
                      合計
                    </th>
                    <th className="border-b border-slate-700 px-4 py-3 text-center print:hidden">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {modelRows.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-4 py-8 text-center text-slate-500">
                        データがありません。
                      </td>
                    </tr>
                  )}
                  {modelRows.map((row, idx) => {
                    const applied = Boolean(row.realtime_applied)
                    const previousSaved = Boolean(row.previous_year_available)
                    const currentApplied = Boolean(row.current_year_applied)
                    const baseRowClass = idx % 2 === 0 ? 'bg-slate-900/40 print:bg-white' : 'bg-slate-800/20 print:bg-slate-50'
                    const previousLabel = previousSaved
                      ? `前年度（${previousFiscalYearLabel || '前年度'}）`
                      : `前年度（未保存）`
                    const realtimeLabel = applied
                      ? [
                          'リアルタイム',
                          row.realtime_st_minutes != null
                            ? `${Number(row.realtime_st_minutes).toLocaleString('ja-JP')}分`
                            : '',
                          row.realtime_label || '',
                        ]
                          .filter(Boolean)
                          .join(' / ')
                      : 'リアルタイム（未適用）'
                    return (
                      <Fragment key={row.model}>
                        <tr className={baseRowClass}>
                          <td rowSpan={2} className="border-t border-slate-800 px-4 py-3 align-top print:border-slate-200">
                            <div className="font-semibold text-white print:text-slate-900">{row.display_name}</div>
                            {row.display_name !== row.model && (
                              <div className="mt-0.5 font-mono text-[11px] text-slate-500 print:text-slate-600">
                                {row.model}
                              </div>
                            )}
                          </td>
                          <td className="border-t border-slate-800 px-4 py-2 text-slate-300 print:border-slate-200 print:text-slate-700">
                            {previousLabel}
                          </td>
                          <td rowSpan={2} className="border-t border-slate-800 px-4 py-3 text-right align-top text-slate-300 print:border-slate-200 print:text-slate-800">
                            {row.part_count.toLocaleString('ja-JP')}
                          </td>
                          <td className="border-t border-slate-800 px-4 py-2 text-right text-sky-300 print:border-slate-200 print:text-slate-800">
                            {currency(Number(row.previous_material_cost || 0))}
                          </td>
                          <td className="border-t border-slate-800 px-4 py-2 text-right text-violet-300 print:border-slate-200 print:text-slate-800">
                            {currency(Number(row.previous_indirect_cost || 0))}
                          </td>
                          <td className="border-t border-slate-800 px-4 py-2 text-right text-emerald-300 print:border-slate-200 print:text-slate-800">
                            {currency(Number(row.previous_labor_cost || 0))}
                          </td>
                          <td className="border-t border-slate-800 bg-yellow-900/10 px-4 py-2 text-right font-bold text-yellow-300 print:border-slate-200 print:bg-slate-100 print:text-slate-900">
                            {currency(Number(row.previous_total_cost || 0))}
                          </td>
                          <td className="border-t border-slate-800 px-4 py-2 print:hidden" />
                        </tr>
                        <tr className={baseRowClass}>
                          <td className="border-t border-slate-800 px-4 py-2 print:border-slate-200">
                            <div className={applied ? 'text-amber-200 print:text-slate-800' : 'text-slate-500 print:text-slate-500'}>
                              {realtimeLabel}
                            </div>
                          </td>
                          <td className="border-t border-slate-800 px-4 py-2 text-right text-sky-300 print:border-slate-200 print:text-slate-800">
                            {applied ? currency(Number(row.realtime_material_cost ?? 0)) : '—'}
                          </td>
                          <td className="border-t border-slate-800 px-4 py-2 text-right text-violet-300 print:border-slate-200 print:text-slate-800">
                            {applied ? currency(Number(row.realtime_indirect_cost ?? 0)) : '—'}
                          </td>
                          <td className="border-t border-slate-800 px-4 py-2 text-right text-emerald-300 print:border-slate-200 print:text-slate-800">
                            {applied ? currency(Number(row.realtime_labor_cost ?? 0)) : '—'}
                          </td>
                          <td className="border-t border-slate-800 bg-amber-900/20 px-4 py-2 text-right font-bold text-amber-200 print:border-slate-200 print:bg-slate-100 print:text-slate-900">
                            {applied ? currency(Number(row.realtime_total_cost ?? 0)) : '—'}
                          </td>
                          <td className="border-t border-slate-800 px-4 py-2 text-center print:hidden">
                            <button
                              type="button"
                              disabled={!applied || applyingModel === row.model}
                              onClick={() => void handleApplyCurrentYearCost(row)}
                              className="rounded-md bg-cyan-700 px-2 py-1 text-[11px] font-semibold text-white transition hover:bg-cyan-600 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
                            >
                              {applyingModel === row.model
                                ? '保存中...'
                                : currentApplied
                                  ? '本年原価を更新'
                                  : '本年原価適用'}
                            </button>
                            {currentApplied && (
                              <div className="mt-1 text-[10px] text-emerald-300">
                                {fiscalYearLabel || '本年'}適用済
                              </div>
                            )}
                          </td>
                        </tr>
                      </Fragment>
                    )
                  })}
                </tbody>
                <tfoot className="bg-gradient-to-r from-amber-950/60 to-yellow-950/60 print:bg-slate-100">
                  <tr>
                    <td className="px-4 py-3 font-semibold text-yellow-300 print:text-slate-800">
                      計（前年度・{modelRows.length} 機種）
                    </td>
                    <td className="px-4 py-3 text-slate-300 print:text-slate-700">
                      {previousFiscalYearLabel || '前年度'}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-slate-200 print:text-slate-800">
                      {modelRows.reduce((s, r) => s + Number(r.part_count || 0), 0).toLocaleString('ja-JP')}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-sky-300 print:text-slate-800">
                      {currency(previousYearTotals.material_cost)}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-violet-300 print:text-slate-800">
                      {currency(previousYearTotals.indirect_cost)}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-emerald-300 print:text-slate-800">
                      {currency(previousYearTotals.labor_cost)}
                    </td>
                    <td className="px-4 py-3 text-right text-2xl font-extrabold text-yellow-300 print:text-slate-900">
                      {currency(previousYearTotals.total_cost)}
                    </td>
                    <td className="px-4 py-3 print:hidden" />
                  </tr>
                  <tr>
                    <td className="px-4 py-3 font-semibold text-amber-200 print:text-slate-800">
                      計（リアルタイム・適用 {realtimeModelTotals.applied_count} / 未適用は前年度）
                    </td>
                    <td className="px-4 py-3 text-amber-100/80 print:text-slate-700">リアルタイム</td>
                    <td className="px-4 py-3 text-right font-semibold text-slate-200 print:text-slate-800">
                      {modelRows.reduce((s, r) => s + Number(r.part_count || 0), 0).toLocaleString('ja-JP')}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-sky-300 print:text-slate-800">
                      {currency(realtimeModelTotals.material_cost)}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-violet-300 print:text-slate-800">
                      {currency(realtimeModelTotals.indirect_cost)}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-emerald-300 print:text-slate-800">
                      {currency(realtimeModelTotals.labor_cost)}
                    </td>
                    <td className="px-4 py-3 text-right text-2xl font-extrabold text-amber-200 print:text-slate-900">
                      {currency(realtimeModelTotals.total_cost)}
                    </td>
                    <td className="px-4 py-3 print:hidden" />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}

        {!isLoading && !error && reportType !== 'model' && (
          <div className="space-y-6">
            {bomSummary.length > 0 && (
              <div className="rounded-3xl border-2 border-slate-700 bg-slate-900/80 p-6 print:rounded-none print:border print:border-slate-300 print:bg-white">
                <h3 className="mb-4 text-lg font-bold text-white print:text-black">
                  {reportType === 'line' ? '機種別BOM合計' : 'BOM合計'}
                </h3>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {bomSummary.map((summary) => (
                    <div
                      key={summary.model}
                      className="rounded-2xl border border-slate-600 bg-slate-800/60 p-4 print:border print:border-slate-300 print:bg-slate-50"
                    >
                      <h4 className="mb-2 text-sm font-bold text-violet-300 print:text-slate-700">{summary.model}</h4>
                      {summary.product_code && (
                        <p className="mb-3 text-xs text-slate-400 print:text-slate-600">
                          品コード: <span className="text-slate-300 print:text-slate-800">{summary.product_code}</span>
                        </p>
                      )}
                      {reportType === 'line' && summary.part_name && summary.model === summary.product_code && (
                        <p className="mb-3 text-xs text-slate-400 print:text-slate-600">
                          品名: <span className="text-slate-300 print:text-slate-800">{summary.part_name}</span>
                        </p>
                      )}
                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between">
                          <span className="text-slate-400 print:text-slate-600">材料費</span>
                          <span className="text-sky-300 font-semibold print:text-slate-800">
                            {currency(summary.material_cost)}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-400 print:text-slate-600">工賃</span>
                          <span className="text-emerald-300 font-semibold print:text-slate-800">
                            {currency(summary.labor_cost)}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-400 print:text-slate-600">間接費</span>
                          <span className="text-violet-300 font-semibold print:text-slate-800">
                            {currency(summary.indirect_cost)}
                          </span>
                        </div>
                        <div className="border-t border-slate-700 pt-2 print:border-slate-300">
                          <div className="flex justify-between">
                            <span className="font-bold text-yellow-300 print:text-slate-900">合計</span>
                            <span className="text-lg font-extrabold text-yellow-300 print:text-slate-900">
                              {currency(summary.total_cost)}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="overflow-hidden rounded-3xl border-2 border-slate-700 bg-slate-900/80 print:rounded-none print:border print:border-slate-300 print:bg-white">
              <div className="border-b border-slate-700 bg-slate-800 px-6 py-4 print:hidden">
                <h2 className="text-xl font-bold text-white">{reportTitle}</h2>
                <p className="text-xs text-slate-400">印刷日時: {new Date().toLocaleString('ja-JP')}</p>
              </div>

              <div className="overflow-x-auto">
                <table className="min-w-full table-fixed text-sm print:text-xs">
                  <thead className="bg-slate-800 text-slate-300 print:bg-slate-100 print:text-slate-700">
                    <tr>
                      <th className="w-[140px] border-b border-slate-700 px-4 py-3 text-left print:border-slate-300">{firstColumnTitle}</th>
                      <th className="w-[240px] border-b border-slate-700 px-4 py-3 text-left print:border-slate-300">製品名</th>
                      <th className="w-[200px] border-b border-slate-700 px-4 py-3 text-left print:border-slate-300">規格</th>
                      <th className="w-[130px] border-b border-slate-700 px-4 py-3 text-left print:border-slate-300">区分</th>
                      <th className="w-[100px] border-b border-slate-700 px-4 py-3 text-right print:border-slate-300">数量</th>
                      <th className="w-[130px] border-b border-slate-700 px-4 py-3 text-right print:border-slate-300">材料費</th>
                      <th className="w-[130px] border-b border-slate-700 px-4 py-3 text-right print:border-slate-300">工賃</th>
                      <th className="w-[130px] border-b border-slate-700 px-4 py-3 text-right print:border-slate-300">間接費</th>
                      <th className="w-[150px] border-b border-slate-700 bg-slate-700 px-4 py-3 text-right font-bold text-yellow-300 print:border-slate-300 print:bg-slate-100 print:text-slate-700">原価合計</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 && (
                      <tr>
                        <td colSpan={9} className="px-4 py-8 text-center text-slate-500 print:text-slate-500">
                          データがありません。
                        </td>
                      </tr>
                    )}
                    {rows.map((row, idx) => {
                      const productionQty = Number(row.quantity || 0)
                      const unitMaterial = unitValue(row.material_cost, productionQty)
                      const unitLabor = unitValue(row.labor_cost, productionQty)
                      const unitIndirect = unitValue(row.indirect_cost, productionQty)
                      const unitTotal = unitValue(row.total_cost, productionQty)
                      const baseRowClass = idx % 2 === 0 ? 'bg-slate-900/40 print:bg-white' : 'bg-slate-800/20 print:bg-slate-50'

                      return (
                        <Fragment key={`${reportType}-${row.order_no}-${row.product_name}-${row.spec}`}>
                          <tr className={baseRowClass}>
                            <td rowSpan={2} className="border-t border-slate-800 px-4 py-3 align-top font-semibold text-cyan-300 print:border-slate-200 print:text-slate-800">{row.order_no}</td>
                            <td rowSpan={2} className="border-t border-slate-800 px-4 py-3 align-top text-slate-200 print:border-slate-200 print:text-slate-800">{row.product_name || '—'}</td>
                            <td rowSpan={2} className="border-t border-slate-800 px-4 py-3 align-top text-slate-300 print:border-slate-200 print:text-slate-700">{row.spec || '—'}</td>
                            <td className="border-t border-slate-800 px-4 py-2 text-slate-300 print:border-slate-200 print:text-slate-700">1個当たり</td>
                            <td className="border-t border-slate-800 px-4 py-2 text-right text-slate-200 print:border-slate-200 print:text-slate-800">1</td>
                            <td className="border-t border-slate-800 px-4 py-2 text-right text-sky-300 print:border-slate-200 print:text-slate-800">{currency(unitMaterial)}</td>
                            <td className="border-t border-slate-800 px-4 py-2 text-right text-emerald-300 print:border-slate-200 print:text-slate-800">{currency(unitLabor)}</td>
                            <td className="border-t border-slate-800 px-4 py-2 text-right text-violet-300 print:border-slate-200 print:text-slate-800">{currency(unitIndirect)}</td>
                            <td className="border-t border-slate-800 bg-yellow-900/10 px-4 py-2 text-right font-bold text-yellow-300 print:border-slate-200 print:bg-slate-100 print:text-slate-900">{currency(unitTotal)}</td>
                          </tr>
                          <tr className={baseRowClass}>
                            <td className="border-t border-slate-800 px-4 py-2 text-slate-300 print:border-slate-200 print:text-slate-700">制作数量換算</td>
                            <td className="border-t border-slate-800 px-4 py-2 text-right text-slate-200 print:border-slate-200 print:text-slate-800">{productionQty.toLocaleString('ja-JP')}</td>
                            <td className="border-t border-slate-800 px-4 py-2 text-right text-sky-300 print:border-slate-200 print:text-slate-800">{currency(row.material_cost)}</td>
                            <td className="border-t border-slate-800 px-4 py-2 text-right text-emerald-300 print:border-slate-200 print:text-slate-800">{currency(row.labor_cost)}</td>
                            <td className="border-t border-slate-800 px-4 py-2 text-right text-violet-300 print:border-slate-200 print:text-slate-800">{currency(row.indirect_cost)}</td>
                            <td className="border-t border-slate-800 bg-yellow-900/20 px-4 py-2 text-right font-bold text-yellow-300 print:border-slate-200 print:bg-slate-100 print:text-slate-900">{currency(row.total_cost)}</td>
                          </tr>
                        </Fragment>
                      )
                    })}
                  </tbody>
                  <tfoot className="bg-gradient-to-r from-amber-950/60 to-yellow-950/60 print:bg-slate-100">
                    <tr>
                      <td className="px-4 py-3 font-semibold text-yellow-300 print:text-slate-800" colSpan={4}>合計（制作数量換算）</td>
                      <td className="px-4 py-3 text-right font-semibold text-slate-200 print:text-slate-800">{rows.reduce((sum, row) => sum + Number(row.quantity || 0), 0).toLocaleString('ja-JP')}</td>
                      <td className="px-4 py-3 text-right font-semibold text-sky-300 print:text-slate-800">{currency(totals.material_cost)}</td>
                      <td className="px-4 py-3 text-right font-semibold text-emerald-300 print:text-slate-800">{currency(totals.labor_cost)}</td>
                      <td className="px-4 py-3 text-right font-semibold text-violet-300 print:text-slate-800">{currency(totals.indirect_cost)}</td>
                      <td className="px-4 py-3 text-right text-2xl font-extrabold text-yellow-300 print:text-slate-900">{currency(totals.total_cost)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>

      <style jsx>{`
        @media print {
          :global(body) {
            background: #fff;
          }
          table th,
          table td {
            padding: 6px;
          }
        }
      `}</style>
    </div>
  )
}
