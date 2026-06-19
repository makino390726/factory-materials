'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'

type WorkOrder = {
  id: string
  order_no: string
  product_name: string | null
  model: string | null
  bom_model: string | null
  cost_mode: string | null
  qty: number | null
  standard_duration_minutes?: number
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

type Branch = {
  id: string
  branch_no: string
  part_key: string
  part_name: string | null
  product_code: string | null
  bom_quantity: number
  unit_cost: number
  subtotal: number
  synced_at: string | null
  cost_items: CostItem[]
}

type WorkOrderOption = {
  id: string
  order_no: string
  product_name: string | null
  model: string | null
  bom_model: string | null
  cost_mode: string | null
}

export default function BomCostPage() {
  const searchParams = useSearchParams()
  const initialId = searchParams.get('id') || ''

  const [workOrders, setWorkOrders] = useState<WorkOrderOption[]>([])
  const [selectedId, setSelectedId] = useState(initialId)
  const [bomModelInput, setBomModelInput] = useState('')
  const [workOrder, setWorkOrder] = useState<WorkOrder | null>(null)
  const [branches, setBranches] = useState<Branch[]>([])
  const [grandTotal, setGrandTotal] = useState(0)
  const [orderLaborCost, setOrderLaborCost] = useState(0)
  const [expandedBranch, setExpandedBranch] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isSyncing, setIsSyncing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // D指令一覧取得
  useEffect(() => {
    fetch('/api/work-orders')
      .then(r => r.json())
      .then((data: WorkOrderOption[]) => {
        setWorkOrders(Array.isArray(data) ? data : [])
      })
      .catch(() => setWorkOrders([]))
  }, [])

  // 選択D指令が変わったら BOM コスト取得
  useEffect(() => {
    if (!selectedId) {
      setWorkOrder(null)
      setBranches([])
      setGrandTotal(0)
      return
    }

    const wo = workOrders.find(w => w.id === selectedId)
    if (wo?.bom_model) setBomModelInput(wo.bom_model)

    setIsLoading(true)
    fetch(`/api/work-orders/bom-cost?work_order_id=${selectedId}`)
      .then(r => r.json())
      .then(data => {
        if (data.error) {
          setMessage({ type: 'error', text: data.error })
          return
        }
        setWorkOrder(data.work_order ?? null)
        setBranches(data.branches ?? [])
        setGrandTotal(data.grand_total ?? 0)
        setOrderLaborCost(data.order_labor_cost ?? 0)
        if (data.work_order?.bom_model) setBomModelInput(data.work_order.bom_model)
      })
      .catch(() => setMessage({ type: 'error', text: 'BOM原価の取得に失敗しました' }))
      .finally(() => setIsLoading(false))
  }, [selectedId, workOrders])

  const handleSync = async () => {
    if (!selectedId) return
    if (!bomModelInput.trim()) {
      setMessage({ type: 'error', text: 'BOMモデルを入力してください（例: DR8-008）' })
      return
    }

    setIsSyncing(true)
    setMessage(null)
    try {
      const res = await fetch('/api/work-orders/branches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          work_order_id: selectedId,
          action: 'sync',
          bom_model: bomModelInput.trim(),
        }),
      })
      const data = await res.json()
      if (!res.ok || data.error) {
        setMessage({ type: 'error', text: data.error || 'BOM同期に失敗しました' })
        return
      }
      setMessage({
        type: 'success',
        text: `BOM同期完了: ${data.branch_count}件の枝番を生成しました（合計: ¥${data.total_cost.toLocaleString()}）`,
      })
      // 再取得
      const res2 = await fetch(`/api/work-orders/bom-cost?work_order_id=${selectedId}`)
      const data2 = await res2.json()
      if (!data2.error) {
        setWorkOrder(data2.work_order ?? null)
        setBranches(data2.branches ?? [])
        setGrandTotal(data2.grand_total ?? 0)
        setOrderLaborCost(data2.order_labor_cost ?? 0)
      }
    } catch (err) {
      setMessage({ type: 'error', text: 'BOM同期中にエラーが発生しました' })
    } finally {
      setIsSyncing(false)
    }
  }

  const handleSaveSnapshot = async () => {
    if (!selectedId) return
    setIsSaving(true)
    setMessage(null)
    try {
      const res = await fetch('/api/work-orders/bom-cost', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ work_order_id: selectedId }),
      })
      const data = await res.json()
      if (!res.ok || data.error) {
        setMessage({ type: 'error', text: data.error || '保存に失敗しました' })
        return
      }
      setMessage({
        type: 'success',
        text: `原価スナップショットを保存しました（合計: ¥${data.total_cost.toLocaleString()}）`,
      })
    } catch {
      setMessage({ type: 'error', text: '保存中にエラーが発生しました' })
    } finally {
      setIsSaving(false)
    }
  }

  const handleDeleteBranch = async (branchId: string) => {
    if (!confirm('この枝番を削除しますか？')) return
    const res = await fetch('/api/work-orders/branches', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        work_order_id: selectedId,
        action: 'delete_branch',
        branch_id: branchId,
      }),
    })
    if (res.ok) {
      setBranches(prev => prev.filter(b => b.id !== branchId))
      setGrandTotal(prev => {
        const removed = branches.find(b => b.id === branchId)
        return prev - (removed?.subtotal ?? 0)
      })
    }
  }

  const costItemSum = (items: CostItem[], key: keyof CostItem) =>
    items.reduce((s, it) => s + (Number(it[key]) || 0), 0)

  const buildDisplayName = (branch: Branch) => {
    const orderNo = workOrder?.order_no || '-'
    const branchNo = branch.branch_no || '-'
    const partName = branch.part_name || '部品名未設定'
    return `${orderNo}-${branchNo}-${partName}`
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-violet-950 to-slate-950 p-8">
      <div className="max-w-5xl mx-auto">
        {/* ヘッダー */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <p className="text-violet-200 text-sm uppercase tracking-[0.3em]">Work Order BOM Cost</p>
            <h1 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-violet-300 via-purple-300 to-pink-300">
              BOM集計原価
            </h1>
          </div>
          <div className="flex gap-3">
            <Link href="/work-orders">
              <button className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white text-sm font-medium rounded-lg transition border border-slate-600">
                ← D指令一覧
              </button>
            </Link>
            <Link href="/">
              <button className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white text-sm font-medium rounded-lg transition border border-slate-600">
                ホーム
              </button>
            </Link>
          </div>
        </div>

        {/* メッセージ */}
        {message && (
          <div className={`mb-4 p-4 rounded-lg text-sm font-medium ${
            message.type === 'success'
              ? 'bg-emerald-50 border border-emerald-200 text-emerald-800'
              : 'bg-rose-50 border border-rose-200 text-rose-700'
          }`}>
            {message.text}
          </div>
        )}

        {/* D指令選択 + BOM同期 */}
        <div className="bg-white/95 rounded-2xl shadow-xl border border-violet-100 p-6 mb-6">
          <h2 className="text-lg font-semibold text-slate-900 mb-4">D指令選択 / BOM同期</h2>
          <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-4 items-end">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">D指令</label>
              <select
                value={selectedId}
                onChange={e => setSelectedId(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500 text-sm"
              >
                <option value="">─ 選択してください ─</option>
                {workOrders.map(wo => (
                  <option key={wo.id} value={wo.id}>
                    {wo.order_no}{wo.product_name ? ` │ ${wo.product_name}` : ''}
                    {wo.cost_mode === 'bom' ? ' [BOM]' : ''}
                    {wo.bom_model ? ` (${wo.bom_model})` : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {selectedId && (
            <div className="mt-4 pt-4 border-t border-slate-200">
              <p className="text-sm font-medium text-slate-700 mb-2">BOMモデルを指定して枝番同期</p>
              <div className="flex gap-3 items-center">
                <input
                  type="text"
                  value={bomModelInput}
                  onChange={e => setBomModelInput(e.target.value)}
                  placeholder="例: DR8-008"
                  className="flex-1 px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500 text-sm"
                />
                <button
                  onClick={handleSync}
                  disabled={isSyncing || !bomModelInput.trim()}
                  className="px-5 py-2 bg-violet-600 hover:bg-violet-500 disabled:bg-violet-300 text-white text-sm font-medium rounded-lg transition"
                >
                  {isSyncing ? '同期中...' : '🔄 BOM同期'}
                </button>
              </div>
              <p className="mt-2 text-xs text-slate-500">
                ※ 同期するとheater_bomのパーツ構成とheater_parts_masterの現在原価で枝番を再生成します
              </p>
            </div>
          )}
        </div>

        {/* D指令情報 */}
        {workOrder && (
          <div className="bg-white/95 rounded-2xl shadow-xl border border-violet-100 p-6 mb-6">
            <div className="flex items-center justify-between">
              <div className="flex flex-wrap gap-4 text-sm">
                <div>
                  <span className="text-slate-500">D指令番号:</span>{' '}
                  <span className="font-semibold text-slate-900">{workOrder.order_no}</span>
                </div>
                {workOrder.product_name && (
                  <div>
                    <span className="text-slate-500">製品名:</span>{' '}
                    <span className="text-slate-800">{workOrder.product_name}</span>
                  </div>
                )}
                {workOrder.model && (
                  <div>
                    <span className="text-slate-500">型式:</span>{' '}
                    <span className="text-slate-800">{workOrder.model}</span>
                  </div>
                )}
                {workOrder.bom_model && (
                  <div>
                    <span className="text-slate-500">BOMモデル:</span>{' '}
                    <span className="font-medium text-violet-700">{workOrder.bom_model}</span>
                  </div>
                )}
                {workOrder.qty && (
                  <div>
                    <span className="text-slate-500">数量:</span>{' '}
                    <span className="text-slate-800">{workOrder.qty}</span>
                  </div>
                )}
                <div>
                  <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                    workOrder.cost_mode === 'bom'
                      ? 'bg-violet-100 text-violet-700'
                      : 'bg-slate-100 text-slate-600'
                  }`}>
                    {workOrder.cost_mode === 'bom' ? 'BOM集計モード' : '直接入力モード'}
                  </span>
                </div>
              </div>
              <button
                onClick={handleSaveSnapshot}
                disabled={isSaving || branches.length === 0}
                className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-300 text-white text-sm font-medium rounded-lg transition"
              >
                {isSaving ? '保存中...' : '💾 原価スナップショット保存'}
              </button>
            </div>
          </div>
        )}

        {/* 枝番テーブル */}
        {isLoading ? (
          <div className="text-center text-violet-200 py-12">読み込み中...</div>
        ) : branches.length > 0 ? (
          <div className="bg-white/95 rounded-2xl shadow-xl border border-violet-100 overflow-hidden mb-6">
            <div className="p-4 bg-violet-50 border-b border-violet-100 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-900">
                枝番一覧 <span className="text-sm font-normal text-slate-500">({branches.length}件)</span>
              </h2>
              <div className="text-sm font-medium text-slate-600">
                合計:{' '}
                <span className="text-lg font-bold text-violet-700">¥{grandTotal.toLocaleString()}</span>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-left text-slate-500 text-xs">
                  <tr>
                    <th className="px-4 py-3 w-8"></th>
                    <th className="px-4 py-3">表示名</th>
                    <th className="px-4 py-3">枝番</th>
                    <th className="px-4 py-3">部品KEY</th>
                    <th className="px-4 py-3">部品名</th>
                    <th className="px-4 py-3 text-right">BOM数量</th>
                    <th className="px-4 py-3 text-right">単位原価</th>
                    <th className="px-4 py-3 text-right">小計</th>
                    <th className="px-4 py-3 text-right">明細</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {branches.map((branch, idx) => (
                    <>
                      <tr
                        key={branch.id}
                        className={`border-t border-slate-100 ${
                          idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'
                        }`}
                      >
                        <td className="px-4 py-3 text-center">
                          <button
                            onClick={() =>
                              setExpandedBranch(expandedBranch === branch.id ? null : branch.id)
                            }
                            className="text-slate-400 hover:text-violet-600 transition text-lg leading-none"
                            title="明細を開く"
                          >
                            {expandedBranch === branch.id ? '▼' : '▶'}
                          </button>
                        </td>
                        <td className="px-4 py-3 text-xs font-semibold text-slate-700">
                          {buildDisplayName(branch)}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs font-bold text-violet-700">
                          {branch.branch_no}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-slate-600">
                          {branch.part_key}
                        </td>
                        <td className="px-4 py-3 text-slate-800">
                          {branch.part_name || '-'}
                          {branch.product_code && (
                            <span className="ml-1 text-xs text-slate-400">({branch.product_code})</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right text-slate-700">
                          {branch.bom_quantity.toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-right text-slate-700">
                          ¥{branch.unit_cost.toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-right font-semibold text-slate-900">
                          ¥{branch.subtotal.toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {branch.cost_items.length > 0 ? (
                            <span className="text-xs text-slate-500">{branch.cost_items.length}件</span>
                          ) : (
                            <span className="text-xs text-slate-400">なし</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <button
                            onClick={() => handleDeleteBranch(branch.id)}
                            className="text-xs px-2 py-1 rounded bg-rose-100 text-rose-600 hover:bg-rose-200 transition"
                          >
                            削除
                          </button>
                        </td>
                      </tr>

                      {/* 明細展開行 */}
                      {expandedBranch === branch.id && (
                        <tr key={`${branch.id}-detail`} className="bg-violet-50/50">
                          <td colSpan={10} className="px-8 py-4">
                            <p className="text-xs font-semibold text-violet-700 mb-2">
                              L指令原価明細（part_key: {branch.part_key}）
                            </p>
                            {branch.cost_items.length === 0 ? (
                              <p className="text-xs text-slate-400">
                                L指令原価明細がありません。
                                <Link href="/line-costs" className="ml-2 text-violet-600 underline hover:text-violet-800">
                                  L指令原価ページで入力
                                </Link>
                              </p>
                            ) : (
                              <table className="min-w-full text-xs border border-slate-200 rounded-lg overflow-hidden">
                                <thead className="bg-white text-slate-500">
                                  <tr>
                                    <th className="px-3 py-2 text-left">品番</th>
                                    <th className="px-3 py-2 text-left">部品名</th>
                                    <th className="px-3 py-2 text-left">仕様</th>
                                    <th className="px-3 py-2 text-right">数量</th>
                                    <th className="px-3 py-2 text-right">単価</th>
                                    <th className="px-3 py-2 text-right">材料費</th>
                                    <th className="px-3 py-2 text-right">加工費</th>
                                    <th className="px-3 py-2 text-right">間接費</th>
                                    <th className="px-3 py-2 text-right">合計</th>
                                    <th className="px-3 py-2 text-center">種別</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {branch.cost_items.map((ci, ciIdx) => (
                                    <tr
                                      key={ci.id}
                                      className={ciIdx % 2 === 0 ? 'bg-white' : 'bg-slate-50'}
                                    >
                                      <td className="px-3 py-2">{ci.product_code || '-'}</td>
                                      <td className="px-3 py-2">{ci.part_name || '-'}</td>
                                      <td className="px-3 py-2">{ci.spec || '-'}</td>
                                      <td className="px-3 py-2 text-right">{ci.quantity.toLocaleString()}</td>
                                      <td className="px-3 py-2 text-right">¥{ci.unit_price.toLocaleString()}</td>
                                      <td className="px-3 py-2 text-right">¥{ci.material_cost.toLocaleString()}</td>
                                      <td className="px-3 py-2 text-right">¥{ci.labor_cost.toLocaleString()}</td>
                                      <td className="px-3 py-2 text-right">¥{ci.indirect_cost.toLocaleString()}</td>
                                      <td className="px-3 py-2 text-right font-semibold">¥{ci.line_total.toLocaleString()}</td>
                                      <td className="px-3 py-2 text-center">
                                        <span className={`px-1 py-0.5 rounded text-xs font-bold ${
                                          ci.cost_type === '直'
                                            ? 'bg-rose-100 text-rose-700'
                                            : 'bg-blue-100 text-blue-700'
                                        }`}>
                                          {ci.cost_type}
                                        </span>
                                      </td>
                                    </tr>
                                  ))}
                                  <tr className="bg-violet-50 font-semibold border-t border-violet-200">
                                    <td colSpan={5} className="px-3 py-2 text-right text-slate-600">小計</td>
                                    <td className="px-3 py-2 text-right">¥{costItemSum(branch.cost_items, 'material_cost').toLocaleString()}</td>
                                    <td className="px-3 py-2 text-right">¥{costItemSum(branch.cost_items, 'labor_cost').toLocaleString()}</td>
                                    <td className="px-3 py-2 text-right">¥{costItemSum(branch.cost_items, 'indirect_cost').toLocaleString()}</td>
                                    <td className="px-3 py-2 text-right text-violet-700">¥{costItemSum(branch.cost_items, 'line_total').toLocaleString()}</td>
                                    <td></td>
                                  </tr>
                                </tbody>
                              </table>
                            )}
                          </td>
                        </tr>
                      )}
                    </>
                  ))}

                  {/* 合計行 */}
                  <tr className="border-t-2 border-violet-300 bg-violet-50 font-bold">
                    <td colSpan={7} className="px-4 py-3 text-right text-slate-700">
                      BOM集計合計
                    </td>
                    <td className="px-4 py-3 text-right text-violet-800 text-base">
                      ¥{grandTotal.toLocaleString()}
                    </td>
                    <td colSpan={2}></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        ) : selectedId && !isLoading ? (
          <div className="bg-white/95 rounded-2xl shadow-xl border border-violet-100 p-12 text-center">
            <p className="text-slate-500 mb-4">枝番がありません。</p>
            <p className="text-sm text-slate-400">
              BOMモデルを入力して「BOM同期」を実行すると、BOM構成から枝番を自動生成します。
            </p>
          </div>
        ) : null}

        {/* 操作説明 */}
        <div className="bg-slate-800/60 rounded-xl border border-slate-700 p-5 text-xs text-slate-400 space-y-1">
          <p className="text-slate-300 font-semibold mb-2">操作フロー</p>
          <p>① D指令を選択 → ② BOMモデルを入力（例: DR8-008）→ ③「BOM同期」ボタンで枝番を自動生成</p>
          <p>④ 各枝番の▶をクリックすると、その部品のL指令原価明細を展開表示</p>
          <p>⑤ L指令原価明細がない場合は「L指令原価ページ」から各 part_key の原価を入力</p>
          <p>⑥「原価スナップショット保存」で現在の集計合計を work_order_costs テーブルに記録</p>
        </div>
      </div>
    </div>
  )
}
