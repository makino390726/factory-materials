'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { QRCodeSVG } from 'qrcode.react'

type Product = {
  id?: number
  product_code: string
  name: string
  barcode?: string
  purchase_price?: number
  cost_price?: number
}

export default function ProductRegisterPage() {
  const [productCode, setProductCode] = useState('')
  const [productName, setProductName] = useState('')
  const [barcodeData, setBarcodeData] = useState('')
  const [purchasePrice, setPurchasePrice] = useState('')
  const [costPrice, setCostPrice] = useState('')
  const [products, setProducts] = useState<Product[]>([])
  const [editingId, setEditingId] = useState<number | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  // 製品一覧を取得
  const fetchProducts = async () => {
    try {
      const response = await fetch('/api/products')
      if (response.ok) {
        const data = await response.json()
        setProducts(data)
      }
    } catch (error) {
      console.error('製品取得エラー:', error)
    }
  }

  useEffect(() => {
    fetchProducts()
  }, [])

  // QRコード自動生成
  const handleGenerateQR = () => {
    if (!productCode || !productName) {
      alert('商品コードと製品名を入力してください')
      return
    }

    const qrData = JSON.stringify({
      code: productCode,
      name: productName,
    })
    setBarcodeData(qrData)
    alert('QRコードを生成しました')
  }

  // 製品登録・更新
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!productCode || !productName) {
      alert('商品コードと製品名を入力してください')
      return
    }

    if (!barcodeData) {
      alert('QRコードを生成してください')
      return
    }

    setIsLoading(true)
    try {
      const method = editingId ? 'PUT' : 'POST'
      const body = {
        id: editingId,
        product_code: productCode,
        name: productName,
        barcode: barcodeData,
        purchase_price: purchasePrice ? parseFloat(purchasePrice) : null,
        cost_price: costPrice ? parseFloat(costPrice) : null,
      }

      const response = await fetch('/api/products', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (response.ok) {
        alert(editingId ? '製品を更新しました' : '製品を登録しました')
        handleClear()
        fetchProducts()
      } else {
        const error = await response.json()
        alert(`エラー: ${error.error}`)
      }
    } catch (error) {
      console.error('保存エラー:', error)
      alert('保存に失敗しました')
    } finally {
      setIsLoading(false)
    }
  }

  // フォームクリア
  const handleClear = () => {
    setProductCode('')
    setProductName('')
    setBarcodeData('')
    setPurchasePrice('')
    setCostPrice('')
    setEditingId(null)
  }

  // 編集
  const handleEdit = (product: Product) => {
    setProductCode(product.product_code)
    setProductName(product.name)
    setBarcodeData(product.barcode || '')
    setPurchasePrice(product.purchase_price ? String(product.purchase_price) : '')
    setCostPrice(product.cost_price ? String(product.cost_price) : '')
    setEditingId(product.id || null)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // 削除
  const handleDelete = async (id: number) => {
    if (!confirm('本当に削除しますか？')) return

    try {
      const response = await fetch('/api/products', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })

      if (response.ok) {
        alert('製品を削除しました')
        fetchProducts()
      }
    } catch (error) {
      console.error('削除エラー:', error)
      alert('削除に失敗しました')
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-blue-950 to-slate-950 relative overflow-hidden py-8 px-4">
      {/* 背景パターン */}
      <div className="absolute inset-0 opacity-10">
        <svg className="w-full h-full" viewBox="0 0 1200 800">
          <pattern id="circuit" x="0" y="0" width="200" height="200" patternUnits="userSpaceOnUse">
            <path d="M 0 50 L 50 50 L 50 0" stroke="currentColor" strokeWidth="2" fill="none" className="text-cyan-400" />
            <path d="M 150 150 L 100 150 L 100 200" stroke="currentColor" strokeWidth="2" fill="none" className="text-cyan-400" />
          </pattern>
          <rect width="100%" height="100%" fill="url(#circuit)" />
        </svg>
      </div>

      <div className="max-w-6xl mx-auto relative z-10">
        {/* ヘッダー */}
        <div className="mb-8">
          <Link
            href="/"
            className="inline-flex items-center text-cyan-300 hover:text-cyan-200 transition-colors mb-3 text-sm"
          >
            ← ホームに戻る
          </Link>
          <h1 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-400 mb-2">
            {editingId ? '製品編集' : '製品登録'}
          </h1>
          <p className="text-gray-400 text-sm">製品情報とQRコードの登録・管理</p>
        </div>

        {/* 登録フォーム */}
        <div className="bg-slate-900/50 backdrop-blur-sm border border-cyan-500/20 rounded-lg shadow-xl p-6 mb-6">
          <h2 className="text-xl font-bold text-cyan-400 mb-6 flex items-center">
            <span className="mr-2">📝</span>
            {editingId ? '編集モード' : '新規登録'}
          </h2>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* 左側：入力フォーム */}
              <div className="space-y-4">
                <div>
                  <label htmlFor="productCode" className="block text-sm font-medium text-cyan-400 mb-2">
                    商品コード <span className="text-red-400">*</span>
                  </label>
                  <input
                    id="productCode"
                    type="text"
                    value={productCode}
                    onChange={(e) => setProductCode(e.target.value)}
                    className="w-full px-4 py-2 bg-slate-800/50 border border-cyan-500/30 rounded-md text-white placeholder-gray-500 focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500 transition-all"
                    placeholder="例: P-10001"
                    required
                  />
                </div>

                <div>
                  <label htmlFor="productName" className="block text-sm font-medium text-cyan-400 mb-2">
                    製品名 <span className="text-red-400">*</span>
                  </label>
                  <input
                    id="productName"
                    type="text"
                    value={productName}
                    onChange={(e) => setProductName(e.target.value)}
                    className="w-full px-4 py-2 bg-slate-800/50 border border-cyan-500/30 rounded-md text-white placeholder-gray-500 focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500 transition-all"
                    placeholder="例: 工業用ボルトA"
                    required
                  />
                </div>

                <div>
                  <label htmlFor="purchasePrice" className="block text-sm font-medium text-cyan-400 mb-2">
                    仕入単価
                  </label>
                  <input
                    id="purchasePrice"
                    type="number"
                    step="0.01"
                    value={purchasePrice}
                    onChange={(e) => setPurchasePrice(e.target.value)}
                    className="w-full px-4 py-2 bg-slate-800/50 border border-cyan-500/30 rounded-md text-white placeholder-gray-500 focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500 transition-all"
                    placeholder="例: 1500.00"
                  />
                </div>

                <div>
                  <label htmlFor="costPrice" className="block text-sm font-medium text-cyan-400 mb-2">
                    原価
                  </label>
                  <input
                    id="costPrice"
                    type="number"
                    step="0.01"
                    value={costPrice}
                    onChange={(e) => setCostPrice(e.target.value)}
                    className="w-full px-4 py-2 bg-slate-800/50 border border-cyan-500/30 rounded-md text-white placeholder-gray-500 focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500 transition-all"
                    placeholder="例: 1200.00"
                  />
                </div>

                <button
                  type="button"
                  onClick={handleGenerateQR}
                  className="w-full px-6 py-3 bg-gradient-to-r from-green-600 to-emerald-600 text-white rounded-md hover:from-green-700 hover:to-emerald-700 transition-all shadow-lg hover:shadow-green-500/50 font-medium"
                >
                  ✨ QRコード自動生成
                </button>
              </div>

              {/* 右側：QRコードプレビュー */}
              <div className="flex flex-col items-center justify-center border-2 border-dashed border-cyan-500/30 rounded-lg p-6 bg-slate-800/30">
                <p className="text-sm text-cyan-400 mb-4">QRコードプレビュー</p>
                {barcodeData ? (
                  <div className="bg-white p-4 rounded-lg border border-cyan-500/50 shadow-lg shadow-cyan-500/20">
                    <QRCodeSVG value={barcodeData} size={150} level="M" />
                  </div>
                ) : (
                  <p className="text-sm text-gray-500 text-center">
                    QRコード自動生成ボタンを<br />クリックしてください
                  </p>
                )}
              </div>
            </div>

            {/* ボタン */}
            <div className="flex gap-4">
              <button
                type="button"
                onClick={handleClear}
                className="flex-1 px-6 py-3 bg-slate-700 text-white rounded-md hover:bg-slate-600 transition-all shadow-lg font-medium"
              >
                クリア
              </button>
              <button
                type="submit"
                disabled={isLoading}
                className="flex-1 px-6 py-3 bg-gradient-to-r from-cyan-600 to-blue-600 text-white rounded-md hover:from-cyan-700 hover:to-blue-700 transition-all disabled:from-gray-600 disabled:to-gray-600 disabled:cursor-not-allowed shadow-lg hover:shadow-cyan-500/50 font-medium"
              >
                {isLoading ? '処理中...' : editingId ? '🔄 更新する' : '➕ 登録する'}
              </button>
            </div>
          </form>
        </div>

        {/* 製品一覧 */}
        <div className="bg-slate-900/50 backdrop-blur-sm border border-cyan-500/20 rounded-lg shadow-xl p-6">
          <h2 className="text-xl font-bold text-cyan-400 mb-4 flex items-center">
            <span className="mr-2">📦</span>
            製品一覧
          </h2>
          
          {products.length === 0 ? (
            <p className="text-gray-400 text-center py-8">登録された製品はありません</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-cyan-500/20">
                    <th className="text-left py-3 px-4 font-semibold text-cyan-400">商品コード</th>
                    <th className="text-left py-3 px-4 font-semibold text-cyan-400">製品名</th>
                    <th className="text-right py-3 px-4 font-semibold text-cyan-400">仕入単価</th>
                    <th className="text-right py-3 px-4 font-semibold text-cyan-400">原価</th>
                    <th className="text-center py-3 px-4 font-semibold text-cyan-400">QRコード</th>
                    <th className="text-center py-3 px-4 font-semibold text-cyan-400">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {products.map((product) => (
                    <tr key={product.id} className="border-b border-cyan-500/10 hover:bg-slate-800/30 transition-colors">
                      <td className="py-3 px-4 font-mono text-sm text-cyan-300">{product.product_code}</td>
                      <td className="py-3 px-4 text-gray-200">{product.name}</td>
                      <td className="py-3 px-4 text-right text-gray-200">
                        {product.purchase_price ? `¥${product.purchase_price.toLocaleString()}` : '-'}
                      </td>
                      <td className="py-3 px-4 text-right text-gray-200">
                        {product.cost_price ? `¥${product.cost_price.toLocaleString()}` : '-'}
                      </td>
                      <td className="py-3 px-4 text-center">
                        {product.barcode ? (
                          <div className="inline-block p-2 bg-white border border-cyan-500/50 rounded shadow-lg shadow-cyan-500/20">
                            <QRCodeSVG value={product.barcode} size={50} level="M" />
                          </div>
                        ) : (
                          <span className="text-gray-500 text-sm">未生成</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <div className="flex gap-2 justify-center">
                          <button
                            onClick={() => handleEdit(product)}
                            className="px-4 py-2 bg-gradient-to-r from-yellow-600 to-orange-600 text-white rounded-md hover:from-yellow-700 hover:to-orange-700 transition-all shadow-lg hover:shadow-yellow-500/50 text-sm font-medium"
                          >
                            編集
                          </button>
                          <Link
                            href={`/labels/products?code=${encodeURIComponent(product.product_code)}`}
                            className="px-4 py-2 bg-gradient-to-r from-cyan-600 to-teal-600 text-white rounded-md hover:from-cyan-700 hover:to-teal-700 transition-all shadow-lg hover:shadow-cyan-500/50 text-sm font-medium"
                          >
                            🏷️ ラベル
                          </Link>
                          <button
                            onClick={() => product.id && handleDelete(product.id)}
                            className="px-4 py-2 bg-gradient-to-r from-red-600 to-pink-600 text-white rounded-md hover:from-red-700 hover:to-pink-700 transition-all shadow-lg hover:shadow-red-500/50 text-sm font-medium"
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
      </div>
    </div>
  )
}
