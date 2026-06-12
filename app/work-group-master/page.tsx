'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

type WorkGroup = {
  id: string
  group_no: string
  work_group_code: string
  work_name: string
}

export default function WorkGroupMasterPage() {
  const [workGroups, setWorkGroups] = useState<WorkGroup[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formData, setFormData] = useState({
    group_no: '',
    work_group_code: '',
    work_name: '',
  })

  const fetchWorkGroups = async () => {
    setIsLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/work-group-master')
      if (!response.ok) throw new Error('Failed to fetch work groups')
      const data = await response.json()
      setWorkGroups(data || [])
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : 'Unknown error')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchWorkGroups()
  }, [])

  const resetForm = () => {
    setFormData({
      group_no: '',
      work_group_code: '',
      work_name: '',
    })
    setEditingId(null)
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()

    if (
      !formData.group_no.trim() ||
      !formData.work_group_code.trim() ||
      !formData.work_name.trim()
    ) {
      setError('すべての項目を入力してください')
      return
    }

    setIsLoading(true)
    setError(null)
    try {
      const method = editingId ? 'PUT' : 'POST'
      const response = await fetch('/api/work-group-master', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingId,
          group_no: formData.group_no.trim(),
          work_group_code: formData.work_group_code.trim(),
          work_name: formData.work_name.trim(),
        }),
      })

      if (!response.ok) {
        const result = await response.json()
        throw new Error(result?.error || '保存に失敗しました')
      }

      await fetchWorkGroups()
      resetForm()
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Unknown error')
    } finally {
      setIsLoading(false)
    }
  }

  const handleEdit = (workGroup: WorkGroup) => {
    setEditingId(workGroup.id)
    setFormData({
      group_no: workGroup.group_no,
      work_group_code: workGroup.work_group_code,
      work_name: workGroup.work_name,
    })
  }

  const handleDelete = async (id: string) => {
    if (!confirm('削除してよろしいですか？')) return

    setIsLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/work-group-master?id=${id}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const result = await response.json()
        throw new Error(result?.error || '削除に失敗しました')
      }

      await fetchWorkGroups()
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Unknown error')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-blue-50 to-slate-50 p-6">
      <div className="mx-auto max-w-6xl">
        {/* ヘッダー */}
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="bg-gradient-to-r from-indigo-600 to-blue-600 bg-clip-text text-3xl font-bold text-transparent">
              作業グループマスター
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              作業グループの登録・編集・削除
            </p>
          </div>
          <Link
            href="/"
            className="rounded-lg bg-slate-600 px-4 py-2 text-white shadow hover:bg-slate-700 transition"
          >
            ← ホーム
          </Link>
        </div>

        {/* エラー表示 */}
        {error && (
          <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-red-600">
            {error}
          </div>
        )}

        {/* 登録・編集フォーム */}
        <div className="mb-8 rounded-xl bg-white p-6 shadow-lg border border-indigo-100">
          <h2 className="mb-4 text-lg font-semibold text-indigo-900">
            {editingId ? '編集' : '新規登録'}
          </h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-4 md:grid-cols-3">
              <div>
                <label className="block text-sm font-medium text-slate-700">
                  グループ番号 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formData.group_no}
                  onChange={(e) =>
                    setFormData({ ...formData, group_no: e.target.value })
                  }
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                  placeholder="例: 01"
                  disabled={isLoading}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">
                  作業グループコード <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formData.work_group_code}
                  onChange={(e) =>
                    setFormData({ ...formData, work_group_code: e.target.value })
                  }
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                  placeholder="例: P-1"
                  disabled={isLoading}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">
                  作業名 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formData.work_name}
                  onChange={(e) =>
                    setFormData({ ...formData, work_name: e.target.value })
                  }
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                  placeholder="例: パネル班"
                  disabled={isLoading}
                />
              </div>
            </div>
            <div className="flex gap-3">
              <button
                type="submit"
                disabled={isLoading}
                className="rounded-lg bg-gradient-to-r from-indigo-600 to-blue-600 px-6 py-2 font-semibold text-white shadow-md hover:from-indigo-700 hover:to-blue-700 disabled:opacity-50 transition"
              >
                {isLoading ? '処理中...' : editingId ? '更新' : '登録'}
              </button>
              {editingId && (
                <button
                  type="button"
                  onClick={resetForm}
                  className="rounded-lg border border-slate-300 bg-white px-6 py-2 text-slate-700 hover:bg-slate-50 transition"
                  disabled={isLoading}
                >
                  キャンセル
                </button>
              )}
            </div>
          </form>
        </div>

        {/* 一覧テーブル */}
        <div className="rounded-xl bg-white shadow-lg border border-indigo-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gradient-to-r from-indigo-600 to-blue-600 text-white">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-semibold">
                    グループ番号
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-semibold">
                    作業グループコード
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-semibold">
                    作業名
                  </th>
                  <th className="px-4 py-3 text-center text-sm font-semibold w-32">
                    操作
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {workGroups.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-slate-500">
                      データがありません
                    </td>
                  </tr>
                ) : (
                  workGroups.map((group) => (
                    <tr
                      key={group.id}
                      className="hover:bg-indigo-50 transition"
                    >
                      <td className="px-4 py-3 text-slate-900">
                        {group.group_no}
                      </td>
                      <td className="px-4 py-3 text-slate-900 font-medium">
                        {group.work_group_code}
                      </td>
                      <td className="px-4 py-3 text-slate-900">
                        {group.work_name}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex justify-center gap-2">
                          <button
                            onClick={() => handleEdit(group)}
                            className="rounded bg-blue-500 px-3 py-1 text-sm text-white hover:bg-blue-600 transition"
                            disabled={isLoading}
                          >
                            編集
                          </button>
                          <button
                            onClick={() => handleDelete(group.id)}
                            className="rounded bg-red-500 px-3 py-1 text-sm text-white hover:bg-red-600 transition"
                            disabled={isLoading}
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
  )
}
