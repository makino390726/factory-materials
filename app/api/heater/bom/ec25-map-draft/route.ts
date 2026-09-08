import fs from 'fs/promises'
import fsSync from 'fs'
import os from 'os'
import path from 'path'
import { NextResponse } from 'next/server'
import type { MappedPage } from '@/lib/ec25-ocr-map'

export const runtime = 'nodejs'

function cacheRoot() {
  return path.join(os.tmpdir(), 'ec25-map-cache')
}

function sessionDir(sid: string): string | null {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sid)) return null
  return path.join(cacheRoot(), sid)
}

function listPages(dir: string): number[] {
  if (!fsSync.existsSync(dir)) return []
  const pages = new Set<number>()
  for (const name of fsSync.readdirSync(dir)) {
    const m = name.match(/^page-(\d+)\.(jpg|jpeg|png)$/i)
    if (m) pages.add(Number(m[1]))
  }
  return [...pages].sort((a, b) => a - b)
}

function readMapping(dir: string): MappedPage[] | null {
  const file = path.join(dir, 'mapping.json')
  if (!fsSync.existsSync(file)) return null
  try {
    const raw = JSON.parse(fsSync.readFileSync(file, 'utf8')) as { pages?: MappedPage[] } | MappedPage[]
    const pages = Array.isArray(raw) ? raw : raw.pages
    return Array.isArray(pages) && pages.length ? pages : null
  } catch {
    return null
  }
}

function readBoxes(dir: string, page: number) {
  const file = path.join(dir, `boxes-page-${String(page).padStart(3, '0')}.json`)
  if (!fsSync.existsSync(file)) return []
  try {
    const raw = JSON.parse(fsSync.readFileSync(file, 'utf8')) as Array<{
      id?: string
      text?: string
      conf?: number
      x0?: number
      y0?: number
      x1?: number
      y1?: number
      field?: string
    }>
    return Array.isArray(raw) ? raw : []
  } catch {
    return []
  }
}

function pagesFromSession(sid: string): MappedPage[] {
  const dir = sessionDir(sid)
  if (!dir) return []
  const mapping = readMapping(dir)
  if (mapping?.length) {
    return mapping.map((p) => ({
      ...p,
      session: sid,
      image: `/api/heater/bom/ec25-map-image?sid=${sid}&p=${p.page}`,
      title_image: p.title_image
        ? `/api/heater/bom/ec25-map-image?sid=${sid}&p=${p.page}&kind=title`
        : p.title_image,
    }))
  }
  return listPages(dir).map((page) => {
    const boxes = readBoxes(dir, page)
    const title = fsSync.existsSync(path.join(dir, `title-${String(page).padStart(3, '0')}.jpg`))
    return {
      page,
      page_kind: page <= 3 ? (page === 1 ? 'sashizu' : page === 2 ? 'detail' : 'quote') : 'drawing',
      session: sid,
      image: `/api/heater/bom/ec25-map-image?sid=${sid}&p=${page}`,
      title_image: title ? `/api/heater/bom/ec25-map-image?sid=${sid}&p=${page}&kind=title` : '',
      width: 900,
      height: 1200,
      boxes: boxes.map((b, i) => ({
        id: String(b.id || `p${page}-u${i}`),
        text: String(b.text || ''),
        conf: Number(b.conf || 0),
        x0: Number(b.x0 || 0),
        y0: Number(b.y0 || 0),
        x1: Number(b.x1 || 0),
        y1: Number(b.y1 || 0),
        field: (b.field || '') as MappedPage['boxes'][number]['field'],
      })),
    }
  })
}

export async function GET() {
  const root = cacheRoot()
  if (!fsSync.existsSync(root)) return NextResponse.json({ sessions: [], pages: [] })
  const sessions = fsSync
    .readdirSync(root)
    .map((sid) => {
      const dir = path.join(root, sid)
      try {
        const st = fsSync.statSync(dir)
        if (!st.isDirectory()) return null
        const mapping = readMapping(dir)
        return {
          sid,
          mtime: st.mtimeMs,
          page_count: listPages(dir).length,
          has_mapping: Boolean(mapping?.length),
          box_count: (mapping || []).reduce((n, p) => n + (p.boxes?.length || 0), 0),
        }
      } catch {
        return null
      }
    })
    .filter(Boolean)
    .sort((a, b) => (b?.mtime || 0) - (a?.mtime || 0)) as Array<{
    sid: string
    mtime: number
    page_count: number
    has_mapping: boolean
    box_count: number
  }>
  const best =
    sessions.find((s) => s.has_mapping || s.box_count > 0) || sessions.find((s) => s.page_count > 0) || sessions[0]
  const pages = best ? pagesFromSession(best.sid) : []
  return NextResponse.json({ sessions, sid: best?.sid || '', pages })
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { sid?: string; pdfName?: string; pages?: MappedPage[] }
    const pages = Array.isArray(body.pages) ? body.pages : []
    if (!pages.length) return NextResponse.json({ error: 'pages がありません' }, { status: 400 })
    const sid =
      String(body.sid || pages[0]?.session || '').trim() ||
      (pages[0]?.image ? new URL(pages[0].image, 'http://localhost').searchParams.get('sid') || '' : '')
    const dir = sessionDir(sid)
    if (!dir) return NextResponse.json({ error: 'sid が不正です' }, { status: 400 })
    fsSync.mkdirSync(dir, { recursive: true })
    await fs.writeFile(path.join(dir, 'mapping.json'), JSON.stringify({ pdfName: body.pdfName || '', pages }), 'utf8')
    return NextResponse.json({ ok: true, sid })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : '保存に失敗しました' }, { status: 500 })
  }
}
