'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { formatFiscalYearLabel, getCurrentFiscalYear } from '@/lib/fiscal-year'
import { formatDInstructionNo, INSTRUCTION_SHOPS, isLInstructionOrderNo, type InstructionShop } from '@/lib/work-instruction-progress'

type DocType = '製作' | '切替' | '修理'

type ProgressRow = {
  id: string
  doc_type: DocType
  series_no: string
  fiscal_year: number | null
  sort_no: number | null
  parent_sort_no: number | null
  branch_no: string | null
  item_no: string | null
  category: string | null
  product_name: string | null
  model: string | null
  department: string | null
  assignee: string | null
  delivery_place: string | null
  due_on: string | null
  due_text: string | null
  wish_text: string | null
  planned_qty: number | null
  partial_qty: number | null
  completed_on: string | null
  serial_no: string | null
  receipt_posted: boolean
  comment: string | null
  received_order_no: string | null
  shops: InstructionShop[]
  source: string
}

const DOC_TYPES: DocType[] = ['製作', '切替', '修理']

const CATEGORY_COLOR: Record<string, string> = {
  たばこ: 'bg-blue-600',
  食品: 'bg-fuchsia-500',
  暖房機: 'bg-orange-500',
  作業機: 'bg-red-600',
  青: 'bg-sky-500',
}

function todayIso() {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

function qtyText(value: number | null) {
  if (value == null || Number.isNaN(Number(value))) return ''
  const number = Number(value)
  return Number.isInteger(number) ? String(number) : String(number)
}

function remainingQty(row: ProgressRow) {
  if (row.planned_qty == null) return null
  return Number(row.planned_qty) - Number(row.partial_qty || 0)
}

function nextShop(shop: InstructionShop): InstructionShop {
  if (!shop.assigned && !shop.completed) return { ...shop, assigned: true, completed: false }
  if (shop.assigned && !shop.completed) return { ...shop, assigned: true, completed: true }
  return { ...shop, assigned: false, completed: false }
}

function shopClass(shop: InstructionShop) {
  if (shop.completed) return 'wi-progress bg-emerald-500 border-emerald-600'
  if (shop.assigned) return 'wi-progress bg-yellow-300 border-yellow-500'
  return 'wi-progress bg-white border-slate-200'
}

function productionInstructionNo(row: ProgressRow, parent?: ProgressRow) {
  const itemNo = row.parent_sort_no == null ? row.item_no || row.branch_no : parent?.item_no || parent?.branch_no
  return formatDInstructionNo(row.series_no || parent?.series_no, itemNo)
}

type LinePart = {
  branch_no: string
  part_key: string
  part_name: string | null
  bom_quantity: number | null
}

function plainCode(value: string | null | undefined) {
  const raw = String(value || '')
    .normalize('NFKC')
    .trim()
    .replace(/\.0$/, '')
  if (!raw) return ''
  return /^\d+$/.test(raw) ? String(Number(raw)) : raw
}

function normalizePartName(value: string | null | undefined) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[\s　]/g, '')
    .replace(/[()（）]/g, '')
    .toLowerCase()
}

function lineCodeFromRow(row: ProgressRow) {
  if (row.parent_sort_no != null || !isLInstructionOrderNo(row.series_no)) return ''
  return plainCode(row.item_no || row.branch_no)
}

function partCodeText(row: ProgressRow, masterCode?: string, hideOwnCode = false) {
  if (masterCode) return masterCode
  if (hideOwnCode) return ''
  const code = plainCode(row.item_no || row.branch_no)
  if (!code) return ''
  if (row.parent_sort_no != null) return code
  if (isLInstructionOrderNo(row.series_no)) return code
  return ''
}

function matchMasterParts(children: ProgressRow[], parts: LinePart[]) {
  const used = new Set<string>()
  const byName = new Map<string, LinePart>()
  for (const part of parts) {
    const name = normalizePartName(part.part_name)
    if (name && !byName.has(name)) byName.set(name, part)
  }
  return children.map((child, index) => {
    const named = byName.get(normalizePartName(child.product_name))
    if (named && !used.has(named.part_key)) {
      used.add(named.part_key)
      return named.part_key
    }
    const byIndex = parts[index]
    if (byIndex && !used.has(byIndex.part_key)) {
      used.add(byIndex.part_key)
      return byIndex.part_key
    }
    const next = parts.find((part) => !used.has(part.part_key))
    if (!next) return ''
    used.add(next.part_key)
    return next.part_key
  })
}

