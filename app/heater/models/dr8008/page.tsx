'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { branchCostItemMultiplier } from '@/lib/work-order-bom-cost-aggregate'

// =============================================================
// 型定義
// =============================================================
type WorkOrder = {
  id: string
  order_no: string
  product_name: string | null
  model: string | null
  bom_model: string | null
  cost_mode: string | null
  qty: number | null
}

type CostItem = {
  id: string
  product_code: string
  part_name: string
  spec: string
  quantity: number
  unit_price: number
  material_cost: number
  labor_cost: number
  indirect_cost: number
  line_total: number
  cost_type: string
}

type Section = {
  branch_no: string
  part_key: string
  part_name: string | null
  product_code: string | null
  bom_quantity: number
  unit_cost: number
  subtotal: number
  cost_items: CostItem[]
}

type ViewMode = 'branch' | 'list'
type WorkOrderListFilter = 'all' | 'bom'

type OrderSummaryRow = {
  work_order_id: string
  order_no: string
  product_name: string | null
  material_total: number
  indirect_total: number
  labor_total: number
  grand_total: number
  branch_count: number
  has_saved_cost?: boolean
  cost_saved_at?: string | null
}

type SavedCostHeader = {
  has_saved_cost: boolean
  cost_saved_at: string | null
  material_total: number
  labor_total: number
  indirect_total: number
  grand_total: number
}

type OrderSummaryTotals = {
  material_total: number
  indirect_total: number
  labor_total: number
  grand_total: number
}

type BreakdownData = {
  model: string
  product_code: string | null
  current_cost_price: number | null
  grand_total: number
  sections: Section[]
}

