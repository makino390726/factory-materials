'use client'

import { useState } from 'react'

type ImportResult = {
  success?: boolean
  dry_run?: boolean
  message?: string
  error?: string
  parse?: {
    source_rows: number
    report_count: number
    item_count: number
    duplicate_keys_collapsed: number
    skipped_count: number
  }
  imported?: number
  overwritten?: number
  created?: number
  missing_staff?: string[]
  name_matched_staff?: string[]
  missing_lines?: string[]
  warnings?: string[]
  failed?: Array<{ login_id: string; work_date: string; error: string }>
  months_synced?: string[]
  sample_reports?: unknown[]
  skipped_sample?: unknown[]
  warning_sample?: string[]
}

export default function ShinseiWorkReportImportSection() {
  const [file, setFile] = useState<File | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const runImport = async (dryRun: boolean) => {
    if (!file) {
      setError('CSVファイルを選択してください')
      return
    }
    setIsLoading(true)
    setError(null)
    setResult(null)
    try {
      const formData = new FormData()
      formData.append('file', file)
      if (dryRun) formData.append('dry_run', '1')
      const res = await fetch('/api/work-reports/import-shinsei', {
        method: 'POST',
        body: formData,
      })
      const data = (await res.json()) as ImportResult
      if (!res.ok) throw new Error(data.error || '取込に失敗しました')
      setResult(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="rounded-2xl border border-teal-200 bg-teal-50/80 p-5 shadow-sm">
      <h2 className="text-lg font-semibold text-teal-900">申請書CSV → 作業日報 取込</h2>
      <p className="mt-1 text-sm text-teal-800">
        製造作業日報（申請書）CSVを、社員コード＋作業日で突合して取込みます。既存日報がある場合は明細ごと上書きします。
      </p>
      <ul className="mt-2 list-disc pl-5 text-xs text-teal-900/80 space-y-1">
        <li>社員コード → staffs.login_id</li>
        <li>ライン列（例: 906：SK-500LT）→ L指令</li>
        <li>指令列 → D指令番号を抽出（例: D令8-63… → 8-63）</li>
        <li>作業区分「直接作業／間接作業」→ 直接／間接</li>
      </ul>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <input
          type="file"
          accept=".csv,.xlsx,.xls,text/csv"
          onChange={(e) => {
            setFile(e.target.files?.[0] || null)
            setResult(null)
            setError(null)
          }}
          className="text-sm"
        />
        <button
          type="button"
          disabled={isLoading || !file}
          onClick={() => runImport(true)}
          className="rounded-lg border border-teal-300 bg-white px-3 py-2 text-sm font-medium text-teal-800 disabled:opacity-50"
        >
          事前チェック
        </button>
        <button
          type="button"
          disabled={isLoading || !file}
          onClick={() => {
            if (
              !window.confirm(
                '既存の同一社員・同一日の作業日報を上書きします。実行しますか？'
              )
            ) {
              return
            }
            void runImport(false)
          }}
          className="rounded-lg bg-teal-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {isLoading ? '取込中…' : '取込実行（上書き）'}
        </button>
      </div>

      {error && (
        <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </div>
      )}

      {result && (
        <div className="mt-3 rounded-lg border border-teal-200 bg-white px-3 py-3 text-sm text-slate-800 space-y-2">
          {result.message && <p className="font-medium text-teal-800">{result.message}</p>}
          {result.dry_run && <p className="font-medium text-teal-800">事前チェック結果（DB未更新）</p>}
          {result.parse && (
            <p>
              元行 {result.parse.source_rows} → 日報 {result.parse.report_count}件 / 明細{' '}
              {result.parse.item_count}件（CSV内重複つぶし {result.parse.duplicate_keys_collapsed} /
              スキップ {result.parse.skipped_count}）
            </p>
          )}
          {typeof result.imported === 'number' && (
            <p>
              取込 {result.imported}（新規 {result.created} / 上書き {result.overwritten}）
            </p>
          )}
          {result.missing_staff && result.missing_staff.length > 0 && (
            <p className="text-amber-700">
              未登録社員: {result.missing_staff.join(', ')}
            </p>
          )}
          {result.name_matched_staff && result.name_matched_staff.length > 0 && (
            <p className="text-slate-600">
              氏名で突合: {result.name_matched_staff.join(', ')}
            </p>
          )}
          {result.missing_lines && result.missing_lines.length > 0 && (
            <p className="text-amber-700">
              未登録L指令: {result.missing_lines.join(', ')}
            </p>
          )}
          {result.months_synced && result.months_synced.length > 0 && (
            <p>月次同期: {result.months_synced.join(', ')}</p>
          )}
          {result.failed && result.failed.length > 0 && (
            <div>
              <p className="font-medium text-rose-700">失敗サンプル</p>
              <ul className="list-disc pl-5 text-xs">
                {result.failed.slice(0, 10).map((f, i) => (
                  <li key={`${f.login_id}-${f.work_date}-${i}`}>
                    {f.login_id} {f.work_date}: {f.error}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {(result.warnings || result.warning_sample) && (
            <details>
              <summary className="cursor-pointer text-xs text-slate-600">警告</summary>
              <ul className="mt-1 list-disc pl-5 text-xs text-slate-600">
                {(result.warnings || result.warning_sample || []).slice(0, 20).map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  )
}
