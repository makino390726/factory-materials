/**
 * EC30 BOM インポート用: 部品名から各マスタの候補リストを生成（目視マッピング用）
 */

export type CandidateKind = 'product' | 'line' | 'work_order' | 'parts_master'

export type CandidateOption = {
  kind: CandidateKind
  ref: string
  label: string
  tier: 'exact' | 'partial'
}

export type ProductRow = { product_code: string; name: string; spec?: string | null }
export type LineRow = { line_code: string; name: string }
export type WorkOrderRow = { order_no: string; product_name: string | null; model: string | null }
export type PartMasterRow = { part_key: string; part_name: string; product_code: string | null }

function normalizeJp(s: string) {
  return s.replace(/[\s\u3000]+/g, '').toLowerCase()
}

function formatProductLabel(p: ProductRow): string {
  const spec = String(p.spec ?? '').trim()
  const specSeg = spec ? ` / 規格 ${spec}` : ''
  return `[製品] ${p.name}${specSeg} (${p.product_code})`
}

/** 製品名・規格（spec）のいずれかで完全一致 / 部分一致を判定 */
function productMatchTier(p: ProductRow, nt: string): 'exact' | 'partial' | null {
  const norms: string[] = []
  const nameN = normalizeJp(p.name)
  if (nameN) norms.push(nameN)
  const specStr = String(p.spec ?? '').trim()
  if (specStr) {
    const specN = normalizeJp(specStr)
    if (specN && specN !== nameN) norms.push(specN)
  }
  let hasExact = false
  let hasPartial = false
  for (const pn of norms) {
    if (pn === nt) hasExact = true
    else if (pn.includes(nt) || nt.includes(pn)) hasPartial = true
  }
  if (hasExact) return 'exact'
  if (hasPartial) return 'partial'
  return null
}

export function workOrderRef(w: WorkOrderRow): string {
  const m = (w.model || '').trim()
  return m ? `${w.order_no}|${m}` : w.order_no
}

const SEP = '\x1f'

export function encodeMappingChoice(kind: CandidateKind | 'skip', ref: string) {
  return `${kind}${SEP}${ref ?? ''}`
}

export function decodeMappingChoice(s: string): { kind: CandidateKind | 'skip'; ref: string } | null {
  const i = s.indexOf(SEP)
  if (i < 0) return null
  const kind = s.slice(0, i) as CandidateKind | 'skip'
  const ref = s.slice(i + SEP.length)
  if (kind !== 'product' && kind !== 'line' && kind !== 'work_order' && kind !== 'parts_master' && kind !== 'skip') {
    return null
  }
  return { kind, ref }
}

function pushDedupe(
  out: CandidateOption[],
  seen: Set<string>,
  opt: CandidateOption,
  limit: number
) {
  const k = `${opt.kind}:${opt.ref}`
  if (seen.has(k) || out.filter((o) => `${o.kind}:${o.ref}` === k).length) return
  if (out.length >= limit) return
  seen.add(k)
  out.push(opt)
}

