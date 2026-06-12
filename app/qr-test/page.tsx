'use client'

import { useEffect, useState } from 'react'
import { QRCodeCanvas } from 'qrcode.react'

export default function QRTestPage() {
  const [products, setProducts] = useState<any[]>([])
  const [selectedCode, setSelectedCode] = useState('')

  useEffect(() => {
    fetch('/api/labels/products/list')
      .then(res => res.json())
      .then(data => {
        setProducts(data.data || [])
        if (data.data && data.data.length > 0) {
          setSelectedCode(data.data[0].product_code)
        }
      })
  }, [])

  const selectedProduct = products.find(p => p.product_code === selectedCode)

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">QRコードテスト表示</h1>
      
      <div className="mb-6">
        <label className="block mb-2 font-semibold">製品選択:</label>
        <select 
          value={selectedCode}
          onChange={(e) => setSelectedCode(e.target.value)}
          className="w-full p-2 border rounded"
        >
          {products.map(p => (
            <option key={p.product_code} value={p.product_code}>
              {p.product_code} - {p.name}
            </option>
          ))}
        </select>
      </div>

      {selectedProduct && (
        <div className="bg-white p-8 rounded-lg shadow-lg text-center">
          <h2 className="text-xl font-bold mb-4">スキャンテスト用QRコード</h2>
          
          <div className="flex justify-center mb-6">
            <QRCodeCanvas
              value={JSON.stringify({
                code: selectedProduct.product_code,
                name: selectedProduct.name,
                shelf_no: selectedProduct.shelf_no || null,
              })}
              size={300}
              level="M"
            />
          </div>

          <div className="text-left bg-gray-100 p-4 rounded">
            <p className="font-semibold mb-2">QRコード内容:</p>
            <pre className="text-sm">
{JSON.stringify({
  code: selectedProduct.product_code,
  name: selectedProduct.name,
  shelf_no: selectedProduct.shelf_no || null,
}, null, 2)}
            </pre>
          </div>

          <div className="mt-4 text-sm text-gray-600">
            <p>この画面を開いたまま、別タブで <a href="/stock/scan" className="text-blue-600 underline">/stock/scan</a> を開いてカメラでこのQRコードをスキャンしてください</p>
          </div>
        </div>
      )}
    </div>
  )
}