// =============================================================
// D指令原価BOM ページ
// =============================================================
// 計算フロー:
//   D指令原価計算（/work-orders/cost）で保存された work_order_costs を表示
//   一覧・枝番別とも保存結果を正とする（再集計・L指令原価フォールバックなし）
// =============================================================
export default function WorkOrderBomCostPage() {
  const searchParams = useSearchParams()

  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([])
  const [selectedWorkOrderId, setSelectedWorkOrderId] = useState<string>('')
  const [selectedWorkOrder, setSelectedWorkOrder] = useState<WorkOrder | null>(null)
  const [bomModelInput, setBomModelInput] = useState<string>('')

  const [data, setData] = useState<BreakdownData | null>(null)
  const [savedCostHeader, setSavedCostHeader] = useState<SavedCostHeader | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState<string | null>(null)
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set())
  const [syncing, setSyncing] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>('branch')
  const [workOrderListFilter, setWorkOrderListFilter] = useState<WorkOrderListFilter>('bom')
  const [summaryRows, setSummaryRows] = useState<OrderSummaryRow[]>([])
  const [summaryTotals, setSummaryTotals] = useState<OrderSummaryTotals | null>(null)
  const [summaryLoading, setSummaryLoading] = useState(false)

  // D指令一覧を取得
  useEffect(() => {
    fetch('/api/work-orders')
      .then(r => r.json())
      .then(d => setWorkOrders(Array.isArray(d) ? d : []))
      .catch(() => {})
  }, [])

  // URL パラメータから初期D指令 ID を設定
  useEffect(() => {
    const id = searchParams.get('work_order_id')
    if (id) setSelectedWorkOrderId(id)
  }, [searchParams])

  // D指令が選択されたら bom_model をセット
  useEffect(() => {
    if (!selectedWorkOrderId) {
      setSelectedWorkOrder(null)
      return
    }
    const wo = workOrders.find(w => w.id === selectedWorkOrderId) ?? null
    setSelectedWorkOrder(wo)
    if (wo?.bom_model) setBomModelInput(wo.bom_model)
  }, [selectedWorkOrderId, workOrders])

  const applyOrderCostResponse = (orderJson: any, wo: WorkOrder | null) => {
    const sections: Section[] = (orderJson.branches || []).map((branch: any) => ({
      branch_no: String(branch.branch_no || ''),
      part_key: String(branch.part_key || ''),
      part_name: branch.part_name ?? null,
      product_code: branch.product_code ?? null,
      bom_quantity: Number(branch.bom_quantity || 1),
      unit_cost: Number(branch.unit_cost || 0),
      subtotal: Number(branch.subtotal || 0),
      cost_items: Array.isArray(branch.cost_items)
        ? branch.cost_items.map((item: any) => ({
            id: String(item.id || ''),
            product_code: item.product_code ?? '',
            part_name: item.part_name ?? '',
            spec: item.spec ?? '',
            quantity: Number(item.quantity || 0),
            unit_price: Number(item.unit_price || 0),
            material_cost: Number(item.material_cost || 0),
            labor_cost: Number(item.labor_cost || 0),
            indirect_cost: Number(item.indirect_cost || 0),
            line_total: Number(item.line_total || 0),
            cost_type: item.cost_type || '加',
          }))
        : [],
    }))
    const modelName = wo?.bom_model || wo?.order_no || bomModelInput || 'D指令BOM'
    setData({
      model: modelName,
      product_code: null,
      current_cost_price: null,
      grand_total: Number(orderJson.grand_total || 0),
      sections,
    })
    setSavedCostHeader({
      has_saved_cost: Boolean(orderJson.has_saved_cost),
      cost_saved_at: orderJson.cost_saved_at ?? null,
      material_total: Number(orderJson.material_total || 0),
      labor_total: Number(orderJson.labor_total || 0),
      indirect_total: Number(orderJson.indirect_total || 0),
      grand_total: Number(orderJson.grand_total || 0),
    })
    setExpandedSections(new Set(sections.map((s) => s.part_key)))
  }

  const loadSummaryList = async (filter: WorkOrderListFilter = workOrderListFilter) => {
    setSummaryLoading(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/work-orders/bom-cost?list=1&filter=${encodeURIComponent(filter)}`
      )
      const json = await res.json()
      if (!res.ok || json.error) {
        throw new Error(json.error || `HTTP ${res.status}`)
      }
      setSummaryRows(Array.isArray(json.rows) ? json.rows : [])
      setSummaryTotals(json.totals ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : '一覧の取得に失敗しました')
      setSummaryRows([])
      setSummaryTotals(null)
    } finally {
      setSummaryLoading(false)
    }
  }

  useEffect(() => {
    if (viewMode !== 'list') return
    let cancelled = false
    const run = async () => {
      setSummaryLoading(true)
      setError(null)
      try {
        const res = await fetch(
          `/api/work-orders/bom-cost?list=1&filter=${encodeURIComponent(workOrderListFilter)}`
        )
        const json = await res.json()
        if (!res.ok || json.error) {
          throw new Error(json.error || `HTTP ${res.status}`)
        }
        if (!cancelled) {
          setSummaryRows(Array.isArray(json.rows) ? json.rows : [])
          setSummaryTotals(json.totals ?? null)
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : '一覧の取得に失敗しました')
          setSummaryRows([])
          setSummaryTotals(null)
        }
      } finally {
        if (!cancelled) setSummaryLoading(false)
      }
    }
    run()
    return () => {
      cancelled = true
    }
  }, [viewMode, workOrderListFilter])

  const handleSelectSummaryRow = async (row: OrderSummaryRow) => {
    setSelectedWorkOrderId(row.work_order_id)
    setViewMode('branch')
    setLoading(true)
    setError(null)
    try {
      const orderRes = await fetch(
        `/api/work-orders/bom-cost?work_order_id=${encodeURIComponent(row.work_order_id)}`
      )
      if (!orderRes.ok) {
        const body = await orderRes.json().catch(() => ({}))
        throw new Error(body.error || `HTTP ${orderRes.status}`)
      }
      const orderJson = await orderRes.json()
      const wo = orderJson.work_order as WorkOrder | null
      if (wo) {
        setSelectedWorkOrder(wo)
        if (wo.bom_model) setBomModelInput(wo.bom_model)
      }
      applyOrderCostResponse(orderJson, wo)
    } catch (e) {
      setError(e instanceof Error ? e.message : '取得に失敗しました')
    } finally {
      setLoading(false)
    }
  }

  const handleSync = async () => {
    if (!selectedWorkOrderId || !bomModelInput.trim()) {
      setError('D指令とBOMモデルを選択してください')
      return
    }
    setSyncing(true)
    setError(null)
    try {
      const res = await fetch('/api/work-orders/branches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          work_order_id: selectedWorkOrderId,
          action: 'sync',
          bom_model: bomModelInput.trim(),
        }),
      })
      const data = await res.json()
      if (!res.ok || data.error) {
        setError(data.error || 'BOM同期に失敗しました')
        return
      }
      // 同期後に再集計
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'BOM同期中にエラーが発生しました')
    } finally {
      setSyncing(false)
    }
  }

  const load = async (model?: string) => {
    setLoading(true)
    setError(null)
    setData(null)
    setSavedCostHeader(null)
    try {
      // D指令が選択されている場合は、D指令マスタ（work_order_branches）ベースで集計する。
      // heater_bom はL指令側用途として切り分ける。
      if (selectedWorkOrderId) {
        const orderRes = await fetch(
          `/api/work-orders/bom-cost?work_order_id=${encodeURIComponent(selectedWorkOrderId)}`
        )

        if (!orderRes.ok) {
          const body = await orderRes.json().catch(() => ({}))
          throw new Error(body.error || `HTTP ${orderRes.status}`)
        }

        const orderJson = await orderRes.json()
        if (orderJson?.error) {
          throw new Error(orderJson.error)
        }

        const wo = orderJson.work_order as WorkOrder | null
        if (wo) {
          setSelectedWorkOrder(wo)
          if (wo.bom_model) setBomModelInput(wo.bom_model)
        }

        applyOrderCostResponse(orderJson, wo)
        return
      }

      const targetModel = (model ?? bomModelInput).trim()
      if (!targetModel) {
        setError('BOMモデルを入力してください（例: DR8-008）')
        return
      }

      const res = await fetch(
        `/api/heater/bom/cost-breakdown?model=${encodeURIComponent(targetModel)}`
      )
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `HTTP ${res.status}`)
      }
      const json: BreakdownData = await res.json()
      setData(json)
      setExpandedSections(new Set(json.sections.map(s => s.part_key)))
    } catch (e) {
      setError(e instanceof Error ? e.message : '取得に失敗しました')
    } finally {
      setLoading(false)
    }
  }

  const toggleSection = (partKey: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev)
      if (next.has(partKey)) next.delete(partKey)
      else next.add(partKey)
      return next
    })
  }

  // =========================================================
  // 原価確定保存:
  //   ① products テーブル（製品コードがある場合）
  //   ② work_order_costs スナップショット（D指令が選択されている場合）
  // =========================================================
  const handleSaveCost = async () => {
    if (!data) return

    const lines: string[] = [
      `BOMモデル: ${data.model}`,
      `算出原価: ¥${data.grand_total.toLocaleString()}`,
    ]
    if (data.product_code) lines.push(`製品コード: ${data.product_code}`)
    if (selectedWorkOrder) lines.push(`D指令番号: ${selectedWorkOrder.order_no}`)
    lines.push('\nよろしいですか？')
    if (!confirm(lines.join('\n'))) return

    setSaving(true)
    setSaveMessage(null)
    const results: string[] = []
    try {
      // ① products テーブルへの保存
      if (data.product_code) {
        const res = await fetch('/api/products/update-cost', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ product_code: data.product_code, cost_price: data.grand_total }),
        })
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.error || '製品原価の更新に失敗しました')
        }
        setData(prev => prev ? { ...prev, current_cost_price: data.grand_total } : prev)
        results.push(`製品原価（${data.product_code}）`)
      }

      // ② work_order_costs スナップショット保存
      if (selectedWorkOrderId) {
        const res2 = await fetch('/api/work-orders/bom-cost', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ work_order_id: selectedWorkOrderId }),
        })
        if (!res2.ok) {
          const body = await res2.json().catch(() => ({}))
          console.warn('work_order_costs snapshot failed:', body.error)
        } else {
          results.push(`D指令原価スナップショット（${selectedWorkOrder?.order_no}）`)
        }
      }

      if (results.length === 0) {
        setSaveMessage('保存先がありません（製品コードまたはD指令を選択してください）')
      } else {
        setSaveMessage(`¥${data.grand_total.toLocaleString()} を ${results.join(' / ')} に保存しました`)
      }
    } catch (e) {
      setSaveMessage(`エラー: ${e instanceof Error ? e.message : '不明'}`)
    } finally {
      setSaving(false)
    }
  }

  // =========================================================
  // サマリ計算（ヘッダ表示用）
  // =========================================================
  const totalMaterial = savedCostHeader?.material_total ?? 0
  const totalLabor = savedCostHeader?.labor_total ?? 0
  const totalIndirect = savedCostHeader?.indirect_total ?? 0
  const workOrderQty = selectedWorkOrder?.qty ?? 1
  const sortedWorkOrders = useMemo(
    () => [...workOrders].sort((a, b) => a.order_no.localeCompare(b.order_no, 'ja-JP', { numeric: true })),
    [workOrders]
  )
  const filteredWorkOrders = useMemo(() => {
    if (workOrderListFilter === 'bom') {
      return sortedWorkOrders.filter(
        (wo) => wo.cost_mode === 'bom' || Boolean(wo.bom_model?.trim())
      )
    }
    return sortedWorkOrders
  }, [sortedWorkOrders, workOrderListFilter])

  const sectionBreakdown = (section: Section) => {
    const bomQty = branchCostItemMultiplier(section)
    const material = section.cost_items.reduce((sum, item) => sum + item.material_cost, 0) * bomQty
    const labor = section.cost_items.reduce((sum, item) => sum + item.labor_cost, 0) * bomQty
    const indirect = section.cost_items.reduce((sum, item) => sum + item.indirect_cost, 0) * bomQty
    return { material: Math.round(material), labor: Math.round(labor), indirect: Math.round(indirect) }
  }

  const canSave = Boolean(data && (data.product_code || selectedWorkOrderId) && data.sections.length > 0)

  // =========================================================
  // レンダリング
  // =========================================================
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 text-white px-4 py-8">

      {/* ヘッダ */}
      <div className="max-w-screen-xl mx-auto mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <span className="px-3 py-1 rounded-full bg-violet-500/20 border border-violet-400/40 text-violet-300 text-xs font-bold tracking-widest uppercase">
              BOM集計
            </span>
            <span className="text-slate-400 text-sm">D指令原価計算</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold text-white">
            D指令原価BOM
          </h1>
          <p className="mt-2 text-sm text-slate-400">
            D指令原価計算で保存した結果を表示します（1台分）。未保存のD指令はD指令原価計算画面で計算・保存してください。
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/work-orders">
            <button className="px-5 py-2 rounded-full border border-slate-500/60 text-slate-300 hover:text-white hover:border-slate-400 transition text-sm">
              ← D指令一覧
            </button>
          </Link>
          <Link href="/">
            <button className="px-5 py-2 rounded-full border border-rose-400/40 text-rose-200 hover:border-rose-300 hover:text-white transition text-sm">
              ← ホーム
            </button>
          </Link>
        </div>
      </div>

      {/* ① D指令選択パネル */}
      <div className="max-w-screen-xl mx-auto mb-6 bg-slate-800/70 border border-slate-600/50 rounded-2xl p-5">
        <p className="text-sm font-semibold text-slate-300 mb-3">
          ① D指令を選択（または BOM モデルを直接入力）
        </p>
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <span className="text-xs text-slate-400">D指令リスト:</span>
          <label className="inline-flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer">
            <input
              type="radio"
              name="workOrderListFilter"
              checked={workOrderListFilter === 'bom'}
              onChange={() => setWorkOrderListFilter('bom')}
              className="accent-violet-500"
            />
            BOM出力D指令のみ
          </label>
          <label className="inline-flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer">
            <input
              type="radio"
              name="workOrderListFilter"
              checked={workOrderListFilter === 'all'}
              onChange={() => setWorkOrderListFilter('all')}
              className="accent-violet-500"
            />
            全D指令
          </label>
          <span className="text-slate-600">|</span>
          <span className="text-xs text-slate-400">表示:</span>
          <button
            type="button"
            onClick={() => setViewMode('branch')}
            className={`px-3 py-1 rounded-lg text-xs font-semibold transition ${
              viewMode === 'branch'
                ? 'bg-violet-600 text-white'
                : 'bg-slate-900 text-slate-300 border border-slate-600 hover:border-slate-400'
            }`}
          >
            枝番別
          </button>
          <button
            type="button"
            onClick={() => setViewMode('list')}
            className={`px-3 py-1 rounded-lg text-xs font-semibold transition ${
              viewMode === 'list'
                ? 'bg-violet-600 text-white'
                : 'bg-slate-900 text-slate-300 border border-slate-600 hover:border-slate-400'
            }`}
          >
            一覧表示
          </button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr_auto] gap-3 items-end">
          <div>
            <label className="block text-xs text-slate-400 mb-1">D指令</label>
            <select
              value={selectedWorkOrderId}
              onChange={e => setSelectedWorkOrderId(e.target.value)}
              className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-violet-500"
            >
              <option value="">─ D指令を選択 ─</option>
              {filteredWorkOrders.map(wo => (
                <option key={wo.id} value={wo.id}>
                  {wo.order_no}
                  {wo.product_name ? ` │ ${wo.product_name}` : ''}
                  {wo.cost_mode === 'bom' ? ' [BOM]' : ''}
                  {wo.bom_model ? ` (${wo.bom_model})` : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="text-slate-500 text-sm pb-2 text-center hidden md:block">または</div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">BOMモデル（直接入力）</label>
            <input
              type="text"
              value={bomModelInput}
              onChange={e => setBomModelInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && load()}
              placeholder="例: DR8-008"
              className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
          </div>
          <button
            onClick={() => load()}
            disabled={loading || (!selectedWorkOrderId && !bomModelInput.trim())}
            className="px-6 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:bg-violet-800/50 disabled:cursor-not-allowed text-white font-semibold text-sm transition"
          >
            {loading ? '集計中…' : '集計'}
          </button>
          {selectedWorkOrderId && (
            <button
              onClick={handleSync}
              disabled={syncing || loading || !bomModelInput.trim()}
              className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-800/50 disabled:cursor-not-allowed text-white font-semibold text-sm transition"
              title="工賃枝番(00)を含めて枝番を再生成してから集計します"
            >
              {syncing ? '同期中…' : '🔄 BOM同期→集計'}
            </button>
          )}
        </div>

        {/* 選択中のD指令情報 */}
        {selectedWorkOrder && (
          <div className="mt-3 pt-3 border-t border-slate-700 flex flex-wrap gap-4 text-xs text-slate-400">
            <span>D指令: <span className="text-white font-semibold">{selectedWorkOrder.order_no}</span></span>
            {selectedWorkOrder.product_name && (
              <span>製品名: <span className="text-slate-200">{selectedWorkOrder.product_name}</span></span>
            )}
            {selectedWorkOrder.model && (
              <span>型式: <span className="text-slate-200">{selectedWorkOrder.model}</span></span>
            )}
            {selectedWorkOrder.bom_model && (
              <span>BOMモデル: <span className="text-violet-300 font-semibold">{selectedWorkOrder.bom_model}</span></span>
            )}
            {selectedWorkOrder.cost_mode === 'bom' && (
              <span className="px-2 py-0.5 rounded bg-violet-700/40 text-violet-300 font-bold">BOM集計モード</span>
            )}
            {selectedWorkOrder.qty != null && (
              <span>製作数: <span className="text-yellow-300 font-bold">{selectedWorkOrder.qty} 台</span></span>
            )}
          </div>
        )}
      </div>

      {/* 一覧表示（D指令単位サマリ） */}
      {viewMode === 'list' && (
        <div className="max-w-screen-xl mx-auto mb-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-white">D指令BOM 一覧</h2>
              <p className="text-xs text-slate-400 mt-1">
                D指令原価計算の保存結果（材料費計・間接費計・工賃計・合計・1台分）を表示します。行をクリックすると枝番別の保存明細を開きます。
              </p>
            </div>
            <button
              type="button"
              onClick={() => loadSummaryList()}
              disabled={summaryLoading}
              className="px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white text-sm font-semibold transition"
            >
              {summaryLoading ? '読込中…' : '一覧を更新'}
            </button>
          </div>

          {summaryLoading && summaryRows.length === 0 ? (
            <div className="text-center py-16 text-slate-400">一覧を読み込み中…</div>
          ) : summaryRows.length === 0 ? (
            <div className="bg-amber-900/30 border border-amber-500/40 rounded-2xl p-6 text-amber-300 text-center">
              表示対象のD指令がありません
            </div>
          ) : (
            <div className="bg-slate-900/80 border-2 border-slate-700 rounded-3xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-800 border-b border-slate-600">
                    <tr>
                      <th className="px-4 py-3 text-left font-bold text-slate-300">D指令番号</th>
                      <th className="px-4 py-3 text-left font-bold text-slate-300">D指令名称</th>
                      <th className="px-4 py-3 text-right font-bold text-sky-300">材料費計</th>
                      <th className="px-4 py-3 text-right font-bold text-violet-300">間接費計</th>
                      <th className="px-4 py-3 text-right font-bold text-emerald-300">工賃計</th>
                      <th className="px-4 py-3 text-right font-bold text-yellow-300">合計</th>
                      <th className="px-4 py-3 text-center font-bold text-slate-300">状態</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-700/80">
                    {summaryRows.map((row, idx) => (
                      <tr
                        key={row.work_order_id}
                        onClick={() => handleSelectSummaryRow(row)}
                        className={`cursor-pointer transition hover:bg-violet-900/30 ${
                          idx % 2 === 0 ? 'bg-slate-900/40' : 'bg-slate-800/20'
                        } ${selectedWorkOrderId === row.work_order_id ? 'ring-1 ring-inset ring-violet-400/60' : ''}`}
                        title="クリックで枝番別明細を表示"
                      >
                        <td className="px-4 py-3 font-mono font-semibold text-cyan-300 whitespace-nowrap">
                          {row.order_no}
                        </td>
                        <td className="px-4 py-3 text-slate-200">
                          {row.product_name || '（名称未設定）'}
                        </td>
                        <td className="px-4 py-3 text-right text-sky-300">
                          ¥{row.material_total.toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-right text-violet-300">
                          ¥{row.indirect_total.toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-right text-emerald-300">
                          ¥{row.labor_total.toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-right font-bold text-yellow-300">
                          {row.has_saved_cost ? `¥${row.grand_total.toLocaleString()}` : '—'}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {row.has_saved_cost ? (
                            <span className="px-2 py-0.5 rounded bg-emerald-900/40 text-emerald-300 text-xs font-semibold">
                              保存済
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded bg-slate-700 text-slate-400 text-xs font-semibold">
                              未計算
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  {summaryTotals && (
                    <tfoot className="bg-slate-800/90 border-t-2 border-yellow-500/40">
                      <tr>
                        <td colSpan={2} className="px-4 py-3 font-bold text-yellow-300">
                          合計（{summaryRows.length} D指令・保存済みのみ集計）
                        </td>
                        <td className="px-4 py-3 text-right font-bold text-sky-300">
                          ¥{summaryTotals.material_total.toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-right font-bold text-violet-300">
                          ¥{summaryTotals.indirect_total.toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-right font-bold text-emerald-300">
                          ¥{summaryTotals.labor_total.toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-right font-extrabold text-xl text-yellow-300">
                          ¥{summaryTotals.grand_total.toLocaleString()}
                        </td>
                        <td />
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ローディング / エラー */}
      {viewMode === 'branch' && loading && (
        <div className="max-w-screen-xl mx-auto text-center py-16 text-slate-400">
          データを読み込み中…
        </div>
      )}
      {error && (
        <div className="max-w-screen-xl mx-auto bg-rose-900/40 border border-rose-500/50 rounded-2xl p-6 text-rose-300">
          <p className="font-bold mb-1">エラーが発生しました</p>
          <p className="text-sm">{error}</p>
          <button onClick={() => load()} className="mt-3 px-4 py-2 bg-rose-700/50 hover:bg-rose-700 rounded-lg text-sm">
            再読み込み
          </button>
        </div>
      )}

      {viewMode === 'branch' && data && !loading && (
        <div className="max-w-screen-xl mx-auto space-y-6">

          {/* 集計対象ラベル */}
          <div className="flex flex-wrap items-center gap-3 px-1">
            <span className="text-slate-400 text-sm">集計対象:</span>
            <span className="text-lg font-bold text-violet-300">{data.model}</span>
            {selectedWorkOrder && (
              <span className="text-sm text-slate-400">（D指令: {selectedWorkOrder.order_no}）</span>
            )}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="bg-slate-800/60 border border-slate-600/50 rounded-2xl p-4">
              <p className="text-xs text-slate-400 mb-1">材料費 合計</p>
              <p className="text-xl font-bold text-sky-300">¥{totalMaterial.toLocaleString()}</p>
            </div>
            <div className={`bg-slate-800/60 border rounded-2xl p-4 ${totalLabor > 0 ? 'border-emerald-500/50' : 'border-slate-600/50'}`}>
              <p className="text-xs text-slate-400 mb-1">工賃 合計</p>
              <p className={`text-xl font-bold ${totalLabor > 0 ? 'text-emerald-300' : 'text-slate-500'}`}>
                ¥{totalLabor.toLocaleString()}
              </p>
            </div>
            <div className="bg-slate-800/60 border border-slate-600/50 rounded-2xl p-4">
              <p className="text-xs text-slate-400 mb-1">間接費 合計</p>
              <p className="text-xl font-bold text-violet-300">¥{totalIndirect.toLocaleString()}</p>
            </div>
            <div className="bg-indigo-900/50 border-2 border-indigo-500/60 rounded-2xl p-4">
              <p className="text-xs text-indigo-300 mb-1 font-semibold">{data.model} 原価 合計</p>
              <p className="text-2xl font-extrabold text-yellow-300">¥{data.grand_total.toLocaleString()}</p>
              {data.current_cost_price !== null && (
                <p className="text-xs text-slate-400 mt-1">
                  現在値: ¥{data.current_cost_price.toLocaleString()}
                  {data.current_cost_price !== data.grand_total && (
                    <span className="ml-1 text-amber-400">（差分あり）</span>
                  )}
                </p>
              )}
            </div>
          </div>

          {selectedWorkOrderId && savedCostHeader && !savedCostHeader.has_saved_cost && (
            <div className="bg-amber-900/30 border border-amber-500/40 rounded-2xl p-5 text-amber-200">
              <p className="font-bold mb-1">このD指令は原価が未保存です</p>
              <p className="text-sm text-amber-100/90">
                D指令原価計算画面で計算・保存すると、この画面に反映されます。
              </p>
              <Link
                href={`/work-orders/cost?work_order_id=${encodeURIComponent(selectedWorkOrderId)}`}
                className="inline-block mt-3 px-4 py-2 rounded-lg bg-amber-700/60 hover:bg-amber-600/70 text-sm font-semibold text-white transition"
              >
                D指令原価計算へ →
              </Link>
            </div>
          )}

          {selectedWorkOrderId && savedCostHeader?.has_saved_cost && savedCostHeader.cost_saved_at && (
            <p className="text-xs text-slate-500 px-1">
              保存日時: {new Date(savedCostHeader.cost_saved_at).toLocaleString('ja-JP')}
            </p>
          )}

          {/* 製作原価合計（製作数 × 1台原価） */}
          {selectedWorkOrderId && workOrderQty > 1 && data && (
            <div className="bg-gradient-to-r from-amber-950/60 to-yellow-950/60 border-2 border-yellow-600/40 rounded-2xl p-4">
              <div className="flex flex-wrap items-center gap-4">
                <div className="text-sm font-bold text-yellow-400 whitespace-nowrap">
                  製作原価合計
                </div>
                <div className="flex flex-wrap gap-5 text-sm items-center">
                  <span className="text-slate-400">製作数: <span className="text-yellow-300 font-bold">{workOrderQty} 台</span></span>
                  <span className="text-slate-500">←</span>
                  <span className="text-slate-400">材料費: <span className="text-sky-300 font-bold">¥{(totalMaterial * workOrderQty).toLocaleString()}</span></span>
                  <span className="text-slate-400">工賃: <span className="text-emerald-300 font-bold">¥{(totalLabor * workOrderQty).toLocaleString()}</span></span>
                  <span className="text-slate-400">間接費: <span className="text-violet-300 font-bold">¥{(totalIndirect * workOrderQty).toLocaleString()}</span></span>
                  <span className="text-slate-400 font-bold">=</span>
                  <span className="text-slate-400">合計: <span className="text-2xl text-yellow-300 font-extrabold">¥{(data.grand_total * workOrderQty).toLocaleString()}</span></span>
                </div>
              </div>
            </div>
          )}

          {/* BOM が空の場合 */}
          {data.sections.length === 0 && (
            <div className="bg-amber-900/30 border border-amber-500/40 rounded-2xl p-6 text-amber-300 text-center">
              {selectedWorkOrderId && savedCostHeader && !savedCostHeader.has_saved_cost ? (
                <>
                  <p className="font-bold">保存済みの原価明細がありません</p>
                  <p className="text-sm mt-1">D指令原価計算で保存してください。</p>
                </>
              ) : (
                <>
                  <p className="font-bold">{data.model} の保存明細がありません</p>
                  <p className="text-sm mt-1">
                    枝番が未登録の場合は BOM 同期後、D指令原価計算で保存してください。
                  </p>
                </>
              )}
            </div>
          )}

          {/* セクション別明細テーブル */}
          {data.sections.length > 0 && (
            <div className="bg-slate-900/80 border-2 border-slate-700 rounded-3xl overflow-hidden">
              {/* テーブルヘッダ */}
              <div className="sticky top-0 z-10 bg-slate-800 border-b-2 border-slate-700">
                <table className="min-w-full table-fixed text-xs">
                  <thead>
                    <tr>
                      <th className="w-8 px-3 py-3 text-left text-slate-400"></th>
                      <th className="w-[130px] px-3 py-3 text-left font-bold text-slate-300">品番</th>
                      <th className="w-[320px] px-3 py-3 text-left font-bold text-slate-300">部品名 / 規格</th>
                      <th className="w-[90px] px-2 py-3 text-right font-bold text-slate-300">数量</th>
                      <th className="w-[110px] px-2 py-3 text-right font-bold text-slate-300">単価</th>
                      <th className="w-[110px] px-2 py-3 text-right font-bold text-slate-300">材料費</th>
                      <th className="w-[110px] px-2 py-3 text-right font-bold text-slate-300">工賃</th>
                      <th className="w-[90px] px-2 py-3 text-center font-bold text-slate-300">区分</th>
                      <th className="w-[110px] px-2 py-3 text-right font-bold text-slate-300">間接費</th>
                      <th className="w-[130px] px-2 py-3 text-right font-bold text-slate-300 bg-slate-700">行合計</th>
                    </tr>
                  </thead>
                </table>
              </div>

              {/* セクション毎の行群 */}
              <div className="divide-y divide-slate-700/50">
                {data.sections.map((section) => {
                  const isExpanded = expandedSections.has(section.part_key)
                  const breakdown = sectionBreakdown(section)
                  return (
                    <div key={section.part_key}>
                      {/* ─── セクションヘッダ行（パーツ名 + BOM 数量） ─── */}
                      <button
                        type="button"
                        onClick={() => toggleSection(section.part_key)}
                        className="w-full text-left bg-slate-800/80 hover:bg-slate-700/80 transition"
                      >
                        <table className="min-w-full table-fixed text-xs">
                          <tbody>
                            <tr>
                              <td className="w-8 px-3 py-3 text-slate-400 text-center">
                                {isExpanded ? '▾' : '▸'}
                              </td>
                              <td className="w-[130px] px-3 py-3 font-bold text-cyan-300">
                                {section.part_key}
                              </td>
                              <td className="w-[320px] px-3 py-3 text-slate-200 font-semibold">
                                {section.part_name ?? '（名称未設定）'}
                              </td>
                              <td className="w-[90px] px-2 py-3 text-right text-slate-300">
                                × {section.bom_quantity}
                              </td>
                              <td className="w-[110px] px-2 py-3 text-right text-slate-300">
                                ¥{section.unit_cost.toLocaleString()}
                              </td>
                              <td className="w-[110px] px-2 py-3 text-right text-sky-300/90">
                                {breakdown.material > 0 ? `¥${breakdown.material.toLocaleString()}` : '—'}
                              </td>
                              <td className="w-[110px] px-2 py-3 text-right text-emerald-300/90">
                                {breakdown.labor > 0 ? `¥${breakdown.labor.toLocaleString()}` : '—'}
                              </td>
                              <td className="w-[90px] px-2 py-3 text-center text-slate-400">—</td>
                              <td className="w-[110px] px-2 py-3 text-right text-violet-300/90">
                                {breakdown.indirect > 0 ? `¥${breakdown.indirect.toLocaleString()}` : '—'}
                              </td>
                              <td className="w-[130px] px-2 py-3 text-right font-bold text-yellow-300 bg-yellow-900/20">
                                ¥{section.subtotal.toLocaleString()}
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </button>

                      {/* ─── 明細行（折りたたみ可能） ─── */}
                      {isExpanded && (
                        <table className="min-w-full table-fixed text-xs">
                          <tbody>
                            {section.cost_items.length === 0 ? (
                              <tr>
                                <td colSpan={10} className="px-10 py-3 text-slate-500 italic">
                                  保存済みの原価明細なし
                                </td>
                              </tr>
                            ) : (
                              section.cost_items.map((item, idx) => (
                                <tr
                                  key={item.id}
                                  className={`border-t border-slate-800 ${
                                    idx % 2 === 0 ? 'bg-slate-900/40' : 'bg-slate-800/20'
                                  }`}
                                >
                                  <td className="w-8 px-3 py-2 text-slate-600">└</td>
                                  <td className="w-[130px] px-3 py-2 text-slate-400 font-mono">
                                    {item.product_code || '—'}
                                  </td>
                                  <td className="w-[320px] px-3 py-2 text-slate-300">
                                    {item.part_name}
                                    {item.spec && (
                                      <span className="ml-2 text-slate-500">{item.spec}</span>
                                    )}
                                  </td>
                                  <td className="w-[90px] px-2 py-2 text-right text-slate-300">
                                    {item.quantity.toLocaleString()}
                                  </td>
                                  <td className="w-[110px] px-2 py-2 text-right text-slate-300">
                                    {item.unit_price > 0
                                      ? `¥${item.unit_price.toLocaleString()}`
                                      : '—'}
                                  </td>
                                  <td className="w-[110px] px-2 py-2 text-right text-sky-300/80">
                                    {item.material_cost > 0
                                      ? `¥${item.material_cost.toLocaleString()}`
                                      : '—'}
                                  </td>
                                  <td className="w-[110px] px-2 py-2 text-right text-emerald-300/80">
                                    {item.labor_cost > 0
                                      ? `¥${item.labor_cost.toLocaleString()}`
                                      : '—'}
                                  </td>
                                  <td className="w-[90px] px-2 py-2 text-center">
                                    <span
                                      className={`px-2 py-0.5 rounded text-xs font-bold ${
                                        item.cost_type === '加'
                                          ? 'bg-amber-800/60 text-amber-300'
                                          : 'bg-blue-800/60 text-blue-300'
                                      }`}
                                    >
                                      {item.cost_type}
                                    </span>
                                  </td>
                                  <td className="w-[110px] px-2 py-2 text-right text-violet-300/80">
                                    {item.indirect_cost > 0
                                      ? `¥${item.indirect_cost.toLocaleString()}`
                                      : '—'}
                                  </td>
                                  <td className="w-[130px] px-2 py-2 text-right font-semibold text-cyan-200 bg-slate-800/60">
                                    ¥{item.line_total.toLocaleString()}
                                  </td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      )}
                    </div>
                  )
                })}
              </div>

              {/* ─── 総合計フッタ行 ─── */}
              <div className="border-t-4 border-yellow-500/50 bg-gradient-to-r from-yellow-900/30 to-amber-900/30">
                <table className="min-w-full table-fixed text-sm">
                  <tbody>
                    <tr>
                      <td className="w-8 px-3 py-4"></td>
                      <td colSpan={3} className="w-[540px] px-3 py-4 font-extrabold text-yellow-300 text-base tracking-widest uppercase">
                        {data.model}　原価　総合計
                      </td>
                      <td className="w-[110px] px-2 py-4 text-right text-slate-500">—</td>
                      <td className="w-[110px] px-2 py-4 text-right font-bold text-sky-300">
                        ¥{totalMaterial.toLocaleString()}
                      </td>
                      <td className="w-[110px] px-2 py-4 text-right font-bold text-emerald-300">
                        ¥{totalLabor.toLocaleString()}
                      </td>
                      <td className="w-[90px] px-2 py-4 text-center font-bold text-violet-300"></td>
                      <td className="w-[110px] px-2 py-4 text-right font-bold text-violet-300">
                        ¥{totalIndirect.toLocaleString()}
                      </td>
                      <td className="w-[130px] px-2 py-4 text-right font-extrabold text-2xl text-yellow-300 bg-yellow-900/40">
                        ¥{data.grand_total.toLocaleString()}
                      </td>
                    </tr>
                    {selectedWorkOrderId && workOrderQty > 1 && (
                      <tr className="border-t-2 border-amber-500/50 bg-gradient-to-r from-amber-950/70 to-yellow-950/70">
                        <td className="w-8 px-3 py-3"></td>
                        <td colSpan={3} className="w-[540px] px-3 py-3 font-extrabold text-amber-300 text-sm tracking-widest">
                          × {workOrderQty} 台　製作原価合計
                        </td>
                        <td className="w-[110px] px-2 py-3 text-right text-slate-500">—</td>
                        <td className="w-[110px] px-2 py-3 text-right font-bold text-sky-300">
                          ¥{(totalMaterial * workOrderQty).toLocaleString()}
                        </td>
                        <td className="w-[110px] px-2 py-3 text-right font-bold text-emerald-300">
                          ¥{(totalLabor * workOrderQty).toLocaleString()}
                        </td>
                        <td className="w-[90px] px-2 py-3 text-center text-violet-300"></td>
                        <td className="w-[110px] px-2 py-3 text-right font-bold text-violet-300">
                          ¥{(totalIndirect * workOrderQty).toLocaleString()}
                        </td>
                        <td className="w-[130px] px-2 py-3 text-right font-extrabold text-2xl text-yellow-300 bg-amber-900/60">
                          ¥{(data.grand_total * workOrderQty).toLocaleString()}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ─── アクションエリア ─── */}
          <div className="flex flex-wrap items-center justify-between gap-4 bg-slate-800/60 border border-slate-600/50 rounded-2xl p-5">
            <div>
              <p className="text-sm text-slate-300 font-semibold mb-1">原価確定</p>
              <p className="text-xs text-slate-400">
                算出した総合計（¥{data.grand_total.toLocaleString()}）を確定保存します。
                {data.product_code && <span>製品原価（{data.product_code}）</span>}
                {data.product_code && selectedWorkOrderId && <span> および </span>}
                {selectedWorkOrderId && selectedWorkOrder && (
                  <span>D指令原価スナップショット（{selectedWorkOrder.order_no}）</span>
                )}
                {!data.product_code && !selectedWorkOrderId && (
                  <span className="text-amber-400">（製品コードまたはD指令を選択してください）</span>
                )}
              </p>
              {saveMessage && (
                <p
                  className={`mt-2 text-sm font-semibold ${
                    saveMessage.startsWith('エラー') ? 'text-rose-400' : 'text-emerald-400'
                  }`}
                >
                  {saveMessage}
                </p>
              )}
            </div>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => load()}
                disabled={loading}
                className="px-5 py-3 rounded-xl bg-slate-700 hover:bg-slate-600 text-slate-100 font-semibold border border-slate-500 transition disabled:opacity-50"
              >
                再集計
              </button>
              <button
                type="button"
                onClick={handleSaveCost}
                disabled={saving || !canSave}
                className="px-7 py-3 rounded-xl bg-yellow-600 hover:bg-yellow-500 text-black font-extrabold transition disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-yellow-900/40"
              >
                {saving ? '保存中…' : '原価を確定保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
