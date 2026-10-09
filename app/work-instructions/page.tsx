'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { formatFiscalYearLabel, getCurrentFiscalYear } from '@/lib/fiscal-year'
import { formatDInstructionNo, INSTRUCTION_SHOPS, isLInstructionOrderNo, parseDrivePdfUrl, type InstructionShop } from '@/lib/work-instruction-progress'

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
  occurred_on: string | null
  elapsed_months: number | null
  completed_on: string | null
  serial_no: string | null
  receipt_posted: boolean
  comment: string | null
  received_order_no: string | null
  pdf_url: string | null
  shops: InstructionShop[]
  source: string
}

const DOC_TYPES: DocType[] = ['製作', '切替', '修理']

const CATEGORIES = ['たばこ', '暖房機', '食品', '作業機', '青'] as const

const CATEGORY_COLOR: Record<string, string> = {
  たばこ: 'bg-blue-600',
  暖房機: 'bg-orange-500',
  食品: 'bg-fuchsia-500',
  作業機: 'bg-red-600',
  青: 'bg-sky-500',
}

function nextCategory(current: string | null) {
  const index = CATEGORIES.indexOf(current as (typeof CATEGORIES)[number])
  if (index < 0) return CATEGORIES[0]
  if (index >= CATEGORIES.length - 1) return null
  return CATEGORIES[index + 1]
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
  previewOnHover = false,
  onCommit,
}: {
  value: string
  title: string
  align?: 'left' | 'right'
  widthClass: string
  overdue?: boolean
  previewOnHover?: boolean
  onCommit: (value: string) => void
}) {
  const [draft, setDraft] = useState(value)
  const [tip, setTip] = useState<{ x: number; y: number; above: boolean } | null>(null)

  useEffect(() => {
    setDraft(value)
  }, [value])

  return (
    <>
      <input
        value={draft}
        title={previewOnHover ? undefined : title}
        onChange={(event) => setDraft(event.target.value)}
        onMouseEnter={(event) => {
          if (!previewOnHover || !draft) return
          const rect = event.currentTarget.getBoundingClientRect()
          const above = rect.bottom + 72 > window.innerHeight
          setTip({ x: rect.left, y: above ? rect.top - 4 : rect.bottom + 4, above })
        }}
        onMouseLeave={() => setTip(null)}
        onBlur={() => {
          setTip(null)
          if (draft !== value) onCommit(draft)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
        }}
        className={`rounded border bg-white px-1 py-1 text-[10px] ${widthClass} ${
          align === 'right' ? 'text-right' : 'text-left'
        } ${overdue ? 'border-rose-400 font-semibold text-rose-700' : 'border-slate-300'}`}
      />
      {previewOnHover && tip && draft && typeof document !== 'undefined'
        ? createPortal(
            <div
              className="pointer-events-none fixed z-[80] max-w-sm whitespace-pre-wrap rounded bg-slate-900 px-2 py-1 text-left text-xs leading-snug text-white shadow-lg"
              style={{
                left: Math.max(8, Math.min(tip.x, window.innerWidth - 328)),
                top: tip.y,
                transform: tip.above ? 'translateY(-100%)' : undefined,
              }}
            >
              {draft}
            </div>,
            document.body
          )
        : null}
    </>
  )
}

const ROW_HEIGHT = 44
const TABLE_COLUMNS = 10 + INSTRUCTION_SHOPS.length + 5

