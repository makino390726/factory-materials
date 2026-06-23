import type { SupabaseClient } from '@supabase/supabase-js'
import { canonicalizeProductCode } from '@/lib/product-code'

const PRODUCT_CODE_TABLES = [
  'stock_movements',
  'unmatched_parts',
  'work_order_cost_items',
  'heater_parts_master',
  'work_order_branches',
] as const

async function updateProductCodeInTable(
  supabase: SupabaseClient,
  table: string,
  sourceCode: string,
  targetCode: string
) {
  const { error } = await supabase
    .from(table)
    .update({ product_code: targetCode })
    .eq('product_code', sourceCode)

  if (error) {
    if (String(error.message || '').includes('Could not find the table')) return
    throw new Error(`${table}: ${error.message}`)
  }
}

/** 00付きのみの商品を正規コードへリネーム（在庫・履歴も移行） */
async function renameOrphanZeroPrefixProduct(
  supabase: SupabaseClient,
  sourceCode: string,
  targetCode: string
) {
  const { data: sourceProduct, error: fetchErr } = await supabase
    .from('products')
    .select('*')
    .eq('product_code', sourceCode)
    .maybeSingle()

  if (fetchErr) throw new Error(`products fetch: ${fetchErr.message}`)
  if (!sourceProduct) return

  const nextBarcode =
    sourceProduct.barcode && String(sourceProduct.barcode).includes(sourceCode)
      ? String(sourceProduct.barcode).replace(sourceCode, targetCode)
      : sourceProduct.barcode

  const { error: insertErr } = await supabase.from('products').insert({
    product_code: targetCode,
    name: sourceProduct.name,
    shelf_no: sourceProduct.shelf_no,
    unit: sourceProduct.unit,
    barcode: nextBarcode,
    qr_code_data: sourceProduct.qr_code_data,
    purchase_price: sourceProduct.purchase_price,
    cost_price: sourceProduct.cost_price,
  })

  if (insertErr) throw new Error(`products insert: ${insertErr.message}`)

  for (const table of PRODUCT_CODE_TABLES) {
    await updateProductCodeInTable(supabase, table, sourceCode, targetCode)
  }

  const { data: sourceStock } = await supabase
    .from('stocks')
    .select('product_code')
    .eq('product_code', sourceCode)
    .maybeSingle()

  if (sourceStock) {
    const { error: stockRenameErr } = await supabase
      .from('stocks')
      .update({ product_code: targetCode })
      .eq('product_code', sourceCode)

    if (stockRenameErr) throw new Error(`stocks rename: ${stockRenameErr.message}`)
  }

  const { error: deleteErr } = await supabase.from('products').delete().eq('product_code', sourceCode)
  if (deleteErr) throw new Error(`products delete: ${deleteErr.message}`)
}

/** 00付き商品の在庫・履歴を正規コード側へ統合 */
async function mergeZeroPrefixIntoCanonical(
  supabase: SupabaseClient,
  sourceCode: string,
  targetCode: string
) {
  const { error: movementErr } = await supabase
    .from('stock_movements')
    .update({ product_code: targetCode })
    .eq('product_code', sourceCode)

  if (movementErr) throw new Error(`stock_movements: ${movementErr.message}`)

  const { data: sourceStock } = await supabase
    .from('stocks')
    .select('stock_qty, unit_price, total_amount, shelf_no')
    .eq('product_code', sourceCode)
    .maybeSingle()

  if (sourceStock) {
    const { data: targetStock } = await supabase
      .from('stocks')
      .select('stock_qty, unit_price, total_amount, shelf_no')
      .eq('product_code', targetCode)
      .maybeSingle()

    const mergedQty = (targetStock?.stock_qty || 0) + (sourceStock.stock_qty || 0)
    const upsertPayload: Record<string, unknown> = {
      product_code: targetCode,
      stock_qty: mergedQty,
      updated_at: new Date().toISOString(),
    }

    if (sourceStock.unit_price != null && targetStock?.unit_price == null) {
      upsertPayload.unit_price = sourceStock.unit_price
    }
    if (sourceStock.total_amount != null && targetStock?.total_amount == null) {
      upsertPayload.total_amount = sourceStock.total_amount
    }
    if (sourceStock.shelf_no && !targetStock?.shelf_no) {
      upsertPayload.shelf_no = sourceStock.shelf_no
    }

    const { error: stockErr } = await supabase
      .from('stocks')
      .upsert(upsertPayload, { onConflict: 'product_code' })

    if (stockErr) throw new Error(`stocks merge: ${stockErr.message}`)

    await supabase.from('stocks').delete().eq('product_code', sourceCode)
  }

  for (const table of PRODUCT_CODE_TABLES) {
    await updateProductCodeInTable(supabase, table, sourceCode, targetCode)
  }

  const { error: deleteErr } = await supabase.from('products').delete().eq('product_code', sourceCode)
  if (deleteErr) throw new Error(`products delete: ${deleteErr.message}`)
}

/**
 * 正規コード（00なし）でDB上の商品を確保する。
 * 00付きのみ存在する場合はリネーム/統合して正規コードを返す。
 */
export async function ensureCanonicalProductCode(
  supabase: SupabaseClient,
  code: string
): Promise<string> {
  const canonical = canonicalizeProductCode(code)
  if (!canonical || !/^\d+$/.test(canonical)) return canonical || code

  const { data: atCanonical } = await supabase
    .from('products')
    .select('product_code')
    .eq('product_code', canonical)
    .maybeSingle()

  if (atCanonical) {
    const zeroCode = `00${canonical}`
    const { data: atZero } = await supabase
      .from('products')
      .select('product_code')
      .eq('product_code', zeroCode)
      .maybeSingle()

    if (atZero) {
      await mergeZeroPrefixIntoCanonical(supabase, zeroCode, canonical)
    }
    return canonical
  }

  const zeroCode = `00${canonical}`
  const { data: atZero } = await supabase
    .from('products')
    .select('product_code')
    .eq('product_code', zeroCode)
    .maybeSingle()

  if (atZero) {
    await renameOrphanZeroPrefixProduct(supabase, zeroCode, canonical)
    return canonical
  }

  return canonical
}
