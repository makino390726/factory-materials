'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  formatMonthLabel,
  getCurrentMonthDateRange,
  resolveAggregationMonth,
} from '@/lib/work-report-aggregation'
import Link from 'next/link'
import { buildProcessManagementPath } from '@/lib/process-management'

type SummaryRow = {
  report_id: string
  work_date: string
  work_minutes: number
  direct_minutes: number
  indirect_minutes: number
  staff: {
    id: string
    name: string
    department?: string | null
    login_id: string
  }
}

type DailyAggregation = {
  work_date: string
  direct_minutes: number
  indirect_minutes: number
}

type InstructionAggregation = {
  category: 'line' | 'instruction'
  code: string
  name: string
  duration_minutes: number
}

type MachineAggregation = {
  machine: string
  duration_minutes: number
}

type WorkGroupAggregation = {
  work_group_code: string
  work_group_name: string
  total_minutes: number
}

type StaffDetail = {
  staff: {
    id: string
    login_id: string
    name: string
    department?: string | null
    work_group_code?: string | null
  }
  reports: Array<{
    id: string
    staff_id: string
    work_date: string
    start_time: string
    end_time: string
    break_minutes: number
    work_minutes: number
    is_draft: boolean
    items: Array<{
      id: string
      report_id: string
      work_type: string
      work_content: string
      instruction_text?: string | null
      line_id?: string | null
      line_code?: string | null
      line_name?: string | null
      model?: string | null
      machine?: string | null
      notes?: string | null
      start_time: string
      end_time: string
      duration_minutes: number
    }>
  }>
}

type TabType = 'summary' | 'daily' | 'instruction' | 'machine' | 'work-group' | 'person-detail'

const formatMinutes = (value: number) => {
  const hours = Math.floor(value / 60)
  const minutes = value % 60
  return `${hours}h ${minutes.toString().padStart(2, '0')}m`
}

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

