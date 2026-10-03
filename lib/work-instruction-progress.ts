import type { SupabaseClient } from '@supabase/supabase-js'

export type InstructionDocType = '製作' | '切替' | '修理'

const ORDER_PREFIX_DOC_TYPE: Record<string, InstructionDocType> = {
  DR: '製作',
  LR: '製作',
  KR: '切替',
  RR: '修理',
}

/** 指令番号の頭2文字。DR=製作、LR=L指令（製作の年度先頭）、KR=切替、RR=修理。判断できないときは null。 */
export function docTypeFromOrderNo(orderNo: string | null | undefined): InstructionDocType | null {
  const prefix = String(orderNo || '').normalize('NFKC').trim().slice(0, 2).toUpperCase()
  return ORDER_PREFIX_DOC_TYPE[prefix] ?? null
}

/** LR9-0001 と、Excel の年度束 L7 / L令9（表示すると LR）。部品行 LR9-0001-1 も含む。 */
export function isLInstructionOrderNo(orderNo: string | null | undefined) {
  const text = String(orderNo || '').normalize('NFKC').trim()
  if (!text) return false
  if (/^LR\d/i.test(text)) return true
  return /^L令?\d/i.test(text)
}

export type InstructionShop = {
  code: string
  name: string
  assigned: boolean
  completed: boolean
}

export const INSTRUCTION_SHOPS: Array<Pick<InstructionShop, 'code' | 'name'>> = [
  { code: '製管', name: '製管' },
  { code: 'K-1', name: '板切' },
  { code: 'K-2', name: '溶接' },
  { code: 'K-3', name: '機械' },
  { code: 'A-1', name: '塗装' },
  { code: 'A-2', name: '検査' },
  { code: 'A-3', name: '組立' },
  { code: 'P-1', name: 'パネル' },
]

/**
 * 製作の指図書と№を、D指令マスタの番号に合わせる。
 * 例: D令9 + 14 → DR9-0014、枝番 1 → DR9-0014-1。L9 + 315 → LR9-0315。
 * すでに DR9-0014 の形なら、そのまま返す。
 */
export function formatDInstructionNo(seriesRaw: string | null | undefined, itemRaw: string | null | undefined, branchRaw?: string | null) {
  const series = String(seriesRaw || '').normalize('NFKC').trim()
  const item = String(itemRaw || '').normalize('NFKC').trim().replace(/\.0$/, '')
  const branch = String(branchRaw || '').normalize('NFKC').trim().replace(/\.0$/, '')
  if (!series) return ''
  if (series.includes('-')) return series

  const withRei = series.match(/^([A-Za-z])令(\d+)$/)
  const already = series.match(/^([A-Za-z]R)(\d+)$/i)
  const short = series.match(/^([A-Za-z])(\d+)$/)
  let prefix = series
  if (withRei) prefix = `${withRei[1].toUpperCase()}R${Number(withRei[2])}`
  else if (already) prefix = `${already[1].toUpperCase()}${Number(already[2])}`
  else if (short) prefix = `${short[1].toUpperCase()}R${Number(short[2])}`
  else return series

  if (!item || !/^\d+$/.test(item)) return prefix
  const base = `${prefix}-${String(Number(item)).padStart(4, '0')}`
  if (!branch || !/^\d+$/.test(branch)) return base
  return `${base}-${Number(branch)}`
}

export function emptyInstructionShops(): InstructionShop[] {
  return INSTRUCTION_SHOPS.map((shop) => ({
    code: shop.code,
    name: shop.name,
    assigned: false,
    completed: false,
  }))
}

export function normalizeInstructionShops(value: unknown): InstructionShop[] {
  const incoming = Array.isArray(value) ? value : []
  return INSTRUCTION_SHOPS.map((shop) => {
    const found = incoming.find((item) => item && typeof item === 'object' && (item as InstructionShop).code === shop.code) as
      | Partial<InstructionShop>
      | undefined
    return {
      code: shop.code,
      name: shop.name,
      assigned: Boolean(found?.assigned) || Boolean(found?.completed),
      completed: Boolean(found?.completed),
    }
  })
}

export function isMissingInstructionProgressTable(error: { message?: string; code?: string } | null | undefined) {
  const message = String(error?.message || '')
  const code = String(error?.code || '')
  return (
    code === '42P01' ||
    code === 'PGRST205' ||
    (/work_instruction_progress/i.test(message) &&
      /does not exist|schema cache|Could not find the table/i.test(message))
  )
}

