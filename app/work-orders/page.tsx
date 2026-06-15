'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { buildProcessManagementPath } from '@/lib/process-management'

type WorkOrder = {
  id: string
  order_no: string
  product_name: string | null
  model: string | null
  work_content: string | null
  qty: number | null
  status: string | null
  completed: boolean | null
  completed_date: string | null
  standard_duration_minutes: number | null
  cost_mode: 'direct' | 'bom' | null
  bom_model: string | null
}

type BranchRow = {
  id?: string
  branch_no: string
  part_key: string
  part_name: string
  bom_quantity: string
}

const STATUS_OPTIONS = ['未開始', '進行中', '完了', '保留', 'その他']
const formFieldClass = 'w-full px-4 py-2 border border-slate-300 rounded-lg bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500'
const formFieldVioletClass = 'w-full px-4 py-2 border border-violet-300 rounded-lg bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-500'
const searchFieldClass = 'w-full px-3 py-2 border border-slate-300 rounded-lg bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500'
const NO_KEY_PREFIX = '__NO_KEY__'

export default function WorkOrdersPage() {
  const searchParams = useSearchParams()
  const [orders, setOrders] = useState<WorkOrder[]>([])
  const [costDoneIds, setCostDoneIds] = useState<Set<string>>(new Set())
  const [isLoading, setIsLoading] = useState(false)
  const [isUnlockingAll, setIsUnlockingAll] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [sortColumn, setSortColumn] = useState<string>('order_no')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc')
  const [searchOrderNo, setSearchOrderNo] = useState('')
  const [searchProductName, setSearchProductName] = useState('')
  const [formData, setFormData] = useState({
    order_no: '',
    product_name: '',
    model: '',
    work_content: '',
    qty: '',
    has_bom: false,
    bom_model: '',
    status: '',
    completed: false,
    completed_date: '',
    standard_duration_minutes: '',
  })
  const [showHistoryFor, setShowHistoryFor] = useState<string | null>(null)
  const [history, setHistory] = useState<
    Array<{
      month: string
      month_label: string
      fiscal_year: number
      fiscal_year_label: string
      duration_minutes: number
      duration_hours: string
    }>
  >([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [branches, setBranches] = useState<BranchRow[]>([])
  const [isLoadingBranches, setIsLoadingBranches] = useState(false)
  const [isSavingBranches, setIsSavingBranches] = useState(false)
  const isCreating = !editingId

  const createBranchRow = (index?: number): BranchRow => ({
    branch_no: `B${String((index ?? branches.length) + 1).padStart(2, '0')}`,
    part_key: '',
    part_name: '',
    bom_quantity: '1',
  })

  const fetchOrderHistory = async (orderNo: string) => {
    setHistoryLoading(true)
    try {
      const response = await fetch(
        `/api/work-reports/aggregations/monthly?category=instruction&code=${encodeURIComponent(orderNo)}`
      )
      if (!response.ok) throw new Error('履歴取得に失敗しました')
      const data = await response.json()
      setHistory(data || [])
    } catch (err) {
      console.error('履歴取得エラー:', err)
      setHistory([])
    } finally {
      setHistoryLoading(false)
    }
  }

  const handleShowHistory = (orderNo: string) => {
    if (showHistoryFor === orderNo) {
      setShowHistoryFor(null)
    } else {
      setShowHistoryFor(orderNo)
      fetchOrderHistory(orderNo)
    }
  }

  const fetchBranches = async (workOrderId: string) => {
    setIsLoadingBranches(true)
    try {
      const response = await fetch(`/api/work-orders/branches?work_order_id=${encodeURIComponent(workOrderId)}`)
      const result = await response.json()
      if (!response.ok) {
        throw new Error(result?.error || '枝番取得に失敗しました')
      }

      const mapped = (result.branches || []).map((branch: any, index: number) => ({
        id: branch.id,
        branch_no: branch.branch_no || `B${String(index + 1).padStart(2, '0')}`,
        part_key: String(branch.part_key || '').startsWith(NO_KEY_PREFIX) ? '' : (branch.part_key || ''),
        part_name: branch.part_name || '',
        bom_quantity: String(branch.bom_quantity ?? 1),
      }))
      setBranches(mapped)
      return mapped
    } catch (branchError) {
      setError(branchError instanceof Error ? branchError.message : 'Unknown error')
      return [] as BranchRow[]
    } finally {
      setIsLoadingBranches(false)
    }
  }

  const startEditingOrder = async (order: WorkOrder) => {
    const initialHasBom = order.cost_mode === 'bom' || Boolean(order.bom_model)

    setEditingId(order.id)
    setFormData({
      order_no: order.order_no,
      product_name: order.product_name || '',
      model: order.model || '',
      work_content: order.work_content || '',
      qty: order.qty ? String(order.qty) : '',
      has_bom: initialHasBom,
      bom_model: order.bom_model || order.order_no,
      status: order.status || '',
      completed: order.completed || false,
      completed_date: order.completed_date || '',
      standard_duration_minutes: order.standard_duration_minutes?.toString() ?? '',
    })

    // DB列未反映などで cost_mode が取得できない場合でも、枝番が存在すればBOM編集モードを復帰する
    const loadedBranches = await fetchBranches(order.id)
    if (!initialHasBom && loadedBranches.length > 0) {
      setFormData((prev) => ({
        ...prev,
        has_bom: true,
        bom_model: prev.order_no.trim() || order.order_no,
      }))
    }

    requestAnimationFrame(() => {
      const formElement = document.getElementById('work-order-form')
      if (formElement) {
        formElement.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
    })
  }

  const handleBranchChange = (index: number, key: keyof BranchRow, value: string) => {
    setBranches((prev) => prev.map((branch, currentIndex) => {
      if (currentIndex !== index) return branch
      return { ...branch, [key]: value }
    }))
  }

  const handleAddBranch = () => {
    setBranches((prev) => [...prev, createBranchRow(prev.length)])
  }

  const handleRemoveBranch = async (index: number) => {
    const target = branches[index]
    if (!target) return

    if (!target.id) {
      setBranches((prev) => prev.filter((_, currentIndex) => currentIndex !== index).map((branch, rowIndex) => ({
        ...branch,
        branch_no: `B${String(rowIndex + 1).padStart(2, '0')}`,
      })))
      return
    }

    if (!editingId) return

    try {
      const response = await fetch('/api/work-orders/branches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          work_order_id: editingId,
          action: 'delete_branch',
          branch_id: target.id,
        }),
      })
      const result = await response.json()
      if (!response.ok) {
        throw new Error(result?.error || '枝番削除に失敗しました')
      }
      await fetchBranches(editingId)
      setSuccessMessage('構成パーツを削除しました')
    } catch (branchError) {
      setError(branchError instanceof Error ? branchError.message : 'Unknown error')
    }
  }

  const persistBranches = async (workOrderId: string, rows: BranchRow[]) => {
    const normalized = rows
      .map((branch, index) => ({
        ...branch,
        branch_no: branch.branch_no || `B${String(index + 1).padStart(2, '0')}`,
        part_key: branch.part_key.trim(),
        part_name: branch.part_name.trim(),
        bom_quantity: branch.bom_quantity.trim(),
      }))
      .filter((branch) => branch.part_key || branch.part_name)

    if (normalized.length === 0) {
      return { savedCount: 0 }
    }

    const response = await fetch('/api/work-orders/branches', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        work_order_id: workOrderId,
        action: 'upsert',
        branches: normalized.map((branch, index) => ({
          id: branch.id,
          branch_no: `B${String(index + 1).padStart(2, '0')}`,
          part_key: branch.part_key || '',
          part_name: branch.part_name || null,
          product_code: null,
          bom_quantity: Number(branch.bom_quantity || 0),
          unit_cost: 0,
        })),
      }),
    })
    const result = await response.json()
    if (!response.ok) {
      throw new Error(result?.error || '構成パーツ保存に失敗しました')
    }

    return { savedCount: normalized.length }
  }

  const handleSaveBranches = async () => {
    if (!editingId) {
      setError('先に指令を登録してから構成パーツを追加してください')
      return
    }

    const hasAnyRow = branches.some((branch) => branch.part_key.trim() || branch.part_name.trim())
    if (!hasAnyRow) {
      setError('構成パーツがありません')
      return
    }

    setIsSavingBranches(true)
    setError(null)
    setSuccessMessage(null)
    try {
      const saveResult = await persistBranches(editingId, branches)
      await fetchBranches(editingId)
      setSuccessMessage(`${saveResult.savedCount}件の構成パーツを保存しました`)
    } catch (branchError) {
      setError(branchError instanceof Error ? branchError.message : 'Unknown error')
    } finally {
      setIsSavingBranches(false)
    }
  }

  const handleSyncBranchesFromBom = async () => {
    if (!editingId) {
      setError('先に指令を登録してからBOM展開してください')
      return
    }
    if (!formData.bom_model.trim()) {
      setError('BOMモデルを入力してください')
      return
    }

    setIsSavingBranches(true)
    setError(null)
    setSuccessMessage(null)
    try {
      const response = await fetch('/api/work-orders/branches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          work_order_id: editingId,
          action: 'sync',
          bom_model: formData.bom_model.trim(),
        }),
      })
      const result = await response.json()
      if (!response.ok) {
        throw new Error(result?.error || 'BOM展開に失敗しました')
      }
      await fetchBranches(editingId)
      setSuccessMessage(`${result.branch_count || 0}件の構成パーツをBOMから展開しました`)
    } catch (branchError) {
      setError(branchError instanceof Error ? branchError.message : 'Unknown error')
    } finally {
      setIsSavingBranches(false)
    }
  }

  const fetchOrders = async (filters?: { orderNo?: string; productName?: string }) => {
    setIsLoading(true)
    setError(null)
    try {
      const orderNo = (filters?.orderNo ?? searchOrderNo).trim()
      const productName = (filters?.productName ?? searchProductName).trim()
      const params = new URLSearchParams()

      if (orderNo) {
        params.set('orderNo', orderNo)
      }

      if (productName) {
        params.set('productName', productName)
      }

      const query = params.toString()
      const response = await fetch(`/api/work-orders${query ? `?${query}` : ''}`)
      if (!response.ok) throw new Error('Failed to fetch work orders')
      const data = await response.json()
      setOrders(data || [])
      // fetch cost headers to mark completed costing
      try {
        const res2 = await fetch('/api/work-order-costs/list')
        if (res2.ok) {
          const costs = await res2.json()
          const ids = new Set<string>((costs || []).map((c: any) => c.work_order_id).filter(Boolean))
          setCostDoneIds(ids)
        }
      } catch (e) {
        console.error('failed to load cost headers', e)
      }
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : 'Unknown error')
    } finally {
      setIsLoading(false)
    }
  }

  const handleSort = (column: string) => {
    if (sortColumn === column) {
      // 同じ列をクリックしたら、ソート順を反転
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      // 新しい列をクリックしたら、昇順でソート
      setSortColumn(column)
      setSortDirection('asc')
    }
  }

  const getSortedOrders = () => {
    if (!sortColumn) return orders

    const sorted = [...orders].sort((a, b) => {
      const aVal = (a as any)[sortColumn]
      const bVal = (b as any)[sortColumn]

      if (aVal === null || aVal === undefined) return 1
      if (bVal === null || bVal === undefined) return -1

      if (typeof aVal === 'string') {
        return sortDirection === 'asc'
          ? aVal.localeCompare(bVal, 'ja-JP')
          : bVal.localeCompare(aVal, 'ja-JP')
      }

      if (typeof aVal === 'number') {
        return sortDirection === 'asc' ? aVal - bVal : bVal - aVal
      }

      return 0
    })

    return sorted
  }

  useEffect(() => {
    fetchOrders()
  }, [])

  useEffect(() => {
    const editId = searchParams.get('edit')
    if (!editId || orders.length === 0) return

    const target = orders.find((order) => order.id === editId)
    if (!target) return

    void startEditingOrder(target)
  }, [orders, searchParams])

  useEffect(() => {
    if (!editingId || !formData.has_bom) {
      setBranches([])
      return
    }
    fetchBranches(editingId)
  }, [editingId, formData.has_bom])

  useEffect(() => {
    if (!formData.has_bom) return
    const nextBomModel = formData.order_no.trim()
    if (formData.bom_model === nextBomModel) return
    setFormData((prev) => ({
      ...prev,
      bom_model: prev.order_no.trim(),
    }))
  }, [formData.has_bom, formData.order_no, formData.bom_model])

  const handleSearchSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    await fetchOrders({ orderNo: searchOrderNo, productName: searchProductName })
  }

  const handleSearchReset = async () => {
    setSearchOrderNo('')
    setSearchProductName('')
    await fetchOrders({ orderNo: '', productName: '' })
  }

  const handleUnlockAll = async () => {
    if (!confirm('完了済みの指令をすべて一時編集可能に戻しますか？\n完了フラグ・完了日時を解除し、完了ステータスは未開始に戻します。')) {
      return
    }

    setIsUnlockingAll(true)
    setError(null)
    setSuccessMessage(null)
    try {
      const response = await fetch('/api/work-orders/unlock-all', {
        method: 'POST',
      })
      const result = await response.json()

      if (!response.ok) {
        throw new Error(result?.error || '一括編集可能化に失敗しました')
      }

      setSuccessMessage(
        result.updated_count > 0
          ? `${result.updated_count}件の指令を一時編集可能に戻しました`
          : '編集可能化の対象はありませんでした'
      )
      await fetchOrders()
    } catch (unlockError) {
      setError(unlockError instanceof Error ? unlockError.message : 'Unknown error')
    } finally {
      setIsUnlockingAll(false)
    }
  }

  const resetForm = () => {
    setSuccessMessage(null)
    setBranches([])
    setFormData({
      order_no: '',
      product_name: '',
      model: '',
      work_content: '',
      qty: '',
      has_bom: false,
      bom_model: '',
      status: '',
      completed: false,
      completed_date: '',
      standard_duration_minutes: '',
    })
    setEditingId(null)
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()

    if (!formData.order_no.trim()) {
      setError('作業指令番号は必須です')
      return
    }

    if (!editingId && (formData.status === '完了' || formData.completed || Boolean(formData.completed_date))) {
      setError('新規登録時点では完了は設定できません')
      return
    }

    if (formData.has_bom && !formData.order_no.trim()) {
      setError('BOM構成ありの場合、指令番号が必須です')
      return
    }

    setIsLoading(true)
    setError(null)
    setSuccessMessage(null)
    try {
      const method = editingId ? 'PUT' : 'POST'
      const response = await fetch('/api/work-orders', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingId,
          order_no: formData.order_no.trim(),
          product_name: formData.product_name.trim() || null,
          model: formData.model.trim() || null,
          work_content: formData.work_content.trim() || null,
          qty: formData.qty ? Number(formData.qty) : null,
          cost_mode: formData.has_bom ? 'bom' : 'direct',
          bom_model: formData.has_bom ? formData.order_no.trim() : null,
          status: formData.status || null,
          completed: formData.completed || null,
          completed_date: formData.completed_date || null,
          standard_duration_minutes: Number(formData.standard_duration_minutes) || 0,
        }),
      })

      if (!response.ok) {
        const result = await response.json()
        throw new Error(result?.error || '保存に失敗しました')
      }

      const savedOrder = await response.json()

      let branchSavedCount = 0
      if (formData.has_bom) {
        const workOrderId = editingId || savedOrder?.id
        if (workOrderId) {
          const result = await persistBranches(workOrderId, branches)
          branchSavedCount = result.savedCount
        }
      }

      await fetchOrders()
      if (branchSavedCount > 0) {
        setSuccessMessage(`${editingId ? '指令を更新' : '指令を登録'}し、構成パーツ${branchSavedCount}件を保存しました`)
      } else {
        setSuccessMessage(editingId ? '指令を更新しました' : '指令を登録しました')
      }
      resetForm()
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Unknown error')
    } finally {
      setIsLoading(false)
    }
  }

  const handleEdit = (order: WorkOrder) => {
    void startEditingOrder(order)
  }

  const handleDelete = async (order: WorkOrder) => {
    if (!confirm(`指令 ${order.order_no} を削除しますか？`)) return

    setIsLoading(true)
    setError(null)
    setSuccessMessage(null)
    try {
      const response = await fetch('/api/work-orders', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: order.id }),
      })

      if (!response.ok) {
        const result = await response.json()
        throw new Error(result?.error || '削除に失敗しました')
      }

      await fetchOrders()
      setSuccessMessage(`指令 ${order.order_no} を削除しました`)
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Unknown error')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-indigo-950 to-slate-950 relative overflow-hidden p-8">
      <div className="absolute inset-0 opacity-10">
        <svg className="w-full h-full" viewBox="0 0 1200 800">
          <pattern id="circuit-order" x="0" y="0" width="220" height="220" patternUnits="userSpaceOnUse">
            <path d="M 0 60 L 60 60 L 60 0" stroke="currentColor" strokeWidth="2" fill="none" className="text-indigo-400" />
            <path d="M 180 180 L 120 180 L 120 220" stroke="currentColor" strokeWidth="2" fill="none" className="text-indigo-400" />
            <circle cx="60" cy="60" r="3" fill="currentColor" className="text-indigo-400" />
            <circle cx="120" cy="180" r="3" fill="currentColor" className="text-indigo-400" />
          </pattern>
          <rect width="1200" height="800" fill="url(#circuit-order)" />
        </svg>
      </div>

      <div className="relative z-10 max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <p className="text-indigo-200 text-sm uppercase tracking-[0.3em]">Work Order Master</p>
            <h1 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-indigo-300 via-purple-300 to-pink-300">
              作業指令マスタ
            </h1>
          </div>
          <Link href="/">
            <button className="px-6 py-2 bg-gradient-to-r from-slate-700 to-slate-800 hover:from-slate-600 hover:to-slate-700 text-white font-medium rounded-lg transition-all duration-300 border border-slate-600 hover:border-slate-500">
              ← ホーム
            </button>
          </Link>
        </div>

        {error && (
          <div className="bg-rose-50 border border-rose-200 rounded-lg p-4 mb-6 text-rose-700">
            {error}
          </div>
        )}

        {successMessage && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 mb-6 text-emerald-700">
            {successMessage}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.6fr] gap-6">
          <div id="work-order-form" className="bg-white/95 rounded-2xl shadow-xl border border-indigo-100 p-6 backdrop-blur">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">
              {editingId ? '指令を編集' : '新しい指令を追加'}
            </h2>
            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">指令番号 *</label>
                <input
                  type="text"
                  value={formData.order_no}
                  onChange={(event) =>
                    setFormData({ ...formData, order_no: event.target.value })
                  }
                  placeholder="例: D-0001"
                  className={formFieldClass}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">製品名</label>
                <input
                  type="text"
                  value={formData.product_name}
                  onChange={(event) =>
                    setFormData({ ...formData, product_name: event.target.value })
                  }
                  className={formFieldClass}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">型式</label>
                <input
                  type="text"
                  value={formData.model}
                  onChange={(event) =>
                    setFormData({ ...formData, model: event.target.value })
                  }
                  className={formFieldClass}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">作業内容</label>
                <input
                  type="text"
                  value={formData.work_content}
                  onChange={(event) =>
                    setFormData({ ...formData, work_content: event.target.value })
                  }
                  className={formFieldClass}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">数量</label>
                <input
                  type="number"
                  value={formData.qty}
                  onChange={(event) =>
                    setFormData({ ...formData, qty: event.target.value })
                  }
                  className={formFieldClass}
                />
              </div>
              <div className="rounded-lg border border-violet-200 bg-violet-50/60 p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <input
                    id="has-bom"
                    type="checkbox"
                    checked={formData.has_bom}
                    onChange={(event) =>
                      setFormData({
                        ...formData,
                        has_bom: event.target.checked,
                        bom_model: event.target.checked ? formData.order_no.trim() : '',
                      })
                    }
                    className="h-4 w-4 rounded border-slate-300 text-violet-600"
                  />
                  <label htmlFor="has-bom" className="text-sm font-medium text-violet-900">
                    BOM構成あり（保存時に枝番と構成パーツを自動作成）
                  </label>
                </div>
                {formData.has_bom && (
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">BOMモデル *</label>
                    <input
                      type="text"
                      value={formData.bom_model}
                      readOnly
                      placeholder="指令番号と同じ値を自動設定"
                      className={formFieldVioletClass}
                    />
                    <p className="mt-1 text-xs text-violet-700">
                      BOM構成ありの場合、BOMモデルは指令番号と同一値で固定されます。
                    </p>
                    {editingId && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={handleSyncBranchesFromBom}
                          disabled={isSavingBranches || isLoading}
                          className="px-3 py-1 rounded-md bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium transition disabled:bg-violet-300"
                        >
                          {isSavingBranches ? '処理中...' : 'BOMから構成パーツ再読込'}
                        </button>
                        <span className="text-xs text-violet-700 self-center">
                          BOM構成を基に複数パーツを自動展開します
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>
              {formData.has_bom && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-slate-800">構成パーツ一覧</p>
                      <p className="text-xs text-slate-500">
                        指令番号に対して複数パーツを登録します。保存後は指令BOM原価に反映されます。
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={handleAddBranch}
                        className="px-3 py-1 rounded-md bg-slate-200 hover:bg-slate-300 text-slate-800 text-xs font-medium transition"
                      >
                        パーツ追加
                      </button>
                      <button
                        type="button"
                        onClick={handleSaveBranches}
                        disabled={!editingId || isSavingBranches}
                        className="px-3 py-1 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium transition disabled:bg-emerald-300"
                      >
                        {isSavingBranches ? '保存中...' : '構成パーツ保存'}
                      </button>
                    </div>
                  </div>

                  {!editingId && (
                    <div className="rounded-md bg-amber-50 border border-amber-200 p-2 text-xs text-amber-700">
                      先に指令を登録すると、この画面で複数パーツを追加・編集できます。
                    </div>
                  )}

                  {isLoadingBranches ? (
                    <div className="text-sm text-slate-500">構成パーツを読み込み中...</div>
                  ) : (
                    <div className="space-y-2">
                      {branches.length === 0 ? (
                        <div className="text-sm text-slate-500">構成パーツはまだありません。BOM展開または手動追加してください。</div>
                      ) : (
                        branches.map((branch, index) => (
                          <div key={branch.id || branch.branch_no || index} className="grid grid-cols-1 md:grid-cols-[72px_1fr_1.6fr_120px_90px] gap-2 items-center rounded-md border border-slate-200 bg-white p-2">
                            <input
                              type="text"
                              value={branch.branch_no}
                              onChange={(event) => handleBranchChange(index, 'branch_no', event.target.value)}
                              className="px-3 py-2 border border-slate-300 rounded-lg bg-white text-slate-900 text-sm"
                              placeholder="B01"
                            />
                            <input
                              type="text"
                              value={branch.part_key}
                              onChange={(event) => handleBranchChange(index, 'part_key', event.target.value)}
                              className="px-3 py-2 border border-slate-300 rounded-lg bg-white text-slate-900 text-sm"
                              placeholder="part_key"
                            />
                            <input
                              type="text"
                              value={branch.part_name}
                              onChange={(event) => handleBranchChange(index, 'part_name', event.target.value)}
                              className="px-3 py-2 border border-slate-300 rounded-lg bg-white text-slate-900 text-sm"
                              placeholder="構成パーツ名"
                            />
                            <input
                              type="number"
                              value={branch.bom_quantity}
                              onChange={(event) => handleBranchChange(index, 'bom_quantity', event.target.value)}
                              className="px-3 py-2 border border-slate-300 rounded-lg bg-white text-slate-900 text-sm"
                              placeholder="数量"
                            />
                            <button
                              type="button"
                              onClick={() => handleRemoveBranch(index)}
                              className="px-3 py-2 rounded-md bg-rose-100 hover:bg-rose-200 text-rose-700 text-xs font-medium transition"
                            >
                              削除
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">ステータス</label>
                <select
                  value={formData.status}
                  onChange={(event) =>
                    setFormData({ ...formData, status: event.target.value })
                  }
                  className={formFieldClass}
                >
                  <option value="">未指定</option>
                  {STATUS_OPTIONS.filter((opt) => !isCreating || opt !== '完了').map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              </div>
              {!isCreating && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">完了日時</label>
                  <input
                    type="datetime-local"
                    value={formData.completed_date}
                    onChange={(event) =>
                      setFormData({ ...formData, completed_date: event.target.value })
                    }
                    className={formFieldClass}
                  />
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">標準所要時間（分）</label>
                <input
                  type="number"
                  value={formData.standard_duration_minutes}
                  onChange={(event) =>
                    setFormData({ ...formData, standard_duration_minutes: event.target.value })
                  }
                  placeholder="0"
                  className={formFieldClass}
                />
              </div>
              {!isCreating && (
                <div className="flex items-center gap-2">
                  <input
                    id="completed"
                    type="checkbox"
                    checked={formData.completed}
                    onChange={(event) => {
                      const isCompleted = event.target.checked
                      setFormData({
                        ...formData,
                        completed: isCompleted,
                        // 完了をONにした場合、現在日時を自動設定
                        completed_date: isCompleted && !formData.completed_date
                          ? new Date().toISOString().slice(0, 16)
                          : formData.completed_date,
                      })
                    }}
                    className="h-4 w-4 rounded border-slate-300 text-indigo-600"
                  />
                  <label htmlFor="completed" className="text-sm text-slate-700">
                    完了
                  </label>
                </div>
              )}
              <div className="flex flex-wrap gap-3 pt-2">
                <button
                  type="submit"
                  disabled={isLoading}
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-medium rounded-lg transition disabled:bg-indigo-300"
                >
                  {editingId ? '更新' : '登録'}
                </button>
                <button
                  type="button"
                  onClick={resetForm}
                  className="px-5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded-lg transition"
                >
                  クリア
                </button>
              </div>
            </form>
          </div>

          <div className="bg-white/95 rounded-2xl shadow-xl border border-indigo-100 p-6 backdrop-blur">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-slate-900">作業指令一覧</h2>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleUnlockAll}
                  disabled={isLoading || isUnlockingAll}
                  className="px-3 py-1 text-sm bg-amber-100 hover:bg-amber-200 text-amber-800 font-medium rounded-lg transition disabled:bg-slate-200 disabled:text-slate-400"
                >
                  {isUnlockingAll ? '解除中...' : '全件を一時編集可能化'}
                </button>
                <button
                  type="button"
                  onClick={() => fetchOrders()}
                  disabled={isLoading}
                  className="px-3 py-1 text-sm bg-indigo-100 hover:bg-indigo-200 text-indigo-700 font-medium rounded-lg transition disabled:bg-slate-200 disabled:text-slate-400"
                >
                  {isLoading ? '読み込み中...' : '更新'}
                </button>
                <div className="text-sm text-slate-500">
                  {isLoading ? '読み込み中...' : `${orders.length} 件`}
                </div>
              </div>
            </div>

            <form onSubmit={handleSearchSubmit} className="mb-4 grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-3">
              <input
                type="text"
                value={searchOrderNo}
                onChange={(event) => setSearchOrderNo(event.target.value)}
                placeholder="指令番号で検索"
                className={searchFieldClass}
              />
              <input
                type="text"
                value={searchProductName}
                onChange={(event) => setSearchProductName(event.target.value)}
                placeholder="製品名で検索（あいまい）"
                className={searchFieldClass}
              />
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={isLoading}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-lg transition disabled:bg-indigo-300"
                >
                  検索
                </button>
                <button
                  type="button"
                  onClick={handleSearchReset}
                  disabled={isLoading}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium rounded-lg transition disabled:bg-slate-200 disabled:text-slate-400"
                >
                  解除
                </button>
              </div>
            </form>

            <div className="overflow-x-auto">
              <table className="min-w-full text-xs">
                <thead className="text-left text-black">
                  <tr>
                    <th 
                      className="py-2 pr-4 cursor-pointer hover:text-slate-700 transition"
                      onClick={() => handleSort('order_no')}
                    >
                      指令番号 {sortColumn === 'order_no' && (sortDirection === 'asc' ? '↑' : '↓')}
                    </th>
                    <th className="py-2 pr-4">製品名</th>
                    <th className="py-2 pr-4">型式</th>
                    <th className="py-2 pr-4">BOMモデル</th>
                    <th className="py-2 pr-4">数量</th>
                    <th className="py-2 pr-4">所要時間（分）</th>
                    <th className="py-2 pr-4">状態</th>
                    <th className="py-2 pr-4">完了日時</th>
                    <th className="py-2">操作</th>
                  </tr>
                </thead>
                <tbody className="text-black">
                  {orders.length === 0 && !isLoading ? (
                    <tr>
                      <td colSpan={9} className="py-6 text-center text-slate-400">
                        作業指令が未登録です
                      </td>
                    </tr>
                  ) : (
                    getSortedOrders().map((order) => (
                      <tr key={order.id} className="border-t border-slate-100">
                        <td className="py-3 pr-4 font-medium text-slate-900">
                          <div className="flex items-center gap-2">
                            <span>{order.order_no}</span>
                            {order.cost_mode === 'bom' && (
                              <span className="px-1.5 py-0.5 rounded text-xs font-bold bg-violet-100 text-violet-700 border border-violet-300">BOM</span>
                            )}
                            {costDoneIds.has(order.id) && (
                              <span className="text-red-600 font-bold text-sm">原価計算済</span>
                            )}
                          </div>
                        </td>
                        <td className="py-3 pr-4">{order.product_name || '-'}</td>
                        <td className="py-3 pr-4">{order.model || '-'}</td>
                        <td className="py-3 pr-4">{order.bom_model || '-'}</td>
                        <td className="py-3 pr-4">{order.qty || '-'}</td>
                        <td className="py-3 pr-4 text-right">
                          {order.standard_duration_minutes?.toLocaleString() ?? '-'}
                        </td>
                        <td className="py-3 pr-4">
                          <span className={`inline-block px-2 py-1 rounded text-xs font-medium ${
                            order.completed
                              ? 'bg-emerald-100 text-emerald-700'
                              : 'bg-amber-100 text-amber-700'
                          }`}>
                            {order.status || '未指定'}
                          </span>
                        </td>
                        <td className="py-3 pr-4 text-xs text-slate-500">
                          {order.completed_date
                            ? new Date(order.completed_date).toLocaleString('ja-JP')
                            : '-'}
                        </td>
                        <td className="py-3">
                          <div className="flex flex-nowrap gap-1 items-center">
                            <Link href={`/work-orders?edit=${order.id}#work-order-form`}>
                              <span
                                onClick={() => handleEdit(order)}
                                className="inline-block px-2 py-1 rounded-md bg-emerald-600 text-white hover:bg-emerald-700 transition text-xs cursor-pointer font-medium"
                              >
                                編集
                              </span>
                            </Link>
                            {order.cost_mode === 'bom' ? (
                              <Link href={`/work-orders/bom-cost?id=${order.id}`}>
                                <span className="px-2 py-1 rounded-md bg-violet-600 text-white hover:bg-violet-700 transition text-xs cursor-pointer font-medium">
                                  BOM
                                </span>
                              </Link>
                            ) : null}
                            <button
                              type="button"
                              onClick={() => handleShowHistory(order.order_no)}
                              className="px-2 py-1 rounded-md bg-blue-600 text-white hover:bg-blue-700 transition text-xs font-medium"
                            >
                              📄
                            </button>
                            <Link
                              href={buildProcessManagementPath('instruction', order.order_no)}
                              className="px-2 py-1 rounded-md bg-indigo-600 text-white hover:bg-indigo-700 transition text-xs font-medium whitespace-nowrap"
                            >
                              工程
                            </Link>
                            <button
                              type="button"
                              onClick={() => handleDelete(order)}
                              className="px-2 py-1 rounded-md bg-red-600 text-white hover:bg-red-700 transition text-xs font-medium"
                            >
                              削除
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* 履歴表示 */}
            {showHistoryFor && (
              <div className="mt-6 p-4 bg-indigo-50 border-2 border-indigo-200 rounded-lg">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-md font-semibold text-indigo-900">
                    📄 指令 {showHistoryFor}　月別実績
                  </h3>
                  <button
                    onClick={() => setShowHistoryFor(null)}
                    className="text-indigo-600 hover:text-indigo-900 text-xl font-bold"
                  >
                    ×
                  </button>
                </div>

                {historyLoading ? (
                  <p className="text-center text-indigo-700">...読み込み中</p>
                ) : history.length === 0 ? (
                  <p className="text-center text-indigo-600">作業日報の実績がありません</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-indigo-100 text-indigo-900">
                        <tr>
                          <th className="px-3 py-2 text-left font-semibold">月</th>
                          <th className="px-3 py-2 text-right font-semibold">実績時間</th>
                          <th className="px-3 py-2 text-right font-semibold">（分）</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-indigo-200">
                        {history.map((record) => (
                          <tr key={record.month} className="hover:bg-indigo-100">
                            <td className="px-3 py-2 text-indigo-900 whitespace-nowrap">
                              {record.month_label}
                            </td>
                            <td className="px-3 py-2 text-right text-indigo-900 font-semibold">
                              {record.duration_hours}
                            </td>
                            <td className="px-3 py-2 text-right text-indigo-700 text-xs">
                              {record.duration_minutes.toLocaleString()}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
