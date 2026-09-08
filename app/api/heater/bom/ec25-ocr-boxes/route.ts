import { spawn } from 'child_process'
import fs from 'fs/promises'
import fsSync from 'fs'
import os from 'os'
import path from 'path'
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const maxDuration = 120

function sessionDir(sid: string): string | null {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sid)) {
    return null
  }
  return path.join(os.tmpdir(), 'ec25-map-cache', sid)
}

function pageImage(dir: string, page: number): string | null {
  const stem = `page-${String(page).padStart(3, '0')}`
  return ['.jpg', '.jpeg', '.png'].map((ext) => path.join(dir, `${stem}${ext}`)).find((p) => fsSync.existsSync(p)) || null
}

function runPython(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const script = path.join(process.cwd(), 'scripts', 'ocr_ec25_drawings.py')
    const child = spawn('python', [script, ...args], {
      cwd: process.cwd(),
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString()
    })
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString()
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve(stdout)
      else reject(new Error(`枠OCR失敗 (code=${code}): ${stderr.slice(-800)}`))
    })
  })
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      sid?: string
      page?: number
      boxes?: Array<{ id?: string; x0?: number; y0?: number; x1?: number; y1?: number }>
    }
    const sid = String(body.sid || '')
    const page = Number(body.page || 0)
    const boxes = Array.isArray(body.boxes) ? body.boxes : []
    const dir = sessionDir(sid)
    if (!dir || !Number.isInteger(page) || page < 1 || boxes.length === 0) {
      return NextResponse.json({ error: 'sid / page / boxes が不正です' }, { status: 400 })
    }
    const image = pageImage(dir, page)
    if (!image) return NextResponse.json({ error: 'ページ画像がありません' }, { status: 404 })

    const kept = path.join(dir, `boxes-page-${String(page).padStart(3, '0')}.json`)
    await fs.writeFile(
      kept,
      JSON.stringify(
        boxes.map((b) => ({
          id: String(b.id || ''),
          x0: Number(b.x0 || 0),
          y0: Number(b.y0 || 0),
          x1: Number(b.x1 || 0),
          y1: Number(b.y1 || 0),
        }))
      ),
      'utf-8'
    )
    const stdout = await runPython(['--ocr-image', image, '--boxes-json', kept])
    const parsed = JSON.parse(stdout || '{}') as { boxes?: Array<{ id?: string; text?: string; conf?: number }> }
    return NextResponse.json({ boxes: parsed.boxes || [] })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : '枠の読み取りに失敗しました' }, { status: 500 })
  }
}
