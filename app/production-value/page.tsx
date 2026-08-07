'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  formatFiscalYearLabel,
  getCurrentFiscalYear,
} from '@/lib/fiscal-year'

type PeriodMode = 'month' | 'year'
type ViewMode = 'model' | 'order'

type OrderRow = {
  order_no: string
  model: string
  model_display?: string
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
}

type ModelRow = {
  model: string
  model_display?: string
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
  cost_source: string
}

type Report = {
  period_mode: PeriodMode
  year: number
  month: number | null
  period_label: string
  date_from: string
  date_to: string
  order_rows: OrderRow[]
  model_rows: ModelRow[]
  totals: {
    completed_qty: number
    material_amount: number
    labor_amount: number
    indirect_amount: number
    total_amount: number
  }
  warnings: string[]
}

const yen = (n: number) => `¥${Math.round(n || 0).toLocaleString('ja-JP')}`

function sourceLabel(source: ModelRow['source']) {
  if (source === 'heater_line') return '暖房機L'
  if (source === 'd_order') return 'D指令'
  return '混合'
}

export default function ProductionValuePage() {
  const now = new Date()
  const [periodMode, setPeriodMode] = useState<PeriodMode>('month')
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [fiscalYear, setFiscalYear] = useState(getCurrentFiscalYear())
  const [viewMode, setViewMode] = useState<ViewMode>('model')
  const [report, setReport] = useState<Report | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const yearOptions = useMemo(() => {
    const current = now.getFullYear()
    return Array.from({ length: 8 }, (_, i) => current - 3 + i)
  }, [now])

  const fiscalYearOptions = useMemo(() => {
    const current = getCurrentFiscalYear()
    return Array.from({ length: 8 }, (_, i) => current - 3 + i)
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ period: periodMode })
      if (periodMode === 'month') {
        params.set('year', String(year))
        params.set('month', String(month))
      } else {
        params.set('year', String(fiscalYear))
      }
      const res = await fetch(`/api/production-value?${params.toString()}`)
      const json = await res.json()
      if (!res.ok || json.error) {
        throw new Error(json.error || '生産額の取得に失敗しました')
      }
      setReport(json as Report)
    } catch (e) {
      setReport(null)
      setError(e instanceof Error ? e.message : '生産額の取得に失敗しました')
    } finally {
      setLoading(false)
    }
  }, [periodMode, year, month, fiscalYear])

  useEffect(() => {
    void load()
  }, [load])

  const handlePrint = () => {
    if (!report) {
      alert('印刷するデータがありません')
      return
    }
    requestAnimationFrame(() => window.print())
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <style jsx>{`
        @media print {
          :global(body) {
            background: #fff !important;
            color: #000 !important;
          }
          :global(.no-print) {
            display: none !important;
          }
          :global(.print-only) {
            display: block !important;
          }
          table th,
          table td {
            padding: 6px;
            color: #000 !important;
            border-color: #ccc !important;
          }
        }
        :global(.print-only) {
          display: none;
        }
      `}</style>

      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <div className="no-print mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-teal-400">
              Production Value
            </p>
            <h1 className="mt-1 text-3xl font-bold text-white">生産額集計</h1>
            <p className="mt-2 text-sm text-slate-400">
              工程管理の完成ロット（暖房機 L903〜909 / D指令）× 原価で、材料費・工費・間接費・合計を算出します。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/process-management"
              className="rounded-xl border border-slate-600 bg-slate-900 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800"
            >
              工程管理へ
            </Link>
            <Link
              href="/"
              className="rounded-xl border border-slate-600 bg-slate-900 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800"
            >
              ホーム
            </Link>
            <button
              type="button"
              onClick={handlePrint}
              disabled={!report || loading}
              className="rounded-xl border border-teal-400/60 bg-teal-900/40 px-4 py-2 text-sm font-semibold text-teal-100 hover:bg-teal-800/50 disabled:opacity-50"
            >
              印刷 / PDF
            </button>
          </div>
        </div>

        <div className="no-print mb-6 rounded-2xl border border-slate-700 bg-slate-900/70 p-4 space-y-4">
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className="mb-1 block text-xs text-slate-400">期間</label>
              <div className="inline-flex rounded-xl border border-slate-600 bg-slate-950 p-1">
                <button
                  type="button"
                  onClick={() => setPeriodMode('month')}
                  className={`rounded-lg px-3 py-1.5 text-sm ${
                    periodMode === 'month'
                      ? 'bg-teal-700 text-white'
                      : 'text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  月単位
                </button>
                <button
                  type="button"
                  onClick={() => setPeriodMode('year')}
                  className={`rounded-lg px-3 py-1.5 text-sm ${
                    periodMode === 'year'
                      ? 'bg-teal-700 text-white'
                      : 'text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  年単位（会計年度）
                </button>
              </div>
            </div>

            {periodMode === 'month' ? (
              <>
                <div>
                  <label className="mb-1 block text-xs text-slate-400">年</label>
                  <select
                    value={year}
                    onChange={(e) => setYear(Number(e.target.value))}
                    className="rounded-xl border border-slate-600 bg-slate-950 px-3 py-2 text-sm"
                  >
                    {yearOptions.map((y) => (
                      <option key={y} value={y}>
                        {y}年
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-400">月</label>
                  <select
                    value={month}
                    onChange={(e) => setMonth(Number(e.target.value))}
                    className="rounded-xl border border-slate-600 bg-slate-950 px-3 py-2 text-sm"
                  >
                    {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                      <option key={m} value={m}>
                        {m}月
                      </option>
                    ))}
                  </select>
                </div>
              </>
            ) : (
              <div>
                <label className="mb-1 block text-xs text-slate-400">会計年度</label>
                <select
                  value={fiscalYear}
                  onChange={(e) => setFiscalYear(Number(e.target.value))}
                  className="rounded-xl border border-slate-600 bg-slate-950 px-3 py-2 text-sm"
                >
                  {fiscalYearOptions.map((y) => (
                    <option key={y} value={y}>
                      {formatFiscalYearLabel(y)}（{y - 1}/9〜{y}/8）
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label className="mb-1 block text-xs text-slate-400">表示</label>
              <div className="inline-flex rounded-xl border border-slate-600 bg-slate-950 p-1">
                <button
                  type="button"
                  onClick={() => setViewMode('model')}
                  className={`rounded-lg px-3 py-1.5 text-sm ${
                    viewMode === 'model'
                      ? 'bg-indigo-700 text-white'
                      : 'text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  機種別
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('order')}
                  className={`rounded-lg px-3 py-1.5 text-sm ${
                    viewMode === 'order'
                      ? 'bg-indigo-700 text-white'
                      : 'text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  D指令明細
                </button>
              </div>
            </div>

            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="rounded-xl bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-white disabled:opacity-50"
            >
              {loading ? '集計中…' : '再集計'}
            </button>
          </div>

          <p className="text-xs text-slate-500">
            暖房機: L903〜909の完成ロット（備考の機種例: 400L-DF / SK400L-DF）× BOM原価。備考が
            UF/DF のみの場合は、工程管理の「スケジュール適用機種」から SK400L-DF 形式に解決します。 ／
            D指令: 完成ロット × 保存原価
          </p>
        </div>

        {error && (
          <div className="no-print mb-4 rounded-xl border border-red-500/50 bg-red-950/40 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        )}

        {report?.warnings && report.warnings.length > 0 && (
          <div className="no-print mb-4 rounded-xl border border-amber-500/40 bg-amber-950/30 px-4 py-3 text-xs text-amber-100">
            <p className="font-semibold text-amber-200 mb-1">注意</p>
            <ul className="list-disc pl-4 space-y-0.5">
              {report.warnings.slice(0, 8).map((w) => (
                <li key={w}>{w}</li>
              ))}
              {report.warnings.length > 8 && (
                <li>ほか {report.warnings.length - 8} 件</li>
              )}
            </ul>
          </div>
        )}

        <div className="print-sheet rounded-2xl border border-slate-700 bg-slate-900/80 overflow-hidden">
          <div className="border-b border-slate-700 px-5 py-4">
            <div className="print-only mb-2 text-xs text-slate-600">
              Factory Materials / 生産額集計
            </div>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-xl font-bold text-white print:text-black">
                  生産額 — {report?.period_label || '—'}
                  <span className="ml-2 text-sm font-normal text-slate-400 print:text-slate-600">
                    {viewMode === 'model' ? '機種別' : 'D指令明細'}
                  </span>
                </h2>
                {report && (
                  <p className="mt-1 text-xs text-slate-400 print:text-slate-600">
                    対象期間: {report.date_from} 〜 {report.date_to} ／ 印刷:{' '}
                    {new Date().toLocaleString('ja-JP')}
                  </p>
                )}
              </div>
              {report && (
                <div className="text-right">
                  <p className="text-xs text-slate-400 print:text-slate-600">合計生産額</p>
                  <p className="text-2xl font-extrabold text-teal-300 print:text-black">
                    {yen(report.totals.total_amount)}
                  </p>
                </div>
              )}
            </div>
          </div>

          {report && (
            <div className="grid grid-cols-2 gap-3 border-b border-slate-700 px-5 py-3 sm:grid-cols-5">
              <div>
                <p className="text-[10px] text-slate-400 print:text-slate-600">制作台数</p>
                <p className="text-lg font-bold">{report.totals.completed_qty.toLocaleString()} 台</p>
              </div>
              <div>
                <p className="text-[10px] text-slate-400 print:text-slate-600">材料費</p>
                <p className="text-lg font-bold">{yen(report.totals.material_amount)}</p>
              </div>
              <div>
                <p className="text-[10px] text-slate-400 print:text-slate-600">工費</p>
                <p className="text-lg font-bold">{yen(report.totals.labor_amount)}</p>
              </div>
              <div>
                <p className="text-[10px] text-slate-400 print:text-slate-600">間接費</p>
                <p className="text-lg font-bold">{yen(report.totals.indirect_amount)}</p>
              </div>
              <div className="col-span-2 sm:col-span-1">
                <p className="text-[10px] text-slate-400 print:text-slate-600">合計</p>
                <p className="text-lg font-bold text-teal-300 print:text-black">
                  {yen(report.totals.total_amount)}
                </p>
              </div>
            </div>
          )}

          <div className="overflow-x-auto">
            {loading && !report ? (
              <p className="px-5 py-10 text-center text-slate-400">集計中…</p>
            ) : !report ? (
              <p className="px-5 py-10 text-center text-slate-400">データがありません</p>
            ) : viewMode === 'model' ? (
              <table className="min-w-full text-sm">
                <thead className="bg-slate-950/80 text-left text-xs text-slate-400 print:bg-slate-100">
                  <tr>
                    <th className="px-3 py-2">機種</th>
                    <th className="px-3 py-2">規格</th>
                    <th className="px-3 py-2">区分</th>
                    <th className="px-3 py-2 text-right">台数</th>
                    <th className="px-3 py-2 text-right">材料費</th>
                    <th className="px-3 py-2 text-right">工費</th>
                    <th className="px-3 py-2 text-right">間接費</th>
                    <th className="px-3 py-2 text-right">合計</th>
                  </tr>
                </thead>
                <tbody>
                  {report.model_rows.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-3 py-8 text-center text-slate-500">
                        対象期間の完成ロットがありません
                      </td>
                    </tr>
                  ) : (
                    report.model_rows.map((row) => (
                      <tr key={row.model} className="border-t border-slate-800 print:border-slate-300">
                        <td className="px-3 py-2">
                          <div className="font-mono font-semibold text-cyan-300 print:text-black">
                            {row.model_display || row.model}
                          </div>
                          {row.model_name && (
                            <div className="text-xs text-slate-400 print:text-slate-600">
                              {row.model_name}
                            </div>
                          )}
                          {row.model_display &&
                            row.model_display !== row.model &&
                            !/^(UF|DF)$/i.test(row.model) && (
                              <div className="text-[10px] text-slate-500 no-print">
                                コード: {row.model}
                              </div>
                            )}
                        </td>
                        <td className="px-3 py-2 text-slate-300">{row.spec_key || '—'}</td>
                        <td className="px-3 py-2 text-xs text-slate-400">
                          {sourceLabel(row.source)}
                        </td>
                        <td className="px-3 py-2 text-right">{row.completed_qty.toLocaleString()}</td>
                        <td className="px-3 py-2 text-right">{yen(row.material_amount)}</td>
                        <td className="px-3 py-2 text-right">{yen(row.labor_amount)}</td>
                        <td className="px-3 py-2 text-right">{yen(row.indirect_amount)}</td>
                        <td className="px-3 py-2 text-right font-bold text-yellow-300 print:text-black">
                          {yen(row.total_amount)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
                {report.model_rows.length > 0 && (
                  <tfoot>
                    <tr className="border-t-2 border-slate-600 bg-slate-950/50 font-bold print:bg-slate-100">
                      <td className="px-3 py-3" colSpan={3}>
                        合計
                      </td>
                      <td className="px-3 py-3 text-right">
                        {report.totals.completed_qty.toLocaleString()}
                      </td>
                      <td className="px-3 py-3 text-right">
                        {yen(report.totals.material_amount)}
                      </td>
                      <td className="px-3 py-3 text-right">{yen(report.totals.labor_amount)}</td>
                      <td className="px-3 py-3 text-right">
                        {yen(report.totals.indirect_amount)}
                      </td>
                      <td className="px-3 py-3 text-right text-teal-300 print:text-black">
                        {yen(report.totals.total_amount)}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            ) : (
              <table className="min-w-full text-sm">
                <thead className="bg-slate-950/80 text-left text-xs text-slate-400 print:bg-slate-100">
                  <tr>
                    <th className="px-3 py-2">D指令</th>
                    <th className="px-3 py-2">機種</th>
                    <th className="px-3 py-2">品名</th>
                    <th className="px-3 py-2 text-right">台数</th>
                    <th className="px-3 py-2 text-right">材料費</th>
                    <th className="px-3 py-2 text-right">工費</th>
                    <th className="px-3 py-2 text-right">間接費</th>
                    <th className="px-3 py-2 text-right">合計</th>
                  </tr>
                </thead>
                <tbody>
                  {report.order_rows.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-3 py-8 text-center text-slate-500">
                        対象期間のD指令完成ロットがありません
                      </td>
                    </tr>
                  ) : (
                    report.order_rows.map((row) => (
                      <tr
                        key={row.order_no}
                        className="border-t border-slate-800 print:border-slate-300"
                      >
                        <td className="px-3 py-2 font-mono text-cyan-300 print:text-black">
                          {row.order_no}
                          {!row.has_saved_cost && (
                            <span className="ml-2 rounded border border-amber-500/40 px-1.5 py-0.5 text-[10px] text-amber-200 no-print">
                              原価未保存
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 font-mono">
                          {row.model_display || row.model}
                        </td>
                        <td className="px-3 py-2 text-slate-300">{row.product_name || '—'}</td>
                        <td className="px-3 py-2 text-right">{row.completed_qty.toLocaleString()}</td>
                        <td className="px-3 py-2 text-right">{yen(row.material_amount)}</td>
                        <td className="px-3 py-2 text-right">{yen(row.labor_amount)}</td>
                        <td className="px-3 py-2 text-right">{yen(row.indirect_amount)}</td>
                        <td className="px-3 py-2 text-right font-bold text-yellow-300 print:text-black">
                          {yen(row.total_amount)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
                {report.order_rows.length > 0 && (
                  <tfoot>
                    <tr className="border-t-2 border-slate-600 bg-slate-950/50 font-bold print:bg-slate-100">
                      <td className="px-3 py-3" colSpan={3}>
                        D指令合計
                      </td>
                      <td className="px-3 py-3 text-right">
                        {report.order_rows
                          .reduce((s, r) => s + r.completed_qty, 0)
                          .toLocaleString()}
                      </td>
                      <td className="px-3 py-3 text-right">
                        {yen(
                          report.order_rows.reduce((s, r) => s + r.material_amount, 0)
                        )}
                      </td>
                      <td className="px-3 py-3 text-right">
                        {yen(report.order_rows.reduce((s, r) => s + r.labor_amount, 0))}
                      </td>
                      <td className="px-3 py-3 text-right">
                        {yen(
                          report.order_rows.reduce((s, r) => s + r.indirect_amount, 0)
                        )}
                      </td>
                      <td className="px-3 py-3 text-right text-teal-300 print:text-black">
                        {yen(report.order_rows.reduce((s, r) => s + r.total_amount, 0))}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
