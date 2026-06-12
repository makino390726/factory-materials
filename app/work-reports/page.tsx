'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import PushNotificationManager from '@/app/components/PushNotificationManager'
import {
  computeItemDurationMinutes,
  computeWorkMinutes,
  getEffectiveBreakMinutes,
} from '@/lib/work-report-time'

type StaffInfo = {
  id: string
  login_id: string
  name: string
  department?: string | null
  work_group_code?: string | null
}

type LineItem = {
  id: string
  line_code: string
  name: string
  is_active: boolean
}

type WorkOrderOption = {
  id: string
  order_no: string
  product_name: string | null
  model: string | null
  status: string | null
  completed?: boolean | null
}

type WorkContentOption = {
  id: string
  work_group_code: string
  work_code: string
  work_name: string
  print_type: string
}

type WorkGroupOption = {
  id: string
  group_no: string
  work_group_code: string
  work_name: string
}

type MachineOption = {
  id: string
  work_group_code: string
  category_code: number
  category_name: string
}

type WorkItem = {
  id: string
  is_support: boolean
  support_work_group_code: string
  work_type: string
  work_content: string
  instruction_text: string
  line_id: string
  model: string
  machine: string
  notes: string
  start_time: string
  end_time: string
}

const createLocalId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

const createItem = (): WorkItem => ({
  id: createLocalId(),
  is_support: false,
  support_work_group_code: '',
  work_type: '',
  work_content: '',
  instruction_text: '',
  line_id: '',
  model: '',
  machine: '',
  notes: '',
  start_time: '',
  end_time: '',
})

const formatMinutes = (value: number) => {
  const hours = Math.floor(value / 60)
  const minutes = value % 60
  return `${hours}h ${minutes.toString().padStart(2, '0')}m`
}

const isSelectableWorkOrder = (order: WorkOrderOption) => {
  // D指令リストでは「完了」状態の指令は選択対象外にする
  return order.status !== '完了'
}

