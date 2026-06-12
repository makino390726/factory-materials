/**
 * 環境負荷低減型乾燥機 EC30 図番管理表（.xls）用パーサー。
 * シート「2」「3」: 図面番号・部品名・発生機・2坪・0.5坪・1坪列
 * シート「ビス類」: 部品名称・発生機(組立/梱包)・2坪・0.5坪・1坪
 */

import * as XLSX from 'xlsx'

export type Ec30ParsedRow = {
  sheet: string
  drawing_no: string
  part_name: string
  /** 2坪構成の数量 = 発生機 + 2坪列の合算イメージ */
  qty_2tsubo: number
  qty_25tsubo: number
  qty_3tsubo: number
}

const WS = /[\s\u3000]+/g

function compactCell(v: unknown): string {
  return String(v ?? '')
    .replace(/\u3000/g, '')
    .replace(WS, '')
}

function normalizeDrawing(raw: string): string {
  let s = String(raw ?? '')
    .replace(/\u3000/g, ' ')
    .replace(/\s*-\s*/g, '-')
    .replace(/\s+/g, '')
    .trim()
  s = s.replace(/^〃$/, '')
  return s
}

/** 数量セル: 数値・「1式」・空白を解釈 */
export function parseQtyCell(v: unknown): number {
  if (v === null || v === undefined) return 0
  if (typeof v === 'number' && Number.isFinite(v)) return Math.max(0, v)
  const t = String(v).trim()
  if (!t || t === '〃' || t === '　') return 0
  if (/式/.test(t)) {
    const m = t.match(/(\d+(?:\.\d+)?)/)
    return m ? Math.max(0, parseFloat(m[1])) : 1
  }
  const cleaned = t.replace(/,/g, '')
  const m = cleaned.match(/^-?(\d+(?:\.\d+)?)/)
  if (m) return Math.max(0, parseFloat(m[1]))
  return 0
}

type StandardHeader = {
  rowIndex: number
  colDrawing: number[]
  colPartName: number
  colH: number
  colJ2: number
  colK05: number
  colL1: number
}

function findStandardHeader(matrix: unknown[][]): StandardHeader | null {
  for (let r = 0; r < Math.min(40, matrix.length); r++) {
    const row = matrix[r] || []
    const labels = row.map((c) => compactCell(c))
    const idxPart = labels.findIndex((x) => x.includes('部品名'))
    const idxH = labels.findIndex((x) => x === '発生機' || x.includes('発生機'))
    const idxJ = labels.findIndex((x) => x === '2坪' || x.endsWith('2坪'))
    const idxK = labels.findIndex((x) => x.includes('0.5坪'))
    const idxL = labels.findIndex((x) => x === '1坪' || (x.includes('1坪') && !x.includes('0.5')))
    if (idxPart < 0 || idxH < 0 || idxJ < 0 || idxK < 0 || idxL < 0) continue
    const idxDraw = Math.max(0, idxPart - 2)
    return {
      rowIndex: r,
      colDrawing: [idxDraw, idxDraw + 1],
      colPartName: idxPart,
      colH: idxH,
      colJ2: idxJ,
      colK05: idxK,
      colL1: idxL,
    }
  }
  return null
}

function parseStandardSheet(sheetName: string, matrix: unknown[][]): Ec30ParsedRow[] {
  const header = findStandardHeader(matrix)
  if (!header) return []

  const out: Ec30ParsedRow[] = []
  let lastDrawing = ''

  for (let r = header.rowIndex + 1; r < matrix.length; r++) {
    const row = matrix[r] || []
    const rawDraw1 = String(row[header.colDrawing[0]] ?? '').trim()
    const rawDraw2 = String(row[header.colDrawing[1]] ?? '').trim()
    let drawing = normalizeDrawing(`${rawDraw1} ${rawDraw2}`.trim())
    if (drawing === '〃' || !drawing) {
      drawing = lastDrawing
    } else {
      lastDrawing = drawing
    }

    const partName = String(row[header.colPartName] ?? '')
      .replace(/\u3000/g, ' ')
      .trim()
    if (!partName) continue
    if (compactCell(partName).includes('構成部品表')) continue

    const h = parseQtyCell(row[header.colH])
    const j2 = parseQtyCell(row[header.colJ2])
    const k05 = parseQtyCell(row[header.colK05])
    const l1 = parseQtyCell(row[header.colL1])

    const qty2 = h + j2
    const qty25 = h + j2 + k05
    const qty3 = h + j2 + l1

    if (qty2 === 0 && qty25 === 0 && qty3 === 0) continue

    out.push({
      sheet: sheetName,
      drawing_no: drawing,
      part_name: partName,
      qty_2tsubo: qty2,
      qty_25tsubo: qty25,
      qty_3tsubo: qty3,
    })
  }

  return out
}

type BisHeader = {
  rowIndex: number
  colPart: number
  colAsm: number
  colPack: number
  colJ2: number
  colK05: number
  colL1: number
}

