/**
 * 展開図から必要数量を算出する。
 * 概算は ec25-unfold-core。Vision API と .env 読みはサーバ専用。
 */

import { drawingSpecMaterial, type Ec25ParsedPart, type Ec25QtyUnit } from '@/lib/ec25-drawing-bom'
import { heuristicUnfold, type UnfoldResult } from '@/lib/ec25-unfold-core'

export type { UnfoldResult, UnfoldSource } from '@/lib/ec25-unfold-core'
export { heuristicUnfold, totalCostQty } from '@/lib/ec25-unfold-core'

export type DrawingAiConfig = {
  provider: 'openai' | 'anthropic' | null
  model: string
  apiKey: string
  baseUrl?: string
}

function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const i = line.indexOf('=')
    if (i <= 0) continue
    const key = line.slice(0, i).trim()
    let value = line.slice(i + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    out[key] = value
  }
  return out
}

function envFromLocalFile(): Record<string, string> {
  try {
    const fs = require('fs') as typeof import('fs')
    const path = require('path') as typeof import('path')
    const file = path.join(process.cwd(), '.env.local')
    if (!fs.existsSync(file)) return {}
    return parseEnvFile(fs.readFileSync(file, 'utf8'))
  } catch {
    return {}
  }
}

function usableSecret(value: string): boolean {
  const v = value.trim()
  if (!v) return false
  if (v === '...' || v === 'your-key-here' || v === 'sk-...' || v === 'sk-proj-...') return false
  return true
}

function readEnv(name: string): string {
  // ブラケット参照にしないと Next.js が起動時の空文字を埋め込み、再起動しても未設定のままになる
  const fromProcess = String(process.env[name] || '').trim()
  if (usableSecret(fromProcess) || (name.includes('MODEL') && fromProcess)) return fromProcess
  const fromFile = String(envFromLocalFile()[name] || '').trim()
  return fromFile
}

export function resolveDrawingAiConfig(): DrawingAiConfig {
  const overrideModel = readEnv('DRAWING_AI_MODEL')
  const drawingKey = readEnv('DRAWING_AI_API_KEY')
  const openaiKey = readEnv('OPENAI_API_KEY')
  const anthropicKey = readEnv('ANTHROPIC_API_KEY')
  const baseUrl = readEnv('DRAWING_AI_BASE_URL') || readEnv('OPENAI_BASE_URL')
  const prefer = readEnv('DRAWING_AI_PROVIDER').toLowerCase()

  if (prefer === 'anthropic' && (usableSecret(drawingKey) || usableSecret(anthropicKey))) {
    return {
      provider: 'anthropic',
      model: overrideModel || 'claude-opus-4-6',
      apiKey: drawingKey || anthropicKey,
    }
  }
  if (prefer === 'openai' && (usableSecret(drawingKey) || usableSecret(openaiKey))) {
    return {
      provider: 'openai',
      model: overrideModel || 'gpt-4o',
      apiKey: drawingKey || openaiKey,
      baseUrl: baseUrl || undefined,
    }
  }
  if (usableSecret(anthropicKey) || (usableSecret(drawingKey) && !usableSecret(openaiKey) && prefer !== 'openai')) {
    return {
      provider: 'anthropic',
      model: overrideModel || 'claude-opus-4-6',
      apiKey: drawingKey || anthropicKey,
    }
  }
  if (usableSecret(openaiKey) || usableSecret(drawingKey)) {
    return {
      provider: 'openai',
      model: overrideModel || 'gpt-4o',
      apiKey: drawingKey || openaiKey,
      baseUrl: baseUrl || undefined,
    }
  }
  return { provider: null, model: overrideModel || '', apiKey: '' }
}

const UNFOLD_SYSTEM = `あなたは板金展開・原価積算の熟練技術者です。
スキャンされた製作図面（タイトルブロック付き）を読み、指定部品の展開図（flat pattern）に必要な材料数量を算出します。

規則:
- 組立図・外形図・assy は unfoldable=false
- 構成要素の1番目は図面タイトル欄の材質（図面仕様材料名）。必要量（原価数量）はこの材料についてだけ算出する
- 2番目以降の構成要素は展開しない
- 板金（ZAM/SPHC/SGCC/カラー鋼板など）は曲げを展開し、unfolded_width_mm × unfolded_length_mm と area_m2 を出す
- 曲げ代は板厚 t と曲げ数から簡易加算（1曲げあたり約 0.4×t）。不明なら外形の足し算でよい
- 形鋼・パイプ・FB は length_m を優先
- 単位は m2（板）または m（形鋼）または pcs
- 寸法が読めない場合は confidence を下げ、notes に理由を書く
- 数値は図面の寸法線を優先。推測したら notes に明記
- JSON 以外は出力しない`

export function buildUnfoldUserPrompt(part: Ec25ParsedPart): string {
  const spec = drawingSpecMaterial(part)
  const extras = (part.materials || []).filter((m) => m.drawing_spec === false && m.raw && m.raw !== spec?.raw)
  return [
    `図面番号(パーツキー): ${part.part_key}`,
    `部品名(パーツ名): ${part.part_name}`,
    `図面仕様材料名(構成要素1): ${spec?.raw || part.material_raw}`,
    `その他構成要素(展開しない): ${extras.map((m) => m.raw).join(', ') || 'なし'}`,
    `員数(発生機+乾燥室): ${part.qty_pieces} ${part.qty_unit}`,
    `備考: ${part.note || '（なし）'}`,
    `区分: ${part.kind}`,
    '',
    '次の JSON だけを返してください:',
    '{',
    '  "unfoldable": true,',
    '  "qty_per_part": 0.0,',
    '  "qty_unit": "m2",',
    '  "unfolded_width_mm": 0,',
    '  "unfolded_length_mm": 0,',
    '  "area_m2": 0.0,',
    '  "length_m": null,',
    '  "bends": 0,',
    '  "confidence": 0.0,',
    '  "notes": ""',
    '}',
  ].join('\n')
}

