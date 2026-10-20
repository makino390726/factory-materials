import { createClient } from '@supabase/supabase-js'
import {
  buildProductCodeLookupMap,
  resolveProductCode,
} from './product-code'
import {
  findSetProduct,
  roundQty,
  type SetProduct,
  type SetProductItem,
} from './set-products'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  }
)

const BATCH_SIZE = 1000

export type SetIssueLine = SetProductItem & {
  shelf_no: string | null
  stock_qty: number
  in_master: boolean
}

type ProductRow = {
  product_code: string
  name: string | null
  shelf_no: string | null
}

type StockRow = {
  product_code: string
  stock_qty: number | null
  shelf_no: string | null
}

async function fetchAllProducts(): Promise<ProductRow[]> {
  const rows: ProductRow[] = []
  let offset = 0

  while (true) {
    const { data, error } = await supabase
      .from('products')
      .select('product_code, name, shelf_no')
      .order('product_code', { ascending: true })
      .range(offset, offset + BATCH_SIZE - 1)

    if (error) throw new Error(`商品マスタの取得に失敗しました: ${error.message}`)
    if (!data || data.length === 0) break
    rows.push(...data)
    if (data.length < BATCH_SIZE) break
    offset += BATCH_SIZE
  }

  return rows
}

async function fetchStocks(codes: string[]): Promise<StockRow[]> {
  const rows: StockRow[] = []
  for (let index = 0; index < codes.length; index += 100) {
    const chunk = codes.slice(index, index + 100)
    const { data, error } = await supabase
      .from('stocks')
      .select('product_code, stock_qty, shelf_no')
      .in('product_code', chunk)

    if (error) throw new Error(`在庫の取得に失敗しました: ${error.message}`)
    rows.push(...(data || []))
  }
  return rows
}

function shelfText(value: string | null | undefined): string {
  return value ? String(value).trim() : ''
}

export function parseSetCount(value: unknown): number {
  const count = Number(value)
  if (!Number.isInteger(count) || count <= 0 || count > 999) {
    throw new Error('セット数は1以上999以下の整数で入力してください')
  }
  return count
}

export function issueQuantity(qtyPerSet: number, setCount: number): number {
  return roundQty(qtyPerSet * setCount)
}

export async function loadSetIssueLines(setProduct: SetProduct): Promise<SetIssueLine[]> {
  const products = await fetchAllProducts()
  const lookup = buildProductCodeLookupMap(products.map((product) => product.product_code))
  const productByCode = new Map(products.map((product) => [product.product_code, product]))

  const resolvedCodes = setProduct.items.map((item) => {
    const resolved = resolveProductCode(item.product_code, lookup)
    return resolved.code || item.product_code
  })
  const stockRows = await fetchStocks(
    Array.from(new Set([...setProduct.items.map((item) => item.product_code), ...resolvedCodes]))
  )
  const stockByCode = new Map(stockRows.map((row) => [row.product_code, row]))

  return setProduct.items.map((item, index) => {
    const resolved = resolveProductCode(item.product_code, lookup)
    const productCode = resolved.code || item.product_code
    const product = productByCode.get(productCode)
    const stock = stockByCode.get(productCode) || stockByCode.get(item.product_code)
    const shelf = shelfText(product?.shelf_no) || shelfText(stock?.shelf_no)

    return {
      ...item,
      line_no: item.line_no || index + 1,
      product_code: productCode,
      shelf_no: shelf || null,
      stock_qty: Number(stock?.stock_qty || 0),
      in_master: resolved.isExisting,
    }
  })
}

export type IssueGroup = {
  product_code: string
  product_name: string
  qty: number
  stock_qty: number
  shelf_no: string | null
}

export function buildIssueGroups(lines: SetIssueLine[], setCount: number): IssueGroup[] {
  const groups = new Map<string, IssueGroup>()

  for (const line of lines) {
    const qty = issueQuantity(line.qty_per_set, setCount)
    if (qty <= 0) continue
    const current = groups.get(line.product_code)
    if (current) {
      current.qty = roundQty(current.qty + qty)
      continue
    }
    groups.set(line.product_code, {
      product_code: line.product_code,
      product_name: line.product_name,
      qty,
      stock_qty: line.stock_qty,
      shelf_no: line.shelf_no,
    })
  }

  return Array.from(groups.values())
}

export async function issueSetProduct(input: {
  setId: string
  setCount: number
  loginId?: string | null
  staffName?: string | null
}) {
  const setProduct = findSetProduct(input.setId)
  if (!setProduct) {
    throw new Error('セット品が見つかりません')
  }

  const setCount = parseSetCount(input.setCount)
  const lines = await loadSetIssueLines(setProduct)
  const groups = buildIssueGroups(lines, setCount)
  const shortages = groups.filter((group) => group.stock_qty < group.qty)

  if (groups.length === 0) {
    throw new Error('払い出す数量がありません')
  }

  if (shortages.length > 0) {
    return {
      ok: false as const,
      setProduct,
      lines,
      shortages,
    }
  }

  const note = `セット払い出し: ${setProduct.set_name}${
    setProduct.set_code ? ` (${setProduct.set_code})` : ''
  } ×${setCount}`

  for (const group of groups) {
    const newQty = roundQty(group.stock_qty - group.qty)
    const { error: stockError } = await supabase.from('stocks').upsert(
      {
        product_code: group.product_code,
        stock_qty: newQty,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'product_code' }
    )

    if (stockError) {
      throw new Error(`${group.product_code} の在庫更新に失敗しました: ${stockError.message}`)
    }

    const { error: movementError } = await supabase.from('stock_movements').insert({
      product_code: group.product_code,
      movement: 'OUT',
      qty: group.qty,
      input_method: 'set_issue',
      note,
      login_id: input.loginId || null,
      staff_name: input.staffName || null,
      created_at: new Date().toISOString(),
    })

    if (movementError) {
      throw new Error(`${group.product_code} の出庫履歴に失敗しました: ${movementError.message}`)
    }
  }

  const updatedLines = await loadSetIssueLines(setProduct)
  return {
    ok: true as const,
    setProduct,
    lines: updatedLines,
    issuedCount: groups.length,
    note,
  }
}
