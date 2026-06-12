'use client'

import { useState } from 'react'
import Link from 'next/link'
import Ec30BomImportSection from './Ec30BomImportSection'

type ImportType = 'work-orders' | 'machines' | 'work-contents' | 'lines'

interface ImportTypeOption {
  value: ImportType
  label: string
  icon: string
  color: string
  description: string
}

const IMPORT_TYPES: ImportTypeOption[] = [
  {
    value: 'work-orders',
    label: '作業指令マスタ',
    icon: '📋',
    color: 'indigo',
    description: '作業指令番号、製品名、型式、作業内容、数量、ステータス',
  },
  {
    value: 'machines',
    label: '機械設備分類マスタ',
    icon: '⚙️',
    color: 'blue',
    description: '作業グループコード、カテゴリコード、カテゴリ名',
  },
  {
    value: 'work-contents',
    label: '作業内容マスタ',
    icon: '🧩',
    color: 'amber',
    description: '作業グループコード、作業コード、作業名、印刷種別',
  },
  {
    value: 'lines',
    label: 'ラインマスタ',
    icon: '🏭',
    color: 'green',
    description: 'ラインコード、ライン名、表示順、有効',
  },
]

export default function MastersImportPage() {
  const [importType, setImportType] = useState<ImportType>('work-orders')
  const [file, setFile] = useState<File | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [detailedErrors, setDetailedErrors] = useState<string[]>([])

  const selectedType = IMPORT_TYPES.find((t) => t.value === importType)!

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
      formData.append('type', importType)

      const response = await fetch('/api/masters/import', {
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
    let header = ''
    let rows: string[] = []

    switch (importType) {
      case 'work-orders':
        header = '作業指令番号,製品名,型式,作業内容,数量,ステータス'
        rows = [
          'ORD-001,ヒーター本体,HT-2000,組立作業,10,未開始',
          'ORD-002,ヒーター本体,HT-3000,検査,5,',
          'ORD-003,,,,,',
        ]
        break
      case 'machines':
        header = '作業グループコード,カテゴリコード,カテゴリ名'
        rows = [
          'WG-01,1,プレス加工',
          'WG-01,2,溶接',
          'WG-02,1,組立',
          'WG-02,2,検査',
        ]
        break
      case 'lines':
        header = 'ラインコード,ライン名,表示順,有効'
        rows = [
          'LINE-A,第1ライン,1,はい',
          'LINE-B,第2ライン,2,はい',
          'LINE-C,第3ライン,3,いいえ',
        ]
        break
      case 'work-contents':
        header = '作業グループコード,作業コード,作業名,印刷種別'
        rows = [
          'WG-01,WK-001,組立,ラベル',
          'WG-01,WK-002,検査,帳票',
          'WG-02,WK-010,梱包,ラベル',
        ]
        break
    }

    const template = [header, ...rows, ''].join('\n')

    const blob = new Blob([template], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `${importType}_template.csv`
    link.click()
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-purple-950 to-slate-950 relative overflow-x-hidden">
      {/* 背景パターン */}
      <div className="absolute inset-0 opacity-10">
        <svg className="w-full h-full" viewBox="0 0 1200 800">
          <pattern id="circuit" x="0" y="0" width="200" height="200" patternUnits="userSpaceOnUse">
            <path d="M 0 50 L 50 50 L 50 0" stroke="currentColor" strokeWidth="2" fill="none" className="text-purple-400" />
            <path d="M 150 150 L 100 150 L 100 200" stroke="currentColor" strokeWidth="2" fill="none" className="text-purple-400" />
            <circle cx="50" cy="50" r="3" fill="currentColor" className="text-purple-400" />
            <circle cx="100" cy="150" r="3" fill="currentColor" className="text-purple-400" />
          </pattern>
          <rect width="1200" height="800" fill="url(#circuit)" />
        </svg>
      </div>

      <div className="relative z-10 flex flex-col items-center justify-start min-h-screen px-4 py-12 pb-24">
        {/* ヘッダー */}
        <div className="mb-8 space-y-3 text-center">
          <h1 className="text-5xl font-bold text-white">マスタ管理</h1>
          <h2 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 via-pink-400 to-purple-400">
            CSVインポート
          </h2>
          <p className="text-sm text-purple-200/90 max-w-xl mx-auto">
            マスタCSVは下の紫枠から。環境負荷低減型乾燥機の <strong className="text-white">図番管理表（BOM）</strong> は
            すぐ下の緑枠から取り込みます。
          </p>
        </div>

        <Ec30BomImportSection />

        {/* メインカード */}
        <div className="w-full max-w-4xl mt-10">
          <div className="bg-gradient-to-br from-purple-950/40 via-pink-950/40 to-slate-950/40 rounded-3xl border-2 border-purple-400/50 backdrop-blur-sm p-8 space-y-6">
            {/* インポート種別選択 */}
            <div className="space-y-4">
              <label className="block text-lg font-bold text-purple-300 mb-3">
                インポート種別を選択
              </label>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {IMPORT_TYPES.map((type) => (
                  <button
                    key={type.value}
                    onClick={() => setImportType(type.value)}
                    disabled={isLoading}
                    className={`p-4 rounded-xl border-2 transition-all duration-300 ${
                      importType === type.value
                        ? `border-${type.color}-400 bg-${type.color}-500/20 shadow-lg`
                        : 'border-slate-600 bg-slate-800/30 hover:border-slate-500'
                    }`}
                  >
                    <div className="text-4xl mb-2">{type.icon}</div>
                    <div className={`font-bold ${importType === type.value ? `text-${type.color}-300` : 'text-slate-300'}`}>
                      {type.label}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* ファイル選択エリア */}
            <div className="space-y-4">
              <label className="block text-lg font-bold text-purple-300 mb-3">
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
                  className="flex flex-col items-center justify-center gap-2 p-8 border-2 border-dashed border-purple-400/60 rounded-2xl hover:border-purple-300 hover:bg-purple-500/10 cursor-pointer transition-all duration-300"
                >
                  <div className="text-4xl">📁</div>
                  <div className="text-center">
                    <p className="text-purple-300 font-semibold">ファイルを選択またはドラッグ&ドロップ</p>
                    <p className="text-purple-400 text-sm mt-1">CSV / Excel形式</p>
                  </div>
                </label>
              </div>

              {file && (
                <div className="p-3 bg-purple-500/20 border border-purple-400/50 rounded-lg">
                  <p className="text-purple-300 text-sm">
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
                className="w-full px-6 py-3 bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 disabled:from-gray-600 disabled:to-gray-700 text-white font-bold rounded-xl transition-all duration-300 disabled:cursor-not-allowed flex items-center justify-center gap-2"
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

              <Link href="/">
                <button className="w-full px-6 py-3 bg-gradient-to-r from-slate-700 to-slate-800 hover:from-slate-800 hover:to-slate-900 text-white font-bold rounded-xl transition-all duration-300 flex items-center justify-center gap-2">
                  <span>🔙</span>
                  ホームに戻る
                </button>
              </Link>
            </div>
          </div>

          {/* 説明セクション */}
          <div className="mt-8 bg-purple-950/30 border border-purple-400/30 rounded-2xl p-6">
            <h3 className="text-lg font-bold text-purple-300 mb-4 flex items-center gap-2">
              {selectedType.icon} {selectedType.label} - フォーマット仕様
            </h3>
            <div className="space-y-2 text-purple-200 text-sm">
              <p className="text-purple-300 font-semibold mb-3">{selectedType.description}</p>

              {importType === 'work-orders' && (
                <div className="grid grid-cols-2 gap-2">
                  <div className="font-mono text-purple-400">作業指令番号*</div>
                  <div>必須、ユニーク</div>
                  <div className="font-mono text-purple-400">製品名</div>
                  <div>オプション</div>
                  <div className="font-mono text-purple-400">型式</div>
                  <div>オプション</div>
                  <div className="font-mono text-purple-400">作業内容</div>
                  <div>オプション</div>
                  <div className="font-mono text-purple-400">数量</div>
                  <div>オプション、整数（0以上）</div>
                  <div className="font-mono text-purple-400">ステータス</div>
                  <div>オプション、未開始/進行中/完了/保留/その他</div>
                </div>
              )}

              {importType === 'machines' && (
                <div className="grid grid-cols-2 gap-2">
                  <div className="font-mono text-purple-400">作業グループコード*</div>
                  <div>必須</div>
                  <div className="font-mono text-purple-400">カテゴリコード*</div>
                  <div>必須、整数</div>
                  <div className="font-mono text-purple-400">カテゴリ名*</div>
                  <div>必須</div>
                </div>
              )}

              {importType === 'work-contents' && (
                <div className="grid grid-cols-2 gap-2">
                  <div className="font-mono text-purple-400">作業グループコード*</div>
                  <div>必須</div>
                  <div className="font-mono text-purple-400">作業コード*</div>
                  <div>必須</div>
                  <div className="font-mono text-purple-400">作業名*</div>
                  <div>必須</div>
                  <div className="font-mono text-purple-400">印刷種別*</div>
                  <div>必須</div>
                </div>
              )}

              {importType === 'lines' && (
                <div className="grid grid-cols-2 gap-2">
                  <div className="font-mono text-purple-400">ラインコード*</div>
                  <div>必須、ユニーク</div>
                  <div className="font-mono text-purple-400">ライン名*</div>
                  <div>必須</div>
                  <div className="font-mono text-purple-400">表示順</div>
                  <div>オプション、整数（デフォルト: 0）</div>
                  <div className="font-mono text-purple-400">有効</div>
                  <div>オプション、はい/いいえ（デフォルト: はい）</div>
                </div>
              )}

              <p className="text-purple-400 text-xs mt-4">* は必須項目です</p>
              {importType === 'machines' && (
                <p className="text-purple-400 text-xs">⚠️ 作業グループコード + カテゴリコードの組み合わせが重複していた場合、全体がインポート中止されます</p>
              )}
              {importType === 'work-contents' && (
                <p className="text-purple-400 text-xs">⚠️ 作業グループコード + 作業コードの組み合わせが重複していた場合、全体がインポート中止されます</p>
              )}
              {importType !== 'machines' && importType !== 'work-contents' && (
                <p className="text-purple-400 text-xs">⚠️ 重複するコード/番号が見つかった場合、全体がインポート中止されます</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
