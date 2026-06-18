'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { buildProcessManagementPath, toProcessTargetKey } from '@/lib/process-management'
import {
  formatFiscalYearLabel,
  getCurrentFiscalYear,
  getFiscalYearDateRange,
} from '@/lib/fiscal-year'

type ProcessRow = {
  work_group_code: string
  work_group_name: string
  total_minutes: number
  avg_st_minutes: number | null
  baseline_st_minutes: number | null
  variation_pct: number | null
  is_bottleneck_by_st: boolean
  is_bottleneck_by_variation: boolean
}

type ProcessTarget = {
  target_type: 'line' | 'instruction'
  target_code: string
  name: string
  subtitle: string | null
}

type ProductionLotAnalysis = {
  lot: {
    id: string
    period_start: string
    period_end: string
    completed_qty: number
    receipt_slip_no: string | null
  }
  is_cumulative?: boolean
  total_lead_time_st: number | null
  rows: ProcessRow[]
  bottleneck_by_st: string | null
  bottleneck_by_variation: string | null
}

type ProductionLotsResult = {
  target_type: 'line' | 'instruction'
  target_code: string
  target_name: string
  suggested_period_start: string | null
  lots: ProductionLotAnalysis[]
  fiscal_year_summary: FiscalYearWorkGroupSummary | null
}

type FiscalYearWorkGroupSummary = {
  fiscal_year: number
  fiscal_year_label: string
  period_start: string
  period_end: string
  target_type: 'line' | 'instruction'
  target_code: string
  target_name: string
  annual_completed_qty: number
  total_minutes: number
  duration_hours: string
  rows: Array<{
    work_group_code: string
    work_group_name: string
    total_minutes: number
    duration_hours: string
    avg_st_minutes: number | null
  }>
}

const formatMinutes = (value: number) => {
  const hours = Math.floor(value / 60)
  const minutes = value % 60
  if (hours <= 0) return `${minutes}分`
  return `${hours}h ${minutes.toString().padStart(2, '0')}m`
}

const formatSt = (value: number | null) => {
  if (value === null) return '—'
  return `${value.toFixed(1)}分/台`
}

