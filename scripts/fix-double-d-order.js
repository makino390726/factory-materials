const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')

const DB_LITERALS = [
  "'指令原価'",
  '"指令原価"',
  "'ライン原価'",
  '"ライン原価"',
  "'指令全体'",
  '"指令全体"',
  "'指令番号'",
  '"指令番号"',
  "'ラインコード'",
  '"ラインコード"',
  "'ライン名'",
  '"ライン名"',
  "'作業指令番号'",
  '"作業指令番号"',
]

function transformDisplayText(text) {
  let s = text
  const restored = []
  DB_LITERALS.forEach((literal, index) => {
    const placeholder = `__DB_LITERAL_${index}__`
    s = s.split(literal).join(placeholder)
    restored.push({ placeholder, value: literal })
  })

  s = s
    .replace(/インライン/g, '__INLINE__')
    .replace(/D指令/g, '__D_ORDER__')
    .replace(/L指令/g, '__L_ORDER__')
    .replace(/作業指令マスタ/g, 'D指令マスタ')
    .replace(/作業指令一覧/g, 'D指令一覧')
    .replace(/作業指令番号/g, 'D指令番号')
    .replace(/作業指令/g, 'D指令')
    .replace(/指令原価/g, 'D指令原価')
    .replace(/指令BOM/g, 'D指令BOM')
    .replace(/指令書/g, 'D指令書')
    .replace(/指令番号/g, 'D指令番号')
    .replace(/指令マスタ/g, 'D指令マスタ')
    .replace(/(?<!D)指令/g, 'D指令')
    .replace(/ラインマスタ/g, 'L指令マスタ')
    .replace(/ライン原価/g, 'L指令原価')
    .replace(/ラインコード/g, 'L指令コード')
    .replace(/ライン名/g, 'L指令名')
    .replace(/(?<!L)ライン/g, 'L指令')
    .replace(/__D_ORDER__/g, 'D指令')
    .replace(/__L_ORDER__/g, 'L指令')
    .replace(/__INLINE__/g, 'インライン')
    .replace(/D{2,}指令/g, 'D指令')

  for (const { placeholder, value } of restored) {
    s = s.split(placeholder).join(value)
  }

  return s
}

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.next') continue
      walk(full, files)
    } else if (entry.isFile() && (full.endsWith('.tsx') || full.endsWith('.ts'))) {
      if (full.includes(`${path.sep}scripts${path.sep}`)) continue
      files.push(full)
    }
  }
  return files
}

const targets = walk(path.join(ROOT, 'app')).concat(
  path.join(ROOT, 'lib', 'ec30-bom-candidates.ts'),
  path.join(ROOT, 'lib', 'line-part-labor-cost.ts')
)

let changed = 0
for (const file of targets) {
  const original = fs.readFileSync(file, 'utf8')
  let next = original.replace(/D{2,}指令/g, 'D指令')
  if (next !== original) {
    fs.writeFileSync(file, next, 'utf8')
    changed += 1
    console.log('fixed double D:', path.relative(ROOT, file))
  }
}

console.log(`Fixed ${changed} files`)