type AiJson = Partial<UnfoldResult> & { unfoldable?: boolean }

function parseAiJson(text: string): AiJson | null {
  const trimmed = String(text || '').trim()
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
  const body = fence ? fence[1] : trimmed
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(body.slice(start, end + 1)) as AiJson
  } catch {
    return null
  }
}

function toUnfoldResult(raw: AiJson | null, model: string, fallback: UnfoldResult): UnfoldResult {
  if (!raw) {
    return { ...fallback, notes: `${fallback.notes} / AI応答を解析できませんでした`, model }
  }
  const unit = (raw.qty_unit === 'm' || raw.qty_unit === 'm2' || raw.qty_unit === 'pcs' || raw.qty_unit === 'set'
    ? raw.qty_unit
    : fallback.qty_unit) as Ec25QtyUnit
  const qty = Number(raw.qty_per_part)
  return {
    unfoldable: raw.unfoldable !== false,
    qty_per_part: Number.isFinite(qty) ? qty : fallback.qty_per_part,
    qty_unit: unit,
    unfolded_width_mm: raw.unfolded_width_mm ?? fallback.unfolded_width_mm,
    unfolded_length_mm: raw.unfolded_length_mm ?? fallback.unfolded_length_mm,
    area_m2: raw.area_m2 ?? fallback.area_m2,
    length_m: raw.length_m ?? fallback.length_m,
    bends: raw.bends ?? fallback.bends,
    confidence: Number.isFinite(Number(raw.confidence)) ? Number(raw.confidence) : 0.5,
    source: 'ai',
    notes: String(raw.notes || 'AI展開'),
    model,
  }
}

async function callOpenAiVision(
  cfg: DrawingAiConfig,
  system: string,
  prompt: string,
  images: { base64: string; mime: string }[],
  maxTokens = 1200
): Promise<string> {
  const url = `${(cfg.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '')}/chat/completions`
  const content: Array<Record<string, unknown>> = [{ type: 'text', text: prompt }]
  for (const img of images) {
    content.push({
      type: 'image_url',
      image_url: { url: `data:${img.mime};base64,${img.base64}`, detail: 'high' },
    })
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: cfg.model,
      temperature: 0.1,
      max_tokens: maxTokens,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content },
      ],
    }),
  })
  if (!res.ok) {
    const t = await res.text()
    throw new Error(`OpenAI Vision 失敗 (${res.status}): ${t.slice(0, 500)}`)
  }
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
  return data.choices?.[0]?.message?.content || ''
}

async function callAnthropicVision(
  cfg: DrawingAiConfig,
  system: string,
  prompt: string,
  images: { base64: string; mime: string }[],
  maxTokens = 1200
): Promise<string> {
  const content: Array<Record<string, unknown>> = [{ type: 'text', text: prompt }]
  for (const img of images) {
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: img.mime, data: img.base64 },
    })
  }
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': cfg.apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: cfg.model,
      max_tokens: maxTokens,
      temperature: 0.1,
      system,
      messages: [{ role: 'user', content }],
    }),
  })
  if (!res.ok) {
    const t = await res.text()
    throw new Error(`Anthropic Vision 失敗 (${res.status}): ${t.slice(0, 500)}`)
  }
  const data = (await res.json()) as { content?: { type: string; text?: string }[] }
  return (data.content || []).filter((c) => c.type === 'text').map((c) => c.text || '').join('\n')
}

export async function callDrawingVisionJson(
  system: string,
  prompt: string,
  images: { base64: string; mime?: string }[],
  maxTokens = 3500
): Promise<string> {
  const cfg = resolveDrawingAiConfig()
  if (!cfg.provider) {
    throw new Error('Vision API 未設定です（OPENAI_API_KEY または ANTHROPIC_API_KEY）')
  }
  const imgs = images.map((img) => ({ base64: img.base64, mime: img.mime || 'image/png' }))
  return cfg.provider === 'anthropic'
    ? callAnthropicVision(cfg, system, prompt, imgs, maxTokens)
    : callOpenAiVision(cfg, system, prompt, imgs, maxTokens)
}

export function parseVisionJsonObject(text: string): Record<string, unknown> | null {
  return parseAiJson(text) as Record<string, unknown> | null
}

export async function unfoldPartWithAi(
  part: Ec25ParsedPart,
  imageBase64: string,
  mime = 'image/png'
): Promise<UnfoldResult> {
  const fallback = heuristicUnfold(part)
  const cfg = resolveDrawingAiConfig()
  if (!cfg.provider) {
    return { ...fallback, notes: `${fallback.notes}（DRAWING_AI_API_KEY / ANTHROPIC_API_KEY / OPENAI_API_KEY 未設定）` }
  }
  const prompt = buildUnfoldUserPrompt(part)
  const imgs = [{ base64: imageBase64, mime }]
  const text =
    cfg.provider === 'anthropic'
      ? await callAnthropicVision(cfg, UNFOLD_SYSTEM, prompt, imgs)
      : await callOpenAiVision(cfg, UNFOLD_SYSTEM, prompt, imgs)
  return toUnfoldResult(parseAiJson(text), cfg.model, fallback)
}
