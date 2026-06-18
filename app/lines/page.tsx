'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { buildProcessManagementPath } from '@/lib/process-management'

type LineItem = {
  id: string
  line_code: string
  name: string
  sort_order: number
  is_active: boolean
  standard_duration_minutes: number | null
  part_key: string | null
  part_assignments?: Array<{
    id: string
    line_id: string
    part_key: string
    ratio: number
    common_group_label?: string | null
    allocation_models?: string[] | null
    bom_model_count?: number | null
    common_group_source?: string | null
    settings_confirmed?: boolean | null
    settings_confirmed_at?: string | null
    labor_recalc_at?: string | null
  }>
}

type Part = {
  id: string
  part_key: string
  part_name: string
}

type PartAssignment = {
  part_key: string
  ratio: number
  common_group_label?: string
  allocation_models?: string[] | null
  bom_model_count?: number | null
  common_group_source?: 'bom_auto' | 'manual'
  settings_confirmed?: boolean
}

type LaborSettingsRow = {
  assignment_id: string
  line_id: string
  line_code: string
  line_name: string
  part_key: string
  ratio: number
  common_group_label: string | null
  bom_model_count: number | null
  settings_confirmed: boolean
  labor_recalc_at: string | null
  preview: {
    total_duration_minutes: number
    planned_part_qty: number
    per_unit_duration_minutes: number | null
    per_unit_labor_cost: number
  }
}

type MonthlyDurationHistory = {
  month: string
  month_label: string
  fiscal_year: number
  fiscal_year_label: string
  duration_minutes: number
  duration_hours: string
}

