import fs from 'fs'
import path from 'path'
import * as XLSX from 'xlsx'

/** 数値コードの先頭00を外す（0086021000 → 86021000）。lib/product-code.ts と同じ規則 */
function canonicalizeProductCode(code: string): string {
  const trimmed = String(code || '').trim()
  if (/^\d+$/.test(trimmed) && trimmed.startsWith('00') && trimmed.length > 2) {
    return trimmed.slice(2)
  }
  return trimmed
}

export type SetProductItem = {
  line_no: number
  product_code: string
  product_name: string
  qty_per_set: number
  supplier: string
}

export type SetProduct = {
  id: string
  sheet_name: string
  set_code: string
  set_name: string
  items: SetProductItem[]
}

export type SetProductFile = {
  source_name: string
  imported_at: string
  warnings: string[]
  sets: SetProduct[]
}

const DATA_PATH = path.join(process.cwd(), 'data', 'set-products.json')

export function roundQty(value: number): number {
  return Math.round(value * 10000) / 10000
}

function cellText(value: unknown): string {
  if (value == null) return ''
  return String(value).trim()
}

function isDateText(value: string): boolean {
  return /^\d{4}[\/.-]\d{1,2}/.test(value)
}

function isProductCode(value: string): boolean {
  const text = cellText(value)
  if (!text || isDateText(text)) return false
  return /^0*\d{5,}$/.test(text)
}

function parseQty(value: unknown): number | null {
  const text = cellText(value).replace(/,/g, '')
  if (!text) return null
  const qty = Number(text)
  if (!Number.isFinite(qty)) return null
  return roundQty(qty)
}

function findHeaderIndex(rows: unknown[][]): number {
  return rows.findIndex((row) => row.some((cell) => cellText(cell).includes('商品コード')))
}

function pickColumn(headers: string[], patterns: string[]): number {
  for (const pattern of patterns) {
    const index = headers.findIndex((header) => header.includes(pattern))
    if (index >= 0) return index
  }
  return -1
}

function pickSupplierColumn(headers: string[], dataRows: unknown[][]): number {
  const indexes = headers
    .map((header, index) => ({ header, index }))
    .filter(({ header }) => /仕入|発注|業者/.test(header))
    .map(({ index }) => index)

  if (indexes.length === 0) return -1
  if (indexes.length === 1) return indexes[0]

  let best = indexes[0]
  let bestScore = -1
  for (const index of indexes) {
    const score = dataRows.filter((row) => cellText(row[index])).length
    if (score > bestScore) {
      best = index
      bestScore = score
    }
  }
  return best
}

function readSetIdentity(rows: unknown[][], headerIndex: number, sheetName: string) {
  let setCode = ''
  let setName = ''

  for (let rowIndex = 0; rowIndex < headerIndex; rowIndex += 1) {
    const cells = (rows[rowIndex] || []).map(cellText)
    const codeIndex = cells.findIndex((cell) => isProductCode(cell))
    if (codeIndex >= 0 && !setCode) {
      setCode = canonicalizeProductCode(cells[codeIndex])
      const name = cells.slice(codeIndex + 1).find((cell) => cell && !isProductCode(cell) && !isDateText(cell))
      if (name) setName = name
    }
  }

  if (!setName) {
    const texts = rows
      .slice(0, headerIndex)
      .flatMap((row) => row.map(cellText))
      .filter((cell) => cell && !isProductCode(cell) && !isDateText(cell))
    setName = texts.sort((a, b) => b.length - a.length)[0] || sheetName.trim()
  }

  return { setCode, setName: setName.trim() }
}

