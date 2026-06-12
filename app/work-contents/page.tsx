'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

type WorkContent = {
  id: string
  work_group_code: string
  work_code: string
  work_name: string
  print_type: string
}

export default function WorkContentsPage() {
  const [workContents, setWorkContents] = useState<WorkContent[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formData, setFormData] = useState({
    work_group_code: '',
    work_code: '',
    work_name: '',
    print_type: '',
  })

  const fetchWorkContents = async () => {
    setIsLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/work-contents')
      if (!response.ok) throw new Error('Failed to fetch work contents')
      const data = await response.json()
      setWorkContents(data || [])
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : 'Unknown error')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchWorkContents()
  }, [])

  const resetForm = () => {
    setFormData({
      work_group_code: '',
      work_code: '',
      work_name: '',
      print_type: '',
    })
    setEditingId(null)
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()

    if (
      !formData.work_group_code.trim() ||
      !formData.work_code.trim() ||
      !formData.work_name.trim() ||
      !formData.print_type.trim()
    ) {
      setError('すべての項目を入力してください')
      return
    }

    setIsLoading(true)
    setError(null)
    try {
      const method = editingId ? 'PUT' : 'POST'
      const response = await fetch('/api/work-contents', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingId,
          work_group_code: formData.work_group_code.trim(),
          work_code: formData.work_code.trim(),
          work_name: formData.work_name.trim(),
          print_type: formData.print_type.trim(),
        }),
      })

      if (!response.ok) {
        const result = await response.json()
        throw new Error(result?.error || '保存に失敗しました')
      }

      await fetchWorkContents()
      resetForm()
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Unknown error')
    } finally {
      setIsLoading(false)
    }
  }

  const handleEdit = (workContent: WorkContent) => {
    setEditingId(workContent.id)
    setFormData({
      work_group_code: workContent.work_group_code,
      work_code: workContent.work_code,
      work_name: workContent.work_name,
      print_type: workContent.print_type,
    })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleDelete = async (workContent: WorkContent) => {
    if (!confirm(`${workContent.work_group_code}-${workContent.work_code} を削除しますか？`)) return

    setIsLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/work-contents', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: workContent.id }),
      })

      if (!response.ok) {
        const result = await response.json()
        throw new Error(result?.error || '削除に失敗しました')
      }

      await fetchWorkContents()
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Unknown error')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-orange-950 to-slate-950 relative overflow-hidden p-8">
      <div className="absolute inset-0 opacity-10">
        <svg className="w-full h-full" viewBox="0 0 1200 800">
          <pattern id="circuit-work-content" x="0" y="0" width="220" height="220" patternUnits="userSpaceOnUse">
            <path d="M 0 60 L 60 60 L 60 0" stroke="currentColor" strokeWidth="2" fill="none" className="text-orange-400" />
            <path d="M 180 180 L 120 180 L 120 220" stroke="currentColor" strokeWidth="2" fill="none" className="text-orange-400" />
            <circle cx="60" cy="60" r="3" fill="currentColor" className="text-orange-400" />
            <circle cx="120" cy="180" r="3" fill="currentColor" className="text-orange-400" />
          </pattern>
          <rect width="1200" height="800" fill="url(#circuit-work-content)" />
        </svg>
      </div>

      <div className="relative z-10 max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <p className="text-orange-200 text-sm uppercase tracking-[0.3em]">Work Content Master</p>
            <h1 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-orange-300 via-amber-300 to-yellow-300">
              作業内容マスタ
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

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.6fr] gap-6">
          <div className="bg-white/95 rounded-2xl shadow-xl border border-orange-100 p-6 backdrop-blur">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">
              {editingId ? '作業内容を編集' : '新しい作業内容を追加'}
            </h2>
            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">作業グループコード *</label>
                <input
                  type="text"
                  value={formData.work_group_code}
                  onChange={(event) =>
                    setFormData({ ...formData, work_group_code: event.target.value })
                  }
                  placeholder="例: WG-01"
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">作業コード *</label>
                <input
                  type="text"
                  value={formData.work_code}
                  onChange={(event) => setFormData({ ...formData, work_code: event.target.value })}
                  placeholder="例: WK-001"
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">作業名 *</label>
                <input
                  type="text"
                  value={formData.work_name}
                  onChange={(event) => setFormData({ ...formData, work_name: event.target.value })}
                  placeholder="例: 組立"
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">印刷種別 *</label>
                <input
                  type="text"
                  value={formData.print_type}
                  onChange={(event) => setFormData({ ...formData, print_type: event.target.value })}
                  placeholder="例: ラベル"
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
                />
              </div>
              <div className="flex flex-wrap gap-3 pt-2">
                <button
                  type="submit"
                  disabled={isLoading}
                  className="px-5 py-2 bg-orange-600 hover:bg-orange-500 text-white font-medium rounded-lg transition disabled:bg-orange-300"
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

          <div className="bg-white/95 rounded-2xl shadow-xl border border-orange-100 p-6 backdrop-blur">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-slate-900">作業内容一覧</h2>
              <div className="text-sm text-slate-500">
                {isLoading ? '読み込み中...' : `${workContents.length} 件`}
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-left text-slate-500">
                  <tr>
                    <th className="py-2 pr-4">作業グループ</th>
                    <th className="py-2 pr-4">作業コード</th>
                    <th className="py-2 pr-4">作業名</th>
                    <th className="py-2 pr-4">印刷種別</th>
                    <th className="py-2">操作</th>
                  </tr>
                </thead>
                <tbody className="text-slate-700">
                  {workContents.length === 0 && !isLoading ? (
                    <tr>
                      <td colSpan={5} className="py-6 text-center text-slate-400">
                        作業内容が未登録です
                      </td>
                    </tr>
                  ) : (
                    workContents.map((workContent) => (
                      <tr key={workContent.id} className="border-t border-slate-100">
                        <td className="py-3 pr-4 font-medium text-slate-900">
                          {workContent.work_group_code}
                        </td>
                        <td className="py-3 pr-4">{workContent.work_code}</td>
                        <td className="py-3 pr-4">{workContent.work_name}</td>
                        <td className="py-3 pr-4">{workContent.print_type}</td>
                        <td className="py-3">
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => handleEdit(workContent)}
                              className="px-3 py-1 rounded-md bg-amber-100 text-amber-700 hover:bg-amber-200 transition"
                            >
                              編集
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDelete(workContent)}
                              className="px-3 py-1 rounded-md bg-rose-100 text-rose-700 hover:bg-rose-200 transition"
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
          </div>
        </div>
      </div>
    </div>
  )
}
