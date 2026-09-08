/**
 * EC2/EC25 図番管理表（.xls）パーサー。
 * 表紙: 品名=機種名、型式=型式。図面番号=パーツキー、部品名=パーツ名。
 * 材質は原価構成要素の照合キー。員数は発生機＋乾燥室。
 */

import * as XLSX from 'xlsx'

export type Ec25PartKind = 'sheet' | 'profile' | 'purchased' | 'assembly' | 'fastener'

export type Ec25QtyUnit = 'pcs' | 'm' | 'm2' | 'set'

export type Ec25OrderLine = {
  id: string
  order_no: string
  product_name: string
  qty: number
  unit: string
  note: string
}

export type Ec25CoverMeta = {
  product_name: string
  model_type: string
  created_on: string
  owner: string
  order_no?: string
  qty?: number
  orders?: Ec25OrderLine[]
}

export type Ec25MaterialToken = {
  raw: string
  family: string
  thickness_mm: number | null
  shape: string
  keywords: string[]
  qty?: number | null
  drawing_spec?: boolean
}

export function drawingSpecMaterial(part: {
  materials?: Ec25MaterialToken[]
  material_raw?: string
}): Ec25MaterialToken | null {
  const list = part.materials || []
  return list.find((m) => m.drawing_spec) || list[0] || (part.material_raw ? { raw: part.material_raw, family: '', thickness_mm: null, shape: '', keywords: [], drawing_spec: true } : null)
}

export type Ec25FastenerUse = {
  name: string
  qty: number
  unit: Ec25QtyUnit
  col: number
}

export type Ec25ParsedPart = {
  sheet: string
  size: string
  drawing_no: string
  drawing_raw: string
  part_key: string
  part_name: string
  material_raw: string
  materials: Ec25MaterialToken[]
  fasteners: Ec25FastenerUse[]
  qty_generator: number
  qty_chamber: number
  qty_pieces: number
  qty_unit: Ec25QtyUnit
  qty_raw: string
  note: string
  kind: Ec25PartKind
  include: boolean
  unfoldable: boolean
  quoted_unit_price?: number | null
  supplier?: string
  source?: 'excel' | 'pdf_bom' | 'drawing' | 'purchased' | 'quote' | 'detail'
}

export type Ec25WorkbookParse = {
  cover: Ec25CoverMeta
  parts: Ec25ParsedPart[]
}

const WS = /[\s\u3000]+/g

export function compactCell(v: unknown): string {
  return String(v ?? '')
    .replace(/\u3000/g, '')
    .replace(WS, '')
}

