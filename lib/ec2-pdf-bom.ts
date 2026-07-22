/**
 * EC2 試作 PDF 部品表取込向けの共通型・正規化。
 * 入力は scripts/ocr_ec2_parts_pdf.py の出力 JSON、または同等構造。
 */

export type Ec2PartKind = 'drawing_part' | 'purchased' | 'assembly'

export type Ec2WorkOrderDraft = {
  order_no: string
  product_name: string
  bom_model: string
  qty: number
  unit?: string
  source_no_raw?: string | null
}

export type Ec2ParsedPart = {
  page?: number
  size?: string
  drawing_no: string
  drawing_raw?: string
  part_name: string
  material?: string
  spec?: string
  qty: number
  qty_raw?: string
  note?: string
  kind: Ec2PartKind
  include: boolean
  part_key?: string
}

export type Ec2BomPayload = {
  source?: { parts_list_pdf?: string; drawings_pdf?: string | null }
  work_order: Ec2WorkOrderDraft
  parts: Ec2ParsedPart[]
  summary?: Record<string, unknown>
}

/** 令8-119 / 令8 - 119 → DR8-0119 */
export function orderNoFromInstructionRaw(raw: string): string | null {
  const s = String(raw || '').replace(/\s+/g, '')
  const m = s.match(/令(\d+)[-ー－]?(\d{1,4})/)
  if (!m) return null
  return `DR${m[1]}-${m[2].padStart(4, '0')}`
}

export function normalizeEc2DrawingNo(raw: string): string {
  if (!raw) return ''
  let s = String(raw).toUpperCase().replace(/\s+/g, '')
  s = s.replace(/[一–—ー]/g, '-')
  s = s.replace(/SKIO/g, 'SK10').replace(/SK1O/g, 'SK10').replace(/SKI0/g, 'SK10')
  s = s.replace(/SK10+/g, 'SK10')
  const m = s.match(/SK10-?([0-9OILA-Z-]+)/)
  if (!m) return ''
  let rest = m[1].replace(/O/g, '0').replace(/I/g, '1')
  rest = rest.replace(/[^0-9A-Z-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '')
  const short = rest.match(/^0(\d)([A-Z])$/)
  if (short) rest = `00${short[1]}${short[2]}`
  return rest ? `SK10-${rest}` : ''
}

export function ensureWorkOrderDefaults(wo: Partial<Ec2WorkOrderDraft>): Ec2WorkOrderDraft {
  const product = (wo.product_name || 'EC2型乾燥機(試作機)').trim()
  const orderNo =
    (wo.order_no || '').trim() ||
    orderNoFromInstructionRaw(wo.source_no_raw || '') ||
    'DR8-0000'
  return {
    order_no: orderNo,
    product_name: product,
    bom_model: (wo.bom_model || product).trim() || product,
    qty: typeof wo.qty === 'number' && wo.qty > 0 ? wo.qty : 1,
    unit: wo.unit || '式',
    source_no_raw: wo.source_no_raw ?? null,
  }
}

export function normalizePayload(input: Ec2BomPayload): Ec2BomPayload {
  const work_order = ensureWorkOrderDefaults(input.work_order || ({} as Ec2WorkOrderDraft))
  const parts = (input.parts || []).map((p) => {
    const drawing = normalizeEc2DrawingNo(p.drawing_no || p.drawing_raw || '') || (p.drawing_no || '')
    const kind: Ec2PartKind =
      p.kind ||
      (drawing
        ? /外形図|組立図|assy/i.test(p.part_name || '')
          ? 'assembly'
          : 'drawing_part'
        : 'purchased')
    const include = typeof p.include === 'boolean' ? p.include : kind !== 'assembly'
    return {
      ...p,
      drawing_no: drawing,
      part_key: drawing ? drawing.toUpperCase() : '',
      part_name: (p.part_name || drawing || '').trim(),
      qty: Number(p.qty) > 0 ? Number(p.qty) : 1,
      kind,
      include,
      spec: p.spec || p.material || '',
    }
  })
  return {
    ...input,
    work_order,
    parts,
    summary: {
      total: parts.length,
      drawing_parts: parts.filter((p) => p.kind === 'drawing_part').length,
      purchased: parts.filter((p) => p.kind === 'purchased').length,
      assembly_excluded: parts.filter((p) => p.kind === 'assembly').length,
      include_count: parts.filter((p) => p.include).length,
      ...(input.summary || {}),
    },
  }
}
