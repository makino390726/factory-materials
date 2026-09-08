import { spawn } from 'child_process'
import crypto from 'crypto'
import fs from 'fs/promises'
import fsSync from 'fs'
import os from 'os'
import path from 'path'

export const runtime = 'nodejs'
export const maxDuration = 300

const INDEX_CACHE_VER = 'ec25-index-v2-rapid-clip'

type IndexPayload = {
  drawings?: Record<string, number[]>
  by_name?: Record<string, number[]>
  pages?: { page: number; drawing_no?: string; part_name?: string; model_name?: string }[]
  page_count?: number
  indexed_pages?: number
}

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

function cacheFileFor(buf: Buffer, filename: string) {
  const h = crypto.createHash('sha1')
  h.update(INDEX_CACHE_VER)
  h.update(filename)
  h.update(String(buf.length))
  h.update(buf.subarray(0, Math.min(buf.length, 65536)))
  if (buf.length > 65536) h.update(buf.subarray(buf.length - 65536))
  return path.join(os.tmpdir(), 'ec25-index-cache', `${h.digest('hex')}.json`)
}

function sendDone(controller: ReadableStreamDefaultController<Uint8Array>, idx: IndexPayload) {
  send(controller, {
    type: 'done',
    drawings: idx.drawings || {},
    by_name: idx.by_name || {},
    pages: idx.pages || [],
    page_count: idx.page_count || 0,
    indexed_pages: idx.indexed_pages || 0,
  })
}

export async function POST(req: Request) {
  const form = await req.formData()
  const pdf = form.get('pdf') as File | null
  if (!pdf || pdf.size === 0) {
    return Response.json({ error: '図面PDFが必要です' }, { status: 400 })
  }
  if (pdf.size > 80 * 1024 * 1024) {
    return Response.json({ error: 'PDFが大きすぎます（80MB以下）' }, { status: 400 })
  }

  const buf = Buffer.from(await pdf.arrayBuffer())
  const cachePath = cacheFileFor(buf, pdf.name || 'drawings.pdf')
  if (fsSync.existsSync(cachePath)) {
    try {
      const idx = JSON.parse(fsSync.readFileSync(cachePath, 'utf-8')) as IndexPayload
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          send(controller, {
            type: 'start',
            phase: 'ocr',
            page: idx.indexed_pages || 0,
            total: idx.indexed_pages || 0,
            cached: true,
          })
          sendDone(controller, idx)
          controller.close()
        },
      })
      return new Response(stream, {
        headers: {
          'Content-Type': 'application/x-ndjson; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
        },
      })
    } catch {
      /* rebuild */
    }
  }

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ec25-index-'))
  const pdfPath = path.join(tmp, 'drawings.pdf')
  const outPath = path.join(tmp, 'index.json')
  await fs.writeFile(pdfPath, buf)

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      send(controller, { type: 'start', phase: 'loading', page: 0, total: 0 })
      const script = path.join(process.cwd(), 'scripts', 'ocr_ec25_drawings.py')
      const child = spawn(
        'python',
        [script, '--pdf', pdfPath, '--out', outPath, '--dpi', '130', '--workers', '4'],
        {
          cwd: process.cwd(),
          env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
        }
      )
      let stderr = ''
      let leftover = ''
      const onChunk = (d: Buffer) => {
        const text = leftover + d.toString()
        const lines = text.split(/\r?\n/)
        leftover = lines.pop() || ''
        for (const line of lines) {
          stderr += line + '\n'
          const prog = parseProgressLine(line)
          if (prog) send(controller, { type: 'progress', ...prog })
        }
      }
      child.stderr.on('data', onChunk)
      child.stdout.on('data', () => {
        /* final JSON is written to --out */
      })
      child.on('error', (e) => {
        send(controller, { type: 'error', error: e.message })
        controller.close()
        fs.rm(tmp, { recursive: true, force: true }).catch(() => undefined)
      })
      child.on('close', (code) => {
        if (leftover) {
          const prog = parseProgressLine(leftover)
          if (prog) send(controller, { type: 'progress', ...prog })
        }
        if (code === 0 && fsSync.existsSync(outPath)) {
          try {
            const idx = JSON.parse(fsSync.readFileSync(outPath, 'utf-8')) as IndexPayload
            try {
              fsSync.mkdirSync(path.dirname(cachePath), { recursive: true })
              fsSync.copyFileSync(outPath, cachePath)
            } catch {
              /* cache is optional */
            }
            sendDone(controller, idx)
          } catch (e) {
            send(controller, {
              type: 'error',
              error: e instanceof Error ? e.message : '索引JSONの解析に失敗しました',
            })
          }
        } else {
          send(controller, {
            type: 'error',
            error: `図面OCR失敗 (code=${code}): ${stderr.slice(-1500)}`,
          })
        }
        controller.close()
        fs.rm(tmp, { recursive: true, force: true }).catch(() => undefined)
      })
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
    },
  })
}