const formatVariation = (value: number | null) => {
  if (value === null) return '—'
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(1)}%`
}

function WorkGroupTable({ rows, emptyMessage }: { rows: ProcessRow[]; emptyMessage: string }) {
  return (
    <table className="min-w-full text-sm text-black">
      <thead className="text-left border-b border-slate-200">
        <tr>
          <th className="py-2 pr-4">作業グループ</th>
          <th className="py-2 pr-4">名称</th>
          <th className="py-2 pr-4 text-right">期間実績</th>
          <th className="py-2 pr-4 text-right">1台ST</th>
          <th className="py-2 pr-4 text-right">平均ST</th>
          <th className="py-2 pr-4 text-right">変動</th>
          <th className="py-2">判定</th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td colSpan={7} className="py-6 text-center text-slate-400">
              {emptyMessage}
            </td>
          </tr>
        ) : (
          rows.map((row) => (
            <tr
              key={row.work_group_code}
              className={`border-t border-slate-100 ${
                row.is_bottleneck_by_st || row.is_bottleneck_by_variation ? 'bg-rose-50' : ''
              }`}
            >
              <td className="py-3 pr-4 font-mono">{row.work_group_code}</td>
              <td className="py-3 pr-4">{row.work_group_name}</td>
              <td className="py-3 pr-4 text-right">{formatMinutes(row.total_minutes)}</td>
              <td className="py-3 pr-4 text-right font-semibold">{formatSt(row.avg_st_minutes)}</td>
              <td className="py-3 pr-4 text-right text-slate-600">
                {formatSt(row.baseline_st_minutes)}
              </td>
              <td
                className={`py-3 pr-4 text-right font-medium ${
                  (row.variation_pct ?? 0) > 0
                    ? 'text-rose-600'
                    : (row.variation_pct ?? 0) < 0
                      ? 'text-emerald-600'
                      : 'text-slate-600'
                }`}
              >
                {formatVariation(row.variation_pct)}
              </td>
              <td className="py-3">
                <div className="flex flex-wrap gap-1">
                  {row.is_bottleneck_by_st && (
                    <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs text-rose-700">
                      工程BN
                    </span>
                  )}
                  {row.is_bottleneck_by_variation && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
                      変動BN
                    </span>
                  )}
                  {!row.is_bottleneck_by_st && !row.is_bottleneck_by_variation && (
                    <span className="text-xs text-slate-400">OK</span>
                  )}
                </div>
              </td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  )
}

export default function ProcessManagementPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gradient-to-b from-slate-950 via-indigo-950 to-slate-950 p-8 text-white">
          読み込み中...
        </div>
      }
    >
      <ProcessManagementContent />
    </Suspense>
  )
}

function ProcessManagementContent() {
  const searchParams = useSearchParams()
  const today = new Date().toISOString().slice(0, 10)
  const initialTargetType = searchParams.get('target_type')
  const initialTargetCode = searchParams.get('target_code')?.trim() || ''
  const initialWorkDate = searchParams.get('work_date')?.trim() || today
  const initialTargetKey =
    (initialTargetType === 'line' || initialTargetType === 'instruction') && initialTargetCode
      ? toProcessTargetKey(initialTargetType, initialTargetCode)
      : ''

  const [targetKey, setTargetKey] = useState(initialTargetKey)
  const [targets, setTargets] = useState<ProcessTarget[]>([])
  const [targetsLoading, setTargetsLoading] = useState(true)
  const [periodEndInput, setPeriodEndInput] = useState(initialWorkDate)
  const [completedQtyInput, setCompletedQtyInput] = useState('')
  const [receiptSlipNoInput, setReceiptSlipNoInput] = useState('')
  const [lotsResult, setLotsResult] = useState<ProductionLotsResult | null>(null)
  const [selectedLotId, setSelectedLotId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [fiscalYear, setFiscalYear] = useState(getCurrentFiscalYear())
  const [fiscalSummary, setFiscalSummary] = useState<FiscalYearWorkGroupSummary | null>(null)
  const [fiscalLoading, setFiscalLoading] = useState(false)

  const fiscalYearOptions = useMemo(() => {
    const current = getCurrentFiscalYear()
    return Array.from({ length: 6 }, (_, index) => current - index)
  }, [])

  const selectedTarget = useMemo(() => {
    if (!targetKey) return null
    const [type, ...rest] = targetKey.split(':')
    const code = rest.join(':')
    if (type !== 'line' && type !== 'instruction') return null
    return (
      targets.find((item) => item.target_type === type && item.target_code === code) || {
        target_type: type as 'line' | 'instruction',
        target_code: code,
        name: code,
        subtitle: null,
      }
    )
  }, [targetKey, targets])

  const lineTargets = useMemo(() => targets.filter((item) => item.target_type === 'line'), [targets])
  const instructionTargets = useMemo(
    () => targets.filter((item) => item.target_type === 'instruction'),
    [targets]
  )

  const selectedLot = useMemo(() => {
    if (!lotsResult?.lots.length) return null
    if (selectedLotId) {
      return lotsResult.lots.find((item) => item.lot.id === selectedLotId) || null
    }
    return lotsResult.lots[lotsResult.lots.length - 1]
  }, [lotsResult, selectedLotId])

  const targetTypeLabel = selectedTarget?.target_type === 'instruction' ? 'D指令' : 'ライン'

  useEffect(() => {
    const loadTargets = async () => {
      setTargetsLoading(true)
      try {
        const res = await fetch('/api/process-management?list=targets')
        if (!res.ok) throw new Error('対象一覧の取得に失敗しました')
        const data = await res.json()
        const list = (data?.targets || []) as ProcessTarget[]
        setTargets(list)
        if (list.length > 0) {
          setTargetKey((current) => {
            if (current) return current
            if (initialTargetKey) return initialTargetKey
            const line909 = list.find(
              (item) => item.target_type === 'line' && item.target_code === '909'
            )
            if (line909) return toProcessTargetKey('line', '909')
            return toProcessTargetKey(list[0].target_type, list[0].target_code)
          })
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : '対象一覧の取得に失敗しました')
      } finally {
        setTargetsLoading(false)
      }
    }
    loadTargets()
  }, [initialTargetKey])

  useEffect(() => {
    if (!selectedTarget) return
    const nextPath = buildProcessManagementPath(
      selectedTarget.target_type,
      selectedTarget.target_code,
      periodEndInput
    )
    if (`${window.location.pathname}${window.location.search}` !== nextPath) {
      window.history.replaceState(null, '', nextPath)
    }
  }, [selectedTarget, periodEndInput])

  const fetchLots = async () => {
    if (!selectedTarget) return
    setIsLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({
        list: 'production-lots',
        target_type: selectedTarget.target_type,
        target_code: selectedTarget.target_code,
      })
      const res = await fetch(`/api/process-management?${params}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || '製作ロットの取得に失敗しました')
      const result = data as ProductionLotsResult
      setLotsResult(result)
      if (result.fiscal_year_summary) {
        setFiscalSummary(result.fiscal_year_summary)
        setFiscalYear(result.fiscal_year_summary.fiscal_year)
      }
      if (result.lots.length > 0) {
        setSelectedLotId(result.lots[result.lots.length - 1].lot.id)
      } else {
        setSelectedLotId(null)
      }
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : 'Unknown error')
      setLotsResult(null)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    if (selectedTarget) fetchLots()
  }, [targetKey])

  const loadFiscalSummary = async () => {
    if (!selectedTarget) return
    setFiscalLoading(true)
    try {
      const params = new URLSearchParams({
        list: 'fiscal-work-groups',
        target_type: selectedTarget.target_type,
        target_code: selectedTarget.target_code,
        fiscal_year: String(fiscalYear),
      })
      const res = await fetch(`/api/process-management?${params}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || '年度集計の取得に失敗しました')
      setFiscalSummary(data as FiscalYearWorkGroupSummary)
    } catch {
      setFiscalSummary(null)
    } finally {
      setFiscalLoading(false)
    }
  }

  useEffect(() => {
    if (selectedTarget) loadFiscalSummary()
  }, [selectedTarget, fiscalYear])

  const handleSaveLot = async () => {
    const qty = Number(completedQtyInput)
    if (!selectedTarget) return
    if (!periodEndInput) {
      alert('完成日を入力してください')
      return
    }
    if (!Number.isFinite(qty) || qty <= 0) {
      alert('完成台数は1以上の数値を入力してください')
      return
    }

    setIsSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/process-management', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target_type: selectedTarget.target_type,
          target_code: selectedTarget.target_code,
          period_end: periodEndInput,
          completed_qty: qty,
          receipt_slip_no: receiptSlipNoInput.trim() || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || '保存に失敗しました')
      const result = data as ProductionLotsResult
      setLotsResult(result)
      setCompletedQtyInput('')
      setReceiptSlipNoInput('')
      if (result.fiscal_year_summary) {
        setFiscalSummary(result.fiscal_year_summary)
        setFiscalYear(result.fiscal_year_summary.fiscal_year)
      }
      if (result.lots.length > 0) {
        setSelectedLotId(result.lots[result.lots.length - 1].lot.id)
      }
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '保存に失敗しました')
    } finally {
      setIsSaving(false)
    }
  }

  const handleDeleteLot = async (lotId: string) => {
    if (!selectedTarget) return
    if (!confirm('この製作ロットを削除しますか？')) return
    setError(null)
    try {
      const res = await fetch(`/api/process-management?lot_id=${encodeURIComponent(lotId)}`, {
        method: 'DELETE',
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || '削除に失敗しました')
      await fetchLots()
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : '削除に失敗しました')
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-indigo-950 to-slate-950 p-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between mb-8">
          <div>
            <p className="text-indigo-200 text-sm uppercase tracking-[0.3em]">Process Management</p>
            <h1 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-indigo-300 via-violet-300 to-purple-300">
              工程管理表
            </h1>
            <p className="text-slate-300 text-sm mt-2">
              製作開始〜完成入庫の期間で作業グループ別実績を集計し、完成台数で割った1台STを過去ロットと比較して工程進捗を確認します。
            </p>
          </div>
          <Link href="/">
            <button className="px-6 py-2 bg-slate-700 hover:bg-slate-600 text-white font-medium rounded-lg border border-slate-600">
              ← ホーム
            </button>
          </Link>
        </div>

        <div className="bg-white/95 rounded-2xl border border-indigo-100 p-6 shadow-xl mb-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-5">
            <div className="lg:col-span-2">
              <div className="flex items-center justify-between gap-2">
                <label className="text-sm font-medium text-black">対象（ライン / D指令）</label>
                <div className="flex gap-2 text-xs">
                  <Link href="/lines" className="text-indigo-600 hover:underline">
                    ラインマスタ
                  </Link>
                  <Link href="/work-orders" className="text-indigo-600 hover:underline">
                    指令マスタ
                  </Link>
                </div>
              </div>
              <select
                value={targetKey}
                onChange={(e) => setTargetKey(e.target.value)}
                disabled={targetsLoading || targets.length === 0}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-black disabled:bg-slate-100"
              >
                {targetsLoading ? (
                  <option value="">読み込み中...</option>
                ) : targets.length === 0 ? (
                  <option value="">ライン・指令が未登録です</option>
                ) : (
                  <>
                    {lineTargets.length > 0 && (
                      <optgroup label="ライン">
                        {lineTargets.map((item) => (
                          <option
                            key={toProcessTargetKey(item.target_type, item.target_code)}
                            value={toProcessTargetKey(item.target_type, item.target_code)}
                          >
                            {item.target_code} — {item.name}
                          </option>
                        ))}
                      </optgroup>
                    )}
                    {instructionTargets.length > 0 && (
                      <optgroup label="D指令">
                        {instructionTargets.map((item) => (
                          <option
                            key={toProcessTargetKey(item.target_type, item.target_code)}
                            value={toProcessTargetKey(item.target_type, item.target_code)}
                          >
                            {item.target_code}
                            {item.subtitle ? ` — ${item.subtitle}` : ''}
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </>
                )}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium text-black">完成日（入庫日）</label>
              <input
                type="date"
                value={periodEndInput}
                onChange={(e) => setPeriodEndInput(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-black"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-black">完成台数</label>
              <div className="mt-1 flex gap-2">
                <input
                  type="number"
                  min={1}
                  value={completedQtyInput}
                  onChange={(e) => setCompletedQtyInput(e.target.value)}
                  placeholder="6"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-black"
                />
                <span className="flex items-center text-sm text-slate-600 shrink-0">台</span>
              </div>
            </div>
            <div>
              <label className="text-sm font-medium text-black">入庫伝票番号</label>
              <input
                type="text"
                value={receiptSlipNoInput}
                onChange={(e) => setReceiptSlipNoInput(e.target.value)}
                placeholder="伝票番号"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-black"
              />
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={fetchLots}
              disabled={isLoading || !selectedTarget}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-white font-semibold hover:bg-indigo-500 disabled:opacity-60"
            >
              {isLoading ? '読み込み中...' : '再集計'}
            </button>
            <button
              type="button"
              onClick={handleSaveLot}
              disabled={isSaving || !selectedTarget}
              className="rounded-lg bg-violet-600 px-4 py-2 text-white font-semibold hover:bg-violet-500 disabled:opacity-60"
            >
              {isSaving ? '保存中...' : '入庫ロットを登録'}
            </button>
          </div>

          <p className="mt-3 text-xs text-slate-600">
            初回ロットは累計（最初の作業日報〜完成日）、同じ機種の前回入庫がある場合は前回完成日の翌日から集計します。
          </p>
        </div>

        {error && (
          <div className="mb-6 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        )}

        {lotsResult && (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 mb-6">
              <div className="rounded-2xl border border-indigo-100 bg-white/90 p-4 shadow">
                <p className="text-xs text-slate-500">対象</p>
                <p className="text-sm text-indigo-600 mb-1">{targetTypeLabel}</p>
                <p className="text-lg font-semibold text-slate-900">
                  {lotsResult.target_code} {lotsResult.target_name}
                </p>
              </div>
              <div className="rounded-2xl border border-indigo-100 bg-white/90 p-4 shadow">
                <p className="text-xs text-slate-500">登録ロット数</p>
                <p className="text-lg font-semibold text-slate-900">{lotsResult.lots.length}件</p>
              </div>
              <div className="rounded-2xl border border-indigo-100 bg-white/90 p-4 shadow">
                <p className="text-xs text-slate-500">次ロットの開始日（自動）</p>
                <p className="text-lg font-semibold text-indigo-700">
                  {lotsResult.suggested_period_start ||
                    (lotsResult.lots.length === 0 ? '累計（初回）' : '—')}
                </p>
              </div>
            </div>

            <div className="bg-white/95 rounded-2xl border border-indigo-100 p-6 shadow-xl mb-6 overflow-x-auto">
              <h2 className="text-lg font-semibold text-slate-900 mb-4">製作ロット一覧</h2>
              <table className="min-w-full text-sm text-black">
                <thead className="text-left border-b border-slate-200">
                  <tr>
                    <th className="py-2 pr-4">期間</th>
                    <th className="py-2 pr-4 text-right">完成台数</th>
                    <th className="py-2 pr-4">伝票</th>
                    <th className="py-2 pr-4 text-right">合計ST</th>
                    <th className="py-2">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {lotsResult.lots.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-6 text-center text-slate-400">
                        製作ロットが未登録です。上のフォームから入庫を登録してください。
                      </td>
                    </tr>
                  ) : (
                    lotsResult.lots.map((item, index) => (
                      <tr
                        key={item.lot.id}
                        className={`border-t border-slate-100 cursor-pointer hover:bg-indigo-50 ${
                          selectedLot?.lot.id === item.lot.id ? 'bg-indigo-50' : ''
                        }`}
                        onClick={() => setSelectedLotId(item.lot.id)}
                      >
                        <td className="py-3 pr-4">
                          <span className="font-medium">ロット{index + 1}</span>
                          <div className="text-xs text-slate-500">
                            {item.is_cumulative ? '累計 ' : ''}
                            {item.lot.period_start} 〜 {item.lot.period_end}
                          </div>
                        </td>
                        <td className="py-3 pr-4 text-right">{item.lot.completed_qty}台</td>
                        <td className="py-3 pr-4">{item.lot.receipt_slip_no || '—'}</td>
                        <td className="py-3 pr-4 text-right font-medium">
                          {formatSt(item.total_lead_time_st)}
                        </td>
                        <td className="py-3">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              handleDeleteLot(item.lot.id)
                            }}
                            className="text-xs text-rose-600 hover:underline"
                          >
                            削除
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {selectedLot && (
              <div className="bg-white/95 rounded-2xl border border-indigo-100 p-6 shadow-xl mb-6 overflow-x-auto">
                <h2 className="text-lg font-semibold text-slate-900 mb-1">
                  ロット詳細 — 作業グループ別 1台ST
                </h2>
                <p className="text-sm text-slate-600 mb-4">
                  {selectedLot.is_cumulative ? '累計 ' : ''}
                  {selectedLot.lot.period_start} 〜 {selectedLot.lot.period_end} /{' '}
                  {selectedLot.lot.completed_qty}台完成
                  {selectedLot.lot.receipt_slip_no ? ` / 伝票 ${selectedLot.lot.receipt_slip_no}` : ''}
                </p>
                <p className="text-xs text-slate-500 mb-4">
                  平均ST = 会計年度の作業グループ所要時間 ÷ 年間制作台数。ロットの1台STとの差（変動）で工程進捗を確認します。
                </p>
                <WorkGroupTable
                  rows={selectedLot.rows}
                  emptyMessage="この期間の該当作業日報がありません"
                />
              </div>
            )}
          </>
        )}

        {selectedTarget && (
          <div className="bg-white/95 rounded-2xl border border-indigo-100 p-6 shadow-xl mb-6 overflow-x-auto">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between mb-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">
                  会計年度 作業グループ別 平均ST
                </h2>
                <p className="text-sm text-slate-600 mt-1">
                  {selectedTarget.target_type === 'instruction' ? 'D指令' : 'ライン'}{' '}
                  {selectedTarget.target_code}（9月1日〜翌年8月31日）
                </p>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium text-black">年度</label>
                <select
                  value={fiscalYear}
                  onChange={(e) => setFiscalYear(Number(e.target.value))}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-black"
                >
                  {fiscalYearOptions.map((year) => {
                    const { start, end } = getFiscalYearDateRange(year)
                    return (
                      <option key={year} value={year}>
                        {formatFiscalYearLabel(year)}（{start} 〜 {end}）
                      </option>
                    )
                  })}
                </select>
              </div>
            </div>
            {fiscalLoading ? (
              <p className="text-sm text-slate-500 py-6 text-center">読み込み中...</p>
            ) : !fiscalSummary || fiscalSummary.rows.length === 0 ? (
              <p className="text-sm text-slate-400 py-6 text-center">データがありません</p>
            ) : (
              <>
                <p className="text-sm text-slate-700 mb-4">
                  年間制作台数:{' '}
                  <span className="font-semibold">{fiscalSummary.annual_completed_qty}台</span>
                  {fiscalSummary.annual_completed_qty <= 0 && (
                    <span className="text-amber-700 ml-2">
                      ※入庫ロットを登録すると平均STが算出されます
                    </span>
                  )}
                </p>
                <table className="min-w-full text-sm text-black">
                  <thead className="text-left border-b border-slate-200">
                    <tr>
                      <th className="py-2 pr-4">作業グループ</th>
                      <th className="py-2 pr-4">名称</th>
                      <th className="py-2 pr-4 text-right">所要時間</th>
                      <th className="py-2 pr-4 text-right">平均ST</th>
                      <th className="py-2 text-right">時間</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fiscalSummary.rows.map((row) => (
                      <tr key={row.work_group_code} className="border-t border-slate-100">
                        <td className="py-3 pr-4 font-mono">{row.work_group_code}</td>
                        <td className="py-3 pr-4">{row.work_group_name}</td>
                        <td className="py-3 pr-4 text-right">{formatMinutes(row.total_minutes)}</td>
                        <td className="py-3 pr-4 text-right font-semibold text-indigo-700">
                          {formatSt(row.avg_st_minutes)}
                        </td>
                        <td className="py-3 text-right text-slate-600">{row.duration_hours}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-3 text-xs text-slate-600">
                  平均ST = 所要時間 ÷ 年間制作台数（{fiscalSummary.period_start} 〜{' '}
                  {fiscalSummary.period_end}）。入庫ロット追加のたびに再計算されます。
                </p>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
