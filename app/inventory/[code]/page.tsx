'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'

interface StockMovement {
  id: string
  movement: string
  qty: number
  created_at: string
  input_method?: string
  note?: string
  login_id?: string
  staff_name?: string
}

interface ProductInfo {
  product_code: string
  name: string
  stock_qty: number
  updated_at: string
}

export default function InventoryDetailPage() {
  const params = useParams()
  const productCode = decodeURIComponent(params.code as string)

  const [product, setProduct] = useState<ProductInfo | null>(null)
  const [movements, setMovements] = useState<StockMovement[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [movementStartDate, setMovementStartDate] = useState('')
  const [movementEndDate, setMovementEndDate] = useState('')
  const [filterMethod, setFilterMethod] = useState<'all' | 'batch_import'>('all')
  const [deleting, setDeleting] = useState<string | null>(null)

  // 在庫調整フォーム
  const [adjustmentType, setAdjustmentType] = useState<'IN' | 'OUT' | 'ADJUST'>('IN')
  const [adjustmentQuantity, setAdjustmentQuantity] = useState('')
  const [actualQuantity, setActualQuantity] = useState('')
  const [adjustmentNote, setAdjustmentNote] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleSubmitAdjustment = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!product) return

    const quantity = Number(adjustmentQuantity)
    if (adjustmentType !== 'ADJUST' && (!Number.isFinite(quantity) || quantity <= 0)) {
      alert('数量を0より大きい値で入力してください')
      return
    }

    if (adjustmentType === 'ADJUST') {
      const actual = Number(actualQuantity)
      if (!Number.isFinite(actual) || actual < 0) {
        alert('実在庫数を0以上の値で入力してください')
        return
      }
    }

    setSubmitting(true)
    try {
      const res = await fetch('/api/stock/movement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_code: productCode,
          type: adjustmentType,
          quantity: adjustmentType !== 'ADJUST' ? quantity : undefined,
          actual_quantity: adjustmentType === 'ADJUST' ? Number(actualQuantity) : undefined,
          input_method: 'manual',
          note: adjustmentNote || undefined,
        }),
      })

      if (!res.ok) {
        const errorData = await res.json()
        throw new Error(errorData.error || '在庫調整に失敗しました')
      }

      alert('在庫を調整しました')
      setAdjustmentQuantity('')
      setActualQuantity('')
      setAdjustmentNote('')
      setAdjustmentType('IN')
      await fetchData()
    } catch (err) {
      alert(err instanceof Error ? err.message : '在庫調整に失敗しました')
    } finally {
      setSubmitting(false)
    }
  }

  const handleDeleteMovement = async (movementId: string, movement: StockMovement) => {
    if (!window.confirm(`この履歴を削除してもよろしいですか？\n(${getMovementLabel(movement.movement)} ${movement.qty}個)`)) {
      return
    }

    setDeleting(movementId)
    try {
      const res = await fetch('/api/stock/movement', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_code: productCode,
          movement_id: movementId,
          movement_type: movement.movement,
          quantity: movement.qty,
        }),
      })

      if (!res.ok) {
        const errorData = await res.json()
        throw new Error(errorData.error || '削除に失敗しました')
      }

      alert('履歴を削除しました')
      await fetchData()
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : '不明なエラー'
      alert(`エラー: ${errorMsg}`)
      console.error('削除エラー:', err)
    } finally {
      setDeleting(null)
    }
  }

  useEffect(() => {
    fetchData()
  }, [productCode])

  const fetchData = async () => {
    try {
      setLoading(true)
      
      // 製品情報と在庫情報を取得
      const productRes = await fetch(`/api/stock/product?code=${encodeURIComponent(productCode)}`)
      const productData = await productRes.json()
      
      if (productData.success && productData.data) {
        setProduct({
          product_code: productData.data.product_code,
          name: productData.data.name,
          stock_qty: productData.stock?.stock_qty || 0,
          updated_at: productData.stock?.updated_at || new Date().toISOString(),
        })
      } else {
        setError('製品情報が見つかりません')
      }

      // 入出庫履歴を取得
      const historyRes = await fetch(`/api/stock/history?code=${encodeURIComponent(productCode)}&limit=100`)
      const historyData = await historyRes.json()
      
      if (historyData.success) {
        setMovements(historyData.data || [])
      }
    } catch (err) {
      setError('データ取得エラー')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-950 via-purple-950 to-slate-950 flex items-center justify-center">
        <div className="text-gray-400">読み込み中...</div>
      </div>
    )
  }

  if (error || !product) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-950 via-purple-950 to-slate-950 p-6 relative overflow-hidden">
        {/* 背景パターン */}
        <div className="absolute inset-0 opacity-10">
          <svg className="w-full h-full" viewBox="0 0 1200 800">
            <pattern id="circuit" x="0" y="0" width="200" height="200" patternUnits="userSpaceOnUse">
              <path d="M 0 50 L 50 50 L 50 0" stroke="currentColor" strokeWidth="2" fill="none" className="text-purple-400" />
              <path d="M 150 150 L 100 150 L 100 200" stroke="currentColor" strokeWidth="2" fill="none" className="text-purple-400" />
              <circle cx="50" cy="50" r="3" fill="currentColor" className="text-purple-400" />
              <circle cx="100" cy="150" r="3" fill="currentColor" className="text-purple-400" />
            </pattern>
            <rect width="1200" height="800" fill="url(#circuit)" />
          </svg>
        </div>
        <div className="relative z-10 max-w-4xl mx-auto">
          <Link href="/inventory" className="text-purple-400 hover:text-purple-300 font-semibold mb-4 block">
            ← 一覧に戻る
          </Link>
          <div className="bg-red-900/20 border-2 border-red-400 text-red-300 p-4 rounded-lg">
            {error || '製品が見つかりません'}
          </div>
        </div>
      </div>
    )
  }

  const filteredMovements = movements.filter((movement) => {
    // フィルターメソッドを適用
    if (filterMethod === 'batch_import' && movement.input_method !== 'batch_import') {
      return false
    }
    
    // 日付範囲フィルターを適用
    if (!movementStartDate && !movementEndDate) return true
    const createdAt = new Date(movement.created_at)
    if (Number.isNaN(createdAt.getTime())) return false
    if (movementStartDate) {
      const start = new Date(`${movementStartDate}T00:00:00`)
      if (createdAt < start) return false
    }
    if (movementEndDate) {
      const end = new Date(`${movementEndDate}T23:59:59.999`)
      if (createdAt > end) return false
    }
    return true
  })

  // 月別に履歴をグループ化
  const groupedByMonth: { [key: string]: StockMovement[] } = {}
  filteredMovements.forEach(movement => {
    const date = new Date(movement.created_at)
    const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
    if (!groupedByMonth[monthKey]) {
      groupedByMonth[monthKey] = []
    }
    groupedByMonth[monthKey].push(movement)
  })

  const sortedMonths = Object.keys(groupedByMonth).sort().reverse()

  // 入力方法を日本語に変換
  const getInputMethodLabel = (method?: string) => {
    switch(method) {
      case 'receive':
        return '💼 パソコン（仕入入庫）'
      case 'shipment':
        return '💼 パソコン（出庫）'
      case 'scan':
        return '📱 スマホ（QRスキャン）'
      case 'manual':
        return '✏️ 手動入力'
      case 'count':
        return '📊 棚卸'
      case 'batch_import':
        return '📥 データ取込'
      default:
        return '📋 記録'
    }
  }

  const getMovementType = (movement: string) => movement?.toUpperCase()

  const getMovementLabel = (movement: string) => {
    const type = getMovementType(movement)
    if (type === 'IN') return '入庫'
    if (type === 'OUT') return '出庫'
    if (type === 'ADJUST') return '棚卸'
    return '移動'
  }

  const getMovementColor = (movement: string) => {
    const type = getMovementType(movement)
    if (type === 'IN') return 'bg-green-900/40 border-green-500 text-green-300'
    if (type === 'OUT') return 'bg-red-900/40 border-red-500 text-red-300'
    return 'bg-yellow-900/40 border-yellow-500 text-yellow-300'
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-purple-950 to-slate-950 relative overflow-hidden">
      {/* 背景パターン */}
      <div className="absolute inset-0 opacity-10">
        <svg className="w-full h-full" viewBox="0 0 1200 800">
          <pattern id="circuit" x="0" y="0" width="200" height="200" patternUnits="userSpaceOnUse">
            <path d="M 0 50 L 50 50 L 50 0" stroke="currentColor" strokeWidth="2" fill="none" className="text-purple-400" />
            <path d="M 150 150 L 100 150 L 100 200" stroke="currentColor" strokeWidth="2" fill="none" className="text-purple-400" />
            <circle cx="50" cy="50" r="3" fill="currentColor" className="text-purple-400" />
            <circle cx="100" cy="150" r="3" fill="currentColor" className="text-purple-400" />
          </pattern>
          <rect width="1200" height="800" fill="url(#circuit)" />
        </svg>
      </div>

      {/* ヘッダー */}
      <div className="relative z-10 border-b-2 border-purple-500 bg-purple-900/20 backdrop-blur">
        <div className="max-w-4xl mx-auto p-6">
          <Link href="/inventory" className="text-purple-400 hover:text-purple-300 font-semibold mb-3 block">
            ← 在庫管理ダッシュボードに戻る
          </Link>
          <h1 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-400 mb-2">
            {product.name}
          </h1>
          <p className="text-gray-400">製品コード: {product.product_code}</p>
        </div>
      </div>

      <div className="relative z-10 max-w-4xl mx-auto p-6 space-y-6">
        {/* 現在の在庫情報 */}
        <div className="border-2 border-purple-500 bg-purple-900/10 rounded-xl p-6 backdrop-blur">
          <h2 className="text-lg font-bold text-purple-300 mb-4">現在の在庫情報</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
            <div className="p-4 border-2 border-purple-500 rounded-lg bg-purple-900/20">
              <p className="text-sm text-gray-400">製品コード</p>
              <p className="text-2xl font-bold text-purple-300 mt-1">{product.product_code}</p>
            </div>
            <div className="p-4 border-2 rounded-lg bg-opacity-20" style={{
              borderColor: product.stock_qty === 0 ? '#ef4444' :
                          product.stock_qty <= 10 ? '#f97316' :
                          '#22c55e',
              backgroundColor: product.stock_qty === 0 ? 'rgba(239, 68, 68, 0.2)' :
                              product.stock_qty <= 10 ? 'rgba(249, 115, 22, 0.2)' :
                              'rgba(34, 197, 94, 0.2)'
            }}>
              <p className="text-sm text-gray-400">現在庫</p>
              <p className={`text-3xl font-bold mt-1 ${
                product.stock_qty === 0 ? 'text-red-300' :
                product.stock_qty <= 10 ? 'text-orange-300' :
                'text-green-300'
              }`}>
                {product.stock_qty}
              </p>
            </div>
            <div className="p-4 border-2 border-cyan-500 rounded-lg bg-cyan-900/20">
              <p className="text-sm text-gray-400">取込日</p>
              <p className="text-sm text-cyan-300 mt-2">
                {new Date(product.updated_at).toLocaleString('ja-JP', {
                  month: '2-digit',
                  day: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit'
                })}
              </p>
            </div>
          </div>
        </div>

        {/* 在庫調整フォーム */}
        <div className="border-2 border-yellow-500 bg-yellow-900/10 rounded-xl p-6 backdrop-blur">
          <h2 className="text-lg font-bold text-yellow-300 mb-4">在庫調整（不一致時調整）</h2>
          <form onSubmit={handleSubmitAdjustment} className="space-y-4">
            <div>
              <p className="text-sm font-semibold text-yellow-300 mb-3">調整種別</p>
              <div className="flex flex-wrap gap-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="adjustmentType"
                    value="IN"
                    checked={adjustmentType === 'IN'}
                    onChange={() => setAdjustmentType('IN')}
                    className="w-4 h-4 cursor-pointer"
                  />
                  <span className="text-green-300 font-semibold">📦 入庫</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="adjustmentType"
                    value="OUT"
                    checked={adjustmentType === 'OUT'}
                    onChange={() => setAdjustmentType('OUT')}
                    className="w-4 h-4 cursor-pointer"
                  />
                  <span className="text-red-300 font-semibold">📤 出庫</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="adjustmentType"
                    value="ADJUST"
                    checked={adjustmentType === 'ADJUST'}
                    onChange={() => setAdjustmentType('ADJUST')}
                    className="w-4 h-4 cursor-pointer"
                  />
                  <span className="text-yellow-300 font-semibold">📊 棚卸</span>
                </label>
              </div>
            </div>

            {adjustmentType !== 'ADJUST' && (
              <div>
                <label className="block text-sm font-semibold text-yellow-300 mb-2">
                  {adjustmentType === 'IN' ? '入庫数量' : '出庫数量'} *
                </label>
                <input
                  type="number"
                  min="1"
                  value={adjustmentQuantity}
                  onChange={(e) => setAdjustmentQuantity(e.target.value)}
                  className="w-full px-4 py-2 bg-slate-800 border-2 border-yellow-400/30 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-yellow-400"
                  placeholder="例: 10"
                  required
                />
              </div>
            )}

            {adjustmentType === 'ADJUST' && (
              <div>
                <label className="block text-sm font-semibold text-yellow-300 mb-2">
                  実在庫数（棚卸数） *
                </label>
                <div className="flex gap-2 items-end mb-2">
                  <div className="flex-1">
                    <input
                      type="number"
                      min="0"
                      value={actualQuantity}
                      onChange={(e) => setActualQuantity(e.target.value)}
                      className="w-full px-4 py-2 bg-slate-800 border-2 border-yellow-400/30 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-yellow-400"
                      placeholder="例: 5"
                      required
                    />
                  </div>
                  {actualQuantity !== '' && (
                    <div className="px-4 py-2 bg-slate-700 rounded-lg text-sm text-yellow-300 font-semibold">
                      差分: {Math.abs(Number(actualQuantity) - product.stock_qty)} 個
                      {Number(actualQuantity) > product.stock_qty
                        ? ' (増)'
                        : Number(actualQuantity) < product.stock_qty
                          ? ' (減)'
                          : ''}
                    </div>
                  )}
                </div>
                <p className="text-xs text-slate-400">現在庫: {product.stock_qty} 個</p>
              </div>
            )}

            <div>
              <label className="block text-sm font-semibold text-yellow-300 mb-2">理由・備考</label>
              <textarea
                value={adjustmentNote}
                onChange={(e) => setAdjustmentNote(e.target.value)}
                className="w-full px-4 py-2 bg-slate-800 border-2 border-yellow-400/30 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-yellow-400 resize-none"
                placeholder="例: 棚卸で数量不一致のため調整"
                rows={2}
              />
            </div>

            <div className="flex gap-3 pt-2">
              <button
                type="submit"
                disabled={submitting}
                className="flex-1 px-6 py-3 bg-gradient-to-r from-yellow-500 to-orange-500 hover:from-yellow-600 hover:to-orange-600 disabled:from-slate-600 disabled:to-slate-700 text-white font-bold rounded-lg transition-all"
              >
                {submitting ? '調整中...' : '✅ 在庫調整を確定'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setAdjustmentQuantity('')
                  setActualQuantity('')
                  setAdjustmentNote('')
                  setAdjustmentType('IN')
                }}
                className="px-6 py-3 bg-slate-700 hover:bg-slate-600 text-gray-300 font-semibold rounded-lg transition-all"
              >
                クリア
              </button>
            </div>
          </form>
        </div>

        {/* 入出庫履歴 */}
        <div className="border-2 border-purple-500 bg-purple-900/10 rounded-xl p-6 backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
            <h2 className="text-lg font-bold text-purple-300">入出庫記録</h2>
            
            {/* フィルタータブ */}
            <div className="flex gap-2">
              <button
                onClick={() => setFilterMethod('all')}
                className={`px-4 py-2 rounded-lg font-semibold transition ${
                  filterMethod === 'all'
                    ? 'bg-purple-600 text-white border-2 border-purple-400'
                    : 'bg-slate-800/50 text-gray-300 border-2 border-slate-600 hover:border-purple-400'
                }`}
              >
                すべて
              </button>
              <button
                onClick={() => setFilterMethod('batch_import')}
                className={`px-4 py-2 rounded-lg font-semibold transition ${
                  filterMethod === 'batch_import'
                    ? 'bg-blue-600 text-white border-2 border-blue-400'
                    : 'bg-slate-800/50 text-gray-300 border-2 border-slate-600 hover:border-blue-400'
                }`}
              >
                📥 データ取込
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">移動日（開始）</label>
                <input
                  type="date"
                  value={movementStartDate}
                  onChange={(e) => setMovementStartDate(e.target.value)}
                  className="px-3 py-2 bg-slate-800 border-2 border-purple-400 rounded-lg text-white text-sm focus:outline-none focus:border-purple-300 focus:shadow-[0_0_10px_rgba(168,85,247,0.5)]"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">移動日（終了）</label>
                <input
                  type="date"
                  value={movementEndDate}
                  onChange={(e) => setMovementEndDate(e.target.value)}
                  className="px-3 py-2 bg-slate-800 border-2 border-purple-400 rounded-lg text-white text-sm focus:outline-none focus:border-purple-300 focus:shadow-[0_0_10px_rgba(168,85,247,0.5)]"
                />
              </div>
              <button
                onClick={() => {
                  setMovementStartDate('')
                  setMovementEndDate('')
                }}
                className="px-3 py-2 border-2 border-slate-600 text-slate-300 rounded-lg text-sm font-semibold hover:border-slate-400 hover:text-slate-100 transition"
              >
                クリア
              </button>
              <button
                onClick={fetchData}
                className="text-sm text-purple-400 hover:text-purple-300 font-semibold hover:shadow-[0_0_10px_rgba(168,85,247,0.5)] transition"
              >
                🔄 更新
              </button>
            </div>
          </div>

          {filteredMovements.length === 0 ? (
            <p className="text-gray-500 text-center py-8">入出庫記録がありません</p>
          ) : (
            <div className="space-y-8">
              {sortedMonths.map(monthKey => (
                <div key={monthKey}>
                  <h3 className="text-base font-bold text-purple-300 mb-4 pb-2 border-b border-purple-500">
                    {monthKey}年{monthKey.split('-')[1]}月
                  </h3>
                  
                  <div className="space-y-3">
                    {groupedByMonth[monthKey].map(movement => (
                      <div
                        key={movement.id}
                        className="flex items-center justify-between p-4 bg-slate-800/50 border-2 border-purple-900/30 rounded-lg hover:border-purple-500 hover:bg-slate-800/80 transition"
                      >
                        <div className="flex items-center gap-4 flex-1">
                          {/* 入力方法 */}
                          <span className="px-3 py-1 rounded-full bg-slate-700/60 border border-slate-600 text-slate-300 text-xs font-semibold min-w-fit whitespace-nowrap">
                            {getInputMethodLabel(movement.input_method)}
                          </span>

                          {/* 移動タイプバッジ */}
                          <span
                            className={`px-3 py-1 rounded-full text-white text-sm font-semibold min-w-fit border-2 ${getMovementColor(movement.movement)}`}
                          >
                            {getMovementLabel(movement.movement)}
                          </span>

                          {/* 数量 */}
                          <div>
                            <span className="text-lg font-bold text-purple-300">
                              {getMovementType(movement.movement) === 'OUT' ? '-' : getMovementType(movement.movement) === 'IN' ? '+' : ''}{movement.qty}
                            </span>
                            <span className="text-sm text-gray-500 ml-2">個</span>
                            <p className="text-sm text-cyan-200 mt-1">
                              移動理由: {movement.note?.trim() ? movement.note : '—'}
                            </p>
                            {movement.staff_name && (
                              <p className="text-sm text-amber-200 mt-1">
                                操作者: {movement.staff_name}
                                {movement.login_id && ` (${movement.login_id})`}
                              </p>
                            )}
                          </div>
                        </div>

                        {/* 時刻 */}
                        <div className="text-right">
                          <p className="text-sm font-semibold text-gray-300">
                            {new Date(movement.created_at).toLocaleString('ja-JP', {
                              hour: '2-digit',
                              minute: '2-digit'
                            })}
                          </p>
                          <p className="text-sm text-cyan-200">
                            移動日: {new Date(movement.created_at).toLocaleString('ja-JP', {
                              year: 'numeric',
                              month: '2-digit',
                              day: '2-digit'
                            })}
                          </p>
                        </div>

                        {/* 削除ボタン */}
                        <button
                          onClick={() => handleDeleteMovement(movement.id, movement)}
                          disabled={deleting === movement.id}
                          className="ml-4 px-3 py-2 bg-red-900/50 hover:bg-red-800 disabled:bg-gray-600 disabled:cursor-not-allowed text-red-300 hover:text-red-200 rounded-lg text-xs font-semibold transition border border-red-500"
                          title="この履歴を削除する"
                        >
                          {deleting === movement.id ? '削除中...' : '🗑️ 削除'}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 操作ボタン */}
        <div className="flex gap-4">
          <Link
            href={`/stock/scan?code=${encodeURIComponent(product.product_code)}`}
            className="px-6 py-3 border-2 border-cyan-400 text-cyan-400 rounded-lg font-semibold hover:bg-cyan-900/30 hover:shadow-[0_0_15px_rgba(34,211,238,0.5)] transition"
          >
            📱 スキャン画面で操作
          </Link>
          <Link
            href="/inventory"
            className="px-6 py-3 border-2 border-purple-400 text-purple-400 rounded-lg font-semibold hover:bg-purple-900/30 hover:shadow-[0_0_15px_rgba(168,85,247,0.5)] transition"
          >
            ← 一覧に戻る
          </Link>
        </div>
      </div>
    </div>
  )
}
