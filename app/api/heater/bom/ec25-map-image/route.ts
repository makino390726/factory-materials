import fs from 'fs/promises'
import fsSync from 'fs'
import os from 'os'
import path from 'path'

export const runtime = 'nodejs'

function sessionDir(sid: string): string | null {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sid)) {
    return null
  }
  return path.join(os.tmpdir(), 'ec25-map-cache', sid)
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const sid = String(url.searchParams.get('sid') || '')
  const page = Number(url.searchParams.get('p') || 0)
  const dir = sessionDir(sid)
  if (!dir || !Number.isInteger(page) || page < 1 || page > 999) {
    return new Response('invalid', { status: 400 })
  }
  const kind = String(url.searchParams.get('kind') || 'page')
  const stem = `${kind === 'title' ? 'title' : 'page'}-${String(page).padStart(3, '0')}`
  const jpg = path.join(dir, `${stem}.jpg`)
  const jpeg = path.join(dir, `${stem}.jpeg`)
  const png = path.join(dir, `${stem}.png`)
  const file = [jpg, jpeg, png].find((p) => fsSync.existsSync(p))
  if (!file) return new Response('not found', { status: 404 })
  const buf = await fs.readFile(file)
  const mime = file.endsWith('.png') ? 'image/png' : 'image/jpeg'
  return new Response(buf, {
    headers: {
      'Content-Type': mime,
      'Cache-Control': 'private, max-age=3600',
    },
  })
}
