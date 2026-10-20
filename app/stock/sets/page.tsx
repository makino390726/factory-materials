'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'

type SetSummary = {
  id: string
  sheet_name: string
  set_code: string
  set_name: string
  item_count: number
}

type SetLine = {
  line_no: number
  product_code: string
  product_name: string
  qty_per_set: number
  supplier: string
  shelf_no: string | null
  stock_qty: number
  in_master: boolean
}

function roundQty(value: number): number {
  return Math.round(value * 10000) / 10000
}

function formatQty(value: number): string {
  return roundQty(value).toLocaleString('ja-JP', { maximumFractionDigits: 4 })
}

type DraftItem = {
  key: string
  product_code: string
  product_name: string
  qty_per_set: string
  supplier: string
}

function blankItem(): DraftItem {
  return {
    key: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    product_code: '',
    product_name: '',
    qty_per_set: '',
    supplier: '',
  }
}

function SetEditor({
  title,
  setCode,
  setName,
  items,
  saving,
  onChangeSetCode,
  onChangeSetName,
  onChangeItem,
  onAddItem,
  onRemoveItem,
  onLookupName,
  onCancel,
  onSave,
}: {
  title: string
  setCode: string
  setName: string
  items: DraftItem[]
  saving: boolean
  onChangeSetCode: (value: string) => void
  onChangeSetName: (value: string) => void
  onChangeItem: (key: string, field: keyof Omit<DraftItem, 'key'>, value: string) => void
  onAddItem: () => void
  onRemoveItem: (key: string) => void
  onLookupName: (key: string, productCode: string) => void
  onCancel: () => void
  onSave: () => void
}) {
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold text-cyan-200">{title}</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-semibold text-cyan-200">
          セットコード
          <input
            value={setCode}
            onChange={(event) => onChangeSetCode(event.target.value)}
            placeholder="無い場合は空欄"
            className="mt-1 block w-full rounded-lg border-2 border-cyan-400 bg-slate-900 px-3 py-2 font-normal text-white"
          />
        </label>
        <label className="text-sm font-semibold text-cyan-200">
          セット品名
          <input
            value={setName}
            onChange={(event) => onChangeSetName(event.target.value)}
            className="mt-1 block w-full rounded-lg border-2 border-cyan-400 bg-slate-900 px-3 py-2 font-normal text-white"
          />
        </label>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="border-b-2 border-cyan-500 text-cyan-200">
            <tr>
              <th className="px-2 py-2 text-left">商品コード</th>
              <th className="px-2 py-2 text-left">商品名</th>
              <th className="px-2 py-2 text-right">必要数</th>
              <th className="px-2 py-2 text-left">発注先</th>
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.key} className="border-b border-cyan-950">
                <td className="px-2 py-2">
                  <input
                    value={item.product_code}
                    onChange={(event) => onChangeItem(item.key, 'product_code', event.target.value)}
                    onBlur={() => onLookupName(item.key, item.product_code)}
                    className="w-full rounded border border-slate-600 bg-slate-900 px-2 py-1"
                  />
                </td>
                <td className="px-2 py-2">
                  <input
                    value={item.product_name}
                    onChange={(event) => onChangeItem(item.key, 'product_name', event.target.value)}
                    className="w-full rounded border border-slate-600 bg-slate-900 px-2 py-1"
                  />
                </td>
                <td className="px-2 py-2">
                  <input
                    value={item.qty_per_set}
                    onChange={(event) => onChangeItem(item.key, 'qty_per_set', event.target.value)}
                    inputMode="decimal"
                    className="w-24 rounded border border-slate-600 bg-slate-900 px-2 py-1 text-right"
                  />
                </td>
                <td className="px-2 py-2">
                  <input
                    value={item.supplier}
                    onChange={(event) => onChangeItem(item.key, 'supplier', event.target.value)}
                    className="w-full rounded border border-slate-600 bg-slate-900 px-2 py-1"
                  />
                </td>
                <td className="px-2 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => onRemoveItem(item.key)}
                    className="text-xs font-semibold text-red-300"
                  >
                    行削除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={onAddItem}
          className="rounded-lg border border-cyan-400 px-3 py-2 text-sm font-semibold text-cyan-200"
        >
          行を追加
        </button>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="rounded-lg border border-slate-500 px-4 py-2 text-sm font-semibold text-slate-200"
          >
            キャンセル
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-bold text-white disabled:bg-slate-700"
          >
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function SetIssuePage() {
  const [sets, setSets] = useState<SetSummary[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [lines, setLines] = useState<SetLine[]>([])
  const [setCountInput, setSetCountInput] = useState('1')
  const [loadingList, setLoadingList] = useState(true)
  const [loadingLines, setLoadingLines] = useState(false)
  const [issuing, setIssuing] = useState(false)
  const [importing, setImporting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editorMode, setEditorMode] = useState<'create' | 'edit' | null>(null)
  const [draftCode, setDraftCode] = useState('')
  const [draftName, setDraftName] = useState('')
  const [draftItems, setDraftItems] = useState<DraftItem[]>([blankItem()])
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [query, setQuery] = useState('')

  const setCount = Number(setCountInput)
  const setCountValid = Number.isInteger(setCount) && setCount > 0 && setCount <= 999
  const selected = sets.find((setProduct) => setProduct.id === selectedId) || null

  const loadSets = async () => {
    setLoadingList(true)
    setError('')
    try {
      const response = await fetch('/api/sets')
      const data = await response.json()
      if (!data.success) throw new Error(data.error || '一覧の取得に失敗しました')
      setSets(data.sets || [])
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '一覧の取得に失敗しました')
    } finally {
      setLoadingList(false)
    }
  }

  useEffect(() => {
    loadSets()
  }, [])

  const loadLines = async (id: string) => {
    setLoadingLines(true)
    setError('')
    setMessage('')
    try {
      const response = await fetch(`/api/sets/lines?id=${encodeURIComponent(id)}`)
      const data = await response.json()
      if (!data.success) throw new Error(data.error || '明細の取得に失敗しました')
      setLines(data.lines || [])
    } catch (loadError) {
      setLines([])
      setError(loadError instanceof Error ? loadError.message : '明細の取得に失敗しました')
    } finally {
      setLoadingLines(false)
    }
  }

  const filteredSets = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) return sets
    return sets.filter((setProduct) =>
      [setProduct.set_code, setProduct.set_name, setProduct.sheet_name]
        .join(' ')
        .toLowerCase()
        .includes(keyword)
    )
  }, [sets, query])

  const tableRows = lines.map((line) => {
    const requiredQty = line.qty_per_set
    const totalQty = setCountValid ? roundQty(requiredQty * setCount) : null
    const difference = totalQty == null ? null : roundQty(line.stock_qty - totalQty)
    const short = totalQty != null && totalQty > 0 && line.stock_qty < totalQty
    return { line, requiredQty, totalQty, difference, short }
  })

  const shortCount = tableRows.filter((row) => row.short).length
  const issueCount = tableRows.filter((row) => (row.totalQty || 0) > 0).length

  const openCreate = () => {
    setEditorMode('create')
    setDraftCode('')
    setDraftName('')
    setDraftItems([blankItem()])
    setError('')
    setMessage('')
  }

  const openEdit = () => {
    if (!selected) return
    setEditorMode('edit')
    setDraftCode(selected.set_code || '')
    setDraftName(selected.set_name)
    setDraftItems(
      lines.length > 0
        ? lines.map((line) => ({
            key: `${line.line_no}-${line.product_code}`,
            product_code: line.product_code,
            product_name: line.product_name,
            qty_per_set: String(line.qty_per_set),
            supplier: line.supplier || '',
          }))
        : [blankItem()]
    )
    setError('')
    setMessage('')
  }

  const updateDraftItem = (key: string, field: keyof Omit<DraftItem, 'key'>, value: string) => {
    setDraftItems((current) => current.map((item) => (item.key === key ? { ...item, [field]: value } : item)))
  }

  const lookupProductName = async (key: string, productCode: string) => {
    const code = productCode.trim()
    if (code.length < 4) return
    try {
      const response = await fetch(`/api/products/search?q=${encodeURIComponent(code)}`)
      const data = await response.json()
      if (!Array.isArray(data)) return
      const normalizeCode = (value: string) => value.trim().replace(/^0+/, '')
      const match = data.find(
        (product: { product_code?: string; name?: string }) =>
          normalizeCode(String(product.product_code || '')) === normalizeCode(code)
      )
      if (!match?.name) return
      setDraftItems((current) =>
        current.map((item) =>
          item.key === key && !item.product_name.trim() ? { ...item, product_name: match.name } : item
        )
      )
    } catch {
      // 商品名の補完に失敗しても手入力できる
    }
  }

  const saveDraft = async () => {
    setSaving(true)
    setError('')
    setMessage('')
    try {
      const payload = {
        id: selectedId,
        set_code: draftCode,
        set_name: draftName,
        items: draftItems.map((item) => ({
          product_code: item.product_code,
          product_name: item.product_name,
          qty_per_set: item.qty_per_set,
          supplier: item.supplier,
        })),
      }
      const response = await fetch('/api/sets', {
        method: editorMode === 'edit' ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await response.json()
      if (!data.success) throw new Error(data.error || '保存に失敗しました')
      setEditorMode(null)
      await loadSets()
      setSelectedId(data.set.id)
      await loadLines(data.set.id)
      setMessage(editorMode === 'edit' ? 'セット品を更新しました' : 'セット品を登録しました')
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!selected) return
    const confirmed = window.confirm(`${selected.set_name} を削除します。よろしいですか？`)
    if (!confirmed) return
    setSaving(true)
    setError('')
    setMessage('')
    try {
      const response = await fetch('/api/sets', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: selected.id }),
      })
      const data = await response.json()
      if (!data.success) throw new Error(data.error || '削除に失敗しました')
      setSelectedId('')
      setLines([])
      setEditorMode(null)
      await loadSets()
      setMessage('セット品を削除しました')
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : '削除に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  const handleIssue = async () => {
    if (!selected || !setCountValid || shortCount > 0 || issueCount === 0) return
    const confirmed = window.confirm(
      `${selected.set_name} を ${setCount} セット払い出します。構成品を出庫します。よろしいですか？`
    )
    if (!confirmed) return

    const staffRaw = sessionStorage.getItem('staff')
    let loginId = ''
    let staffName = ''
    if (staffRaw) {
      try {
        const staff = JSON.parse(staffRaw)
        loginId = staff.login_id || ''
        staffName = staff.name || ''
      } catch {
        loginId = ''
      }
    }

    setIssuing(true)
    setError('')
    setMessage('')
    try {
      const response = await fetch('/api/sets/issue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          set_id: selected.id,
          set_count: setCount,
          login_id: loginId,
          staff_name: staffName,
        }),
      })
      const data = await response.json()
      if (!data.success) throw new Error(data.error || '払い出しに失敗しました')
      setLines(data.lines || [])
      setMessage(`${data.issued_count} 品目を出庫しました`)
    } catch (issueError) {
      setError(issueError instanceof Error ? issueError.message : '払い出しに失敗しました')
    } finally {
      setIssuing(false)
    }
  }

  const handleImport = async (file: File | null) => {
    if (!file) return
    setImporting(true)
    setError('')
    setMessage('')
    try {
      const formData = new FormData()
      formData.append('file', file)
      const response = await fetch('/api/sets/import', { method: 'POST', body: formData })
      const data = await response.json()
      if (!data.success) throw new Error(data.error || '取込に失敗しました')
      setSelectedId('')
      setLines([])
      await loadSets()
      setMessage(`セット品を ${data.count} 件取り込みました`)
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : '取込に失敗しました')
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-teal-950 to-slate-950 px-4 py-8 text-white">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold text-teal-200">セット品払い出し</h1>
            <p className="mt-2 text-sm text-slate-300">
              セット数を入れると、必要数×セット数・棚番・現在在庫・過不足・発注先を表示します。
            </p>
          </div>
          <Link href="/" className="text-sm font-semibold text-teal-300 hover:text-teal-100">
            ← ホーム
          </Link>
        </div>

        {error && (
          <div className="rounded-lg border border-red-500 bg-red-950/50 px-4 py-3 text-red-200">{error}</div>
        )}
        {message && (
          <div className="rounded-lg border border-emerald-500 bg-emerald-950/40 px-4 py-3 text-emerald-200">
            {message}
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
          <section className="rounded-xl border-2 border-teal-500 bg-slate-950/40 p-4">
            <div className="mb-2 flex items-center justify-between gap-2">
              <label className="text-sm font-semibold text-teal-200">セット品</label>
              <button
                type="button"
                onClick={openCreate}
                className="rounded-lg bg-teal-700 px-3 py-1 text-xs font-bold text-white"
              >
                新規登録
              </button>
            </div>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="コード・品名・シート名"
              className="mb-3 w-full rounded-lg border-2 border-teal-400 bg-slate-900 px-3 py-2 text-sm"
            />
            <div className="max-h-[70vh] space-y-2 overflow-y-auto">
              {loadingList ? (
                <p className="text-sm text-slate-400">読み込み中...</p>
              ) : filteredSets.length === 0 ? (
                <p className="text-sm text-slate-400">該当するセット品がありません</p>
              ) : (
                filteredSets.map((setProduct) => (
                  <button
                    key={setProduct.id}
                    type="button"
                    onClick={() => {
                      setSelectedId(setProduct.id)
                      loadLines(setProduct.id)
                    }}
                    className={`w-full rounded-lg border px-3 py-2 text-left ${
                      selectedId === setProduct.id
                        ? 'border-teal-300 bg-teal-900/50'
                        : 'border-slate-700 bg-slate-900/60 hover:border-teal-400'
                    }`}
                  >
                    <p className="text-sm font-semibold text-teal-100">{setProduct.set_name}</p>
                    <p className="mt-1 text-xs text-slate-400">
                      {setProduct.set_code || 'セットコードなし'} / {setProduct.item_count}点
                    </p>
                  </button>
                ))
              )}
            </div>
          </section>

          <section className="rounded-xl border-2 border-cyan-500 bg-slate-950/40 p-4">
            {editorMode ? (
              <SetEditor
                title={editorMode === 'edit' ? 'セット品を編集' : 'セット品を登録'}
                setCode={draftCode}
                setName={draftName}
                items={draftItems}
                saving={saving}
                onChangeSetCode={setDraftCode}
                onChangeSetName={setDraftName}
                onChangeItem={updateDraftItem}
                onAddItem={() => setDraftItems((current) => [...current, blankItem()])}
                onRemoveItem={(key) =>
                  setDraftItems((current) => (current.length === 1 ? current : current.filter((item) => item.key !== key)))
                }
                onLookupName={lookupProductName}
                onCancel={() => setEditorMode(null)}
                onSave={saveDraft}
              />
            ) : !selected ? (
              <p className="py-16 text-center text-slate-400">左の一覧からセット品を選んでください</p>
            ) : (
              <div className="space-y-4">
                <div className="flex flex-wrap items-end justify-between gap-4">
                  <div>
                    <h2 className="text-xl font-bold text-cyan-200">{selected.set_name}</h2>
                    <p className="mt-1 text-sm text-slate-400">
                      セットコード: {selected.set_code || '—'} / {selected.sheet_name}
                    </p>
                    <div className="mt-3 flex gap-2">
                      <button
                        type="button"
                        onClick={openEdit}
                        disabled={loadingLines || saving}
                        className="rounded-lg border border-cyan-400 px-3 py-1 text-xs font-bold text-cyan-200 disabled:opacity-50"
                      >
                        編集
                      </button>
                      <button
                        type="button"
                        onClick={handleDelete}
                        disabled={saving}
                        className="rounded-lg border border-red-400 px-3 py-1 text-xs font-bold text-red-300 disabled:opacity-50"
                      >
                        削除
                      </button>
                    </div>
                  </div>
                  <label className="text-sm font-semibold text-cyan-200">
                    払い出すセット数
                    <input
                      type="number"
                      min={1}
                      max={999}
                      step={1}
                      value={setCountInput}
                      onChange={(event) => setSetCountInput(event.target.value)}
                      className="mt-1 block w-32 rounded-lg border-2 border-cyan-400 bg-slate-900 px-3 py-2 text-white"
                    />
                  </label>
                </div>

                {loadingLines ? (
                  <p className="text-slate-400">明細を読み込んでいます...</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[860px] text-sm">
                      <thead className="border-b-2 border-cyan-500 bg-cyan-950/40 text-cyan-200">
                        <tr>
                          <th className="px-3 py-3 text-left">商品コード</th>
                          <th className="px-3 py-3 text-left">商品名</th>
                          <th className="px-3 py-3 text-right">必要数</th>
                          <th className="px-3 py-3 text-right">セット数</th>
                          <th className="px-3 py-3 text-left">棚番</th>
                          <th className="px-3 py-3 text-right">現在在庫</th>
                          <th className="px-3 py-3 text-right">過不足数</th>
                          <th className="px-3 py-3 text-left">発注先</th>
                        </tr>
                      </thead>
                      <tbody>
                        {tableRows.map(({ line, requiredQty, totalQty, difference, short }) => (
                          <tr
                            key={`${line.product_code}-${line.line_no}`}
                            className={`border-b border-cyan-950 ${short ? 'bg-red-950/40' : ''}`}
                          >
                            <td className="px-3 py-2 font-semibold text-cyan-200">{line.product_code}</td>
                            <td className="px-3 py-2 text-slate-200">
                              {line.product_name || '—'}
                              {!line.in_master && (
                                <span className="ml-2 text-xs text-amber-300">マスタ未登録</span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">{formatQty(requiredQty)}</td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {totalQty == null ? '—' : formatQty(totalQty)}
                            </td>
                            <td className="px-3 py-2 whitespace-nowrap">{line.shelf_no || '—'}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{formatQty(line.stock_qty)}</td>
                            <td
                              className={`px-3 py-2 text-right tabular-nums font-semibold ${
                                short ? 'text-red-300' : 'text-emerald-300'
                              }`}
                            >
                              {difference == null ? '—' : formatQty(difference)}
                            </td>
                            <td className="px-3 py-2">{line.supplier || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm text-slate-300">
                    {loadingLines
                      ? '在庫を確認しています...'
                      : shortCount > 0
                        ? `在庫不足が ${shortCount} 行あります。払い出しはできません。`
                        : '過不足数がマイナスの行はありません。'}
                  </p>
                  <button
                    type="button"
                    onClick={handleIssue}
                    disabled={!setCountValid || shortCount > 0 || issueCount === 0 || issuing || loadingLines}
                    className="rounded-lg bg-teal-600 px-5 py-2 font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-700"
                  >
                    {issuing ? '出庫中...' : '払い出し'}
                  </button>
                </div>
              </div>
            )}
          </section>
        </div>

        <section className="rounded-xl border border-slate-700 p-4 text-sm text-slate-300">
          <p className="mb-2 font-semibold text-slate-200">セット品リストを更新</p>
          <input
            type="file"
            accept=".xlsx,.xls"
            disabled={importing}
            onChange={(event) => {
              const file = event.target.files?.[0] || null
              handleImport(file)
              event.target.value = ''
            }}
          />
          <p className="mt-2 text-xs text-slate-400">
            1行目がセットコードとセット品名、2行目が項目名、3行目以降が構成品のExcelを取り込めます。
          </p>
        </section>
      </div>
    </div>
  )
}
