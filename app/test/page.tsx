'use client'

import { useEffect, useState } from 'react'

export default function TestPage() {
  const [products, setProducts] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const fetchProducts = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/labels/products/list')
      const data = await res.json()
      console.log('取得したデータ:', data)
      setProducts(data.data || [])
    } catch (err) {
      setError(String(err))
      console.error('エラー:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchProducts()
  }, [])

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">製品取得テスト</h1>
      
      {error && <div className="bg-red-100 p-4 rounded mb-4 text-red-800">{error}</div>}
      
      {loading && <p>読み込み中...</p>}
      
      {!loading && (
        <>
          <p className="mb-4">取得件数: <strong>{products.length}</strong></p>
          
          <button 
            onClick={fetchProducts}
            className="bg-blue-600 text-white px-4 py-2 rounded mb-4"
          >
            再取得
          </button>

          <div className="bg-gray-100 p-4 rounded max-h-96 overflow-y-auto">
            <pre className="text-sm">
              {JSON.stringify(products.slice(0, 5), null, 2)}
            </pre>
          </div>
        </>
      )}
    </div>
  )
}
