'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

interface ManufacturingPlan {
  id: string
  created_at: string
}

interface PlanDetail {
  id: string
  plan_id: string
  model: string
  quantity: number
}

interface GroupedAllocation {
  size: string
  models: Array<{
    model: string
    quantity: number
    percentInSize: number
    percentTotal: number
  }>
  subtotal: number
}

interface CustomGroup {
  id: string
  minSize: string
  maxSize: string
  models: Array<{
    model: string
    quantity: number
    percent: number
  }>
  subtotal: number
}

export default function ManufacturingPlanAllocationPage() {
  const [plans, setPlans] = useState<ManufacturingPlan[]>([])
  const [selectedPlanId, setSelectedPlanId] = useState<string>('')
  const [details, setDetails] = useState<PlanDetail[]>([])
  const [allocations, setAllocations] = useState<GroupedAllocation[]>([])
  const [totalQuantity, setTotalQuantity] = useState(0)
  const [loading, setLoading] = useState(true)
  const [availableSizes, setAvailableSizes] = useState<string[]>([])
  const [selectedMinSize, setSelectedMinSize] = useState<string>('')
  const [selectedMaxSize, setSelectedMaxSize] = useState<string>('')
  const [customGroups, setCustomGroups] = useState<CustomGroup[]>([])

  // 計画リストを取得
  useEffect(() => {
    const fetchPlans = async () => {
      try {
        const res = await fetch('/api/heater/manufacturing-plans')
        const data = await res.json()
        setPlans(data || [])
      } catch (err) {
        console.error('fetch plans error:', err)
      } finally {
        setLoading(false)
      }
    }
    fetchPlans()
  }, [])

  // モデルからサイズを抽出 (例: "110L-DF" → "110L")
  const extractSize = (model: string): string => {
    const match = model.match(/^(\d+L)/)
    return match ? match[1] : model
  }

  // サイズを数値に変換
  const getSizeNumber = (size: string): number => {
    const match = size.match(/^(\d+)/)
    return match ? parseInt(match[1]) : 0
  }

  // カスタムグループを作成
  const createCustomGroup = () => {
    if (!selectedMinSize || !selectedMaxSize) return

    const minNum = getSizeNumber(selectedMinSize)
    const maxNum = getSizeNumber(selectedMaxSize)

    if (minNum >= maxNum) {
      alert('最小サイズは最大サイズより小さい値を選択してください')
      return
    }

    // 範囲内のモデルをフィルタリング
    const filteredModels = (details || []).filter((item) => {
      const size = extractSize(item.model)
      const sizeNum = getSizeNumber(size)
      return sizeNum >= minNum && sizeNum <= maxNum
    })

    if (filteredModels.length === 0) {
      alert('指定範囲内にモデルがありません')
      return
    }

    // 範囲内での割合を計算
    const subtotal = filteredModels.reduce((sum, item) => sum + item.quantity, 0)
    const groupModels = filteredModels
      .sort((a, b) => a.model.localeCompare(b.model))
      .map((item) => ({
        model: item.model,
        quantity: item.quantity,
        percent:
          subtotal > 0 ? Math.round((item.quantity / subtotal) * 1000) / 10 : 0,
      }))

    // 新しいカスタムグループを追加
    const newGroup: CustomGroup = {
      id: `custom-${Date.now()}`,
      minSize: selectedMinSize,
      maxSize: selectedMaxSize,
      models: groupModels,
      subtotal,
    }

    setCustomGroups([...customGroups, newGroup])
    setSelectedMinSize('')
    setSelectedMaxSize('')
  }

  // カスタムグループを削除
  const deleteCustomGroup = (id: string) => {
    setCustomGroups(customGroups.filter((g) => g.id !== id))
  }

  // 印刷処理
  const handlePrint = () => {
    window.print()
  }

  // 計画詳細を取得して割合を計算
  useEffect(() => {
    if (!selectedPlanId) {
      setDetails([])
      setAllocations([])
      return
    }

    const fetchDetails = async () => {
      try {
        const res = await fetch(
          `/api/heater/manufacturing-plans/${selectedPlanId}/details`
        )
        const data = await res.json()
        setDetails(data || [])

        // 割合計算
        const total = (data || []).reduce(
          (sum: number, item: PlanDetail) => sum + item.quantity,
          0
        )
        setTotalQuantity(total)

        // サイズでグループ化
        const grouped = new Map<string, PlanDetail[]>()
        ;(data || []).forEach((item: PlanDetail) => {
          const size = extractSize(item.model)
          if (!grouped.has(size)) {
            grouped.set(size, [])
          }
          grouped.get(size)!.push(item)
        })

        // グループ内での割合と全体割合を計算
        const allocArray: GroupedAllocation[] = Array.from(
          grouped.entries()
        ).map(([size, items]) => {
          const subtotal = items.reduce((sum, item) => sum + item.quantity, 0)
          return {
            size,
            models: items.map((item) => ({
              model: item.model,
              quantity: item.quantity,
              percentInSize:
                subtotal > 0
                  ? Math.round((item.quantity / subtotal) * 1000) / 10
                  : 0,
              percentTotal:
                total > 0 ? Math.round((item.quantity / total) * 1000) / 10 : 0,
            })),
            subtotal,
          }
        })

        setAllocations(allocArray)

        // 利用可能なサイズを計算
        const sizes = (
          [
            ...new Set(
              (data || []).map((item: PlanDetail) => extractSize(item.model))
            ),
          ] as string[]
        )
          .sort((a: string, b: string) => {
            const numA = parseInt(a.replace(/L/, ''))
            const numB = parseInt(b.replace(/L/, ''))
            return numA - numB
          })
        setAvailableSizes(sizes)
        setSelectedMinSize('')
        setSelectedMaxSize('')
        setCustomGroups([])
      } catch (err) {
        console.error('fetch details error:', err)
      }
    }

    fetchDetails()
  }, [selectedPlanId])

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-purple-950 to-slate-950 p-4 print:bg-white">
      <div className="mx-auto max-w-7xl print:bg-white print:text-black">
        {/* ホームボタン */}
        <Link
          href="/"
          className="fixed right-4 top-4 z-50 flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-slate-900/80 text-white shadow-lg backdrop-blur transition hover:bg-slate-800 no-print text-xs font-semibold"
          title="ホームに戻る"
        >
          ホーム
        </Link>
        {/* 印刷用ヘッダー */}
        <div className="hidden print:block mb-4 pb-4 border-b border-gray-400">
          <h1 className="text-2xl font-bold mb-2">製造計画配分計算</h1>
          <p className="text-sm text-gray-700">
            印刷日時: {new Date().toLocaleString('ja-JP')}
          </p>
        </div>

        <h1 className="mb-6 text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-blue-400 to-purple-400 no-print">
          製造計画配分計算
        </h1>

        {/* 計画選択パネル */}
        <div className="mb-6 rounded-lg bg-slate-900/50 p-4 shadow border border-slate-700">
          <label className="block text-sm font-medium text-slate-300">
            計画選択:
          </label>
          {loading ? (
            <p className="text-sm text-slate-400">計画を読み込み中...</p>
          ) : (
            <>
              <select
                value={selectedPlanId}
                onChange={(e) => setSelectedPlanId(e.target.value)}
                className="mt-2 w-full rounded border border-slate-600 bg-slate-800 px-3 py-2 text-white"
              >
                <option value="">-- 計画を選択してください --</option>
                {plans.map((plan) => (
                  <option key={plan.id} value={plan.id}>
                    {new Date(plan.created_at).toLocaleString('ja-JP')}
                  </option>
                ))}
              </select>

              {/* 印刷用：選択中の計画情報 */}
              {selectedPlanId && (
                <div className="hidden print:block mt-4 text-sm text-gray-700">
                  <p>
                    <strong>選択計画: </strong>
                    {plans.find((p) => p.id === selectedPlanId) &&
                      new Date(
                        plans.find((p) => p.id === selectedPlanId)!.created_at
                      ).toLocaleString('ja-JP')}
                  </p>
                </div>
              )}
            </>
          )}
        </div>

        {/* 印刷ボタン */}
        {selectedPlanId && allocations.length > 0 && (
          <div className="mb-6 flex justify-end">
            <button
              onClick={handlePrint}
              className="flex items-center gap-2 rounded bg-gradient-to-r from-blue-600 to-cyan-600 px-6 py-2 font-semibold text-white hover:from-blue-500 hover:to-cyan-500 transition no-print"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4H9a2 2 0 00-2 2v2a2 2 0 002 2h10a2 2 0 002-2v-2a2 2 0 00-2-2h-2m-4-4V2a2 2 0 012-2h4a2 2 0 012 2v13m-6 0h6"
                />
              </svg>
              印刷
            </button>
          </div>
        )}

        {/* 割合表示テーブル */}
        {selectedPlanId && allocations.length > 0 && (
          <div className="overflow-x-auto rounded-lg bg-slate-900/50 shadow border border-slate-700">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700 bg-slate-800/50">
                  <th className="px-4 py-3 text-left font-semibold text-slate-300">
                    サイズ
                  </th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-300">
                    機種
                  </th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-300">
                    数量
                  </th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-300">
                    グループ内割合
                  </th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-300">
                    全体割合
                  </th>
                </tr>
              </thead>
              {allocations.map((group, groupIdx) => (
                <tbody key={groupIdx}>
                    {group.models.map((model, modelIdx) => (
                      <tr
                        key={`${groupIdx}-${modelIdx}`}
                        className="border-b border-slate-700 hover:bg-slate-800/30"
                      >
                        {modelIdx === 0 && (
                          <td
                            rowSpan={group.models.length}
                            className="px-4 py-3 font-semibold text-slate-100"
                          >
                            {group.size}
                            <div className="text-xs font-normal text-slate-400">
                              小計: {group.subtotal}台
                            </div>
                          </td>
                        )}
                        <td className="px-4 py-3 text-slate-100">
                          {model.model}
                        </td>
                        <td className="px-4 py-3 text-right text-slate-100">
                          {model.quantity}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="inline-block rounded bg-blue-900/40 px-2 py-1 font-semibold text-blue-300">
                            {model.percentInSize.toFixed(1)}%
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="inline-block rounded bg-green-900/40 px-2 py-1 font-semibold text-green-300">
                            {model.percentTotal.toFixed(1)}%
                          </span>
                        </td>
                      </tr>
                    ))}
                </tbody>
              ))}
            </table>

            {/* 集計情報 */}
            <div className="border-t border-slate-700 bg-slate-800/50 px-4 py-3">
              <div className="flex gap-8 text-sm font-semibold text-slate-100">
                <div>
                  全体計画台数:
                  <span className="ml-2 text-lg text-green-400">
                    {totalQuantity}台
                  </span>
                </div>
                <div>
                  サイズグループ数:
                  <span className="ml-2 text-lg text-blue-400">
                    {allocations.length}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {selectedPlanId && allocations.length === 0 && (
          <div className="rounded-lg bg-amber-900/20 border border-amber-700 p-4 text-amber-300">
            選択した計画に明細がありません。
          </div>
        )}

        {/* 任意グループ作成セクション */}
        {selectedPlanId && allocations.length > 0 && (
          <div className="mt-12">
            <h2 className="mb-6 text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 via-orange-400 to-red-400 no-print">
              任意グループの作成
            </h2>

            <div className="rounded-lg bg-slate-900/50 border border-slate-700 p-6 mb-6 no-print">
              <div className="grid grid-cols-1 md:grid-cols-5 gap-4 items-end">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    最小サイズ:
                  </label>
                  <select
                    value={selectedMinSize}
                    onChange={(e) => setSelectedMinSize(e.target.value)}
                    className="w-full rounded border border-slate-600 bg-slate-800 px-3 py-2 text-white"
                  >
                    <option value="">-- 選択 --</option>
                    {availableSizes.map((size) => (
                      <option key={size} value={size}>
                        {size}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="text-slate-400 text-center">～</div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    最大サイズ:
                  </label>
                  <select
                    value={selectedMaxSize}
                    onChange={(e) => setSelectedMaxSize(e.target.value)}
                    className="w-full rounded border border-slate-600 bg-slate-800 px-3 py-2 text-white"
                  >
                    <option value="">-- 選択 --</option>
                    {availableSizes.map((size) => (
                      <option key={size} value={size}>
                        {size}
                      </option>
                    ))}
                  </select>
                </div>

                <div />

                <button
                  onClick={createCustomGroup}
                  disabled={!selectedMinSize || !selectedMaxSize}
                  className="rounded bg-gradient-to-r from-yellow-600 to-orange-600 px-6 py-2 font-semibold text-white hover:from-yellow-500 hover:to-orange-500 disabled:opacity-50 disabled:cursor-not-allowed transition"
                >
                  グループ作成
                </button>
              </div>
            </div>

            {/* カスタムグループ一覧 */}
            {customGroups.length > 0 && (
              <div className="space-y-6">
                {customGroups.map((group, idx) => (
                  <div key={group.id} className="overflow-x-auto rounded-lg bg-slate-900/50 shadow border border-slate-700">
                    <div className="bg-slate-800/50 px-4 py-3 border-b border-slate-700 flex justify-between items-center">
                      <h3 className="font-semibold text-slate-100">
                        任意グループ {idx + 1} ({group.minSize} ～ {group.maxSize})
                      </h3>
                      <button
                        onClick={() => deleteCustomGroup(group.id)}
                        className="text-red-400 hover:text-red-300 text-sm font-semibold no-print"
                      >
                        削除
                      </button>
                    </div>

                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-700 bg-slate-800/30">
                          <th className="px-4 py-3 text-left font-semibold text-slate-300">
                            機種
                          </th>
                          <th className="px-4 py-3 text-right font-semibold text-slate-300">
                            数量
                          </th>
                          <th className="px-4 py-3 text-right font-semibold text-slate-300">
                            グループ内割合
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.models.map((model) => (
                          <tr
                            key={model.model}
                            className="border-b border-slate-700 hover:bg-slate-800/30"
                          >
                            <td className="px-4 py-3 text-slate-100">
                              {model.model}
                            </td>
                            <td className="px-4 py-3 text-right text-slate-100">
                              {model.quantity}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <span className="inline-block rounded bg-orange-900/40 px-2 py-1 font-semibold text-orange-300">
                                {model.percent.toFixed(1)}%
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    <div className="border-t border-slate-700 bg-slate-800/30 px-4 py-3">
                      <div className="text-sm font-semibold text-slate-100">
                        グループ合計:
                        <span className="ml-2 text-orange-400">{group.subtotal}台</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
