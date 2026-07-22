'use client'

import { useMemo, useState } from 'react'
import type { Ec2ParsedPart, Ec2WorkOrderDraft } from '@/lib/ec2-pdf-bom'

type AnalyzeResponse = {
  dry_run?: boolean
  work_order: Ec2WorkOrderDraft
  summary: {
    total?: number
    drawing_parts?: number
    purchased?: number
    assembly_excluded?: number
    include_count?: number
  }
  parts: Ec2ParsedPart[]
  error?: string
}

export default function Ec2PdfBomImportSection() {
  const [partsPdf, setPartsPdf] = useState<File | null>(null)
  const [jsonFile, setJsonFile] = useState<File | null>(null)
  const [workOrder, setWorkOrder] = useState<Ec2WorkOrderDraft | null>(null)
  const [parts, setParts] = useState<Ec2ParsedPart[]>([])
  const [summary, setSummary] = useState<AnalyzeResponse['summary'] | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [filter, setFilter] = useState<'all' | 'drawing' | 'purchased' | 'excluded'>('all')
  const [page, setPage] = useState(0)
  const pageSize = 40

  const filtered = useMemo(() => {
    if (filter === 'drawing') return parts.filter((p) => p.kind === 'drawing_part')
    if (filter === 'purchased') return parts.filter((p) => p.kind === 'purchased')
    if (filter === 'excluded') return parts.filter((p) => !p.include)
    return parts
  }, [parts, filter])

  const pageRows = filtered.slice(page * pageSize, page * pageSize + pageSize)
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))

  const analyze = async () => {
    if (!partsPdf && !jsonFile) {
      setMsg({ type: 'err', text: '部品表PDF、または解析済みJSONを選択してください' })
      return
    }
    setBusy(true)
    setMsg(null)
    setPage(0)
    try {
      const fd = new FormData()
      fd.append('apply', 'false')
      if (jsonFile) fd.append('json', jsonFile)
      if (partsPdf) fd.append('parts_pdf', partsPdf)
      const res = await fetch('/api/heater/bom/import-ec2-pdf', { method: 'POST', body: fd })
      const data = (await res.json()) as AnalyzeResponse
      if (!res.ok) throw new Error(data.error || '解析に失敗しました')
      setWorkOrder(data.work_order)
      setParts(data.parts || [])
      setSummary(data.summary || null)
      setMsg({
        type: 'ok',
        text: `解析完了: 図番部品 ${data.summary?.drawing_parts ?? 0} / 購入品 ${data.summary?.purchased ?? 0} / 組図除外 ${data.summary?.assembly_excluded ?? 0}`,
      })
    } catch (e) {
      setMsg({ type: 'err', text: e instanceof Error ? e.message : '解析エラー' })
    } finally {
      setBusy(false)
    }
  }

  const apply = async () => {
    if (!workOrder || parts.length === 0) {
      setMsg({ type: 'err', text: '先に解析してください' })
      return
    }
    if (!confirm(`D指令 ${workOrder.order_no} を登録し、BOM・購入品原価を取り込みます。よろしいですか？`)) {
      return
    }
    setBusy(true)
    setMsg(null)
    try {
      const res = await fetch('/api/heater/bom/import-ec2-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apply: true,
          payload: { work_order: workOrder, parts },
          parts,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '取込に失敗しました')
      setMsg({
        type: 'ok',
        text: `取込完了: ${data.order_no} / 図番 ${data.drawing_parts} / 購入品 ${data.purchased_items} / 枝番 ${data.branch_sync?.branch_count ?? 0}`,
      })
    } catch (e) {
      setMsg({ type: 'err', text: e instanceof Error ? e.message : '取込エラー' })
    } finally {
      setBusy(false)
    }
  }

  const updatePart = (idxInFiltered: number, patch: Partial<Ec2ParsedPart>) => {
    const target = pageRows[idxInFiltered]
    if (!target) return
    setParts((prev) =>
      prev.map((p) => {
        const same =
          p === target ||
          (p.drawing_no === target.drawing_no &&
            p.part_name === target.part_name &&
            p.page === target.page &&
            p.qty_raw === target.qty_raw)
        return same ? { ...p, ...patch } : p
      })
    )
  }

  return (
    <section className="w-full max-w-6xl mt-10 rounded-2xl border border-cyan-500/30 bg-slate-900/70 p-6 text-slate-100">
      <h2 className="text-2xl font-bold text-cyan-300 mb-2">設計図・部品表 PDF → D指令・原価部品</h2>
      <p className="text-sm text-slate-400 mb-4">
        指令書を基に原価要素を取り込む手順です。①製作指図書から D指令を登録 → ②構成部品表の図番部品を BOM 化 → ③図番なし／ネジ類は購入品原価明細へ。
        スキャンPDFは OCR（Python + EasyOCR）が必要な場合があります。事前に{' '}
        <code className="text-cyan-200">scripts/ocr_ec2_parts_pdf.py</code> で JSON 化して取り込むと確実です。
      </p>

      <div className="grid gap-4 md:grid-cols-2 mb-4">
        <label className="block text-sm">
          <span className="text-slate-300">部品表 PDF</span>
          <input
            type="file"
            accept=".pdf,application/pdf"
            className="mt-1 block w-full text-sm"
            onChange={(e) => setPartsPdf(e.target.files?.[0] || null)}
          />
        </label>
        <label className="block text-sm">
          <span className="text-slate-300">解析済み JSON（推奨）</span>
          <input
            type="file"
            accept=".json,application/json"
            className="mt-1 block w-full text-sm"
            onChange={(e) => setJsonFile(e.target.files?.[0] || null)}
          />
        </label>
      </div>

      <div className="flex flex-wrap gap-3 mb-4">
        <button
          type="button"
          disabled={busy}
          onClick={analyze}
          className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 font-semibold"
        >
          {busy ? '処理中…' : '① 解析（プレビュー）'}
        </button>
        <button
          type="button"
          disabled={busy || !workOrder}
          onClick={apply}
          className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 font-semibold"
        >
          ② 取込実行（D指令+BOM+購入品）
        </button>
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
        <div className="mb-4 grid gap-3 md:grid-cols-4 text-sm">
          <label>
            D指令番号
            <input
              className="mt-1 w-full rounded bg-slate-800 border border-slate-600 px-2 py-1"
              value={workOrder.order_no}
              onChange={(e) => setWorkOrder({ ...workOrder, order_no: e.target.value })}
            />
          </label>
          <label className="md:col-span-2">
            品名 / bom_model
            <input
              className="mt-1 w-full rounded bg-slate-800 border border-slate-600 px-2 py-1"
              value={workOrder.product_name}
              onChange={(e) =>
                setWorkOrder({
                  ...workOrder,
                  product_name: e.target.value,
                  bom_model: e.target.value,
                })
              }
            />
          </label>
          <label>
            数量（式）
            <input
              type="number"
              min={1}
              className="mt-1 w-full rounded bg-slate-800 border border-slate-600 px-2 py-1"
              value={workOrder.qty}
              onChange={(e) => setWorkOrder({ ...workOrder, qty: Number(e.target.value) || 1 })}
            />
          </label>
        </div>
      )}

      {summary && (
        <div className="mb-3 flex flex-wrap gap-3 text-xs text-slate-300">
          <span>合計 {summary.total ?? parts.length}</span>
          <span>図番 {summary.drawing_parts}</span>
          <span>購入品 {summary.purchased}</span>
          <span>組図除外 {summary.assembly_excluded}</span>
          <span>取込対象 {parts.filter((p) => p.include).length}</span>
        </div>
      )}

      {parts.length > 0 && (
        <>
          <div className="mb-2 flex flex-wrap gap-2 text-sm">
            {(
              [
                ['all', 'すべて'],
                ['drawing', '図番部品'],
                ['purchased', '購入品'],
                ['excluded', '除外'],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => {
                  setFilter(k)
                  setPage(0)
                }}
                className={`px-3 py-1 rounded ${filter === k ? 'bg-cyan-700' : 'bg-slate-800'}`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="overflow-x-auto rounded-lg border border-slate-700">
            <table className="min-w-full text-xs">
              <thead className="bg-slate-800 text-slate-300">
                <tr>
                  <th className="px-2 py-2 text-left">取込</th>
                  <th className="px-2 py-2 text-left">区分</th>
                  <th className="px-2 py-2 text-left">図番 / part_key</th>
                  <th className="px-2 py-2 text-left">部品名</th>
                  <th className="px-2 py-2 text-left">材質・仕様</th>
                  <th className="px-2 py-2 text-right">数量</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((row, i) => (
                  <tr key={`${row.drawing_no}-${row.part_name}-${i}`} className="border-t border-slate-800">
                    <td className="px-2 py-1">
                      <input
                        type="checkbox"
                        checked={row.include}
                        onChange={(e) => updatePart(i, { include: e.target.checked })}
                      />
                    </td>
                    <td className="px-2 py-1">
                      <select
                        className="bg-slate-900 border border-slate-700 rounded px-1"
                        value={row.kind}
                        onChange={(e) => {
                          const kind = e.target.value as Ec2ParsedPart['kind']
                          updatePart(i, {
                            kind,
                            include: kind !== 'assembly',
                          })
                        }}
                      >
                        <option value="drawing_part">図番部品</option>
                        <option value="purchased">購入品</option>
                        <option value="assembly">組図（除外）</option>
                      </select>
                    </td>
                    <td className="px-2 py-1 font-mono">{row.drawing_no || '—'}</td>
                    <td className="px-2 py-1">
                      <input
                        className="w-full bg-transparent border-b border-slate-700"
                        value={row.part_name}
                        onChange={(e) => updatePart(i, { part_name: e.target.value })}
                      />
                    </td>
                    <td className="px-2 py-1 text-slate-400">{row.spec || row.material || ''}</td>
                    <td className="px-2 py-1 text-right">
                      <input
                        type="number"
                        step="0.01"
                        className="w-20 bg-transparent border-b border-slate-700 text-right"
                        value={row.qty}
                        onChange={(e) => updatePart(i, { qty: Number(e.target.value) || 0 })}
                      />
                    </td>
                  </tr>
                ))}
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
    </section>
  )
}
