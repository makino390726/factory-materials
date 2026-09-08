'use client'

import { useEffect, useMemo, useRef, useState, type ReactNode, type WheelEvent } from 'react'
import {
  applyElementField,
  applyOrderField,
  coverFromMappedPages,
  elementsFromPage,
  emptyElement,
  emptyOrder,
  ensureDrawingElements,
  FIELD_COLOR,
  hostOrdersPage,
  isCoverMapField,
  isElementMapField,
  isIdentityMapField,
  MAP_FIELDS,
  MAP_SEQUENCE,
  mapFieldLabel,
  partsFromMappedPages,
  type MapField,
  type MappedElement,
  type MappedFields,
  type MappedPage,
  type OcrBox,
} from '@/lib/ec25-ocr-map'
import type { Ec25OrderLine } from '@/lib/ec25-drawing-bom'

type Props = {
  pages: MappedPage[]
  onChange: (pages: MappedPage[]) => void
  onConfirm: () => void
  onCancel: () => void
  busy?: boolean
}

const KIND_LABEL: Record<string, string> = {
  sashizu: '製作指図書',
  detail: '詳細表',
  quote: '見積',
  purchase_list: '購入部品表',
  drawing: '図面',
  document: '文書',
}

type TabKey = 'drawings' | 'tables' | 'all'
type DraftRect = { x0: number; y0: number; x1: number; y1: number }

