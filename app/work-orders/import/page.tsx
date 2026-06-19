'use client'

import { useState } from 'react'
import Link from 'next/link'

export default function WorkOrdersImportPage() {
  const [file, setFile] = useState<File | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [detailedErrors, setDetailedErrors] = useState<string[]>([])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0])
      setMessage(null)
      setDetailedErrors([])
    }
  }

  const handleImport = async () => {
    if (!file) {
      alert('ファイルを選択してください')
      return
    }

    setIsLoading(true)
    setMessage(null)
    setDetailedErrors([])

    try {
      const formData = new FormData()
      formData.append('file', file)

      const response = await fetch('/api/work-orders/import', {
        method: 'POST',
        body: formData,
      })

      const result = await response.json()

      if (response.ok) {
        setMessage({
          type: 'success',
          text: result.message,
        })
        setFile(null)
        // フォームをリセット
        const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
        if (fileInput) fileInput.value = ''
      } else {
        setMessage({
          type: 'error',
          text: result.error || 'インポートに失敗しました',
        })
        if (result.errors && Array.isArray(result.errors)) {
          setDetailedErrors(result.errors)
        }
      }
    } catch (error: any) {
      setMessage({
        type: 'error',
        text: `通信エラー: ${error.message}`,
      })
    } finally {
      setIsLoading(false)
    }
  }

  const downloadTemplate = () => {
    // テンプレートCSVをダウンロード
    const header = 'D指令番号,製品名,型式,code_type,作業内容,数量,ステータス'
    const template = [
      header,
      'ORD-001,ヒーター本体,HT-2000,特A/B,組立作業,10,未開始',
      'ORD-001,ヒーター本体,HT-2000,特C,検査,5,',
      'ORD-003,,,,,,',
      '',
    ].join('\n')

    const blob = new Blob([template], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = 'work_orders_template.csv'
    link.click()
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-indigo-950 to-slate-950 relative overflow-hidden">
      {/* 背景パターン */}
      <div className="absolute inset-0 opacity-10">
        <svg className="w-full h-full" viewBox="0 0 1200 800">
          <pattern id="circuit" x="0" y="0" width="200" height="200" patternUnits="userSpaceOnUse">
            <path d="M 0 50 L 50 50 L 50 0" stroke="currentColor" strokeWidth="2" fill="none" className="text-indigo-400" />
            <path d="M 150 150 L 100 150 L 100 200" stroke="currentColor" strokeWidth="2" fill="none" className="text-indigo-400" />
            <circle cx="50" cy="50" r="3" fill="currentColor" className="text-indigo-400" />
            <circle cx="100" cy="150" r="3" fill="currentColor" className="text-indigo-400" />
          </pattern>
          <rect width="1200" height="800" fill="url(#circuit)" />
        </svg>
      </div>

      <div className="relative z-10 flex flex-col items-center justify-center min-h-screen px-4 py-12">
        {/* ヘッダー */}
        <div className="mb-12 space-y-3 text-center">
          <h1 className="text-5xl font-bold text-white">D指令</h1>
          <h2 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 via-purple-400 to-indigo-400">
            CSVインポート
          </h2>
        </div>

        {/* メインカード */}
        <div className="w-full max-w-2xl">
          <div className="bg-gradient-to-br from-indigo-950/40 via-purple-950/40 to-slate-950/40 rounded-3xl border-2 border-indigo-400/50 backdrop-blur-sm p-8 space-y-6">
            {/* ファイル選択エリア */}
            <div className="space-y-4">
              <label className="block text-lg font-bold text-indigo-300 mb-3">
                CSVファイルを選択
              </label>

              <div className="relative">
                <input
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  onChange={handleFileChange}
                  className="hidden"
                  id="file-input"
                  disabled={isLoading}
                />
                <label
                  htmlFor="file-input"
                  className="flex flex-col items-center justify-center gap-2 p-8 border-2 border-dashed border-indigo-400/60 rounded-2xl hover:border-indigo-300 hover:bg-indigo-500/10 cursor-pointer transition-all duration-300"
                >
                  <div className="text-4xl">📁</div>
                  <div className="text-center">
                    <p className="text-indigo-300 font-semibold">ファイルを選択またはドラッグ&ドロップ</p>
                    <p className="text-indigo-400 text-sm mt-1">CSV / Excel形式</p>
                  </div>
                </label>
              </div>

              {file && (
                <div className="p-3 bg-indigo-500/20 border border-indigo-400/50 rounded-lg">
                  <p className="text-indigo-300 text-sm">
                    ✓ 選択済み: <span className="font-semibold">{file.name}</span>
                  </p>
                </div>
              )}
            </div>

            {/* メッセージ表示 */}
            {message && (
              <div
                className={`p-4 rounded-lg border ${
                  message.type === 'success'
                    ? 'bg-emerald-500/20 border-emerald-400/50 text-emerald-300'
                    : 'bg-red-500/20 border-red-400/50 text-red-300'
                }`}
              >
                <p className="font-semibold">{message.text}</p>
              </div>
            )}

            {/* エラー詳細表示 */}
            {detailedErrors.length > 0 && (
              <div className="space-y-2 max-h-64 overflow-y-auto bg-red-950/30 border border-red-400/30 rounded-lg p-4">
                <p className="text-red-300 font-semibold text-sm mb-2">エラー詳細:</p>
                {detailedErrors.map((error, idx) => (
                  <p key={idx} className="text-red-400 text-xs font-mono">
                    • {error}
                  </p>
                ))}
              </div>
            )}

            {/* アクションボタン */}
            <div className="flex flex-col gap-3 pt-4">
              <button
                onClick={handleImport}
                disabled={!file || isLoading}
                className="w-full px-6 py-3 bg-gradient-to-r from-indigo-500 to-purple-500 hover:from-indigo-600 hover:to-purple-600 disabled:from-gray-600 disabled:to-gray-700 text-white font-bold rounded-xl transition-all duration-300 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {isLoading ? (
                  <>
                    <div className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    インポート中...
                  </>
                ) : (
                  <>
                    <span>📥</span>
                    インポート実行
                  </>
                )}
              </button>

              <button
                onClick={downloadTemplate}
                disabled={isLoading}
                className="w-full px-6 py-3 bg-gradient-to-r from-slate-600 to-gray-700 hover:from-slate-700 hover:to-gray-800 disabled:opacity-50 text-white font-bold rounded-xl transition-all duration-300 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                <span>📋</span>
                テンプレートをダウンロード
              </button>

              <Link href="/work-orders">
                <button className="w-full px-6 py-3 bg-gradient-to-r from-slate-700 to-slate-800 hover:from-slate-800 hover:to-slate-900 text-white font-bold rounded-xl transition-all duration-300 flex items-center justify-center gap-2">
                  <span>🔙</span>
                  マスタに戻る
                </button>
              </Link>
            </div>
          </div>

          {/* 説明セクション */}
          <div className="mt-8 bg-indigo-950/30 border border-indigo-400/30 rounded-2xl p-6">
            <h3 className="text-lg font-bold text-indigo-300 mb-4">📌 CSVフォーマット仕様</h3>
            <div className="space-y-2 text-indigo-200 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <div className="font-mono text-indigo-400">D指令番号*</div>
                <div>必須、ユニーク</div>
                <div className="font-mono text-indigo-400">製品名</div>
                <div>オプション</div>
                <div className="font-mono text-indigo-400">型式</div>
                <div>オプション</div>
                <div className="font-mono text-indigo-400">code_type</div>
                <div>オプション（型式の別名列として取込）</div>
                <div className="font-mono text-indigo-400">作業内容</div>
                <div>オプション</div>
                <div className="font-mono text-indigo-400">数量</div>
                <div>オプション、整数</div>
                <div className="font-mono text-indigo-400">ステータス</div>
                <div>オプション、未開始/進行中/完了/保留/その他</div>
              </div>
              <p className="text-indigo-400 text-xs mt-4">* は必須項目です</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
