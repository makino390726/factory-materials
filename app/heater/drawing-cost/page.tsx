'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { expandWorkOrders, costQtyForElement, type Ec25AnalyzeRow, type Ec25OrderDraft, type Ec25WorkOrderDraft } from '@/lib/ec25-cost-build'
import type { UnfoldResult } from '@/lib/ec25-unfold-core'
import { lookupPdfPages, type Ec25PdfIndex, type Ec25PdfPageHit } from '@/lib/ec25-drawing-match'
import type { Ec25ParsedPart } from '@/lib/ec25-drawing-bom'
import ProductCodePicker, { type ProductPick } from '@/app/heater/drawing-cost/ProductCodePicker'

type AnalyzeResponse = {
  dry_run?: boolean
  cover?: { product_name: string; model_type: string; created_on: string; owner: string }
  work_order: Ec25WorkOrderDraft
  summary: {
    total?: number
    include_count?: number
    sheet?: number
    profile?: number
    purchased?: number
    fastener_lines?: number
    assembly?: number
    matched?: number
    unfoldable?: number
    material_cost?: number
    line_total?: number
    pdf_linked?: number
  }
  rows: Ec25AnalyzeRow[]
  drawing_pages?: Record<string, number[]>
  pages?: Ec25PdfPageHit[]
  by_name?: Record<string, number[]>
  error?: string
}

type FilterKey = 'all' | 'sheet' | 'fastener' | 'purchased' | 'unmatched' | 'assembly'

type ProgressState = {
  label: string
  page: number
  total: number
  percent: number
}

type RegisterTargets = {
  model: boolean
  d_order: boolean
  l_order: boolean
}

const REGISTER_LABELS: { key: keyof RegisterTargets; title: string; hint: string }[] = [
  { key: 'l_order', title: 'L指令登録', hint: 'パーツごとのライン原価明細' },
  { key: 'd_order', title: 'D指令登録', hint: 'D指令と指令原価・枝番' },
  { key: 'model', title: '機種登録（製品パーツ計算）', hint: '機種マスタ・パーツ・BOM' },
]

function yen(n: number) {
  return `¥${Math.round(n || 0).toLocaleString()}`
}