function useVisibleSlice(rowCount: number, resetKey: string) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const [slice, setSlice] = useState({ start: 0, end: 48 })

  useEffect(() => {
    scrollerRef.current?.scrollTo({ top: 0 })
  }, [resetKey])

  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) return
    const update = () => {
      const overscan = 16
      const start = Math.max(0, Math.floor(scroller.scrollTop / ROW_HEIGHT) - overscan)
      const end = Math.min(rowCount, start + Math.ceil(scroller.clientHeight / ROW_HEIGHT) + overscan * 2)
      setSlice((current) => (current.start === start && current.end === end ? current : { start, end }))
    }
    update()
    scroller.addEventListener('scroll', update, { passive: true })
    const observer = new ResizeObserver(update)
    observer.observe(scroller)
    return () => {
      scroller.removeEventListener('scroll', update)
      observer.disconnect()
    }
  }, [rowCount])

  return { scrollerRef, start: slice.start, end: slice.end }
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
  const [registering, setRegistering] = useState(false)
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [pdfEditor, setPdfEditor] = useState<{ id: string; label: string; url: string } | null>(null)
  const [pdfError, setPdfError] = useState<string | null>(null)
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

  const { scrollerRef, start, end } = useVisibleSlice(visibleRows.length, `${docType}:${fiscalYear}:${openOnly}:${query}`)
  const windowRows = visibleRows.slice(start, end)

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

    let finish: (message: string | null) => void = () => {}
    const done = new Promise<string | null>((resolve) => {
      finish = resolve
    })

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
          const message = body.error || '更新に失敗しました'
          setError(message)
          finish(message)
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
        finish(null)
      } catch {
        const saved = snapshot
        setRows((current) => current.map((row) => (row.id === id && saved ? saved : row)))
        setError('更新に失敗しました')
        finish('更新に失敗しました')
      } finally {
        setSavingId(null)
      }
    }

    const previous = saveQueue.current.get(id) ?? Promise.resolve()
    const next = previous.then(run, run)
    saveQueue.current.set(id, next)
    return done
  }

  async function registerNewYearL() {
    const year = Number(fiscalYear)
    if (!Number.isFinite(year)) return
    setRegistering(true)
    setError(null)
    try {
      const res = await fetch('/api/work-instructions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'register_l_master', fiscal_year: year }),
      })
      const body = await res.json()
      if (!res.ok) {
        setError(body.error || 'L指令の新規登録に失敗しました')
        return
      }
      await load()
    } catch {
      setError('L指令の新規登録に失敗しました')
    } finally {
      setRegistering(false)
    }
  }

  async function deleteRow(row: ProgressRow) {
    const label = row.product_name || productionInstructionNo(row)
    const message =
      row.parent_sort_no == null
        ? `${label} と、その部品行を削除します。`
        : `${label} を削除します。`
    if (!window.confirm(message)) return
    setSavingId(row.id)
    setError(null)
    try {
      const res = await fetch(`/api/work-instructions?id=${encodeURIComponent(row.id)}`, { method: 'DELETE' })
      const body = await res.json()
      if (!res.ok) {
        setError(body.error || '削除に失敗しました')
        return
      }
      setRows((current) =>
        current.filter((item) => {
          if (item.id === row.id) return false
          if (row.parent_sort_no == null && row.sort_no != null && item.parent_sort_no === row.sort_no && item.fiscal_year === row.fiscal_year) {
            return false
          }
          return true
        })
      )
    } catch {
      setError('削除に失敗しました')
    } finally {
      setSavingId(null)
    }
  }

  async function deleteRegisteredL() {
    const year = Number(fiscalYear)
    if (!Number.isFinite(year)) return
    const count = rows.filter((row) => row.source === 'l_master' && row.fiscal_year === year).length
    if (!count) return
    if (!window.confirm(`${formatFiscalYearLabel(year)}のL指令登録 ${count}件をすべて削除します。削除後に新規登録からやり直せます。`)) return
    setBulkDeleting(true)
    setError(null)
    try {
      const res = await fetch(`/api/work-instructions?scope=l_master&fiscal_year=${year}`, { method: 'DELETE' })
      const body = await res.json()
      if (!res.ok) {
        setError(body.error || '一括削除に失敗しました')
        return
      }
      setRows((current) => current.filter((row) => !(row.source === 'l_master' && row.fiscal_year === year)))
    } catch {
      setError('一括削除に失敗しました')
    } finally {
      setBulkDeleting(false)
    }
  }

  const today = todayIso()
  const selectedYear = Number(fiscalYear)
  const canRegisterL = docType === '製作' && Number.isFinite(selectedYear) && selectedYear >= 2028
  const showPartColumn = docType !== '修理'
  const columnCount = TABLE_COLUMNS - (showPartColumn ? 0 : 1)

  return (
    <div className="flex h-dvh max-h-dvh w-full min-w-0 flex-col overflow-hidden bg-slate-100 text-slate-900">
      <div className="flex min-h-0 min-w-0 w-full flex-1 flex-col px-2 py-2">
        <div className="mb-1 flex shrink-0 flex-wrap items-end justify-between gap-2">
          <div className="min-w-0">
            <Link href="/" className="text-xs text-slate-500 hover:text-slate-800">
              ← メニュー
            </Link>
            <h1 className="text-xl font-bold leading-tight">製作指図書</h1>
            <p className="text-xs text-slate-600">
              28年度以降は「L指令新規登録」でマスタから登録します。行の「削除」、または「一括削除」でやり直せます。
            </p>
          </div>
          <div className="text-sm text-slate-500">{loading ? '読込中' : `${visibleRows.length} 件`}</div>
        </div>

        <div className="mb-1 flex shrink-0 flex-wrap items-center gap-2 rounded-xl bg-white px-2 py-2 shadow-sm">
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
          {canRegisterL && (
            <button
              type="button"
              disabled={registering || bulkDeleting || loading}
              onClick={() => void registerNewYearL()}
              className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {registering ? '登録中' : 'L指令新規登録'}
            </button>
          )}
          {canRegisterL && (
            <button
              type="button"
              disabled={bulkDeleting || registering || loading || !rows.some((row) => row.source === 'l_master' && row.fiscal_year === selectedYear)}
              onClick={() => void deleteRegisteredL()}
              className="rounded-lg border border-rose-300 bg-white px-4 py-2 text-sm font-semibold text-rose-700 disabled:opacity-50"
            >
              {bulkDeleting ? '削除中' : '一括削除'}
            </button>
          )}
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

        <div ref={scrollerRef} className="min-h-0 min-w-0 w-full flex-1 overflow-x-hidden overflow-y-auto rounded-xl bg-white shadow-sm">
          <table className="wi-sheet w-full table-fixed border-collapse text-[10px]">
            <colgroup>
              <col className="w-[4.1%]" />
              <col className="w-[6.1%]" />
              {showPartColumn ? <col className="w-[4.7%]" /> : null}
              <col className="w-[14.5%]" />
              <col className={showPartColumn ? 'w-[8.1%]' : 'w-[12.8%]'} />
              <col className="w-[4.4%]" />
              <col className="w-[5.6%]" />
              <col className="w-[2.7%]" />
              <col className="w-[2.7%]" />
              <col className="w-[2.2%]" />
              <col className="w-[7.2%]" />
              <col className="w-[3.1%]" />
              {INSTRUCTION_SHOPS.map((shop) => (
                <col key={shop.code} className="w-[3.15%]" />
              ))}
              <col className="w-[4.1%]" />
              <col className="w-[2.2%]" />
              <col className="w-[3.1%]" />
            </colgroup>
            <thead className="wi-progress-head sticky top-0">
              <tr>
                <th className="px-1 py-1 text-left font-medium">区分</th>
                <th className="px-1 py-1 text-left font-medium">{docType === '製作' ? 'D指令番号' : '指令番号'}</th>
                {showPartColumn ? <th className="px-1 py-1 text-left font-medium">パーツ</th> : null}
                <th className="px-1 py-1 text-left font-medium">名称</th>
                <th className="px-1 py-1 text-left font-medium">{docType === '修理' ? '型式' : '規格'}</th>
                <th className="px-1 py-1 text-left font-medium">担当</th>
                <th className="px-1 py-1 text-left font-medium">期限</th>
                <th className="px-1 py-1 text-right font-medium">予定</th>
                <th className="px-1 py-1 text-right font-medium">分納</th>
                <th className="px-1 py-1 text-right font-medium">残</th>
                <th className="px-0.5 py-1 text-left font-medium">発生日</th>
                <th className="px-0 py-1 text-center font-medium leading-tight" title="経過月数">
                  <div>経過</div>
                  <div className="font-normal">月数</div>
                </th>
                {INSTRUCTION_SHOPS.map((shop) => (
                  <th key={shop.code} className="px-0 py-1 text-center text-[10px] font-medium leading-tight" title={shop.name}>
                    <div className="whitespace-nowrap">{shop.code}</div>
                    <div className="wi-progress whitespace-nowrap font-normal">{shop.name}</div>
                  </th>
                ))}
                <th className="px-1 py-1 text-left font-medium">完了</th>
                <th className="px-0.5 py-1 text-center font-medium">入庫</th>
                <th className="px-0.5 py-1 text-center font-medium">削除</th>
              </tr>
            </thead>
            <tbody>
              {start > 0 && (
                <tr aria-hidden>
                  <td colSpan={columnCount} style={{ height: start * ROW_HEIGHT, padding: 0, border: 0 }} />
                </tr>
              )}
              {windowRows.map((row) => {
                const parent = row.parent_sort_no != null ? parentBySort.get(row.parent_sort_no) : undefined
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
                    <td className="px-1 py-1">
                      <button
                        type="button"
                        disabled={savingId === row.id}
                        title={row.category ? `${row.category}。クリックで次の区分` : 'クリックで区分を付ける'}
                        onClick={() => {
                          const category = nextCategory(row.category)
                          void patchRow(row.id, { category }, { category })
                        }}
                        className="inline-flex min-h-5 w-full items-center justify-center"
                      >
                        {row.category ? (
                          <span className={`wi-cat inline-block max-w-full truncate rounded px-1 py-0.5 text-[10px] leading-none text-white ${CATEGORY_COLOR[row.category] || 'bg-slate-400'}`}>
                            {row.category}
                          </span>
                        ) : null}
                      </button>
                    </td>
                    <td className="truncate px-1 py-1 font-medium">
                      <button
                        type="button"
                        title={(parent ?? row).pdf_url ? 'PDFリンクを変更' : 'GoogleドライブのPDFリンクを設定'}
                        onClick={() => {
                          const owner = parent ?? row
                          setPdfError(null)
                          setPdfEditor({
                            id: owner.id,
                            label: productionInstructionNo(row, parent),
                            url: owner.pdf_url || '',
                          })
                        }}
                        className={`block w-full truncate text-left text-white hover:underline ${(parent ?? row).pdf_url ? 'underline decoration-sky-400' : ''}`}
                      >
                        {productionInstructionNo(row, parent)}
                      </button>
                    </td>
                    {showPartColumn ? (
                      <td
                        className="truncate px-1 py-1 font-medium text-white"
                        title={partCodeText(
                          row,
                          masterPartByRow.get(row.id),
                          Boolean(lineParts[lineCodeFromRow(row)]?.length)
                        )}
                      >
                        {partCodeText(
                          row,
                          masterPartByRow.get(row.id),
                          Boolean(lineParts[lineCodeFromRow(row)]?.length)
                        )}
                      </td>
                    ) : null}
                    <td className={`min-w-0 px-0.5 py-1 ${child ? 'pl-2' : ''}`}>
                      <CellInput
                        value={row.product_name || ''}
                        title="名称"
                        widthClass="w-full min-w-0"
                        onCommit={(value) => {
                          const product_name = value.trim() || null
                          void patchRow(row.id, { product_name }, { product_name })
                        }}
                      />
                      {row.comment ? (
                        <div className="truncate text-[10px] text-slate-400" title={row.comment}>
                          {row.comment}
                        </div>
                      ) : null}
                    </td>
                    <td className="min-w-0 px-0.5 py-1">
                      {docType === '修理' ? (
                        <CellInput
                          value={row.model || ''}
                          title="型式"
                          previewOnHover
                          widthClass="w-full min-w-0"
                          onCommit={(value) => {
                            const model = value.trim() || null
                            void patchRow(row.id, { model }, { model })
                          }}
                        />
                      ) : (
                        <span className="block truncate" title={row.model || ''}>
                          {row.model}
                        </span>
                      )}
                    </td>
                    <td className="px-0.5 py-1">
                      <CellInput
                        value={row.assignee || ''}
                        title="担当"
                        widthClass="w-full min-w-0"
                        onCommit={(value) => {
                          const assignee = value.trim() || null
                          void patchRow(row.id, { assignee }, { assignee })
                        }}
                      />
                    </td>
                    <td className="px-0.5 py-1">
                      <CellInput
                        value={dueDisplay(row)}
                        title={row.wish_text ? `完了希望: ${row.wish_text}` : '期限。日付または適宜などの文字'}
                        widthClass="w-full min-w-0"
                        overdue={overdue}
                        onCommit={(value) => {
                          const due = normalizeDueInput(value)
                          void patchRow(row.id, due, due)
                        }}
                      />
                    </td>
                    <td className="px-0.5 py-1 text-right">
                      <CellInput
                        value={qtyText(row.planned_qty)}
                        title="予定台数"
                        align="right"
                        widthClass="w-full min-w-0"
                        onCommit={(value) => {
                          const planned = value.trim() === '' ? null : Number(value)
                          if (planned != null && !Number.isFinite(planned)) return
                          void patchRow(row.id, { planned_qty: planned }, { planned_qty: planned })
                        }}
                      />
                    </td>
                    <td className="px-0.5 py-1 text-right">
                      <CellInput
                        value={qtyText(row.partial_qty)}
                        title="分納台数"
                        align="right"
                        widthClass="w-full min-w-0"
                        onCommit={(value) => {
                          const partial = value.trim() === '' ? null : Number(value)
                          if (partial != null && !Number.isFinite(partial)) return
                          void patchRow(row.id, { partial_qty: partial }, { partial_qty: partial })
                        }}
                      />
                    </td>
                    <td className="px-1 py-1 text-right">{remain == null ? '' : qtyText(remain)}</td>
                    <td className="px-0.5 py-1">
                      <div className="wi-date-slot">
                        <input
                          type="date"
                          value={(row.occurred_on || '').slice(0, 10)}
                          title="発生日"
                          disabled={savingId === row.id}
                          onChange={(event) => {
                            const occurred_on = event.target.value || null
                            const elapsed_months = occurred_on ? row.elapsed_months : null
                            void patchRow(
                              row.id,
                              { occurred_on, elapsed_months },
                              { occurred_on, elapsed_months },
                            )
                          }}
                          className={`wi-date rounded border border-slate-300 bg-white px-0.5 py-0.5${row.occurred_on ? '' : ' is-empty'}`}
                        />
                      </div>
                    </td>
                    <td className="px-0.5 py-1">
                      <CellInput
                        value={row.occurred_on && row.elapsed_months != null ? String(row.elapsed_months) : ''}
                        title="経過月数"
                        align="right"
                        widthClass="w-full min-w-0"
                        onCommit={(value) => {
                          const elapsed = value.trim() === '' ? null : Number(value)
                          if (elapsed != null && !Number.isFinite(elapsed)) return
                          const elapsed_months = elapsed == null ? null : Math.round(elapsed)
                          void patchRow(row.id, { elapsed_months }, { elapsed_months })
                        }}
                      />
                    </td>
                    {shops.map((shop) => (
                      <td key={shop.code} className="px-0.5 py-1 text-center">
                        <button
                          type="button"
                          disabled={savingId === row.id}
                          title={`${shop.name}: ${shop.completed ? '着手' : shop.assigned ? '担当' : '未割当'}`}
                          onClick={() => {
                            const next = shops.map((item) => (item.code === shop.code ? nextShop(item) : item))
                            void patchRow(row.id, { shops: next }, { shops: next })
                          }}
                          className={`h-6 w-full rounded border text-[10px] font-semibold ${shopClass(shop)}`}
                        >
                          {shop.completed ? '着手' : shop.assigned ? '担当' : ''}
                        </button>
                      </td>
                    ))}
                    <td className="px-0.5 py-1">
                      <button
                        type="button"
                        disabled={savingId === row.id}
                        title={row.completed_on || '完了にする'}
                        onClick={() => {
                          const next = row.completed_on ? null : today
                          void patchRow(row.id, { completed_on: next }, { completed_on: next })
                        }}
                        className="w-full truncate rounded border border-slate-300 px-0.5 py-1 text-[10px] hover:bg-slate-50"
                      >
                        {row.completed_on ? row.completed_on.slice(5) : '完了'}
                      </button>
                    </td>
                    <td className="px-0.5 py-1 text-center">
                      <input
                        type="checkbox"
                        checked={Boolean(row.receipt_posted)}
                        disabled={savingId === row.id}
                        onChange={(event) => {
                          void patchRow(row.id, { receipt_posted: event.target.checked }, { receipt_posted: event.target.checked })
                        }}
                      />
                    </td>
                    <td className="px-1 py-1 text-center">
                      {row.source === 'l_master' ? (
                        <button
                          type="button"
                          disabled={savingId === row.id}
                          onClick={() => void deleteRow(row)}
                          title={row.parent_sort_no == null ? 'この指令と部品行を削除' : 'この部品行を削除'}
                          className="w-full rounded border border-rose-300 px-0.5 py-1 text-[10px] text-rose-700 hover:bg-rose-50"
                        >
                          削除
                        </button>
                      ) : null}
                    </td>
                  </tr>
                )
              })}
              {end < visibleRows.length && (
                <tr aria-hidden>
                  <td colSpan={columnCount} style={{ height: (visibleRows.length - end) * ROW_HEIGHT, padding: 0, border: 0 }} />
                </tr>
              )}
              {!loading && visibleRows.length === 0 && !error && (
                <tr>
                  <td colSpan={columnCount} className="px-4 py-10 text-center text-sm text-slate-500">
                    表示できる指図書がありません。SQL を実行したあと、この画面を開き直してください。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      {pdfEditor
        ? createPortal(
            <div
              className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-4"
              onClick={() => setPdfEditor(null)}
            >
              <form
                className="w-full max-w-md rounded-xl bg-slate-900 p-4 text-white shadow-xl"
                onClick={(event) => event.stopPropagation()}
                onSubmit={(event) => {
                  event.preventDefault()
                  const parsed = parseDrivePdfUrl(pdfEditor.url)
                  if (parsed.error) {
                    setPdfError(parsed.error)
                    return
                  }
                  const id = pdfEditor.id
                  void patchRow(id, { pdf_url: parsed.url }, { pdf_url: parsed.url }).then((message) => {
                    if (message) {
                      setPdfError(message)
                      return
                    }
                    setPdfError(null)
                    setPdfEditor(null)
                  })
                }}
              >
                <h2 className="text-base font-bold">{pdfEditor.label || '指令番号'}</h2>
                <p className="mt-1 text-sm text-slate-300">GoogleドライブのPDFリンク</p>
                <input
                  autoFocus
                  value={pdfEditor.url}
                  placeholder="https://drive.google.com/..."
                  onChange={(event) => {
                    setPdfError(null)
                    setPdfEditor({ ...pdfEditor, url: event.target.value })
                  }}
                  className="mt-2 w-full rounded border border-slate-500 bg-slate-950 px-2 py-2 text-sm text-white"
                />
                {pdfError ? <p className="mt-1 text-sm text-rose-300">{pdfError}</p> : null}
                <div className="mt-3 flex flex-wrap justify-end gap-2">
                  {parseDrivePdfUrl(pdfEditor.url).url ? (
                    <button
                      type="button"
                      className="rounded border border-slate-500 px-3 py-1.5 text-sm"
                      onClick={() => {
                        const parsed = parseDrivePdfUrl(pdfEditor.url)
                        if (!parsed.url) return
                        window.open(parsed.url, '_blank', 'noopener,noreferrer')
                      }}
                    >
                      開く
                    </button>
                  ) : null}
                  <button type="button" className="rounded border border-slate-500 px-3 py-1.5 text-sm" onClick={() => setPdfEditor(null)}>
                    閉じる
                  </button>
                  <button type="submit" className="rounded bg-sky-600 px-3 py-1.5 text-sm text-white">
                    保存
                  </button>
                </div>
              </form>
            </div>,
            document.body
          )
        : null}
    </div>
  )
}
