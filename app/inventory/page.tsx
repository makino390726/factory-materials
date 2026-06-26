'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

interface StockItem {
  product_code: string
  name: string
  stock_qty: number
  unit_price: number | null
  total_amount: number | null
  updated_at: string
  last_movement_at?: string | null
  has_movement?: boolean
  matches_movement_filter?: boolean
}

function getStockAmount(item: Pick<StockItem, 'stock_qty' | 'unit_price'>): number | null {
  const price = item.unit_price
  if (price == null || Number(price) === 0) return null
  return (item.stock_qty || 0) * Number(price)
}

function formatYen(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—'
  return new Intl.NumberFormat('ja-JP', {
    style: 'currency',
    currency: 'JPY',
    maximumFractionDigits: 0,
  }).format(value)
}

interface InventoryState {
  searchTerm: string
  sortBy: 'code' | 'name' | 'qty' | 'movement' | 'movementDate'
  movementType: 'all' | 'IN' | 'OUT'
  filterLowStock: boolean
  movementStartDate: string
  movementEndDate: string
  currentPage: number
}

const STORAGE_KEY = 'inventory-page-state'

export default function InventoryPage() {
  const [stocks, setStocks] = useState<StockItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [sortBy, setSortBy] = useState<'code' | 'name' | 'qty' | 'movement' | 'movementDate'>('code')
  const [movementType, setMovementType] = useState<'all' | 'IN' | 'OUT'>('all')
  const [filterLowStock, setFilterLowStock] = useState(false)
  const [movementStartDate, setMovementStartDate] = useState('')
  const [movementEndDate, setMovementEndDate] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const itemsPerPage = 50

  // 状態をセッション ストレージから復元
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        const savedState = sessionStorage.getItem(STORAGE_KEY)
        if (savedState) {
          const state: InventoryState = JSON.parse(savedState)
          setSearchTerm(state.searchTerm)
          setSortBy(state.sortBy)
          setMovementType(state.movementType || 'all')
          setFilterLowStock(state.filterLowStock)
          setMovementStartDate(state.movementStartDate)
          setMovementEndDate(state.movementEndDate)
          setCurrentPage(state.currentPage)
        }
      } catch (err) {
        console.error('Failed to restore state:', err)
      }
    }
  }, [])

  // 状態が変更されるたびにセッションストレージに保存
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const state: InventoryState = {
        searchTerm,
        sortBy,
        movementType,
        filterLowStock,
        movementStartDate,
        movementEndDate,
        currentPage,
      }
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    }
  }, [searchTerm, sortBy, movementType, filterLowStock, movementStartDate, movementEndDate, currentPage])

  useEffect(() => {
    fetchStocks()
  }, [movementType, movementStartDate, movementEndDate])

  const fetchStocks = async () => {
    try {
      setLoading(true)
      const query = new URLSearchParams()
      if (movementType !== 'all') {
        query.set('movementType', movementType)
      }
      if (movementStartDate) {
        query.set('movementStartDate', movementStartDate)
      }
      if (movementEndDate) {
        query.set('movementEndDate', movementEndDate)
      }

      const queryString = query.toString()
      const response = await fetch(`/api/inventory/list${queryString ? `?${queryString}` : ''}`)
      const data = await response.json()
      if (data.success) {
        setStocks(data.data || [])
        setError('')
      } else {
        setError(data.error || '在庫データの取得に失敗しました')
      }
    } catch (err) {
      setError('通信エラーが発生しました')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  // フィルタリングとソート
  let filteredStocks = stocks.filter(item => {
    const matchesSearch = item.product_code.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         item.name.toLowerCase().includes(searchTerm.toLowerCase())
    const matchesFilter = !filterLowStock || item.stock_qty <= 10
    const matchesMovementFilter = item.matches_movement_filter !== false
    return matchesSearch && matchesFilter && matchesMovementFilter
  })

  filteredStocks.sort((a, b) => {
    if (sortBy === 'code') return a.product_code.localeCompare(b.product_code)
    if (sortBy === 'name') return a.name.localeCompare(b.name)
    if (sortBy === 'qty') return (b.stock_qty || 0) - (a.stock_qty || 0)
    if (sortBy === 'movement') {
      const aHas = a.has_movement ? 1 : 0
      const bHas = b.has_movement ? 1 : 0
      if (aHas !== bHas) return bHas - aHas
      const aTime = a.last_movement_at ? Date.parse(a.last_movement_at) : 0
      const bTime = b.last_movement_at ? Date.parse(b.last_movement_at) : 0
      if (aTime !== bTime) return bTime - aTime
      return a.product_code.localeCompare(b.product_code)
    }
    if (sortBy === 'movementDate') {
      const aTime = a.last_movement_at ? Date.parse(a.last_movement_at) : 0
      const bTime = b.last_movement_at ? Date.parse(b.last_movement_at) : 0
      if (aTime !== bTime) return bTime - aTime
      return a.product_code.localeCompare(b.product_code)
    }
    return 0
  })

  // ページネーション計算
  const totalPages = Math.ceil(filteredStocks.length / itemsPerPage)
  const startIndex = (currentPage - 1) * itemsPerPage
  const endIndex = startIndex + itemsPerPage
  const pagedStocks = filteredStocks.slice(startIndex, endIndex)
  const totalStockAmount = stocks.reduce((sum, item) => sum + (getStockAmount(item) ?? 0), 0)
  const filteredStockAmount = filteredStocks.reduce((sum, item) => sum + (getStockAmount(item) ?? 0), 0)

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-purple-950 to-slate-950 relative overflow-hidden">
      {/* 背景パターン */}
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

      <div className="relative z-10 min-h-screen p-6">
        <div className="max-w-7xl mx-auto space-y-6">
          {/* ヘッダー */}
          <div className="space-y-4 mb-8">
            <Link href="/" className="inline-block text-cyan-400 hover:text-cyan-300 font-semibold transition">
              ← トップページに戻る
            </Link>
            <h1 className="text-4xl md:text-5xl font-bold">
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-cyan-400">
                在庫管理ダッシュボード
              </span>
            </h1>
            <p className="text-gray-400 text-lg">全製品の在庫情報を確認・管理</p>
          </div>

          {/* エラー表示 */}
          {error && (
            <div className="border-2 border-red-500 bg-red-900/10 rounded-lg p-4 text-red-400">
              {error}
            </div>
          )}

          {/* 検索・フィルタセクション */}
          <div className="border-2 border-purple-500 bg-purple-900/10 rounded-xl p-6 space-y-4 backdrop-blur">
            <h2 className="text-xl font-bold text-purple-300">🔍 検索・フィルタ</h2>
            
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {/* 検索 */}
              <div>
                <label className="block text-sm font-semibold text-gray-300 mb-2">
                  製品検索
                </label>
                <input
                  type="text"
                  name="search"
                  value={searchTerm}
                  onChange={(e) => {
                    setSearchTerm(e.target.value)
                    setCurrentPage(1)
                  }}
                  placeholder="コード・名称..."
                  className="w-full px-4 py-2 bg-slate-800 border-2 border-purple-400 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-purple-300 focus:shadow-[0_0_10px_rgba(168,85,247,0.5)]"
                />
              </div>

              {/* ソート */}
              <div>
                <label className="block text-sm font-semibold text-gray-300 mb-2">
                  ソート
                </label>
                <select
                  name="sort"
                  value={sortBy}
                  onChange={(e) => {
                    setSortBy(e.target.value as any)
                    setCurrentPage(1)
                  }}
                  className="w-full px-4 py-2 bg-slate-800 border-2 border-purple-400 rounded-lg text-white focus:outline-none focus:border-purple-300 focus:shadow-[0_0_10px_rgba(168,85,247,0.5)]"
                >
                  <option value="code">コード順</option>
                  <option value="name">名称順</option>
                  <option value="qty">在庫数順</option>
                  <option value="movement">在庫変動あり順</option>
                  <option value="movementDate">移動日順</option>
                </select>
              </div>

              {/* 入出庫種別 */}
              <div>
                <label className="block text-sm font-semibold text-gray-300 mb-2">
                  入出庫区分
                </label>
                <select
                  name="movementType"
                  value={movementType}
                  onChange={(e) => {
                    setMovementType(e.target.value as 'all' | 'IN' | 'OUT')
                    setCurrentPage(1)
                  }}
                  className="w-full px-4 py-2 bg-slate-800 border-2 border-purple-400 rounded-lg text-white focus:outline-none focus:border-purple-300 focus:shadow-[0_0_10px_rgba(168,85,247,0.5)]"
                >
                  <option value="all">すべて</option>
                  <option value="IN">入庫のみ</option>
                  <option value="OUT">出庫のみ</option>
                </select>
              </div>

              {/* フィルタ */}
              <div className="flex items-end">
                <label className="flex items-center cursor-pointer text-gray-300 hover:text-gray-200">
                  <input
                    type="checkbox"
                    checked={filterLowStock}
                    onChange={(e) => {
                      setFilterLowStock(e.target.checked)
                      setCurrentPage(1)
                    }}
                    className="w-4 h-4"
                  />
                  <span className="ml-3 font-semibold">在庫10個以下</span>
                </label>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-semibold text-gray-300 mb-2">
                  移動日（開始）
                </label>
                <input
                  type="date"
                  value={movementStartDate}
                  onChange={(e) => {
                    setMovementStartDate(e.target.value)
                    setCurrentPage(1)
                  }}
                  className="w-full px-4 py-2 bg-slate-800 border-2 border-purple-400 rounded-lg text-white focus:outline-none focus:border-purple-300 focus:shadow-[0_0_10px_rgba(168,85,247,0.5)]"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-300 mb-2">
                  移動日（終了）
                </label>
                <input
                  type="date"
                  value={movementEndDate}
                  onChange={(e) => {
                    setMovementEndDate(e.target.value)
                    setCurrentPage(1)
                  }}
                  className="w-full px-4 py-2 bg-slate-800 border-2 border-purple-400 rounded-lg text-white focus:outline-none focus:border-purple-300 focus:shadow-[0_0_10px_rgba(168,85,247,0.5)]"
                />
              </div>
              <div className="flex items-end">
                <button
                  onClick={() => {
                    setMovementStartDate('')
                    setMovementEndDate('')
                    setMovementType('all')
                    setCurrentPage(1)
                  }}
                  className="px-4 py-2 border-2 border-slate-600 text-slate-300 rounded-lg font-semibold hover:border-slate-400 hover:text-slate-100 transition"
                >
                  移動条件クリア
                </button>
              </div>
            </div>

            {/* 統計情報 */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-4 border-t border-purple-500">
              <div className="text-center p-3 border-2 border-cyan-400 rounded-lg bg-cyan-900/20">
                <p className="text-2xl font-bold text-cyan-300">{stocks.length}</p>
                <p className="text-xs text-gray-400 mt-1">全製品数</p>
                <p className="text-lg font-bold text-cyan-200 mt-2">{formatYen(totalStockAmount)}</p>
                <p className="text-xs text-gray-400 mt-1">在庫金額合計</p>
              </div>
              <div className="text-center p-3 border-2 border-green-400 rounded-lg bg-green-900/20">
                <p className="text-2xl font-bold text-green-300">{filteredStocks.length}</p>
                <p className="text-xs text-gray-400 mt-1">フィルタ後の件数</p>
                <p className="text-lg font-bold text-green-200 mt-2">{formatYen(filteredStockAmount)}</p>
                <p className="text-xs text-gray-400 mt-1">在庫金額</p>
              </div>
              <div className="text-center p-3 border-2 border-orange-400 rounded-lg bg-orange-900/20">
                <p className="text-2xl font-bold text-orange-300">
                  {stocks.filter(s => s.stock_qty <= 10 && s.stock_qty > 0).length}
                </p>
                <p className="text-xs text-gray-400 mt-1">低在庫</p>
              </div>
              <div className="text-center p-3 border-2 border-red-400 rounded-lg bg-red-900/20">
                <p className="text-2xl font-bold text-red-300">
                  {stocks.filter(s => s.stock_qty === 0).length}
                </p>
                <p className="text-xs text-gray-400 mt-1">欠品</p>
              </div>
            </div>
          </div>

          {/* テーブル */}
          <div className="border-2 border-cyan-500 rounded-xl overflow-hidden backdrop-blur">
            <div className="overflow-x-auto">
              {loading ? (
                <div className="p-8 text-center text-gray-400">読み込み中...</div>
              ) : filteredStocks.length === 0 ? (
                <div className="p-8 text-center text-gray-400">該当する製品がありません</div>
              ) : (
                <table className="w-full">
                  <thead className="bg-cyan-900/30 border-b-2 border-cyan-500">
                    <tr>
                      <th className="px-6 py-4 text-left text-cyan-300 font-bold">製品コード</th>
                      <th className="px-6 py-4 text-left text-cyan-300 font-bold">製品名</th>
                      <th className="px-6 py-4 text-right text-cyan-300 font-bold">在庫数</th>
                      <th className="px-6 py-4 text-right text-cyan-300 font-bold">単価</th>
                      <th className="px-6 py-4 text-right text-cyan-300 font-bold">在庫金額</th>
                      <th className="px-6 py-4 text-left text-cyan-300 font-bold">最終更新</th>
                      <th className="px-6 py-4 text-center text-cyan-300 font-bold">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedStocks.map((item, idx) => (
                      <tr
                        key={item.product_code}
                        className={`border-b border-cyan-900/30 hover:bg-cyan-900/20 transition ${
                          idx % 2 === 0 ? 'bg-slate-900/20' : ''
                        }`}
                      >
                        <td className="px-6 py-4 font-semibold text-cyan-300">{item.product_code}</td>
                        <td className="px-6 py-4 text-gray-300">{item.name}</td>
                        <td className="px-6 py-4 text-right">
                          <span className={`px-3 py-1 rounded-full font-bold text-sm ${
                            item.stock_qty === 0 ? 'bg-red-900/50 text-red-300 border border-red-500' :
                            item.stock_qty <= 10 ? 'bg-orange-900/50 text-orange-300 border border-orange-500' :
                            item.stock_qty <= 50 ? 'bg-yellow-900/50 text-yellow-300 border border-yellow-500' :
                            'bg-green-900/50 text-green-300 border border-green-500'
                          }`}>
                            {item.stock_qty}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right text-gray-300 tabular-nums">
                          {formatYen(item.unit_price)}
                        </td>
                        <td className="px-6 py-4 text-right text-gray-300 tabular-nums">
                          {formatYen(getStockAmount(item))}
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-400">
                          {new Date(item.updated_at).toLocaleString('ja-JP', {
                            month: '2-digit',
                            day: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </td>
                        <td className="px-6 py-4 text-center">
                          <Link
                            href={`/inventory/${encodeURIComponent(item.product_code)}`}
                            className="text-purple-400 hover:text-purple-300 font-bold hover:shadow-[0_0_10px_rgba(168,85,247,0.5)] transition"
                          >
                            詳細
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* ページネーション */}
          {filteredStocks.length > itemsPerPage && (
            <div className="border-2 border-purple-500 rounded-xl p-6 backdrop-blur">
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div className="text-gray-300 text-sm">
                  表示 {startIndex + 1} - {Math.min(endIndex, filteredStocks.length)} / 合計 {filteredStocks.length} 件
                  <span className="mx-2">|</span>
                  ページ {currentPage}/{totalPages}
                </div>
                <div className="flex gap-2 flex-wrap items-center">
                  <button
                    onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                    disabled={currentPage === 1}
                    className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
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
                              ? 'bg-purple-500 text-white'
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
                    className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
                  >
                    次へ →
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* 操作ボタン */}
          <div className="flex gap-4 flex-wrap">
            <button
              onClick={fetchStocks}
              disabled={loading}
              className="px-6 py-3 border-2 border-cyan-400 text-cyan-400 font-bold rounded-lg hover:bg-cyan-900/30 hover:shadow-[0_0_15px_rgba(34,211,238,0.5)] disabled:opacity-50 transition"
            >
              🔄 更新
            </button>
            <Link
              href="/stock/receive"
              className="px-6 py-3 border-2 border-green-400 text-green-400 font-bold rounded-lg hover:bg-green-900/30 hover:shadow-[0_0_15px_rgba(34,197,94,0.5)] transition"
            >
              ➕ 入庫
            </Link>
            <Link
              href="/"
              className="px-6 py-3 border-2 border-purple-400 text-purple-400 font-bold rounded-lg hover:bg-purple-900/30 hover:shadow-[0_0_15px_rgba(168,85,247,0.5)] transition"
            >
              ← ホーム
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
