import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function GET(req: Request) {
  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const url = new URL(req.url);
    const partKey = url.searchParams.get('part_key');

    if (!partKey) {
      return NextResponse.json({ error: 'part_key parameter required' }, { status: 400 });
    }

    // 1. パーツマスタのデータを取得
    const { data: part, error: partError } = await supabase
      .from('heater_parts_master')
      .select('*')
      .eq('part_key', partKey)
      .single();

    if (partError) throw partError;

    // 2. work_order_cost_items のデータを取得
    const { data: costItems, error: costItemsError } = await supabase
      .from('work_order_cost_items')
      .select('*')
      .eq('master_type', 'ライン原価')
      .eq('master_id', partKey);

    if (costItemsError) throw costItemsError;

    // 3. 集計
    let materialTotal = 0;
    let indirectTotal = 0;
    
    (costItems || []).forEach((item: any) => {
      materialTotal += Number(item.material_cost || 0);
      indirectTotal += Number(item.indirect_cost || 0);
    });

    return NextResponse.json({
      debug: {
        part_key: partKey,
        part_master: part,
        cost_items_count: costItems?.length || 0,
        cost_items: costItems,
        calculated_summary: {
          material_cost_total: materialTotal,
          indirect_cost_total: indirectTotal,
          total: materialTotal + indirectTotal,
        },
        issue: costItems?.length === 0 
          ? `⚠️ No cost items found for ${partKey} - will be ZEROED on recalculate`
          : 'OK - cost items exist'
      }
    });
  } catch (err: any) {
    console.error('Debug API error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