function rowIsLInstruction(row: ProgressRow, parents: Map<number, ProgressRow>) {
  const parent = row.parent_sort_no != null ? parents.get(row.parent_sort_no) : undefined
  return isLInstructionOrderNo(productionInstructionNo(row, parent) || row.series_no || parent?.series_no)
}

function compareProductionRows(a: ProgressRow, b: ProgressRow, parents: Map<number, ProgressRow>) {
  const yearA = a.fiscal_year ?? Number.MAX_SAFE_INTEGER
  const yearB = b.fiscal_year ?? Number.MAX_SAFE_INTEGER
  if (yearA !== yearB) return yearA - yearB
  const planA = rowIsLInstruction(a, parents) ? 0 : 1
  const planB = rowIsLInstruction(b, parents) ? 0 : 1
  if (planA !== planB) return planA - planB
  const sortA = a.sort_no ?? Number.MAX_SAFE_INTEGER
  const sortB = b.sort_no ?? Number.MAX_SAFE_INTEGER
  if (sortA !== sortB) return sortA - sortB
  return a.id.localeCompare(b.id)
}

function dueDisplay(row: ProgressRow) {
  return row.due_on || row.due_text || ''
}

function normalizeDueInput(raw: string): { due_on: string | null; due_text: string | null } {
  const text = raw.trim()
  if (!text) return { due_on: null, due_text: null }
  const slash = text.match(/^(\d{4})[/.](\d{1,2})[/.](\d{1,2})$/)
  if (slash) {
    return {
      due_on: `${slash[1]}-${slash[2].padStart(2, '0')}-${slash[3].padStart(2, '0')}`,
      due_text: null,
    }
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return { due_on: text, due_text: null }
  return { due_on: null, due_text: text }
}

function CellInput({
  value,
  title,
  align = 'left',
  widthClass,
  overdue = false,
  onCommit,
}: {
  value: string
  title: string
  align?: 'left' | 'right'
  widthClass: string
  overdue?: boolean
  onCommit: (value: string) => void
}) {
  const [draft, setDraft] = useState(value)

  useEffect(() => {
    setDraft(value)
  }, [value])

  return (
    <input
      value={draft}
      title={title}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (draft !== value) onCommit(draft)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
      }}
      className={`rounded border bg-white px-1 py-1 text-xs ${widthClass} ${
        align === 'right' ? 'text-right' : 'text-left'
      } ${overdue ? 'border-rose-400 font-semibold text-rose-700' : 'border-slate-300'}`}
    />
  )
}

