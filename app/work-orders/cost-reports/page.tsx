'use client'

import Link from 'next/link'
import { Fragment, useEffect, useMemo, useState } from 'react'

type ReportType = 'order' | 'line'

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

const currency = (value: number) => `\u00a5${Math.round(value || 0).toLocaleString('ja-JP')}`
const unitValue = (total: number, quantity: number) => {
  const qty = Number(quantity || 0)
  if (qty <= 0) return 0
  return Number(total || 0) / qty
}

export default function CostReportsPage() {
  const [reportType, setReportType] = useState<ReportType>('order')
  const [rows, setRows] = useState<CostReportRow[]>([])
  const [bomSummary, setBomSummary] = useState<BomSummaryRow[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reportTitle = reportType === 'order' ? '指令原価一覧' : 'ライン原価一覧'
  const firstColumnTitle = reportType === 'order' ? '指令番号' : '部品キー'

  useEffect(() => {
    const fetchReport = async () => {
      setIsLoading(true)
      setError(null)
      try {
        const response = await fetch(`/api/work-order-costs/print-report?type=${reportType}`)
        if (!response.ok) {
          const data = await response.json().catch(() => ({}))
          throw new Error(data?.error || '帳票データの取得に失敗しました')
        }
        const data = await response.json()
        setRows(Array.isArray(data?.rows) ? data.rows : [])
        setBomSummary(Array.isArray(data?.bomSummary) ? data.bomSummary : [])
      } catch (fetchError) {
        setError(fetchError instanceof Error ? fetchError.message : 'Unknown error')
      } finally {
        setIsLoading(false)
      }
    }

    fetchReport()
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
              onClick={() => window.print()}
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
              指令原価
            </button>
            <button
              onClick={() => setReportType('line')}
              className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${reportType === 'line' ? 'border border-violet-400/50 bg-violet-600 text-white shadow-[0_0_16px_rgba(139,92,246,0.35)]' : 'border border-slate-600 bg-slate-900 text-slate-300 hover:border-slate-500 hover:text-white'}`}
            >
              ライン原価
            </button>
          </div>
        </div>

        <div className="mb-4 hidden border-b border-slate-300 pb-2 print:block">
          <h2 className="text-xl font-bold">{reportTitle}</h2>
          <p className="text-xs text-slate-600">印刷日時: {new Date().toLocaleString('ja-JP')}</p>
        </div>

        {error && (
          <div className="mb-4 rounded-2xl border border-rose-500/50 bg-rose-900/40 p-4 text-sm text-rose-200 print:border-rose-300 print:bg-rose-50 print:text-rose-700">
            {error}
          </div>
        )}

        {isLoading && <div className="py-10 text-center text-slate-400">読込中...</div>}

        {!isLoading && !error && (
          <div className="space-y-6">
            {/* BOM合計サマリ（BOMがある場合） */}
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

            {/* 一覧テーブル */}
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
