#!/usr/bin/env node
const fs = require('fs')
const p = 'imports/sql/upsert/bom_upsert.sql'
if (!fs.existsSync(p)) { console.error('file not found:', p); process.exit(1) }
let s = fs.readFileSync(p, 'utf8')
// replace column list of five 'col' with proper columns
const cols = ['model','part_key','part_name','qty_per_unit','unit']
// replace INSERT column lists
s = s.replace(/INSERT INTO heater_bom \((?:col\s*,\s*){4}col\)/g, `INSERT INTO heater_bom (${cols.join(', ')})`)
// replace ON CONFLICT SET list: remove PKs from update
const setReplacement = `ON CONFLICT (model, part_key) DO UPDATE SET ${cols.slice(2).map(c=>`${c}=EXCLUDED.${c}`).join(', ')}`
s = s.replace(/ON CONFLICT \(model, part_key\) DO UPDATE SET (?:col=EXCLUDED\.col,?\s*){5}/g, setReplacement)
// also handle patterns where SET repeats without trailing comma sequences
s = s.replace(/ON CONFLICT \(model, part_key\) DO UPDATE SET (?:col=EXCLUDED\.col(?:,\s*)?){1,5}/g, setReplacement)

fs.writeFileSync(p, s, 'utf8')
console.log('Patched', p)
