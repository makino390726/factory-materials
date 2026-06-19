'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

interface Product {
  id: string
  product_code: string
  name: string
  barcode?: string
  purchase_price?: number
  cost_price?: number
  shelf_no?: string | null
}

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [sortBy, setSortBy] = useState<'code' | 'name' | 'price'>('code')
  const [showModal, setShowModal] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formData, setFormData] = useState({
    product_code: '',
    name: '',
    shelf_no: '',
    barcode: '',
    purchase_price: '',
    cost_price: '',
  })
  const [submitting, setSubmitting] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const itemsPerPage = 50

  // チェックボックス選択
  const [selectedCodes, setSelectedCodes] = useState<Set<string>>(new Set())
  // ラベル印刷モーダル
  const [showLabelModal, setShowLabelModal] = useState(false)
  const [labelSize, setLabelSize] = useState('40x30')
  const [labelQuantity, setLabelQuantity] = useState(1)
  const [isPrinting, setIsPrinting] = useState(false)
  const [isBulkDeleting, setIsBulkDeleting] = useState(false)
  // 全D指令・全L指令一括単価更新
  const [isBulkApplyingAll, setIsBulkApplyingAll] = useState(false)
  const [showBulkPreview, setShowBulkPreview] = useState(false)
  const [bulkPreview, setBulkPreview] = useState<{
    summary: {
      totalScanned: number
      updated: number
      skippedNoProduct: number
      skippedNoCost: number
      unchanged: number
      affectedWorkOrders: number
    }
    previewDetails: Array<{
      product_code: string
      part_name: string | null
      old_unit_price: number
      new_unit_price: number
    }>
    preview_truncated: boolean
  } | null>(null)
  const [showBulkReport, setShowBulkReport] = useState(false)
  const [bulkReport, setBulkReport] = useState<{
    summary: {
      totalScanned: number
      updated: number
      skippedNoProduct: number
      skippedNoCost: number
      unchanged: number
      affectedWorkOrders: number
    }
    details: Array<{
      order_no: string
      work_order_cost_id: string
      line_no: number
      product_code: string
      part_name: string | null
      old_unit_price: number
      new_unit_price: number
      cost_type: string
      master_type: string | null
    }>
    detailsTruncated: boolean
  } | null>(null)

  useEffect(() => {
    fetchProducts()
  }, [])

  const fetchProducts = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/products')
      if (!res.ok) throw new Error('Failed to fetch products')
      const data = await res.json()
      setProducts(data || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setError(null)

    try {
      const payload = {
        ...(editingId && { id: editingId }),
        product_code: formData.product_code,
        name: formData.name,
        shelf_no: formData.shelf_no || undefined,
        barcode: formData.barcode || undefined,
        purchase_price: formData.purchase_price ? Number(formData.purchase_price) : undefined,
        cost_price: formData.cost_price ? Number(formData.cost_price) : undefined,
      }

      const res = await fetch('/api/products', {
        method: editingId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const errorData = await res.json()
        throw new Error(errorData.error || '保存に失敗しました')
      }

      await fetchProducts()
      setShowModal(false)
      resetForm()
      
      // 棚番の同期状況をメッセージに反映
      const baseMessage = editingId ? '製品を更新しました' : '製品を登録しました'
      const syncMessage = formData.shelf_no ? '棚番を products と stocks に同期しました' : ''
      const fullMessage = syncMessage ? `${baseMessage}\n\n✓ ${syncMessage}` : baseMessage
      alert(fullMessage)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setSubmitting(false)
    }
  }

  const handleEdit = (product: Product) => {
    setEditingId(product.id)
    setFormData({
      product_code: product.product_code,
      name: product.name,
      shelf_no: product.shelf_no || '',
      barcode: product.barcode || '',
      purchase_price: product.purchase_price?.toString() || '',
      cost_price: product.cost_price?.toString() || '',
    })
    setShowModal(true)
  }

  const handleDelete = async (product: Product) => {
    if (!confirm(`「${product.name}」を削除してもよろしいですか？`)) return

    try {
      const res = await fetch('/api/products', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: product.id }),
      })

      if (!res.ok) {
        const errorData = await res.json()
        throw new Error(errorData.error || '削除に失敗しました')
      }

      await fetchProducts()
      alert('製品を削除しました')
    } catch (err) {
      alert(err instanceof Error ? err.message : '削除に失敗しました')
    }
  }

  const resetForm = () => {
    setEditingId(null)
    setFormData({
      product_code: '',
      name: '',
      shelf_no: '',
      barcode: '',
      purchase_price: '',
      cost_price: '',
    })
    setError(null)
  }

  const openNewModal = () => {
    resetForm()
    setShowModal(true)
  }

  // チェックボックス操作
  const handleToggleSelect = (code: string) => {
    setSelectedCodes(prev => {
      const next = new Set(prev)
      if (next.has(code)) next.delete(code)
      else next.add(code)
      return next
    })
  }

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedCodes(new Set(pagedProducts.map(p => p.product_code)))
    } else {
      setSelectedCodes(new Set())
    }
  }

  const handleBulkDelete = async () => {
    if (selectedCodes.size === 0) return

    const targets = products.filter(p => selectedCodes.has(p.product_code))
    const preview = targets
      .slice(0, 5)
      .map(p => `・${p.product_code} ${p.name}`)
      .join('\n')
    const more = targets.length > 5 ? `\n…他 ${targets.length - 5} 件` : ''

    if (
      !confirm(
        `選択した ${targets.length} 件の製品を削除してもよろしいですか？\n\n${preview}${more}\n\nこの操作は取り消せません。`
      )
    ) {
      return
    }

    setIsBulkDeleting(true)
    try {
      const res = await fetch('/api/products', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: targets.map(p => p.id) }),
      })

      if (!res.ok) {
        const errorData = await res.json()
        throw new Error(errorData.error || '削除に失敗しました')
      }

      setSelectedCodes(new Set())
      await fetchProducts()
      alert(`${targets.length} 件の製品を削除しました`)
    } catch (err) {
      alert(err instanceof Error ? err.message : '削除に失敗しました')
    } finally {
      setIsBulkDeleting(false)
    }
  }

  // 選択商品のラベル一括印刷
  const handlePrintLabels = async () => {
    if (selectedCodes.size === 0) return
    setIsPrinting(true)
    try {
      const targets = products
        .filter(p => selectedCodes.has(p.product_code))
        .map(p => ({ product_code: p.product_code, name: p.name, shelf_no: p.shelf_no || null }))

      const res = await fetch('/api/labels/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ products: targets, quantity: labelQuantity, labelSize }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Unknown error' }))
        throw new Error(err.error || 'PDF生成に失敗しました')
      }

      const blob = await res.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `labels-${Date.now()}.pdf`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
      setShowLabelModal(false)
    } catch (err) {
      alert(err instanceof Error ? err.message : '印刷に失敗しました')
    } finally {
      setIsPrinting(false)
    }
  }

  const handleBulkApplyCostAll = async () => {
    setIsBulkApplyingAll(true)
    try {
      const res = await fetch('/api/products/bulk-apply-cost-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ execute: false }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'プレビューの取得に失敗しました')
      }
      const data = await res.json()
      setBulkPreview(data)
      setShowBulkPreview(true)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'プレビューの取得に失敗しました')
    } finally {
      setIsBulkApplyingAll(false)
    }
  }

  const handleBulkApplyConfirmed = async () => {
    setShowBulkPreview(false)
    setIsBulkApplyingAll(true)
    try {
      const res = await fetch('/api/products/bulk-apply-cost-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ execute: true }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || '一括更新に失敗しました')
      }
      const data = await res.json()
      setBulkReport(data)
      setShowBulkReport(true)
    } catch (err) {
      alert(err instanceof Error ? err.message : '一括更新に失敗しました')
    } finally {
      setIsBulkApplyingAll(false)
    }
  }

  // 検索フィルタ
  let filteredProducts = products.filter(
    (product) =>
      product.product_code.toLowerCase().includes(searchQuery.toLowerCase()) ||
      product.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (product.shelf_no || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (product.barcode || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (product.purchase_price != null && String(product.purchase_price).includes(searchQuery)) ||
      (product.cost_price != null && String(product.cost_price).includes(searchQuery))
  )

  // ソート
  filteredProducts.sort((a, b) => {
    if (sortBy === 'code') return a.product_code.localeCompare(b.product_code)
    if (sortBy === 'name') return a.name.localeCompare(b.name)
    if (sortBy === 'price') return (b.cost_price || 0) - (a.cost_price || 0)
    return 0
  })

  // ページネーション計算
  const totalPages = Math.ceil(filteredProducts.length / itemsPerPage)
  const startIndex = (currentPage - 1) * itemsPerPage
  const endIndex = startIndex + itemsPerPage
  const pagedProducts = filteredProducts.slice(startIndex, endIndex)

  const allPageSelected = pagedProducts.length > 0 && pagedProducts.every(p => selectedCodes.has(p.product_code))
  const somePageSelected = pagedProducts.some(p => selectedCodes.has(p.product_code))

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-purple-950 to-slate-950 relative overflow-hidden p-8">
      {/* 背景の電子回路パターン */}
      <div className="absolute inset-0 opacity-10">
        <svg className="w-full h-full" viewBox="0 0 1200 800">
          <pattern id="circuit" x="0" y="0" width="200" height="200" patternUnits="userSpaceOnUse">
            <path d="M 0 50 L 50 50 L 50 0" stroke="currentColor" strokeWidth="2" fill="none" className="text-cyan-400" />
            <path d="M 150 150 L 100 150 L 100 200" stroke="currentColor" strokeWidth="2" fill="none" className="text-cyan-400" />
            <circle cx="50" cy="50" r="3" fill="currentColor" className="text-cyan-400" />
            <circle cx="100" cy="150" r="3" fill="currentColor" className="text-cyan-400" />
          </pattern>
          <rect width="1200" height="800" fill="url(#circuit)" />
        </svg>
      </div>

      <div className="relative z-10 max-w-7xl mx-auto">
        {/* ヘッダー */}
        <div className="mb-8">
          <Link href="/" className="inline-block text-yellow-400 hover:text-yellow-300 font-semibold mb-4 transition">
            ← トップページに戻る
          </Link>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-yellow-200 text-sm uppercase tracking-[0.3em]">Product Master</p>
              <h1 className="text-4xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 via-amber-400 to-orange-400">
                製品マスタ
              </h1>
            </div>
            <div className="flex gap-3">
              <button
                onClick={handleBulkApplyCostAll}
                disabled={isBulkApplyingAll}
                className="px-5 py-3 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 disabled:from-slate-600 disabled:to-slate-600 disabled:cursor-not-allowed text-white font-bold rounded-lg transition-all duration-300 shadow-lg hover:shadow-emerald-500/40 text-sm"
              >
                {isBulkApplyingAll ? '更新中...' : '全D指令・全L指令\n単価一括更新'}
              </button>
              <button
                onClick={openNewModal}
                className="px-6 py-3 bg-gradient-to-r from-yellow-500 to-orange-500 hover:from-yellow-600 hover:to-orange-600 text-white font-bold rounded-lg transition-all duration-300 shadow-lg hover:shadow-yellow-500/50"
              >
                ＋ 新規製品登録
              </button>
            </div>
          </div>
        </div>

        {error && (
          <div className="bg-red-900/20 border-2 border-red-500 rounded-lg p-4 mb-6 text-red-300">
            {error}
          </div>
        )}

        {/* 検索・フィルタ */}
        <div className="bg-white/10 backdrop-blur-sm rounded-lg border-2 border-yellow-500/30 p-6 mb-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-yellow-300 mb-2">検索</label>
              <input
                type="text"
                placeholder="商品コード、製品名、棚番、バーコードで検索..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value)
                  setCurrentPage(1)
                }}
                className="w-full px-4 py-2 bg-slate-800 border-2 border-yellow-400/30 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:border-yellow-400 focus:shadow-[0_0_10px_rgba(250,204,21,0.5)]"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-yellow-300 mb-2">ソート</label>
              <select
                value={sortBy}
                onChange={(e) => {
                  setSortBy(e.target.value as any)
                  setCurrentPage(1)
                }}
                className="w-full px-4 py-2 bg-slate-800 border-2 border-yellow-400/30 rounded-lg text-white focus:outline-none focus:border-yellow-400 focus:shadow-[0_0_10px_rgba(250,204,21,0.5)]"
              >
                <option value="code">商品コード順</option>
                <option value="name">製品名順</option>
                <option value="price">原価順</option>
              </select>
            </div>
          </div>

          {/* 表示件数情報 */}
          {!loading && filteredProducts.length > 0 && (
            <div className="text-sm text-yellow-300">
              表示 {startIndex + 1} - {Math.min(endIndex, filteredProducts.length)} / 合計 {filteredProducts.length} 件
              {filteredProducts.length !== products.length && (
                <span className="ml-2 text-slate-400">（全{products.length}件中）</span>
              )}
            </div>
          )}
        </div>

        {/* テーブル */}
        <div className="bg-white/5 backdrop-blur-sm rounded-lg border-2 border-yellow-500/30 overflow-hidden">
          {loading ? (
            <div className="p-12 text-center text-slate-300">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-yellow-400 mb-3"></div>
              <p>読み込み中...</p>
            </div>
          ) : filteredProducts.length === 0 ? (
            <div className="p-12 text-center text-slate-400">
              <p className="text-lg font-medium">
                {products.length === 0 ? '製品がまだ登録されていません' : '検索結果がありません'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gradient-to-r from-yellow-900/40 to-orange-900/40 border-b-2 border-yellow-500/50">
                  <tr>
                    <th className="px-4 py-4 text-center">
                      <input
                        type="checkbox"
                        checked={allPageSelected}
                        ref={el => { if (el) el.indeterminate = somePageSelected && !allPageSelected }}
                        onChange={e => handleSelectAll(e.target.checked)}
                        className="w-4 h-4 accent-yellow-400 cursor-pointer"
                        title="このページをすべて選択"
                      />
                    </th>
                    <th className="px-6 py-4 text-left font-bold text-yellow-300">商品コード</th>
                    <th className="px-6 py-4 text-left font-bold text-yellow-300">製品名</th>
                    <th className="px-6 py-4 text-left font-bold text-yellow-300">棚番</th>
                    <th className="px-6 py-4 text-left font-bold text-yellow-300">バーコード</th>
                    <th className="px-6 py-4 text-right font-bold text-yellow-300">購入単価</th>
                    <th className="px-6 py-4 text-right font-bold text-yellow-300">原価</th>
                    <th className="px-6 py-4 text-center font-bold text-yellow-300">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700">
                  {pagedProducts.map((product) => (
                    <tr
                      key={product.id}
                      className={`hover:bg-yellow-900/10 transition-colors ${selectedCodes.has(product.product_code) ? 'bg-yellow-900/20' : ''}`}
                    >
                      <td className="px-4 py-4 text-center">
                        <input
                          type="checkbox"
                          checked={selectedCodes.has(product.product_code)}
                          onChange={() => handleToggleSelect(product.product_code)}
                          className="w-4 h-4 accent-yellow-400 cursor-pointer"
                        />
                      </td>
                      <td className="px-6 py-4 text-yellow-200 font-semibold font-mono">{product.product_code}</td>
                      <td className="px-6 py-4 text-slate-200">{product.name}</td>
                      <td className="px-6 py-4 text-slate-300 font-mono">{product.shelf_no || '-'}</td>
                      <td className="px-6 py-4 text-slate-400 text-xs font-mono">{product.barcode || '-'}</td>
                      <td className="px-6 py-4 text-right text-slate-300">
                        {product.purchase_price ? `¥${product.purchase_price.toLocaleString('ja-JP')}` : '-'}
                      </td>
                      <td className="px-6 py-4 text-right text-yellow-300 font-bold">
                        {product.cost_price ? `¥${product.cost_price.toLocaleString('ja-JP')}` : '-'}
                      </td>
                      <td className="px-6 py-4 text-center">
                        <div className="flex gap-2 justify-center">
                          <button
                            onClick={() => handleEdit(product)}
                            className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded transition"
                          >
                            編集
                          </button>
                          <Link
                            href={`/labels/products?code=${encodeURIComponent(product.product_code)}`}
                            className="px-3 py-1 bg-cyan-600 hover:bg-cyan-700 text-white text-xs font-semibold rounded transition"
                          >
                            🏷️ ラベル
                          </Link>
                          <button
                            onClick={() => handleDelete(product)}
                            className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white text-xs font-semibold rounded transition"
                          >
                            削除
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ページネーション */}
        {filteredProducts.length > itemsPerPage && (
          <div className="border-2 border-yellow-500/30 rounded-xl p-6 backdrop-blur mt-6 bg-white/5">
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div className="text-yellow-300 text-sm">
                表示 {startIndex + 1} - {Math.min(endIndex, filteredProducts.length)} / 合計 {filteredProducts.length} 件
                <span className="mx-2">|</span>
                ページ {currentPage}/{totalPages}
              </div>
              <div className="flex gap-2 flex-wrap items-center">
                <button
                  onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                  disabled={currentPage === 1}
                  className="px-4 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
                >
                  ← 前へ
                </button>
                
                <div className="flex gap-1 flex-wrap items-center">
                  {Array.from({ length: Math.min(totalPages, 10) }, (_, i) => {
                    let pageNum: number
                    if (totalPages <= 10) {
                      pageNum = i + 1
                    } else if (currentPage <= 5) {
                      pageNum = i + 1
                    } else if (currentPage >= totalPages - 4) {
                      pageNum = totalPages - 9 + i
                    } else {
                      pageNum = currentPage - 4 + i
                    }
                    
                    return (
                      <button
                        key={pageNum}
                        onClick={() => setCurrentPage(pageNum)}
                        className={`px-3 py-2 rounded-lg transition ${
                          currentPage === pageNum
                            ? 'bg-yellow-500 text-white'
                            : 'bg-slate-800 text-gray-300 hover:bg-slate-700'
                        }`}
                      >
                        {pageNum}
                      </button>
                    )
                  })}
                </div>
                
                <button
                  onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                  disabled={currentPage === totalPages}
                  className="px-4 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
                >
                  次へ →
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 選択中バー */}
        {selectedCodes.size > 0 && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-4 px-6 py-4 bg-slate-900 border-2 border-yellow-400 rounded-2xl shadow-2xl shadow-yellow-500/30">
            <span className="text-yellow-300 font-bold text-sm">
              {selectedCodes.size} 件選択中
            </span>
            <button
              onClick={() => setShowLabelModal(true)}
              className="px-5 py-2 bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600 text-white font-bold rounded-lg transition text-sm shadow-lg"
            >
              🏷️ 選択商品のラベル印刷
            </button>
            <button
              onClick={handleBulkDelete}
              disabled={isBulkDeleting}
              className="px-5 py-2 bg-red-600 hover:bg-red-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white font-bold rounded-lg transition text-sm shadow-lg"
            >
              {isBulkDeleting ? '削除中...' : '🗑️ 選択商品を一括削除'}
            </button>
            <button
              onClick={() => setSelectedCodes(new Set())}
              className="px-3 py-2 bg-slate-700 hover:bg-slate-600 text-gray-300 rounded-lg transition text-sm"
            >
              ✕ 選択解除
            </button>
          </div>
        )}

        {/* 統計情報 */}
        {!loading && products.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
            <div className="bg-white/5 backdrop-blur-sm border-2 border-yellow-500/30 rounded-lg p-4">
              <div className="text-sm text-yellow-300 font-semibold">登録済み製品数</div>
              <div className="text-3xl font-bold text-yellow-400 mt-2">{products.length}</div>
            </div>
            <div className="bg-white/5 backdrop-blur-sm border-2 border-yellow-500/30 rounded-lg p-4">
              <div className="text-sm text-yellow-300 font-semibold">検索結果</div>
              <div className="text-3xl font-bold text-yellow-400 mt-2">{filteredProducts.length}</div>
            </div>
            <div className="bg-white/5 backdrop-blur-sm border-2 border-yellow-500/30 rounded-lg p-4">
              <div className="text-sm text-yellow-300 font-semibold">平均原価</div>
              <div className="text-3xl font-bold text-yellow-400 mt-2">
                ¥{Math.round(products.reduce((sum, p) => sum + (p.cost_price || 0), 0) / (products.filter(p => p.cost_price).length || 1)).toLocaleString('ja-JP')}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ラベル印刷モーダル */}
      {showLabelModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-gradient-to-br from-slate-900 to-slate-800 border-2 border-cyan-500/60 rounded-xl shadow-2xl w-full max-w-md">
            <div className="p-6 border-b border-cyan-500/30 flex items-center justify-between">
              <h2 className="text-xl font-bold text-cyan-300">🏷️ 一括ラベル印刷</h2>
              <button onClick={() => setShowLabelModal(false)} className="text-slate-400 hover:text-white text-2xl leading-none">×</button>
            </div>
            <div className="p-6 space-y-5">
              <div className="p-3 bg-cyan-900/30 border border-cyan-500/30 rounded-lg text-sm text-cyan-200">
                <span className="font-bold">{selectedCodes.size} 件</span> の商品を印刷します
                <ul className="mt-2 max-h-32 overflow-y-auto space-y-1">
                  {products.filter(p => selectedCodes.has(p.product_code)).map(p => (
                    <li key={p.product_code} className="text-xs text-slate-300">
                      <span className="font-mono text-cyan-400">{p.product_code}</span> {p.name}
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <label className="block text-sm font-semibold text-cyan-300 mb-2">📏 ラベルサイズ</label>
                <select
                  value={labelSize}
                  onChange={e => setLabelSize(e.target.value)}
                  className="w-full px-4 py-2 bg-slate-800 border-2 border-cyan-400/30 rounded-lg text-white focus:outline-none focus:border-cyan-400"
                >
                  <option value="40x30">40mm × 30mm</option>
                  <option value="50x40">50mm × 40mm</option>
                  <option value="60x40">60mm × 40mm</option>
                  <option value="80x60">80mm × 60mm</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-semibold text-cyan-300 mb-2">🔢 各商品の印刷枚数</label>
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={labelQuantity}
                  onChange={e => setLabelQuantity(Number(e.target.value))}
                  className="w-full px-4 py-2 bg-slate-800 border-2 border-cyan-400/30 rounded-lg text-white focus:outline-none focus:border-cyan-400"
                />
                <p className="mt-1 text-xs text-slate-400">合計 {selectedCodes.size * labelQuantity} 枚</p>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setShowLabelModal(false)}
                  className="flex-1 px-4 py-3 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition font-medium"
                >
                  キャンセル
                </button>
                <button
                  onClick={handlePrintLabels}
                  disabled={isPrinting}
                  className="flex-1 px-4 py-3 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-700 hover:to-blue-700 disabled:from-slate-600 disabled:to-slate-600 disabled:cursor-not-allowed text-white font-bold rounded-lg transition shadow-lg"
                >
                  {isPrinting ? '生成中...' : '🖨️ 印刷実行'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* プレビュー確認モーダル */}
      {showBulkPreview && bulkPreview && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-gradient-to-br from-slate-900 to-slate-800 border-2 border-yellow-500/60 rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">
            {/* ヘッダ */}
            <div className="p-6 border-b border-yellow-500/30 flex items-center justify-between">
              <h2 className="text-xl font-bold text-yellow-300">更新内容の確認</h2>
              <button
                onClick={() => setShowBulkPreview(false)}
                className="text-slate-400 hover:text-white text-2xl leading-none"
              >
                ×
              </button>
            </div>

            {/* サマリー */}
            <div className="p-6 border-b border-yellow-500/30 bg-yellow-900/10">
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
                {[
                  { label: 'スキャン件数', value: bulkPreview.summary.totalScanned, color: 'text-slate-300' },
                  { label: '更新対象', value: bulkPreview.summary.updated, color: 'text-yellow-400 font-bold text-lg' },
                  { label: '未変更', value: bulkPreview.summary.unchanged, color: 'text-slate-400' },
                  { label: '未登録', value: bulkPreview.summary.skippedNoProduct, color: 'text-orange-400' },
                  { label: '原価0/null', value: bulkPreview.summary.skippedNoCost, color: 'text-orange-400' },
                  { label: '影響D指令数', value: bulkPreview.summary.affectedWorkOrders, color: 'text-cyan-400' },
                ].map((stat) => (
                  <div
                    key={stat.label}
                    className="bg-slate-800/60 border border-yellow-500/20 rounded-lg p-3 text-center"
                  >
                    <div className="text-xs text-slate-400 mb-1">{stat.label}</div>
                    <div className={`text-2xl ${stat.color}`}>{stat.value.toLocaleString('ja-JP')}</div>
                  </div>
                ))}
              </div>
              <div className="text-sm text-yellow-200 bg-yellow-900/30 border border-yellow-500/30 rounded-lg p-3">
                <strong>この操作により、上記の更新対象件数の明細行が変更されます。</strong>
              </div>
            </div>

            {/* 変更内容プレビュー */}
            <div className="flex-1 overflow-y-auto p-6">
              <h3 className="text-sm font-bold text-yellow-300 mb-4">
                変更対象（{bulkPreview.previewDetails.length}件{bulkPreview.preview_truncated ? '～' : ''}）
              </h3>
              <div className="space-y-2 max-h-[300px] overflow-y-auto">
                {bulkPreview.previewDetails.map((item, i) => (
                  <div
                    key={i}
                    className="bg-slate-800/50 border border-yellow-500/20 rounded-lg p-3 text-sm"
                  >
                    <div className="font-mono font-bold text-yellow-300">{item.product_code}</div>
                    <div className="text-slate-300 text-xs mt-1">
                      部品: {item.part_name || '(未設定)'}
                    </div>
                    <div className="text-xs mt-2 flex items-center gap-2">
                      <span className="text-red-400">
                        ¥{Number(item.old_unit_price).toLocaleString('ja-JP')}
                      </span>
                      <span className="text-slate-500">→</span>
                      <span className="text-emerald-400 font-bold">
                        ¥{Number(item.new_unit_price).toLocaleString('ja-JP')}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
              {bulkPreview.preview_truncated && (
                <p className="mt-3 text-yellow-400 text-xs">
                  ※ 更新対象が多いため、一部のみプレビューされています
                </p>
              )}
            </div>

            {/* フッタ */}
            <div className="p-4 border-t border-yellow-500/30 flex justify-end gap-3">
              <button
                onClick={() => setShowBulkPreview(false)}
                className="px-6 py-2 bg-slate-700 hover:bg-slate-600 text-white font-semibold rounded-lg transition"
              >
                キャンセル
              </button>
              <button
                onClick={handleBulkApplyConfirmed}
                disabled={isBulkApplyingAll}
                className="px-6 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 disabled:from-slate-600 disabled:to-slate-600 disabled:cursor-not-allowed text-white font-bold rounded-lg transition"
              >
                {isBulkApplyingAll ? '実行中...' : '実行'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 一括単価更新レポートモーダル */}
      {showBulkReport && bulkReport && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-gradient-to-br from-slate-900 to-slate-800 border-2 border-emerald-500/60 rounded-xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col">
            {/* ヘッダ */}
            <div className="p-6 border-b border-emerald-500/30 flex items-center justify-between">
              <h2 className="text-xl font-bold text-emerald-300">全D指令・全L指令 単価一括更新レポート</h2>
              <button
                onClick={() => setShowBulkReport(false)}
                className="text-slate-400 hover:text-white text-2xl leading-none"
              >
                ×
              </button>
            </div>
            {/* サマリー */}
            <div className="p-6 border-b border-emerald-500/30">
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                {[
                  { label: 'スキャン件数', value: bulkReport.summary.totalScanned, color: 'text-slate-300' },
                  { label: '更新件数', value: bulkReport.summary.updated, color: 'text-emerald-400 font-bold' },
                  { label: '未変更', value: bulkReport.summary.unchanged, color: 'text-slate-400' },
                  { label: 'スキップ\n(製品未登録)', value: bulkReport.summary.skippedNoProduct, color: 'text-yellow-400' },
                  { label: 'スキップ\n(原価0/null)', value: bulkReport.summary.skippedNoCost, color: 'text-yellow-400' },
                  { label: '影響D指令数', value: bulkReport.summary.affectedWorkOrders, color: 'text-cyan-400' },
                ].map((stat) => (
                  <div
                    key={stat.label}
                    className="bg-slate-800/60 border border-emerald-500/20 rounded-lg p-3 text-center"
                  >
                    <div className="text-xs text-slate-400 whitespace-pre-line mb-1">{stat.label}</div>
                    <div className={`text-2xl ${stat.color}`}>{stat.value.toLocaleString('ja-JP')}</div>
                  </div>
                ))}
              </div>
              {bulkReport.summary.updated === 0 && (
                <p className="mt-4 text-center text-slate-400 text-sm">更新対象の明細行はありませんでした</p>
              )}
            </div>
            {/* 詳細テーブル */}
            {bulkReport.details.length > 0 && (
              <div className="flex-1 overflow-y-auto p-6">
                <h3 className="text-sm font-bold text-emerald-300 mb-3">
                  更新明細{bulkReport.detailsTruncated ? '（上位500件表示）' : `（${bulkReport.details.length}件）`}
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-emerald-900/30 border-b border-emerald-500/30">
                      <tr>
                        <th className="px-3 py-2 text-left text-emerald-300 font-semibold">D指令No</th>
                        <th className="px-3 py-2 text-left text-emerald-300 font-semibold">区分</th>
                        <th className="px-3 py-2 text-left text-emerald-300 font-semibold">行No</th>
                        <th className="px-3 py-2 text-left text-emerald-300 font-semibold">商品コード</th>
                        <th className="px-3 py-2 text-left text-emerald-300 font-semibold">部品名</th>
                        <th className="px-3 py-2 text-right text-emerald-300 font-semibold">更新前単価</th>
                        <th className="px-3 py-2 text-right text-emerald-300 font-semibold">更新後単価</th>
                        <th className="px-3 py-2 text-center text-emerald-300 font-semibold">原価区分</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-700/50">
                      {bulkReport.details.map((row, i) => (
                        <tr key={i} className="hover:bg-emerald-900/10 transition-colors">
                          <td className="px-3 py-2 text-slate-200 font-mono">{row.order_no || '-'}</td>
                          <td className="px-3 py-2">
                            <span
                              className={`px-2 py-0.5 rounded text-xs font-bold ${
                                row.master_type === 'ライン原価'
                                  ? 'bg-blue-900/50 text-blue-300'
                                  : 'bg-purple-900/50 text-purple-300'
                              }`}
                            >
                              {row.master_type === 'ライン原価' ? 'L指令' : 'D指令'}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-slate-400">{row.line_no}</td>
                          <td className="px-3 py-2 text-yellow-300 font-mono">{row.product_code}</td>
                          <td className="px-3 py-2 text-slate-300 max-w-[180px] truncate" title={row.part_name || ''}>
                            {row.part_name || '-'}
                          </td>
                          <td className="px-3 py-2 text-right text-red-400">
                            ¥{Number(row.old_unit_price).toLocaleString('ja-JP')}
                          </td>
                          <td className="px-3 py-2 text-right text-emerald-400 font-bold">
                            ¥{Number(row.new_unit_price).toLocaleString('ja-JP')}
                          </td>
                          <td className="px-3 py-2 text-center text-slate-300">{row.cost_type}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {bulkReport.detailsTruncated && (
                  <p className="mt-3 text-yellow-400 text-xs">
                    ※ 更新件数が500件を超えているため、上位500件のみ表示しています
                  </p>
                )}
              </div>
            )}
            {/* フッタ */}
            <div className="p-4 border-t border-emerald-500/30 flex justify-end">
              <button
                onClick={() => setShowBulkReport(false)}
                className="px-6 py-2 bg-slate-700 hover:bg-slate-600 text-white font-semibold rounded-lg transition"
              >
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}

      {/* モーダル */}
      {showModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-gradient-to-br from-slate-900 to-slate-800 border-2 border-yellow-500/50 rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-yellow-500/30">
              <h2 className="text-2xl font-bold text-yellow-400">
                {editingId ? '製品編集' : '新規製品登録'}
              </h2>
            </div>
            
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-yellow-300 mb-2">商品コード *</label>
                <input
                  type="text"
                  required
                  value={formData.product_code}
                  onChange={(e) => setFormData({ ...formData, product_code: e.target.value })}
                  className="w-full px-4 py-2 bg-slate-800 border-2 border-yellow-400/30 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-yellow-400"
                  placeholder="例: PROD-001"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-yellow-300 mb-2">製品名 *</label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-4 py-2 bg-slate-800 border-2 border-yellow-400/30 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-yellow-400"
                  placeholder="例: スタンダード部品A"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-yellow-300 mb-2">バーコード</label>
                <input
                  type="text"
                  value={formData.barcode}
                  onChange={(e) => setFormData({ ...formData, barcode: e.target.value })}
                  className="w-full px-4 py-2 bg-slate-800 border-2 border-yellow-400/30 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-yellow-400"
                  placeholder="例: 4901234567890"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-yellow-300 mb-2">棚番</label>
                <input
                  type="text"
                  value={formData.shelf_no}
                  onChange={(e) => setFormData({ ...formData, shelf_no: e.target.value })}
                  className="w-full px-4 py-2 bg-slate-800 border-2 border-yellow-400/30 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-yellow-400"
                  placeholder="例: A-010"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-yellow-300 mb-2">購入単価（円）</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={formData.purchase_price}
                    onChange={(e) => setFormData({ ...formData, purchase_price: e.target.value })}
                    className="w-full px-4 py-2 bg-slate-800 border-2 border-yellow-400/30 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-yellow-400"
                    placeholder="0"
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-yellow-300 mb-2">原価（円）</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={formData.cost_price}
                    onChange={(e) => setFormData({ ...formData, cost_price: e.target.value })}
                    className="w-full px-4 py-2 bg-slate-800 border-2 border-yellow-400/30 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-yellow-400"
                    placeholder="0"
                  />
                </div>
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 px-6 py-3 bg-gradient-to-r from-yellow-500 to-orange-500 hover:from-yellow-600 hover:to-orange-600 disabled:from-slate-600 disabled:to-slate-700 text-white font-bold rounded-lg transition-all"
                >
                  {submitting ? '保存中...' : editingId ? '更新' : '登録'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-6 py-3 bg-slate-700 hover:bg-slate-600 text-white font-semibold rounded-lg transition-all"
                >
                  キャンセル
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
