'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

interface Product {
  product_code: string
  name: string
}

export default function ReceiveInventoryPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [selectedCode, setSelectedCode] = useState('')
  const [searchText, setSearchText] = useState('')
  const [showSearchResults, setShowSearchResults] = useState(false)
  const [quantity, setQuantity] = useState('1')
  const [note, setNote] = useState('')
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null)
  const [operationType, setOperationType] = useState<'in' | 'out'>('in')

  useEffect(() => {
    fetchProducts()
  }, [])

  const fetchProducts = async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/labels/products/list')
      const data = await response.json()
      if (data.success) {
        setProducts(data.data || [])
        if (data.data && data.data.length > 0) {
          setSelectedCode(data.data[0].product_code)
        }
      }
    } catch (error) {
      console.error('製品取得エラー:', error)
      setMessage({ type: 'error', text: '製品リストの取得に失敗しました' })
    } finally {
      setLoading(false)
    }
  }

  const handleOperation = async () => {
    if (!selectedCode || !quantity || isNaN(parseInt(quantity)) || parseInt(quantity) <= 0) {
      setMessage({ type: 'error', text: '製品と正の数量を入力してください' })
      return
    }

    setProcessing(true)
    setMessage(null)

    try {
      // セッションからスタッフ情報を取得
      const staffData = sessionStorage.getItem('staff')
      let loginId = null
      let staffName = null
      if (staffData) {
        try {
          const staff = JSON.parse(staffData)
          loginId = staff.login_id
          staffName = staff.name
        } catch (e) {
          console.error('スタッフ情報の取得エラー:', e)
        }
      }

      const response = await fetch('/api/stock/movement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_code: selectedCode,
          type: operationType,
          quantity: operationType === 'out' ? -parseInt(quantity) : parseInt(quantity),
          input_method: operationType === 'in' ? 'receive' : 'shipment',
          note: note || null,
          login_id: loginId,
          staff_name: staffName,
        }),
      })

      const data = await response.json()

      if (data.success) {
        const operationLabel = operationType === 'in' ? '入出庫' : '出庫'
        setMessage({
          type: 'success',
          text: `✅ ${parseInt(quantity)}個を${operationLabel}しました`,
        })
        // フォームをリセット
        setQuantity('1')
        setNote('')
        setTimeout(() => {
          setMessage(null)
        }, 3000)
      } else {
        setMessage({
          type: 'error',
          text: `❌ エラー: ${data.error}`,
        })
      }
    } catch (error) {
      console.error('操作エラー:', error)
      const operationLabel = operationType === 'in' ? '入出庫' : '出庫'
      setMessage({ type: 'error', text: `${operationLabel}に失敗しました` })
    } finally {
      setProcessing(false)
    }
  }

  const selectedProduct = products.find(p => p.product_code === selectedCode)

  // 検索結果をフィルタリング
  const filteredProducts = products.filter(product => {
    const searchLower = searchText.toLowerCase()
    return (
      product.name.toLowerCase().includes(searchLower) ||
      product.product_code.toLowerCase().includes(searchLower)
    )
  })

  // 製品を選択
  const handleSelectProduct = (product: Product) => {
    setSelectedCode(product.product_code)
    setSearchText(product.name)
    setShowSearchResults(false)
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-green-950 to-slate-950 relative overflow-hidden">
      {/* 背景パターン */}
      <div className="absolute inset-0 opacity-10">
        <svg className="w-full h-full" viewBox="0 0 1200 800">
          <pattern id="circuit" x="0" y="0" width="200" height="200" patternUnits="userSpaceOnUse">
            <path d="M 0 50 L 50 50 L 50 0" stroke="currentColor" strokeWidth="2" fill="none" className="text-green-400" />
            <path d="M 150 150 L 100 150 L 100 200" stroke="currentColor" strokeWidth="2" fill="none" className="text-green-400" />
            <circle cx="50" cy="50" r="3" fill="currentColor" className="text-green-400" />
            <circle cx="100" cy="150" r="3" fill="currentColor" className="text-green-400" />
          </pattern>
          <rect width="1200" height="800" fill="url(#circuit)" />
        </svg>
      </div>

      <div className="relative z-10 max-w-2xl mx-auto p-6 space-y-6 min-h-screen">
        {/* ヘッダー */}
        <div className="space-y-2">
          <Link href="/" className="inline-block text-green-400 hover:text-green-300 font-semibold transition">
            ← トップページに戻る
          </Link>
          <h1 className="text-3xl md:text-4xl font-bold">
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-green-400 to-cyan-400">
              {operationType === 'in' ? '入出庫管理' : '出庫管理'}
            </span>
          </h1>
          <p className="text-gray-400 text-lg">
            {operationType === 'in' ? '製品の入出庫を記録' : '製品の出庫を記録'}
          </p>
        </div>

        {/* メッセージ */}
        {message && (
          <div
            className={`p-4 rounded-lg border-2 ${
              message.type === 'success'
                ? 'bg-green-900/20 border-green-400 text-green-300'
                : 'bg-red-900/20 border-red-400 text-red-300'
            }`}
          >
            {message.text}
          </div>
        )}

        {loading ? (
          <div className="text-center text-gray-400 py-8">読み込み中...</div>
        ) : (
          <div className="border-2 border-green-500 bg-green-900/10 rounded-xl p-6 space-y-6 backdrop-blur">
            <h2 className="text-2xl font-bold text-green-300">
              {operationType === 'in' ? '入出庫情報入力' : '出庫情報入力'}
            </h2>

            {/* 操作タイプ選択 */}
            <div>
              <label className="block text-sm font-semibold text-gray-300 mb-3">
                📋 操作タイプを選択
              </label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => setOperationType('in')}
                  className={`py-3 px-4 rounded-lg font-bold border-2 transition ${
                    operationType === 'in'
                      ? 'bg-green-900/40 border-green-400 text-green-300 shadow-[0_0_10px_rgba(74,222,128,0.5)]'
                      : 'bg-slate-800 border-gray-600 text-gray-400 hover:border-green-400'
                  }`}
                >
                  ➕ 入庫
                </button>
                <button
                  onClick={() => setOperationType('out')}
                  className={`py-3 px-4 rounded-lg font-bold border-2 transition ${
                    operationType === 'out'
                      ? 'bg-red-900/40 border-red-400 text-red-300 shadow-[0_0_10px_rgba(239,68,68,0.5)]'
                      : 'bg-slate-800 border-gray-600 text-gray-400 hover:border-red-400'
                  }`}
                >
                  ➖ 出庫
                </button>
              </div>
            </div>

            {/* 製品選択 */}
            <div className="relative">
              <label className="block text-sm font-semibold text-gray-300 mb-2">
                🔍 製品を品名で検索 <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={searchText}
                onChange={(e) => {
                  setSearchText(e.target.value)
                  setShowSearchResults(true)
                }}
                onFocus={() => setShowSearchResults(true)}
                placeholder="製品名またはコードを入力..."
                className="w-full px-4 py-3 bg-slate-800 border-2 border-green-400 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-green-300 focus:shadow-[0_0_10px_rgba(74,222,128,0.5)]"
              />
              
              {/* 検索結果ドロップダウン */}
              {showSearchResults && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-slate-800 border-2 border-green-400 rounded-lg shadow-lg z-10 max-h-48 overflow-y-auto">
                  {filteredProducts.length === 0 ? (
                    <div className="p-3 text-gray-400 text-sm">
                      該当する製品がありません
                    </div>
                  ) : (
                    filteredProducts.map(product => (
                      <button
                        key={product.product_code}
                        onClick={() => handleSelectProduct(product)}
                        className={`w-full px-4 py-3 text-left hover:bg-green-900/30 border-b border-green-900/30 transition ${
                          selectedCode === product.product_code
                            ? 'bg-green-900/50 text-green-300'
                            : 'text-gray-300'
                        }`}
                      >
                        <div className="font-semibold">{product.name}</div>
                        <div className="text-xs text-gray-500">{product.product_code}</div>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>

            {/* 選択された製品情報 */}
            {selectedProduct && (
              <div className="bg-green-900/20 border-2 border-green-500 rounded-lg p-4">
                <div className="space-y-2 text-gray-300">
                  <div className="flex justify-between">
                    <span>製品コード:</span>
                    <span className="font-semibold text-green-300">{selectedProduct.product_code}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>製品名:</span>
                    <span className="font-semibold text-green-300">{selectedProduct.name}</span>
                  </div>
                </div>
              </div>
            )}

            {/* 数量入力 */}
            <div>
              <label className="block text-sm font-semibold text-gray-300 mb-2">
                {operationType === 'in' ? '入出庫数量' : '出庫数量'} <span className="text-red-400">*</span>
              </label>
              <div className="flex gap-2">
                <input
                  type="number"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  placeholder="例: 100"
                  className="flex-1 px-4 py-3 bg-slate-800 border-2 border-green-400 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-green-300 focus:shadow-[0_0_10px_rgba(74,222,128,0.5)]"
                  min="1"
                />
                <span className="flex items-center text-gray-300 font-semibold">個</span>
              </div>
              <p className="text-xs text-gray-500 mt-2">正の整数を入力してください</p>
            </div>

            {/* 数量プリセット */}
            <div>
              <label className="block text-sm font-semibold text-gray-300 mb-2">
                よく使う数量
              </label>
              <div className="grid grid-cols-4 gap-2">
                {[10, 50, 100, 500].map(num => (
                  <button
                    key={num}
                    onClick={() => setQuantity(String(num))}
                    className="px-3 py-2 bg-green-900/20 border-2 border-green-400 text-green-300 rounded-lg hover:bg-green-900/40 hover:shadow-[0_0_10px_rgba(74,222,128,0.5)] transition font-semibold text-sm"
                  >
                    {num}
                  </button>
                ))}
              </div>
            </div>

            {/* 備考 */}
            <div>
              <label className="block text-sm font-semibold text-gray-300 mb-2">
                📝 {operationType === 'in' ? '仕入' : '出庫'}備考（オプション）
              </label>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={operationType === 'in' 
                  ? "例: 発注書No. XXX、仕入先: ○○社" 
                  : "例: 販売先: ○○社、注文No. XXX"}
                className="w-full px-4 py-3 bg-slate-800 border-2 border-green-400 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-green-300 focus:shadow-[0_0_10px_rgba(74,222,128,0.5)] resize-none h-24"
              />
            </div>

            {/* ボタン */}
            <button
              onClick={handleOperation}
              disabled={processing || !selectedCode || !quantity}
              className={`w-full px-6 py-4 rounded-lg text-lg font-bold border-2 transition disabled:opacity-50 ${
                operationType === 'in'
                  ? 'border-green-400 text-green-400 hover:bg-green-900/30 hover:shadow-[0_0_15px_rgba(74,222,128,0.5)]'
                  : 'border-red-400 text-red-400 hover:bg-red-900/30 hover:shadow-[0_0_15px_rgba(239,68,68,0.5)]'
              }`}
            >
              {processing ? '処理中...' : (operationType === 'in' ? '✅ 入出庫を記録' : '✅ 出庫を記録')}
            </button>
          </div>
        )}

        {/* 関連リンク */}
        <div className="border-2 border-green-500 bg-green-900/10 rounded-xl p-6 backdrop-blur">
          <h3 className="text-lg font-bold text-green-300 mb-4">関連ページ</h3>
          <div className="grid grid-cols-2 gap-4">
            <Link
              href="/inventory"
              className="px-4 py-3 border-2 border-purple-400 text-purple-400 rounded-lg text-center font-semibold hover:bg-purple-900/30 hover:shadow-[0_0_10px_rgba(168,85,247,0.5)] transition"
            >
              📊 在庫管理
            </Link>
            <Link
              href="/stock/scan"
              className="px-4 py-3 border-2 border-cyan-400 text-cyan-400 rounded-lg text-center font-semibold hover:bg-cyan-900/30 hover:shadow-[0_0_10px_rgba(34,211,238,0.5)] transition"
            >
              📱 現場操作
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
