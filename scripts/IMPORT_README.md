Import Excel -> SQL
===================

This script reads an Excel workbook and generates SQL files to replace tables (drop + create + inserts).

Prerequisites
-------------
- Node.js (16+)
- Install required packages in the workspace:

```bash
npm install xlsx pg
```

Usage
-----

Generate SQL files (default reads `imports/パーツマスタ.xlsx` and maps first sheet -> `parts_master`, second -> `bom`):

```bash
node scripts/import_excel_to_sql.js --file imports/パーツマスタ.xlsx --out imports/sql
```

Specify sheet->table mapping (comma separated pairs):

```bash
node scripts/import_excel_to_sql.js --file imports/パーツマスタ.xlsx --map "Parts:parts_master,BOM:bom" --out imports/sql

Primary keys and indexes
------------------------

You can specify primary key columns and indexes per table when generating SQL.

- `--pk` takes semicolon-separated table:cols pairs. Example:

```
--pk "parts_master:id,part_no;bom:id"
```

This will add `PRIMARY KEY (id, part_no)` to the `parts_master` create statement and `PRIMARY KEY (id)` to `bom`.

- `--indexes` (or `--idx`) takes semicolon-separated table:cols pairs to create indexes after table creation. Example:

```
--indexes "parts_master:part_no;bom:product_code,line_no"
```

This will append `CREATE INDEX IF NOT EXISTS idx_parts_master_part_no ON parts_master (part_no);` etc.

When using these options, provide column names that match the sanitized column names generated from the Excel headers (spaces replaced with underscores, lowercased).
```

Generate and execute directly against Postgres (provide connection string):

```bash
node scripts/import_excel_to_sql.js --file imports/パーツマスタ.xlsx --map "Parts:parts_master,BOM:bom" --out imports/sql --exec --conn "postgres://user:pass@host:5432/db"
```

Notes
-----
- The script infers column types (integer, numeric, text) from data.
- It will DROP TABLE IF EXISTS <table> CASCADE and CREATE TABLE with inferred columns, then INSERT rows.
- Backups are not created by the script. If you need backups, export existing tables before running.
