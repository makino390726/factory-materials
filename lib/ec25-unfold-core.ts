/**
 * 展開数量の型と概算。クライアントでも読める（fs を使わない）。
 */

import { extractDimensionMm, type Ec25ParsedPart, type Ec25QtyUnit } from '@/lib/ec25-drawing-bom'

export type UnfoldSource = 'heuristic' | 'ai' | 'manual' | 'excel'

export type UnfoldResult = {
  unfoldable: boolean
  qty_per_part: number
  qty_unit: Ec25QtyUnit
  unfolded_width_mm: number | null
  unfolded_length_mm: number | null
  area_m2: number | null
  length_m: number | null
  bends: number | null
  confidence: number
  source: UnfoldSource
  notes: string
  model?: string
}

export function heuristicUnfold(part: Ec25ParsedPart): UnfoldResult {
  const blob = `${part.material_raw} ${part.note} ${part.part_name}`
  const dim = extractDimensionMm(blob)

  if (part.kind === 'assembly') {
    return {
      unfoldable: false,
      qty_per_part: 0,
      qty_unit: 'set',
      unfolded_width_mm: null,
      unfolded_length_mm: null,
      area_m2: null,
      length_m: null,
      bends: null,
      confidence: 1,
      source: 'excel',
      notes: '組立図・外形図は展開対象外',
    }
  }

  if (part.kind === 'fastener' || part.kind === 'purchased') {
    return {
      unfoldable: false,
      qty_per_part: 1,
      qty_unit: part.qty_unit,
      unfolded_width_mm: null,
      unfolded_length_mm: null,
      area_m2: null,
      length_m: part.qty_unit === 'm' ? part.qty_pieces : null,
      bends: null,
      confidence: 0.9,
      source: 'excel',
      notes: '購入品・ビス類は図番管理表の数量を採用',
    }
  }

  if (part.kind === 'profile') {
    if (part.qty_unit === 'm') {
      return {
        unfoldable: true,
        qty_per_part: 1,
        qty_unit: 'm',
        unfolded_width_mm: null,
        unfolded_length_mm: null,
        area_m2: null,
        length_m: 1,
        bends: null,
        confidence: 0.7,
        source: 'excel',
        notes: '形鋼・パイプは表の長さ数量を使用',
      }
    }
    return {
      unfoldable: true,
      qty_per_part: 1,
      qty_unit: 'pcs',
      unfolded_width_mm: dim?.w ?? null,
      unfolded_length_mm: dim?.h ?? null,
      area_m2: null,
      length_m: dim ? Number(((dim.w + dim.h) / 1000).toFixed(4)) : null,
      bends: null,
      confidence: dim ? 0.45 : 0.2,
      source: 'heuristic',
      notes: dim ? `備考寸法 ${dim.w}×${dim.h} から概算。AI展開で精度を上げてください` : '形鋼。図面展開で長さを算出してください',
    }
  }

  if (dim) {
    const area = Number(((dim.w * dim.h) / 1_000_000).toFixed(6))
    return {
      unfoldable: true,
      qty_per_part: area,
      qty_unit: 'm2',
      unfolded_width_mm: dim.w,
      unfolded_length_mm: dim.h,
      area_m2: area,
      length_m: null,
      bends: null,
      confidence: 0.55,
      source: 'heuristic',
      notes: `記載寸法 ${dim.w}×${dim.h}mm の矩形面積。曲げ代は未加算`,
    }
  }

  return {
    unfoldable: true,
    qty_per_part: 1,
    qty_unit: 'pcs',
    unfolded_width_mm: null,
    unfolded_length_mm: null,
    area_m2: null,
    length_m: null,
    bends: null,
    confidence: 0.15,
    source: 'heuristic',
    notes: '寸法不明。員数×1枚で仮置き。AI展開または手入力が必要',
  }
}

export function totalCostQty(part: Ec25ParsedPart, unfold: UnfoldResult): { qty: number; unit: Ec25QtyUnit } {
  if (!part.include || part.kind === 'assembly') return { qty: 0, unit: unfold.qty_unit }
  if (unfold.source === 'excel' && (part.kind === 'fastener' || part.kind === 'purchased')) {
    return { qty: part.qty_pieces, unit: part.qty_unit }
  }
  if (unfold.qty_unit === 'pcs' || unfold.qty_unit === 'set') {
    return { qty: Number((part.qty_pieces * (unfold.qty_per_part || 1)).toFixed(4)), unit: unfold.qty_unit }
  }
  return {
    qty: Number((part.qty_pieces * (unfold.qty_per_part || 0)).toFixed(6)),
    unit: unfold.qty_unit,
  }
}
