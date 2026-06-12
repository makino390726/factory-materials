'use client'

import { useState } from 'react'
import Link from 'next/link'

export default function ProductImportPage() {
  const [importType, setImportType] = useState<'products' | 'stocks' | 'parts-cost' | 'stock-receipt' | 'products-price-update'>('stocks')
  const [file, setFile] = useState<File | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [progress, setProgress] = useState(0)
  const [progressText, setProgressText] = useState('')
  const [detailedResult, setDetailedResult] = useState<any>(null)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0])
      setMessage(null)
      setDetailedResult(null)
    }
  }

  const handleImport = async () => {
    if (!file) {
      alert('ファイルを選択してください')
      return
    }

    setIsLoading(true)
    setMessage(null)
    setDetailedResult(null)
    setProgress(0)
    setProgressText('')

    try {
      const formData = new FormData()
      formData.append('file', file)

      if (importType === 'parts-cost') {
        // パーツマスター原価インポート
        const response = await fetch('/api/heater/parts-master/import-cost', {
          method: 'POST',
          body: formData,
        })

        const result = await response.json()

        if (response.ok) {
          setMessage({
            type: 'success',
            text: `${result.message}\n全体: ${result.total}件 / 成功: ${result.successCount}件 / 未検出: ${result.notFoundCount}件 / エラー: ${result.errorCount}件`,
          })
          setDetailedResult(result)
          setFile(null)
        } else {
          setMessage({
            type: 'error',
            text: result.error || 'インポートに失敗しました',
          })
        }
        setIsLoading(false)
      } else if (importType === 'stock-receipt') {
        // 入庫データ一括取込
        const response = await fetch('/api/stock/receipt/import', {
          method: 'POST',
          body: formData,
        })

        const result = await response.json()

        if (response.ok) {
          setMessage({
            type: 'success',
            text: `${result.message}\n成功: ${result.successCount}件${result.errorCount > 0 ? ` / エラー: ${result.errorCount}件` : ''}`,
          })
          setDetailedResult(result)
          setFile(null)
        } else {
          setMessage({
            type: 'error',
            text: result.error || 'インポートに失敗しました',
          })
        }
        setIsLoading(false)
      } else if (importType === 'products-price-update') {
        // 製品マスタ単価更新
        const response = await fetch('/api/products/import/price-update', {
          method: 'POST',
          body: formData,
        })

        const result = await response.json()

        if (response.ok) {
          setMessage({
            type: 'success',
            text: `${result.message}\n成功: ${result.successCount}件${result.updateCount > 0 ? ` / 更新: ${result.updateCount}件` : ''}${result.createCount > 0 ? ` / 新規: ${result.createCount}件` : ''}${result.errorCount > 0 ? ` / エラー: ${result.errorCount}件` : ''}`,
          })
          setDetailedResult(result)
          setFile(null)
        } else {
          setMessage({
            type: 'error',
            text: result.error || 'インポートに失敗しました',
          })
        }
        setIsLoading(false)
      } else if (importType === 'stocks') {
        const startResponse = await fetch('/api/products/import/stocks/start', {
          method: 'POST',
          body: formData,
        })

        const startResult = await startResponse.json()

        if (!startResponse.ok) {
          throw new Error(startResult.error || 'インポートに失敗しました')
        }

        const jobId = startResult.jobId as string

        const poll = setInterval(async () => {
          try {
            const progressResponse = await fetch(`/api/products/import/stocks/progress?jobId=${jobId}`)
            const progressResult = await progressResponse.json()

            if (!progressResponse.ok) {
              // ジョブが見つからない場合は処理完了とみなす
              if (progressResponse.status === 404) {
                clearInterval(poll)
                setMessage({
                  type: 'success',
                  text: 'インポートが完了しました',
                })
                setFile(null)
                setIsLoading(false)
                return
              }
              throw new Error(progressResult.error || '進捗取得に失敗しました')
            }

            const job = progressResult.job
            const percent = job.total > 0 ? Math.round((job.processed / job.total) * 100) : 0
            setProgress(percent)
            setProgressText(`${job.processed}/${job.total}件 処理中`)

            if (job.status === 'done') {
              clearInterval(poll)
              setMessage({
                type: 'success',
                text: `${job.message || 'インポート完了'}\n成功: ${job.successCount}件 / エラー: ${job.errorCount}件`,
              })
              setFile(null)
              setIsLoading(false)
            }

            if (job.status === 'error') {
              clearInterval(poll)
              setMessage({
                type: 'error',
                text: job.message || 'インポート処理に失敗しました',
              })
              setIsLoading(false)
            }
          } catch (pollError) {
            clearInterval(poll)
            setMessage({
              type: 'error',
              text: pollError instanceof Error ? pollError.message : '進捗取得に失敗しました',
            })
            setIsLoading(false)
          }
        }, 1000)
      } else {
        const response = await fetch('/api/products/import', {
          method: 'POST',
          body: formData,
        })

        const result = await response.json()

        if (response.ok) {
          setMessage({
            type: 'success',
            text: `${result.message}\n成功: ${result.successCount}件${result.errorCount > 0 ? ` / エラー: ${result.errorCount}件` : ''}`,
          })
          setFile(null)
        } else {
          setMessage({
            type: 'error',
            text: result.error || 'インポートに失敗しました',
          })
        }
      }
    } catch (error) {
      console.error('インポートエラー:', error)
      setMessage({
        type: 'error',
        text: 'インポート処理中にエラーが発生しました',
      })
    } finally {
      if (importType !== 'stocks') {
        setIsLoading(false)
      }
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 text-white p-8">
      <div className="max-w-2xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold">データインポート</h1>
          <Link
            href="/"
            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors"
          >
            ホーム
          </Link>
        </div>

        <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl p-6 shadow-2xl border border-blue-400/30 space-y-6">
          {/* 取込タイプ選択 */}
          <div>
            <label htmlFor="importType" className="block text-sm font-medium mb-2">
              取込タイプ選択
            </label>
            <select
              id="importType"
              value={importType}
              onChange={(e) => setImportType(e.target.value as 'products' | 'stocks' | 'parts-cost' | 'stock-receipt' | 'products-price-update')}
              className="w-full px-4 py-2 bg-slate-800 border-2 border-blue-400 rounded-lg text-white focus:outline-none focus:border-blue-300"
            >
              <option value="products">商品マスタ取込</option>
              <option value="products-price-update">製品マスタ単価更新</option>
              <option value="stocks">在庫マスタ取込</option>
              <option value="parts-cost">パーツマスター原価取込</option>
              <option value="stock-receipt">入庫データ一括取込</option>
            </select>
          </div>

          {/* ファイルアップロード */}
          <div>
            <label className="block text-sm font-medium mb-2">
              {importType === 'parts-cost' || importType === 'stock-receipt' ? 'CSV/Excelファイルをアップロード' : 'Excelファイルをアップロード'}
            </label>
            <p className="text-gray-400 mb-2">
              {importType === 'products' 
                ? '商品マスタ.xlsxファイルを選択してください。'
                : importType === 'products-price-update'
                ? '製品マスタ単価更新用のExcelファイルを選択してください。'
                : importType === 'parts-cost'
                ? 'パーツマスター原価のCSV/Excelファイルを選択してください。'
                : importType === 'stock-receipt'
                ? '入庫データのExcelファイルを選択してください。'
                : '在庫一覧.xlsxファイルを選択してください。'
              }
            </p>
            <p className="text-sm text-gray-500 mb-4">
              {importType === 'products'
                ? '必須カラム: 商品コード、製品名、仕入単価、原価'
                : importType === 'products-price-update'
                ? '必須カラム: 商品コード、商品名、単価。他のカラムは無視します。既存コードは購入価格・原価を同時更新し、新規コードは新規登録します。単価空欄は既存値を維持します。'
                : importType === 'parts-cost'
                ? '必須カラム: 商品コード(商品コード/product_code/コード/品番), 原価(原価/cost_price/単価/price)'
                : importType === 'stock-receipt'
                ? '必須カラム: 入荷日付、商品コード、商品名、総数（入荷数）、単価。単価がある場合は製品マスタの購入価格・原価も更新し、空欄は既存値を維持します。'
                : '必須カラム: 商品コード、在庫数、当月在庫単価、在庫金額、棚番。当月在庫単価がある場合は製品マスタの購入価格・原価も更新し、空欄は既存値を維持します。'
              }
            </p>

            <div className="flex items-center gap-4">
              <label className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg cursor-pointer transition-colors">
                ファイルを選択
                <input
                  type="file"
                  accept={importType === 'parts-cost' || importType === 'stock-receipt' ? '.csv,.xlsx,.xls' : '.xlsx,.xls'}
                  onChange={handleFileChange}
                  className="hidden"
                />
              </label>
              <span className="text-gray-400">
                {file ? file.name : '選択されていません'}
              </span>
            </div>
          </div>

          {/* インポート実行ボタン */}
          <button
            onClick={handleImport}
            disabled={!file || isLoading}
            className="w-full px-6 py-3 bg-green-600 hover:bg-green-500 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-lg font-semibold transition-colors"
          >
            {isLoading ? 'インポート中...' : 'インポート実行'}
          </button>

          {/* プログレスバー */}
          {isLoading && (
            <div className="w-full space-y-2">
              <div className="text-sm text-gray-400">{progressText || 'インポート処理中です。しばらくお待ちください…'}</div>
              <div className="w-full h-2 bg-slate-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-blue-400 via-cyan-400 to-purple-400 transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <div className="text-xs text-gray-500">{progress}%</div>
            </div>
          )}

          {/* メッセージ表示 */}
          {message && (
            <div
              className={`p-4 rounded-lg ${
                message.type === 'success'
                  ? 'bg-green-600/20 border border-green-400'
                  : 'bg-red-600/20 border border-red-400'
              }`}
            >
              <p className="whitespace-pre-line">{message.text}</p>
              
              {/* 詳細エラー表示（パーツマスター原価インポート用） */}
              {detailedResult?.errors && detailedResult.errors.length > 0 && (
                <div className="mt-4 bg-slate-900/50 p-3 rounded max-h-60 overflow-y-auto">
                  <p className="text-sm font-semibold mb-2 text-red-300">エラー詳細:</p>
                  {detailedResult.errors.map((error: string, index: number) => (
                    <p key={index} className="text-xs text-red-200 mb-1">
                      {error}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 使用方法 */}
          <div className="bg-slate-900/50 p-4 rounded-lg border border-blue-400/20">
            <h3 className="font-semibold mb-2">使用方法</h3>
            <ol className="text-sm text-gray-300 space-y-1 list-decimal list-inside">
              <li>取込タイプを選択（商品マスタ、製品マスタ単価更新、在庫マスタ、パーツマスター原価またはインポート実行）</li>
              <li>{importType === 'parts-cost' ? 'CSV/Excelファイル' : 'Excelファイル'}を選択</li>
              <li>「インポート実行」ボタンをクリック</li>
              <li>
                {importType === 'products-price-update'
                  ? '商品コードで紐づけて購入価格・原価を更新します（単価空欄は既存値維持、無い場合は新規登録）'
                  : importType === 'parts-cost' 
                  ? '商品コードで紐づけて原価を更新します（該当なしはスキップ）'
                  : importType === 'stock-receipt' || importType === 'stocks'
                  ? '在庫を更新し、単価列がある場合は製品マスタの購入価格・原価も更新します（空欄は既存値維持）'
                  : '既存の商品コードは更新、新規は追加されます'
                }
              </li>
            </ol>
          </div>
        </div>
      </div>
    </div>
  )
}
