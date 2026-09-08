import { NextResponse } from 'next/server'
import { spawn } from 'child_process'
import fs from 'fs/promises'
import fsSync from 'fs'
import os from 'os'
import path from 'path'
import { type Ec25ParsedPart } from '@/lib/ec25-drawing-bom'
import {
  asPdfIndex,
  lookupPdfPages,
  missingDrawingMessage,
  type Ec25PdfIndex,
} from '@/lib/ec25-drawing-match'
import { resolveDrawingAiConfig, unfoldPartWithAi, type UnfoldResult } from '@/lib/ec25-unfold'

export const runtime = 'nodejs'
export const maxDuration = 300

function runPythonRender(args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const script = path.join(process.cwd(), 'scripts', 'ocr_ec25_drawings.py')
    const child = spawn('python', [script, ...args], {
      cwd: process.cwd(),
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => {
      stdout += d.toString()
    })
    child.stderr.on('data', (d) => {
      stderr += d.toString()
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr })
      else reject(new Error(`図面レンダ失敗 (code=${code}): ${stderr.slice(-2000)}`))
    })
  })
}

function hydrateDrawingEnvFromLocalFile() {
  try {
    const file = path.join(process.cwd(), '.env.local')
    if (!fsSync.existsSync(file)) return
    const text = fsSync.readFileSync(file, 'utf8')
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim()
      if (!line || line.startsWith('#')) continue
      const i = line.indexOf('=')
      if (i <= 0) continue
      const key = line.slice(0, i).trim()
      if (
        ![
          'OPENAI_API_KEY',
          'ANTHROPIC_API_KEY',
          'DRAWING_AI_API_KEY',
          'DRAWING_AI_MODEL',
          'DRAWING_AI_PROVIDER',
          'DRAWING_AI_BASE_URL',
          'OPENAI_BASE_URL',
        ].includes(key)
      ) {
        continue
      }
      let value = line.slice(i + 1).trim()
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1)
      }
      if (value && !process.env[key]) process.env[key] = value
    }
  } catch {
    /* ignore */
  }
}

export async function GET() {
  hydrateDrawingEnvFromLocalFile()
  const cfg = resolveDrawingAiConfig()
  return NextResponse.json({
    configured: Boolean(cfg.provider && cfg.apiKey),
    provider: cfg.provider,
    model: cfg.model || null,
    has_key: Boolean(cfg.apiKey),
  })
}

export async function POST(req: Request) {
  try {
    hydrateDrawingEnvFromLocalFile()
    const cfg = resolveDrawingAiConfig()
    const form = await req.formData()
    const partsJson = form.get('parts_json') as string | null
    const pdf = form.get('pdf') as File | null
    const indexJson = form.get('index_json') as string | null
    const keysRaw = String(form.get('part_keys') || '')
    const maxParts = Math.min(40, Math.max(1, Number(form.get('max_parts') || 8)))

    if (!partsJson) {
      return NextResponse.json({ error: 'parts_json が必要です' }, { status: 400 })
    }
    let parts: Ec25ParsedPart[]
    try {
      parts = JSON.parse(partsJson) as Ec25ParsedPart[]
    } catch {
      return NextResponse.json({ error: 'parts_json が不正です' }, { status: 400 })
    }

    const wanted = new Set(
      keysRaw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    )
    const targets = parts
      .filter((p) => p.include && p.unfoldable)
      .filter((p) => (wanted.size ? wanted.has(p.part_key) : true))
      .slice(0, maxParts)

    if (targets.length === 0) {
      return NextResponse.json({ error: '展開対象の板金・形鋼がありません' }, { status: 400 })
    }

    let pdfIndex: Ec25PdfIndex = { drawings: {}, pages: [] }
    if (indexJson) {
      try {
        pdfIndex = asPdfIndex(JSON.parse(indexJson) as Ec25PdfIndex)
      } catch {
        return NextResponse.json({ error: 'index_json が不正です' }, { status: 400 })
      }
    }

    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ec25-unfold-'))
    const results: Record<string, UnfoldResult> = {}
    const errors: Record<string, string> = {}

    try {
      let pdfPath = ''
      if (pdf && pdf.size > 0) {
        pdfPath = path.join(tmp, 'drawings.pdf')
        await fs.writeFile(pdfPath, Buffer.from(await pdf.arrayBuffer()))
      }

      const imagesDir = path.join(tmp, 'pages')
      await fs.mkdir(imagesDir, { recursive: true })

      if (!pdfPath) {
        return NextResponse.json({ error: '展開には図面PDFが必要です' }, { status: 400 })
      }

      const hasIndex =
        Object.keys(pdfIndex.drawings || {}).length > 0 || (pdfIndex.pages || []).length > 0
      if (!hasIndex) {
        const outPath = path.join(tmp, 'index-out.json')
        await runPythonRender(['--pdf', pdfPath, '--out', outPath, '--dpi', '130', '--workers', '4'])
        pdfIndex = asPdfIndex(JSON.parse(await fs.readFile(outPath, 'utf-8')) as Ec25PdfIndex)
      }

      const partPages = new Map<string, number[]>()
      const neededPages: number[] = []
      for (const part of targets) {
        let pages = lookupPdfPages(part.drawing_no, part.part_key, part.part_name, pdfIndex)
        if (!pages.length) {
          const m = String(part.sheet || '').match(/p\.(\d+)/i)
          if (m) pages = [Number(m[1])]
        }
        partPages.set(part.part_key, pages)
        neededPages.push(...pages)
      }

      const uniquePages = [...new Set(neededPages)].sort((a, b) => a - b)
      let byPage = new Map<number, string>()
      if (uniquePages.length > 0) {
        const resultPath = path.join(tmp, 'render.json')
        await runPythonRender([
          '--pdf',
          pdfPath,
          '--images-dir',
          imagesDir,
          '--dpi',
          '160',
          '--render-pages',
          uniquePages.join(','),
          '--result-json',
          resultPath,
        ])
        try {
          const rendered = JSON.parse(await fs.readFile(resultPath, 'utf-8')) as {
            rendered?: { page: number; path: string }[]
          }
          byPage = new Map((rendered.rendered || []).map((x) => [x.page, x.path]))
        } catch (e) {
          return NextResponse.json(
            { error: `図面レンダ結果の解析に失敗: ${e instanceof Error ? e.message : e}` },
            { status: 500 }
          )
        }
      }

      for (const part of targets) {
        const pages = partPages.get(part.part_key) || []
        const imgPath = pages.map((p) => byPage.get(p)).find(Boolean)
        if (!imgPath) {
          errors[part.part_key] = missingDrawingMessage(part.drawing_no, part.part_name)
          continue
        }
        const buf = await fs.readFile(imgPath)
        if (!cfg.provider) {
          errors[part.part_key] =
            'Vision APIキー未設定（ANTHROPIC_API_KEY / OPENAI_API_KEY / DRAWING_AI_API_KEY）'
          continue
        }
        try {
          results[part.part_key] = await unfoldPartWithAi(part, buf.toString('base64'), 'image/png')
        } catch (e) {
          errors[part.part_key] = e instanceof Error ? e.message : 'AI展開失敗'
        }
      }
    } finally {
      try {
        await fs.rm(tmp, { recursive: true, force: true })
      } catch {
        /* ignore */
      }
    }

    return NextResponse.json({
      success: true,
      provider: cfg.provider,
      model: cfg.model || null,
      results,
      errors,
      drawing_pages: pdfIndex.drawings || {},
      pages: pdfIndex.pages || [],
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'AI展開に失敗しました'
    console.error('ec25-unfold', e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
