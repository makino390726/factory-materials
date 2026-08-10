'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'

type ModelUsage = {
  model: string
  quantity: number
}

type ProductUsageRow = {
  product_code: string
  product_name: string
  spec: string
  part_keys: string[]
  total_quantity: number
  model_count: number
  models: ModelUsage[]
}

function formatQty(value: number): string {
  if (!Number.isFinite(value)) return '-'
  return Number(value).toLocaleString('ja-JP', { maximumFractionDigits: 3 })
}

function formatModels(models: ModelUsage[]): string {
  return models.map((m) => `${m.model}(${formatQty(m.quantity)})`).join('、')
}

export default function PartsUsageByProductCodePage() {
  const [rows, setRows] = useState<ProductUsageRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [keyword, setKeyword] = useState('')
  const [minModels, setMinModels] = useState(1)

  useEffect(() => {
    const controller = new AbortController()
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch('/api/heater/parts-by-product-code', { signal: controller.signal })
        const json = await res.json()
        if (!res.ok || json?.ok === false) {
          throw new Error(json?.error || 'データの取得に失敗しました')
        }
        if (!controller.signal.aborted) {
          setRows(Array.isArray(json.rows) ? json.rows : [])
        }
      } catch (e) {
        if (controller.signal.aborted) return
        setError(e instanceof Error ? e.message : 'Unknown error')
        setRows([])
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }
    load()
    return () => controller.abort()
  }, [])

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    return rows.filter((row) => {
      if (row.model_count < minModels) return false
      if (!kw) return true
      const modelsText = row.models.map((m) => m.model).join(' ')
      return (
        row.product_code.toLowerCase().includes(kw) ||
        row.product_name.toLowerCase().includes(kw) ||
        (row.spec || '').toLowerCase().includes(kw) ||
        modelsText.toLowerCase().includes(kw) ||
        row.part_keys.some((k) => k.toLowerCase().includes(kw))
      )
    })
  }, [rows, keyword, minModels])

  const handlePrint = () => {
    window.print()
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 text-white px-4 py-8 print:bg-white print:text-black print:p-0">
      <div className="mx-auto max-w-screen-xl print:max-w-none">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4 print:hidden">
          <div>
            <div className="mb-2 flex items-center gap-3">
              <span className="rounded-full border border-cyan-400/40 bg-cyan-500/20 px-3 py-1 text-xs font-bold tracking-widest uppercase text-cyan-300">
                PARTS USAGE
              </span>
              <span className="text-sm text-slate-400">部材統一・使用機種抽出</span>
            </div>
            <h1 className="text-3xl sm:text-4xl font-bold text-white">商品コード別 使用機種一覧</h1>
            <p className="mt-2 text-sm text-slate-400">
              BOM を商品コード単位で集約し、数量合計と使用機種を表示します。
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="rounded-full border border-slate-500/60 px-5 py-2 text-sm text-slate-300 transition hover:border-slate-400 hover:text-white"
            >
              ← メニューへ戻る
            </Link>
            <button
              type="button"
              onClick={handlePrint}
              disabled={loading || filtered.length === 0}
              className="rounded-full bg-emerald-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-50"
            >
              印刷
            </button>
          </div>
        </div>

        <div className="mb-6 rounded-2xl border border-slate-600/50 bg-slate-800/70 p-5 print:hidden">
          <div className="flex flex-wrap items-end gap-4">
            <label className="flex min-w-[240px] flex-1 flex-col gap-1 text-sm">
              <span className="text-slate-400">検索（商品コード / 商品名 / 規格 / 機種）</span>
              <input
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="例: ZAM / SGR-600"
                className="rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white outline-none focus:border-cyan-400"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-slate-400">使用機種数（以上）</span>
              <select
                value={minModels}
                onChange={(e) => setMinModels(Number(e.target.value) || 1)}
                className="rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white outline-none focus:border-cyan-400"
              >
                <option value={1}>1以上（すべて）</option>
                <option value={2}>2以上（共用部材）</option>
                <option value={3}>3以上</option>
                <option value={5}>5以上</option>
              </select>
            </label>
            <div className="pb-2 text-sm text-slate-400">
              表示 {filtered.length.toLocaleString('ja-JP')} / 全 {rows.length.toLocaleString('ja-JP')} 件
            </div>
          </div>
        </div>

        <div className="mb-4 hidden border-b border-slate-300 pb-2 print:block">
          <h2 className="text-xl font-bold">商品コード別 使用機種一覧</h2>
          <p className="text-xs text-slate-600">
            印刷日時: {new Date().toLocaleString('ja-JP')}
            {keyword.trim() ? ` ／ 検索: ${keyword.trim()}` : ''}
            {minModels > 1 ? ` ／ 使用機種数 ${minModels}以上` : ''}
          </p>
        </div>

        {error && (
          <div className="mb-4 rounded-2xl border border-rose-500/50 bg-rose-900/40 p-4 text-sm text-rose-200 print:border-rose-300 print:bg-rose-50 print:text-rose-700">
            {error}
          </div>
        )}

        {loading && <div className="py-10 text-center text-slate-400">読込中...</div>}

        {!loading && !error && (
          <div className="overflow-hidden rounded-3xl border-2 border-slate-700 bg-slate-900/80 print:rounded-none print:border print:border-slate-300 print:bg-white">
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm print:text-[11px]">
                <thead className="bg-slate-800 text-slate-300 print:bg-slate-100 print:text-slate-700">
                  <tr>
                    <th className="border-b border-slate-700 px-3 py-3 text-left print:border-slate-300">商品コード</th>
                    <th className="border-b border-slate-700 px-3 py-3 text-left print:border-slate-300">商品名</th>
                    <th className="border-b border-slate-700 px-3 py-3 text-left print:border-slate-300">規格</th>
                    <th className="border-b border-slate-700 px-3 py-3 text-right print:border-slate-300">数量合計</th>
                    <th className="border-b border-slate-700 px-3 py-3 text-right print:border-slate-300">機種数</th>
                    <th className="border-b border-slate-700 px-3 py-3 text-left print:border-slate-300">使用機種（数量）</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                        該当データがありません
                      </td>
                    </tr>
                  )}
                  {filtered.map((row, idx) => (
                    <tr
                      key={row.product_code}
                      className={idx % 2 === 0 ? 'bg-slate-900/40 print:bg-white' : 'bg-slate-800/20 print:bg-slate-50'}
                    >
                      <td className="border-t border-slate-800 px-3 py-2 font-mono text-cyan-300 print:border-slate-200 print:text-slate-900">
                        {row.product_code}
                      </td>
                      <td className="border-t border-slate-800 px-3 py-2 text-white print:border-slate-200 print:text-slate-900">
                        {row.product_name}
                      </td>
                      <td className="border-t border-slate-800 px-3 py-2 text-slate-300 print:border-slate-200 print:text-slate-800">
                        {row.spec || '—'}
                      </td>
                      <td className="border-t border-slate-800 px-3 py-2 text-right font-semibold text-yellow-300 print:border-slate-200 print:text-slate-900">
                        {formatQty(row.total_quantity)}
                      </td>
                      <td className="border-t border-slate-800 px-3 py-2 text-right text-slate-300 print:border-slate-200 print:text-slate-800">
                        {row.model_count}
                      </td>
                      <td className="border-t border-slate-800 px-3 py-2 text-slate-300 print:border-slate-200 print:text-slate-800">
                        {formatModels(row.models)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
