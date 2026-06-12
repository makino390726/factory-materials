#!/usr/bin/env node
const fs = require('fs')
const path = require('path')

function parseArgs() {
  const args = process.argv.slice(2)
  const out = { inDir: 'imports/sql', outDir: 'imports/sql/upsert', pk: '' }
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '--in') out.inDir = args[++i]
    else if (a === '--out') out.outDir = args[++i]
    else if (a === '--pk') out.pk = args[++i]
  }
  return out
}

function sanitize(s) { return s && s.trim() }

function parsePkMap(pkArg) {
  const map = {}
  if (!pkArg) return map
  pkArg.split(';').forEach(pair => {
    const [t, cols] = pair.split(':').map(s => s && s.trim())
    if (t && cols) map[t] = cols.split(',').map(c => c.trim())
  })
  return map
}

function extractInserts(sql, table) {
  const inserts = []
  const re = new RegExp('INSERT\\s+INTO\\s+' + table + '\\s*\\(([^)]+)\\)\\s*VALUES\\s*\\(([^;]+?)\\)\\s*;', 'gim')
  let m
  while ((m = re.exec(sql)) !== null) {
    const cols = m[1].split(',').map(s => s.trim())
    const vals = m[2].trim()
    inserts.push({ cols, vals })
  }
  return inserts
}

function extractTableFromCreate(sql) {
  const m = sql.match(/CREATE\s+TABLE\s+(\w+)\s*\(([^;]+?)\)\s*;/im)
  if (!m) return null
  const table = m[1]
  const cols = m[2].split(/,\n/).map(l => {
    const p = l.trim().split(/\s+/)
    return p[0] ? p[0].replace(/[,\)]+$/, '').trim() : null
  }).filter(Boolean)
  return { table, cols }
}

function buildUpsert(table, cols, vals, pkCols) {
  if (!pkCols || pkCols.length === 0) throw new Error('PK not provided for ' + table)
  const setCols = cols.filter(c => !pkCols.includes(c)).map(c => `${c}=EXCLUDED.${c}`)
  return `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${vals}) ON CONFLICT (${pkCols.join(', ')}) DO UPDATE SET ${setCols.join(', ')};`
}

async function main() {
  const args = parseArgs()
  const inDir = args.inDir
  const outDir = args.outDir
  const pkMap = parsePkMap(args.pk || 'parts_master:part_key; bom:model,part_key')

  if (!fs.existsSync(inDir)) {
    console.error('Input directory not found:', inDir)
    process.exit(1)
  }
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true })

  const files = fs.readdirSync(inDir).filter(f => f.endsWith('.sql'))
  for (const f of files) {
    const p = path.join(inDir, f)
    const sql = fs.readFileSync(p, 'utf8')
    const createInfo = extractTableFromCreate(sql)
    if (!createInfo) continue
    const table = createInfo.table
    const pkCols = (pkMap[table] || pkMap[table.toLowerCase()] || pkMap[table.toUpperCase()])
    if (!pkCols) {
      console.warn(`Skipping ${table}: no PK specified`)
      continue
    }
    const inserts = extractInserts(sql, table)
    if (!inserts || inserts.length === 0) {
      console.warn(`No INSERTs found for ${table} in ${f}`)
      continue
    }
    const outLines = []
    for (const ins of inserts) {
      const cols = ins.cols.map(c => c)
      const vals = ins.vals
      try {
        const up = buildUpsert(table, cols, vals, pkCols)
        outLines.push(up)
      } catch (e) {
        console.error('Failed to build upsert for', table, e.message)
      }
    }
    const outPath = path.join(outDir, `${table}_upsert.sql`)
    fs.writeFileSync(outPath, outLines.join('\n') + '\n', 'utf8')
    console.log('Wrote', outPath)
  }
}

main().catch(e => { console.error(e); process.exit(1) })
