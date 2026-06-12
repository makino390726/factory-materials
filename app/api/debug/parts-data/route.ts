import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function GET() {
  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // 1. heater_parts_master のサンプルデータを取得（天枠を含む）
    const { data: parts, error: partsError } = await supabase
      .from('heater_parts_master')
      .select('*')
      .or('part_name.ilike.%天枠%,part_name.ilike.%天板%')
      .limit(5);

    if (partsError) throw partsError;

    // 2. work_order_cost_items でライン原価のデータを取得
    const { data: costItems, error: costItemsError } = await supabase
      .from('work_order_cost_items')
      .select('*')
      .eq('master_type', 'ライン原価')
      .limit(10);

    if (costItemsError) throw costItemsError;

    // 3. material_cost_total と indirect_cost_total が存在するかチェック
    const hasCostColumns = parts && parts.length > 0 && 
      ('material_cost_total' in parts[0] || 'indirect_cost_total' in parts[0]);

    return NextResponse.json({
      debug: {
        timestamp: new Date().toISOString(),
        parts_sample: parts,
        parts_count: parts?.length || 0,
        has_cost_columns: hasCostColumns,
        cost_items_sample: costItems,
        cost_items_count: costItems?.length || 0,
        note: hasCostColumns 
          ? 'heater_parts_master has material_cost_total and indirect_cost_total columns'
          : 'MIGRATION NEEDED: Run migrate-add-parts-master-cost-totals.sql'
      }
    });
  } catch (err: any) {
    console.error('Debug API error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
