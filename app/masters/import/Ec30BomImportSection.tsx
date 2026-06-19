'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  decodeMappingChoice,
  encodeMappingChoice,
  type CandidateKind,
} from '@/lib/ec30-bom-candidates'

type Ec30Row = {
  part_key: string
  part_name: string
  drawing_no: string
  sheets: string
  qty_2tsubo: number
  qty_25tsubo: number
  qty_3tsubo: number
  auto_default: { kind: string; ref: string } | null
  candidate_options: { kind: string; ref: string; label: string; tier: string }[]
}

const SKIP_VAL = encodeMappingChoice('skip', '')

function mappingToSelectValue(m: { kind: string; ref: string }) {
  if (!m || m.kind === 'skip' || !m.kind) return SKIP_VAL
  return encodeMappingChoice(m.kind as CandidateKind, m.ref || '')
}

function selectValueToMapping(val: string): { kind: string; ref: string } {
  const d = decodeMappingChoice(val)
  if (!d) return { kind: 'skip', ref: '' }
  return { kind: d.kind, ref: d.ref }
}

export default function Ec30BomImportSection() {
  const [file, setFile] = useState<File | null>(null)
  const [model2, setModel2] = useState('EC30-2坪')
  const [model25, setModel25] = useState('EC30-2.5坪')
  const [model3, setModel3] = useState('EC30-3坪')
  const [rows, setRows] = useState<Ec30Row[]>([])
  const [summary, setSummary] = useState<{ raw_rows: number; merged_parts: number; auto_default_count: number; needs_review: number } | null>(null)
  const [mappings, setMappings] = useState<Record<string, { kind: string; ref: string }>>({})
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [page, setPage] = useState(0)
  const [filter, setFilter] = useState<'all' | 'review'>('all')
  const pageSize = 40

  const initMappingsFromRows = useCallback((list: Ec30Row[]) => {
    const next: Record<string, { kind: string; ref: string }> = {}
    for (const r of list) {
      next[r.part_key] = r.auto_default ? { ...r.auto_default } : { kind: 'skip', ref: '' }
    }
    setMappings(next)
  }, [])

  const analyze = async () => {
    if (!file) {
      setMsg({ type: 'err', text: '図番管理表の Excel を選択してください' })
      return
    }
    setBusy(true)
    setMsg(null)
    setPage(0)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('apply', 'false')
      fd.append('model_2', model2)
      fd.append('model_25', model25)
      fd.append('model_3', model3)
      const res = await fetch('/api/heater/bom/import-ec30', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || '解析に失敗しました')
      const list = (data.rows || []) as Ec30Row[]
      setRows(list)
      setSummary(data.summary || null)
      initMappingsFromRows(list)
      setMsg({ type: 'ok', text: `解析完了: 部品 ${list.length} 種（自動提案 ${data.summary?.auto_default_count ?? 0} 件）` })
    } catch (e) {
      setMsg({ type: 'err', text: e instanceof Error ? e.message : 'エラー' })
    } finally {
      setBusy(false)
    }
  }

  const applyAutoDefaults = () => {
    setMappings((prev) => {
      const next = { ...prev }
      for (const r of rows) {
        if (r.auto_default) next[r.part_key] = { ...r.auto_default }
      }
      return next
    })
    setMsg({ type: 'ok', text: '自動提案をマッピングに反映しました（上書き）' })
  }

  const applyImport = async () => {
    if (!file || rows.length === 0) {
      setMsg({ type: 'err', text: '先に「解析・候補表示」を実行してください' })
      return
    }
    if (!confirm('パーツマスタを upsert し、指定 3 機種の BOM を削除してから再投入します。よろしいですか？')) return
    setBusy(true)
    setMsg(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('apply', 'true')
      fd.append('mappings_json', JSON.stringify(mappings))
      fd.append('model_2', model2)
      fd.append('model_25', model25)
      fd.append('model_3', model3)
      const res = await fetch('/api/heater/bom/import-ec30', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || '取り込みに失敗しました')
      setMsg({
        type: 'ok',
        text: `取り込み完了: BOM ${data.summary?.bom_rows_inserted ?? 0} 行、部品 ${data.summary?.parts_upserted ?? 0} 件`,
      })
      setRows([])
      setSummary(null)
      setMappings({})
      setFile(null)
    } catch (e) {
      setMsg({ type: 'err', text: e instanceof Error ? e.message : 'エラー' })
    } finally {
      setBusy(false)
    }
  }

  const filteredRows = useMemo(() => {
    if (filter === 'review') return rows.filter((r) => !r.auto_default)
    return rows
  }, [rows, filter])

  const pageCount = Math.max(1, Math.ceil(filteredRows.length / pageSize))
  const pageSafe = Math.min(page, pageCount - 1)
  const slice = filteredRows.slice(pageSafe * pageSize, pageSafe * pageSize + pageSize)

  useEffect(() => {
    const pc = Math.max(1, Math.ceil(filteredRows.length / pageSize))
    setPage((p) => Math.min(Math.max(0, p), pc - 1))
  }, [filteredRows.length, filter, pageSize])

  return (
    <div id="ec30-bom" className="mb-10 w-full max-w-4xl scroll-mt-24">
      <div className="bg-gradient-to-br from-emerald-950/50 via-slate-950/40 to-slate-950/40 rounded-3xl border-2 border-emerald-500/40 backdrop-blur-sm p-8 space-y-5">
        <div>
          <h2 className="text-2xl font-bold text-emerald-300 flex items-center gap-2">
            <span>📐</span> EC30 図番管理表（BOM）取込
          </h2>
          <p className="text-sm text-emerald-100/80 mt-2 leading-relaxed">
            Excel の部品名を、製品マスタ・L指令マスタ・D指令マスタ・パーツリスト（heater_parts_master）から候補検索します。
            <strong className="text-white">解析</strong>のあと、各行のドロップダウンで紐付けを確認・修正し、
            <strong className="text-white">取り込み実行</strong>で DB に反映します（マッピングなしも可）。
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs text-emerald-200/90 mb-1">機種名（2坪）</label>
            <input
              value={model2}
              onChange={(e) => setModel2(e.target.value)}
              className="w-full px-3 py-2 bg-slate-900 border border-emerald-700/50 rounded-lg text-sm text-white"
            />
          </div>
          <div>
            <label className="block text-xs text-emerald-200/90 mb-1">機種名（2.5坪）</label>
            <input
              value={model25}
              onChange={(e) => setModel25(e.target.value)}
              className="w-full px-3 py-2 bg-slate-900 border border-emerald-700/50 rounded-lg text-sm text-white"
            />
          </div>
          <div>
            <label className="block text-xs text-emerald-200/90 mb-1">機種名（3坪）</label>
            <input
              value={model3}
              onChange={(e) => setModel3(e.target.value)}
              className="w-full px-3 py-2 bg-slate-900 border border-emerald-700/50 rounded-lg text-sm text-white"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <input
            type="file"
            accept=".xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="text-sm text-emerald-100 max-w-full"
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void analyze()}
            className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold text-sm"
          >
            {busy ? '処理中…' : '解析・候補表示'}
          </button>
          <button
            type="button"
            disabled={busy || rows.length === 0}
            onClick={applyAutoDefaults}
            className="px-5 py-2 rounded-xl bg-slate-600 hover:bg-slate-500 disabled:opacity-50 text-white font-semibold text-sm"
          >
            自動提案を一括反映
          </button>
          <button
            type="button"
            disabled={busy || rows.length === 0}
            onClick={() => void applyImport()}
            className="px-5 py-2 rounded-xl bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 disabled:opacity-50 text-white font-bold text-sm"
          >
            取り込み実行
          </button>
        </div>

        {msg && (
          <div
            className={`p-3 rounded-lg text-sm font-medium ${
              msg.type === 'ok' ? 'bg-emerald-900/40 text-emerald-200 border border-emerald-600/40' : 'bg-red-900/40 text-red-200 border border-red-500/40'
            }`}
          >
            {msg.text}
          </div>
        )}

        {summary && (
          <div className="text-xs text-emerald-200/90 flex flex-wrap gap-4 border border-emerald-800/40 rounded-lg px-3 py-2 bg-slate-900/40">
            <span>明細行: {summary.raw_rows}</span>
            <span>部品種類: {summary.merged_parts}</span>
            <span>自動提案あり: {summary.auto_default_count}</span>
            <span>要確認（提案なし）: {summary.needs_review}</span>
          </div>
        )}

        {rows.length > 0 && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className="text-emerald-200/90">表示:</span>
              <select
                value={filter}
                onChange={(e) => {
                  setFilter(e.target.value as 'all' | 'review')
                  setPage(0)
                }}
                className="px-2 py-1 rounded bg-slate-900 border border-emerald-800/50 text-white text-sm"
              >
                <option value="all">すべて</option>
                <option value="review">要確認のみ（自動提案なし）</option>
              </select>
              <span className="text-emerald-200/70">
                {filteredRows.length} 件中 {pageSafe * pageSize + 1}–{Math.min((pageSafe + 1) * pageSize, filteredRows.length)} 件表示
              </span>
            </div>
            <div className="max-h-[480px] overflow-auto rounded-xl border border-emerald-800/40 bg-slate-950/60">
              <table className="w-full text-left text-xs text-slate-200">
                <thead className="sticky top-0 bg-slate-900/95 border-b border-emerald-800/50 z-10">
                  <tr>
                    <th className="p-2 font-semibold w-[22%]">部品名</th>
                    <th className="p-2 font-semibold w-[14%]">図番 / key</th>
                    <th className="p-2 font-semibold w-[8%]">自動</th>
                    <th className="p-2 font-semibold">マッピング（候補から選択）</th>
                  </tr>
                </thead>
                <tbody>
                  {slice.map((r) => {
                    const m = mappings[r.part_key] || { kind: 'skip', ref: '' }
                    const selVal = mappingToSelectValue(m)
                    return (
                      <tr key={r.part_key} className="border-b border-slate-800/80 hover:bg-slate-900/40">
                        <td className="p-2 align-top text-emerald-50">{r.part_name}</td>
                        <td className="p-2 align-top font-mono text-[10px] text-slate-400 break-all">
                          {r.drawing_no}
                          <div className="text-slate-500 mt-0.5">{r.part_key}</div>
                        </td>
                        <td className="p-2 align-top text-amber-200/90">{r.auto_default ? '○' : '—'}</td>
                        <td className="p-2 align-top">
                          <select
                            value={selVal}
                            onChange={(e) => {
                              const v = e.target.value
                              const parsed = selectValueToMapping(v)
                              setMappings((prev) => ({ ...prev, [r.part_key]: parsed }))
                            }}
                            className="w-full max-w-md px-2 py-1 rounded bg-slate-900 border border-slate-600 text-[11px] text-white"
                          >
                            <option value={SKIP_VAL}>(マッピングなし)</option>
                            {r.candidate_options.map((c, idx) => (
                              <option
                                key={`${r.part_key}-${idx}-${c.kind}:${c.ref}`}
                                value={encodeMappingChoice(c.kind as CandidateKind, c.ref)}
                              >
                                {c.label}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between gap-2 text-sm">
              <button
                type="button"
                disabled={pageSafe <= 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                className="px-3 py-1 rounded-lg bg-slate-700 text-white disabled:opacity-40"
              >
                前へ
              </button>
              <span className="text-emerald-200/80">
                {pageSafe + 1} / {pageCount}
              </span>
              <button
                type="button"
                disabled={pageSafe >= pageCount - 1}
                onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                className="px-3 py-1 rounded-lg bg-slate-700 text-white disabled:opacity-40"
              >
                次へ
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