export function cellText(v: unknown): string {
  return String(v ?? '')
    .replace(/\u3000/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function normalizeDrawingNo(raw: string): string {
  let s = String(raw ?? '')
    .toUpperCase()
    .replace(/\u3000/g, ' ')
    .trim()
  if (!s || s === '〃') return ''
  s = s.replace(/[一–—ー]/g, '-')
  s = s.replace(/SKIO/g, 'SK10').replace(/SK1O/g, 'SK10').replace(/SKI0/g, 'SK10').replace(/SKL0/g, 'SK10')
  s = s.replace(/\s*-\s*/g, '-').replace(/\s+/g, '')
  return s
}

export function drawingToPartKey(drawing: string): string {
  const d = normalizeDrawingNo(drawing)
  return d
}

const MATERIAL_FAMILIES: { family: string; aliases: string[] }[] = [
  { family: 'ZAM', aliases: ['zam', 'ザム'] },
  { family: 'SPHC', aliases: ['sphc'] },
  { family: 'SECC', aliases: ['secc'] },
  { family: 'カラー鋼板', aliases: ['カラー鋼板', 'カラー'] },
  { family: 'グラスウール', aliases: ['グラスウール', 'ガラス綿', 'gw'] },
  { family: 'ウレタンボード', aliases: ['ウレタンボード', '発泡ウレタン', 'ウレタン'] },
  { family: '石膏ボード', aliases: ['石膏ボード', '石膏'] },
  { family: 'アルミ', aliases: ['アルミ', 'al ', 'al　', 'all', 'alfb', 'al fb'] },
  { family: 'アングル', aliases: ['l30', 'l40', 'l50'] },
  { family: '角パイプ', aliases: ['□', '角パイプ'] },
  { family: 'SGP', aliases: ['sgp'] },
  { family: 'ステンレス', aliases: ['sus', 'ステンレス'] },
]

export function splitMaterialRaw(raw: string): string[] {
  const src = cellText(raw)
  if (!src || src === '-' || src === '〃') return []
  let s = src.replace(/[、，]/g, ',')
  const splitBefore = [
    'ZAM',
    'SPHC',
    'SGCC',
    'カラー鋼板',
    'グラスウール',
    'ウレタンボード',
    '石膏ボード',
    '発泡ウレタン',
    'ウレタン',
  ]
  for (const token of splitBefore) {
    const re = new RegExp(`(?<![,\\s])(${token})`, 'g')
    s = s.replace(re, ',$1')
  }
  return s
    .split(',')
    .map((x) => x.trim())
    .filter((x) => x && x !== '-' && x !== '〃')
}

export function parseMaterialToken(raw: string): Ec25MaterialToken {
  const text = cellText(raw)
  const compact = compactCell(text).toLowerCase()
  let family = ''
  for (const row of MATERIAL_FAMILIES) {
    if (row.aliases.some((a) => compact.includes(a.replace(/\s+/g, '')))) {
      family = row.family
      break
    }
  }
  if (!family && /組立図|組図|assy|外形図|購入|加工図/i.test(text)) family = ''
  const thick = text.match(/t\s*(\d+(?:\.\d+)?)/i)
  const shape =
    text.match(/[LＬ]\s*\d+\s*[×xX]\s*\d+(?:\s*[×xX]\s*t?\s*\d+(?:\.\d+)?)?/)?.[0] ||
    text.match(/[□]\s*\d+\s*[×xX]\s*\d+(?:\s*[×xX]\s*t?\s*\d+(?:\.\d+)?)?/)?.[0] ||
    text.match(/FB\s*\d+\s*[×xX]\s*\d+/i)?.[0] ||
    text.match(/SGP\s*\d+A/i)?.[0] ||
    ''
  const keywords = [family, shape, thick ? `t${thick[1]}` : '']
    .map((x) => compactCell(x).toLowerCase())
    .filter(Boolean)
  return {
    raw: text,
    family,
    thickness_mm: thick ? Number(thick[1]) : null,
    shape: shape.replace(/\s+/g, ''),
    keywords,
  }
}

function isDitto(v: unknown): boolean {
  const t = cellText(v)
  return t === '〃' || t === '"' || t === '”'
}

export function parseQtyExpression(raw: unknown): { qty: number; unit: Ec25QtyUnit; ditto: boolean } {
  if (raw === null || raw === undefined || raw === '') {
    return { qty: 0, unit: 'pcs', ditto: false }
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return { qty: Math.max(0, raw), unit: 'pcs', ditto: false }
  }
  const original = cellText(raw)
  if (!original) return { qty: 0, unit: 'pcs', ditto: false }
  if (isDitto(original)) return { qty: 0, unit: 'pcs', ditto: true }

  const t = original.replace(/[\s\u3000]/g, '')
  const meterOnly = t.match(/^(\d+(?:\.\d+)?)m(?:$|[^2²\d])/i) || t.match(/^(\d+(?:\.\d+)?)m$/)
  if (meterOnly && !/[個枚式番]/.test(t)) {
    return { qty: Number(meterOnly[1]), unit: 'm', ditto: false }
  }

  const kaku = t.match(/^各(\d+(?:\.\d+)?)/)
  if (kaku) return { qty: Number(kaku[1]), unit: 'pcs', ditto: false }

  const lrPlain = t.match(/^(\d+)L[\/,](\d+)R$/i)
  if (lrPlain) return { qty: Number(lrPlain[1]) + Number(lrPlain[2]), unit: 'pcs', ditto: false }

  const abLr = t.match(/^([A-Za-z]{1,6})\((\d+)L[,\/](\d+)R\)$/i)
  if (abLr) {
    return { qty: abLr[1].length * (Number(abLr[2]) + Number(abLr[3])), unit: 'pcs', ditto: false }
  }

  if (/[①-⑳]/.test(t)) {
    let sum = 0
    const re = /[①-⑳](\d+(?:\.\d+)?)(?:個|枚)?/g
    let m: RegExpExecArray | null
    while ((m = re.exec(t))) sum += Number(m[1])
    if (sum > 0) return { qty: sum, unit: 'pcs', ditto: false }
  }

  const letterKo = [...t.matchAll(/[A-Za-z](\d+)個/g)]
  if (letterKo.length) {
    return { qty: letterKo.reduce((s, m) => s + Number(m[1]), 0), unit: 'pcs', ditto: false }
  }

  const banParen = [...t.matchAll(/(\d+)番[（(](\d+)枚[)）]/g)]
  if (banParen.length) {
    return { qty: banParen.reduce((s, m) => s + Number(m[2]), 0), unit: 'pcs', ditto: false }
  }
  const banOne = t.match(/^\d+番(\d+)枚$/)
  if (banOne) return { qty: Number(banOne[1]), unit: 'pcs', ditto: false }

  if (/[上下左右枠]/.test(t)) {
    const nums = [...t.matchAll(/(\d+(?:\.\d+)?)/g)]
    if (nums.length) return { qty: nums.reduce((s, m) => s + Number(m[1]), 0), unit: 'pcs', ditto: false }
  }

  if (/[LR]/i.test(t) && /[A-Z]/i.test(t)) {
    let sum = 0
    for (const m of t.matchAll(/(\d+)L/gi)) sum += Number(m[1])
    for (const m of t.matchAll(/(\d+)R/gi)) sum += Number(m[1])
    for (const m of t.matchAll(/(?<![0-9])([A-KQ-Z])(\d+)/gi)) sum += Number(m[2])
    if (sum > 0) return { qty: sum, unit: 'pcs', ditto: false }
  }

  if (/式/.test(t)) {
    const n = t.match(/(\d+(?:\.\d+)?)/)
    return { qty: n ? Number(n[1]) : 1, unit: 'set', ditto: false }
  }

  if (/^\d+(?:\.\d+)?$/.test(t)) return { qty: Number(t), unit: 'pcs', ditto: false }

  const first = t.match(/(\d+(?:\.\d+)?)/)
  return { qty: first ? Number(first[1]) : 0, unit: 'pcs', ditto: false }
}

export function classifyKind(partName: string, materialRaw: string, drawingNo: string, sheet: string): Ec25PartKind {
  if (sheet === 'ビス類') return 'fastener'
  const blob = `${partName} ${materialRaw} ${sheet}`
  if (/外形図|組立図|組図|assy/i.test(blob)) return 'assembly'
  if (/購入品/.test(materialRaw) || /購入品/.test(partName) || /購入部品/.test(sheet) || /見積/.test(sheet)) {
    return 'purchased'
  }
  if (/[LＬ]\s*\d+\s*[×xX]|[□]|FB\s*\d+|SGP|チャンネル|アングル/i.test(materialRaw)) return 'profile'
  if (/ZAM|SPHC|SGCC|SECC|カラー鋼板|鋼板/i.test(materialRaw)) return 'sheet'
  if (drawingNo) return 'sheet'
  return 'purchased'
}

function parseFastenerQty(raw: unknown): { qty: number; unit: Ec25QtyUnit } {
  if (raw === null || raw === undefined || raw === '') return { qty: 0, unit: 'pcs' }
  if (typeof raw === 'number' && Number.isFinite(raw)) return { qty: Math.max(0, raw), unit: 'pcs' }
  const original = cellText(raw)
  if (!original || original === '　') return { qty: 0, unit: 'pcs' }
  const t = original.replace(/[\s\u3000]/g, '')
  const letterNums = [...t.matchAll(/[A-Za-z](\d+(?:\.\d+)?)/g)]
  if (letterNums.length >= 2 && !/[個枚式]/.test(t)) {
    return { qty: letterNums.reduce((s, m) => s + Number(m[1]), 0), unit: 'pcs' }
  }
  return parseQtyExpression(raw)
}

function isFastenerSizeToken(s: string): boolean {
  const c = compactCell(s)
  return /^M\d+(?:\.\d+)?[×xX]\d+/.test(c)
}

function isFastenerTypeName(s: string): boolean {
  return /セムス|テクス|ボルト|タッピング|リベット|ビス|パッキン|アンカー/.test(s) && !isFastenerSizeToken(s)
}

function collectFastenerHeaders(
  matrix: unknown[][],
  headerRow: number,
  startCol: number
): { col: number; name: string }[] {
  const out: { col: number; name: string }[] = []
  let group = ''
  const header = matrix[headerRow] || []
  const above = headerRow > 0 ? matrix[headerRow - 1] || [] : []
  const maxCol = Math.max(header.length, above.length)
  for (let c = startCol; c < maxCol; c++) {
    const top = cellText(above[c])
    const here = cellText(header[c])
    if (top && isFastenerTypeName(top)) group = top
    else if (top && !isFastenerSizeToken(top)) group = ''
    let name = here || top
    if (here && group && isFastenerSizeToken(here)) {
      name = `${group}(${here})`
    }
    if (!name || /^(工場|現場|工場黒|現場赤)$/.test(compactCell(name))) continue
    out.push({ col: c, name })
  }
  return out
}

function findHeader(matrix: unknown[][]): {
  rowIndex: number
  colSize: number
  colDrawing: number
  colPart: number
  colMaterial: number
  colGen: number
  colChamber: number
  colNote: number
} | null {
  for (let r = 0; r < Math.min(20, matrix.length); r++) {
    const labels = (matrix[r] || []).map((c) => compactCell(c))
    const idxPart = labels.findIndex((x) => x.includes('部品名'))
    const idxDraw = labels.findIndex((x) => x.includes('図面番号') || x.includes('図番'))
    if (idxPart < 0) continue
    const idxMat = labels.findIndex((x) => x.includes('材質'))
    const idxGen = labels.findIndex((x) => x.includes('発生機'))
    const idxCh = labels.findIndex((x) => x.includes('乾燥室') || x.includes('2.5坪') || x.includes('２．５坪'))
    const idxNote = labels.findIndex((x) => x.includes('備考'))
    const idxSize = labels.findIndex((x) => x.includes('サイズ'))
    return {
      rowIndex: r,
      colSize: idxSize >= 0 ? idxSize : 0,
      colDrawing: idxDraw >= 0 ? idxDraw : Math.max(0, idxPart - 2),
      colPart: idxPart,
      colMaterial: idxMat >= 0 ? idxMat : idxPart + 1,
      colGen: idxGen >= 0 ? idxGen : idxPart + 3,
      colChamber: idxCh >= 0 ? idxCh : (idxGen >= 0 ? idxGen + 2 : idxPart + 5),
      colNote: idxNote >= 0 ? idxNote : (idxCh >= 0 ? idxCh + 2 : idxPart + 7),
    }
  }
  return null
}

function isFooterRow(partName: string, drawing: string): boolean {
  const t = compactCell(`${partName}${drawing}`)
  return /三州産業|株式会社/.test(t) || t === '工場' || t === '現場'
}

function parseStandardSheet(sheetName: string, matrix: unknown[][]): Ec25ParsedPart[] {
  const header = findHeader(matrix)
  if (!header) return []

  const fastenerCols = collectFastenerHeaders(matrix, header.rowIndex, header.colNote + 1)
  const lastFastenerByCol = new Map<number, number>()

  const out: Ec25ParsedPart[] = []
  let lastDrawing = ''
  let lastMaterial = ''
  let lastGen = 0
  let lastChamber = 0
  let lastGenUnit: Ec25QtyUnit = 'pcs'
  let lastChamberUnit: Ec25QtyUnit = 'pcs'

  for (let r = header.rowIndex + 1; r < matrix.length; r++) {
    const row = matrix[r] || []
    const rawDraw = cellText(row[header.colDrawing])
    let drawing = normalizeDrawingNo(rawDraw)
    if (!drawing || rawDraw === '〃') drawing = lastDrawing
    else lastDrawing = drawing

    const partName = cellText(row[header.colPart])
    if (!partName) continue
    if (isFooterRow(partName, drawing)) continue
    if (compactCell(partName).includes('構成部品表')) continue

    let materialRaw = cellText(row[header.colMaterial])
    if (isDitto(materialRaw) || !materialRaw) materialRaw = lastMaterial
    else lastMaterial = materialRaw

    const genParsed = parseQtyExpression(row[header.colGen])
    const chParsed = parseQtyExpression(row[header.colChamber])
    const gen = genParsed.ditto ? lastGen : genParsed.qty
    const chamber = chParsed.ditto ? lastChamber : chParsed.qty
    if (!genParsed.ditto) {
      lastGen = gen
      lastGenUnit = genParsed.unit
    }
    if (!chParsed.ditto) {
      lastChamber = chamber
      lastChamberUnit = chParsed.unit
    }

    const qtyPieces = Number((gen + chamber).toFixed(4))
    if (qtyPieces <= 0 && !/組立|assy|外形|購入/i.test(`${partName}${materialRaw}`)) continue

    const unit: Ec25QtyUnit =
      genParsed.unit === 'm' || chParsed.unit === 'm' || lastGenUnit === 'm' || lastChamberUnit === 'm'
        ? 'm'
        : genParsed.unit === 'set' || chParsed.unit === 'set'
          ? 'set'
          : 'pcs'

    const kind = classifyKind(partName, materialRaw, drawing, sheetName)
    const materials = splitMaterialRaw(materialRaw).map(parseMaterialToken)
    const partKey = drawing || `EC25-${sheetName}-${r}`

    const fasteners: Ec25FastenerUse[] = []
    for (const col of fastenerCols) {
      const raw = row[col.col]
      if (isDitto(raw)) {
        const prev = lastFastenerByCol.get(col.col) || 0
        if (prev > 0) fasteners.push({ name: col.name, qty: prev, unit: 'pcs', col: col.col })
        continue
      }
      const parsed = parseFastenerQty(raw)
      if (parsed.qty > 0) {
        lastFastenerByCol.set(col.col, parsed.qty)
        fasteners.push({ name: col.name, qty: parsed.qty, unit: parsed.unit, col: col.col })
      } else {
        lastFastenerByCol.set(col.col, 0)
      }
    }

    out.push({
      sheet: sheetName,
      size: cellText(row[header.colSize]),
      drawing_no: drawing,
      drawing_raw: rawDraw,
      part_key: partKey,
      part_name: partName,
      material_raw: materialRaw,
      materials,
      fasteners,
      qty_generator: gen,
      qty_chamber: chamber,
      qty_pieces: qtyPieces || (kind === 'assembly' ? 1 : 0),
      qty_unit: unit,
      qty_raw: [cellText(row[header.colGen]), cellText(row[header.colChamber])].filter(Boolean).join(' / '),
      note: cellText(row[header.colNote]),
      kind,
      include: kind !== 'assembly' || fasteners.length > 0,
      unfoldable: kind === 'sheet' || kind === 'profile',
    })
  }
  return out
}

function parseBisSheet(_matrix: unknown[][]): Ec25ParsedPart[] {
  // ビス類シートは表紙/2/3 の右端数量の集計表。独立パーツにはしない。
  return []
}

function parseCoverMeta(matrix: unknown[][]): Ec25CoverMeta {
  let product_name = ''
  let model_type = ''
  let created_on = ''
  let owner = ''
  for (const row of matrix) {
    const a = compactCell(row?.[0])
    const b = cellText(row?.[1])
    if (a === '品名' && b) product_name = b
    if (a === '型式' && b) model_type = b
    if (a === '作成' && b) created_on = b
    if (a === '担当' && b) owner = b
  }
  return { product_name, model_type, created_on, owner }
}

function uniquifyPartKeys(parts: Ec25ParsedPart[]): Ec25ParsedPart[] {
  const seen = new Map<string, number>()
  return parts.map((p) => {
    const n = (seen.get(p.part_key) || 0) + 1
    seen.set(p.part_key, n)
    if (n === 1) return p
    return { ...p, part_key: `${p.part_key}#${n}` }
  })
}

export type Ec25PdfBomRow = {
  page?: number
  size?: string
  drawing_no?: string
  drawing_raw?: string
  part_name: string
  material?: string
  qty?: number
  qty_raw?: string
  qty_generator?: number | string
  qty_chamber?: number | string
  note?: string
}

export type Ec25PdfBomPayload = {
  cover?: Partial<Ec25CoverMeta>
  work_order?: Partial<Ec25CoverMeta> & { product_name?: string; bom_model?: string }
  parts: Ec25PdfBomRow[]
}

/** PDF構成部品表OCR結果を Excel と同じパーツ構造へ変換する。ネジ類は独立パーツにしない。 */
export function parseEc25PdfBom(payload: Ec25PdfBomPayload): Ec25WorkbookParse {
  const wo = payload.work_order || {}
  const c = payload.cover || {}
  const cover: Ec25CoverMeta = {
    product_name: c.product_name || wo.product_name || '',
    model_type: c.model_type || wo.bom_model || '',
    created_on: c.created_on || '',
    owner: c.owner || '',
  }

  const out: Ec25ParsedPart[] = []
  let lastDrawing = ''
  let lastMaterial = ''
  let lastGen = 0
  let lastChamber = 0

  for (const row of payload.parts || []) {
    const partName = cellText(row.part_name)
    if (!partName) continue
    if (isFooterRow(partName, row.drawing_no || '')) continue
    if (compactCell(partName).includes('構成部品表')) continue

    const rawDraw = cellText(row.drawing_raw || row.drawing_no)
    let drawing = normalizeDrawingNo(row.drawing_no || rawDraw)
    if (!drawing || isDitto(rawDraw)) drawing = lastDrawing
    else lastDrawing = drawing

    let materialRaw = cellText(row.material)
    if (isDitto(materialRaw) || !materialRaw) materialRaw = lastMaterial
    else lastMaterial = materialRaw

    const genParsed = parseQtyExpression(row.qty_generator ?? '')
    const chParsed = parseQtyExpression(row.qty_chamber ?? '')
    const gen = genParsed.ditto ? lastGen : genParsed.qty
    const chamber = chParsed.ditto ? lastChamber : chParsed.qty
    if (!genParsed.ditto) lastGen = gen
    if (!chParsed.ditto) lastChamber = chamber

    let qtyPieces = Number((gen + chamber).toFixed(4))
    if (qtyPieces <= 0) {
      qtyPieces = parseQtyExpression(row.qty_raw || row.qty).qty
    }

    const sheet = row.page ? `PDF p.${row.page}` : 'PDF'
    if (qtyPieces <= 0 && !/組立|assy|外形|購入/i.test(`${partName}${materialRaw}`)) continue

    const unit: Ec25QtyUnit =
      genParsed.unit === 'm' || chParsed.unit === 'm' ? 'm' : genParsed.unit === 'set' || chParsed.unit === 'set' ? 'set' : 'pcs'
    const kind = classifyKind(partName, materialRaw, drawing, sheet)
    const partKey = drawing || `EC25-${sheet}-${out.length + 1}`

    out.push({
      sheet,
      size: cellText(row.size),
      drawing_no: drawing,
      drawing_raw: rawDraw,
      part_key: partKey,
      part_name: partName,
      material_raw: materialRaw,
      materials: splitMaterialRaw(materialRaw).map(parseMaterialToken),
      fasteners: [],
      qty_generator: gen,
      qty_chamber: chamber,
      qty_pieces: qtyPieces || (kind === 'assembly' ? 1 : 0),
      qty_unit: unit,
      qty_raw: cellText(row.qty_raw) || [gen, chamber].filter((n) => n > 0).join(' / '),
      note: cellText(row.note),
      kind,
      include: kind !== 'assembly',
      unfoldable: kind === 'sheet' || kind === 'profile',
    })
  }

  return { cover, parts: uniquifyPartKeys(out) }
}

export function parseEc25DrawingWorkbook(buffer: Buffer): Ec25WorkbookParse {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true })
  const parts: Ec25ParsedPart[] = []
  let cover: Ec25CoverMeta = { product_name: '', model_type: '', created_on: '', owner: '' }

  for (const name of wb.SheetNames) {
    const sh = wb.Sheets[name]
    if (!sh) continue
    const matrix = XLSX.utils.sheet_to_json(sh, { header: 1, defval: '' }) as unknown[][]
    if (name === '表紙') {
      cover = parseCoverMeta(matrix)
      parts.push(...parseStandardSheet(name, matrix))
      continue
    }
    if (name === 'ビス類') {
      parts.push(...parseBisSheet(matrix))
      continue
    }
    if (/^\d+$/.test(name) || name === '1') {
      parts.push(...parseStandardSheet(name, matrix))
    }
  }

  return { cover, parts: uniquifyPartKeys(parts) }
}

export function extractDimensionMm(text: string): { w: number; h: number } | null {
  const blob = String(text || '').replace(/\s+/g, '')
  const m =
    blob.match(/(\d{2,4})\s*[×xX]\s*(\d{2,4})(?!\s*[×xX]\s*t)/) ||
    blob.match(/パネルサイズ(\d{2,4})[×xX](\d{2,4})/)
  if (!m) return null
  const w = Number(m[1])
  const h = Number(m[2])
  if (!Number.isFinite(w) || !Number.isFinite(h)) return null
  if (w < 20 || h < 20 || w > 8000 || h > 8000) return null
  return { w, h }
}
