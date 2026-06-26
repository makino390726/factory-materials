const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

function csvEscape(v) {
  const s = v == null ? '' : String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

(async () => {
  let offset = 0;
  let all = [];
  while (true) {
    const { data, error } = await supabase
      .from('stocks_with_name')
      .select('product_code, name, stock_qty, unit_price, total_amount')
      .order('product_code')
      .range(offset, offset + 999);
    if (error) {
      console.error(error);
      process.exit(1);
    }
    if (!data || !data.length) break;
    all = all.concat(data);
    if (data.length < 1000) break;
    offset += 1000;
  }

  const rows = all.filter(
    (r) =>
      (r.stock_qty || 0) > 0 &&
      (r.unit_price == null || Number(r.unit_price) === 0)
  );

  const header = ['商品コード', '製品名', '在庫数', '単価', '在庫金額'];
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push(
      [
        csvEscape(r.product_code),
        csvEscape(r.name),
        csvEscape(r.stock_qty),
        csvEscape(r.unit_price ?? ''),
        csvEscape(r.total_amount ?? ''),
      ].join(',')
    );
  }

  const bom = '\uFEFF';
  const date = new Date().toISOString().slice(0, 10);
  const outPath = path.join(
    __dirname,
    '..',
    'exports',
    `in-stock-no-unit-price-${date}.csv`
  );
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, bom + lines.join('\r\n'), 'utf8');
  console.log('出力:', outPath);
  console.log('件数:', rows.length);
})();
