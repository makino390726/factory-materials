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

export default function StaffsPage() {
  const [staffs, setStaffs] = useState<Staff[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formData, setFormData] = useState({
    login_id: '',
    name: '',
    department: '',
    work_group_code: '',
  })

  const fetchStaffs = async () => {
    setIsLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/staffs')
      if (!response.ok) throw new Error('Failed to fetch staffs')
      const data = await response.json()
      setStaffs(data || [])
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : 'Unknown error')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchStaffs()
  }, [])

  const resetForm = () => {
    setFormData({ login_id: '', name: '', department: '', work_group_code: '' })
    setEditingId(null)
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()

    if (!formData.login_id.trim() || !formData.name.trim()) {
      setError('ログインIDと氏名は必須です')
      return
    }

    setIsLoading(true)
    setError(null)
    try {
      const method = editingId ? 'PUT' : 'POST'
      const response = await fetch('/api/staffs', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingId,
          login_id: formData.login_id.trim(),
          name: formData.name.trim(),
          department: formData.department.trim() || null,
          work_group_code: formData.work_group_code.trim() || null,
        }),
      })

      if (!response.ok) {
        const result = await response.json()
        throw new Error(result?.error || '保存に失敗しました')
      }

      await fetchStaffs()
      resetForm()
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Unknown error')
    } finally {
      setIsLoading(false)
    }
  }

  const handleEdit = (staff: Staff) => {
    setEditingId(staff.id)
    setFormData({
      login_id: staff.login_id,
      name: staff.name,
      department: staff.department || '',
      work_group_code: staff.work_group_code || '',
    })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleDelete = async (staff: Staff) => {
    if (!confirm(`${staff.name} を削除しますか？`)) return

    setIsLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/staffs', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: staff.id }),
      })

      if (!response.ok) {
        const result = await response.json()
        throw new Error(result?.error || '削除に失敗しました')
      }

      await fetchStaffs()
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Unknown error')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-emerald-950 to-slate-950 relative overflow-hidden p-8">
      <div className="absolute inset-0 opacity-10">
        <svg className="w-full h-full" viewBox="0 0 1200 800">
          <pattern id="circuit-staff" x="0" y="0" width="220" height="220" patternUnits="userSpaceOnUse">
            <path d="M 0 60 L 60 60 L 60 0" stroke="currentColor" strokeWidth="2" fill="none" className="text-emerald-400" />
            <path d="M 180 180 L 120 180 L 120 220" stroke="currentColor" strokeWidth="2" fill="none" className="text-emerald-400" />
            <circle cx="60" cy="60" r="3" fill="currentColor" className="text-emerald-400" />
            <circle cx="120" cy="180" r="3" fill="currentColor" className="text-emerald-400" />
          </pattern>
          <rect width="1200" height="800" fill="url(#circuit-staff)" />
        </svg>
      </div>

      <div className="relative z-10 max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <p className="text-emerald-200 text-sm uppercase tracking-[0.3em]">Staff Master</p>
            <h1 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-emerald-300 via-teal-300 to-sky-300">
              スタッフマスタ
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

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.4fr] gap-6">
          <div className="bg-white/95 rounded-2xl shadow-xl border border-emerald-100 p-6 backdrop-blur">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">
              {editingId ? 'スタッフを編集' : '新しいスタッフを追加'}
            </h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-black mb-1">ログインID *</label>
                <input
                  type="text"
                  value={formData.login_id}
                  onChange={(event) =>
                    setFormData({ ...formData, login_id: event.target.value })
                  }
                  placeholder="例: staff-001"
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg text-black focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-black mb-1">氏名 *</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(event) => setFormData({ ...formData, name: event.target.value })}
                  placeholder="例: 山田 太郎"
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg text-black focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-black mb-1">部署 / 作業班</label>
                <input
                  type="text"
                  value={formData.department}
                  onChange={(event) =>
                    setFormData({ ...formData, department: event.target.value })
                  }
                  placeholder="例: 組立1班"
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg text-black focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-black mb-1">作業グループコード</label>
                <input
                  type="text"
                  value={formData.work_group_code}
                  onChange={(event) =>
                    setFormData({ ...formData, work_group_code: event.target.value })
                  }
                  placeholder="例: WG01"
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg text-black focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
              <div className="flex flex-wrap gap-3 pt-2">
                <button
                  type="submit"
                  disabled={isLoading}
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded-lg transition disabled:bg-emerald-300"
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

          <div className="bg-white/95 rounded-2xl shadow-xl border border-emerald-100 p-6 backdrop-blur">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-slate-900">登録スタッフ一覧</h2>
              <div className="text-sm text-black">
                {isLoading ? '読み込み中...' : `${staffs.length} 件`}
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full text-xs">
                <thead className="text-left text-black">
                  <tr>
                    <th className="py-2 pr-4">ログインID</th>
                    <th className="py-2 pr-4">氏名</th>
                    <th className="py-2 pr-4">部署</th>
                    <th className="py-2 pr-4">作業グループ</th>
                    <th className="py-2">操作</th>
                  </tr>
                </thead>
                <tbody className="text-black">
                  {staffs.length === 0 && !isLoading ? (
                    <tr>
                      <td colSpan={5} className="py-6 text-center text-slate-400">
                        スタッフが未登録です
                      </td>
                    </tr>
                  ) : (
                    staffs.map((staff) => (
                      <tr key={staff.id} className="border-t border-slate-100">
                        <td className="py-3 pr-4 font-medium text-black">
                          {staff.login_id}
                        </td>
                        <td className="py-3 pr-4 text-black">{staff.name}</td>
                        <td className="py-3 pr-4 text-black">{staff.department || '-'}</td>
                        <td className="py-3 pr-4 text-black">{staff.work_group_code || '-'}</td>
                        <td className="py-3">
                          <div className="flex flex-nowrap gap-1 items-center">
                            <button
                              type="button"
                              onClick={() => handleEdit(staff)}
                              className="px-2 py-1 rounded-md bg-emerald-600 text-white hover:bg-emerald-700 transition text-xs font-medium"
                            >
                              編集
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDelete(staff)}
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
          </div>
        </div>
      </div>
    </div>
  )
}
