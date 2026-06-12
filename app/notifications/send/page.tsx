'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

type Staff = {
  id: string
  login_id: string
  name: string
  department: string | null
  work_group_code: string | null
}

type NotificationType = 'work_report_reminder' | 'announcement' | 'info'

export default function SendNotificationPage() {
  const [staffList, setStaffList] = useState<Staff[]>([])
  const [selectedStaffIds, setSelectedStaffIds] = useState<string[]>([])
  const [message, setMessage] = useState('')
  const [notificationType, setNotificationType] = useState<NotificationType>('work_report_reminder')
  const [isSending, setIsSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')

  useEffect(() => {
    fetchStaffList()
  }, [])

  const fetchStaffList = async () => {
    try {
      const response = await fetch('/api/staffs')
      if (!response.ok) throw new Error('Failed to fetch staff list')
      const data = await response.json()
      setStaffList(data || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'スタッフ一覧の取得に失敗しました')
    }
  }

  const handleSelectAll = () => {
    if (selectedStaffIds.length === filteredStaffList.length) {
      setSelectedStaffIds([])
    } else {
      setSelectedStaffIds(filteredStaffList.map(s => s.id))
    }
  }

  const handleToggleStaff = (staffId: string) => {
    setSelectedStaffIds(prev =>
      prev.includes(staffId)
        ? prev.filter(id => id !== staffId)
        : [...prev, staffId]
    )
  }

  const handleSendNotifications = async () => {
    if (selectedStaffIds.length === 0) {
      setError('送信先のスタッフを選択してください')
      return
    }

    if (!message.trim()) {
      setError('メッセージを入力してください')
      return
    }

    setIsSending(true)
    setError(null)
    setSuccessMessage(null)

    try {
      // 各スタッフに通知を送信
      const promises = selectedStaffIds.map(staffId =>
        fetch('/api/notifications', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            staff_id: staffId,
            message: message.trim(),
            notification_type: notificationType,
            created_by: 'admin' // 実際にはログイン中の管理者IDを使用
          })
        })
      )

      const results = await Promise.all(promises)
      const failedCount = results.filter(r => !r.ok).length

      if (failedCount > 0) {
        setError(`${failedCount}件の送信に失敗しました`)
      } else {
        setSuccessMessage(`${selectedStaffIds.length}名に通知を送信しました`)
        setMessage('')
        setSelectedStaffIds([])
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '通知の送信に失敗しました')
    } finally {
      setIsSending(false)
    }
  }

  const filteredStaffList = staffList.filter(staff =>
    staff.name.includes(searchQuery) ||
    staff.login_id.includes(searchQuery) ||
    (staff.department && staff.department.includes(searchQuery)) ||
    (staff.work_group_code && staff.work_group_code.includes(searchQuery))
  )

  const getNotificationTypeLabel = (type: NotificationType) => {
    switch (type) {
      case 'work_report_reminder':
        return '📝 日報催促'
      case 'announcement':
        return '📢 お知らせ'
      case 'info':
        return 'ℹ️ 情報'
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-blue-950 to-slate-950 relative overflow-hidden">
      <div className="absolute inset-0 opacity-10">
        <svg className="w-full h-full" viewBox="0 0 1200 800">
          <pattern id="circuit-notification" x="0" y="0" width="200" height="200" patternUnits="userSpaceOnUse">
            <path d="M 0 50 L 50 50 L 50 0" stroke="currentColor" strokeWidth="2" fill="none" className="text-blue-400" />
            <circle cx="50" cy="50" r="3" fill="currentColor" className="text-blue-400" />
          </pattern>
          <rect width="1200" height="800" fill="url(#circuit-notification)" />
        </svg>
      </div>

      <div className="relative z-10 mx-auto max-w-6xl px-4 py-10">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between mb-8">
          <div>
            <p className="text-blue-200 text-sm uppercase tracking-[0.3em]">Notification Management</p>
            <h1 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-blue-300 via-cyan-300 to-teal-300">
              通知送信
            </h1>
          </div>
          <Link href="/">
            <button className="px-6 py-2 bg-gradient-to-r from-slate-700 to-slate-800 hover:from-slate-600 hover:to-slate-700 text-white font-medium rounded-lg transition-all duration-300 border border-slate-600 hover:border-slate-500">
              ← ホーム
            </button>
          </Link>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* 左側：スタッフ選択 */}
          <div className="space-y-6">
            <div className="rounded-2xl border border-blue-200/30 bg-white/95 p-6 shadow-xl backdrop-blur">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-slate-900">送信先スタッフ</h2>
                <span className="text-sm text-slate-600">
                  {selectedStaffIds.length} / {filteredStaffList.length} 名選択
                </span>
              </div>

              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="スタッフ名、ID、部署で検索..."
                className="w-full mb-4 rounded-lg border border-slate-300 px-3 py-2 text-slate-900"
              />

              <div className="mb-3">
                <button
                  type="button"
                  onClick={handleSelectAll}
                  className="text-sm text-blue-600 hover:text-blue-700 font-medium"
                >
                  {selectedStaffIds.length === filteredStaffList.length ? '全選択解除' : '全選択'}
                </button>
              </div>

              <div className="max-h-[500px] overflow-y-auto space-y-2">
                {filteredStaffList.map((staff) => (
                  <label
                    key={staff.id}
                    className="flex items-center gap-3 p-3 rounded-lg border border-slate-200 hover:border-blue-300 hover:bg-blue-50 cursor-pointer transition"
                  >
                    <input
                      type="checkbox"
                      checked={selectedStaffIds.includes(staff.id)}
                      onChange={() => handleToggleStaff(staff.id)}
                      className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-2 focus:ring-blue-500"
                    />
                    <div className="flex-1">
                      <div className="font-medium text-slate-900">{staff.name}</div>
                      <div className="text-xs text-slate-500">
                        {staff.login_id} 
                        {staff.department && ` / ${staff.department}`}
                        {staff.work_group_code && ` / ${staff.work_group_code}`}
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          </div>

          {/* 右側：メッセージ作成 */}
          <div className="space-y-6">
            <div className="rounded-2xl border border-blue-200/30 bg-white/95 p-6 shadow-xl backdrop-blur">
              <h2 className="text-lg font-semibold text-slate-900 mb-4">通知内容</h2>

              <div className="space-y-4">
                <div>
                  <label className="text-sm font-bold text-slate-900 mb-2 block">通知種類</label>
                  <div className="grid grid-cols-1 gap-2">
                    {(['work_report_reminder', 'announcement', 'info'] as NotificationType[]).map((type) => (
                      <label
                        key={type}
                        className={`flex items-center gap-3 p-3 rounded-lg border-2 cursor-pointer transition ${
                          notificationType === type
                            ? 'border-blue-500 bg-blue-50'
                            : 'border-slate-200 hover:border-blue-300'
                        }`}
                      >
                        <input
                          type="radio"
                          name="notification_type"
                          value={type}
                          checked={notificationType === type}
                          onChange={(e) => setNotificationType(e.target.value as NotificationType)}
                          className="h-4 w-4 text-blue-600"
                        />
                        <span className="font-medium text-slate-900">
                          {getNotificationTypeLabel(type)}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-sm font-bold text-slate-900 mb-2 block">メッセージ</label>
                  <textarea
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="通知メッセージを入力してください..."
                    rows={8}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 resize-none"
                  />
                  <div className="text-xs text-slate-500 mt-1">
                    {message.length} 文字
                  </div>
                </div>

                {/* テンプレート */}
                <div>
                  <label className="text-sm font-bold text-slate-900 mb-2 block">メッセージテンプレート</label>
                  <div className="space-y-2">
                    <button
                      type="button"
                      onClick={() => setMessage('本日の作業日報をまだ入力していません。入力をお願いします。')}
                      className="w-full text-left px-3 py-2 text-sm bg-slate-100 hover:bg-slate-200 rounded-lg transition"
                    >
                      日報未入力の催促
                    </button>
                    <button
                      type="button"
                      onClick={() => setMessage('明日は定期メンテナンスのため、システムが一時停止します。')}
                      className="w-full text-left px-3 py-2 text-sm bg-slate-100 hover:bg-slate-200 rounded-lg transition"
                    >
                      メンテナンスのお知らせ
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {error && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {error}
              </div>
            )}

            {successMessage && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                {successMessage}
              </div>
            )}

            <button
              onClick={handleSendNotifications}
              disabled={isSending || selectedStaffIds.length === 0 || !message.trim()}
              className="w-full rounded-xl bg-blue-600 px-4 py-4 text-lg font-bold text-white shadow-lg shadow-blue-600/40 transition hover:-translate-y-0.5 hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-blue-300"
            >
              {isSending ? '送信中...' : `${selectedStaffIds.length}名に通知を送信`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
