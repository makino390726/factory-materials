import { randomUUID } from 'crypto'
import { spawn } from 'child_process'
import fs from 'fs/promises'
import fsSync from 'fs'
import os from 'os'
import path from 'path'
import {
  coverFromDorder,
  isDorderDocument,
  type DorderIndexPayload,
} from '@/lib/ec25-dorder-extract'
import {
  applyAutoMap,
  coverFromMappedPages,
  partsFromMappedPages,
  type MappedPage,
} from '@/lib/ec25-ocr-map'

export const runtime = 'nodejs'
export const maxDuration = 300

function send(controller: ReadableStreamDefaultController<Uint8Array>, obj: Record<string, unknown>) {
  controller.enqueue(new TextEncoder().encode(JSON.stringify(obj) + '\n'))
}

function parseProgressLine(line: string): Record<string, unknown> | null {
  const trimmed = line.trim().replace(/\x1b\[[0-9;]*m/g, '')
  if (!trimmed) return null
  if (trimmed.startsWith('PROGRESS ')) {
    try {
      return JSON.parse(trimmed.slice('PROGRESS '.length)) as Record<string, unknown>
    } catch {
      return null
    }
  }
  const m = trimmed.match(/page\s+(\d+)\s*\/\s*(\d+)/i)
  if (m) return { phase: 'ocr', page: Number(m[1]), total: Number(m[2]) }
  return null
}

function runPython(args: string[], onProgress: (ev: Record<string, unknown>) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = path.join(process.cwd(), 'scripts', 'ocr_ec25_drawings.py')
    const child = spawn('python', [script, ...args], {
      cwd: process.cwd(),
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    })
    let stderr = ''
    let leftover = ''
    const onChunk = (d: Buffer) => {
      const text = leftover + d.toString()
      const lines = text.split(/\r?\n/)
      leftover = lines.pop() || ''
      for (const line of lines) {
        stderr += line + '\n'
        const prog = parseProgressLine(line)
        if (prog) onProgress(prog)
      }
    }
    child.stderr.on('data', onChunk)
    child.stdout.on('data', () => undefined)
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`製作指図書OCR失敗 (code=${code}): ${stderr.slice(-1500)}`))
    })
  })
}

function mapCacheRoot() {
  return path.join(os.tmpdir(), 'ec25-map-cache')
}

function pruneMapCache() {
  const root = mapCacheRoot()
  if (!fsSync.existsSync(root)) return
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000
  for (const name of fsSync.readdirSync(root)) {
    const dir = path.join(root, name)
    try {
      if (fsSync.statSync(dir).mtimeMs < cutoff) {
        fsSync.rmSync(dir, { recursive: true, force: true })
      }
    } catch {
      /* ignore */
    }
  }
}

function collectRenderedFiles(index: DorderIndexPayload, imagesDir: string) {
  const files = new Map<number, { path: string; width: number; height: number }>()
  for (const r of index.rendered || []) {
    if (!r.path || !fsSync.existsSync(r.path)) continue
    files.set(r.page, { path: r.path, width: r.width || 900, height: r.height || 1200 })
  }
  if (fsSync.existsSync(imagesDir)) {
    for (const name of fsSync.readdirSync(imagesDir)) {
      const m = name.match(/^page-(\d+)\.(jpg|jpeg|png)$/i)
      if (!m) continue
      const page = Number(m[1])
      if (files.has(page)) continue
      files.set(page, { path: path.join(imagesDir, name), width: 900, height: 1200 })
    }
  }
  return files
}

function persistMapImages(index: DorderIndexPayload, imagesDir: string) {
  pruneMapCache()
  const session = randomUUID()
  const dest = path.join(mapCacheRoot(), session)
  fsSync.mkdirSync(dest, { recursive: true })
  const byPage = new Map<number, { file: string; width: number; height: number }>()
  const titles = new Map<number, string>()
  for (const [page, src] of collectRenderedFiles(index, imagesDir)) {
    const ext = path.extname(src.path).toLowerCase() || '.jpg'
    const file = `page-${String(page).padStart(3, '0')}${ext === '.jpeg' ? '.jpg' : ext}`
    fsSync.copyFileSync(src.path, path.join(dest, file))
    byPage.set(page, { file, width: src.width, height: src.height })
  }
  for (const r of index.rendered || []) {
    if (r.title_path && fsSync.existsSync(r.title_path)) {
      const ext = path.extname(r.title_path).toLowerCase() || '.jpg'
      const file = `title-${String(r.page).padStart(3, '0')}${ext === '.jpeg' ? '.jpg' : ext}`
      fsSync.copyFileSync(r.title_path, path.join(dest, file))
      titles.set(r.page, file)
    }
  }
  if (fsSync.existsSync(imagesDir)) {
    for (const name of fsSync.readdirSync(imagesDir)) {
      const m = name.match(/^title-(\d+)\.(jpg|jpeg|png)$/i)
      if (!m) continue
      const page = Number(m[1])
      if (titles.has(page)) continue
      const file = `title-${String(page).padStart(3, '0')}${path.extname(name).toLowerCase()}`
      fsSync.copyFileSync(path.join(imagesDir, name), path.join(dest, file))
      titles.set(page, file)
    }
  }
  return { session, byPage, titles }
}

