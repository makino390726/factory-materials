/**
 * 図面マッピング（枠・割当・構成要素）を同一PDF名で復元する。
 * 画像セッションはサーバ側キャッシュ、割当データはブラウザに残す。
 */

import type { MappedPage } from '@/lib/ec25-ocr-map'

export const MAP_DRAFT_PREFIX = 'ec25-map-draft:'
const LATEST_KEY = `${MAP_DRAFT_PREFIX}latest`

export type MapDraft = {
  pdfName: string
  savedAt: number
  pages: MappedPage[]
}

function storageKey(pdfName: string) {
  return `${MAP_DRAFT_PREFIX}${pdfName}`
}

function pageHasWork(page: MappedPage): boolean {
  const assigned = (page.boxes || []).some((b) => b.field && b.field !== 'ignore')
  const fields = page.fields
  const identity = Boolean(fields?.part_key || fields?.part_name || fields?.material || fields?.order_no)
  const elements = (page.elements || page.components || []).some((e) => e.material || e.qty || e.supplier)
  const orders = (page.orders || []).some((o) => o.order_no || o.product_name)
  return assigned || identity || elements || orders || (page.boxes || []).length > 0
}

export function mappingWorkScore(pages: MappedPage[]): number {
  return pages.reduce((n, p) => {
    const boxes = p.boxes || []
    const assigned = boxes.filter((b) => b.field && b.field !== 'ignore').length
    const texts = boxes.filter((b) => String(b.text || '').trim()).length
    const fields = Object.values(p.fields || {}).filter((v) => String(v || '').trim()).length
    const els = (p.elements || p.components || []).filter((e) => e.material).length
    const orders = (p.orders || []).filter((o) => o.order_no || o.product_name).length
    return n + boxes.length * 2 + assigned * 8 + texts * 3 + fields * 5 + els * 10 + orders * 6
  }, 0)
}

function parseDraft(raw: string | null): MapDraft | null {
  if (!raw) return null
  try {
    const draft = JSON.parse(raw) as MapDraft
    if (!Array.isArray(draft.pages) || draft.pages.length === 0) return null
    return draft
  } catch {
    return null
  }
}

function readStores(): Array<Storage> {
  if (typeof window === 'undefined') return []
  return [window.localStorage, window.sessionStorage]
}

export function listMapDrafts(): MapDraft[] {
  const found = new Map<string, MapDraft>()
  for (const store of readStores()) {
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i)
      if (!key?.startsWith(MAP_DRAFT_PREFIX)) continue
      const draft = parseDraft(store.getItem(key))
      if (!draft) continue
      const id = draft.pdfName || key
      const prev = found.get(id)
      if (!prev || (draft.savedAt || 0) > (prev.savedAt || 0) || mappingWorkScore(draft.pages) > mappingWorkScore(prev.pages)) {
        found.set(id, draft)
      }
    }
  }
  return [...found.values()].sort(
    (a, b) => mappingWorkScore(b.pages) - mappingWorkScore(a.pages) || (b.savedAt || 0) - (a.savedAt || 0)
  )
}

export function loadLatestMapDraft(): MapDraft | null {
  const latest = parseDraft(typeof window === 'undefined' ? null : window.sessionStorage.getItem(LATEST_KEY) || window.localStorage.getItem(LATEST_KEY))
  const listed = listMapDrafts()
  if (latest && listed.every((d) => mappingWorkScore(d.pages) <= mappingWorkScore(latest.pages))) return latest
  return listed[0] || latest
}

export function saveMapDraft(pdfName: string, pages: MappedPage[]) {
  if (typeof window === 'undefined' || !pages.length) return
  const incoming = mappingWorkScore(pages)
  if (incoming === 0) return
  const name = pdfName || 'untitled.pdf'
  const existing = loadMapDraft(name)
  if (existing && mappingWorkScore(existing) > incoming) return
  const payload: MapDraft = { pdfName: name, savedAt: Date.now(), pages }
  const raw = JSON.stringify(payload)
  try {
    window.localStorage.setItem(storageKey(name), raw)
    window.localStorage.setItem(LATEST_KEY, raw)
    window.sessionStorage.setItem(storageKey(name), raw)
    window.sessionStorage.setItem(LATEST_KEY, raw)
  } catch {
    /* quota / private mode */
  }
}

export function loadMapDraft(pdfName: string): MappedPage[] | null {
  if (typeof window === 'undefined' || !pdfName) return null
  for (const store of readStores()) {
    const draft = parseDraft(store.getItem(storageKey(pdfName)))
    if (draft?.pages.length) return draft.pages
  }
  return null
}

export function mergeMapDraft(
  fresh: MappedPage[],
  draft: MappedPage[] | null
): { pages: MappedPage[]; restored: boolean } {
  if (!draft?.length) return { pages: fresh, restored: false }
  if (mappingWorkScore(draft) < mappingWorkScore(fresh)) return { pages: fresh, restored: false }
  let restored = false
  const pages = fresh.map((p) => {
    const d = draft.find((x) => x.page === p.page)
    if (!d || !pageHasWork(d)) return p
    restored = true
    return {
      ...p,
      boxes: d.boxes?.length ? d.boxes : p.boxes,
      fields: d.fields || p.fields,
      orders: d.orders?.length ? d.orders : p.orders,
      elements: d.elements?.length ? d.elements : p.elements,
      components: d.components?.length ? d.components : p.components,
      page_kind: d.page_kind || p.page_kind,
    }
  })
  return { pages, restored }
}

export function rewriteMapSession(pages: MappedPage[], sid: string): MappedPage[] {
  return pages.map((p) => ({
    ...p,
    session: sid,
    image: `/api/heater/bom/ec25-map-image?sid=${sid}&p=${p.page}`,
    title_image: p.title_image
      ? `/api/heater/bom/ec25-map-image?sid=${sid}&p=${p.page}&kind=title`
      : p.title_image,
  }))
}