function findBisHeader(matrix: unknown[][]): BisHeader | null {
  for (let r = 0; r < Math.min(25, matrix.length); r++) {
    const row = matrix[r] || []
    const labels = row.map((c) => compactCell(c))
    const idxPart = labels.findIndex((x) => x.includes('部品名称') || x === '部品名')
    const idxAsm = labels.findIndex((x) => x.includes('発生機') && x.includes('組立'))
    const idxPack = labels.findIndex((x) => x.includes('発生機') && x.includes('梱包'))
    const idxJ = labels.findIndex((x) => x === '2坪')
    const idxK = labels.findIndex((x) => x.includes('0.5坪'))
    const idxL = labels.findIndex((x) => x === '1坪' || (x.includes('1坪') && !x.includes('0.5')))
    if (idxPart < 0 || idxAsm < 0 || idxJ < 0 || idxK < 0 || idxL < 0) continue
    const pack = idxPack >= 0 ? idxPack : idxAsm
    return {
      rowIndex: r,
      colPart: idxPart,
      colAsm: idxAsm,
      colPack: pack,
      colJ2: idxJ,
      colK05: idxK,
      colL1: idxL,
    }
  }
  return null
}

function parseBisSheet(sheetName: string, matrix: unknown[][]): Ec30ParsedRow[] {
  const header = findBisHeader(matrix)
  if (!header) return []

  const out: Ec30ParsedRow[] = []
  for (let r = header.rowIndex + 1; r < matrix.length; r++) {
    const row = matrix[r] || []
    const partName = String(row[header.colPart] ?? '')
      .replace(/\u3000/g, ' ')
      .trim()
    if (!partName) continue

    const h1 = parseQtyCell(row[header.colAsm])
    const h2 = parseQtyCell(row[header.colPack])
    const h = h1 + h2
    const j2 = parseQtyCell(row[header.colJ2])
    const k05 = parseQtyCell(row[header.colK05])
    const l1 = parseQtyCell(row[header.colL1])

    const qty2 = h + j2
    const qty25 = h + j2 + k05
    const qty3 = h + j2 + l1

    if (qty2 === 0 && qty25 === 0 && qty3 === 0) continue

    const slug = partName
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80)
    const drawing = `EC30-BIS-${slug || r}`

    out.push({
      sheet: sheetName,
      drawing_no: drawing,
      part_name: partName,
      qty_2tsubo: qty2,
      qty_25tsubo: qty25,
      qty_3tsubo: qty3,
    })
  }
  return out
}

const DEFAULT_SHEETS_STANDARD = ['2', '3', '1']
const SHEET_BIS = 'ビス類'

export function parseEc30BomWorkbook(buffer: Buffer): Ec30ParsedRow[] {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true })
  const rows: Ec30ParsedRow[] = []

  for (const name of wb.SheetNames) {
    const sh = wb.Sheets[name]
    if (!sh) continue
    const matrix = XLSX.utils.sheet_to_json(sh, {
      header: 1,
      defval: '',
    }) as unknown[][]

    if (name === SHEET_BIS) {
      rows.push(...parseBisSheet(name, matrix))
      continue
    }
    if (name === '表紙') continue
    if (DEFAULT_SHEETS_STANDARD.includes(name) || /^\d+$/.test(name)) {
      const parsed = parseStandardSheet(name, matrix)
      if (parsed.length) rows.push(...parsed)
    }
  }

  return rows
}

/** 同一部品キー（図番）で数量を合算 */
export type Ec30MergedPart = {
  part_name: string
  drawing_no: string
  qty_2tsubo: number
  qty_25tsubo: number
  qty_3tsubo: number
  sheets: string
}

export function mergeEc30RowsByPartKey(
  rows: Ec30ParsedRow[],
  partKeyOf: (r: Ec30ParsedRow) => string
): Map<string, Ec30MergedPart> {
  const map = new Map<string, Ec30MergedPart>()

  for (const r of rows) {
    const key = partKeyOf(r)
    const cur = map.get(key)
    if (!cur) {
      map.set(key, {
        part_name: r.part_name,
        drawing_no: r.drawing_no,
        qty_2tsubo: r.qty_2tsubo,
        qty_25tsubo: r.qty_25tsubo,
        qty_3tsubo: r.qty_3tsubo,
        sheets: r.sheet,
      })
    } else {
      cur.part_name = cur.part_name || r.part_name
      cur.qty_2tsubo += r.qty_2tsubo
      cur.qty_25tsubo += r.qty_25tsubo
      cur.qty_3tsubo += r.qty_3tsubo
      if (!cur.sheets.includes(r.sheet)) cur.sheets += `,${r.sheet}`
    }
  }
  return map
}

export function drawingToPartKey(drawing: string): string {
  const d = normalizeDrawing(drawing)
  if (!d) return ''
  return d.toUpperCase()
}