function buildMapPages(
  index: DorderIndexPayload,
  persisted: {
    session: string
    byPage: Map<number, { file: string; width: number; height: number }>
    titles: Map<number, string>
  }
): MappedPage[] {
  return applyAutoMap(
    (index.pages || []).map((p) => {
      const img = persisted.byPage.get(p.page)
      const hasTitle = persisted.titles.has(p.page)
      return {
        page: p.page,
        page_kind: String(p.page_kind || ''),
        session: persisted.session,
        image: img ? `/api/heater/bom/ec25-map-image?sid=${persisted.session}&p=${p.page}` : '',
        title_image: hasTitle ? `/api/heater/bom/ec25-map-image?sid=${persisted.session}&p=${p.page}&kind=title` : '',
        width: img?.width || 900,
        height: img?.height || 1200,
        boxes: [],
      }
    })
  )
}

export async function POST(req: Request) {
  const form = await req.formData()
  const pdf = form.get('pdf') as File | null
  const detectOnly = form.get('detect') === 'true'
  if (!pdf || pdf.size === 0) {
    return Response.json({ error: 'PDFが必要です' }, { status: 400 })
  }
  if (pdf.size > 80 * 1024 * 1024) {
    return Response.json({ error: 'PDFが大きすぎます（80MB以下）' }, { status: 400 })
  }

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ec25-dorder-'))
  const pdfPath = path.join(tmp, 'drawings.pdf')
  const outPath = path.join(tmp, 'index.json')
  const imagesDir = path.join(tmp, 'docs')
  await fs.writeFile(pdfPath, Buffer.from(await pdf.arrayBuffer()))
  await fs.mkdir(imagesDir, { recursive: true })

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        send(controller, { type: 'start', phase: 'loading', page: 0, total: 0 })
        const args = ['--pdf', pdfPath, '--out', outPath, '--dorder', '--images-dir', imagesDir, '--dpi', '130', '--workers', '4']
        if (detectOnly) args.push('--max-pages', '2')
        else args.push('--images-only')
        await runPython(args, (prog) => send(controller, { type: 'progress', ...prog }))

        const index = JSON.parse(await fs.readFile(outPath, 'utf-8')) as DorderIndexPayload
        const pages = index.pages || []
        const dorder = isDorderDocument(index)
        if (detectOnly) {
          send(controller, {
            type: 'done',
            detect: true,
            dorder,
            doc_type: index.doc_type || (dorder ? 'sashizu' : ''),
            cover: coverFromDorder({}, pages),
            parts: [],
          })
          return
        }

        send(controller, {
          type: 'progress',
          phase: 'map',
          page: pages.length,
          total: pages.length,
          label: 'ページ画像を用意しています…',
        })

        const persisted = persistMapImages(index, imagesDir)
        const mapPages = buildMapPages(index, persisted)
        const parts = partsFromMappedPages(mapPages)
        const cover = coverFromMappedPages(mapPages)
        const purchased = parts.filter((p) => p.kind === 'purchased' || p.source === 'purchased' || p.source === 'quote').length

        send(controller, {
          type: 'done',
          dorder: true,
          cover,
          parts,
          pages,
          drawings: index.drawings || {},
          map_pages: mapPages,
          summary: {
            total: parts.length,
            include_count: parts.filter((p) => p.include).length,
            purchased,
            drawings: parts.filter((p) => p.source === 'drawing').length,
          },
          warning:
            persisted.byPage.size === 0
              ? 'ページ画像を保存できませんでした。OCR枠のみ表示しています'
              : '枠を囲んでから「このページの枠を読み取る」を押してください',
        })
      } catch (e) {
        send(controller, {
          type: 'error',
          error: e instanceof Error ? e.message : '製作指図書の解析に失敗しました',
        })
      } finally {
        controller.close()
        fs.rm(tmp, { recursive: true, force: true }).catch(() => undefined)
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
    },
  })
}