export default function DrawingCostPage() {
  const [excel, setExcel] = useState<File | null>(null)
  const [pdf, setPdf] = useState<File | null>(null)
  const [purchaseFile, setPurchaseFile] = useState<File | null>(null)
  const [purchaseParts, setPurchaseParts] = useState<Ec25ParsedPart[]>([])
  const [workOrder, setWorkOrder] = useState<Ec25WorkOrderDraft | null>(null)
  const [cover, setCover] = useState<AnalyzeResponse['cover'] | null>(null)
  const [rows, setRows] = useState<Ec25AnalyzeRow[]>([])
  const [summary, setSummary] = useState<AnalyzeResponse['summary'] | null>(null)
  const [drawingPages, setDrawingPages] = useState<Record<string, number[]>>({})
  const [drawingHits, setDrawingHits] = useState<Ec25PdfPageHit[]>([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [filter, setFilter] = useState<FilterKey>('all')
  const [page, setPage] = useState(0)
  const [progress, setProgress] = useState<ProgressState | null>(null)
  const [registerTargets, setRegisterTargets] = useState<RegisterTargets>({
    model: true,
    d_order: true,
    l_order: true,
  })
  const pageSize = 25

  const filtered = useMemo(() => {
    if (filter === 'sheet') return rows.filter((r) => r.kind === 'sheet' || r.kind === 'profile')
    if (filter === 'fastener') return rows.filter((r) => (r.part.fasteners?.length || 0) > 0)
    if (filter === 'purchased') return rows.filter((r) => r.kind === 'purchased')
    if (filter === 'unmatched') return rows.filter((r) => r.include && !r.elements.some((e) => e.product_code))
    if (filter === 'assembly') return rows.filter((r) => r.kind === 'assembly' || !r.include)
    return rows
  }, [rows, filter])

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const pageRows = filtered.slice(page * pageSize, page * pageSize + pageSize)

  const totals = useMemo(() => {
    const inc = rows.filter((r) => r.include)
    return {
      material: inc.reduce((s, r) => s + r.material_cost, 0),
      total: inc.reduce((s, r) => s + r.line_total, 0),
    }
  }, [rows])

  const elementCost = (
    el: { role?: string; quantity?: number | null; unit_price?: number; drawing_spec?: boolean },
    index: number,
    costQty: number,
    kind: Ec25AnalyzeRow['kind']
  ) => {
    const elQty = costQtyForElement(el, index, costQty, kind)
    const material = Math.round(elQty * Number(el.unit_price || 0))
    return { qty: elQty, material, total: material + Math.round(material * 0.3) }
  }

  const rebuildRow = (row: Ec25AnalyzeRow, patch: Partial<Ec25AnalyzeRow>): Ec25AnalyzeRow => {
    const next = { ...row, ...patch }
    const qty = Number(next.cost_qty || 0)
    let material = 0
    let total = 0
    const els = next.elements || []
    const list = els.length ? els : [{ role: 'material' as const, quantity: null, unit_price: 0, drawing_spec: true }]
    for (let i = 0; i < list.length; i++) {
      const el = list[i]
      const elQty = costQtyForElement(el, i, qty, next.kind)
      const m = Math.round(elQty * Number(el.unit_price || 0))
      material += m
      total += m + Math.round(m * 0.3)
    }
    next.material_cost = material
    next.line_total = total
    return next
  }

  const analyze = async (indexPdf = false) => {
    if (!excel && purchaseParts.length === 0) {
      setMsg({ type: 'err', text: '図番管理表の Excel を選択してください' })
      return
    }
    setBusy(true)
    setMsg(null)
    setPage(0)
    try {
      await runMaterialMatch({ indexPdf })
    } catch (e) {
      setMsg({ type: 'err', text: e instanceof Error ? e.message : '解析エラー' })
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  const runMaterialMatch = async (input: { indexPdf?: boolean; index?: Ec25PdfIndex; purchase?: Ec25ParsedPart[] }) => {
    const buy = input.purchase || purchaseParts
    if (!excel && buy.length === 0) {
      throw new Error('図番管理表の Excel、または購入品一覧が必要です')
    }
    const fd = new FormData()
    fd.append('apply', 'false')
    fd.append('index_pdf', input.indexPdf ? 'true' : 'false')
    if (excel) fd.append('excel', excel)
    if (input.indexPdf && pdf) fd.append('pdf', pdf)
    if (workOrder) fd.append('work_order', JSON.stringify(workOrder))
    if (buy.length) fd.append('purchase_parts_json', JSON.stringify(buy))
    const unfold: Record<string, UnfoldResult> = {}
    for (const r of rows) {
      if (r.unfold?.source === 'ai') unfold[r.part_key] = r.unfold
    }
    if (Object.keys(unfold).length) fd.append('unfold_json', JSON.stringify(unfold))
    const drawings = input.index?.drawings || drawingPages
    const hits = input.index?.pages || drawingHits
    if (Object.keys(drawings).length || hits.length) {
      fd.append('index_json', JSON.stringify({ drawings, pages: hits }))
    }
    const res = await fetch('/api/heater/bom/import-ec25', { method: 'POST', body: fd })
    const data = (await res.json()) as AnalyzeResponse
    if (!res.ok) throw new Error(data.error || '解析に失敗しました')
    setCover(data.cover || null)
    setWorkOrder(data.work_order)
    setRows(data.rows || [])
    setSummary(data.summary || null)
    setDrawingPages(data.drawing_pages || drawings)
    setDrawingHits(data.pages || hits)
    setMsg({
      type: 'ok',
      text: `解析完了: ${data.summary?.include_count ?? 0} 点 / 購入品 ${data.summary?.purchased ?? 0} / 製品照合 ${data.summary?.matched ?? 0} / 合計 ${yen(data.summary?.line_total || 0)}`,
    })
    return data
  }

  const consumePurchaseNdjson = async (res: Response) => {
    if (!res.ok || !res.body) {
      const data = await res.json().catch(() => ({}))
      throw new Error((data as { error?: string }).error || '購入品一覧の取込に失敗しました')
    }
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    let last: {
      type?: string
      parts?: Ec25ParsedPart[]
      summary?: { purchased?: number; total?: number; pages?: number }
      warning?: string
      error?: string
      phase?: string
      label?: string
      page?: number
      total?: number
      percent?: number
    } = {}
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop() || ''
      for (const line of lines) {
        if (!line.trim()) continue
        try {
          last = JSON.parse(line)
        } catch {
          continue
        }
        if (last.type === 'error') throw new Error(last.error || '購入品PDFの解析に失敗しました')
        if (last.type === 'done') continue
        const pageNo = Number(last.page || 0)
        const total = Number(last.total || 0)
        const percent =
          last.percent != null
            ? Number(last.percent)
            : last.phase === 'loading'
              ? 4
              : total > 0
                ? Math.min(99, Math.round((pageNo / total) * 100))
                : 8
        setProgress({
          label: last.label || (last.phase === 'ai' ? '購入品表をAIで補完しています…' : `購入品一覧を読み取り中 ${pageNo}/${total || '?'}`),
          page: pageNo,
          total,
          percent,
        })
      }
    }
    if (last.type === 'error') throw new Error(last.error || '購入品PDFの解析に失敗しました')
    if (!last.parts || last.parts.length === 0) throw new Error('購入品の行を読み取れませんでした')
    return last
  }

  const importPurchased = async () => {
    if (!purchaseFile) {
      setMsg({ type: 'err', text: '購入品一覧の Excel または PDF を選択してください' })
      return
    }
    setBusy(true)
    setMsg(null)
    try {
      const fd = new FormData()
      fd.append('file', purchaseFile)
      const isPdf = /\.pdf$/i.test(purchaseFile.name) || purchaseFile.type === 'application/pdf'
      if (isPdf) {
        setProgress({ label: '購入品一覧PDFを読み取っています…', page: 0, total: 0, percent: 2 })
      }
      const res = await fetch('/api/heater/bom/ec25-purchase-list', { method: 'POST', body: fd })
      let parts: Ec25ParsedPart[] = []
      let warning = ''
      if (isPdf || (res.headers.get('content-type') || '').includes('ndjson')) {
        const data = await consumePurchaseNdjson(res)
        parts = data.parts || []
        warning = data.warning || ''
      } else {
        const data = (await res.json()) as { parts?: Ec25ParsedPart[]; error?: string; warning?: string }
        if (!res.ok) throw new Error(data.error || '購入品一覧の解析に失敗しました')
        parts = data.parts || []
        warning = data.warning || ''
      }
      const keys = new Set(parts.map((p) => `${p.part_key}|${p.part_name}`))
      const combined = [...purchaseParts.filter((p) => !keys.has(`${p.part_key}|${p.part_name}`)), ...parts]
      setPurchaseParts(combined)
      await runMaterialMatch({ purchase: combined })
      if (warning) {
        setMsg((prev) => (prev ? { ...prev, text: `${prev.text}（${warning}）` } : { type: 'ok', text: warning }))
      }
    } catch (e) {
      setMsg({ type: 'err', text: e instanceof Error ? e.message : '購入品一覧の取込エラー' })
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  const linkPdf = async () => {
    if (!pdf) {
      setMsg({ type: 'err', text: '全図面PDFを選択してください' })
      return
    }
    setBusy(true)
    setMsg(null)
    setProgress({ label: 'OCRエンジンを起動しています…', page: 0, total: 0, percent: 2 })
    try {
      const fd = new FormData()
      fd.append('pdf', pdf)
      const res = await fetch('/api/heater/bom/ec25-index', { method: 'POST', body: fd })
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}))
        throw new Error((data as { error?: string }).error || '図面連動に失敗しました')
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      let drawings: Record<string, number[]> = {}
      let hits: Ec25PdfPageHit[] = []
      let linked = 0
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() || ''
        for (const line of lines) {
          if (!line.trim()) continue
          let ev: {
            type?: string
            phase?: string
            page?: number
            total?: number
            drawings?: Record<string, number[]>
            pages?: Ec25PdfPageHit[]
            error?: string
            indexed_pages?: number
          }
          try {
            ev = JSON.parse(line)
          } catch {
            continue
          }
          if (ev.type === 'error') throw new Error(ev.error || '図面OCRに失敗しました')
          if (ev.type === 'done') {
            drawings = ev.drawings || {}
            hits = ev.pages || []
            linked = Object.keys(drawings).length
            setProgress({
              label: `連動完了: 図番 ${linked} 件`,
              page: ev.indexed_pages || ev.total || 0,
              total: ev.indexed_pages || ev.total || 0,
              percent: 100,
            })
            continue
          }
          const pageNo = Number(ev.page || 0)
          const total = Number(ev.total || 0)
          const phase = ev.phase === 'loading' ? 'OCRエンジンを起動しています…' : `タイトル欄を照合中 ${pageNo}/${total || '?'}`
          const percent =
            ev.phase === 'loading'
              ? 4
              : total > 0
                ? Math.min(99, Math.round((pageNo / total) * 100))
                : 8
          setProgress({ label: phase, page: pageNo, total, percent })
        }
      }
      const index = { drawings, pages: hits }
      setDrawingPages(drawings)
      setDrawingHits(hits)
      setRows((prev) =>
        prev.map((r) => ({
          ...r,
          pdf_pages: lookupPdfPages(r.drawing_no, r.part_key, r.part_name, index),
        }))
      )
      const rowLinked = rows.filter(
        (r) => lookupPdfPages(r.drawing_no, r.part_key, r.part_name, index).length > 0
      ).length
      setMsg({
        type: 'ok',
        text: `図面連動完了: PDF図番 ${linked} 件 / Excel部品 ${rowLinked} 件をページに結びました`,
      })
    } catch (e) {
      setMsg({ type: 'err', text: e instanceof Error ? e.message : '図面連動エラー' })
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  const apply = async () => {
    if (!workOrder || rows.length === 0) {
      setMsg({ type: 'err', text: '先に解析してください' })
      return
    }
    const selectedLabels = REGISTER_LABELS.filter((x) => registerTargets[x.key]).map((x) => x.title)
    if (selectedLabels.length === 0) {
      setMsg({ type: 'err', text: '登録先を1つ以上選んでください' })
      return
    }
    const drafts = expandWorkOrders(workOrder).filter((d) => String(d.order_no || '').trim())
    if ((registerTargets.d_order || registerTargets.l_order) && drafts.length === 0) {
      setMsg({ type: 'err', text: 'D指令・L指令の登録には D指令番号が必要です' })
      return
    }
    const orderLines = drafts.map((d) => `${d.order_no}（${d.qty}${d.unit || '台'}）`).join('、')
    if (
      !confirm(
        `${workOrder.model} を次の先へ登録します。\n指令: ${orderLines}\n・${selectedLabels.join('\n・')}\nよろしいですか？`
      )
    ) {
      return
    }
    setBusy(true)
    setMsg(null)
    try {
      const res = await fetch('/api/heater/bom/import-ec25', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apply: true,
          work_order: workOrder,
          rows,
          register_targets: registerTargets,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '取込に失敗しました')
      const done = [
        data.registered?.model ? `機種 ${data.parts ?? 0} パーツ` : null,
        data.registered?.d_order
          ? `D指令 ${(data.order_nos || [data.order_no]).filter(Boolean).join('、')} / 明細 ${data.d_cost_items ?? data.cost_items ?? 0} / 枝番 ${data.branch_sync?.branch_count ?? 0}`
          : null,
        data.registered?.l_order ? `L指令 明細 ${data.l_cost_items ?? 0}` : null,
      ].filter(Boolean)
      setMsg({
        type: 'ok',
        text: `取込完了: ${done.join(' / ') || selectedLabels.join('・')}`,
      })
    } catch (e) {
      setMsg({ type: 'err', text: e instanceof Error ? e.message : '取込エラー' })
    } finally {
      setBusy(false)
    }
  }

  const runUnfoldOnRows = async (targets: Ec25AnalyzeRow[], index?: Ec25PdfIndex) => {
    if (!pdf) throw new Error('AI展開には全図面PDFが必要です')
    if (targets.length === 0) return
    let pagesMap = index?.drawings || drawingPages
    let hits = index?.pages || drawingHits
    const batchSize = 8
    let ok = 0
    let ng = 0
    const errSamples: string[] = []
    let pdfIndex = { drawings: pagesMap, pages: hits }

    for (let i = 0; i < targets.length; i += batchSize) {
      const batch = targets.slice(i, i + batchSize)
      const doneCount = Math.min(i + batch.length, targets.length)
      setProgress({
        label: `図面仕様材料の必要量をAI展開 ${i + 1}〜${doneCount} / ${targets.length}`,
        page: doneCount,
        total: targets.length,
        percent: Math.round((doneCount / targets.length) * 100),
      })
      const fd = new FormData()
      fd.append('pdf', pdf)
      fd.append('parts_json', JSON.stringify(batch.map((r) => r.part)))
      fd.append('part_keys', batch.map((r) => r.part_key).join(','))
      fd.append('max_parts', String(batch.length))
      if (Object.keys(pdfIndex.drawings).length || pdfIndex.pages.length) {
        fd.append('index_json', JSON.stringify({ drawings: pdfIndex.drawings, pages: pdfIndex.pages }))
      }
      const res = await fetch('/api/heater/bom/ec25-unfold', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'AI展開に失敗しました')
      const results = (data.results || {}) as Record<string, UnfoldResult>
      const errors = (data.errors || {}) as Record<string, string>
      if (data.drawing_pages) {
        pagesMap = data.drawing_pages
        setDrawingPages(data.drawing_pages)
      }
      if (Array.isArray(data.pages)) {
        hits = data.pages
        setDrawingHits(data.pages)
      }
      pdfIndex = { drawings: pagesMap, pages: hits }
      setRows((prev) =>
        prev.map((r) => {
          const u = results[r.part_key]
          const pages = lookupPdfPages(r.drawing_no, r.part_key, r.part_name, pdfIndex)
          if (!u) return pages.length ? { ...r, pdf_pages: pages } : r
          const qty =
            r.kind === 'fastener' || r.kind === 'purchased'
              ? r.qty_pieces
              : Number((r.qty_pieces * (u.qty_per_part || 0)).toFixed(6))
          return rebuildRow(r, { unfold: u, cost_qty: qty, cost_unit: u.qty_unit, pdf_pages: pages })
        })
      )
      ok += Object.keys(results).length
      ng += Object.keys(errors).length
      for (const msg of Object.values(errors)) {
        if (errSamples.length < 3) errSamples.push(msg)
      }
    }
    setMsg({
      type: ng && !ok ? 'err' : 'ok',
      text: `AI展開: 図面仕様材料の必要量 成功 ${ok} / 失敗 ${ng}${ng ? `（${errSamples.join(' / ')}）` : ''}`,
    })
  }

  const unfoldableCount = rows.filter((r) => r.include && r.unfoldable).length
  const unfoldHint = busy
    ? '処理中です'
    : !excel
      ? '先に図番管理表 Excel を解析してください'
      : rows.length === 0
        ? '先に① Excel解析を実行してください'
        : !pdf
          ? 'AI展開には全図面PDFが必要です'
          : unfoldableCount === 0
            ? '展開対象の板金・形鋼がありません'
            : ''

  const unfoldAll = async () => {
    if (!pdf) {
      setMsg({ type: 'err', text: 'AI展開には全図面PDFが必要です' })
      return
    }
    const targets = rows.filter((r) => r.include && r.unfoldable)
    if (targets.length === 0) {
      setMsg({ type: 'err', text: '展開対象の板金・形鋼がありません' })
      return
    }
    setBusy(true)
    setMsg(null)
    try {
      let pagesMap = drawingPages
      let hits = drawingHits
      if (!Object.keys(pagesMap).length && !hits.length) {
        setProgress({ label: '図面番号をPDFと連動しています…', page: 0, total: 0, percent: 2 })
        const idxFd = new FormData()
        idxFd.append('pdf', pdf)
        const idxRes = await fetch('/api/heater/bom/ec25-index', { method: 'POST', body: idxFd })
        if (!idxRes.ok || !idxRes.body) {
          const data = await idxRes.json().catch(() => ({}))
          throw new Error((data as { error?: string }).error || '図面連動に失敗しました')
        }
        const reader = idxRes.body.getReader()
        const decoder = new TextDecoder()
        let buf = ''
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })
          const lines = buf.split('\n')
          buf = lines.pop() || ''
          for (const line of lines) {
            if (!line.trim()) continue
            let ev: {
              type?: string
              phase?: string
              page?: number
              total?: number
              drawings?: Record<string, number[]>
              pages?: Ec25PdfPageHit[]
              error?: string
              indexed_pages?: number
            }
            try {
              ev = JSON.parse(line)
            } catch {
              continue
            }
            if (ev.type === 'error') throw new Error(ev.error || '図面OCRに失敗しました')
            if (ev.type === 'done') {
              pagesMap = ev.drawings || {}
              hits = ev.pages || []
              setDrawingPages(pagesMap)
              setDrawingHits(hits)
              continue
            }
            const pageNo = Number(ev.page || 0)
            const total = Number(ev.total || 0)
            const percent = total > 0 ? Math.min(99, Math.round((pageNo / total) * 100)) : 8
            setProgress({
              label: ev.phase === 'loading' ? 'OCRエンジンを起動しています…' : `タイトル欄を照合中 ${pageNo}/${total || '?'}`,
              page: pageNo,
              total,
              percent,
            })
          }
        }
      }

      await runUnfoldOnRows(targets, { drawings: pagesMap, pages: hits })
    } catch (e) {
      setMsg({ type: 'err', text: e instanceof Error ? e.message : 'AI展開エラー' })
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  const updateRow = (partKey: string, patch: Partial<Ec25AnalyzeRow>) => {
    setRows((prev) => prev.map((r) => (r.part_key === partKey ? rebuildRow(r, patch) : r)))
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-slate-100 px-4 py-8">
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
          <div>
            <h1 className="text-3xl font-bold text-amber-300">図面原価（展開算出）</h1>
          </div>
          <Link href="/" className="text-sm text-cyan-300 hover:text-cyan-200">
            ← ホーム
          </Link>
        </div>

        <div className="rounded-2xl border border-amber-500/30 bg-slate-900/70 p-5 mb-6">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="text-sm">
              <span className="text-slate-300">図番管理表 Excel（必須・.xls / .xlsx）</span>
              <input
                type="file"
                accept=".xls,.xlsx,application/vnd.ms-excel"
                className="mt-1 block w-full text-sm"
                onChange={(e) => setExcel(e.target.files?.[0] || null)}
              />
            </label>
            <label className="text-sm">
              <span className="text-slate-300">全図面 PDF（図番連動・AI展開用）</span>
              <input
                type="file"
                accept=".pdf,application/pdf"
                className="mt-1 block w-full text-sm"
                onChange={(e) => setPdf(e.target.files?.[0] || null)}
              />
            </label>
            <label className="text-sm md:col-span-2">
              <span className="text-slate-300">購入品一覧 Excel / PDF（任意）</span>
              <input
                type="file"
                accept=".xls,.xlsx,.xlsm,.pdf,application/pdf,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="mt-1 block w-full text-sm"
                onChange={(e) => setPurchaseFile(e.target.files?.[0] || null)}
              />
              <span className="mt-1 block text-xs text-slate-500">
                型式・部品名称・規格・個数・購入先。図番管理表と突き合わせ、無いものは購入品行として追加します。
                {purchaseParts.length > 0 ? ` 取込済 ${purchaseParts.length} 点` : ''}
              </span>
            </label>
          </div>

          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              disabled={busy || !excel}
              onClick={() => analyze(false)}
              className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-50 font-semibold"
            >
              {busy ? '処理中…' : '① Excel解析（材質照合）'}
            </button>
            <button
              type="button"
              disabled={busy || !purchaseFile}
              onClick={importPurchased}
              className="px-4 py-2 rounded-lg bg-sky-700 hover:bg-sky-600 disabled:opacity-50 font-semibold"
            >
              購入品一覧を取込
            </button>
            <button
              type="button"
              disabled={busy || !pdf || rows.length === 0}
              onClick={linkPdf}
              className="px-4 py-2 rounded-lg bg-cyan-700 hover:bg-cyan-600 disabled:opacity-50 font-semibold"
            >
              図面番号をPDFと連動（OCR）
            </button>
            <button
              type="button"
              disabled={busy || !pdf || rows.length === 0 || unfoldableCount === 0}
              title={unfoldHint || 'Excelの材質（図面仕様）の必要量をAI展開します'}
              onClick={unfoldAll}
              className="px-4 py-2 rounded-lg bg-violet-700 hover:bg-violet-600 disabled:opacity-50 font-semibold"
            >
              図面仕様材料をAI展開
            </button>
          </div>
          {unfoldHint && !busy ? (
            <p className="mt-2 text-xs text-amber-200/90">{unfoldHint}</p>
          ) : null}

          <div className="mt-4 rounded-xl border border-slate-700 bg-slate-950/60 p-4">
            <div className="mb-2 text-sm font-semibold text-slate-200">登録先（1つ以上選択）</div>
            <div className="flex flex-wrap gap-4">
              {REGISTER_LABELS.map((opt) => (
                <label key={opt.key} className="flex items-start gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={registerTargets[opt.key]}
                    onChange={(e) =>
                      setRegisterTargets((prev) => ({ ...prev, [opt.key]: e.target.checked }))
                    }
                  />
                  <span>
                    <span className="font-semibold text-emerald-200">{opt.title}</span>
                    <span className="block text-xs text-slate-500">{opt.hint}</span>
                  </span>
                </label>
              ))}
            </div>
            <div className="mt-3">
              <button
                type="button"
                disabled={busy || !workOrder || rows.length === 0}
                onClick={apply}
                className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 font-semibold"
              >
                ② 選択した先へ登録
              </button>
            </div>
          </div>

          {progress && (
            <div className="mt-4 rounded-xl border border-cyan-500/40 bg-slate-950/80 p-4">
              <div className="mb-2 flex items-center justify-between text-sm text-cyan-200">
                <span>{progress.label}</span>
                <span className="font-mono">
                  {progress.total > 0 ? `${progress.page}/${progress.total}` : ''} {progress.percent}%
                </span>
              </div>
              <div className="h-3 overflow-hidden rounded-full bg-slate-800">
                <div
                  className={`h-full rounded-full bg-gradient-to-r from-cyan-500 to-amber-400 transition-[width] duration-300 ${
                    progress.total <= 0 ? 'animate-pulse' : ''
                  }`}
                  style={{ width: `${Math.max(2, progress.percent)}%` }}
                />
              </div>
              <p className="mt-2 text-xs text-slate-500">
                スキャン図面のOCRです。ページ数が多い場合は数分かかることがあります。この画面は開いたままにしてください。
              </p>
            </div>
          )}

        </div>

        {msg && (
          <div
            className={`mb-4 rounded-lg px-4 py-3 text-sm ${
              msg.type === 'ok' ? 'bg-emerald-900/50 text-emerald-200' : 'bg-rose-900/50 text-rose-200'
            }`}
          >
            {msg.text}
          </div>
        )}

        {workOrder && (
          <div className="mb-5 space-y-3 text-sm">
            <div className="grid gap-3 md:grid-cols-3">
              <label>
                機種名（品名）
                <input
                  className="mt-1 w-full rounded bg-slate-800 border border-slate-600 px-2 py-1"
                  value={workOrder.product_name}
                  onChange={(e) => setWorkOrder({ ...workOrder, product_name: e.target.value })}
                />
              </label>
              <label>
                型式
                <input
                  className="mt-1 w-full rounded bg-slate-800 border border-slate-600 px-2 py-1"
                  value={workOrder.model}
                  onChange={(e) =>
                    setWorkOrder({ ...workOrder, model: e.target.value, bom_model: e.target.value })
                  }
                />
              </label>
              <div className="rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-2">
                <div className="text-slate-400 text-xs">試作機 原価合計（間接費込）</div>
                <div className="text-xl font-bold text-amber-300">{yen(totals.total)}</div>
                <div className="text-xs text-slate-500">材料 {yen(totals.material)}</div>
                {cover?.created_on && <div className="text-xs text-slate-500 mt-1">作成 {cover.created_on}</div>}
              </div>
            </div>
            <div className="rounded-xl border border-cyan-500/20 bg-slate-950/40 p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs text-slate-300">
                  指令と何台
                  {(registerTargets.d_order || registerTargets.l_order) && (
                    <span className="ml-2 text-amber-400/80">D指令・L指令の登録に使用します</span>
                  )}
                </div>
                <button
                  type="button"
                  className="rounded border border-cyan-500/50 px-2 py-0.5 text-xs text-cyan-200 hover:bg-cyan-900/40"
                  onClick={() =>
                    setWorkOrder({
                      ...workOrder,
                      extra_orders: [
                        ...(workOrder.extra_orders || []),
                        {
                          order_no: '',
                          product_name: workOrder.product_name,
                          qty: 1,
                          unit: '台',
                          note: '',
                        } satisfies Ec25OrderDraft,
                      ],
                    })
                  }
                >
                  指令を追加
                </button>
              </div>
              {[
                {
                  order_no: workOrder.order_no,
                  product_name: workOrder.product_name,
                  qty: workOrder.qty,
                  unit: workOrder.unit,
                  note: '',
                } satisfies Ec25OrderDraft,
                ...(workOrder.extra_orders || []),
              ].map((line, idx) => (
                <div
                  key={`wo-${idx}`}
                  className="mb-2 grid gap-2 rounded-lg border border-slate-700 px-2 py-2 last:mb-0 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1.4fr)_88px_64px_auto]"
                >
                  <label className="text-[11px] text-slate-400">
                    指令番号
                    <input
                      className="mt-0.5 w-full rounded border border-slate-600 bg-slate-800 px-2 py-1 text-sm text-cyan-100"
                      value={line.order_no}
                      onChange={(e) => {
                        if (idx === 0) {
                          setWorkOrder({ ...workOrder, order_no: e.target.value })
                          return
                        }
                        setWorkOrder({
                          ...workOrder,
                          extra_orders: (workOrder.extra_orders || []).map((o, i) =>
                            i === idx - 1 ? { ...o, order_no: e.target.value } : o
                          ),
                        })
                      }}
                    />
                  </label>
                  <label className="text-[11px] text-slate-400">
                    指令名
                    <input
                      className="mt-0.5 w-full rounded border border-slate-600 bg-slate-800 px-2 py-1 text-sm text-amber-100"
                      value={idx === 0 ? workOrder.product_name : line.product_name}
                      onChange={(e) => {
                        if (idx === 0) {
                          setWorkOrder({ ...workOrder, product_name: e.target.value })
                          return
                        }
                        setWorkOrder({
                          ...workOrder,
                          extra_orders: (workOrder.extra_orders || []).map((o, i) =>
                            i === idx - 1 ? { ...o, product_name: e.target.value } : o
                          ),
                        })
                      }}
                    />
                  </label>
                  <label className="text-[11px] text-slate-400">
                    何台
                    <input
                      type="number"
                      min={1}
                      step={1}
                      className="mt-0.5 w-full rounded border border-slate-600 bg-slate-800 px-2 py-1 text-sm text-slate-100"
                      value={line.qty}
                      onChange={(e) => {
                        const qty = Number(e.target.value) || 1
                        if (idx === 0) {
                          setWorkOrder({ ...workOrder, qty })
                          return
                        }
                        setWorkOrder({
                          ...workOrder,
                          extra_orders: (workOrder.extra_orders || []).map((o, i) =>
                            i === idx - 1 ? { ...o, qty } : o
                          ),
                        })
                      }}
                    />
                  </label>
                  <label className="text-[11px] text-slate-400">
                    単位
                    <input
                      className="mt-0.5 w-full rounded border border-slate-600 bg-slate-800 px-2 py-1 text-sm text-slate-100"
                      value={line.unit}
                      onChange={(e) => {
                        if (idx === 0) {
                          setWorkOrder({ ...workOrder, unit: e.target.value })
                          return
                        }
                        setWorkOrder({
                          ...workOrder,
                          extra_orders: (workOrder.extra_orders || []).map((o, i) =>
                            i === idx - 1 ? { ...o, unit: e.target.value } : o
                          ),
                        })
                      }}
                    />
                  </label>
                  <div className="flex items-end pb-1">
                    {idx > 0 && (
                      <button
                        type="button"
                        className="text-[11px] text-rose-300 hover:text-rose-200"
                        onClick={() =>
                          setWorkOrder({
                            ...workOrder,
                            extra_orders: (workOrder.extra_orders || []).filter((_, i) => i !== idx - 1),
                          })
                        }
                      >
                        削除
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {summary && (
          <div className="mb-3 flex flex-wrap gap-3 text-xs text-slate-300">
            <span>部品 {summary.total}</span>
            <span>板金 {summary.sheet}</span>
            <span>形鋼 {summary.profile}</span>
            <span>購入 {summary.purchased}</span>
            <span>ビス明細 {summary.fastener_lines ?? 0}</span>
            <span>組図 {summary.assembly}</span>
            <span>照合済 {summary.matched}</span>
            <span>PDF連動 {summary.pdf_linked}</span>
          </div>
        )}

        {rows.length > 0 && (
          <>
            <div className="mb-2 flex flex-wrap gap-2 text-sm">
              {(
                [
                  ['all', 'すべて'],
                  ['sheet', '板金・形鋼'],
                  ['fastener', 'ビス付きパーツ'],
                  ['purchased', '購入品'],
                  ['unmatched', '未照合'],
                  ['assembly', '組図/除外'],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => {
                    setFilter(k)
                    setPage(0)
                  }}
                  className={`px-3 py-1 rounded ${filter === k ? 'bg-amber-700' : 'bg-slate-800'}`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="overflow-x-auto rounded-lg border border-slate-700">
              <table className="min-w-full text-xs">
                <thead className="bg-slate-800 text-slate-300">
                  <tr>
                    <th className="px-2 py-2">取込</th>
                    <th className="px-2 py-2">展開</th>
                    <th className="px-2 py-2 text-left">パーツキー</th>
                    <th className="px-2 py-2 text-left">パーツ名</th>
                    <th className="px-2 py-2 text-left">材質・ビス → 製品（品名/規格）</th>
                    <th className="px-2 py-2 text-right">員数</th>
                    <th className="px-2 py-2 text-right">展開数量</th>
                    <th className="px-2 py-2 text-right">単価</th>
                    <th className="px-2 py-2 text-right">金額</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((row) => {
                    const materialEls = row.elements
                      .map((el, i) => ({ el, i }))
                      .filter((x) => x.el.role !== 'fastener')
                    const fastenerEls = row.elements
                      .map((el, i) => ({ el, i }))
                      .filter((x) => x.el.role === 'fastener')
                    const top = materialEls[0]?.el
                    const materialCost = top
                      ? elementCost(top, materialEls[0].i, row.cost_qty, row.kind)
                      : { qty: row.cost_qty, material: 0, total: 0 }
                    const applyProduct = (elementIndex: number, hit: ProductPick) => {
                      const elements = row.elements.map((item, i) =>
                        i === elementIndex
                          ? {
                              ...item,
                              product_code: hit.product_code,
                              product_name: hit.name,
                              spec: hit.spec || item.spec,
                              unit_price: Number(hit.cost_price ?? item.unit_price),
                            }
                          : item
                      )
                      updateRow(row.part_key, { elements })
                    }
                    return (
                      <tr key={row.part_key} className="border-t border-slate-800 align-top">
                        <td className="px-2 py-1">
                          <input
                            type="checkbox"
                            checked={row.include}
                            onChange={(e) => updateRow(row.part_key, { include: e.target.checked })}
                          />
                        </td>
                        <td className="px-2 py-1 whitespace-nowrap text-slate-400">
                          {!row.unfoldable
                            ? '—'
                            : row.unfold.source === 'ai'
                              ? 'AI'
                              : row.unfold.source === 'heuristic'
                                ? '概算'
                                : row.unfold.source}
                        </td>
                        <td className="px-2 py-1 font-mono whitespace-nowrap">
                          {row.part_key}
                          {row.pdf_pages.length > 0 && (
                            <div className="text-cyan-400">p.{row.pdf_pages.join(',')}</div>
                          )}
                        </td>
                        <td className="px-2 py-1 min-w-[10rem]">
                          {row.part_name}
                          <div className="text-slate-500">{row.kind}</div>
                        </td>
                        <td className="px-2 py-1 min-w-[20rem]">
                          {materialEls.length > 0 ? (
                            materialEls.map(({ el, i }) => (
                              <div key={`${row.part_key}-mat-${i}`} className="mb-2">
                                <div className="text-slate-400 mb-1">
                                  {el.drawing_spec !== false && i === materialEls[0]?.i ? (
                                    <span className="mr-1 text-[10px] text-cyan-300">図面仕様</span>
                                  ) : (
                                    <span className="mr-1 text-[10px] text-slate-500">構成要素{i + 1}</span>
                                  )}
                                  {el.material_raw || row.material_raw || '—'}
                                </div>
                                <ProductCodePicker
                                  seed={[el.material_raw, row.part_name].filter(Boolean).join(' ')}
                                  selectedCode={el.product_code}
                                  selectedName={el.product_name}
                                  selectedSpec={el.spec}
                                  selectedPrice={el.unit_price}
                                  quantity={costQtyForElement(el, i, row.cost_qty, row.kind)}
                                  quantityUnit={el.drawing_spec === false ? 'pcs' : row.cost_unit}
                                  candidates={el.candidates}
                                  onPick={(hit) => applyProduct(i, hit)}
                                />
                              </div>
                            ))
                          ) : (
                            <div className="text-slate-500 mb-2">{row.material_raw || '材質なし'}</div>
                          )}
                          {fastenerEls.length > 0 && (
                            <div className="mt-1 space-y-2 border-t border-amber-900/50 pt-2">
                              {fastenerEls.map(({ el, i }) => (
                                <div key={`${row.part_key}-bis-${i}`}>
                                  <div className="text-amber-200/90 mb-1">ねじ {el.material_raw}</div>
                                  <ProductCodePicker
                                    seed={el.material_raw || row.part_name}
                                    selectedCode={el.product_code}
                                    selectedName={el.product_name}
                                    selectedSpec={el.spec}
                                    selectedPrice={el.unit_price}
                                    quantity={Number(el.quantity || 0)}
                                    quantityUnit="pcs"
                                    candidates={el.candidates}
                                    variant="fastener"
                                    onPick={(hit) => applyProduct(i, hit)}
                                  />
                                </div>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="px-2 py-1 text-right whitespace-nowrap">
                          {materialEls.map(({ el, i }) => (
                            <div key={`${row.part_key}-mat-qty-${i}`} className={i > 0 ? 'mt-2' : ''}>
                              <div className="text-[10px] text-slate-500">数量</div>
                              {row.qty_pieces} {row.qty_unit}
                              <div className="text-slate-500">{row.qty_raw}</div>
                            </div>
                          ))}
                          {materialEls.length === 0 && (
                            <div>
                              {row.qty_pieces} {row.qty_unit}
                              <div className="text-slate-500">{row.qty_raw}</div>
                            </div>
                          )}
                          {fastenerEls.map(({ el, i }) => (
                            <div key={`${row.part_key}-bis-qty-${i}`} className="mt-2 text-amber-200/90">
                              <div className="text-[10px] text-amber-200/60">数量</div>
                              ねじ {el.quantity ?? 0} pcs
                            </div>
                          ))}
                        </td>
                        <td className="px-2 py-1 text-right">
                          {materialEls.map(({ el, i }) => {
                            const isSpec = el.drawing_spec === true || (i === materialEls[0]?.i && el.drawing_spec !== false)
                            const q = costQtyForElement(el, i, row.cost_qty, row.kind)
                            return (
                              <div key={`${row.part_key}-mat-costqty-${i}`} className={i > 0 ? 'mt-2' : ''}>
                                <div className="text-[10px] text-slate-500">{isSpec ? '図面仕様 必要量' : `構成要素${i + 1}`}</div>
                                {isSpec ? (
                                  <>
                                    <input
                                      type="number"
                                      step="0.0001"
                                      className="w-24 bg-transparent border-b border-slate-700 text-right"
                                      value={row.cost_qty}
                                      onChange={(e) =>
                                        updateRow(row.part_key, {
                                          cost_qty: Number(e.target.value) || 0,
                                          unfold: { ...row.unfold, source: 'manual', notes: '手入力' },
                                        })
                                      }
                                    />
                                    <div className="text-slate-500">
                                      {row.cost_unit} / {row.unfold.source} {Math.round((row.unfold.confidence || 0) * 100)}%
                                    </div>
                                  </>
                                ) : (
                                  <div>
                                    {q}
                                    <div className="text-slate-500">登録数量</div>
                                  </div>
                                )}
                              </div>
                            )
                          })}
                          {materialEls.length === 0 && (
                            <input
                              type="number"
                              step="0.0001"
                              className="w-24 bg-transparent border-b border-slate-700 text-right"
                              value={row.cost_qty}
                              onChange={(e) =>
                                updateRow(row.part_key, {
                                  cost_qty: Number(e.target.value) || 0,
                                  unfold: { ...row.unfold, source: 'manual', notes: '手入力' },
                                })
                              }
                            />
                          )}
                          {fastenerEls.map(({ el, i }) => (
                            <div key={`${row.part_key}-bis-costqty-${i}`} className="mt-2">
                              <div className="text-[10px] text-amber-200/60">数量</div>
                              <input
                                type="number"
                                step="1"
                                className="w-24 bg-transparent border-b border-amber-800/60 text-right text-amber-100"
                                value={el.quantity ?? 0}
                                onChange={(e) => {
                                  const quantity = Number(e.target.value) || 0
                                  const elements = row.elements.map((item, idx) =>
                                    idx === i ? { ...item, quantity } : item
                                  )
                                  updateRow(row.part_key, { elements })
                                }}
                              />
                              <div className="text-amber-200/60">pcs / ねじ</div>
                            </div>
                          ))}
                        </td>
                        <td className="px-2 py-1 text-right">
                          {materialEls.map(({ el, i }) => (
                            <div key={`${row.part_key}-mat-price-${i}`} className={i > 0 ? 'mt-2' : ''}>
                              <div className="text-[10px] text-slate-500">単価</div>
                              {yen(el.unit_price || 0)}
                            </div>
                          ))}
                          {materialEls.length === 0 && <div>{yen(0)}</div>}
                          {fastenerEls.map(({ el, i }) => (
                            <div key={`${row.part_key}-bis-price-${i}`} className="mt-2 text-amber-200/90">
                              <div className="text-[10px] text-amber-200/60">単価</div>
                              {yen(el.unit_price || 0)}
                            </div>
                          ))}
                        </td>
                        <td className="px-2 py-1 text-right font-semibold">
                          {materialEls.map(({ el, i }) => {
                            const mc = elementCost(el, i, row.cost_qty, row.kind)
                            return (
                              <div key={`${row.part_key}-mat-amt-${i}`} className={i > 0 ? 'mt-2' : ''}>
                                <div className="text-[10px] font-normal text-slate-500">金額</div>
                                {yen(mc.total)}
                              </div>
                            )
                          })}
                          {materialEls.length === 0 && <div>{yen(materialCost.total)}</div>}
                          {fastenerEls.map(({ el, i }) => {
                            const fc = elementCost(el, i, row.cost_qty, row.kind)
                            return (
                              <div key={`${row.part_key}-bis-amt-${i}`} className="mt-2 text-amber-200/90 font-semibold">
                                <div className="text-[10px] font-normal text-amber-200/60">金額</div>
                                {yen(fc.total)}
                              </div>
                            )
                          })}
                          {fastenerEls.length > 0 && (
                            <div className="mt-2 border-t border-slate-700 pt-1 text-amber-300">{yen(row.line_total)}</div>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <div className="mt-2 flex items-center gap-3 text-sm text-slate-400">
              <button
                type="button"
                disabled={page <= 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                className="px-2 py-1 rounded bg-slate-800 disabled:opacity-40"
              >
                前へ
              </button>
              <span>
                {page + 1} / {pageCount}
              </span>
              <button
                type="button"
                disabled={page >= pageCount - 1}
                onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                className="px-2 py-1 rounded bg-slate-800 disabled:opacity-40"
              >
                次へ
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