export default function WorkInstructionsPage() {
  const [docType, setDocType] = useState<DocType>('製作')
  const [fiscalYear, setFiscalYear] = useState('all')
  const [openOnly, setOpenOnly] = useState(false)
  const [query, setQuery] = useState('')
  const [rows, setRows] = useState<ProgressRow[]>([])
  const [lineParts, setLineParts] = useState<Record<string, LinePart[]>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [missingTable, setMissingTable] = useState(false)
  const [savingId, setSavingId] = useState<string | null>(null)
  const saveQueue = useRef(new Map<string, Promise<void>>())

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    setMissingTable(false)
    const params = new URLSearchParams({
      doc_type: docType,
      fiscal_year: fiscalYear,
      open_only: openOnly ? '1' : '0',
    })
    try {
      const res = await fetch(`/api/work-instructions?${params.toString()}`)
      const body = await res.json()
      if (!res.ok) {
        setRows([])
        setLineParts({})
        setMissingTable(Boolean(body.missing_table))
        setError(body.error || '取得に失敗しました')
        return
      }
      setRows(Array.isArray(body.rows) ? body.rows : [])
      setLineParts(body.line_parts && typeof body.line_parts === 'object' ? body.line_parts : {})
    } catch {
      setRows([])
      setLineParts({})
      setError('製作指図書の取得に失敗しました')
    } finally {
      setLoading(false)
    }
  }, [docType, fiscalYear, openOnly])

  useEffect(() => {
    void load()
  }, [load])

  const parentBySort = useMemo(() => {
    const map = new Map<number, ProgressRow>()
    for (const row of rows) {
      if (row.parent_sort_no == null && row.sort_no != null) map.set(row.sort_no, row)
    }
    return map
  }, [rows])

  const masterPartByRow = useMemo(() => {
    const map = new Map<string, string>()
    const childrenByParent = new Map<number, ProgressRow[]>()
    for (const row of rows) {
      if (row.parent_sort_no == null || row.sort_no == null) continue
      const list = childrenByParent.get(row.parent_sort_no) || []
      list.push(row)
      childrenByParent.set(row.parent_sort_no, list)
    }
    for (const row of rows) {
      const code = lineCodeFromRow(row)
      const parts = code ? lineParts[code] : undefined
      if (!code || !parts?.length || row.sort_no == null) continue
      const children = (childrenByParent.get(row.sort_no) || []).slice().sort((a, b) => (a.sort_no || 0) - (b.sort_no || 0))
      matchMasterParts(children, parts).forEach((partKey, index) => {
        if (partKey) map.set(children[index].id, partKey)
      })
    }
    return map
  }, [lineParts, rows])

  const visibleRows = useMemo(() => {
    const ordered = docType === '製作' ? [...rows].sort((a, b) => compareProductionRows(a, b, parentBySort)) : rows
    const needle = query.trim().toLowerCase()
    if (!needle) return ordered
    return ordered.filter((row) => {
      const parent = row.parent_sort_no != null ? parentBySort.get(row.parent_sort_no) : undefined
      const masterNo = productionInstructionNo(row, parent)
      return [masterNo, partCodeText(row, masterPartByRow.get(row.id)), row.series_no, row.item_no, row.product_name, row.model, row.assignee, row.branch_no, row.received_order_no]
        .some((value) => String(value || '').toLowerCase().includes(needle))
    })
  }, [docType, masterPartByRow, parentBySort, query, rows])

  const yearOptions = useMemo(() => {
    const current = getCurrentFiscalYear()
    return Array.from({ length: 6 }, (_, index) => current + 1 - index)
  }, [])

  function patchRow(id: string, patch: Record<string, unknown>, optimistic: Partial<ProgressRow>) {
    let snapshot: ProgressRow | undefined
    setRows((current) => {
      snapshot = current.find((row) => row.id === id)
      return current.map((row) => (row.id === id ? { ...row, ...optimistic } : row))
    })
    setError(null)

    const run = async () => {
      setSavingId(id)
      try {
        const res = await fetch('/api/work-instructions', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, ...patch }),
        })
        const body = await res.json()
        if (!res.ok) {
          const saved = snapshot
          setRows((current) => current.map((row) => (row.id === id && saved ? saved : row)))
          setError(body.error || '更新に失敗しました')
          return
        }
        const keys = Object.keys(patch)
        setRows((current) =>
          current.map((row) => {
            if (row.id !== id) return row
            const next = { ...row }
            for (const key of keys) {
              if (key in body) (next as Record<string, unknown>)[key] = body[key]
            }
            return next
          })
        )
      } catch {
        const saved = snapshot
        setRows((current) => current.map((row) => (row.id === id && saved ? saved : row)))
        setError('更新に失敗しました')
      } finally {
        setSavingId(null)
      }
    }

    const previous = saveQueue.current.get(id) ?? Promise.resolve()
    const next = previous.then(run, run)
    saveQueue.current.set(id, next)
  }

  const today = todayIso()

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <div className="mx-auto max-w-[1600px] px-4 py-6">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <Link href="/" className="text-sm text-slate-500 hover:text-slate-800">
              ← メニュー
            </Link>
            <h1 className="mt-1 text-2xl font-bold">製作指図書</h1>
            <p className="mt-1 text-sm text-slate-600">
              製作の番号は、指図書と№を合わせたマスタの番号です。DR は製作、LR は L指令、KR は切替、RR は修理です。例は D令9 の № 14 が DR9-0014、K令9 の № 1 が KR9-0001 です。部品行のパーツコードは L指令マスタの部品キーです。例は L指令 800 の B01 が 800-01 です。L指令は年度当初の生産計画なので、LR 番号とその部品行をその年度の先頭に並べます。期限は日付か「適宜」などの文字です。黄色は割り当てた作業班、緑はその班の完了です。残台数は予定 − 分納です。
            </p>
          </div>
          <div className="text-sm text-slate-500">{loading ? '読込中' : `${visibleRows.length} 件`}</div>
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl bg-white p-3 shadow-sm">
          {DOC_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => setDocType(type)}
              className={`rounded-lg px-4 py-2 text-sm font-semibold ${
                docType === type ? 'bg-red-600 text-white' : 'bg-slate-100 text-slate-700'
              }`}
            >
              {type}
            </button>
          ))}
          <label className="ml-2 text-sm text-slate-600">
            年度
            <select
              value={fiscalYear}
              onChange={(event) => setFiscalYear(event.target.value)}
              className="ml-2 rounded-lg border border-slate-300 bg-white px-2 py-2"
            >
              <option value="all">すべて</option>
              {yearOptions.map((year) => (
                <option key={year} value={year}>
                  {formatFiscalYearLabel(year)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={openOnly} onChange={(event) => setOpenOnly(event.target.checked)} />
            未完了のみ
          </label>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="名称・型式・指図書・担当"
            className="min-w-56 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </div>

        {error && (
          <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
            {error}
            {missingTable && (
              <p className="mt-1">
                リポジトリ直下の <code>migrate-work-instruction-progress.sql</code> を Supabase の SQL Editor で実行すると、Excel の一覧が入ります。
              </p>
            )}
          </div>
        )}

        <div className="overflow-auto rounded-xl bg-white shadow-sm">
          <table className="min-w-[1400px] border-collapse text-xs">
            <thead className="wi-progress-head sticky top-0">
              <tr>
                <th className="px-2 py-2 text-left font-medium">区分</th>
                <th className="px-2 py-2 text-left font-medium">{docType === '製作' ? 'D指令番号' : '指令番号'}</th>
                <th className="px-2 py-2 text-left font-medium">パーツコード</th>
                <th className="px-2 py-2 text-left font-medium">名称</th>
                <th className="px-2 py-2 text-left font-medium">型式</th>
                <th className="px-2 py-2 text-left font-medium">担当</th>
                <th className="px-2 py-2 text-left font-medium">期限</th>
                <th className="px-2 py-2 text-right font-medium">予定</th>
                <th className="px-2 py-2 text-right font-medium">分納</th>
                <th className="px-2 py-2 text-right font-medium">残</th>
                {INSTRUCTION_SHOPS.map((shop) => (
                  <th key={shop.code} className="px-1 py-2 text-center font-medium">
                    <div>{shop.code}</div>
                    <div className="wi-progress font-normal">{shop.name}</div>
                  </th>
                ))}
                <th className="px-2 py-2 text-left font-medium">完了</th>
                <th className="px-2 py-2 text-center font-medium">入庫</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => {
                const remain = remainingQty(row)
                const overdue = Boolean(row.due_on && !row.completed_on && row.due_on < today)
                const child = row.parent_sort_no != null
                const shops = INSTRUCTION_SHOPS.map((shop) => {
                  const found = (row.shops || []).find((item) => item.code === shop.code)
                  return {
                    code: shop.code,
                    name: shop.name,
                    assigned: Boolean(found?.assigned),
                    completed: Boolean(found?.completed),
                  }
                })
                return (
                  <tr key={row.id} className={`border-t border-slate-100 ${child ? 'bg-slate-50' : 'bg-white'}`}>
                    <td className="px-2 py-1">
                      {row.category ? (
                        <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] text-white ${CATEGORY_COLOR[row.category] || 'bg-slate-400'}`}>
                          {row.category}
                        </span>
                      ) : null}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1 font-medium text-white">
                      {productionInstructionNo(row, row.parent_sort_no != null ? parentBySort.get(row.parent_sort_no) : undefined)}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1 font-medium text-white">
                      {partCodeText(
                        row,
                        masterPartByRow.get(row.id),
                        Boolean(lineParts[lineCodeFromRow(row)]?.length)
                      )}
                    </td>
                    <td className={`px-1 py-1 ${child ? 'pl-4' : ''}`}>
                      <CellInput
                        value={row.product_name || ''}
                        title="名称"
                        widthClass={docType === '切替' ? 'w-56' : 'w-40'}
                        onCommit={(value) => {
                          const product_name = value.trim() || null
                          void patchRow(row.id, { product_name }, { product_name })
                        }}
                      />
                      {row.comment ? (
                        <div className="max-w-56 truncate text-[10px] text-slate-400" title={row.comment}>
                          {row.comment}
                        </div>
                      ) : null}
                    </td>
                    <td className="max-w-32 truncate px-2 py-1" title={row.model || ''}>
                      {row.model}
                    </td>
                    <td className="px-1 py-1">
                      <CellInput
                        value={row.assignee || ''}
                        title="担当"
                        widthClass="w-20"
                        onCommit={(value) => {
                          const assignee = value.trim() || null
                          void patchRow(row.id, { assignee }, { assignee })
                        }}
                      />
                    </td>
                    <td className="px-1 py-1">
                      <CellInput
                        value={dueDisplay(row)}
                        title={row.wish_text ? `完了希望: ${row.wish_text}` : '期限。日付または適宜などの文字'}
                        widthClass="w-28"
                        overdue={overdue}
                        onCommit={(value) => {
                          const due = normalizeDueInput(value)
                          void patchRow(row.id, due, due)
                        }}
                      />
                    </td>
                    <td className="px-1 py-1 text-right">
                      <CellInput
                        value={qtyText(row.planned_qty)}
                        title="予定台数"
                        align="right"
                        widthClass="w-16"
                        onCommit={(value) => {
                          const planned = value.trim() === '' ? null : Number(value)
                          if (planned != null && !Number.isFinite(planned)) return
                          void patchRow(row.id, { planned_qty: planned }, { planned_qty: planned })
                        }}
                      />
                    </td>
                    <td className="px-1 py-1 text-right">
                      <CellInput
                        value={qtyText(row.partial_qty)}
                        title="分納台数"
                        align="right"
                        widthClass="w-16"
                        onCommit={(value) => {
                          const partial = value.trim() === '' ? null : Number(value)
                          if (partial != null && !Number.isFinite(partial)) return
                          void patchRow(row.id, { partial_qty: partial }, { partial_qty: partial })
                        }}
                      />
                    </td>
                    <td className="px-2 py-1 text-right">{remain == null ? '' : qtyText(remain)}</td>
                    {shops.map((shop) => (
                      <td key={shop.code} className="px-1 py-1 text-center">
                        <button
                          type="button"
                          disabled={savingId === row.id}
                          title={shop.completed ? '完了' : shop.assigned ? '担当' : '未割当'}
                          onClick={() => {
                            const next = shops.map((item) => (item.code === shop.code ? nextShop(item) : item))
                            void patchRow(row.id, { shops: next }, { shops: next })
                          }}
                          className={`h-7 w-12 rounded border text-[10px] font-semibold ${shopClass(shop)}`}
                        >
                          {shop.completed ? '完了' : shop.assigned ? '担当' : ''}
                        </button>
                      </td>
                    ))}
                    <td className="whitespace-nowrap px-2 py-1">
                      <button
                        type="button"
                        disabled={savingId === row.id}
                        onClick={() => {
                          const next = row.completed_on ? null : today
                          void patchRow(row.id, { completed_on: next }, { completed_on: next })
                        }}
                        className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50"
                      >
                        {row.completed_on || '完了にする'}
                      </button>
                    </td>
                    <td className="px-2 py-1 text-center">
                      <input
                        type="checkbox"
                        checked={Boolean(row.receipt_posted)}
                        disabled={savingId === row.id}
                        onChange={(event) => {
                          void patchRow(row.id, { receipt_posted: event.target.checked }, { receipt_posted: event.target.checked })
                        }}
                      />
                    </td>
                  </tr>
                )
              })}
              {!loading && visibleRows.length === 0 && !error && (
                <tr>
                  <td colSpan={10 + INSTRUCTION_SHOPS.length + 2} className="px-4 py-10 text-center text-sm text-slate-500">
                    表示できる指図書がありません。SQL を実行したあと、この画面を開き直してください。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
