'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'

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

type ViewMode = 'branch' | 'flat'
type WorkOrderListFilter = 'all' | 'bom'

type BreakdownData = {
  model: string
  product_code: string | null
  current_cost_price: number | null
  grand_total: number
  sections: Section[]
}

// =============================================================
// 指令原価BOM ページ
// =============================================================
// 計算フロー:
//   指令の bom_model（または直接入力 BOM モデル）
//   → heater_bom の各 part_key の原価明細（work_order_cost_items）
//   → パーツ毎の小計（unit_cost × bom_quantity）→ 総合計
// =============================================================
export default function WorkOrderBomCostPage() {
  const searchParams = useSearchParams()

  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([])
  const [selectedWorkOrderId, setSelectedWorkOrderId] = useState<string>('')
  const [selectedWorkOrder, setSelectedWorkOrder] = useState<WorkOrder | null>(null)
  const [bomModelInput, setBomModelInput] = useState<string>('')

  const [data, setData] = useState<BreakdownData | null>(null)
  const [orderLaborCost, setOrderLaborCost] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState<string | null>(null)
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set())
  const [syncing, setSyncing] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>('branch')
  const [workOrderListFilter, setWorkOrderListFilter] = useState<WorkOrderListFilter>('bom')

  // 指令一覧を取得
  useEffect(() => {
    fetch('/api/work-orders')
      .then(r => r.json())
      .then(d => setWorkOrders(Array.isArray(d) ? d : []))
      .catch(() => {})
  }, [])

  // URL パラメータから初期指令 ID を設定
  useEffect(() => {
    const id = searchParams.get('work_order_id')
    if (id) setSelectedWorkOrderId(id)
  }, [searchParams])

  // 指令が選択されたら bom_model をセット
  useEffect(() => {
    if (!selectedWorkOrderId) {
      setSelectedWorkOrder(null)
      return
    }
    const wo = workOrders.find(w => w.id === selectedWorkOrderId) ?? null
    setSelectedWorkOrder(wo)
    if (wo?.bom_model) setBomModelInput(wo.bom_model)
  }, [selectedWorkOrderId, workOrders])

  const handleSync = async () => {
    if (!selectedWorkOrderId || !bomModelInput.trim()) {
      setError('指令とBOMモデルを選択してください')
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
    try {
      // 指令が選択されている場合は、指令マスタ（work_order_branches）ベースで集計する。
      // heater_bom はライン側用途として切り分ける。
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

        const modelName = wo?.bom_model || wo?.order_no || bomModelInput || '指令BOM'
        setData({
          model: modelName,
          product_code: null,
          current_cost_price: null,
          grand_total: Number(orderJson.grand_total || 0),
          sections,
        })
        setOrderLaborCost(Number(orderJson.order_labor_cost || 0))
        setExpandedSections(new Set(sections.map(s => s.part_key)))
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
  //   ② work_order_costs スナップショット（指令が選択されている場合）
  // =========================================================
  const handleSaveCost = async () => {
    if (!data) return

    const lines: string[] = [
      `BOMモデル: ${data.model}`,
      `算出原価: ¥${data.grand_total.toLocaleString()}`,
    ]
    if (data.product_code) lines.push(`製品コード: ${data.product_code}`)
    if (selectedWorkOrder) lines.push(`指令番号: ${selectedWorkOrder.order_no}`)
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
          results.push(`指令原価スナップショット（${selectedWorkOrder?.order_no}）`)
        }
      }

      if (results.length === 0) {
        setSaveMessage('保存先がありません（製品コードまたは指令を選択してください）')
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
  const totalMaterial =
    data?.sections.reduce(
      (sum, section) =>
        sum +
        section.cost_items.reduce((itemSum, item) => itemSum + item.material_cost, 0) *
          section.bom_quantity,
      0
    ) ?? 0
  const totalLaborItems =
    data?.sections.reduce(
      (sum, section) =>
        sum +
        section.cost_items.reduce((itemSum, item) => itemSum + item.labor_cost, 0) * section.bom_quantity,
      0
    ) ?? 0
  const totalLabor = totalLaborItems + orderLaborCost
  const totalIndirect =
    data?.sections.reduce(
      (sum, section) =>
        sum +
        section.cost_items.reduce((itemSum, item) => itemSum + item.indirect_cost, 0) *
          section.bom_quantity,
      0
    ) ?? 0
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

  const flatCostRows = useMemo(() => {
    if (!data) return []
    const orderNo = selectedWorkOrder?.order_no || data.model
    return data.sections.flatMap((section) => {
      const branchLabel = section.branch_no
        ? `${orderNo}-${section.branch_no}`
        : section.part_key
      if (section.cost_items.length === 0) {
        return [{
          key: `${section.part_key}-empty`,
          branchLabel,
          branchNo: section.branch_no,
          partKey: section.part_key,
          partName: section.part_name || '（名称未設定）',
          productCode: section.product_code || '',
          spec: '',
          quantity: section.bom_quantity,
          unitPrice: section.unit_cost,
          materialCost: 0,
          laborCost: 0,
          indirectCost: 0,
          lineTotal: section.subtotal,
          costType: '加',
          isSectionSummary: true,
        }]
      }
      return section.cost_items.map((item, idx) => ({
        key: `${section.part_key}-${item.id || idx}`,
        branchLabel,
        branchNo: section.branch_no,
        partKey: section.part_key,
        partName: item.part_name,
        productCode: item.product_code,
        spec: item.spec,
        quantity: item.quantity,
        bomQuantity: section.bom_quantity,
        unitPrice: item.unit_price,
        materialCost: Math.round(item.material_cost * section.bom_quantity),
        laborCost: Math.round(item.labor_cost * section.bom_quantity),
        indirectCost: Math.round(item.indirect_cost * section.bom_quantity),
        lineTotal: Math.round(item.line_total * section.bom_quantity),
        costType: item.cost_type,
        isSectionSummary: false,
      }))
    })
  }, [data, selectedWorkOrder])

  const sectionBreakdown = (section: Section) => {
    const bomQty = section.bom_quantity || 1
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
            <span className="text-slate-400 text-sm">指令原価計算</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold text-white">
            指令原価BOM
          </h1>
          <p className="mt-2 text-sm text-slate-400">
            指令の BOM を展開し、各パーツの原価明細を積み上げて原価を算出します
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/work-orders">
            <button className="px-5 py-2 rounded-full border border-slate-500/60 text-slate-300 hover:text-white hover:border-slate-400 transition text-sm">
              ← 指令一覧
            </button>
          </Link>
          <Link href="/">
            <button className="px-5 py-2 rounded-full border border-rose-400/40 text-rose-200 hover:border-rose-300 hover:text-white transition text-sm">
              ← ホーム
            </button>
          </Link>
        </div>
      </div>

      {/* ① 指令選択パネル */}
      <div className="max-w-screen-xl mx-auto mb-6 bg-slate-800/70 border border-slate-600/50 rounded-2xl p-5">
        <p className="text-sm font-semibold text-slate-300 mb-3">
          ① 指令を選択（または BOM モデルを直接入力）
        </p>
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <span className="text-xs text-slate-400">指令リスト:</span>
          <label className="inline-flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer">
            <input
              type="radio"
              name="workOrderListFilter"
              checked={workOrderListFilter === 'bom'}
              onChange={() => setWorkOrderListFilter('bom')}
              className="accent-violet-500"
            />
            BOM出力指令のみ
          </label>
          <label className="inline-flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer">
            <input
              type="radio"
              name="workOrderListFilter"
              checked={workOrderListFilter === 'all'}
              onChange={() => setWorkOrderListFilter('all')}
              className="accent-violet-500"
            />
            全指令
          </label>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr_auto] gap-3 items-end">
          <div>
            <label className="block text-xs text-slate-400 mb-1">指令</label>
            <select
              value={selectedWorkOrderId}
              onChange={e => setSelectedWorkOrderId(e.target.value)}
              className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-violet-500"
            >
              <option value="">─ 指令を選択 ─</option>
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

        {/* 選択中の指令情報 */}
        {selectedWorkOrder && (
          <div className="mt-3 pt-3 border-t border-slate-700 flex flex-wrap gap-4 text-xs text-slate-400">
            <span>指令: <span className="text-white font-semibold">{selectedWorkOrder.order_no}</span></span>
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

      {/* ローディング / エラー */}
      {loading && (
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

      {data && !loading && (
        <div className="max-w-screen-xl mx-auto space-y-6">

          {/* 集計対象ラベル */}
          <div className="flex flex-wrap items-center justify-between gap-3 px-1">
            <div className="flex items-center gap-3">
              <span className="text-slate-400 text-sm">集計対象:</span>
              <span className="text-lg font-bold text-violet-300">{data.model}</span>
              {selectedWorkOrder && (
                <span className="text-sm text-slate-400">（指令: {selectedWorkOrder.order_no}）</span>
              )}
            </div>
            <div className="flex items-center gap-2 print:hidden">
              <span className="text-xs text-slate-400">表示:</span>
              <button
                type="button"
                onClick={() => setViewMode('branch')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                  viewMode === 'branch'
                    ? 'bg-violet-600 text-white'
                    : 'bg-slate-800 text-slate-300 border border-slate-600 hover:border-slate-400'
                }`}
              >
                枝番別
              </button>
              <button
                type="button"
                onClick={() => setViewMode('flat')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                  viewMode === 'flat'
                    ? 'bg-violet-600 text-white'
                    : 'bg-slate-800 text-slate-300 border border-slate-600 hover:border-slate-400'
                }`}
              >
                全明細リスト
              </button>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="bg-slate-800/60 border border-slate-600/50 rounded-2xl p-4">
              <p className="text-xs text-slate-400 mb-1">材料費 合計</p>
              <p className="text-xl font-bold text-sky-300">¥{totalMaterial.toLocaleString()}</p>
            </div>
            <div className={`bg-slate-800/60 border rounded-2xl p-4 ${orderLaborCost > 0 ? 'border-emerald-500/50' : 'border-slate-600/50'}`}>
              <p className="text-xs text-slate-400 mb-1">工賃 合計（指令全体）</p>
              <p className={`text-xl font-bold ${orderLaborCost > 0 ? 'text-emerald-300' : 'text-slate-500'}`}>
                ¥{totalLabor.toLocaleString()}
              </p>
              {selectedWorkOrderId && (
                <p className="text-xs text-slate-400 mt-1">
                  指令工賃: <span className={orderLaborCost > 0 ? 'text-emerald-400 font-semibold' : 'text-slate-500'}>¥{orderLaborCost.toLocaleString()}</span>
                </p>
              )}
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
              <p className="font-bold">{data.model} の BOM が登録されていません</p>
              <p className="text-sm mt-1">
                <Link href="/heater/bom" className="underline hover:text-amber-200">BOM 管理画面</Link>
                から model={data.model} でパーツを登録してください。
              </p>
            </div>
          )}

          {/* セクション別明細テーブル */}
          {data.sections.length > 0 && viewMode === 'flat' && (
            <div className="bg-slate-900/80 border-2 border-slate-700 rounded-3xl overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-700 bg-slate-800/80">
                <h3 className="text-sm font-semibold text-slate-200">指令BOM 全明細リスト</h3>
                <p className="text-xs text-slate-400 mt-1">
                  枝番をまたいだ原価明細を1行ずつ表示します（BOM数量を反映した金額）
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-xs">
                  <thead className="bg-slate-900/90 border-b border-slate-600">
                    <tr>
                      <th className="px-3 py-2 text-left font-bold text-slate-300">枝番</th>
                      <th className="px-3 py-2 text-left font-bold text-slate-300">品番</th>
                      <th className="px-3 py-2 text-left font-bold text-slate-300">部品名 / 規格</th>
                      <th className="px-2 py-2 text-right font-bold text-slate-300">数量</th>
                      <th className="px-2 py-2 text-right font-bold text-slate-300">材料費</th>
                      <th className="px-2 py-2 text-right font-bold text-slate-300">工賃</th>
                      <th className="px-2 py-2 text-center font-bold text-slate-300">区分</th>
                      <th className="px-2 py-2 text-right font-bold text-slate-300">間接費</th>
                      <th className="px-2 py-2 text-right font-bold text-slate-300 bg-slate-700">行合計</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-700/80">
                    {flatCostRows.map((row, idx) => (
                      <tr
                        key={row.key}
                        className={idx % 2 === 0 ? 'bg-slate-900/40' : 'bg-slate-800/20'}
                      >
                        <td className="px-3 py-2 text-cyan-300 font-mono whitespace-nowrap">{row.branchLabel}</td>
                        <td className="px-3 py-2 text-slate-400 font-mono">{row.productCode || '—'}</td>
                        <td className="px-3 py-2 text-slate-300">
                          {row.partName}
                          {row.spec && <span className="ml-2 text-slate-500">{row.spec}</span>}
                        </td>
                        <td className="px-2 py-2 text-right text-slate-300">
                          {row.isSectionSummary
                            ? `× ${row.quantity}`
                            : row.quantity.toLocaleString()}
                        </td>
                        <td className="px-2 py-2 text-right text-sky-300/80">
                          {row.materialCost > 0 ? `¥${row.materialCost.toLocaleString()}` : '—'}
                        </td>
                        <td className="px-2 py-2 text-right text-emerald-300/80">
                          {row.laborCost > 0 ? `¥${row.laborCost.toLocaleString()}` : '—'}
                        </td>
                        <td className="px-2 py-2 text-center">
                          <span className="px-2 py-0.5 rounded text-xs font-bold bg-amber-800/60 text-amber-300">
                            {row.costType}
                          </span>
                        </td>
                        <td className="px-2 py-2 text-right text-violet-300/80">
                          {row.indirectCost > 0 ? `¥${row.indirectCost.toLocaleString()}` : '—'}
                        </td>
                        <td className="px-2 py-2 text-right font-semibold text-cyan-200 bg-slate-800/60">
                          ¥{row.lineTotal.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {data.sections.length > 0 && viewMode === 'branch' && (
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
                                  原価明細なし（パーツマスタの設定値を使用: ¥{section.unit_cost.toLocaleString()}）
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
                  <span>指令原価スナップショット（{selectedWorkOrder.order_no}）</span>
                )}
                {!data.product_code && !selectedWorkOrderId && (
                  <span className="text-amber-400">（製品コードまたは指令を選択してください）</span>
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