export default function WorkReportSummaryPage() {
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [rows, setRows] = useState<SummaryRow[]>([])
  const [dailyData, setDailyData] = useState<DailyAggregation[]>([])
  const [instructionData, setInstructionData] = useState<InstructionAggregation[]>([])
  const [machineData, setMachineData] = useState<MachineAggregation[]>([])
  const [workGroupData, setWorkGroupData] = useState<WorkGroupAggregation[]>([])
  const [staffDetails, setStaffDetails] = useState<StaffDetail[]>([])
  const [currentStaffIndex, setCurrentStaffIndex] = useState(0)
  const [editedItems, setEditedItems] = useState<Record<string, any>>({})
  const [activeTab, setActiveTab] = useState<TabType>('summary')
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isConfirmSaving, setIsConfirmSaving] = useState(false)
  const [confirmStatus, setConfirmStatus] = useState<string | null>(null)

  const confirmMonthLabel = useMemo(() => {
    if (!fromDate || !toDate) return ''
    const resolved = resolveAggregationMonth(fromDate, toDate)
    if ('error' in resolved) return ''
    return formatMonthLabel(resolved.monthKey)
  }, [fromDate, toDate])

  useEffect(() => {
    const { from, to } = getCurrentMonthDateRange()
    setFromDate(from)
    setToDate(to)
  }, [])

  const fetchSummary = async () => {
    if (!fromDate || !toDate) return
    setIsLoading(true)
    setError(null)
    try {
      const [summaryRes, dailyRes, instructionRes, machineRes, workGroupRes, detailsRes] = await Promise.all([
        fetch(`/api/work-reports/summary?from=${fromDate}&to=${toDate}`),
        fetch(`/api/work-reports/aggregations/daily?from=${fromDate}&to=${toDate}`),
        fetch(`/api/work-reports/aggregations/instruction?from=${fromDate}&to=${toDate}`),
        fetch(`/api/work-reports/aggregations/machine?from=${fromDate}&to=${toDate}`),
        fetch(`/api/work-reports/aggregations/work-group?from=${fromDate}&to=${toDate}`),
        fetch(`/api/work-reports/details?from=${fromDate}&to=${toDate}`),
      ])

      if (!summaryRes.ok) {
        const result = await summaryRes.json()
        throw new Error(result?.error || '集計に失敗しました')
      }

      const summaryData = await summaryRes.json()
      setRows(summaryData || [])

      const dailyJson = dailyRes.ok ? await dailyRes.json() : []
      setDailyData(dailyJson || [])

      const instructionJson = instructionRes.ok ? await instructionRes.json() : []
      setInstructionData(instructionJson || [])

      const machineJson = machineRes.ok ? await machineRes.json() : []
      setMachineData(machineJson || [])

      const workGroupJson = workGroupRes.ok ? await workGroupRes.json() : []
      setWorkGroupData(workGroupJson || [])

      const detailsJson = detailsRes.ok ? await detailsRes.json() : { success: false, data: [] }
      setStaffDetails(detailsJson?.data || [])
      setCurrentStaffIndex(0)
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : 'Unknown error')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    if (fromDate && toDate) {
      fetchSummary()
    }
  }, [fromDate, toDate])

  const totalDirect = useMemo(
    () => rows.reduce((sum, row) => sum + (row.direct_minutes || 0), 0),
    [rows]
  )
  const totalIndirect = useMemo(
    () => rows.reduce((sum, row) => sum + (row.indirect_minutes || 0), 0),
    [rows]
  )
  const totalWork = useMemo(
    () => rows.reduce((sum, row) => sum + (row.work_minutes || 0), 0),
    [rows]
  )

  const handleConfirmSave = async () => {
    if (!fromDate || !toDate) return

    const resolved = resolveAggregationMonth(fromDate, toDate)
    if ('error' in resolved) {
      setConfirmStatus(resolved.error)
      return
    }

    setIsConfirmSaving(true)
    setConfirmStatus(null)
    try {
      const response = await fetch('/api/work-reports/aggregations/monthly', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year: resolved.year, month: resolved.month }),
      })
      const result = await response.json()
      if (!response.ok) {
        throw new Error(result?.error || '月別集計の保存に失敗しました')
      }
      setConfirmStatus(`${formatMonthLabel(resolved.monthKey)}の月別実績を保存しました`)
      await fetchSummary()
    } catch (saveError) {
      setConfirmStatus(saveError instanceof Error ? saveError.message : '月別集計の保存に失敗しました')
    } finally {
      setIsConfirmSaving(false)
    }
  }

  const handlePrint = () => {
    if (activeTab !== 'person-detail') {
      window.print()
      return
    }

    const currentStaff = staffDetails[currentStaffIndex]
    if (!currentStaff) {
      window.print()
      return
    }

    const reportBlocks = currentStaff.reports
      .map((report) => {
        const rows = report.items.length
          ? report.items
              .map((item) => {
                const workContent = String(getItemValue(item, 'work_content') ?? '')
                const instructionText = String(getItemValue(item, 'instruction_text') ?? item.instruction_text ?? '')
                const lineName = String(item.line_name ?? '')
                const model = String(getItemValue(item, 'model') ?? '')
                const startTime = String(getItemValue(item, 'start_time') ?? '')
                const endTime = String(getItemValue(item, 'end_time') ?? '')
                const durationMinutes = Number(getItemValue(item, 'duration_minutes') ?? 0)
                const machine = String(getItemValue(item, 'machine') ?? '')
                const notes = String(getItemValue(item, 'notes') ?? '')

                const subLines = [
                  instructionText ? `D指令: ${instructionText}` : '',
                  lineName ? `L: ${lineName}` : '',
                  model ? `型式: ${model}` : '',
                ]
                  .filter(Boolean)
                  .map((line) => `<div class="sub">${escapeHtml(line)}</div>`)
                  .join('')

                return `
                  <tr>
                    <td><div class="main">${escapeHtml(workContent || '-')}</div>${subLines}</td>
                    <td class="center">${escapeHtml(startTime || '-')}</td>
                    <td class="center">${escapeHtml(endTime || '-')}</td>
                    <td class="center">${escapeHtml(formatMinutes(durationMinutes))}</td>
                    <td>${escapeHtml(machine || '-')}</td>
                    <td>${escapeHtml(notes || '-')}</td>
                  </tr>
                `
              })
              .join('')
          : '<tr><td colspan="6" class="center">明細がありません</td></tr>'

        return `
          <section class="report-block">
            <div class="report-head">
              <h3>${escapeHtml(report.work_date)}</h3>
              <div>${escapeHtml(`${report.start_time} ～ ${report.end_time}`)} / 休憩: ${escapeHtml(String(report.break_minutes))}分 / 勤務: ${escapeHtml(formatMinutes(report.work_minutes))}</div>
            </div>
            <table>
              <thead>
                <tr>
                  <th>作業内容</th>
                  <th>開始時間</th>
                  <th>終了時間</th>
                  <th>所要時間</th>
                  <th>使用した機械</th>
                  <th>備考</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
          </section>
        `
      })
      .join('')

    const printHtml = `
      <!doctype html>
      <html lang="ja">
        <head>
          <meta charset="utf-8" />
          <title>作業日報 明細印刷</title>
          <style>
            @page { size: A4 portrait; margin: 10mm; }
            * { box-sizing: border-box; }
            body { font-family: "Yu Gothic", "Meiryo", sans-serif; color: #111; margin: 0; }
            h1 { font-size: 16px; margin: 0 0 6px 0; }
            h2 { font-size: 13px; margin: 0 0 12px 0; font-weight: 600; }
            .meta { font-size: 11px; margin-bottom: 12px; }
            .report-block { margin-bottom: 10mm; break-inside: auto; page-break-inside: auto; }
            .report-head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; margin-bottom: 6px; border-bottom: 1px solid #999; padding-bottom: 4px; }
            .report-head h3 { font-size: 12px; margin: 0; }
            .report-head div { font-size: 10px; }
            table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 10px; }
            th, td { border: 1px solid #666; padding: 4px; vertical-align: top; white-space: normal; word-break: break-word; }
            th { background: #f1f1f1; font-weight: 700; }
            .center { text-align: center; }
            .main { font-weight: 600; }
            .sub { font-size: 9px; color: #444; margin-top: 1px; }
            thead { display: table-header-group; }
            tr { break-inside: auto; page-break-inside: auto; }
          </style>
        </head>
        <body>
          <h1>作業日報 集計レポート（人別明細）</h1>
          <h2>${escapeHtml(currentStaff.staff.name)} (${escapeHtml(currentStaff.staff.login_id)})</h2>
          <div class="meta">期間: ${escapeHtml(fromDate)} ～ ${escapeHtml(toDate)} / 印刷日時: ${escapeHtml(new Date().toLocaleString('ja-JP'))}</div>
          ${reportBlocks}
        </body>
      </html>
    `

    const existingFrame = document.getElementById('print-iframe') as HTMLIFrameElement | null
    if (existingFrame) existingFrame.remove()

    const iframe = document.createElement('iframe')
    iframe.id = 'print-iframe'
    iframe.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;border:none;visibility:hidden;'
    document.body.appendChild(iframe)

    const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document
    if (!iframeDoc) return

    iframeDoc.open()
    iframeDoc.write(printHtml)
    iframeDoc.close()

    window.setTimeout(() => {
      iframe.contentWindow?.focus()
      iframe.contentWindow?.print()
      window.setTimeout(() => iframe.remove(), 1000)
    }, 300)
  }

  // 時間差分を分単位で計算
  const calculateDuration = (startTime: string, endTime: string): number => {
    if (!startTime || !endTime) return 0
    const [sh, sm] = startTime.split(':').map(Number)
    const [eh, em] = endTime.split(':').map(Number)
    const startMinutes = sh * 60 + sm
    const endMinutes = eh * 60 + em
    return endMinutes >= startMinutes ? endMinutes - startMinutes : 0
  }

  // 明細の編集ハンドラー
  const handleItemChange = (itemId: string, field: string, value: string) => {
    setEditedItems((prev) => {
      const current = prev[itemId] || {}
      const updated = { ...current, [field]: value }

      // 時間の変更時は所要時間を再計算
      if (field === 'start_time' || field === 'end_time') {
        const startTime = field === 'start_time' ? value : current.start_time || ''
        const endTime = field === 'end_time' ? value : current.end_time || ''
        updated.duration_minutes = calculateDuration(startTime, endTime)
      }

      return { ...prev, [itemId]: updated }
    })
  }

  // 編集内容を取得（編集されていればeditedから、なければoriginalから）
  const getItemValue = (item: any, field: string): any => {
    return editedItems[item.id]?.[field] ?? item[field]
  }

  // 保存処理
  const handleSaveReport = async (reportId: string, staffId: string) => {
    const currentStaff = staffDetails[currentStaffIndex]
    const report = currentStaff.reports.find((r) => r.id === reportId)
    if (!report) return

    try {
      // 編集された明細を集める
      const updatedItems = report.items.map((item) => {
        const edited = editedItems[item.id]
        if (!edited) return item
        
        return {
          work_type: edited.work_type ?? item.work_type,
          work_content: edited.work_content ?? item.work_content,
          instruction_text: edited.instruction_text ?? item.instruction_text,
          line_id: edited.line_id ?? item.line_id,
          model: edited.model ?? item.model,
          machine: edited.machine ?? item.machine,
          notes: edited.notes ?? item.notes,
          start_time: edited.start_time ?? item.start_time,
          end_time: edited.end_time ?? item.end_time,
          duration_minutes: edited.duration_minutes ?? item.duration_minutes,
        }
      })

      // 日報全体を再計算
      const totalMinutes = updatedItems.reduce((sum, item) => sum + item.duration_minutes, 0)

      const response = await fetch('/api/work-reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          staff_id: staffId,
          work_date: report.work_date,
          start_time: report.start_time,
          end_time: report.end_time,
          break_minutes: report.break_minutes,
          work_minutes: totalMinutes,
          is_draft: report.is_draft,
          items: updatedItems,
        }),
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result?.error || '保存に失敗しました')
      }

      alert('保存しました')
      // 編集状態をクリア
      setEditedItems({})
      // データを再読み込み
      await fetchSummary()
    } catch (saveError) {
      alert(saveError instanceof Error ? saveError.message : '保存に失敗しました')
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-teal-950 to-slate-950 relative overflow-x-hidden p-8">
      <div className="absolute inset-0 opacity-10">
        <svg className="w-full h-full" viewBox="0 0 1200 800">
          <pattern id="circuit-summary" x="0" y="0" width="220" height="220" patternUnits="userSpaceOnUse">
            <path d="M 0 60 L 60 60 L 60 0" stroke="currentColor" strokeWidth="2" fill="none" className="text-teal-400" />
            <path d="M 180 180 L 120 180 L 120 220" stroke="currentColor" strokeWidth="2" fill="none" className="text-teal-400" />
            <circle cx="60" cy="60" r="3" fill="currentColor" className="text-teal-400" />
            <circle cx="120" cy="180" r="3" fill="currentColor" className="text-teal-400" />
          </pattern>
          <rect width="1200" height="800" fill="url(#circuit-summary)" />
        </svg>
      </div>

      <div className="relative z-10 max-w-6xl mx-auto">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between mb-8 print:hidden">
          <div>
            <p className="text-teal-200 text-sm uppercase tracking-[0.3em]">Report Summary</p>
            <h1 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-teal-300 via-emerald-300 to-cyan-300">
              作業日報 集計
            </h1>
          </div>
          <Link href="/">
            <button className="px-6 py-2 bg-gradient-to-r from-slate-700 to-slate-800 hover:from-slate-600 hover:to-slate-700 text-white font-medium rounded-lg transition-all duration-300 border border-slate-600 hover:border-slate-500">
              ← ホーム
            </button>
          </Link>
        </div>

        <div className="bg-white/95 rounded-2xl border border-teal-100 p-6 shadow-xl backdrop-blur mb-6 print:hidden">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label className="text-sm font-medium text-black">開始日</label>
              <input
                type="date"
                value={fromDate}
                onChange={(event) => setFromDate(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-black"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-black">終了日</label>
              <input
                type="date"
                value={toDate}
                onChange={(event) => setToDate(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-black"
              />
            </div>
            <div className="flex items-end gap-2">
              <button
                type="button"
                onClick={fetchSummary}
                disabled={isLoading}
                className="w-full rounded-lg bg-teal-600 px-4 py-2 text-white font-semibold hover:bg-teal-500 disabled:opacity-60"
              >
                {isLoading ? '読み込み中...' : '再読み込み'}
              </button>
              <button
                type="button"
                onClick={handleConfirmSave}
                disabled={isConfirmSaving || !confirmMonthLabel}
                className="w-full rounded-lg bg-emerald-600 px-4 py-2 text-white font-semibold hover:bg-emerald-500 disabled:opacity-60"
                title={confirmMonthLabel ? `${confirmMonthLabel}の月別実績を保存` : '同一月内の期間を指定してください'}
              >
                {isConfirmSaving ? '保存中...' : '確認保存'}
              </button>
            </div>
          </div>
          <p className="mt-3 text-xs text-slate-600">
            集計表示は上記の期間で絞り込みます。作業日報の確定保存時にも月別実績は自動更新されますが、集計内容を確認したうえで
            {confirmMonthLabel ? `「確認保存」すると${confirmMonthLabel}分のL指令・D指令実績を再集計して保存できます。` : '「確認保存」するには開始日・終了日を同一月内で指定してください。'}
          </p>
          {confirmStatus && (
            <p className={`mt-2 text-xs ${confirmStatus.includes('失敗') || confirmStatus.includes('指定') ? 'text-rose-600' : 'text-emerald-700'}`}>
              {confirmStatus}
            </p>
          )}
        </div>

        {error && (
          <div className="mb-6 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 print:hidden">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 mb-6">
          <div className="rounded-2xl border border-teal-100 bg-white/90 p-4 text-center shadow">
            <p className="text-xs text-slate-500">合計勤務時間</p>
            <p className="text-xl font-semibold text-slate-900">{formatMinutes(totalWork)}</p>
          </div>
          <div className="rounded-2xl border border-teal-100 bg-white/90 p-4 text-center shadow">
            <p className="text-xs text-slate-500">直接作業</p>
            <p className="text-xl font-semibold text-teal-600">{formatMinutes(totalDirect)}</p>
          </div>
          <div className="rounded-2xl border border-teal-100 bg-white/90 p-4 text-center shadow">
            <p className="text-xs text-slate-500">間接作業</p>
            <p className="text-xl font-semibold text-amber-600">{formatMinutes(totalIndirect)}</p>
          </div>
        </div>

        <div className="bg-white/95 rounded-2xl border border-teal-100 p-6 shadow-xl backdrop-blur">
          {/* 印刷用ヘッダー（画面では非表示） */}
          <div className="hidden print:block mb-6 pb-4 border-b border-slate-200">
            <h1 className="text-2xl font-bold text-slate-900 mb-2">作業日報 集計レポート</h1>
            <div className="text-sm text-slate-600">
              <p>集計期間: {fromDate} ～ {toDate}</p>
              <p>印刷日時: {new Date().toLocaleString('ja-JP')}</p>
            </div>
          </div>

          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-semibold text-slate-900">集計一覧</h2>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-sm text-slate-500">{isLoading ? '読み込み中...' : `${rows.length} 件`}</div>
              <button
                type="button"
                onClick={handlePrint}
                className="px-4 py-2 bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-700 hover:to-emerald-700 text-white font-medium rounded-lg transition-all duration-300 shadow-md flex items-center gap-2 print:hidden"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                </svg>
                PDF出力
              </button>
            </div>
          </div>

          <div className="mb-4 flex flex-wrap gap-2 border-b border-slate-200 pb-4">
            <button
              type="button"
              onClick={() => setActiveTab('person-detail')}
              className={`px-4 py-2 rounded-lg font-medium transition ${
                activeTab === 'person-detail'
                  ? 'bg-teal-600 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              人別明細・編集
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('summary')}
              className={`px-4 py-2 rounded-lg font-medium transition ${
                activeTab === 'summary'
                  ? 'bg-teal-600 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              人別・日別
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('daily')}
              className={`px-4 py-2 rounded-lg font-medium transition ${
                activeTab === 'daily'
                  ? 'bg-teal-600 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              直接・間接（日別）
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('instruction')}
              className={`px-4 py-2 rounded-lg font-medium transition ${
                activeTab === 'instruction'
                  ? 'bg-teal-600 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              作業指示別
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('machine')}
              className={`px-4 py-2 rounded-lg font-medium transition ${
                activeTab === 'machine'
                  ? 'bg-teal-600 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              機械仕様時間
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('work-group')}
              className={`px-4 py-2 rounded-lg font-medium transition ${
                activeTab === 'work-group'
                  ? 'bg-teal-600 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              作業グループ別
            </button>
          </div>

          <div className="overflow-x-auto text-black">
            {activeTab === 'summary' && (
              <table className="min-w-full text-sm">
                <thead className="text-left text-black">
                  <tr>
                    <th className="py-2 pr-4">日付</th>
                    <th className="py-2 pr-4">社員</th>
                    <th className="py-2 pr-4">班</th>
                    <th className="py-2 pr-4">勤務時間</th>
                    <th className="py-2 pr-4">直接</th>
                    <th className="py-2">間接</th>
                  </tr>
                </thead>
                <tbody className="text-black">
                  {rows.length === 0 && !isLoading ? (
                    <tr>
                      <td colSpan={6} className="py-6 text-center text-slate-400">
                        集計データがありません
                      </td>
                    </tr>
                  ) : (
                    rows.map((row) => (
                      <tr key={row.report_id} className="border-t border-slate-100">
                        <td className="py-3 pr-4 font-medium text-slate-900">{row.work_date}</td>
                        <td className="py-3 pr-4">{row.staff?.name}</td>
                        <td className="py-3 pr-4">{row.staff?.department || '-'}</td>
                        <td className="py-3 pr-4">{formatMinutes(row.work_minutes)}</td>
                        <td className="py-3 pr-4">{formatMinutes(row.direct_minutes || 0)}</td>
                        <td className="py-3">{formatMinutes(row.indirect_minutes || 0)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            )}

            {activeTab === 'daily' && (
              <table className="min-w-full text-sm">
                <thead className="text-left text-black">
                  <tr>
                    <th className="py-2 pr-4">日付</th>
                    <th className="py-2 pr-4">直接作業</th>
                    <th className="py-2">間接作業</th>
                  </tr>
                </thead>
                <tbody className="text-black">
                  {dailyData.length === 0 && !isLoading ? (
                    <tr>
                      <td colSpan={3} className="py-6 text-center text-slate-400">
                        集計データがありません
                      </td>
                    </tr>
                  ) : (
                    dailyData.map((row, index) => (
                      <tr key={`${row.work_date}-${index}`} className="border-t border-slate-100">
                        <td className="py-3 pr-4 font-medium text-slate-900">{row.work_date}</td>
                        <td className="py-3 pr-4 text-black">{formatMinutes(row.direct_minutes)}</td>
                        <td className="py-3 text-black">{formatMinutes(row.indirect_minutes)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            )}

            {activeTab === 'instruction' && (
              <table className="min-w-full text-sm">
                <thead className="text-left text-black">
                  <tr>
                    <th className="py-2 pr-4">区分</th>
                    <th className="py-2 pr-4">コード</th>
                    <th className="py-2 pr-4">名称</th>
                    <th className="py-2 pr-4">所要時間</th>
                    <th className="py-2">工程</th>
                  </tr>
                </thead>
                <tbody className="text-black">
                  {instructionData.length === 0 && !isLoading ? (
                    <tr>
                      <td colSpan={5} className="py-6 text-center text-slate-400">
                        集計データがありません
                      </td>
                    </tr>
                  ) : (
                    instructionData
                      .sort((a, b) => {
                        if (a.category !== b.category) {
                          return a.category === 'line' ? -1 : 1
                        }
                        return a.code.localeCompare(b.code)
                      })
                      .map((row) => (
                        <tr key={`${row.category}-${row.code}`} className="border-t border-slate-100">
                          <td className="py-3 pr-4 font-medium text-slate-900">
                            {row.category === 'line' ? 'L指令' : 'D指令'}
                          </td>
                          <td className="py-3 pr-4 font-medium text-slate-900">{row.code}</td>
                          <td className="py-3 pr-4">{row.name || '-'}</td>
                          <td className="py-3 pr-4">{formatMinutes(row.duration_minutes)}</td>
                          <td className="py-3">
                            <Link
                              href={buildProcessManagementPath(
                                row.category,
                                row.code,
                                toDate || fromDate
                              )}
                              className="text-indigo-600 hover:underline text-xs font-medium"
                            >
                              工程管理表
                            </Link>
                          </td>
                        </tr>
                      ))
                  )}
                </tbody>
              </table>
            )}

            {activeTab === 'machine' && (
              <table className="min-w-full text-sm">
                <thead className="text-left text-black">
                  <tr>
                    <th className="py-2 pr-4">機械</th>
                    <th className="py-2">仕様時間</th>
                  </tr>
                </thead>
                <tbody className="text-black">
                  {machineData.length === 0 && !isLoading ? (
                    <tr>
                      <td colSpan={2} className="py-6 text-center text-slate-400">
                        集計データがありません
                      </td>
                    </tr>
                  ) : (
                    machineData
                      .sort((a, b) => b.duration_minutes - a.duration_minutes)
                      .map((row) => (
                        <tr key={row.machine} className="border-t border-slate-100">
                          <td className="py-3 pr-4 font-medium text-slate-900">{row.machine}</td>
                          <td className="py-3">{formatMinutes(row.duration_minutes)}</td>
                        </tr>
                      ))
                  )}
                </tbody>
              </table>
            )}

            {activeTab === 'work-group' && (
              <table className="min-w-full text-sm">
                <thead className="text-left text-black">
                  <tr>
                    <th className="py-2 pr-4">作業グループコード</th>
                    <th className="py-2 pr-4">作業グループ名</th>
                    <th className="py-2">合計時間</th>
                  </tr>
                </thead>
                <tbody className="text-black">
                  {workGroupData.length === 0 && !isLoading ? (
                    <tr>
                      <td colSpan={3} className="py-6 text-center text-slate-400">
                        集計データがありません
                      </td>
                    </tr>
                  ) : (
                    workGroupData
                      .sort((a, b) => b.total_minutes - a.total_minutes)
                      .map((row) => (
                        <tr key={row.work_group_code} className="border-t border-slate-100">
                          <td className="py-3 pr-4 font-medium text-slate-900">{row.work_group_code}</td>
                          <td className="py-3 pr-4">{row.work_group_name}</td>
                          <td className="py-3">{formatMinutes(row.total_minutes)}</td>
                        </tr>
                      ))
                  )}
                </tbody>
              </table>
            )}

            {activeTab === 'person-detail' && staffDetails.length > 0 && (
              <div className="space-y-6">
                {/* ページネーション */}
                <div className="flex items-center justify-between border-b border-slate-200 pb-4">
                  <div className="flex items-center gap-4">
                    <button
                      type="button"
                      onClick={() => setCurrentStaffIndex(Math.max(0, currentStaffIndex - 1))}
                      disabled={currentStaffIndex === 0}
                      className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg font-medium hover:bg-slate-200 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      ← 前の人
                    </button>
                    <div className="text-lg font-semibold text-black">
                      {staffDetails[currentStaffIndex]?.staff.name} ({staffDetails[currentStaffIndex]?.staff.login_id})
                      <span className="text-sm text-black ml-2">
                        {currentStaffIndex + 1} / {staffDetails.length} 人
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setCurrentStaffIndex(Math.min(staffDetails.length - 1, currentStaffIndex + 1))}
                      disabled={currentStaffIndex >= staffDetails.length - 1}
                      className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg font-medium hover:bg-slate-200 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      次の人 →
                    </button>
                  </div>
                  <div className="text-sm text-black">
                    部署: {staffDetails[currentStaffIndex]?.staff.department || '-'} / 
                    班: {staffDetails[currentStaffIndex]?.staff.work_group_code || '-'}
                  </div>
                </div>

                {/* 日報明細 */}
                {staffDetails[currentStaffIndex]?.reports.map((report) => (
                  <div key={report.id} className="border border-slate-200 rounded-lg p-4 bg-slate-50">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-lg font-bold text-slate-900">{report.work_date}</h3>
                      <div className="flex items-center gap-4">
                        <div className="text-sm text-black">
                          {report.start_time} ～ {report.end_time} 
                          <span className="ml-2">休憩: {report.break_minutes}分</span>
                          <span className="ml-2 font-semibold">勤務: {formatMinutes(report.work_minutes)}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleSaveReport(report.id, report.staff_id)}
                          className="px-4 py-2 bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-700 hover:to-emerald-700 text-white font-semibold rounded-lg transition-all duration-300 shadow-md print:hidden"
                        >
                          保存
                        </button>
                      </div>
                    </div>

                    <table className="min-w-full text-xs border border-slate-300 print:hidden">
                      <thead className="bg-slate-200 text-left text-black">
                        <tr>
                          <th className="py-2 px-2 border-r border-slate-300">作業内容</th>
                          <th className="py-2 px-2 border-r border-slate-300">開始時間</th>
                          <th className="py-2 px-2 border-r border-slate-300">終了時間</th>
                          <th className="py-2 px-2 border-r border-slate-300">所要時間</th>
                          <th className="py-2 px-2 border-r border-slate-300">使用した機械</th>
                          <th className="py-2 px-2">備考</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white">
                        {report.items.length === 0 ? (
                          <tr>
                            <td colSpan={6} className="py-4 text-center text-slate-400">
                              明細がありません
                            </td>
                          </tr>
                        ) : (
                          report.items.map((item, index) => (
                            <tr key={item.id} className="border-t border-slate-300">
                              <td className="py-2 px-2 border-r border-slate-300">
                                <input
                                  type="text"
                                  value={getItemValue(item, 'work_content')}
                                  onChange={(e) => handleItemChange(item.id, 'work_content', e.target.value)}
                                  className="w-full px-2 py-1 border border-slate-300 rounded text-sm font-medium focus:outline-none focus:border-teal-500"
                                />
                                {item.instruction_text && (
                                  <div className="text-xs text-black mt-1">D指令: {item.instruction_text}</div>
                                )}
                                {item.line_name && (
                                  <div className="text-xs text-black">L: {item.line_name}</div>
                                )}
                                {item.model && (
                                  <input
                                    type="text"
                                    value={getItemValue(item, 'model')}
                                    onChange={(e) => handleItemChange(item.id, 'model', e.target.value)}
                                    placeholder="型式"
                                    className="w-full px-2 py-1 border border-slate-300 rounded text-xs text-black mt-1 focus:outline-none focus:border-teal-500"
                                  />
                                )}
                              </td>
                              <td className="py-2 px-2 border-r border-slate-300 text-center">
                                <input
                                  type="time"
                                  value={getItemValue(item, 'start_time')}
                                  onChange={(e) => handleItemChange(item.id, 'start_time', e.target.value)}
                                  className="w-full px-2 py-1 border border-slate-300 rounded text-sm text-center focus:outline-none focus:border-teal-500"
                                />
                              </td>
                              <td className="py-2 px-2 border-r border-slate-300 text-center">
                                <input
                                  type="time"
                                  value={getItemValue(item, 'end_time')}
                                  onChange={(e) => handleItemChange(item.id, 'end_time', e.target.value)}
                                  className="w-full px-2 py-1 border border-slate-300 rounded text-sm text-center focus:outline-none focus:border-teal-500"
                                />
                              </td>
                              <td className="py-2 px-2 border-r border-slate-300 text-center font-semibold">
                                {formatMinutes(getItemValue(item, 'duration_minutes'))}
                              </td>
                              <td className="py-2 px-2 border-r border-slate-300">
                                <input
                                  type="text"
                                  value={getItemValue(item, 'machine') || ''}
                                  onChange={(e) => handleItemChange(item.id, 'machine', e.target.value)}
                                  className="w-full px-2 py-1 border border-slate-300 rounded text-sm focus:outline-none focus:border-teal-500"
                                />
                              </td>
                              <td className="py-2 px-2">
                                <input
                                  type="text"
                                  value={getItemValue(item, 'notes') || ''}
                                  onChange={(e) => handleItemChange(item.id, 'notes', e.target.value)}
                                  className="w-full px-2 py-1 border border-slate-300 rounded text-xs text-black focus:outline-none focus:border-teal-500"
                                />
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>

                    <table className="print-detail-table min-w-full text-xs border border-slate-300">
                      <thead className="bg-slate-200 text-left text-black">
                        <tr>
                          <th className="py-2 px-2 border-r border-slate-300">作業内容</th>
                          <th className="py-2 px-2 border-r border-slate-300">開始時間</th>
                          <th className="py-2 px-2 border-r border-slate-300">終了時間</th>
                          <th className="py-2 px-2 border-r border-slate-300">所要時間</th>
                          <th className="py-2 px-2 border-r border-slate-300">使用した機械</th>
                          <th className="py-2 px-2">備考</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white">
                        {report.items.length === 0 ? (
                          <tr>
                            <td colSpan={6} className="py-4 text-center text-slate-400">
                              明細がありません
                            </td>
                          </tr>
                        ) : (
                          report.items.map((item) => {
                            const workContent = getItemValue(item, 'work_content')
                            const instructionText = getItemValue(item, 'instruction_text') || item.instruction_text
                            const lineName = item.line_name
                            const model = getItemValue(item, 'model')
                            const startTime = getItemValue(item, 'start_time')
                            const endTime = getItemValue(item, 'end_time')
                            const durationMinutes = getItemValue(item, 'duration_minutes')
                            const machine = getItemValue(item, 'machine') || '-'
                            const notes = getItemValue(item, 'notes') || '-'

                            return (
                              <tr key={`${item.id}-print`} className="border-t border-slate-300">
                                <td className="py-2 px-2 border-r border-slate-300 align-top">
                                  <div className="font-medium text-black">{workContent}</div>
                                  {instructionText ? (
                                    <div className="text-[10px] text-black">D指令: {instructionText}</div>
                                  ) : null}
                                  {lineName ? (
                                    <div className="text-[10px] text-black">L: {lineName}</div>
                                  ) : null}
                                  {model ? (
                                    <div className="text-[10px] text-black">型式: {model}</div>
                                  ) : null}
                                </td>
                                <td className="py-2 px-2 border-r border-slate-300 text-center align-top">{startTime}</td>
                                <td className="py-2 px-2 border-r border-slate-300 text-center align-top">{endTime}</td>
                                <td className="py-2 px-2 border-r border-slate-300 text-center font-semibold align-top">
                                  {formatMinutes(durationMinutes)}
                                </td>
                                <td className="py-2 px-2 border-r border-slate-300 align-top">{machine}</td>
                                <td className="py-2 px-2 align-top">{notes}</td>
                              </tr>
                            )
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            )}

            {activeTab === 'person-detail' && staffDetails.length === 0 && !isLoading && (
              <div className="py-12 text-center text-slate-400">
                該当期間の日報データがありません
              </div>
            )}
          </div>
        </div>
      </div>

      <style jsx global>{`
        @media print {
          /* ヘッダーとナビゲーション、ボタンを非表示 */
          header,
          nav,
          .print\\:hidden,
          button {
            display: none !important;
          }

          /* 期間選択フォームを非表示 */
          input[type="date"],
          label {
            display: none !important;
          }

          /* ページ設定 */
          @page {
            margin: 1.5cm;
            size: A4 portrait;
          }

          /* 本体スタイル調整 */
          body {
            print-color-adjust: exact;
            -webkit-print-color-adjust: exact;
            background: white !important;
          }

          /* メインコンテナ */
          .min-h-screen {
            background: white !important;
          }

          /* 画面用のoverflow指定で印刷内容が途中で切れないようにする */
          .overflow-hidden,
          .overflow-x-auto {
            overflow: visible !important;
            page-break-inside: auto !important;
            break-inside: auto !important;
            max-height: none !important;
          }

          html,
          body,
          #__next {
            height: auto !important;
            overflow: visible !important;
          }

          /* 背景とボーダーを印刷 */
          * {
            print-color-adjust: exact;
            -webkit-print-color-adjust: exact;
          }

          /* タブボタンエリアを非表示 */
          .mb-4.flex.flex-wrap.gap-2.border-b,
          .flex.flex-wrap.gap-2.border-b {
            display: none !important;
          }

          /* テーブルスタイル最適化 */
          table {
            page-break-inside: auto;
            break-inside: auto;
            border-collapse: collapse;
            width: 100%;
            font-size: 11pt;
          }

          thead {
            display: table-header-group;
            font-weight: bold;
          }

          tr {
            page-break-inside: avoid;
            break-inside: avoid;
            page-break-after: auto;
          }

          /* 人別明細など縦に長いカードはページ跨ぎを許可して途中切れを防ぐ */
          .bg-white\/95.rounded-2xl.border.border-teal-100.p-6.shadow-xl.backdrop-blur,
          .space-y-6,
          .space-y-6 > div,
          .border.border-slate-200.rounded-lg.p-4.bg-slate-50 {
            page-break-inside: auto !important;
            break-inside: auto !important;
          }

          /* 既存グローバル印刷CSSの avoid 指定を上書き */
          div[class*='mb-'],
          section,
          article {
            page-break-inside: auto !important;
            break-inside: auto !important;
          }

          td, th {
            padding: 8px;
            border: 1px solid #ddd;
          }

          /* 合計ボックスの印刷スタイル */
          .grid.gap-4 {
            page-break-after: avoid;
            margin-bottom: 1.5rem;
            display: grid !important;
            grid-template-columns: repeat(3, 1fr);
            gap: 1rem;
          }

          .grid.gap-4 > div {
            border: 1px solid #ddd;
            padding: 0.75rem;
            text-align: center;
          }

          /* 集計一覧タイトル */
          h2 {
            page-break-after: avoid;
            margin-bottom: 1rem;
            font-size: 14pt;
          }

          /* 印刷時のヘッダー表示 */
          .print\\:block {
            display: block !important;
          }

          .print-detail-table {
            display: table !important;
            width: 100% !important;
            border-collapse: separate !important;
            border-spacing: 0 !important;
            page-break-inside: auto !important;
            break-inside: auto !important;
            table-layout: fixed !important;
          }

          .print-detail-table tr {
            page-break-inside: auto !important;
            break-inside: auto !important;
            page-break-after: auto !important;
          }

          .print-detail-table th,
          .print-detail-table td {
            white-space: normal !important;
            overflow: visible !important;
            line-height: 1.35 !important;
            vertical-align: top !important;
            word-break: break-word !important;
          }

          /* カード背景を白に */
          .bg-white\\/95,
          .bg-white\\/90 {
            background: white !important;
            border: 1px solid #ddd !important;
            box-shadow: none !important;
          }

          /* 不要な装飾を削除 */
          .rounded-2xl,
          .rounded-xl,
          .shadow,
          .shadow-xl,
          .backdrop-blur {
            box-shadow: none !important;
          }
        }

        .print-detail-table {
          display: none;
        }
      `}</style>
    </div>
  )
}
