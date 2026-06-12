#!/usr/bin/env node
const fs = require('fs')
const inPath = 'imports/sql/upsert/parts_master_upsert.sql'
const outPath = 'imports/sql/upsert/heater_parts_master_upsert.sql'
if (!fs.existsSync(inPath)) { console.error('input not found:', inPath); process.exit(1) }
const s = fs.readFileSync(inPath, 'utf8')
const lines = s.split(/\r?\n/).filter(Boolean)
const out = []
for (const L of lines) {
  const m = L.match(/VALUES\s*\((.*)\)\s*ON\s+CONFLICT/i)
  if (!m) continue
  const valsText = m[1]
  const vals = []
  let cur = ''
  for (let i=0;i<valsText.length;i++){
    const ch = valsText[i]
    if (ch === "'") {
      cur += ch
      i++
      while (i<valsText.length){ cur += valsText[i]; if (valsText[i]==="'") break; i++ }
    } else if (ch === ',') { vals.push(cur.trim()); cur = '' } else { cur += ch }
  }
  if (cur.trim()!=='') vals.push(cur.trim())
  if (vals.length < 2) continue
  const part_key = vals[0]
  const part_name = vals[1]
  // cost may be in the 3rd column; parse numeric or use 0
  let cost = '0'
  if (vals.length >= 3) {
    const v = vals[2]
    // remove quotes if present
    const nc = v.replace(/^'(.*)'$/, '$1')
    const num = Number(nc)
    if (!Number.isNaN(num)) cost = String(num)
  }
  const insert = `INSERT INTO heater_parts_master (part_key, part_name, cost_price) VALUES (${part_key}, ${part_name}, ${cost}) ON CONFLICT (part_key) DO UPDATE SET part_name=EXCLUDED.part_name, cost_price=EXCLUDED.cost_price;`
  out.push(insert)
}
fs.writeFileSync(outPath, out.join('\n') + '\n', 'utf8')
console.log('Wrote', outPath)