export function buildCandidatePools(
  partName: string,
  products: ProductRow[],
  lines: LineRow[],
  workOrders: WorkOrderRow[],
  partsMaster: PartMasterRow[],
  perSource = 12
): { exact: CandidateOption[]; partial: CandidateOption[] } {
  const t = partName.trim()
  const exact: CandidateOption[] = []
  const partial: CandidateOption[] = []
  const seenE = new Set<string>()
  const seenP = new Set<string>()
  if (!t) return { exact, partial }
  const nt = normalizeJp(t)

  for (const p of products) {
    const tier = productMatchTier(p, nt)
    if (tier === 'exact') {
      pushDedupe(
        exact,
        seenE,
        {
          kind: 'product',
          ref: p.product_code,
          label: formatProductLabel(p),
          tier: 'exact',
        },
        perSource * 4
      )
    } else if (tier === 'partial') {
      pushDedupe(
        partial,
        seenP,
        {
          kind: 'product',
          ref: p.product_code,
          label: formatProductLabel(p),
          tier: 'partial',
        },
        perSource * 4
      )
    }
  }

  for (const l of lines) {
    const ln = normalizeJp(l.name)
    const lc = normalizeJp(l.line_code)
    if (ln === nt || lc === nt) {
      pushDedupe(
        exact,
        seenE,
        {
          kind: 'line',
          ref: l.line_code,
          label: `[ライン] ${l.name} (${l.line_code})`,
          tier: 'exact',
        },
        perSource * 4
      )
    } else if (ln.includes(nt) || nt.includes(ln) || lc.includes(nt) || nt.includes(lc)) {
      pushDedupe(
        partial,
        seenP,
        {
          kind: 'line',
          ref: l.line_code,
          label: `[ライン] ${l.name} (${l.line_code})`,
          tier: 'partial',
        },
        perSource * 4
      )
    }
  }

  for (const w of workOrders) {
    const pn = w.product_name ? normalizeJp(w.product_name) : ''
    const ono = normalizeJp(w.order_no)
    const md = w.model ? normalizeJp(w.model) : ''
    const ref = workOrderRef(w)
    const lab = `[指令] ${w.order_no} ${w.product_name || ''}${w.model ? ` / ${w.model}` : ''}`
    if (pn === nt || ono === nt || (md && md === nt)) {
      pushDedupe(exact, seenE, { kind: 'work_order', ref, label: lab, tier: 'exact' }, perSource * 4)
    } else if (
      (pn && (pn.includes(nt) || nt.includes(pn))) ||
      (ono && (ono.includes(nt) || nt.includes(ono))) ||
      (md && (md.includes(nt) || nt.includes(md)))
    ) {
      pushDedupe(partial, seenP, { kind: 'work_order', ref, label: lab, tier: 'partial' }, perSource * 4)
    }
  }

  for (const pm of partsMaster) {
    const pkn = normalizeJp(pm.part_key)
    const pnn = normalizeJp(pm.part_name)
    if (pkn === nt || pnn === nt) {
      pushDedupe(
        exact,
        seenE,
        {
          kind: 'parts_master',
          ref: pm.part_key,
          label: `[パーツ] ${pm.part_name} (${pm.part_key})${pm.product_code ? ` → ${pm.product_code}` : ''}`,
          tier: 'exact',
        },
        perSource * 4
      )
    } else if (pnn.includes(nt) || nt.includes(pnn) || pkn.includes(nt) || nt.includes(pkn)) {
      pushDedupe(
        partial,
        seenP,
        {
          kind: 'parts_master',
          ref: pm.part_key,
          label: `[パーツ] ${pm.part_name} (${pm.part_key})${pm.product_code ? ` → ${pm.product_code}` : ''}`,
          tier: 'partial',
        },
        perSource * 4
      )
    }
  }

  const exactBySource = (k: CandidateKind) => exact.filter((o) => o.kind === k).slice(0, perSource)
  const partialBySource = (k: CandidateKind) => partial.filter((o) => o.kind === k).slice(0, perSource)

  const exactLimited: CandidateOption[] = []
  const se2 = new Set<string>()
  for (const k of ['product', 'line', 'work_order', 'parts_master'] as CandidateKind[]) {
    for (const o of exactBySource(k)) pushDedupe(exactLimited, se2, o, perSource * 4)
  }
  const partialLimited: CandidateOption[] = []
  const sp2 = new Set<string>()
  for (const k of ['product', 'line', 'work_order', 'parts_master'] as CandidateKind[]) {
    for (const o of partialBySource(k)) pushDedupe(partialLimited, sp2, o, perSource * 4)
  }

  return { exact: exactLimited, partial: partialLimited }
}

export function defaultMappingFromAuto(
  partName: string,
  products: ProductRow[],
  lines: LineRow[],
  workOrders: WorkOrderRow[],
  partsMaster: PartMasterRow[]
): { kind: CandidateKind | 'skip'; ref: string } | null {
  const { exact, partial } = buildCandidatePools(partName, products, lines, workOrders, partsMaster, 20)
  if (exact.length === 1) {
    return { kind: exact[0].kind, ref: exact[0].ref }
  }
  if (exact.length === 0 && partial.length === 1) {
    return { kind: partial[0].kind, ref: partial[0].ref }
  }
  return null
}