export default function OcrMapReview({ pages, onChange, onConfirm, onCancel, busy }: Props) {
  const [tab, setTab] = useState<TabKey>('drawings')
  const [pageIdx, setPageIdx] = useState(0)
  const [field, setField] = useState<MapField>('order_no')
  const [imgBroken, setImgBroken] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [wide, setWide] = useState(false)
  const [drawMode, setDrawMode] = useState(true)
  const [eraseMode, setEraseMode] = useState(false)
  const [pendingRect, setPendingRect] = useState<DraftRect | null>(null)
  const [reading, setReading] = useState(false)
  const [currentOrderIdx, setCurrentOrderIdx] = useState(0)
  const [currentCompIdx, setCurrentCompIdx] = useState(0)
  const preview = useMemo(() => {
    const cover = coverFromMappedPages(pages)
    const parts = partsFromMappedPages(pages)
    return { cover, parts }
  }, [pages])

  const drawings = pages.filter((p) => p.page_kind === 'drawing')
  const tables = pages.filter((p) => ['purchase_list', 'quote', 'detail', 'sashizu'].includes(p.page_kind))
  const visible = tab === 'drawings' ? drawings : tab === 'tables' ? tables : pages
  const page = visible[pageIdx] || visible[0] || pages[0]

  if (!page) return null

  const patchFields = (targetPage: number, patch: MappedFields) => {
    onChange(
      pages.map((p) =>
        p.page === targetPage ? { ...p, fields: { ...p.fields, ...patch } } : p
      )
    )
  }

  const orders = preview.cover.orders?.length ? preview.cover.orders : [emptyOrder()]
  const orderIdx = Math.min(currentOrderIdx, Math.max(0, orders.length - 1))

  const patchOrders = (next: Ec25OrderLine[], selectIdx = orderIdx) => {
    const host = hostOrdersPage(pages)
    if (!host) return
    const first = next[0]
    onChange(
      pages.map((p) =>
        p.page === host.page
          ? {
              ...p,
              orders: next,
              fields: {
                ...p.fields,
                order_no: first?.order_no || '',
                product_name: first?.product_name || '',
                order_qty: first ? String(first.qty) : '',
              },
            }
          : p
      )
    )
    setCurrentOrderIdx(Math.min(Math.max(0, selectIdx), Math.max(0, next.length - 1)))
  }

  const patchOrder = (idx: number, patch: Partial<Ec25OrderLine>) => {
    patchOrders(
      orders.map((o, i) => (i === idx ? { ...o, ...patch } : o)),
      idx
    )
  }

  const applyCoverText = (list: Ec25OrderLine[] | undefined, text: string, mapField: MapField) => {
    const next = (list?.length ? list : [emptyOrder()]).map((o) => emptyOrder(o))
    while (next.length <= orderIdx) next.push(emptyOrder())
    next[orderIdx] = applyOrderField(next[orderIdx], mapField, text)
    return next
  }

  const els = page ? ensureDrawingElements(elementsFromPage(page)) : ensureDrawingElements(undefined)
  const elIdx = Math.min(currentCompIdx, Math.max(0, els.length - 1))

  const patchElements = (next: MappedElement[], selectIdx = elIdx) => {
    const nextEls = ensureDrawingElements(next)
    const first = nextEls[0]
    onChange(
      pages.map((p) =>
        p.page === page.page
          ? {
              ...p,
              elements: nextEls,
              fields: {
                ...p.fields,
                material: first?.material || '',
                qty: first?.qty || '',
                supplier: first?.supplier || '',
                unit_price: first?.unit_price || '',
              },
            }
          : p
      )
    )
    setCurrentCompIdx(Math.min(Math.max(0, selectIdx), Math.max(0, nextEls.length - 1)))
  }

  const patchElement = (idx: number, patch: Partial<MappedElement>) => {
    patchElements(
      els.map((e, i) => (i === idx ? { ...e, ...patch } : e)),
      idx
    )
  }

  const applyElText = (list: MappedElement[] | undefined, text: string, mapField: MapField) => {
    const next = ensureDrawingElements(list)
    if (mapField === 'qty' && elIdx === 0) return next
    while (next.length <= elIdx) next.push(emptyElement())
    next[elIdx] = applyElementField(next[elIdx], mapField, text)
    return ensureDrawingElements(next)
  }

  const addElement = () => {
    const next = [...els, emptyElement({ drawing_spec: false })]
    patchElements(next, next.length - 1)
    setField('material')
  }

  const assignBox = (boxId: string) => {
    const box = page.boxes.find((b) => b.id === boxId)
    const nextField = box?.field === field ? '' : field
    const text = nextField ? String(box?.text || '') : ''
    const host = hostOrdersPage(pages)
    onChange(
      pages.map((p) => {
        const isCurrent = p.page === page.page
        const isCover = host?.page === p.page && isCoverMapField(field)
        if (!isCurrent && !isCover) return p
        const nextEls =
          isCurrent && isElementMapField(field) && nextField ? applyElText(p.elements || p.components, text, field) : p.elements || p.components
        const firstEl = nextEls?.[0]
        return {
          ...p,
          page_kind: isCurrent && isIdentityMapField(nextField) ? 'drawing' : p.page_kind,
          boxes: isCurrent
            ? p.boxes.map((b) =>
                b.id !== boxId
                  ? b
                  : {
                      ...b,
                      field: nextField,
                      row: nextField && isElementMapField(nextField) ? elIdx + 1 : nextField ? b.row : undefined,
                    }
              )
            : p.boxes,
          fields: {
            ...p.fields,
            ...(isCurrent && isIdentityMapField(field) ? { [field]: text } : {}),
            ...(isCover || (isCurrent && field === 'product_name') ? { [field]: text } : {}),
            ...(firstEl
              ? {
                  material: firstEl.material,
                  qty: firstEl.qty,
                  supplier: firstEl.supplier,
                  unit_price: firstEl.unit_price,
                }
              : {}),
          },
          orders: isCover && nextField ? applyCoverText(p.orders, text, field) : p.orders,
          elements: nextEls,
        }
      })
    )
    if (nextField) afterAssign(nextField)
  }

  const markDrawing = () => {
    onChange(pages.map((p) => (p.page === page.page ? { ...p, page_kind: 'drawing' } : p)))
  }

  const addEmptyBox = (rect: DraftRect) => {
    const box: OcrBox = {
      id: `p${page.page}-u${Date.now()}`,
      text: '',
      conf: 0,
      x0: Math.min(rect.x0, rect.x1),
      y0: Math.min(rect.y0, rect.y1),
      x1: Math.max(rect.x0, rect.x1),
      y1: Math.max(rect.y0, rect.y1),
      field: '',
    }
    onChange(pages.map((p) => (p.page === page.page ? { ...p, boxes: [...p.boxes, box] } : p)))
    setPendingRect(null)
  }

  const readPageBoxes = async () => {
    const sid =
      page.session ||
      (page.image ? new URL(page.image, 'http://localhost').searchParams.get('sid') || '' : '')
    if (!sid) return
    if (page.boxes.length === 0) return
    setReading(true)
    try {
      const res = await fetch('/api/heater/bom/ec25-ocr-boxes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sid,
          page: page.page,
          boxes: page.boxes.map((b) => ({ id: b.id, x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1 })),
        }),
      })
      const data = (await res.json()) as { error?: string; boxes?: Array<{ id?: string; text?: string; conf?: number }> }
      if (!res.ok) throw new Error(data.error || '読み取りに失敗しました')
      const byId = new Map((data.boxes || []).map((b) => [String(b.id || ''), b]))
      onChange(
        pages.map((p) =>
          p.page === page.page
            ? {
                ...p,
                boxes: p.boxes.map((b) => {
                  const hit = byId.get(b.id)
                  return hit ? { ...b, text: String(hit.text || ''), conf: Number(hit.conf || 0) } : b
                }),
              }
            : p
        )
      )
      setDrawMode(false)
    } finally {
      setReading(false)
    }
  }

  const removeBox = (boxId: string) => {
    const box = page.boxes.find((b) => b.id === boxId)
    onChange(
      pages.map((p) => {
        if (p.page !== page.page) return p
        const fields = { ...p.fields }
        if (box?.field && box.field !== 'ignore' && fields[box.field] === box.text) {
          fields[box.field] = ''
        }
        return { ...p, boxes: p.boxes.filter((b) => b.id !== boxId), fields }
      })
    )
  }

  const toggleDrawMode = () => {
    setDrawMode((v) => !v)
    setEraseMode(false)
    setPendingRect(null)
  }

  const toggleEraseMode = () => {
    setEraseMode((v) => !v)
    setDrawMode(false)
    setPendingRect(null)
  }

  const clearBoxes = () => {
    onChange(pages.map((p) => (p.page === page.page ? { ...p, boxes: [] } : p)))
  }

  const setVisibleIdx = (i: number) => {
    setPageIdx(i)
    setImgBroken(false)
    setCurrentCompIdx(0)
  }

  const bumpZoom = (delta: number) => {
    setZoom((z) => Math.min(4, Math.max(0.5, Math.round((z + delta) * 10) / 10)))
  }

  const stepIndex = Math.max(0, MAP_SEQUENCE.indexOf(field))
  const goStep = (delta: number) => {
    const next = stepIndex + delta
    if (next < 0 || next >= MAP_SEQUENCE.length) return
    setField(MAP_SEQUENCE[next])
  }
  const afterAssign = (assigned: MapField | '') => {
    if (!assigned || assigned === 'ignore') return
    const i = MAP_SEQUENCE.indexOf(assigned)
    if (i < 0 || i >= MAP_SEQUENCE.length - 1) return
    let next = MAP_SEQUENCE[i + 1]
    if (next === 'qty' && elIdx === 0) next = MAP_SEQUENCE[i + 2]
    if (next) setField(next)
  }

  const partsEditor = (
    <ComponentEditor
      items={els}
      currentIdx={elIdx}
      onSelect={(i) => {
        setCurrentCompIdx(i)
      }}
      onChange={patchElement}
      onAdd={addElement}
      onRemove={(idx) => {
        if (idx === 0) return
        const next = els.filter((_, i) => i !== idx)
        patchElements(ensureDrawingElements(next), Math.min(idx, Math.max(0, next.length - 1)))
      }}
    />
  )

  return (
    <div className="mb-6 rounded-2xl border border-cyan-500/40 bg-slate-900/80 p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-cyan-200">タイトル欄の確認（原価の元データ）</h2>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="rounded-lg border border-slate-600 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-50"
          >
            やり直す
          </button>
          <button
            type="button"
            disabled={busy || preview.parts.length === 0}
            onClick={onConfirm}
            className="rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-semibold hover:bg-amber-500 disabled:opacity-50"
          >
            {busy ? '照合中…' : `この内容で照合する（${preview.parts.length}点）`}
          </button>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-cyan-500/30 bg-slate-950/70 px-3 py-2 text-sm">
        <span className="text-slate-400">いま割り当て</span>
        <span className="font-semibold text-cyan-200">
          {stepIndex + 1}/{MAP_SEQUENCE.length} {mapFieldLabel(field, elIdx)}
        </span>
        <button type="button" className="rounded border border-slate-600 px-2 py-0.5 text-xs text-slate-300" onClick={() => goStep(-1)}>
          戻る
        </button>
        <button type="button" className="rounded border border-slate-600 px-2 py-0.5 text-xs text-slate-300" onClick={() => goStep(1)}>
          スキップ
        </button>
        <button
          type="button"
          className="rounded border border-emerald-500/50 px-2 py-0.5 text-xs text-emerald-200"
          onClick={addElement}
        >
          構成要素を追加
        </button>
        <button
          type="button"
          disabled={reading || page.boxes.length === 0}
          className="rounded border border-amber-400/60 bg-amber-600 px-2 py-0.5 text-xs font-semibold text-white disabled:opacity-50"
          onClick={readPageBoxes}
        >
          {reading ? '読み取り中…' : `このページの枠を読み取る（${page.boxes.length}）`}
        </button>
        <span className="text-xs text-slate-500">
          図面仕様 {els[0]?.material ? '済' : '未'} / 構成要素 {els.filter((e) => e.material).length}/{els.length}
        </span>
        {eraseMode && <span className="text-rose-300">削除モード：消したい枠をクリック</span>}
      </div>

      <div className="mb-4 space-y-2 rounded-xl border border-cyan-500/20 bg-slate-950/60 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs text-slate-300">指令（1枚の指図書に複数ある場合は追加）</div>
          <button
            type="button"
            className="rounded border border-cyan-500/50 px-2 py-0.5 text-xs text-cyan-200 hover:bg-cyan-900/40"
            onClick={() => {
              const next = [...orders, emptyOrder({ product_name: orders[0]?.product_name || '' })]
              patchOrders(next, next.length - 1)
              setField('order_no')
            }}
          >
            指令を追加
          </button>
        </div>
        {orders.map((order, idx) => (
          <div
            key={order.id}
            className={`grid gap-2 rounded-lg border px-2 py-2 md:grid-cols-[auto_minmax(0,1.1fr)_minmax(0,1.4fr)_88px_64px_auto] items-end ${
              idx === orderIdx ? 'border-cyan-400/70 bg-cyan-950/30' : 'border-slate-700'
            }`}
          >
            <button
              type="button"
              className="self-center rounded px-2 py-1 text-[11px] text-slate-300 hover:bg-slate-800"
              onClick={() => {
                setCurrentOrderIdx(idx)
                setField('order_no')
              }}
            >
              {idx === orderIdx ? '割当中' : `指令${idx + 1}`}
            </button>
            <label className="text-[11px] text-slate-400">
              指令番号
              <input
                className="mt-0.5 w-full rounded border border-slate-600 bg-slate-800 px-2 py-1 text-sm text-cyan-100"
                value={order.order_no}
                onChange={(e) => patchOrder(idx, { order_no: e.target.value })}
                onFocus={() => {
                  setCurrentOrderIdx(idx)
                  setField('order_no')
                }}
              />
            </label>
            <label className="text-[11px] text-slate-400">
              指令名 / 機種名
              <input
                className="mt-0.5 w-full rounded border border-slate-600 bg-slate-800 px-2 py-1 text-sm text-amber-100"
                value={order.product_name}
                onChange={(e) => patchOrder(idx, { product_name: e.target.value })}
                onFocus={() => {
                  setCurrentOrderIdx(idx)
                  setField('product_name')
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
                value={order.qty}
                onChange={(e) => patchOrder(idx, { qty: Number(e.target.value) || 1 })}
                onFocus={() => {
                  setCurrentOrderIdx(idx)
                  setField('order_qty')
                }}
              />
            </label>
            <label className="text-[11px] text-slate-400">
              単位
              <input
                className="mt-0.5 w-full rounded border border-slate-600 bg-slate-800 px-2 py-1 text-sm text-slate-100"
                value={order.unit}
                onChange={(e) => patchOrder(idx, { unit: e.target.value })}
              />
            </label>
            <div className="pb-0.5">
              {orders.length > 1 && (
                <button
                  type="button"
                  className="text-[11px] text-rose-300 hover:text-rose-200"
                  onClick={() => {
                    const next = orders.filter((_, i) => i !== idx)
                    patchOrders(next.length ? next : [emptyOrder()], Math.min(idx, next.length - 1))
                  }}
                >
                  削除
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="mb-3 flex flex-wrap gap-2 text-xs">
        {(
          [
            ['drawings', `図面 ${drawings.length}`],
            ['tables', `指図書・購入表 ${tables.length}`],
            ['all', `全頁 ${pages.length}`],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => {
              setTab(key)
              setPageIdx(0)
              setImgBroken(false)
            }}
            className={`rounded-full px-3 py-1 ${
              tab === key ? 'bg-cyan-700 text-white' : 'bg-slate-800 text-slate-400'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'drawings' && drawings.length === 0 ? (
        <div className="rounded-lg border border-amber-500/40 bg-amber-950/30 px-4 py-6 text-sm text-amber-100">
          図面ページを検出できませんでした。指図書・購入表タブで枠を割り当てるか、全頁タブでタイトル欄を確認してください。
        </div>
      ) : tab === 'drawings' ? (
        <div className={`grid gap-3 ${wide ? 'lg:grid-cols-[120px_minmax(0,1fr)_220px]' : 'lg:grid-cols-[160px_minmax(0,1fr)_280px]'}`}>
          <nav className={`${wide ? 'max-h-[82vh]' : 'max-h-[70vh]'} overflow-auto rounded-lg border border-slate-700 bg-slate-950/70 p-1`}>
            {drawings.map((p, i) => (
              <button
                key={p.page}
                type="button"
                onClick={() => setVisibleIdx(i)}
                className={`mb-1 block w-full rounded px-2 py-1.5 text-left text-xs ${
                  page.page === p.page ? 'bg-cyan-800/70 text-cyan-100' : 'text-slate-400 hover:bg-slate-800'
                }`}
              >
                p.{p.page} {p.fields?.part_key || '図番未読'}
                <span className="block truncate text-slate-500">
                  {p.fields?.part_name || '—'}
                  {!elementsFromPage(p)[0]?.material
                    ? ' / 図面仕様未'
                    : elementsFromPage(p).filter((e) => e.material).length > 1
                      ? ` / 構成要素${elementsFromPage(p).filter((e) => e.material).length}`
                      : ' / 図面仕様済'}
                </span>
              </button>
            ))}
            {drawings.length === 0 && <div className="p-2 text-slate-500">図面ページがありません</div>}
          </nav>

          <ZoomPane
            zoom={zoom}
            onZoom={bumpZoom}
            onReset={() => setZoom(1)}
            wide={wide}
            onWide={() => setWide((w) => !w)}
            toolbar={
              <FieldPalette
                field={field}
                elIdx={elIdx}
                onPick={(f) => {
                  setEraseMode(false)
                  setField(f === 'qty' && elIdx === 0 ? 'supplier' : f)
                }}
                drawMode={drawMode}
                eraseMode={eraseMode}
                onDrawMode={toggleDrawMode}
                onEraseMode={toggleEraseMode}
              />
            }
          >
            <MappedImage
              page={page}
              imgBroken={imgBroken}
              onBroken={() => {
                window.setTimeout(() => setImgBroken(true), 0)
              }}
              onAssign={assignBox}
              onRemove={removeBox}
              drawMode={drawMode}
              eraseMode={eraseMode}
              pendingRect={pendingRect}
              onDrawn={addEmptyBox}
            />
            {page.title_image && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={page.title_image} alt={`title ${page.page}`} className="block w-full border-t border-slate-700" />
            )}
          </ZoomPane>

          <PageFields page={page} onPatch={patchFields} onMarkDrawing={markDrawing} onRemove={removeBox} onClearBoxes={clearBoxes} partsEditor={partsEditor} />
        </div>
      ) : (
        <div className={`grid gap-3 ${wide ? 'lg:grid-cols-[120px_minmax(0,1fr)_220px]' : 'lg:grid-cols-[140px_minmax(0,1fr)_260px]'}`}>
          <nav className={`${wide ? 'max-h-[82vh]' : 'max-h-[70vh]'} overflow-auto rounded-lg border border-slate-700 bg-slate-950/70 p-1`}>
            {visible.map((p, i) => (
              <button
                key={p.page}
                type="button"
                onClick={() => setVisibleIdx(i)}
                className={`mb-1 block w-full rounded px-2 py-1.5 text-left text-xs ${
                  page.page === p.page ? 'bg-cyan-800/70 text-cyan-100' : 'text-slate-400 hover:bg-slate-800'
                }`}
              >
                p.{p.page} {KIND_LABEL[p.page_kind] || p.page_kind}
              </button>
            ))}
          </nav>
          <ZoomPane
            zoom={zoom}
            onZoom={bumpZoom}
            onReset={() => setZoom(1)}
            wide={wide}
            onWide={() => setWide((w) => !w)}
            toolbar={
              <FieldPalette
                field={field}
                elIdx={elIdx}
                onPick={(f) => {
                  setEraseMode(false)
                  setField(f === 'qty' && elIdx === 0 ? 'supplier' : f)
                }}
                drawMode={drawMode}
                eraseMode={eraseMode}
                onDrawMode={toggleDrawMode}
                onEraseMode={toggleEraseMode}
              />
            }
          >
            <MappedImage
              page={page}
              imgBroken={imgBroken}
              onBroken={() => {
                window.setTimeout(() => setImgBroken(true), 0)
              }}
              onAssign={assignBox}
              onRemove={removeBox}
              drawMode={drawMode}
              eraseMode={eraseMode}
              pendingRect={pendingRect}
              onDrawn={addEmptyBox}
            />
          </ZoomPane>
          <PageFields
            page={page}
            onPatch={patchFields}
            onMarkDrawing={markDrawing}
            onRemove={removeBox}
            onClearBoxes={clearBoxes}
            partsEditor={partsEditor}
            extra={
              <div className="mt-3 border-t border-slate-800 pt-2 text-slate-500">
                照合予定 {preview.parts.length} 点
              </div>
            }
          />
        </div>
      )}
    </div>
  )
}

function FieldPalette({
  field,
  elIdx,
  onPick,
  drawMode,
  eraseMode,
  onDrawMode,
  onEraseMode,
}: {
  field: MapField
  elIdx: number
  onPick: (f: MapField) => void
  drawMode: boolean
  eraseMode: boolean
  onDrawMode: () => void
  onEraseMode: () => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <button
        type="button"
        onClick={onDrawMode}
        className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${
          drawMode ? 'border-amber-400 bg-amber-500/20 text-amber-200' : 'border-slate-500 text-slate-200'
        }`}
      >
        {drawMode ? '枠追加中…ドラッグ' : '枠を追加'}
      </button>
      <button
        type="button"
        onClick={onEraseMode}
        className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${
          eraseMode ? 'border-rose-400 bg-rose-500/20 text-rose-200' : 'border-slate-500 text-slate-200'
        }`}
      >
        {eraseMode ? '削除中…枠をクリック' : '枠を削除'}
      </button>
      {MAP_FIELDS.map((f) => (
        <button
          key={f.field}
          type="button"
          onClick={() => onPick(f.field)}
          className={`rounded-full border px-2 py-0.5 text-[11px] ${field === f.field ? 'ring-1 ring-white/70' : ''} ${
            f.field === 'qty' && elIdx === 0 ? 'opacity-40' : ''
          }`}
          style={{ borderColor: f.color, color: f.color }}
        >
          {mapFieldLabel(f.field, elIdx)}
        </button>
      ))}
    </div>
  )
}

function MappedImage({
  page,
  imgBroken,
  onBroken,
  onAssign,
  onRemove,
  drawMode,
  eraseMode,
  pendingRect,
  onDrawn,
}: {
  page: MappedPage
  imgBroken: boolean
  onBroken: () => void
  onAssign: (id: string) => void
  onRemove: (id: string) => void
  drawMode: boolean
  eraseMode: boolean
  pendingRect: DraftRect | null
  onDrawn: (rect: DraftRect) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const startRef = useRef<{ x: number; y: number } | null>(null)
  const [drag, setDrag] = useState<DraftRect | null>(null)

  const toFrac = (clientX: number, clientY: number) => {
    const r = ref.current?.getBoundingClientRect()
    if (!r || r.width <= 0 || r.height <= 0) return { x: 0, y: 0 }
    return {
      x: Math.min(1, Math.max(0, (clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (clientY - r.top) / r.height)),
    }
  }

  useEffect(() => {
    if (!drawMode) return
    const move = (e: MouseEvent) => {
      const s = startRef.current
      if (!s) return
      const p = toFrac(e.clientX, e.clientY)
      setDrag({ x0: s.x, y0: s.y, x1: p.x, y1: p.y })
    }
    const up = (e: MouseEvent) => {
      const s = startRef.current
      startRef.current = null
      setDrag(null)
      if (!s) return
      const p = toFrac(e.clientX, e.clientY)
      const x0 = Math.min(s.x, p.x)
      const y0 = Math.min(s.y, p.y)
      const x1 = Math.max(s.x, p.x)
      const y1 = Math.max(s.y, p.y)
      if (x1 - x0 >= 0.008 && y1 - y0 >= 0.008) onDrawn({ x0, y0, x1, y1 })
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
  }, [drawMode, onDrawn])

  const preview = drag || pendingRect

  return (
    <div
      ref={ref}
      className={`relative inline-block w-full ${drawMode ? 'cursor-crosshair' : eraseMode ? 'cursor-pointer' : ''}`}
      onMouseDown={(e) => {
        if (!drawMode || e.button !== 0) return
        e.preventDefault()
        const p = toFrac(e.clientX, e.clientY)
        startRef.current = p
        setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y })
      }}
    >
      {page.image && !imgBroken ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={page.image}
          alt={`page ${page.page}`}
          className="block w-full select-none"
          draggable={false}
          onError={() => {
            window.setTimeout(() => onBroken(), 0)
          }}
        />
      ) : (
        <div className="flex h-64 items-center justify-center text-sm text-slate-500">画像なし</div>
      )}
      {page.boxes.map((b) => {
        const color = FIELD_COLOR[b.field || '']
        const label = b.field ? mapFieldLabel(b.field, Math.max(0, (b.row || 1) - 1)) : '未割当'
        return (
          <div
            key={b.id}
            role="button"
            tabIndex={0}
            title={`${b.text} → ${label} / ×または右クリックで削除`}
            onClick={() => {
              if (drawMode) return
              if (eraseMode) onRemove(b.id)
              else onAssign(b.id)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Delete' || e.key === 'Backspace') {
                e.preventDefault()
                onRemove(b.id)
              }
            }}
            onContextMenu={(e) => {
              e.preventDefault()
              onRemove(b.id)
            }}
            className={`absolute box-border border ${eraseMode ? 'ring-1 ring-rose-400/80' : 'cursor-pointer'}`}
            style={{
              left: `${b.x0 * 100}%`,
              top: `${b.y0 * 100}%`,
              width: `${Math.max(0.4, (b.x1 - b.x0) * 100)}%`,
              height: `${Math.max(0.6, (b.y1 - b.y0) * 100)}%`,
              borderColor: eraseMode ? '#fb7185' : color,
              background: eraseMode ? 'rgba(244,63,94,0.28)' : b.field ? `${color}33` : 'rgba(148,163,184,0.18)',
              pointerEvents: drawMode ? 'none' : 'auto',
            }}
          >
            {b.text && (
              <span className="pointer-events-none absolute inset-0 overflow-hidden px-0.5 text-[9px] leading-tight text-white drop-shadow">
                {b.text}
              </span>
            )}
            <button
              type="button"
              title="この枠を削除"
              onClick={(e) => {
                e.stopPropagation()
                onRemove(b.id)
              }}
              className="absolute z-10 flex h-4 min-w-4 items-center justify-center rounded-sm bg-rose-700 px-0.5 text-[10px] leading-none text-white hover:bg-rose-500"
              style={{ right: 0, top: 0, transform: 'translate(35%, -35%)' }}
            >
              ×
            </button>
          </div>
        )
      })}
      {preview && (
        <div
          className="pointer-events-none absolute border-2 border-amber-300 bg-amber-300/20"
          style={{
            left: `${Math.min(preview.x0, preview.x1) * 100}%`,
            top: `${Math.min(preview.y0, preview.y1) * 100}%`,
            width: `${Math.abs(preview.x1 - preview.x0) * 100}%`,
            height: `${Math.abs(preview.y1 - preview.y0) * 100}%`,
          }}
        />
      )}
    </div>
  )
}

function PageFields({
  page,
  onPatch,
  onMarkDrawing,
  onRemove,
  onClearBoxes,
  partsEditor,
  extra,
}: {
  page: MappedPage
  onPatch: (page: number, patch: MappedFields) => void
  onMarkDrawing: () => void
  onRemove?: (id: string) => void
  onClearBoxes?: () => void
  partsEditor?: ReactNode
  extra?: ReactNode
}) {
  return (
    <aside className={`${page.page ? 'max-h-[82vh]' : ''} space-y-2 overflow-auto rounded-lg border border-slate-700 bg-slate-950/70 p-3 text-xs`}>
      <div className="mb-1 text-slate-300">
        p.{page.page} {KIND_LABEL[page.page_kind] || page.page_kind} の割当
      </div>
      {page.page_kind !== 'drawing' && (
        <button
          type="button"
          onClick={onMarkDrawing}
          className="w-full rounded border border-emerald-600 px-2 py-1 text-emerald-200 hover:bg-emerald-900/40"
        >
          このページを図面パーツにする
        </button>
      )}
      <FieldInput label="図番（パーツキー）" value={page.fields?.part_key || ''} onChange={(v) => onPatch(page.page, { part_key: v })} />
      <FieldInput label="図名 / 品名（パーツ名）" value={page.fields?.part_name || ''} onChange={(v) => onPatch(page.page, { part_name: v })} />
      <FieldInput label="機種名" value={page.fields?.product_name || ''} onChange={(v) => onPatch(page.page, { product_name: v })} />
      {partsEditor}
      {page.boxes.length > 0 && (
        <div className="border-t border-slate-800 pt-2">
          <div className="mb-1 flex items-center justify-between text-slate-400">
            <span>枠 {page.boxes.length}</span>
            {onClearBoxes && (
              <button type="button" className="text-rose-300 hover:text-rose-200" onClick={onClearBoxes}>
                全削除
              </button>
            )}
          </div>
          <div className="max-h-40 space-y-1 overflow-auto">
            {page.boxes.map((b) => (
              <div key={b.id} className="flex items-start gap-1 rounded bg-slate-900/80 px-1.5 py-1">
                <span className="min-w-0 flex-1 truncate text-slate-300" title={b.text}>
                  {b.field ? mapFieldLabel(b.field, Math.max(0, (b.row || 1) - 1)) : '未割当'} {b.text || '(空)'}
                </span>
                {onRemove && (
                  <button
                    type="button"
                    className="shrink-0 text-rose-300 hover:text-rose-100"
                    onClick={() => onRemove(b.id)}
                  >
                    削除
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      {extra}
    </aside>
  )
}

function ComponentEditor({
  items,
  currentIdx,
  onSelect,
  onChange,
  onAdd,
  onRemove,
}: {
  items: MappedElement[]
  currentIdx: number
  onSelect: (idx: number) => void
  onChange: (idx: number, patch: Partial<MappedElement>) => void
  onAdd: () => void
  onRemove: (idx: number) => void
}) {
  return (
    <div className="space-y-2 border-t border-slate-800 pt-2">
      <div className="flex items-center justify-between">
        <span className="text-slate-300">
          1番目は図面仕様材料名（必須） {items.filter((e) => e.material).length}/{items.length}
        </span>
        <button type="button" className="text-emerald-300 hover:text-emerald-200" onClick={onAdd}>
          追加
        </button>
      </div>
      {items.map((c, idx) => (
        <div
          key={c.id}
          className={`space-y-1 rounded-lg border p-2 ${
            idx === currentIdx ? 'border-emerald-400/70 bg-emerald-950/20' : 'border-slate-700'
          }`}
          onFocusCapture={() => onSelect(idx)}
          onClick={() => onSelect(idx)}
        >
          <div className="flex items-center justify-between">
            <button type="button" className="text-[11px] text-slate-300" onClick={() => onSelect(idx)}>
              {idx === 0
                ? idx === currentIdx
                  ? '割当中 図面仕様材料名'
                  : '1. 図面仕様材料名（必須）'
                : idx === currentIdx
                  ? `割当中 構成要素${idx + 1}`
                  : `構成要素${idx + 1}`}
            </button>
            {idx > 0 && (
              <button type="button" className="text-rose-300 hover:text-rose-200" onClick={() => onRemove(idx)}>
                削除
              </button>
            )}
          </div>
          <FieldInput
            label={idx === 0 ? '図面仕様材料名' : '材質 / 規格'}
            value={c.material}
            onChange={(v) => onChange(idx, { material: v })}
          />
          {idx === 0 ? (
            <div className="rounded border border-slate-800 bg-slate-950/70 px-2 py-1 text-[11px] text-slate-400">
              必要量は照合後にAI展開で算出します
            </div>
          ) : (
            <FieldInput label="数量" value={c.qty} onChange={(v) => onChange(idx, { qty: v })} />
          )}
          <FieldInput label="購入先" value={c.supplier} onChange={(v) => onChange(idx, { supplier: v })} />
        </div>
      ))}
    </div>
  )
}

function ZoomPane({
  zoom,
  onZoom,
  onReset,
  wide,
  onWide,
  toolbar,
  children,
}: {
  zoom: number
  onZoom: (delta: number) => void
  onReset: () => void
  wide: boolean
  onWide: () => void
  toolbar?: ReactNode
  children: ReactNode
}) {
  const onWheel = (e: WheelEvent<HTMLDivElement>) => {
    if (!e.ctrlKey && !e.metaKey) return
    e.preventDefault()
    onZoom(e.deltaY > 0 ? -0.2 : 0.2)
  }
  return (
    <div className="rounded-lg border border-slate-700 bg-black">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-2 py-1.5">
        <div className="flex flex-wrap items-center gap-1">
          <button
            type="button"
            className="rounded border border-slate-600 px-2 py-0.5 text-xs text-slate-200 hover:bg-slate-800"
            onClick={() => onZoom(-0.25)}
          >
            −
          </button>
          <span className="min-w-12 text-center font-mono text-xs text-cyan-200">{Math.round(zoom * 100)}%</span>
          <button
            type="button"
            className="rounded border border-slate-600 px-2 py-0.5 text-xs text-slate-200 hover:bg-slate-800"
            onClick={() => onZoom(0.25)}
          >
            ＋
          </button>
          <button
            type="button"
            className="rounded border border-slate-600 px-2 py-0.5 text-xs text-slate-300 hover:bg-slate-800"
            onClick={onReset}
          >
            100%
          </button>
          <button
            type="button"
            className={`rounded border px-2 py-0.5 text-xs ${
              wide ? 'border-cyan-400 text-cyan-200' : 'border-slate-600 text-slate-300'
            } hover:bg-slate-800`}
            onClick={onWide}
          >
            {wide ? '通常表示' : '大きく表示'}
          </button>
        </div>
        {toolbar}
      </div>
      <div
        className={`overflow-auto ${wide ? 'h-[82vh]' : 'max-h-[70vh]'}`}
        onWheel={onWheel}
      >
        <div className="origin-top-left" style={{ width: `${zoom * 100}%` }}>
          {children}
        </div>
      </div>
    </div>
  )
}

function FieldInput({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <label className="block text-slate-400">
      {label}
      <input
        className="mt-1 w-full rounded border border-slate-600 bg-slate-800 px-2 py-1.5 text-sm text-slate-100"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  )
}
