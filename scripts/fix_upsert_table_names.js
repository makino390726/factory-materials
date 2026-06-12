#!/usr/bin/env node
const fs = require('fs')
const path = require('path')

function parseArgs() {
  const args = process.argv.slice(2)
  const out = { dir: 'imports/sql/upsert', map: 'bom:heater_bom' }
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '--dir') out.dir = args[++i]
    else if (a === '--map') out.map = args[++i]
  }
  return out
}

function parseMap(m) {
  const map = {}
  if (!m) return map
  m.split(';').forEach(pair => {
    const [from, to] = pair.split(':').map(s => s && s.trim())
    if (from && to) map[from] = to
  })
  return map
}

function replaceInFile(filePath, map) {
  let s = fs.readFileSync(filePath, 'utf8')
  for (const from in map) {
    const to = map[from]
    const ef = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    // replace table name in INSERT INTO and CREATE TABLE if present
    const reInsert = new RegExp('\\bINSERT\\s+INTO\\s+' + ef + '\\b','gi')
    s = s.replace(reInsert, `INSERT INTO ${to}`)
    const reCreate = new RegExp('\\bCREATE\\s+TABLE\\s+' + ef + '\\b','gi')
    s = s.replace(reCreate, `CREATE TABLE ${to}`)
  }
  fs.writeFileSync(filePath, s, 'utf8')
}

async function main() {
  const args = parseArgs()
  const dir = args.dir
  const map = parseMap(args.map)
  if (!fs.existsSync(dir)) {
    console.error('Directory not found:', dir)
    process.exit(1)
  }
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql'))
  for (const f of files) {
    const p = path.join(dir, f)
    replaceInFile(p, map)
    console.log('Patched', p)
  }
}

main().catch(e => { console.error(e); process.exit(1) })
