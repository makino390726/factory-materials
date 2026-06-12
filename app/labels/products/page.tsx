'use client'

import { useState, useEffect, useRef, Suspense } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { QRCodeSVG } from 'qrcode.react'

interface Product {
  product_code: string
  name: string
  shelf_no?: string | null
}

function ProductLabelPrintPageInner() {
  const searchParams = useSearchParams()
  const initialCode = searchParams.get('code')
  const didAutoSelect = useRef(false)

  const [products, setProducts] = useState<Product[]>([])
  const [productsLoading, setProductsLoading] = useState(true)
  const [productsError, setProductsError] = useState<string | null>(null)
  const [productCode, setProductCode] = useState('')
  const [productName, setProductName] = useState('')
  const [shelfNo, setShelfNo] = useState('')
  const [quantity, setQuantity] = useState(1)
  const [labelSize, setLabelSize] = useState('40x30')
  const [isLoading, setIsLoading] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [searchInput, setSearchInput] = useState('')
  
  // ページネーション用の状態
  const [currentPage, setCurrentPage] = useState(1)
  const productsPerPage = 10
  
  // 複数製品印刷用の状態
  const [printMode, setPrintMode] = useState<'single' | 'multiple'>('single')
  const [printAllProducts, setPrintAllProducts] = useState(false)
  const [startProductIndex, setStartProductIndex] = useState(0)
  const [endProductIndex, setEndProductIndex] = useState(0)

  // ページロード時に製品リストを取得
  useEffect(() => {
    const fetchProducts = async () => {
      try {
        setProductsLoading(true)
        setProductsError(null)
        
        const response = await fetch('/api/labels/products/list')
        if (!response.ok) {
          throw new Error('製品リストの取得に失敗しました')
        }
        
        const data = await response.json()
        setProducts(data.data || [])
        
        // URLパラメータ ?code= がある場合はその製品を自動選択
        const codeToSelect = initialCode
        if (codeToSelect && data.data && data.data.length > 0 && !didAutoSelect.current) {
          didAutoSelect.current = true
          const matched = data.data.find((p: Product) => p.product_code === codeToSelect)
          if (matched) {
            setProductCode(matched.product_code)
            setProductName(matched.name)
            setShelfNo(matched.shelf_no || '')
            return
          }
        }

        // 最初の製品を自動選択
        if (data.data && data.data.length > 0) {
          setProductCode(data.data[0].product_code)
          setProductName(data.data[0].name)
          setShelfNo(data.data[0].shelf_no || '')
        }
      } catch (error) {
        console.error('製品取得エラー:', error)
        setProductsError(error instanceof Error ? error.message : '不明なエラーが発生しました')
      } finally {
        setProductsLoading(false)
      }
    }

    fetchProducts()
  }, [])

  // ラベルサイズの設定（mm → px換算 1mm = 3.78px）
  const getLabelDimensions = () => {
    const sizes: Record<string, { width: number; height: number }> = {
      '40x30': { width: 151, height: 113 },
      '50x40': { width: 189, height: 151 },
      '60x40': { width: 227, height: 151 },
      '80x60': { width: 302, height: 227 },
    }
    return sizes[labelSize] || sizes['40x30']
  }

  const handlePrint = async () => {
    setIsLoading(true)
    try {
      const targetProducts = getTargetProducts()
      
      if (targetProducts.length === 0) {
        alert('印刷する製品がありません')
        return
      }

      console.log('PDF生成リクエスト:', { products: targetProducts, quantity, labelSize })
      console.log('🔍 詳細:', targetProducts.map(p => ({ code: p.product_code, name: p.name, shelf_no: p.shelf_no || null })))
      console.log('📄 JSON:', JSON.stringify(targetProducts.map(p => ({ product_code: p.product_code, name: p.name, shelf_no: p.shelf_no || null })), null, 2))

      // APIエンドポイントを呼び出してPDF生成
      const response = await fetch('/api/labels/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          products: targetProducts,
          quantity,
          labelSize,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }))
        console.error('APIエラー:', errorData)
        throw new Error(errorData.error || 'PDF生成に失敗しました')
      }

      // PDFをダウンロード
      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `product-labels-${new Date().getTime()}.pdf`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)

      alert('PDFのダウンロードが完了しました')
    } catch (error) {
      console.error('印刷エラー:', error)
      alert(`印刷に失敗しました: ${error instanceof Error ? error.message : '不明なエラー'}`)
    } finally {
      setIsLoading(false)
    }
  }

  // 印刷対象の製品リストを取得
  // 検索入力に基づいて製品をフィルタリング
  const filteredProducts = products.filter(p =>
    p.product_code.toLowerCase().includes(searchInput.toLowerCase()) ||
    p.name.toLowerCase().includes(searchInput.toLowerCase())
  )

  const getTargetProducts = () => {
    if (printMode === 'single') {
      const product = products.find(p => p.product_code === productCode)
      return product ? [product] : []
    }
    
    if (printAllProducts) {
      return products
    }
    
    // 複数製品モード：filteredProductsから範囲指定で取得
    const minIndex = Math.min(startProductIndex, endProductIndex)
    const maxIndex = Math.max(startProductIndex, endProductIndex)
    return filteredProducts.slice(minIndex, maxIndex + 1)
  }

  // ページネーション関連の計算
  const totalPages = Math.ceil(filteredProducts.length / productsPerPage)
  const startIndex = (currentPage - 1) * productsPerPage
  const endIndex = startIndex + productsPerPage
  const currentProducts = filteredProducts.slice(startIndex, endIndex)

  const handlePreviousPage = () => {
    setCurrentPage(prev => Math.max(1, prev - 1))
  }

  const handleNextPage = () => {
    setCurrentPage(prev => Math.min(totalPages, prev + 1))
  }

  const handleProductSelect = (selectedCode: string) => {
    const product = products.find(p => p.product_code === selectedCode)
    if (product) {
      setProductCode(product.product_code)
      setProductName(product.name)
      setShelfNo(product.shelf_no || '')
    } else {
      setProductCode('')
      setProductName('')
      setShelfNo('')
    }
  }

  const handlePreview = () => {
    console.log('プレビュー:', { productCode, productName, quantity, labelSize })
    setShowPreview(true)
  }

  const closePreview = () => {
    setShowPreview(false)
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-blue-950 to-slate-950 relative overflow-hidden py-8 px-4">
      {/* 背景パターン */}
      <div className="absolute inset-0 opacity-10">
        <svg className="w-full h-full" viewBox="0 0 1200 800">
          <pattern id="circuit" x="0" y="0" width="200" height="200" patternUnits="userSpaceOnUse">
            <path d="M 0 50 L 50 50 L 50 0" stroke="currentColor" strokeWidth="2" fill="none" className="text-blue-400" />
            <path d="M 150 150 L 100 150 L 100 200" stroke="currentColor" strokeWidth="2" fill="none" className="text-blue-400" />
            <circle cx="50" cy="50" r="3" fill="currentColor" className="text-blue-400" />
            <circle cx="100" cy="150" r="3" fill="currentColor" className="text-blue-400" />
          </pattern>
          <rect width="1200" height="800" fill="url(#circuit)" />
        </svg>
      </div>

      <div className="relative z-10 max-w-2xl mx-auto">
        <div className="border-2 border-blue-500 bg-blue-900/10 rounded-xl p-8 backdrop-blur">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-3xl font-bold mb-2 text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-cyan-400">
                製品ラベル印刷
              </h1>
              <p className="text-gray-400">QRコード付きラベルを生成・印刷</p>
            </div>
            <Link
              href="/"
              className="px-4 py-2 border-2 border-cyan-400 text-cyan-400 rounded-lg font-semibold hover:bg-cyan-900/30 hover:shadow-[0_0_15px_rgba(34,211,238,0.5)] transition whitespace-nowrap ml-4"
            >
              🏠 ホーム
            </Link>
          </div>

          {/* ローディングメッセージ */}
          {productsLoading && (
            <div className="mb-4 p-3 bg-blue-500/20 border border-blue-400 rounded text-blue-300">
              製品リストを読み込み中...
            </div>
          )}

          {/* エラーメッセージ */}
          {productsError && (
            <div className="mb-4 p-3 bg-red-500/20 border border-red-400 rounded text-red-300">
              エラー: {productsError}
            </div>
          )}

          <div className="space-y-6">
            {/* 印刷モード選択 */}
            <div>
              <label className="block text-sm font-semibold text-gray-300 mb-3">
                📋 印刷モード
              </label>
              <div className="flex gap-4">
                <label className="flex items-center text-gray-300 cursor-pointer hover:text-gray-200">
                  <input
                    type="radio"
                    value="single"
                    checked={printMode === 'single'}
                    onChange={() => setPrintMode('single')}
                    className="mr-2 w-4 h-4"
                  />
                  <span className="font-semibold">単一製品</span>
                </label>
                <label className="flex items-center text-gray-300 cursor-pointer hover:text-gray-200">
                  <input
                    type="radio"
                    value="multiple"
                    checked={printMode === 'multiple'}
                    onChange={() => setPrintMode('multiple')}
                    className="mr-2 w-4 h-4"
                  />
                  <span className="font-semibold">複数製品</span>
                </label>
              </div>
            </div>

            {/* 単一製品モード */}
            {printMode === 'single' && (
              <>
                {/* 商品コード検索 */}
                <div>
                  <label htmlFor="searchInput" className="block text-sm font-medium text-gray-700 mb-2">
                    🔍 商品コード・商品名で検索
                  </label>
                  <input
                    id="searchInput"
                    type="text"
                    value={searchInput}
                    onChange={(e) => {
                      setSearchInput(e.target.value)
                      setCurrentPage(1)
                    }}
                    placeholder="商品コードまたは商品名を入力してください"
                    className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-white bg-gray-800"
                  />
                  {searchInput && (
                    <p className="mt-2 text-sm text-gray-600">
                      該当件数: {filteredProducts.length} 件
                    </p>
                  )}
                </div>

                {/* フィルタリング結果リスト */}
                {searchInput && filteredProducts.length > 0 && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      検索結果一覧
                    </label>
                    <div className="border border-gray-300 rounded-md bg-white max-h-48 overflow-y-auto">
                      <div className="grid grid-cols-1">
                        {currentProducts.map((product, idx) => (
                          <button
                            key={`${product.product_code}-${idx}`}
                            onClick={() => {
                              setProductCode(product.product_code)
                              setProductName(product.name)
                              setShelfNo(product.shelf_no || '')
                              setSearchInput('')
                            }}
                            className={`p-2 text-left border-b hover:bg-blue-50 transition ${
                              productCode === product.product_code ? 'bg-blue-100' : ''
                            }`}
                          >
                            <div className="font-semibold text-gray-900">{product.product_code}</div>
                            <div className="text-xs text-gray-600">{product.name}</div>
                          </button>
                        ))}
                      </div>
                    </div>
                    {totalPages > 1 && (
                      <div className="flex justify-between items-center mt-2 text-xs text-gray-700">
                        <button
                          onClick={handlePreviousPage}
                          disabled={currentPage === 1}
                          className="px-2 py-1 bg-gray-300 text-gray-700 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          ← 前へ
                        </button>
                        <span>{currentPage}/{totalPages}ページ</span>
                        <button
                          onClick={handleNextPage}
                          disabled={currentPage === totalPages}
                          className="px-2 py-1 bg-gray-300 text-gray-700 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          次へ →
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {searchInput && filteredProducts.length === 0 && (
                  <div className="p-3 bg-yellow-50 border border-yellow-300 rounded text-yellow-800 text-sm">
                    「{searchInput}」に該当する製品がありません
                  </div>
                )}

                {/* 製品選択 */}
                <div>
                  <label htmlFor="productSelect" className="block text-sm font-medium text-gray-700 mb-2">
                    製品選択
                  </label>
                  <select
                    id="productSelect"
                    value={productCode}
                    onChange={(e) => handleProductSelect(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-white bg-gray-800"
                    disabled={productsLoading}
                  >
                    <option value="" style={{ color: 'white', backgroundColor: '#1f2937' }}>-- 製品を選択してください --</option>
                    {products.map((product, index) => (
                      <option key={`${product.product_code}-${index}`} value={product.product_code} style={{ color: 'white', backgroundColor: '#1f2937' }}>
                        {product.product_code} - {product.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* 製品コード（読み取り専用） */}
                <div>
                  <label htmlFor="productCode" className="block text-sm font-medium text-gray-700 mb-2">
                    製品コード
                  </label>
                  <input
                    id="productCode"
                    type="text"
                    value={productCode}
                    readOnly
                    className="w-full px-4 py-2 border border-gray-300 rounded-md bg-gray-800 text-white"
                    placeholder="製品を選択してください"
                  />
                </div>

                {/* 製品名（読み取り専用） */}
                <div>
                  <label htmlFor="productName" className="block text-sm font-medium text-gray-700 mb-2">
                    製品名
                  </label>
                  <input
                    id="productName"
                    type="text"
                    value={productName}
                    readOnly
                    className="w-full px-4 py-2 border border-gray-300 rounded-md bg-gray-800 text-white"
                    placeholder="製品を選択してください"
                  />
                </div>

                {/* 棚番（読み取り専用） */}
                <div>
                  <label htmlFor="shelfNo" className="block text-sm font-medium text-gray-700 mb-2">
                    棚番
                  </label>
                  <input
                    id="shelfNo"
                    type="text"
                    value={shelfNo}
                    readOnly
                    className="w-full px-4 py-2 border border-gray-300 rounded-md bg-gray-800 text-white"
                    placeholder="製品を選択してください"
                  />
                </div>
              </>
            )}

            {/* 複数製品モード */}
            {printMode === 'multiple' && (
              <>
                {/* 商品コード検索 */}
                <div>
                  <label htmlFor="searchInputMultiple" className="block text-sm font-medium text-gray-700 mb-2">
                    🔍 商品コード・商品名で検索（複数製品用）
                  </label>
                  <input
                    id="searchInputMultiple"
                    type="text"
                    value={searchInput}
                    onChange={(e) => {
                      setSearchInput(e.target.value)
                      setCurrentPage(1)
                    }}
                    placeholder="商品コードまたは商品名を入力してください"
                    className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-white bg-gray-800"
                  />
                  {searchInput && (
                    <p className="mt-2 text-sm text-gray-600">
                      該当件数: {filteredProducts.length} 件
                    </p>
                  )}
                </div>

                <div>
                  <label className="flex items-center mb-3">
                    <input
                      type="checkbox"
                      checked={printAllProducts}
                      onChange={(e) => setPrintAllProducts(e.target.checked)}
                      className="mr-2 w-4 h-4"
                    />
                    <span className="text-sm font-medium text-gray-700">全商品を印刷</span>
                  </label>

                  {!printAllProducts && (
                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          製品範囲を選択 ({currentPage}/{totalPages}ページ)
                        </label>
                        <div className="mb-2 p-2 bg-blue-50 border border-blue-300 rounded text-xs text-blue-800">
                          💡 開始製品をクリック → 終了製品をクリックで範囲指定
                          {startProductIndex >= 0 && (
                            <button
                              onClick={() => {
                                setStartProductIndex(0)
                                setEndProductIndex(0)
                              }}
                              className="ml-2 px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700"
                            >
                              リセット
                            </button>
                          )}
                        </div>
                        <div className="border border-gray-300 rounded-md p-3 mb-2 bg-gray-50 max-h-48 overflow-y-auto">
                          <div className="grid grid-cols-1 gap-2">
                            {currentProducts.map((product, idx) => {
                              const productIndex = filteredProducts.findIndex(p => p.product_code === product.product_code)
                              const isStart = productIndex === startProductIndex
                              const isEnd = productIndex === endProductIndex
                              const isInRange = productIndex >= Math.min(startProductIndex, endProductIndex) && 
                                               productIndex <= Math.max(startProductIndex, endProductIndex) &&
                                               startProductIndex !== endProductIndex
                              
                              let borderColor = 'border-gray-200 bg-white'
                              if (isStart && isEnd) {
                                borderColor = 'border-blue-500 bg-blue-100'
                              } else if (isStart) {
                                borderColor = 'border-green-500 bg-green-50'
                              } else if (isEnd) {
                                borderColor = 'border-red-500 bg-red-50'
                              } else if (isInRange) {
                                borderColor = 'border-blue-400 bg-blue-50'
                              }
                              
                              return (
                                <button
                                  key={`select-${product.product_code}-${idx}`}
                                  onClick={() => {
                                    // 開始と終了が同じ、または未設定の場合は開始として設定
                                    if (startProductIndex === endProductIndex) {
                                      setStartProductIndex(productIndex)
                                    } else {
                                      // 既に開始が設定されている場合は終了として設定
                                      setEndProductIndex(productIndex)
                                    }
                                  }}
                                  className={`p-2 text-left rounded border-2 transition text-sm hover:border-gray-400 ${borderColor}`}
                                >
                                  <div className="font-semibold">
                                    {isStart && !isEnd && '🟢 '}
                                    {isEnd && !isStart && '🔴 '}
                                    {product.product_code}
                                  </div>
                                  <div className="text-xs text-gray-600">{product.name}</div>
                                </button>
                              )
                            })}
                          </div>
                        </div>
                        <div className="flex justify-between items-center text-xs text-gray-700">
                          <button
                            onClick={handlePreviousPage}
                            disabled={currentPage === 1}
                            className="px-2 py-1 bg-gray-300 text-gray-700 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            ← 前へ
                          </button>
                          <span>{startIndex + 1} - {Math.min(endIndex, filteredProducts.length)}</span>
                          <button
                            onClick={handleNextPage}
                            disabled={currentPage === totalPages}
                            className="px-2 py-1 bg-gray-300 text-gray-700 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            次へ →
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded">
                    <p className="text-sm text-blue-800">
                      <span className="font-semibold">印刷対象:</span>{' '}
                      {printAllProducts 
                        ? `全${products.length}製品` 
                        : (() => {
                            const minIndex = Math.min(startProductIndex, endProductIndex)
                            const maxIndex = Math.max(startProductIndex, endProductIndex)
                            const count = maxIndex - minIndex + 1
                            return `${count}製品 (${filteredProducts[minIndex]?.product_code} ～ ${filteredProducts[maxIndex]?.product_code})`
                          })()
                      }
                    </p>
                  </div>
                </div>
              </>
            )}

            {/* ラベルサイズ */}
            <div>
              <label htmlFor="labelSize" className="block text-sm font-semibold text-gray-300 mb-2">
                📏 ラベルサイズ
              </label>
              <select
                id="labelSize"
                value={labelSize}
                onChange={(e) => setLabelSize(e.target.value)}
                className="w-full px-4 py-2 bg-slate-800 border-2 border-blue-400 rounded-lg text-white focus:outline-none focus:border-blue-300 focus:shadow-[0_0_10px_rgba(96,165,250,0.5)]"
              >
                <option value="40x30">40mm × 30mm</option>
                <option value="50x40">50mm × 40mm</option>
                <option value="60x40">60mm × 40mm</option>
                <option value="80x60">80mm × 60mm</option>
              </select>
            </div>

            {/* 印刷枚数 */}
            <div>
              <label htmlFor="quantity" className="block text-sm font-medium text-gray-700 mb-2">
                {printMode === 'single' ? '印刷枚数' : '各製品の印刷枚数'}
              </label>
              <input
                id="quantity"
                type="number"
                min="1"
                max="100"
                value={quantity}
                onChange={(e) => setQuantity(Number(e.target.value))}
                className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
              {printMode === 'multiple' && (
                <p className="mt-1 text-xs text-gray-500">
                  ※ 各製品につきこの枚数が印刷されます
                </p>
              )}
            </div>

            {/* プレビューエリア */}
            <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 bg-gray-50">
              <div className="text-center text-gray-500">
                <p className="mb-2">ラベルプレビュー</p>
                {printMode === 'single' ? (
                  productCode || productName ? (
                    <div className="bg-white border border-gray-400 inline-block px-6 py-4 rounded">
                      {productName && (
                        <p className="font-bold text-lg mb-1">{productName}</p>
                      )}
                      {shelfNo && (
                        <p className="text-xs text-gray-600 mb-1">棚番: {shelfNo}</p>
                      )}
                      {productCode && (
                        <p className="font-mono text-xs">{productCode}</p>
                      )}
                      <p className="text-xs text-gray-500 mt-2">{labelSize}mm</p>
                    </div>
                  ) : (
                    <p className="text-sm">製品情報を入力してください</p>
                  )
                ) : (
                  <div className="flex flex-wrap gap-2 justify-center">
                    {getTargetProducts().slice(0, 5).map((product, index) => (
                      <div key={`target-${product.product_code}-${index}`} className="bg-white border border-gray-400 px-4 py-2 rounded text-xs">
                        <p className="font-bold text-sm">{product.name}</p>
                        {product.shelf_no && (
                          <p className="text-[10px] text-gray-600">棚番: {product.shelf_no}</p>
                        )}
                        <p className="font-mono text-xs mt-1">{product.product_code}</p>
                      </div>
                    ))}
                    {getTargetProducts().length > 5 && (
                      <div className="flex items-center px-4 text-sm text-gray-600">
                        ...他{getTargetProducts().length - 5}製品
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* ボタン */}
            <div className="flex gap-4">
              <button
                onClick={handlePreview}
                className="flex-1 px-6 py-3 border-2 border-blue-400 text-blue-400 rounded-lg hover:bg-blue-900/30 hover:shadow-[0_0_10px_rgba(96,165,250,0.5)] disabled:opacity-50 transition font-semibold"
                disabled={isLoading || (printMode === 'single' && !productCode)}
              >
                👁️ プレビュー
              </button>
              <button
                onClick={handlePrint}
                className="flex-1 px-6 py-3 border-2 border-blue-400 text-blue-400 rounded-lg hover:bg-blue-900/30 hover:shadow-[0_0_15px_rgba(96,165,250,0.5)] disabled:opacity-50 transition font-bold"
                disabled={isLoading || (printMode === 'single' && !productCode)}
              >
                {isLoading ? '処理中...' : '🖨️ 印刷実行'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* プレビューモーダル */}
      {showPreview && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-auto">
            <div className="sticky top-0 bg-white border-b px-6 py-4 flex justify-between items-center">
              <h2 className="text-xl font-bold text-gray-800">印刷プレビュー</h2>
              <button
                onClick={closePreview}
                className="text-gray-500 hover:text-gray-700 text-2xl font-bold w-8 h-8"
              >
                ×
              </button>
            </div>
            
            <div className="p-6">
              <div className="mb-4 bg-blue-50 border border-blue-200 rounded p-3">
                <p className="text-sm text-blue-800">
                  {printMode === 'single' ? (
                    <>
                      <span className="font-semibold">印刷枚数:</span> {quantity}枚 | 
                      <span className="font-semibold ml-3">ラベルサイズ:</span> {labelSize}mm
                    </>
                  ) : (
                    <>
                      <span className="font-semibold">印刷対象:</span> {getTargetProducts().length}製品 | 
                      <span className="font-semibold ml-3">各製品:</span> {quantity}枚 | 
                      <span className="font-semibold ml-3">合計:</span> {getTargetProducts().length * quantity}枚
                    </>
                  )}
                </p>
              </div>

              <div className="bg-gray-100 p-8 rounded-lg">
                <div className="flex flex-wrap gap-6 justify-center">
                  {getTargetProducts().flatMap((product) => 
                    Array.from({ length: Math.min(quantity, 3) }).map((_, qtyIndex) => ({
                      product,
                      qtyIndex,
                    }))
                  ).slice(0, 12).map(({ product, qtyIndex }, index) => {
                    const dimensions = getLabelDimensions()
                    const totalLabels = getTargetProducts().length * quantity
                    return (
                      <div key={`${product.product_code}-${qtyIndex}`} className="flex flex-col items-center gap-2">
                        {/* ラベル本体（QRコードのみ） */}
                        <div
                          className="bg-white border-2 border-gray-800 rounded shadow-md flex items-center justify-center p-2"
                          style={{
                            width: `${dimensions.width}px`,
                            height: `${dimensions.height}px`,
                          }}
                        >
                          <QRCodeSVG 
                            value={JSON.stringify({
                              code: product.product_code,
                              name: product.name,
                              shelf_no: product.shelf_no || null,
                            })}
                            size={Math.min(dimensions.width, dimensions.height) - 16}
                            level="M"
                          />
                        </div>
                        
                        {/* ラベル外の製品情報 */}
                        <div className="text-center max-w-[150px]">
                          <p className="font-bold text-base leading-tight break-words mb-1">
                            {product.name}
                          </p>
                          {product.shelf_no && (
                            <p className="text-xs text-gray-600">棚番: {product.shelf_no}</p>
                          )}
                          <p className="font-mono text-xs text-gray-600">
                            {product.product_code}
                          </p>
                        </div>
                      </div>
                    )
                  })}
                </div>

                {getTargetProducts().length * quantity > 12 && (
                  <p className="text-center text-sm text-gray-600 mt-4">
                    ※ プレビューは最初の12枚のみ表示しています（全{getTargetProducts().length * quantity}枚）
                  </p>
                )}
              </div>

              <div className="mt-6 flex gap-4">
                <button
                  onClick={closePreview}
                  className="flex-1 px-6 py-3 bg-gray-600 text-white rounded-md hover:bg-gray-700 transition-colors"
                >
                  閉じる
                </button>
                <button
                  onClick={() => {
                    closePreview()
                    handlePrint()
                  }}
                  className="flex-1 px-6 py-3 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors font-medium"
                >
                  このまま印刷実行
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function ProductLabelPrintPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gradient-to-b from-slate-950 via-blue-950 to-slate-950 flex items-center justify-center text-blue-300">読み込み中...</div>}>
      <ProductLabelPrintPageInner />
    </Suspense>
  )
}
