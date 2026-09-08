import { spawn } from 'child_process'
import fs from 'fs/promises'
import fsSync from 'fs'
import os from 'os'
import path from 'path'
import { parseEc25PdfBom, type Ec25PdfBomPayload } from '@/lib/ec25-drawing-bom'

export const runtime = 'nodejs'
export const maxDuration = 300

function send(controller: ReadableStreamDefaultController<Uint8Array>, obj: Record<string, unknown>) {
  controller.enqueue(new TextEncoder().encode(JSON.stringify(obj) + '\n'))
}

function parseProgressLine(line: string): Record<string, unknown> | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  if (trimmed.startsWith('PROGRESS ')) {
    try {
      return JSON.parse(trimmed.slice('PROGRESS '.length)) as Record<string, unknown>
    } catch {
      return null
    }
  }
  const m = trimmed.match(/OCR page\s+(\d+)\s*\/\s*(\d+)/i)
  if (m) return { phase: 'ocr', page: Number(m[1]), total: Number(m[2]) }
  return null
}

export async function POST(req: Request) {
  const form = await req.formData()
  const pdf = form.get('pdf') as File | null
  if (!pdf || pdf.size === 0) {
    return Response.json({ error: '部品表つきPDFが必要です' }, { status: 400 })
  }
  if (pdf.size > 80 * 1024 * 1024) {
    return Response.json({ error: 'PDFが大きすぎます（80MB以下）' }, { status: 400 })
  }

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ec25-pdf-bom-'))
  const pdfPath = path.join(tmp, 'drawings.pdf')
  const outPath = path.join(tmp, 'bom.json')
  await fs.writeFile(pdfPath, Buffer.from(await pdf.arrayBuffer()))

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      send(controller, { type: 'start', phase: 'loading', page: 0, total: 0 })
      const script = path.join(process.cwd(), 'scripts', 'ocr_ec2_parts_pdf.py')
      const child = spawn(
        'python',
        [
          script,
          '--pdf',
          pdfPath,
          '--out',
          outPath,
          '--max-pages',
          '12',
          '--stop-at-drawings',
          '--skip-screws',
        ],
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
        /* summary JSON is written to --out */
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
            const payload = JSON.parse(fsSync.readFileSync(outPath, 'utf-8')) as Ec25PdfBomPayload
            const parsed = parseEc25PdfBom(payload)
            send(controller, {
              type: 'done',
              cover: parsed.cover,
              parts: parsed.parts,
              summary: {
                total: parsed.parts.length,
                include_count: parsed.parts.filter((p) => p.include).length,
              },
            })
          } catch (e) {
            send(controller, {
              type: 'error',
              error: e instanceof Error ? e.message : '部品表JSONの解析に失敗しました',
            })
          }
        } else {
          send(controller, {
            type: 'error',
            error: `部品表OCR失敗 (code=${code}): ${stderr.slice(-1500)}`,
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