export default function LinesPage() {
  const [lines, setLines] = useState<LineItem[]>([])
  const [parts, setParts] = useState<Part[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [searchLineCode, setSearchLineCode] = useState('')
  const [searchLineName, setSearchLineName] = useState('')
  const [formData, setFormData] = useState({
    line_code: '',
    name: '',
    sort_order: 0,
    is_active: true,
  })
  const [currentAssignments, setCurrentAssignments] = useState<PartAssignment[]>([])
  const [newPartKey, setNewPartKey] = useState('')
  const [newRatio, setNewRatio] = useState('100')
  const [showHistoryFor, setShowHistoryFor] = useState<string | null>(null)
  const [history, setHistory] = useState<MonthlyDurationHistory[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [monthlyByLine, setMonthlyByLine] = useState<Record<string, MonthlyDurationHistory[]>>({})
  const [monthlyLoading, setMonthlyLoading] = useState(false)
  const [monthlyError, setMonthlyError] = useState<string | null>(null)
  const [laborSettings, setLaborSettings] = useState<LaborSettingsRow[]>([])
  const [laborSettingsLoading, setLaborSettingsLoading] = useState(false)
  const [laborSettingsError, setLaborSettingsError] = useState<string | null>(null)
  const [laborActionLoading, setLaborActionLoading] = useState(false)

  const fetchMonthlyDurations = async () => {
    setMonthlyLoading(true)
    setMonthlyError(null)
    try {
      const response = await fetch('/api/work-reports/aggregations/monthly?category=line&all=1')
      const data = await response.json()
      if (!response.ok) {
        setMonthlyError(
          typeof data?.error === 'string' ? data.error : '月別実績の取得に失敗しました'
        )
        setMonthlyByLine({})
        return
      }
      setMonthlyByLine(data || {})
    } catch (err) {
      console.error('月別実績取得エラー:', err)
      setMonthlyError(err instanceof Error ? err.message : '月別実績の取得に失敗しました')
      setMonthlyByLine({})
    } finally {
      setMonthlyLoading(false)
    }
  }

  const fetchLineHistory = async (lineCode: string) => {
    const cached = monthlyByLine[lineCode]
    if (cached) {
      setHistory(cached)
      setHistoryError(null)
      return
    }

    setHistoryLoading(true)
    setHistoryError(null)
    try {
      const response = await fetch(
        `/api/work-reports/aggregations/monthly?category=line&code=${encodeURIComponent(lineCode)}`
      )
      const data = await response.json()
      if (!response.ok) {
        throw new Error(typeof data?.error === 'string' ? data.error : '履歴取得に失敗しました')
      }
      setHistory(Array.isArray(data) ? data : [])
    } catch (err) {
      console.error('履歴取得エラー:', err)
      setHistory([])
      setHistoryError(err instanceof Error ? err.message : '履歴取得に失敗しました')
    } finally {
      setHistoryLoading(false)
    }
  }

  const handleShowHistory = (lineCode: string) => {
    if (showHistoryFor === lineCode) {
      setShowHistoryFor(null)
      setHistoryError(null)
    } else {
      setShowHistoryFor(lineCode)
      void fetchLineHistory(lineCode)
    }
  }

  const fetchLines = async (filters?: { lineCode?: string; lineName?: string }) => {
    setIsLoading(true)
    setError(null)
    try {
      const lineCode = (filters?.lineCode ?? searchLineCode).trim()
      const lineName = (filters?.lineName ?? searchLineName).trim()
      const params = new URLSearchParams()

      if (lineCode) {
        params.set('lineCode', lineCode)
      }

      if (lineName) {
        params.set('lineName', lineName)
      }

      const query = params.toString()
      const response = await fetch(`/api/lines${query ? `?${query}` : ''}`)
      if (!response.ok) throw new Error('Failed to fetch lines')
      const data = await response.json()
      setLines(data || [])
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : 'Unknown error')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchLines()
    fetchParts()
    fetchMonthlyDurations()
    fetchLaborSettings()
  }, [])

  const fetchLaborSettings = async () => {
    setLaborSettingsLoading(true)
    setLaborSettingsError(null)
    try {
      const response = await fetch('/api/lines/labor-settings')
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data?.error || '労賃按分設定の取得に失敗しました')
      }
      setLaborSettings(Array.isArray(data?.rows) ? data.rows : [])
    } catch (err) {
      console.error('labor settings fetch error:', err)
      setLaborSettingsError(err instanceof Error ? err.message : '労賃按分設定の取得に失敗しました')
      setLaborSettings([])
    } finally {
      setLaborSettingsLoading(false)
    }
  }

  const handleDetectCommonGroups = async () => {
    if (!confirm('BOMから共通明細を再検出します。手動修正した共通明細は維持されます。確認済みフラグは解除されます。よろしいですか？')) {
      return
    }

    setLaborActionLoading(true)
    setLaborSettingsError(null)
    try {
      const response = await fetch('/api/lines/labor-settings', { method: 'PATCH' })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data?.error || 'BOM再検出に失敗しました')
      }
      await fetchLines()
      await fetchLaborSettings()
      alert(`BOMから共通明細を再検出しました（${data.updated_count ?? 0}件）`)
    } catch (err) {
      setLaborSettingsError(err instanceof Error ? err.message : 'BOM再検出に失敗しました')
    } finally {
      setLaborActionLoading(false)
    }
  }

  const handleBulkLaborRecalc = async () => {
    const confirmedCount = laborSettings.filter((row) => row.settings_confirmed).length
    if (confirmedCount === 0) {
      alert('確認済みの割り当てがありません。各割り当ての「確認済み」にチェックを入れてから実行してください。')
      return
    }

    if (
      !confirm(
        `確認済み ${confirmedCount} 件の労賃を一括再計算します。\n制作所要時間 ÷ 製造計画部品数 で1個あたり工賃を算出し、パーツマスタ原価を更新します。よろしいですか？`
      )
    ) {
      return
    }

    setLaborActionLoading(true)
    setLaborSettingsError(null)
    try {
      const response = await fetch('/api/lines/labor-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ only_confirmed: true }),
      })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data?.error || '一括再計算に失敗しました')
      }
      await fetchLaborSettings()
      alert(
        `一括再計算が完了しました。\n成功: ${data.success_count ?? 0}件 / スキップ: ${data.skipped_count ?? 0}件 / 失敗: ${data.failed_count ?? 0}件`
      )
    } catch (err) {
      setLaborSettingsError(err instanceof Error ? err.message : '一括再計算に失敗しました')
    } finally {
      setLaborActionLoading(false)
    }
  }

  const handleSearchSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    await fetchLines({ lineCode: searchLineCode, lineName: searchLineName })
  }

  const handleSearchReset = async () => {
    setSearchLineCode('')
    setSearchLineName('')
    await fetchLines({ lineCode: '', lineName: '' })
  }

  const fetchParts = async () => {
    try {
      const response = await fetch('/api/heater/parts-master')
      if (!response.ok) throw new Error('部品マスタの取得に失敗しました')
      const data = await response.json()
      const list = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : []
      const mapped = (list || [])
        .map((p: any, index: number) => {
          const partKey = p.part_key || p.product_code || ''
          return {
            id: partKey || p.id || `part-${index}`,
            part_key: partKey,
            part_name: p.part_name || p.name || '',
          }
        })
        .filter((p: Part) => p.part_key)
        .sort((a: Part, b: Part) => a.part_key.localeCompare(b.part_key))

      console.debug('parts-master count:', mapped.length)
      setParts(mapped)
    } catch (err) {
      console.error('parts fetch error:', err)
    }
  }

  const resetForm = () => {
    setFormData({ line_code: '', name: '', sort_order: 0, is_active: true })
    setCurrentAssignments([])
    setNewPartKey('')
    setNewRatio('100')
    setEditingId(null)
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()

    if (!formData.line_code.trim() || !formData.name.trim()) {
      setError('ラインコードとライン名は必須です')
      return
    }

    setIsLoading(true)
    setError(null)
    try {
      const method = editingId ? 'PUT' : 'POST'
      const response = await fetch('/api/lines', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingId,
          line_code: formData.line_code.trim(),
          name: formData.name.trim(),
          sort_order: Number(formData.sort_order) || 0,
          is_active: Boolean(formData.is_active),
        }),
      })

      if (!response.ok) {
        const result = await response.json()
        throw new Error(result?.error || '保存に失敗しました')
      }

      const saved = await response.json()
      const lineId = editingId || saved.id

      // 割り当てを保存
      if (currentAssignments.length > 0 || (editingId && (lines.find((l) => l.id === editingId)?.part_assignments || []).length > 0)) {
        await savePartAssignments(lineId)
      }

      await fetchLines()
      await fetchLaborSettings()
      resetForm()
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Unknown error')
    } finally {
      setIsLoading(false)
    }
  }

  const handleEdit = (line: LineItem) => {
    setEditingId(line.id)
    setFormData({
      line_code: line.line_code,
      name: line.name,
      sort_order: line.sort_order ?? 0,
      is_active: line.is_active ?? true,
    })
    // 割り当てを読み込む
    const assignments: PartAssignment[] = (line.part_assignments || []).map((a: any) => ({
      part_key: a.part_key,
      ratio: a.ratio,
      common_group_label: a.common_group_label || '',
      allocation_models: Array.isArray(a.allocation_models) ? a.allocation_models : null,
      bom_model_count: a.bom_model_count ?? null,
      common_group_source: (a.common_group_source === 'manual' ? 'manual' : 'bom_auto') as PartAssignment['common_group_source'],
      settings_confirmed: Boolean(a.settings_confirmed),
    }))
    setCurrentAssignments(assignments)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleEditFromLaborRow = async (row: LaborSettingsRow) => {
    let line = lines.find((item) => item.id === row.line_id)

    if (!line) {
      try {
        const response = await fetch('/api/lines')
        if (!response.ok) throw new Error('ライン一覧の取得に失敗しました')
        const data = await response.json()
        const refreshed = Array.isArray(data) ? data : []
        setLines(refreshed)
        line = refreshed.find((item: LineItem) => item.id === row.line_id)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'ラインの取得に失敗しました')
        return
      }
    }

    if (!line) {
      setError(`ライン ${row.line_code} が見つかりませんでした`)
      return
    }

    handleEdit(line)
    requestAnimationFrame(() => {
      document.getElementById('line-edit-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }

  const handleAddPartAssignment = async () => {
    if (!newPartKey.trim()) {
      setError('部品キーを選択してください')
      return
    }

    if (currentAssignments.some((a) => a.part_key === newPartKey)) {
      setError('この部品キーは既に追加されています')
      return
    }

    const ratioNum = Math.max(0, Math.min(100, Number(newRatio) || 100))
    let commonGroupLabel = ''
    let allocationModels: string[] | null = null
    let bomModelCount: number | null = null

    try {
      const res = await fetch(
        `/api/heater/parts-commonality?part_key=${encodeURIComponent(newPartKey)}`
      )
      if (res.ok) {
        const data = await res.json()
        commonGroupLabel = data.common_group_label || ''
        allocationModels = Array.isArray(data.models) ? data.models : null
        bomModelCount = Number(data.bom_model_count || 0) || null
      }
    } catch (err) {
      console.error('commonality fetch error:', err)
    }

    setCurrentAssignments([
      ...currentAssignments,
      {
        part_key: newPartKey,
        ratio: ratioNum,
        common_group_label: commonGroupLabel,
        allocation_models: allocationModels,
        bom_model_count: bomModelCount,
        common_group_source: 'bom_auto',
        settings_confirmed: false,
      },
    ])
    setNewPartKey('')
    setNewRatio('100')
  }

  const handleAssignmentFieldChange = (
    partKey: string,
    field: keyof PartAssignment,
    value: string | boolean
  ) => {
    setCurrentAssignments((prev) =>
      prev.map((assignment) => {
        if (assignment.part_key !== partKey) return assignment
        if (field === 'common_group_label') {
          return {
            ...assignment,
            common_group_label: String(value),
            common_group_source: 'manual',
            settings_confirmed: false,
          }
        }
        if (field === 'settings_confirmed') {
          return { ...assignment, settings_confirmed: Boolean(value) }
        }
        return assignment
      })
    )
  }

  const handleRefreshCommonGroupFromBom = async (partKey: string) => {
    try {
      const res = await fetch(
        `/api/heater/parts-commonality?part_key=${encodeURIComponent(partKey)}`
      )
      if (!res.ok) return
      const data = await res.json()
      setCurrentAssignments((prev) =>
        prev.map((assignment) =>
          assignment.part_key === partKey
            ? {
                ...assignment,
                common_group_label: data.common_group_label || '',
                allocation_models: Array.isArray(data.models) ? data.models : null,
                bom_model_count: Number(data.bom_model_count || 0) || null,
                common_group_source: 'bom_auto',
                settings_confirmed: false,
              }
            : assignment
        )
      )
    } catch (err) {
      console.error('refresh common group error:', err)
    }
  }

  const handleDeletePartAssignment = (partKey: string) => {
    setCurrentAssignments(currentAssignments.filter((a) => a.part_key !== partKey))
  }

  const savePartAssignments = async (lineId: string) => {
    try {
      // 既存の割り当てを削除
      const existingLine = lines.find((l) => l.id === lineId)
      const existing = existingLine?.part_assignments || []

      // 削除対象: 既存だが新規にない
      for (const existing_a of existing) {
        if (!currentAssignments.some((a) => a.part_key === existing_a.part_key)) {
          const res = await fetch(
            `/api/lines/${lineId}/part-assignments?part_key=${encodeURIComponent(existing_a.part_key)}`,
            { method: 'DELETE' }
          )
          if (!res.ok) console.error('delete assignment failed', res.statusText)
        }
      }

      // 追加・更新対象
      for (const assignment of currentAssignments) {
        const isNew = !existing.some((a) => a.part_key === assignment.part_key)

        const res = await fetch(`/api/lines/${lineId}/part-assignments`, {
          method: isNew ? 'POST' : 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            part_key: assignment.part_key,
            ratio: assignment.ratio,
            common_group_label: assignment.common_group_label || null,
            allocation_models: assignment.allocation_models ?? null,
            bom_model_count: assignment.bom_model_count ?? null,
            common_group_source: assignment.common_group_source || 'bom_auto',
            settings_confirmed: Boolean(assignment.settings_confirmed),
          }),
        })

        if (!res.ok) {
          const result = await res.json()
          console.error('assignment save failed:', result?.error || res.statusText)
        }
      }
    } catch (err) {
      console.error('part assignments save error:', err)
    }
  }

  const handleDelete = async (line: LineItem) => {
    if (!confirm(`${line.name} を削除しますか？`)) return

    setIsLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/lines', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: line.id }),
      })

      if (!response.ok) {
        const result = await response.json()
        throw new Error(result?.error || '削除に失敗しました')
      }

      await fetchLines()
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Unknown error')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-sky-950 to-slate-950 relative overflow-hidden p-8">
      <div className="absolute inset-0 opacity-10">
        <svg className="w-full h-full" viewBox="0 0 1200 800">
          <pattern id="circuit-line" x="0" y="0" width="220" height="220" patternUnits="userSpaceOnUse">
            <path d="M 0 60 L 60 60 L 60 0" stroke="currentColor" strokeWidth="2" fill="none" className="text-sky-400" />
            <path d="M 180 180 L 120 180 L 120 220" stroke="currentColor" strokeWidth="2" fill="none" className="text-sky-400" />
            <circle cx="60" cy="60" r="3" fill="currentColor" className="text-sky-400" />
            <circle cx="120" cy="180" r="3" fill="currentColor" className="text-sky-400" />
          </pattern>
          <rect width="1200" height="800" fill="url(#circuit-line)" />
        </svg>
      </div>

      <div className="relative z-10 max-w-full mx-auto px-4">
        <div className="flex items-center justify-between mb-8">
          <div>
            <p className="text-sky-200 text-sm uppercase tracking-[0.3em]">Line Master</p>
            <h1 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-sky-300 via-cyan-300 to-blue-300">
              ラインマスタ
            </h1>
          </div>
          <Link href="/">
            <button className="px-6 py-2 bg-gradient-to-r from-slate-700 to-slate-800 hover:from-slate-600 hover:to-slate-700 text-white font-medium rounded-lg transition-all duration-300 border border-slate-600 hover:border-slate-500">
              ← ホーム
            </button>
          </Link>
        </div>

        {error && (
          <div className="bg-rose-50 border border-rose-200 rounded-lg p-4 mb-6 text-rose-700">
            {error}
          </div>
        )}

        <div className="bg-white/95 rounded-2xl shadow-xl border border-amber-100 p-6 backdrop-blur mb-6">
          <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">労賃按分設定（共通部品）</h2>
              <p className="mt-1 text-sm text-slate-600">
                各ラインの部品割り当てに共通明細（全機種、500・600系共通など）を設定し、確認後に一括で労賃を再計算します。
                計算式: 1個あたり工賃 = (制作所要時間 ÷ 製造計画部品数) から算出
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void handleDetectCommonGroups()}
                disabled={laborActionLoading}
                className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white text-sm font-medium rounded-lg disabled:opacity-50"
              >
                BOMから共通明細を再検出
              </button>
              <button
                type="button"
                onClick={() => void handleBulkLaborRecalc()}
                disabled={laborActionLoading}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white text-sm font-medium rounded-lg disabled:opacity-50"
              >
                確認済みの労賃を一括再計算
              </button>
            </div>
          </div>

          {laborSettingsError && (
            <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {laborSettingsError}
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-left bg-slate-50 text-slate-700">
                <tr>
                  <th className="px-3 py-2">ライン</th>
                  <th className="px-3 py-2">部品キー</th>
                  <th className="px-3 py-2">共通明細</th>
                  <th className="px-3 py-2 text-right">制作所要</th>
                  <th className="px-3 py-2 text-right">計画部品数</th>
                  <th className="px-3 py-2 text-right">1個あたり</th>
                  <th className="px-3 py-2 text-right">工賃/個</th>
                  <th className="px-3 py-2 text-center">確認</th>
                  <th className="px-3 py-2">最終再計算</th>
                  <th className="px-3 py-2 text-center">操作</th>
                </tr>
              </thead>
              <tbody>
                {laborSettingsLoading ? (
                  <tr>
                    <td colSpan={10} className="px-3 py-6 text-center text-slate-400">
                      読み込み中...
                    </td>
                  </tr>
                ) : laborSettings.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-3 py-6 text-center text-slate-400">
                      部品割り当てがありません
                    </td>
                  </tr>
                ) : (
                  laborSettings.map((row) => (
                    <tr
                      key={row.assignment_id}
                      className={`border-t border-slate-100 ${editingId === row.line_id ? 'bg-sky-50' : ''}`}
                    >
                      <td className="px-3 py-2 whitespace-nowrap">
                        {row.line_code}
                        <div className="text-[11px] text-slate-500">{row.line_name}</div>
                      </td>
                      <td className="px-3 py-2 font-medium">{row.part_key}</td>
                      <td className="px-3 py-2">
                        {row.common_group_label || '—'}
                        {row.bom_model_count ? (
                          <div className="text-[11px] text-slate-500">BOM {row.bom_model_count}機種</div>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {row.preview.total_duration_minutes.toLocaleString('ja-JP')}分
                      </td>
                      <td className="px-3 py-2 text-right">
                        {row.preview.planned_part_qty.toLocaleString('ja-JP')}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {row.preview.per_unit_duration_minutes ?? '—'}
                        {row.preview.per_unit_duration_minutes ? '分' : ''}
                      </td>
                      <td className="px-3 py-2 text-right font-medium text-amber-700">
                        ¥{row.preview.per_unit_labor_cost.toLocaleString('ja-JP')}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {row.settings_confirmed ? (
                          <span className="inline-block rounded bg-emerald-100 px-2 py-0.5 text-emerald-800">
                            済
                          </span>
                        ) : (
                          <span className="inline-block rounded bg-slate-100 px-2 py-0.5 text-slate-500">
                            未
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-[11px] text-slate-500 whitespace-nowrap">
                        {row.labor_recalc_at
                          ? new Date(row.labor_recalc_at).toLocaleString('ja-JP')
                          : '—'}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <button
                          type="button"
                          onClick={() => void handleEditFromLaborRow(row)}
                          className="px-2 py-1 rounded-md bg-emerald-600 text-white hover:bg-emerald-700 transition text-xs font-medium whitespace-nowrap"
                        >
                          編集
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="grid grid-cols-[500px_1fr] gap-6">
          <div id="line-edit-form" className="bg-white/95 rounded-2xl shadow-xl border border-sky-100 p-6 backdrop-blur h-fit sticky top-8">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">
              {editingId ? 'ラインを編集' : '新しいラインを追加'}
            </h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-black mb-1">ラインコード *</label>
                <input
                  type="text"
                  value={formData.line_code}
                  onChange={(event) =>
                    setFormData({ ...formData, line_code: event.target.value })
                  }
                  placeholder="例: A-2"
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg text-black focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-black mb-1">ライン名 *</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(event) => setFormData({ ...formData, name: event.target.value })}
                  placeholder="例: 組立第2ライン"
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg text-black focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-black mb-1">並び順</label>
                <input
                  type="number"
                  value={formData.sort_order}
                  onChange={(event) =>
                    setFormData({ ...formData, sort_order: Number(event.target.value) })
                  }
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg text-black focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  id="lineActive"
                  type="checkbox"
                  checked={formData.is_active}
                  onChange={(event) =>
                    setFormData({ ...formData, is_active: event.target.checked })
                  }
                  className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                />
                <label htmlFor="lineActive" className="text-sm text-slate-700">
                  有効
                </label>
              </div>

              {/* 部品割り当てセクション */}
              <div className="border-t border-slate-200 pt-4">
                <h3 className="text-sm font-semibold text-slate-900 mb-3">部品割り当て</h3>
                <div className="space-y-3">
                  <div className="grid grid-cols-[1fr_80px_auto] gap-2">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">部品キー</label>
                      <select
                        value={newPartKey}
                        onChange={(e) => setNewPartKey(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                      >
                        <option value="">選択...</option>
                        {parts
                          .filter((p) => !currentAssignments.some((a) => a.part_key === p.part_key))
                          .map((part) => (
                            <option key={part.id} value={part.part_key}>
                              {part.part_key} - {part.part_name}
                            </option>
                          ))}
                      </select>
                      <p className="mt-1 text-xs text-slate-500">部品件数: {parts.length}</p>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">割合（%）</label>
                      <input
                        type="number"
                        min="0"
                        max="100"
                        value={newRatio}
                        onChange={(e) => setNewRatio(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                      />
                    </div>
                    <div className="flex items-end">
                      <button
                        type="button"
                        onClick={handleAddPartAssignment}
                        className="px-3 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium rounded-lg transition"
                      >
                        追加
                      </button>
                    </div>
                  </div>

                  {currentAssignments.length > 0 && (
                    <div className="mt-3 border border-slate-200 rounded-lg overflow-hidden">
                      <table className="w-full text-sm">
                        <thead className="bg-slate-50">
                          <tr>
                            <th className="px-3 py-2 text-left font-medium text-slate-700">部品キー</th>
                            <th className="px-3 py-2 text-right font-medium text-slate-700">割合</th>
                            <th className="px-3 py-2 text-left font-medium text-slate-700">共通明細</th>
                            <th className="px-3 py-2 text-center font-medium text-slate-700">確認</th>
                            <th className="px-3 py-2 text-center font-medium text-slate-700">操作</th>
                          </tr>
                        </thead>
                        <tbody>
                          {currentAssignments.map((assignment) => (
                            <tr key={assignment.part_key} className="border-t border-slate-100 align-top">
                              <td className="px-3 py-2 text-slate-900">
                                <div>{assignment.part_key}</div>
                                {assignment.bom_model_count ? (
                                  <div className="text-[11px] text-slate-500">
                                    BOM {assignment.bom_model_count}機種
                                  </div>
                                ) : null}
                              </td>
                              <td className="px-3 py-2 text-right text-slate-900">{assignment.ratio}%</td>
                              <td className="px-3 py-2">
                                <input
                                  type="text"
                                  value={assignment.common_group_label || ''}
                                  onChange={(e) =>
                                    handleAssignmentFieldChange(
                                      assignment.part_key,
                                      'common_group_label',
                                      e.target.value
                                    )
                                  }
                                  placeholder="例: 全機種 / 500・600系共通"
                                  className="w-full px-2 py-1 border border-slate-300 rounded text-xs"
                                />
                                <button
                                  type="button"
                                  onClick={() => handleRefreshCommonGroupFromBom(assignment.part_key)}
                                  className="mt-1 text-[11px] text-sky-700 hover:underline"
                                >
                                  BOMから再取得
                                </button>
                              </td>
                              <td className="px-3 py-2 text-center">
                                <input
                                  type="checkbox"
                                  checked={Boolean(assignment.settings_confirmed)}
                                  onChange={(e) =>
                                    handleAssignmentFieldChange(
                                      assignment.part_key,
                                      'settings_confirmed',
                                      e.target.checked
                                    )
                                  }
                                  className="h-4 w-4"
                                />
                              </td>
                              <td className="px-3 py-2 text-center">
                                <button
                                  type="button"
                                  onClick={() => handleDeletePartAssignment(assignment.part_key)}
                                  className="text-rose-600 hover:text-rose-700 text-xs font-medium"
                                >
                                  削除
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <p className="px-3 py-2 text-[11px] text-slate-500 bg-slate-50 border-t border-slate-100">
                        共通明細を確認後「確認済み」にチェックし、画面下部の一括再計算を実行してください。
                      </p>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap gap-3 pt-2">
                <button
                  type="submit"
                  disabled={isLoading}
                  className="px-5 py-2 bg-sky-600 hover:bg-sky-500 text-white font-medium rounded-lg transition disabled:bg-sky-300"
                >
                  {editingId ? '更新' : '登録'}
                </button>
                <button
                  type="button"
                  onClick={resetForm}
                  className="px-5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded-lg transition"
                >
                  クリア
                </button>
              </div>
            </form>
          </div>

          <div className="bg-white/95 rounded-2xl shadow-xl border border-sky-100 p-6 backdrop-blur">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-slate-900">登録ライン一覧</h2>
              <div className="text-sm text-slate-500">
                {isLoading ? '読み込み中...' : `${lines.length} 件`}
              </div>
            </div>

            <form onSubmit={handleSearchSubmit} className="mb-4 grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-3">
              <input
                type="text"
                value={searchLineCode}
                onChange={(event) => setSearchLineCode(event.target.value)}
                placeholder="ラインコードで検索"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
              <input
                type="text"
                value={searchLineName}
                onChange={(event) => setSearchLineName(event.target.value)}
                placeholder="ライン名で検索（あいまい）"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={isLoading}
                  className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white text-sm font-medium rounded-lg transition disabled:bg-sky-300"
                >
                  検索
                </button>
                <button
                  type="button"
                  onClick={handleSearchReset}
                  disabled={isLoading}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium rounded-lg transition disabled:bg-slate-200 disabled:text-slate-400"
                >
                  解除
                </button>
              </div>
            </form>

            <p className="mb-3 text-xs text-slate-600">
              月別実績は作業日報（確定分）から自動登録されます。当社年度は9/1〜翌8/31（例: 26年度=2025/9/1〜2026/8/31）。同じ暦月は更新、年度が変わる同じ暦月は前年度分を削除します。
              {monthlyLoading ? '（読み込み中...）' : ''}
            </p>
            {monthlyError && (
              <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                月別実績の取得に失敗しました: {monthlyError}
                <button
                  type="button"
                  onClick={() => void fetchMonthlyDurations()}
                  className="ml-2 underline"
                >
                  再試行
                </button>
              </div>
            )}

            <div className="overflow-x-auto -mx-6 px-6">
              <table className="w-full text-xs">
                <thead className="text-left text-black sticky top-0 bg-white/95">
                  <tr>
                    <th className="py-3 px-3 font-semibold">コード</th>
                    <th className="py-3 px-3 font-semibold">ライン名</th>
                    <th className="py-3 px-3 font-semibold">月別実績</th>
                    <th className="py-3 px-3 font-semibold">部品割り当て</th>
                    <th className="py-3 px-3 font-semibold">有効</th>
                    <th className="py-3 px-3 font-semibold">操作</th>
                  </tr>
                </thead>
                <tbody className="text-black">
                  {lines.length === 0 && !isLoading ? (
                    <tr>
                      <td colSpan={6} className="py-6 text-center text-slate-400">
                        ラインが未登録です
                      </td>
                    </tr>
                  ) : (
                    lines.map((line) => (
                      <tr key={line.id} className="border-t border-slate-100 hover:bg-slate-50">
                        <td className="py-3 px-3 font-medium text-black whitespace-nowrap">
                          {line.line_code}
                        </td>
                        <td className="py-3 px-3 text-black">{line.name}</td>
                        <td className="py-3 px-3 text-black">
                          {(() => {
                            const rows = monthlyByLine[line.line_code] || []
                            if (rows.length === 0) {
                              return <span className="text-slate-400">—</span>
                            }
                            return (
                              <div className="flex flex-wrap gap-1">
                                {rows.map((row) => (
                                  <span
                                    key={row.month}
                                    className="inline-block rounded bg-sky-50 px-1.5 py-0.5 text-[11px] text-sky-900 whitespace-nowrap"
                                  >
                                    {row.month_label}-{row.duration_hours}
                                  </span>
                                ))}
                              </div>
                            )
                          })()}
                        </td>
                        <td className="py-3 px-3">
                          {(line.part_assignments || []).length > 0 ? (
                            <div className="flex flex-wrap gap-2">
                              {(line.part_assignments || []).map((a: any) => (
                                <span
                                  key={a.part_key}
                                  className="inline-block bg-blue-100 text-blue-700 px-2 py-1 rounded text-xs whitespace-nowrap"
                                >
                                  {a.part_key} ({a.ratio}%)
                                  {a.common_group_label ? ` / ${a.common_group_label}` : ''}
                                  {a.settings_confirmed ? ' ✓' : ''}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td className="py-3 px-3 whitespace-nowrap">{line.is_active ? '有効' : '無効'}</td>
                        <td className="py-3 px-3">
                          <div className="flex flex-nowrap gap-1 items-center">
                            <button
                              type="button"
                              onClick={() => handleEdit(line)}
                              className="px-2 py-1 rounded-md bg-emerald-600 text-white hover:bg-emerald-700 transition text-xs font-medium"
                            >
                              編集
                            </button>
                            <button
                              type="button"
                              onClick={() => handleShowHistory(line.line_code)}
                              className="px-2 py-1 rounded-md bg-blue-600 text-white hover:bg-blue-700 transition text-xs font-medium"
                            >
                              📄
                            </button>
                            <Link
                              href={buildProcessManagementPath('line', line.line_code)}
                              className="px-2 py-1 rounded-md bg-indigo-600 text-white hover:bg-indigo-700 transition text-xs font-medium whitespace-nowrap"
                            >
                              工程
                            </Link>
                            <button
                              type="button"
                              onClick={() => handleDelete(line)}
                              className="px-2 py-1 rounded-md bg-red-600 text-white hover:bg-red-700 transition text-xs font-medium"
                            >
                              削除
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* 履歴表示 */}
            {showHistoryFor && (
              <div className="mt-6 p-4 bg-sky-50 border-2 border-sky-200 rounded-lg">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-md font-semibold text-sky-900">
                    📄 ライン {showHistoryFor}　月別実績
                  </h3>
                  <button
                    onClick={() => setShowHistoryFor(null)}
                    className="text-sky-600 hover:text-sky-900 text-xl font-bold"
                  >
                    ×
                  </button>
                </div>

                {historyError ? (
                  <p className="text-center text-rose-600">{historyError}</p>
                ) : historyLoading ? (
                  <p className="text-center text-sky-700">...読み込み中</p>
                ) : history.length === 0 ? (
                  <p className="text-center text-sky-600">
                    作業日報の実績がありません（ラインが未選択の日報は集計されません）
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-sky-100 text-sky-900">
                        <tr>
                          <th className="px-3 py-2 text-left font-semibold">月</th>
                          <th className="px-3 py-2 text-right font-semibold">実績時間</th>
                          <th className="px-3 py-2 text-right font-semibold">（分）</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-sky-200">
                        {history.map((record) => (
                          <tr key={record.month} className="hover:bg-sky-100">
                            <td className="px-3 py-2 text-sky-900 whitespace-nowrap">
                              {record.month_label}
                            </td>
                            <td className="px-3 py-2 text-right text-sky-900 font-semibold">
                              {record.duration_hours}
                            </td>
                            <td className="px-3 py-2 text-right text-sky-700 text-xs">
                              {record.duration_minutes.toLocaleString()}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
