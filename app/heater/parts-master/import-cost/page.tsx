'use client'

import { useState } from 'react'

export default function PartsCostImportPage() {
  const [file, setFile] = useState<File | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [result, setResult] = useState<{
    type: 'success' | 'error'
    message: string
    total?: number
    successCount?: number
    errorCount?: number
    notFoundCount?: number
    errors?: string[]
  } | null>(null)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0])
      setResult(null)
    }
  }

  const handleImport = async () => {
    if (!file) {
      alert('ファイルを選択してください')
      return
    }

    setIsLoading(true)
    setResult(null)

    try {
      const formData = new FormData()
      formData.append('file', file)

      const response = await fetch('/api/heater/parts-master/import-cost', {
        method: 'POST',
        body: formData,
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'インポートに失敗しました')
      }

      setResult({
        type: 'success',
        message: data.message,
        total: data.total,
        successCount: data.successCount,
        errorCount: data.errorCount,
        notFoundCount: data.notFoundCount,
        errors: data.errors,
      })
      setFile(null)
    } catch (error: any) {
      setResult({
        type: 'error',
        message: error.message || 'インポートに失敗しました',
      })
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen p-8 bg-gray-50">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold mb-8">パーツマスター原価インポート</h1>

        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">CSVファイル形式</h2>
          <div className="bg-gray-100 p-4 rounded mb-4">
            <p className="text-sm mb-2">以下のいずれかのカラム名に対応しています：</p>
            <ul className="text-sm space-y-1 ml-4">
              <li><strong>商品コード:</strong> 商品コード, product_code, コード, 品番</li>
              <li><strong>原価:</strong> 原価, cost_price, 単価, price</li>
            </ul>
          </div>
          <div className="bg-blue-50 p-4 rounded">
            <p className="text-sm font-medium mb-2">例：</p>
            <table className="text-sm border-collapse border border-gray-300">
              <thead>
                <tr className="bg-gray-200">
                  <th className="border border-gray-300 px-4 py-2">商品コード</th>
                  <th className="border border-gray-300 px-4 py-2">原価</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="border border-gray-300 px-4 py-2">P001</td>
                  <td className="border border-gray-300 px-4 py-2">1500</td>
                </tr>
                <tr>
                  <td className="border border-gray-300 px-4 py-2">P002</td>
                  <td className="border border-gray-300 px-4 py-2">2500</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">ファイル選択</h2>
          
          <div className="mb-4">
            <input
              type="file"
              accept=".csv, .xlsx, .xls"
              onChange={handleFileChange}
              className="block w-full text-sm text-gray-900 border border-gray-300 rounded-lg cursor-pointer bg-gray-50 focus:outline-none p-2"
              disabled={isLoading}
            />
            {file && (
              <p className="mt-2 text-sm text-gray-600">
                選択中: {file.name}
              </p>
            )}
          </div>

          <button
            onClick={handleImport}
            disabled={!file || isLoading}
            className={`px-6 py-3 rounded-lg font-semibold text-white ${
              !file || isLoading
                ? 'bg-gray-400 cursor-not-allowed'
                : 'bg-blue-600 hover:bg-blue-700'
            }`}
          >
            {isLoading ? 'インポート中...' : '原価をインポート'}
          </button>
        </div>

        {result && (
          <div
            className={`rounded-lg shadow p-6 ${
              result.type === 'success' ? 'bg-green-50' : 'bg-red-50'
            }`}
          >
            <h2
              className={`text-xl font-semibold mb-4 ${
                result.type === 'success' ? 'text-green-800' : 'text-red-800'
              }`}
            >
              {result.type === 'success' ? '✓ インポート完了' : '✗ エラー'}
            </h2>
            <p className="mb-4">{result.message}</p>

            {result.total !== undefined && (
              <div className="space-y-2 text-sm">
                <p>全体件数: {result.total}件</p>
                <p className="text-green-700">成功: {result.successCount}件</p>
                {result.notFoundCount! > 0 && (
                  <p className="text-yellow-700">未検出: {result.notFoundCount}件</p>
                )}
                {result.errorCount! > 0 && (
                  <p className="text-red-700">エラー: {result.errorCount}件</p>
                )}
              </div>
            )}

            {result.errors && result.errors.length > 0 && (
              <div className="mt-4">
                <h3 className="font-semibold mb-2 text-red-800">エラー詳細:</h3>
                <div className="bg-white rounded p-4 max-h-60 overflow-y-auto">
                  {result.errors.map((error, index) => (
                    <p key={index} className="text-sm text-red-600 mb-1">
                      {error}
                    </p>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
