'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  PRODUCT_CATEGORIES,
  type ProductCategory,
} from '@/lib/product-category'

type ChildOrder = {
  id: string
  order_no: string
  product_name: string | null
  model: string | null
  qty: number | null
  status: string | null
  standard_duration_minutes: number
  assembly_labor_minutes: number
  assembly_labor_cost: number
  current_period_minutes: number
  labor_receipt_date: string | null
  linked_explicitly: boolean
  cost_mode: string | null
}

type ModelNode = {
  model: string
  name: string | null
  product_code: string | null
  product_category: string
  order_count: number
  qty_total: number
  minutes_total: number
  orders: ChildOrder[]
}

export default function ModelOrdersMasterPage() {
  const [models, setModels] = useState<ModelNode[]>([])
  const [unlinked, setUnlinked] = useState<ChildOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [category, setCategory] = useState<'すべて' | ProductCategory>('すべて')
  const [query, setQuery] = useState('')
  const [appliedQuery, setAppliedQuery] = useState('')
  const [selectedModel, setSelectedModel] = useState<string | null>(null)
  const [showUnlinked, setShowUnlinked] = useState(false)
  const [onlyWithOrders, setOnlyWithOrders] = useState(false)
  const [linkableCount, setLinkableCount] = useState(0)
  const [linking, setLinking] = useState(false)
  const [infoMessage, setInfoMessage] = useState<string | null>(null)

  const load = useCallback(async (qOverride?: string) => {
    setLoading(true)
    setError(null)
    try {
      const qValue = qOverride !== undefined ? qOverride : appliedQuery
      const params = new URLSearchParams()
      if (category !== 'すべて') params.set('category', category)
      if (qValue.trim()) params.set('q', qValue.trim())
      const res = await fetch(`/api/heater/model-orders?${params.toString()}`)
      const json = await res.json()
      if (!res.ok || json.error) throw new Error(json.error || '取得に失敗しました')
      const list = Array.isArray(json.models) ? (json.models as ModelNode[]) : []
      setModels(list)
      setUnlinked(Array.isArray(json.unlinked_orders) ? json.unlinked_orders : [])
      setLinkableCount(Number(json.linkable_count || 0))
      setSelectedModel((prev) => {
        if (prev && list.some((m) => m.model === prev)) return prev
        const firstWithOrders = list.find((m) => m.order_count > 0)
        return (firstWithOrders || list[0])?.model ?? null
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : '取得に失敗しました')
      setModels([])
      setUnlinked([])
      setLinkableCount(0)
    } finally {
      setLoading(false)
    }
  }, [category, appliedQuery])

  useEffect(() => {
    void load()
  }, [category])

  const runSearch = () => {
    setAppliedQuery(query)
    void load(query)
  }

  const handleAutoLink = async () => {
    if (
      !confirm(
        'D指令の型式・BOM・製品名が機種マスタと一致するものを、親機種へ一括振り分けします。よろしいですか？'
      )
    ) {
      return
    }
    setLinking(true)
    setInfoMessage(null)
    setError(null)
    try {
      const res = await fetch('/api/heater/model-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'auto_link' }),
      })
      const json = await res.json()
      if (!res.ok || json.error) throw new Error(json.error || '振り分けに失敗しました')
      setInfoMessage(json.message || `${json.updated} 件を振り分けました`)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : '振り分けに失敗しました')
    } finally {
      setLinking(false)
    }
  }

  const filteredModels = useMemo(() => {
    if (!onlyWithOrders) return models
    return models.filter((m) => m.order_count > 0)
  }, [models, onlyWithOrders])

  const selected = useMemo(
    () => filteredModels.find((m) => m.model === selectedModel) || null,
    [filteredModels, selectedModel]
  )

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 p-6 md:p-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.25em] text-cyan-300/80">
              Model → Work Order Hierarchy
            </p>
            <h1 className="mt-1 text-3xl font-bold text-white">機種別制作指令マスタ</h1>
            <p className="mt-2 text-sm text-slate-400">
              機種マスタ（親）の下に、制作指令（指令番号・台数・時間）が並びます。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/heater/models">
              <button className="rounded-lg border border-slate-600 bg-slate-800 px-4 py-2 text-sm text-slate-200 hover:bg-slate-700">
                機種マスタ
              </button>
            </Link>
            <Link href="/work-orders">
              <button className="rounded-lg border border-slate-600 bg-slate-800 px-4 py-2 text-sm text-slate-200 hover:bg-slate-700">
                従来D指令マスタ
              </button>
            </Link>
            <Link href="/">
              <button className="rounded-lg border border-slate-600 bg-slate-800 px-4 py-2 text-sm text-slate-200 hover:bg-slate-700">
                ホーム
              </button>
            </Link>
          </div>
        </div>

        <div className="mb-4 flex flex-wrap items-end gap-3 rounded-2xl border border-slate-700 bg-slate-900/70 p-4">
          <div>
            <label className="mb-1 block text-xs text-slate-400">カテゴリ</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as 'すべて' | ProductCategory)}
              className="rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-white"
            >
              <option value="すべて">すべて</option>
              {PRODUCT_CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>
          <div className="min-w-[220px] flex-1">
            <label className="mb-1 block text-xs text-slate-400">検索（機種・指令・製品名）</label>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && runSearch()}
              placeholder="例: SGR-600 / DR7 / 光合成"
              className="w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-500"
            />
          </div>
          <button
            type="button"
            onClick={runSearch}
            className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-500"
          >
            検索
          </button>
          <label className="flex items-center gap-2 pb-2 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={onlyWithOrders}
              onChange={(e) => setOnlyWithOrders(e.target.checked)}
              className="accent-cyan-500"
            />
            指令ありのみ
          </label>
          <button
            type="button"
            onClick={() => setShowUnlinked((v) => !v)}
            className="rounded-lg border border-amber-500/40 bg-amber-950/40 px-3 py-2 text-xs font-semibold text-amber-200 hover:bg-amber-900/50"
          >
            親なしD指令 {unlinked.length}件
          </button>
          <button
            type="button"
            onClick={handleAutoLink}
            disabled={linking}
            className="rounded-lg border border-emerald-500/50 bg-emerald-900/50 px-3 py-2 text-xs font-semibold text-emerald-100 hover:bg-emerald-800/60 disabled:opacity-50"
            title="型式・製品名が機種マスタと一致するD指令の親機種を一括設定"
          >
            {linking
              ? '振り分け中…'
              : `機種と同名を振り分け${linkableCount > 0 ? `（推定${linkableCount}）` : ''}`}
          </button>
        </div>

        {infoMessage && (
          <div className="mb-4 rounded-xl border border-emerald-500/40 bg-emerald-950/40 px-4 py-3 text-sm text-emerald-200">
            {infoMessage}
          </div>
        )}

        {error && (
          <div className="mb-4 rounded-xl border border-rose-500/40 bg-rose-950/40 px-4 py-3 text-sm text-rose-200">
            {error}
          </div>
        )}

        {loading ? (
          <div className="py-20 text-center text-slate-400">読み込み中…</div>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_1fr]">
            {/* 左：機種（親）一覧 */}
            <div className="rounded-2xl border border-slate-700 bg-slate-900/80 overflow-hidden">
              <div className="border-b border-slate-700 bg-slate-950/80 px-4 py-3">
                <h2 className="text-sm font-bold text-cyan-200">機種マスタ（親）</h2>
                <p className="mt-1 text-xs text-slate-500">{filteredModels.length} 機種</p>
              </div>
              <div className="max-h-[70vh] overflow-y-auto">
                {filteredModels.length === 0 ? (
                  <p className="p-6 text-center text-sm text-slate-500">機種がありません</p>
                ) : (
                  filteredModels.map((m) => {
                    const active = selectedModel === m.model
                    return (
                      <button
                        key={m.model}
                        type="button"
                        onClick={() => {
                          setSelectedModel(m.model)
                          setShowUnlinked(false)
                        }}
                        className={`w-full border-b border-slate-800 px-4 py-3 text-left transition ${
                          active
                            ? 'bg-cyan-950/50 ring-1 ring-inset ring-cyan-500/40'
                            : 'hover:bg-slate-800/60'
                        }`}
                      >
                        <div className="font-mono text-sm font-bold text-cyan-300">{m.model}</div>
                        <div className="mt-0.5 text-xs text-slate-300 truncate">
                          {m.name || '（品名未設定）'}
                        </div>
                        <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-slate-500">
                          <span>{m.product_category}</span>
                          <span>指令 {m.order_count}</span>
                          <span>合計 {m.qty_total}台</span>
                        </div>
                      </button>
                    )
                  })
                )}
              </div>
            </div>

            {/* 右：ツリー詳細 */}
            <div className="rounded-2xl border border-slate-700 bg-slate-900/80 overflow-hidden">
              {showUnlinked ? (
                <div className="p-5">
                  <h2 className="text-lg font-bold text-amber-200">親機種なしのD指令（従来）</h2>
                  <p className="mt-1 text-xs text-slate-400">
                    機種マスタに紐づいていない指令です。D指令マスタで「親機種」を指定すると左側の機種配下に入ります。
                  </p>
                  <UnlinkedTable orders={unlinked} />
                </div>
              ) : !selected ? (
                <div className="p-12 text-center text-slate-500">左から機種を選択してください</div>
              ) : (
                <div className="p-5 md:p-6">
                  {/* 親ノード */}
                  <div className="rounded-xl border border-cyan-500/30 bg-gradient-to-r from-cyan-950/50 to-slate-900/40 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wider text-cyan-400/90">
                      機種マスタ（親）
                    </p>
                    <div className="mt-2 space-y-1 font-mono text-sm text-slate-200">
                      <div>
                        <span className="text-slate-500">└─ コード：</span>
                        <span className="ml-1 text-xl font-bold text-cyan-300">{selected.model}</span>
                      </div>
                      <div>
                        <span className="text-slate-500">└─ 品名：</span>
                        <span className="ml-1 text-lg text-white">
                          {selected.name || '（未設定）'}
                        </span>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-3 text-xs">
                      <span className="rounded bg-slate-800 px-2 py-1 text-slate-300">
                        {selected.product_category}
                      </span>
                      <span className="rounded bg-yellow-950/60 px-2 py-1 font-semibold text-yellow-200">
                        指令台数合計 {selected.qty_total} 台
                      </span>
                      <span className="rounded bg-slate-800 px-2 py-1 text-slate-300">
                        指令 {selected.order_count} 件
                      </span>
                      <span className="rounded bg-slate-800 px-2 py-1 text-slate-300">
                        時間合計 {selected.minutes_total.toLocaleString()} 分
                      </span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Link
                        href={`/work-orders?heater_model=${encodeURIComponent(selected.model)}`}
                      >
                        <button className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-500">
                          ＋ この機種の制作指令を追加
                        </button>
                      </Link>
                      <Link
                        href={`/heater/models/dr8008?model=${encodeURIComponent(selected.model)}`}
                      >
                        <button className="rounded-lg bg-violet-700 px-3 py-1.5 text-xs font-bold text-white hover:bg-violet-600">
                          機種標準原価
                        </button>
                      </Link>
                      <Link
                        href={`/heater/bom?model=${encodeURIComponent(selected.model)}`}
                      >
                        <button className="rounded-lg bg-orange-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-orange-500">
                          部品表(BOM)
                        </button>
                      </Link>
                      <Link href={`/heater/models`}>
                        <button className="rounded-lg border border-slate-600 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800">
                          機種を編集
                        </button>
                      </Link>
                    </div>
                  </div>

                  {/* 子：制作指令 */}
                  <div className="mt-4 ml-2 border-l-2 border-slate-700 pl-4 md:ml-4 md:pl-6">
                    <p className="mb-3 text-xs font-semibold text-slate-400">
                      制作指令（オーダーのたびに増える）
                    </p>
                    {selected.orders.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-slate-600 bg-slate-950/40 px-4 py-8 text-center text-sm text-slate-500">
                        まだ制作指令がありません。
                        <br />
                        「この機種の制作指令を追加」から登録してください。
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {selected.orders.map((order, index) => (
                          <div
                            key={order.id}
                            className="relative rounded-xl border border-slate-700 bg-slate-950/60 p-4"
                          >
                            <div className="absolute -left-[1.4rem] top-5 h-px w-4 bg-slate-700 md:-left-[1.9rem] md:w-6" />
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <p className="text-xs text-slate-500">
                                  ├─ 指令{index + 1}
                                  {!order.linked_explicitly && (
                                    <span className="ml-2 text-amber-400/80">
                                      （型式推定・親機種未設定）
                                    </span>
                                  )}
                                </p>
                                <p className="mt-1 font-mono text-lg font-bold text-cyan-300">
                                  指令番号：{order.order_no}
                                </p>
                                <p className="mt-1 text-sm text-slate-300">
                                  指令台数：
                                  <span className="ml-1 font-bold text-yellow-300">
                                    {order.qty ?? '—'} 台
                                  </span>
                                  <span className="mx-2 text-slate-600">／</span>
                                  時間：
                                  <span className="ml-1 font-semibold text-white">
                                    {order.standard_duration_minutes.toLocaleString()} 分
                                  </span>
                                  {order.labor_receipt_date && (
                                    <span className="ml-2 text-xs text-emerald-400">
                                      入庫確定 {order.labor_receipt_date}
                                    </span>
                                  )}
                                </p>
                                <p className="mt-1 text-xs text-slate-500">
                                  制作工賃（自動） ¥{order.assembly_labor_cost.toLocaleString()}
                                  {order.product_name ? ` ｜ ${order.product_name}` : ''}
                                </p>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                <Link href={`/work-orders?edit=${order.id}#work-order-form`}>
                                  <button className="rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-600">
                                    編集
                                  </button>
                                </Link>
                                <Link
                                  href={`/heater/models/dr8008?work_order_id=${order.id}`}
                                >
                                  <button className="rounded-md bg-amber-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-600">
                                    原価
                                  </button>
                                </Link>
                                <Link
                                  href={`/process-management?target_type=instruction&target_code=${encodeURIComponent(order.order_no)}`}
                                >
                                  <button className="rounded-md bg-indigo-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-600">
                                    工程
                                  </button>
                                </Link>
                              </div>
                            </div>
                          </div>
                        ))}
                        <p className="pl-1 text-xs text-slate-600">
                          └─ …（次のオーダーで指令が増えます）
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function UnlinkedTable({ orders }: { orders: ChildOrder[] }) {
  if (orders.length === 0) {
    return <p className="mt-6 text-sm text-slate-500">親なしの指令はありません</p>
  }
  return (
    <div className="mt-4 overflow-x-auto rounded-xl border border-slate-700">
      <table className="min-w-full text-sm">
        <thead className="bg-slate-950 text-left text-xs text-slate-400">
          <tr>
            <th className="px-3 py-2">指令番号</th>
            <th className="px-3 py-2">製品名</th>
            <th className="px-3 py-2">型式</th>
            <th className="px-3 py-2 text-right">台数</th>
            <th className="px-3 py-2 text-right">時間</th>
            <th className="px-3 py-2">操作</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.id} className="border-t border-slate-800">
              <td className="px-3 py-2 font-mono text-cyan-300">{o.order_no}</td>
              <td className="px-3 py-2 text-slate-300">{o.product_name || '-'}</td>
              <td className="px-3 py-2 text-slate-400">{o.model || '-'}</td>
              <td className="px-3 py-2 text-right text-yellow-300">{o.qty ?? '-'}</td>
              <td className="px-3 py-2 text-right text-slate-300">
                {o.standard_duration_minutes.toLocaleString()}
              </td>
              <td className="px-3 py-2">
                <Link
                  href={`/work-orders?edit=${o.id}#work-order-form`}
                  className="text-xs text-emerald-300 underline"
                >
                  親機種を設定
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
