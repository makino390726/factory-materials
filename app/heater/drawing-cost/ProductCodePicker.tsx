'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { fuzzyScoreAgainstQuery, type MaterialMatch, type ProductCostRow } from '@/lib/ec25-material-match'
import { hasExcludedLeading00 } from '@/lib/product-code'

export type ProductPick = {
  product_code: string
  name: string
  spec: string
  cost_price: number
}

type Props = {
  seed: string
  selectedCode: string
  selectedName?: string
  selectedSpec?: string
  selectedPrice?: number
  quantity: number
  quantityUnit?: string
  candidates: MaterialMatch[]
  onPick: (hit: ProductPick) => void
  variant?: 'material' | 'fastener'
}

function yen(n: number) {
  return `¥${Math.round(n || 0).toLocaleString()}`
}

function lineAmount(qty: number, price: number) {
  const material = Math.round(Number(qty || 0) * Number(price || 0))
  return { material, total: material + Math.round(material * 0.3) }
}

function toPick(p: { product_code: string; name: string; spec?: string | null; cost_price?: number | null }): ProductPick {
  return {
    product_code: p.product_code,
    name: p.name,
    spec: String(p.spec || ''),
    cost_price: Number(p.cost_price || 0),
  }
}

export default function ProductCodePicker({
  seed,
  selectedCode,
  selectedName,
  selectedSpec,
  selectedPrice = 0,
  quantity,
  quantityUnit = '',
  candidates,
  onPick,
  variant = 'material',
}: Props) {
  const unmatched = !selectedCode
  const [query, setQuery] = useState(unmatched ? seed : '')
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [hits, setHits] = useState<ProductPick[]>([])
  const seq = useRef(0)
  const box = useRef<HTMLDivElement | null>(null)

  const border =
    variant === 'fastener' ? 'border-amber-800/60 text-amber-50' : 'border-slate-700 text-slate-100'

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  useEffect(() => {
    if (unmatched && seed && !query) setQuery(seed)
  }, [seed, unmatched, query])

  useEffect(() => {
    const q = query.trim()
    if (!open) return
    if (q.length < 1) {
      setHits([])
      return
    }
    const id = ++seq.current
    const timer = window.setTimeout(async () => {
      setBusy(true)
      try {
        const res = await fetch(`/api/products/search?q=${encodeURIComponent(q)}`)
        const data = (await res.json()) as ProductCostRow[]
        if (id !== seq.current) return
        const rows = Array.isArray(data) ? data : []
        const ranked = rows
          .filter((p) => p?.product_code && !hasExcludedLeading00(p.product_code))
          .map((p) => ({ pick: toPick(p), score: fuzzyScoreAgainstQuery(p, q) }))
          .filter((x) => x.score > 0)
          .sort((a, b) => b.score - a.score || a.pick.product_code.localeCompare(b.pick.product_code))
        const seen = new Set<string>()
        const uniq: ProductPick[] = []
        for (const x of ranked) {
          if (seen.has(x.pick.product_code)) continue
          seen.add(x.pick.product_code)
          uniq.push(x.pick)
          if (uniq.length >= 20) break
        }
        setHits(uniq)
      } catch {
        if (id === seq.current) setHits([])
      } finally {
        if (id === seq.current) setBusy(false)
      }
    }, 220)
    return () => window.clearTimeout(timer)
  }, [query, open])

  const candidatePicks = useMemo(() => candidates.map((c) => toPick(c)), [candidates])

  const list = useMemo(() => {
    const seen = new Set<string>()
    const out: ProductPick[] = []
    const q = query.trim()
    const rankedCand = [...candidatePicks]
      .map((p) => ({ p, s: q ? fuzzyScoreAgainstQuery(p, q) : 80 }))
      .sort((a, b) => b.s - a.s)
      .map((x) => x.p)
    for (const p of [...rankedCand, ...hits]) {
      if (seen.has(p.product_code)) continue
      seen.add(p.product_code)
      out.push(p)
    }
    return out
  }, [candidatePicks, hits, query])

  const current = lineAmount(quantity, selectedPrice)
  const metrics = (
    <div className={`mt-1 grid grid-cols-3 gap-1 text-right ${unmatched ? 'text-rose-200' : 'text-slate-400'}`}>
      <div>
        <div className="text-[10px] opacity-70">数量</div>
        <div className="font-mono">
          {quantity}
          {quantityUnit ? ` ${quantityUnit}` : ''}
        </div>
      </div>
      <div>
        <div className="text-[10px] opacity-70">単価</div>
        <div className="font-mono">{yen(selectedPrice)}</div>
      </div>
      <div>
        <div className="text-[10px] opacity-70">金額</div>
        <div className="font-mono font-semibold">{yen(current.total)}</div>
      </div>
    </div>
  )

  return (
    <div ref={box} className="relative">
      {selectedCode && !open && (
        <button
          type="button"
          className={`w-full rounded border bg-slate-900 px-1 py-1 text-left ${border}`}
          onClick={() => {
            setQuery(seed || selectedCode)
            setOpen(true)
          }}
        >
          <span className="font-mono text-cyan-300">{selectedCode}</span>
          <span className="ml-1">
            {selectedName}
            {selectedSpec ? ` / ${selectedSpec}` : ''}
          </span>
        </button>
      )}
      {(!selectedCode || open) && (
        <>
          <input
            className={`w-full rounded border bg-slate-900 px-1 py-1 ${border}`}
            value={query}
            placeholder="元データ・製品コード・品名・規格であいまい検索"
            onChange={(e) => {
              setQuery(e.target.value)
              setOpen(true)
            }}
            onFocus={() => {
              if (!query && seed) setQuery(seed)
              setOpen(true)
            }}
          />
          {open && (
            <div className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded border border-slate-600 bg-slate-950 shadow-xl">
              {busy && <div className="px-2 py-1 text-slate-500">検索中…</div>}
              {!busy && list.length === 0 && (
                <div className="px-2 py-1 text-slate-500">一致する製品コードがありません</div>
              )}
              {list.map((p) => {
                const amt = lineAmount(quantity, p.cost_price)
                return (
                  <button
                    key={p.product_code}
                    type="button"
                    className="block w-full border-b border-slate-800 px-2 py-1.5 text-left hover:bg-slate-800"
                    onClick={() => {
                      onPick(p)
                      setOpen(false)
                    }}
                  >
                    <div>
                      <span className="font-mono text-cyan-300">{p.product_code}</span>
                      <span className="ml-1 text-slate-200">{p.name}</span>
                      {p.spec ? <span className="ml-1 text-slate-500">/ {p.spec}</span> : null}
                    </div>
                    <div className="mt-0.5 flex justify-between gap-2 text-[11px] text-amber-100/90">
                      <span>数量 {quantity}{quantityUnit ? ` ${quantityUnit}` : ''}</span>
                      <span>単価 {yen(p.cost_price)}</span>
                      <span>金額 {yen(amt.total)}</span>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </>
      )}
      {metrics}
    </div>
  )
}
