#!/usr/bin/env node
const fs = require('fs')
const inPath = 'imports/sql/bom_replace.sql'
const outPath = 'imports/sql/upsert/heater_bom_upsert.sql'
if (!fs.existsSync(inPath)) { console.error('input not found:', inPath); process.exit(1) }
const s = fs.readFileSync(inPath, 'utf8')
const lines = s.split(/\r?\n/)
const out = []
function parseValues(str) {
  const vals = []
  let cur = ''
  let inQ = false
  for (let i = 0; i < str.length; i++) {
    const ch = str[i]
    if (ch === "'") {
      cur += ch
      i++
      while (i < str.length) {
        const c2 = str[i]
        cur += c2
        if (c2 === "'") { break }
        i++
      }
    } else if (ch === ',') {
      vals.push(cur.trim())
      cur = ''
    } else {
      cur += ch
    }
  }
  if (cur.trim() !== '') vals.push(cur.trim())
  return vals
}

for (const L of lines) {
  const m = L.match(/INSERT\s+INTO\s+bom\s*\([^)]*\)\s*VALUES\s*\((.*)\)\s*;/i)
  if (!m) continue
  const valsText = m[1]
  const vals = parseValues(valsText)
  // expect at least 4 columns: [0]=model, [1]=part_key, [2]=part_name, [3]=qty
  if (vals.length < 4) continue
  const model = vals[0]
  const part_key = vals[1]
  const qty = vals[3]
  // NOTE: target table heater_bom may not have 'unit' or 'part_name' columns.
  // Only upsert model, part_key, qty_per_unit and update qty_per_unit on conflict.
  const insert = `INSERT INTO heater_bom (model, part_key, qty_per_unit) VALUES (${model}, ${part_key}, ${qty}) ON CONFLICT (model, part_key) DO UPDATE SET qty_per_unit=EXCLUDED.qty_per_unit;`
  out.push(insert)
}

fs.writeFileSync(outPath, out.join('\n') + '\n', 'utf8')
console.log('Wrote', outPath)