export default function WorkReportsPage() {
  const [staff, setStaff] = useState<StaffInfo | null>(null)
  const [lines, setLines] = useState<LineItem[]>([])
  const [workOrders, setWorkOrders] = useState<WorkOrderOption[]>([])
  const [workContents, setWorkContents] = useState<WorkContentOption[]>([])
  const [workGroups, setWorkGroups] = useState<WorkGroupOption[]>([])
  const [machines, setMachines] = useState<MachineOption[]>([])
  const [workDate, setWorkDate] = useState('')
  const [startTime, setStartTime] = useState('08:30')
  const [endTime, setEndTime] = useState('17:30')
  const [items, setItems] = useState<WorkItem[]>([createItem()])
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [isDraftLoaded, setIsDraftLoaded] = useState(false)
  const [showGuideModal, setShowGuideModal] = useState(false)
  const [dontShowAgain, setDontShowAgain] = useState(false)
  const [notifications, setNotifications] = useState<any[]>([])
  const [showNotifications, setShowNotifications] = useState(false)
  const [showAddOrderModal, setShowAddOrderModal] = useState(false)
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const [loadedMachineDurations, setLoadedMachineDurations] = useState<
    Array<{
      machine: string
      computed_duration_minutes: number
      confirmed_duration_minutes: number
    }>
  >([])
  const [showMachineConfirmModal, setShowMachineConfirmModal] = useState(false)
  const [machineModalRows, setMachineModalRows] = useState<
    Array<{ machine: string; computed: number; confirmed: number }>
  >([])

  useEffect(() => {
    const today = new Date()
    setWorkDate(today.toISOString().slice(0, 10))

    const stored = sessionStorage.getItem('staff')
    if (stored) {
      try {
        setStaff(JSON.parse(stored))
      } catch {
        setStaff(null)
      }
    }

    // 入力ガイドの表示チェック
    const hideGuide = localStorage.getItem('hideWorkReportGuide')
    if (!hideGuide) {
      setShowGuideModal(true)
    }
  }, [])

  // 未読通知を取得
  useEffect(() => {
    if (!staff?.id) return

    const fetchNotifications = async () => {
      try {
        const response = await fetch(`/api/notifications?staff_id=${staff.id}&unread_only=true`)
        if (response.ok) {
          const data = await response.json()
          setNotifications(data.notifications || [])
          // 未読通知があればモーダルを表示
          if (data.notifications && data.notifications.length > 0) {
            setShowNotifications(true)
          }
        }
      } catch (error) {
        console.error('Failed to fetch notifications:', error)
      }
    }

    fetchNotifications()
  }, [staff])

  useEffect(() => {
    const fetchLines = async () => {
      try {
        const response = await fetch('/api/lines')
        if (!response.ok) throw new Error('Failed to fetch lines')
        const data = await response.json()
        setLines((data || []).filter((line: LineItem) => line.is_active))
      } catch (lineError) {
        console.error('ライン取得エラー:', lineError)
      }
    }

    fetchLines()
  }, [])

  const refetchWorkOrders = async () => {
    try {
      const response = await fetch('/api/work-orders')
      if (!response.ok) throw new Error('Failed to fetch work orders')
      const data = await response.json()
      const selectable = (data || []).filter(isSelectableWorkOrder)
      const sorted = selectable.sort((a: WorkOrderOption, b: WorkOrderOption) =>
        a.order_no.localeCompare(b.order_no, 'ja', { numeric: true })
      )
      setWorkOrders(sorted)
    } catch (orderError) {
      console.error('作業指令取得エラー:', orderError)
    }
  }

  useEffect(() => {
    refetchWorkOrders()
  }, [])

  const handleAddOrderCancel = () => {
    setShowAddOrderModal(false)
    setSelectedItemId(null)
  }

  const handleAddOrderSuccess = async () => {
    await refetchWorkOrders()
    setShowAddOrderModal(false)
    setSelectedItemId(null)
  }

  useEffect(() => {
    const fetchWorkContents = async () => {
      try {
        const response = await fetch('/api/work-contents')
        if (!response.ok) throw new Error('Failed to fetch work contents')
        const data = await response.json()
        setWorkContents(data || [])
      } catch (workContentError) {
        console.error('作業内容取得エラー:', workContentError)
      }
    }

    fetchWorkContents()
  }, [])

  useEffect(() => {
    const fetchWorkGroups = async () => {
      try {
        const response = await fetch('/api/work-group-master')
        if (!response.ok) throw new Error('Failed to fetch work groups')
        const data = await response.json()
        setWorkGroups(data || [])
      } catch (workGroupError) {
        console.error('作業グループ取得エラー:', workGroupError)
      }
    }

    fetchWorkGroups()
  }, [])

  useEffect(() => {
    const fetchMachines = async () => {
      try {
        const response = await fetch('/api/machines')
        if (!response.ok) throw new Error('Failed to fetch machines')
        const data = await response.json()
        setMachines(data || [])
      } catch (machineError) {
        console.error('機械設備取得エラー:', machineError)
      }
    }

    fetchMachines()
  }, [])

  const effectiveBreakMinutes = useMemo(
    () => getEffectiveBreakMinutes(startTime, endTime),
    [startTime, endTime]
  )

  const workMinutes = useMemo(
    () => computeWorkMinutes(startTime, endTime),
    [startTime, endTime]
  )

  const itemDurations = useMemo(() => {
    return items.map((item) =>
      computeItemDurationMinutes(item.start_time, item.end_time)
    )
  }, [items])

  const totalItemMinutes = itemDurations.reduce((sum, value) => sum + value, 0)
  const isDurationMatch = totalItemMinutes === workMinutes && workMinutes > 0

  /** 明細から集計した使用機械ごとの分数（保存前確認モーダル用） */
  const machineMinutesFromItems = useMemo(() => {
    const map = new Map<string, number>()
    items.forEach((item, index) => {
      const name = item.machine?.trim()
      if (!name) return
      map.set(name, (map.get(name) || 0) + itemDurations[index])
    })
    return map
  }, [items, itemDurations])

  const hasMachineInItems = machineMinutesFromItems.size > 0

  const buildMachineModalRows = () => {
    const entries = Array.from(machineMinutesFromItems.entries()).sort(([a], [b]) =>
      a.localeCompare(b, 'ja')
    )
    return entries.map(([machine, computed]) => {
      const saved = loadedMachineDurations.find((r) => r.machine === machine)
      const confirmed =
        typeof saved?.confirmed_duration_minutes === 'number'
          ? saved.confirmed_duration_minutes
          : computed
      return { machine, computed, confirmed }
    })
  }

  // UIプレビュー: /work-reports?demoMachineModal=1 で機械稼働確認モーダルを表示
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    if (params.get('demoMachineModal') !== '1') return
    setMachineModalRows([
      { machine: 'タレパン', computed: 180, confirmed: 180 },
      { machine: 'プレス', computed: 60, confirmed: 60 },
    ])
    setShowMachineConfirmModal(true)
  }, [])

  // 各作業内訳ごとに利用可能な作業内容を計算（応援フラグを考慮）
  const getAvailableWorkContentsForItem = (item: WorkItem) => {
    const targetWorkGroupCode = item.is_support 
      ? item.support_work_group_code 
      : staff?.work_group_code
    
    if (!targetWorkGroupCode) return []
    
    return workContents
      .filter(
        (content) => content.work_group_code === targetWorkGroupCode
      )
      .sort((a, b) => {
        // DR8-0093 から 0093 を抽出してソート
        const aMatch = a.work_code?.match(/-(.+)$/)?.[1] || a.work_code || ''
        const bMatch = b.work_code?.match(/-(.+)$/)?.[1] || b.work_code || ''
        return aMatch.localeCompare(bMatch, 'ja', { numeric: true })
      })
  }

  // 各作業内訳ごとに利用可能な印刷種別を計算
  const getAvailablePrintTypesForItem = (item: WorkItem) => {
    const contents = getAvailableWorkContentsForItem(item)
    return Array.from(
      new Set(contents.map((content) => content.print_type))
    ).sort((a, b) => a.localeCompare(b))
  }

  // 各作業内訳ごとに利用可能な機械を計算（応援フラグを考慮）
  const getAvailableMachinesForItem = (item: WorkItem) => {
    const targetWorkGroupCode = item.is_support 
      ? item.support_work_group_code 
      : staff?.work_group_code
    
    if (!targetWorkGroupCode) return []
    
    return machines.filter(
      (machine) => machine.work_group_code === targetWorkGroupCode
    )
  }

  const handleAddItem = () => {
    setItems((prev) => [...prev, createItem()])
  }

  const handleRemoveItem = (id: string) => {
    setItems((prev) => (prev.length === 1 ? prev : prev.filter((item) => item.id !== id)))
  }

  const handleCloseGuide = () => {
    if (dontShowAgain) {
      localStorage.setItem('hideWorkReportGuide', 'true')
    }
    setShowGuideModal(false)
  }

  const handleMarkAsRead = async (notificationId: number) => {
    if (!staff?.id) return

    try {
      const response = await fetch('/api/notifications', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          notification_id: notificationId,
          staff_id: staff.id
        })
      })

      if (response.ok) {
        // 通知リストから削除
        setNotifications(prev => prev.filter(n => n.id !== notificationId))
      }
    } catch (error) {
      console.error('Failed to mark notification as read:', error)
    }
  }

  const handleCloseNotifications = () => {
    // 全ての未読通知を既読にする
    notifications.forEach(notification => {
      handleMarkAsRead(notification.id)
    })
    setShowNotifications(false)
  }

  const handleItemChange = (id: string, key: keyof WorkItem, value: string | boolean) => {
    setItems((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item
        if (key === 'is_support' && typeof value === 'boolean') {
          return { 
            ...item, 
            is_support: value, 
            support_work_group_code: value ? '' : '',
            work_type: '',
            work_content: '',
            machine: ''
          }
        }
        if (key === 'support_work_group_code') {
          return { 
            ...item, 
            support_work_group_code: value as string,
            work_type: '',
            work_content: '',
            machine: ''
          }
        }
        if (key === 'work_type') {
          return { ...item, work_type: value as string, work_content: '' }
        }
        if (key === 'instruction_text') {
          // D指令が選択されたら、該当する指令から型式を取得して自動入力
          const selectedOrder = workOrders.find((order) => order.order_no === value)
          const model = selectedOrder?.model || ''
          return { ...item, instruction_text: value as string, model }
        }
        return { ...item, [key]: value }
      })
    )
  }

  const loadExistingReport = async (staffId: string, date: string) => {
    setIsLoading(true)
    try {
      const response = await fetch(`/api/work-reports?staff_id=${staffId}&work_date=${date}`)
      if (!response.ok) {
        if (response.status === 404) {
          setItems([createItem()])
          setIsDraftLoaded(false)
          setLoadedMachineDurations([])
          return
        }
        throw new Error('Failed to load report')
      }
      const data = await response.json()
      setStartTime(data.report.start_time || '')
      setEndTime(data.report.end_time || '')
      setIsDraftLoaded(Boolean(data.report?.is_draft))
      const loadedItems = (data.items || []).map((item: WorkItem) => ({
          id: createLocalId(),
          is_support: item.is_support || false,
          support_work_group_code: item.support_work_group_code || '',
          work_type: item.work_type,
          work_content: item.work_content,
          instruction_text: item.instruction_text || '',
          line_id: item.line_id || '',
          model: item.model || '',
          machine: item.machine || '',
          notes: item.notes || '',
          start_time: item.start_time,
          end_time: item.end_time,
        }))
      setItems(loadedItems.length > 0 ? loadedItems : [createItem()])
      setLoadedMachineDurations(
        Array.isArray(data.machine_durations) ? data.machine_durations : []
      )
    } catch (loadError) {
      console.error('作業日報読み込みエラー:', loadError)
      setIsDraftLoaded(false)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    if (staff?.id && workDate) {
      loadExistingReport(staff.id, workDate)
    }
  }, [staff?.id, workDate])

  const saveReport = async (
    isDraft: boolean,
    confirmations?: Array<{
      machine: string
      computed_duration_minutes: number
      confirmed_duration_minutes: number
    }>
  ) => {
    if (!staff) {
      setError('ログイン情報が見つかりません')
      return
    }

    setIsSaving(true)
    try {
      const payload: Record<string, unknown> = {
        staff_id: staff.id,
        work_date: workDate,
        start_time: startTime,
        end_time: endTime,
        break_minutes: effectiveBreakMinutes,
        is_draft: isDraft,
        items: items.map((item) => ({
          is_support: item.is_support,
          support_work_group_code: item.support_work_group_code?.trim() || null,
          work_type: item.work_type,
          work_content: item.work_content.trim(),
          instruction_text: item.instruction_text.trim(),
          line_id: item.line_id || null,
          model: item.model.trim(),
          machine: item.machine.trim(),
          notes: item.notes.trim(),
          start_time: item.start_time,
          end_time: item.end_time,
        })),
      }
      if (!isDraft && confirmations && confirmations.length > 0) {
        payload.machine_time_confirmations = confirmations
      }

      const response = await fetch('/api/work-reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      const result = await response.json()
      if (!response.ok) {
        throw new Error(result?.error || '保存に失敗しました')
      }

      setIsDraftLoaded(isDraft)
      if (!isDraft && confirmations && confirmations.length > 0) {
        setLoadedMachineDurations(
          confirmations.map((c) => ({
            machine: c.machine,
            computed_duration_minutes: c.computed_duration_minutes,
            confirmed_duration_minutes: c.confirmed_duration_minutes,
          }))
        )
      } else if (!isDraft) {
        setLoadedMachineDurations([])
      }
      setShowMachineConfirmModal(false)
      alert(isDraft ? '作業日報を一時保存しました' : '作業日報を保存しました')
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Unknown error')
    } finally {
      setIsSaving(false)
    }
  }

  const handleSubmit = async (options?: { isDraft?: boolean }) => {
    setError(null)
    const isDraft = options?.isDraft ?? false

    if (!staff) {
      setError('ログイン情報が見つかりません')
      return
    }

    if (!isDurationMatch && !isDraft) {
      setError('所要時間の合計と勤務時間を一致させてください')
      return
    }

    if (!isDraft) {
      const invalidItem = items.find(
        (item) => !item.start_time || !item.end_time || !item.work_type
      )
      if (invalidItem) {
        setError('作業区分・開始/終了時間は必須です')
        return
      }
    }

    if (!isDraft && hasMachineInItems) {
      setMachineModalRows(buildMachineModalRows())
      setShowMachineConfirmModal(true)
      return
    }

    await saveReport(isDraft)
  }

  const handleMachineConfirmModalSubmit = async () => {
    const confirmations = machineModalRows.map((row) => ({
      machine: row.machine,
      computed_duration_minutes: row.computed,
      confirmed_duration_minutes: Math.max(0, Math.floor(Number(row.confirmed)) || 0),
    }))
    await saveReport(false, confirmations)
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-amber-950 to-slate-950 relative overflow-hidden pb-12">
      {/* プッシュ通知マネージャー */}
      {staff?.id && <PushNotificationManager staffId={staff.id} />}
      
      <div className="absolute inset-0 opacity-10">
        <svg className="w-full h-full" viewBox="0 0 1200 800">
          <pattern id="circuit-work" x="0" y="0" width="220" height="220" patternUnits="userSpaceOnUse">
            <path d="M 0 60 L 60 60 L 60 0" stroke="currentColor" strokeWidth="2" fill="none" className="text-amber-400" />
            <path d="M 180 180 L 120 180 L 120 220" stroke="currentColor" strokeWidth="2" fill="none" className="text-amber-400" />
            <circle cx="60" cy="60" r="3" fill="currentColor" className="text-amber-400" />
            <circle cx="120" cy="180" r="3" fill="currentColor" className="text-amber-400" />
          </pattern>
          <rect width="1200" height="800" fill="url(#circuit-work)" />
        </svg>
      </div>

      <div className="relative z-10 mx-auto max-w-3xl px-4 py-6">
        <div className="flex flex-col gap-4 items-center text-center mb-8">
          <div>
            <p className="text-amber-200 text-sm uppercase tracking-[0.3em]">Daily Work Report</p>
            <h1 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-amber-300 via-orange-300 to-rose-300">
              製造作業日報入力
            </h1>
            <p className="text-slate-300 text-sm mt-2">スマホで入力し、勤務時間と作業時間の一致を確認します。</p>
          </div>
          <Link href="/">
            <button className="px-6 py-2 bg-gradient-to-r from-slate-700 to-slate-800 hover:from-slate-600 hover:to-slate-700 text-white font-medium rounded-lg transition-all duration-300 border border-slate-600 hover:border-slate-500">
              ← ホーム
            </button>
          </Link>
        </div>

        <div className="space-y-6">
          {isDraftLoaded && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              当日の一時保存データを読み込みました。未入力の項目を入力して保存してください。
            </div>
          )}
          <div className="rounded-2xl border border-amber-200/30 bg-white/90 p-6 shadow-xl backdrop-blur">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">勤務情報</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="text-base font-bold text-slate-900">作業日</label>
                <input
                  type="date"
                    value={workDate}
                    onChange={(event) => setWorkDate(event.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900"
                  />
                </div>
                <div>
                  <label className="text-base font-bold text-slate-900">スタッフ</label>
                  <div className="mt-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-slate-700">
                    {staff ? `${staff.name} (${staff.login_id})` : '未ログイン'}
                  </div>
                </div>
                <div>
                  <label className="text-base font-bold text-slate-900">作業グループ</label>
                  <div className="mt-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-slate-700">
                    {staff?.work_group_code || '-'}
                  </div>
                </div>
                <div>
                  <label className="text-base font-bold text-slate-900">出社時間</label>
                  <input
                    type="time"
                    value={startTime}
                    onChange={(event) => setStartTime(event.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900"
                  />
                </div>
                <div>
                  <label className="text-base font-bold text-slate-900">退社時間</label>
                  <input
                    type="time"
                    value={endTime}
                    onChange={(event) => setEndTime(event.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900"
                  />
                </div>
                <div>
                  <label className="text-base font-bold text-slate-900">昼休憩（自動）</label>
                  <div className="mt-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-slate-700">
                    {effectiveBreakMinutes} 分
                    {effectiveBreakMinutes === 0 ? (
                      <span className="ml-2 text-xs text-slate-500">（12:00前退社など）</span>
                    ) : null}
                  </div>
                </div>
                <div>
                  <label className="text-base font-bold text-slate-900">勤務時間</label>
                  <div className="mt-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-slate-900 font-semibold">
                    {workMinutes > 0 ? formatMinutes(workMinutes) : '--'}
                  </div>
                </div>
              </div>
              {staff ? null : (
                <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                  ログインが必要です。先にログインしてください。
                  <Link href="/login" className="ml-2 text-rose-800 underline">
                    ログインへ
                  </Link>
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-amber-200/30 bg-white/90 p-6 shadow-xl backdrop-blur">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-slate-900">作業内訳</h2>
                <button
                  type="button"
                  onClick={handleAddItem}
                  className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-amber-500"
                >
                  + 行を追加
                </button>
              </div>

              {items.map((item, index) => {
                const availableWorkContents = getAvailableWorkContentsForItem(item)
                const availablePrintTypes = getAvailablePrintTypesForItem(item)
                const availableMachines = getAvailableMachinesForItem(item)
                
                return (
                <div key={item.id} className="mb-6 rounded-xl border border-slate-200 p-4">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-sm font-semibold text-slate-700">作業 {index + 1}</p>
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={handleAddItem}
                        className="text-xs text-amber-600 hover:text-amber-500"
                      >
                        + 行を追加
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRemoveItem(item.id)}
                        className="text-xs text-rose-600 hover:text-rose-500"
                      >
                        削除
                      </button>
                    </div>
                  </div>

                  {/* 応援チェックボックス */}
                  <div className="mb-3 flex items-center gap-3">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={item.is_support}
                        onChange={(event) =>
                          handleItemChange(item.id, 'is_support', event.target.checked)
                        }
                        className="h-4 w-4 rounded border-slate-300 text-amber-600 focus:ring-2 focus:ring-amber-500"
                      />
                      <span className="text-sm font-bold text-slate-900">応援</span>
                    </label>

                    {item.is_support && (
                      <div className="flex-1">
                        <select
                          value={item.support_work_group_code}
                          onChange={(event) =>
                            handleItemChange(item.id, 'support_work_group_code', event.target.value)
                          }
                          className="w-full rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-slate-900 focus:border-amber-500 focus:ring-2 focus:ring-amber-200"
                        >
                          <option value="">作業グループを選択</option>
                          {workGroups.map((group) => (
                            <option key={group.id} value={group.work_group_code}>
                              {group.work_group_code} - {group.work_name}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label className="text-sm font-bold text-slate-900">作業区分</label>
                      <select
                        value={item.work_type}
                        onChange={(event) =>
                          handleItemChange(item.id, 'work_type', event.target.value)
                        }
                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900"
                      >
                        <option value="">未選択</option>
                        {availablePrintTypes.map((printType) => (
                          <option key={printType} value={printType}>
                            {printType}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-sm font-bold text-slate-900">作業内容</label>
                      <select
                        value={item.work_content}
                        onChange={(event) =>
                          handleItemChange(item.id, 'work_content', event.target.value)
                        }
                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900"
                      >
                        <option value="">未選択</option>
                        {availableWorkContents
                          .filter((content) => content.print_type === item.work_type)
                          .sort((a, b) => {
                            const extractNumber = (code: string | undefined): number => {
                              if (!code) return 0
                              const parts = code.split('-')
                              if (parts.length >= 2) {
                                const numStr = parts[1].replace(/\D/g, '')
                                return parseInt(numStr, 10) || 0
                              }
                              return 0
                            }
                            return extractNumber(a.work_code) - extractNumber(b.work_code)
                          })
                          .map((content) => (
                            <option key={content.id} value={content.work_name}>
                              {content.work_code} - {content.work_name}
                            </option>
                          ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-sm font-bold text-slate-900">開始</label>
                      <input
                        type="time"
                        value={item.start_time}
                        onChange={(event) =>
                          handleItemChange(item.id, 'start_time', event.target.value)
                        }
                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900"
                      />
                    </div>
                    <div>
                      <label className="text-sm font-bold text-slate-900">終了</label>
                      <input
                        type="time"
                        value={item.end_time}
                        onChange={(event) =>
                          handleItemChange(item.id, 'end_time', event.target.value)
                        }
                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900"
                      />
                    </div>
                    <div className="flex items-end gap-2 col-span-1 sm:col-span-2">
                      <div className="w-24 flex-shrink-0">
                        <label className="text-sm font-bold text-slate-900">所要時間</label>
                        <div className="mt-1 rounded-lg border border-slate-200 bg-slate-50 px-2 py-2 text-xs text-slate-700 font-medium whitespace-nowrap text-center">
                          {itemDurations[index] ? formatMinutes(itemDurations[index]) : '--'}
                        </div>
                      </div>
                      <div className="flex-1">
                        <label className="text-sm font-bold text-slate-900">D指令</label>
                        <div className="flex gap-1 mt-1">
                          <select
                            value={item.instruction_text}
                            onChange={(event) =>
                              handleItemChange(item.id, 'instruction_text', event.target.value)
                            }
                            className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-slate-900 text-sm"
                          >
                            <option value="">未選択</option>
                            {workOrders.map((order) => (
                              <option key={order.id} value={order.order_no}>
                                {order.order_no}
                                {order.product_name ? ` - ${order.product_name}` : ''}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedItemId(item.id)
                              setShowAddOrderModal(true)
                            }}
                            className="px-2 py-2 bg-blue-600 text-white text-xs font-semibold rounded-lg hover:bg-blue-500 transition flex-shrink-0"
                          >
                            新規
                          </button>
                        </div>
                      </div>
                    </div>
                    <div>
                      <label className="text-sm font-bold text-slate-900">ライン</label>
                      <select
                        value={item.line_id}
                        onChange={(event) =>
                          handleItemChange(item.id, 'line_id', event.target.value)
                        }
                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900"
                      >
                        <option value="">未選択</option>
                        {lines.map((line) => (
                          <option key={line.id} value={line.id}>
                            {line.line_code} - {line.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-sm font-bold text-slate-900">型式</label>
                      <input
                        type="text"
                        value={item.model}
                        onChange={(event) => handleItemChange(item.id, 'model', event.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900"
                      />
                    </div>
                    <div>
                      <label className="text-sm font-bold text-slate-900">使用機械</label>
                      <select
                        value={item.machine}
                        onChange={(event) =>
                          handleItemChange(item.id, 'machine', event.target.value)
                        }
                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900"
                      >
                        <option value="">未選択</option>
                        {availableMachines.map((machine) => (
                          <option key={machine.id} value={machine.category_name}>
                            {machine.category_name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="sm:col-span-2">
                      <label className="text-sm font-bold text-slate-900">備考</label>
                      <input
                        type="text"
                        value={item.notes}
                        onChange={(event) => handleItemChange(item.id, 'notes', event.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900"
                      />
                    </div>
                  </div>
                </div>
              )
              })}

              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                合計所要時間: <span className="font-semibold">{formatMinutes(totalItemMinutes)}</span>
                <span className={`ml-2 font-semibold ${isDurationMatch ? 'text-emerald-600' : 'text-rose-600'}`}>
                  {isDurationMatch ? '勤務時間と一致' : '勤務時間と不一致'}
                </span>
              </div>
            </div>

            {error && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {error}
              </div>
            )}

            {isLoading ? (
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                既存データを読み込み中...
              </div>
            ) : null}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => handleSubmit({ isDraft: true })}
                disabled={isSaving || !staff}
                className="w-full rounded-xl bg-slate-600 px-4 py-4 text-lg font-bold text-white shadow-lg shadow-slate-600/30 transition hover:-translate-y-0.5 hover:bg-slate-500 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {isSaving ? '保存中...' : '一時保存'}
              </button>
              <button
                type="button"
                onClick={() => handleSubmit()}
                disabled={isSaving || !staff || !isDurationMatch}
                className="w-full rounded-xl bg-amber-600 px-4 py-4 text-lg font-bold text-white shadow-lg shadow-amber-600/40 transition hover:-translate-y-0.5 hover:bg-amber-500 disabled:cursor-not-allowed disabled:bg-amber-300"
              >
                {isSaving ? '保存中...' : '日報を保存'}
              </button>
            </div>
        </div>

        {/* 使用機械稼働時間の確認（本保存時・明細に使用機械がある場合） */}
        {showMachineConfirmModal && machineModalRows.length > 0 && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div
              className="relative w-full max-w-lg rounded-2xl border border-amber-200/40 bg-white shadow-2xl"
              role="dialog"
              aria-labelledby="machine-confirm-title"
            >
              <div className="border-b border-slate-200 px-6 py-4">
                <h2 id="machine-confirm-title" className="text-xl font-bold text-slate-900">
                  使用機械の稼働時間
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  明細から集計した時間です。並行稼働などで実際と違う場合は「確定（分）」を修正してください。
                </p>
              </div>
              <div className="max-h-[60vh] overflow-y-auto px-6 py-4">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-slate-600">
                      <th className="pb-2 pr-2 font-semibold">使用機械</th>
                      <th className="pb-2 pr-2 font-semibold">明細集計（分）</th>
                      <th className="pb-2 font-semibold">確定（分）</th>
                    </tr>
                  </thead>
                  <tbody>
                    {machineModalRows.map((row) => (
                      <tr key={row.machine} className="border-b border-slate-100">
                        <td className="py-3 pr-2 font-medium text-slate-900">{row.machine}</td>
                        <td className="py-3 pr-2 text-slate-700">{row.computed}</td>
                        <td className="py-3">
                          <input
                            type="number"
                            min={0}
                            step={1}
                            value={row.confirmed}
                            onChange={(e) => {
                              const v = e.target.value === '' ? 0 : Number(e.target.value)
                              setMachineModalRows((prev) =>
                                prev.map((r) =>
                                  r.machine === row.machine
                                    ? { ...r, confirmed: Number.isFinite(v) ? v : 0 }
                                    : r
                                )
                              )
                            }}
                            className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-slate-900"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex gap-3 border-t border-slate-200 px-6 py-4">
                <button
                  type="button"
                  onClick={() => setShowMachineConfirmModal(false)}
                  disabled={isSaving}
                  className="flex-1 rounded-lg border border-slate-300 px-4 py-3 text-base font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  キャンセル
                </button>
                <button
                  type="button"
                  onClick={() => void handleMachineConfirmModalSubmit()}
                  disabled={isSaving}
                  className="flex-1 rounded-lg bg-amber-600 px-4 py-3 text-base font-bold text-white shadow hover:bg-amber-500 disabled:cursor-not-allowed disabled:bg-amber-300"
                >
                  {isSaving ? '保存中...' : '確定して保存'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 通知モーダル */}
        {showNotifications && notifications.length > 0 && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="relative mx-4 max-w-2xl w-full rounded-2xl border border-rose-200/30 bg-white shadow-2xl max-h-[80vh] flex flex-col">
              <div className="p-6 border-b border-slate-200">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex items-center justify-center w-10 h-10 bg-red-100 rounded-full">
                      <span className="text-xl">🔔</span>
                    </div>
                    <div>
                      <h2 className="text-2xl font-bold text-slate-900">通知</h2>
                      <p className="text-sm text-slate-600">{notifications.length}件の未読通知があります</p>
                    </div>
                  </div>
                  <button
                    onClick={handleCloseNotifications}
                    className="text-slate-400 hover:text-slate-600 transition"
                  >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-6">
                <div className="space-y-3">
                  {notifications.map((notification) => (
                    <div
                      key={notification.id}
                      className="rounded-lg border-2 border-rose-200 bg-rose-50 p-4 hover:border-rose-300 transition"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            {notification.notification_type === 'work_report_reminder' && (
                              <span className="px-2 py-1 bg-rose-500 text-white text-xs font-bold rounded">
                                📝 日報催促
                              </span>
                            )}
                            {notification.notification_type === 'announcement' && (
                              <span className="px-2 py-1 bg-blue-500 text-white text-xs font-bold rounded">
                                📢 お知らせ
                              </span>
                            )}
                            {notification.notification_type === 'info' && (
                              <span className="px-2 py-1 bg-slate-500 text-white text-xs font-bold rounded">
                                ℹ️ 情報
                              </span>
                            )}
                            <span className="text-xs text-slate-500">
                              {new Date(notification.created_at).toLocaleString('ja-JP')}
                            </span>
                          </div>
                          <p className="text-slate-800 font-medium">{notification.message}</p>
                        </div>
                        <button
                          onClick={() => handleMarkAsRead(notification.id)}
                          className="flex-shrink-0 px-3 py-1 text-xs bg-slate-200 hover:bg-slate-300 text-slate-700 font-semibold rounded transition"
                        >
                          既読
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="p-6 border-t border-slate-200">
                <button
                  onClick={handleCloseNotifications}
                  className="w-full rounded-lg bg-rose-600 px-4 py-3 text-base font-bold text-white shadow-lg hover:bg-rose-500 transition"
                >
                  すべて既読にして閉じる
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 入力ガイドモーダル */}
        {showGuideModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="relative mx-4 max-w-2xl w-full rounded-2xl border border-amber-200/30 bg-white shadow-2xl">
              <div className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-2xl font-bold text-slate-900">📝 入力ガイド</h2>
                  <button
                    onClick={handleCloseGuide}
                    className="text-slate-400 hover:text-slate-600 transition"
                  >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                <div className="space-y-4 text-slate-700">
                  <div className="rounded-lg bg-amber-50 border border-amber-200 p-4">
                    <h3 className="font-semibold text-amber-900 mb-2">⏰ 勤務時間について</h3>
                    <ul className="space-y-2 text-sm">
                      <li>• 勤務時間は出社〜退社から、12:00～13:00との重複時間（昼休憩）を差し引きます。</li>
                      <li>• 10:30など昼前に退社した日は昼休憩0分となり、作業時間と勤務時間の計算が一致します。</li>
                      <li>• 作業内訳の各行でも、12:00～13:00を跨ぐ分だけ所要時間から自動的に差し引きます。</li>
                    </ul>
                  </div>

                  <div className="rounded-lg bg-teal-50 border border-teal-200 p-4">
                    <h3 className="font-semibold text-teal-900 mb-2">✅ 入力ルール</h3>
                    <ul className="space-y-2 text-sm">
                      <li>• 作業内訳の合計所要時間が勤務時間と一致する必要があります。</li>
                      <li>• 作業区分と作業内容は作業内容マスタから選択してください。</li>
                      <li>• D指令は作業指令一覧（状態が「完了」以外）から選択してください。</li>
                      <li>• ラインは事前にラインマスタで登録します。</li>
                    </ul>
                  </div>
                </div>

                <div className="mt-6 pt-4 border-t border-slate-200">
                  <label className="flex items-center gap-2 cursor-pointer mb-4">
                    <input
                      type="checkbox"
                      checked={dontShowAgain}
                      onChange={(e) => setDontShowAgain(e.target.checked)}
                      className="h-4 w-4 rounded border-slate-300 text-amber-600 focus:ring-2 focus:ring-amber-500"
                    />
                    <span className="text-sm text-slate-600">以後表示しない</span>
                  </label>

                  <button
                    onClick={handleCloseGuide}
                    className="w-full rounded-lg bg-amber-600 px-4 py-3 text-base font-bold text-white shadow-lg hover:bg-amber-500 transition"
                  >
                    閉じる
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 作業指令新規登録モーダル */}
        {showAddOrderModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="relative max-w-2xl w-full rounded-2xl border border-blue-200/30 bg-white shadow-2xl max-h-[90vh] flex flex-col">
              <div className="p-6 border-b border-slate-200">
                <div className="flex items-center justify-between">
                  <h2 className="text-2xl font-bold text-slate-900">作業指令新規登録</h2>
                  <button
                    onClick={handleAddOrderCancel}
                    className="text-slate-400 hover:text-slate-600 transition"
                  >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-6">
                <iframe
                  src="/work-orders?modal=true"
                  className="w-full h-full border-0"
                  style={{ minHeight: '500px' }}
                  title="Work Order Registration"
                />
              </div>

              <div className="p-6 border-t border-slate-200 flex gap-3">
                <button
                  onClick={handleAddOrderCancel}
                  className="flex-1 rounded-lg border border-slate-300 px-4 py-3 text-base font-semibold text-slate-700 hover:bg-slate-50 transition"
                >
                  キャンセル
                </button>
                <button
                  onClick={handleAddOrderSuccess}
                  className="flex-1 rounded-lg bg-blue-600 px-4 py-3 text-base font-semibold text-white hover:bg-blue-500 transition"
                >
                  登録完了
                </button>
              </div>
            </div>
          </div>
        )}      </div>
    </div>
  )
}