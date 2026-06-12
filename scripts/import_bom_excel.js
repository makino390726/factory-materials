#!/usr/bin/env node
/**
 * Excel BOMファイルをheater_bomテーブル用SQLに変換
 * 
 * 使用方法:
 *   node scripts/import_bom_excel.js <Excelファイルパス>
 * 
 * Excelフォーマット（1行目はヘッダー）:
 *   | 機種名 | 部品キー | 部品名 | 数量 |
 * 
 * 出力: imports/sql/heater_bom_import.sql
 */

const xlsx = require('xlsx');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('使用方法: node scripts/import_bom_excel.js <Excelファイルパス>');
  console.error('例: node scripts/import_bom_excel.js BOM_data.xlsx');
  process.exit(1);
}

const excelPath = args[0];
if (!fs.existsSync(excelPath)) {
  console.error(`ファイルが見つかりません: ${excelPath}`);
  process.exit(1);
}

console.log(`Excelファイルを読み込み中: ${excelPath}`);
const workbook = xlsx.readFile(excelPath);
const sheetName = workbook.SheetNames[0];
const sheet = workbook.Sheets[sheetName];
const data = xlsx.utils.sheet_to_json(sheet);

console.log(`${data.length}行のデータを検出`);

// SQLファイル生成
const outputPath = 'imports/sql/heater_bom_import.sql';
let sql = `-- heater_bom インポート用SQL
-- 生成日時: ${new Date().toISOString()}
-- ソースファイル: ${path.basename(excelPath)}

-- 既存データを削除して再作成
DROP TABLE IF EXISTS heater_bom CASCADE;

CREATE TABLE heater_bom (
  model TEXT NOT NULL,
  part_key TEXT NOT NULL,
  part_name TEXT,
  quantity NUMERIC NOT NULL DEFAULT 1,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  PRIMARY KEY (model, part_key)
);

-- インデックス作成
CREATE INDEX idx_heater_bom_model ON heater_bom(model);
CREATE INDEX idx_heater_bom_part_key ON heater_bom(part_key);

-- データ挿入
`;

let insertCount = 0;
let errorCount = 0;

for (const row of data) {
  // カラム名の柔軟な対応（日本語・英語両対応）
  const model = row['機種名'] || row['機種'] || row['model'] || row['Model'];
  const partKey = row['部品キー'] || row['部品コード'] || row['part_key'] || row['PartKey'];
  const partName = row['部品名'] || row['名称'] || row['part_name'] || row['PartName'];
  const quantity = row['数量'] || row['qty'] || row['quantity'] || 1;

  if (!model || !partKey) {
    console.warn(`スキップ: 機種名または部品キーがありません`, row);
    errorCount++;
    continue;
  }

  // SQL値のエスケープ
  const escapedModel = model.toString().replace(/'/g, "''");
  const escapedPartKey = partKey.toString().replace(/'/g, "''");
  const escapedPartName = partName ? partName.toString().replace(/'/g, "''") : '';
  const qty = parseFloat(quantity) || 1;

  sql += `INSERT INTO heater_bom (model, part_key, part_name, quantity) VALUES ('${escapedModel}', '${escapedPartKey}', '${escapedPartName}', ${qty});\n`;
  insertCount++;
}

sql += `\n-- 挿入完了: ${insertCount}件`;
if (errorCount > 0) {
  sql += `\n-- エラー: ${errorCount}件`;
}

// ファイル出力
fs.writeFileSync(outputPath, sql, 'utf8');

console.log(`\n✅ SQLファイル生成完了: ${outputPath}`);
console.log(`   挿入データ: ${insertCount}件`);
if (errorCount > 0) {
  console.log(`   ⚠️ エラー: ${errorCount}件`);
}
console.log(`\n次のステップ:`);
console.log(`1. Supabase SQL Editorで ${outputPath} を実行`);
console.log(`2. または psql コマンドで実行:`);
console.log(`   psql <接続文字列> -f ${outputPath}`);