export type InstructionAttachResult = {
  attached: boolean
  needsChoice: boolean
  docType: InstructionDocType | null
  lInstruction: boolean
}

function attachResult(
  orderNo: string | null | undefined,
  result: Omit<InstructionAttachResult, 'lInstruction'>
): InstructionAttachResult {
  return { ...result, lInstruction: isLInstructionOrderNo(orderNo) }
}

/** D指令を登録したとき、頭2文字に応じた一覧へ1行足す。判断できないときは追加せず、画面で選ばせる。 */
export async function attachWorkOrderToInstructionProgress(
  supabase: SupabaseClient,
  order: {
    id: string
    order_no: string
    product_name?: string | null
    model?: string | null
    qty?: number | null
    fiscal_year?: number | null
  },
  explicitDocType?: InstructionDocType | null
): Promise<InstructionAttachResult> {
  const resolved = explicitDocType ?? docTypeFromOrderNo(order.order_no)
  if (!resolved) return attachResult(order.order_no, { attached: false, needsChoice: true, docType: null })

  const payload = {
    work_order_id: order.id,
    doc_type: resolved,
    series_no: order.order_no || '',
    fiscal_year: order.fiscal_year ?? null,
    product_name: order.product_name || null,
    model: order.model || null,
    planned_qty: typeof order.qty === 'number' ? order.qty : null,
    shops: emptyInstructionShops(),
    source: 'work_order',
  }
  const { error } = await supabase.from('work_instruction_progress').insert(payload)
  if (!error) return attachResult(order.order_no, { attached: true, needsChoice: false, docType: resolved })

  const message = String(error.message || '')
  const code = String(error.code || '')
  if (code === '23505') {
    const { error: updateError } = await supabase
      .from('work_instruction_progress')
      .update({
        doc_type: resolved,
        series_no: payload.series_no,
        product_name: payload.product_name,
        model: payload.model,
        planned_qty: payload.planned_qty,
        fiscal_year: payload.fiscal_year,
        updated_at: new Date().toISOString(),
      })
      .eq('work_order_id', order.id)
      .eq('source', 'work_order')
    if (!updateError) return attachResult(order.order_no, { attached: true, needsChoice: false, docType: resolved })
  }
  if (code === '23505' || isMissingInstructionProgressTable(error)) {
    return attachResult(order.order_no, { attached: false, needsChoice: false, docType: resolved })
  }
  if (/does not exist|schema cache|work_instruction_progress/i.test(message)) {
    return attachResult(order.order_no, { attached: false, needsChoice: false, docType: resolved })
  }
  console.error('製作指図書の追加に失敗:', error)
  return attachResult(order.order_no, { attached: false, needsChoice: false, docType: resolved })
}

/** D指令番号を変えたとき、指図書欄と、頭2文字から分かる反映先を合わせる。 */
export async function syncWorkOrderInstructionNumber(
  supabase: SupabaseClient,
  order: {
    id: string
    order_no: string
    product_name?: string | null
    model?: string | null
    qty?: number | null
    fiscal_year?: number | null
  }
): Promise<InstructionAttachResult> {
  const resolved = docTypeFromOrderNo(order.order_no)
  const payload: Record<string, unknown> = {
    series_no: order.order_no || '',
    product_name: order.product_name || null,
    model: order.model || null,
    planned_qty: typeof order.qty === 'number' ? order.qty : null,
    fiscal_year: order.fiscal_year ?? null,
    updated_at: new Date().toISOString(),
  }
  if (resolved) payload.doc_type = resolved

  const { data, error } = await supabase
    .from('work_instruction_progress')
    .update(payload)
    .eq('work_order_id', order.id)
    .eq('source', 'work_order')
    .select('id')

  if (error) {
    if (isMissingInstructionProgressTable(error)) {
      return attachResult(order.order_no, { attached: false, needsChoice: false, docType: resolved })
    }
    if (/does not exist|schema cache|work_instruction_progress/i.test(String(error.message || ''))) {
      return attachResult(order.order_no, { attached: false, needsChoice: false, docType: resolved })
    }
    console.error('製作指図書の指令番号同期に失敗:', error)
    return attachResult(order.order_no, { attached: false, needsChoice: !resolved, docType: resolved })
  }
  if ((data || []).length > 0) return attachResult(order.order_no, { attached: true, needsChoice: false, docType: resolved })
  return attachResult(order.order_no, { attached: false, needsChoice: false, docType: resolved })
}