export function parseSetWorkbook(buffer: Buffer, sourceName: string): SetProductFile {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false })
  const warnings: string[] = []
  const sets: SetProduct[] = []

  workbook.SheetNames.forEach((sheetName, sheetIndex) => {
    const worksheet = workbook.Sheets[sheetName]
    const rows = XLSX.utils.sheet_to_json(worksheet, {
      header: 1,
      defval: '',
      raw: false,
    }) as unknown[][]

    const headerIndex = findHeaderIndex(rows)
    if (headerIndex < 0) {
      warnings.push(`${sheetName}: 商品コードの見出しがありません`)
      return
    }

    const headers = (rows[headerIndex] || []).map(cellText)
    const codeColumn = pickColumn(headers, ['商品コード'])
    const nameColumn = pickColumn(headers, ['商品名'])
    const qtyColumn = pickColumn(headers, ['バラ総数', '一台', '必要数', '数量'])
    const dataRows = rows.slice(headerIndex + 1)
    const supplierColumn = pickSupplierColumn(headers, dataRows)

    if (codeColumn < 0 || nameColumn < 0 || qtyColumn < 0) {
      warnings.push(`${sheetName}: 商品コード、商品名、必要数の列を判別できません`)
      return
    }

    const { setCode, setName } = readSetIdentity(rows, headerIndex, sheetName)
    const items: SetProductItem[] = []

    dataRows.forEach((row, rowOffset) => {
      const rawCode = cellText(row[codeColumn])
      if (!isProductCode(rawCode)) return
      const qty = parseQty(row[qtyColumn])
      items.push({
        line_no: rowOffset + 1,
        product_code: canonicalizeProductCode(rawCode),
        product_name: cellText(row[nameColumn]),
        qty_per_set: qty ?? 0,
        supplier: supplierColumn >= 0 ? cellText(row[supplierColumn]) : '',
      })
    })

    if (items.length === 0) {
      warnings.push(`${sheetName}: 構成品がありません`)
      return
    }

    sets.push({
      id: `set-${sheetIndex + 1}`,
      sheet_name: sheetName.trim(),
      set_code: setCode,
      set_name: setName,
      items,
    })
  })

  return {
    source_name: sourceName,
    imported_at: new Date().toISOString(),
    warnings,
    sets,
  }
}

export function loadSetProducts(): SetProductFile {
  const raw = fs.readFileSync(DATA_PATH, 'utf8')
  return JSON.parse(raw) as SetProductFile
}

export function saveSetProducts(data: SetProductFile) {
  fs.mkdirSync(path.dirname(DATA_PATH), { recursive: true })
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2), 'utf8')
}

export function findSetProduct(id: string): SetProduct | null {
  const file = loadSetProducts()
  return file.sets.find((set) => set.id === id) || null
}

export type SetProductDraft = {
  set_code?: string
  set_name?: string
  items?: Array<{
    product_code?: string
    product_name?: string
    qty_per_set?: number | string
    supplier?: string
  }>
}

function requireSetName(value: unknown): string {
  const name = cellText(value)
  if (!name) throw new Error('セット品名を入力してください')
  return name
}

function normalizeSetCode(value: unknown): string {
  const code = cellText(value)
  if (!code) return ''
  if (isProductCode(code)) return canonicalizeProductCode(code)
  return code
}

function normalizeItems(items: SetProductDraft['items']): SetProductItem[] {
  if (!Array.isArray(items)) throw new Error('構成品を入力してください')

  const normalized: SetProductItem[] = []
  for (const item of items) {
    const rawCode = cellText(item?.product_code)
    if (!rawCode) continue
    if (!isProductCode(rawCode)) {
      throw new Error(`商品コードが正しくありません: ${rawCode}`)
    }
    const qty = parseQty(item?.qty_per_set)
    if (qty == null || qty <= 0) {
      throw new Error(`${canonicalizeProductCode(rawCode)} の必要数を入力してください`)
    }
    normalized.push({
      line_no: normalized.length + 1,
      product_code: canonicalizeProductCode(rawCode),
      product_name: cellText(item?.product_name),
      qty_per_set: qty,
      supplier: cellText(item?.supplier),
    })
  }

  if (normalized.length === 0) throw new Error('構成品を1行以上入力してください')
  return normalized
}

function writeSets(file: SetProductFile) {
  file.imported_at = new Date().toISOString()
  saveSetProducts(file)
}

export function createSetProduct(draft: SetProductDraft): SetProduct {
  const file = loadSetProducts()
  const setName = requireSetName(draft.set_name)
  const created: SetProduct = {
    id: `set-${Date.now()}`,
    sheet_name: setName,
    set_code: normalizeSetCode(draft.set_code),
    set_name: setName,
    items: normalizeItems(draft.items),
  }
  file.sets.push(created)
  writeSets(file)
  return created
}

export function updateSetProduct(id: string, draft: SetProductDraft): SetProduct {
  const file = loadSetProducts()
  const index = file.sets.findIndex((setProduct) => setProduct.id === id)
  if (index < 0) throw new Error('セット品が見つかりません')

  const current = file.sets[index]
  const updated: SetProduct = {
    ...current,
    set_code: normalizeSetCode(draft.set_code),
    set_name: requireSetName(draft.set_name),
    items: normalizeItems(draft.items),
  }
  file.sets[index] = updated
  writeSets(file)
  return updated
}

export function deleteSetProduct(id: string): SetProduct {
  const file = loadSetProducts()
  const index = file.sets.findIndex((setProduct) => setProduct.id === id)
  if (index < 0) throw new Error('セット品が見つかりません')
  const [removed] = file.sets.splice(index, 1)
  writeSets(file)
  return removed
}
