import { spawn } from 'child_process'
import fs from 'fs/promises'
import fsSync from 'fs'
import os from 'os'
import path from 'path'
import {
  DORDER_AI_SYSTEM,
  dorderAiUserPrompt,
  mergeAiExtracts,
  type DorderAiExtract,
  type DorderIndexPayload,
} from '@/lib/ec25-dorder-extract'
import {
  isPurchaseListExcelName,
  isPurchaseListPdfName,
  mergePurchaseParts,
  parsePurchaseListExcel,
  partsFromPurchaseAi,
  partsFromPurchaseOcr,
  dorderExtractFromUnknown,
} from '@/lib/ec25-purchase-list'
import { callDrawingVisionJson, parseVisionJsonObject, resolveDrawingAiConfig } from '@/lib/ec25-unfold'

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
      else reject(new Error(`購入品PDFのOCR失敗 (code=${code}): ${stderr.slice(-1500)}`))
    })
  })
}

async function extractPurchaseWithVision(index: DorderIndexPayload): Promise<{ parts: ReturnType<typeof partsFromPurchaseAi>; warning?: string }> {
  const cfg = resolveDrawingAiConfig()
  if (!cfg.provider) {
    return { parts: [], warning: 'Vision未設定のためOCR結果のみです' }
  }
  const want = new Set(
    (index.pages || [])
      .filter((p) => ['purchase_list', 'quote', 'detail', 'document'].includes(String(p.page_kind || '')))
      .map((p) => p.page)
  )
  const images = (index.rendered || []).filter((r) => r.path && fsSync.existsSync(r.path) && (want.size === 0 || want.has(r.page)))
  const targets = images.length ? images : (index.rendered || []).filter((r) => r.path && fsSync.existsSync(r.path))
  if (targets.length === 0) return { parts: [] }

  const chunks: DorderAiExtract[] = []
  const batch = 3
  for (let i = 0; i < targets.length; i += batch) {
    const slice = targets.slice(i, i + batch)
    const imgs = await Promise.all(
      slice.map(async (r) => ({
        base64: (await fs.readFile(r.path)).toString('base64'),
        mime: r.path.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg',
      }))
    )
    const labels = slice.map((r) => `p.${r.page}`)
    const text = await callDrawingVisionJson(DORDER_AI_SYSTEM, dorderAiUserPrompt(labels), imgs, 4000)
    const parsed = parseVisionJsonObject(text)
    if (parsed) chunks.push(dorderExtractFromUnknown(parsed))
  }
  return { parts: partsFromPurchaseAi(mergeAiExtracts(chunks)) }
}

export async function POST(req: Request) {
  const form = await req.formData()
  const file = (form.get('file') || form.get('excel') || form.get('pdf')) as File | null
  if (!file || file.size === 0) {
    return Response.json({ error: '購入品一覧の Excel または PDF を選択してください' }, { status: 400 })
  }
  const name = file.name || ''
  if (isPurchaseListExcelName(name) || /sheet|excel/i.test(file.type || '')) {
    if (file.size > 25 * 1024 * 1024) {
      return Response.json({ error: 'Excelが大きすぎます（25MB以下）' }, { status: 400 })
    }
    try {
      const parts = parsePurchaseListExcel(Buffer.from(await file.arrayBuffer()))
      if (parts.length === 0) {
        return Response.json({ error: '購入品の表（部品名称・型式・個数など）が見つかりません' }, { status: 400 })
      }
      return Response.json({
        source: 'excel',
        parts,
        summary: { purchased: parts.length, total: parts.length },
      })
    } catch (e) {
      return Response.json({ error: e instanceof Error ? e.message : 'Excelの解析に失敗しました' }, { status: 500 })
    }
  }

  if (!isPurchaseListPdfName(name) && file.type !== 'application/pdf') {
    return Response.json({ error: '購入品一覧は Excel（.xls / .xlsx）または PDF です' }, { status: 400 })
  }
  if (file.size > 80 * 1024 * 1024) {
    return Response.json({ error: 'PDFが大きすぎます（80MB以下）' }, { status: 400 })
  }

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ec25-buy-'))
  const pdfPath = path.join(tmp, 'purchase.pdf')
  const outPath = path.join(tmp, 'index.json')
  const imagesDir = path.join(tmp, 'docs')
  await fs.writeFile(pdfPath, Buffer.from(await file.arrayBuffer()))
  await fs.mkdir(imagesDir, { recursive: true })

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        send(controller, { type: 'start', phase: 'loading', page: 0, total: 0 })
        await runPython(
          ['--pdf', pdfPath, '--out', outPath, '--dorder', '--images-dir', imagesDir, '--dpi', '130', '--workers', '4'],
          (prog) => send(controller, { type: 'progress', ...prog })
        )
        const index = JSON.parse(await fs.readFile(outPath, 'utf-8')) as DorderIndexPayload
        send(controller, { type: 'progress', phase: 'map', label: '購入品の表を読み取っています…', page: index.pages?.length || 0, total: index.pages?.length || 0 })
        let parts = partsFromPurchaseOcr(index)
        let warning = ''
        if (parts.length < 3) {
          send(controller, { type: 'progress', phase: 'ai', label: '購入品表をAIで補完しています…', page: 0, total: 1, percent: 70 })
          try {
            const ai = await extractPurchaseWithVision(index)
            parts = mergePurchaseParts(parts, ai.parts)
            if (ai.warning) warning = ai.warning
          } catch (e) {
            warning = e instanceof Error ? e.message : 'AI補完に失敗しました'
          }
        }
        if (parts.length === 0) {
          send(controller, { type: 'error', error: warning || '購入品の行を読み取れませんでした' })
          return
        }
        send(controller, {
          type: 'done',
          source: 'pdf',
          parts,
          warning: warning || undefined,
          summary: { purchased: parts.length, total: parts.length, pages: index.pages?.length || 0 },
        })
      } catch (e) {
        send(controller, { type: 'error', error: e instanceof Error ? e.message : '購入品PDFの解析に失敗しました' })
      } finally {
        controller.close()
        try {
          await fs.rm(tmp, { recursive: true, force: true })
        } catch {
          /* ignore */
        }
      }
    },
  })

  return new Response(stream, {
    headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache' },
  })
}
