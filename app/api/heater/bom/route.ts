import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { buildLinePartCostUnitMap } from '@/lib/line-part-cost-breakdown';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export async function GET() {
  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    // すべての部品マスタを取得（原価含む）
    const { data: partsData, error: partsError } = await supabase
      .from('heater_parts_master')
      .select('part_key, product_code, part_name, spec, cost_price, material_cost_total, indirect_cost_total');
    
    if (partsError) throw partsError;

    // パーツマップを作成（原価を含む）
    const partsMap = new Map(
      (partsData || []).map((part) => [
        part.part_key,
        { 
          product_code: part.product_code, 
          part_name: part.part_name, 
          spec: part.spec,
          cost_price: part.cost_price || 0,
          material_cost_total: part.material_cost_total ?? null,
          indirect_cost_total: part.indirect_cost_total ?? null,
        }
      ])
    );

    const partsFallbackMap = new Map(
      (partsData || []).map((part) => [
        part.part_key,
        {
          cost_price: part.cost_price ?? null,
          material_cost_total: part.material_cost_total ?? null,
          indirect_cost_total: part.indirect_cost_total ?? null,
        },
      ])
    );

    // heater_bom のデータを取得（全件取得）
    console.log('Fetching heater_bom data...');
    
    // 全件取得（ページネーションを使用）
    let allBomData: any[] = [];
    let from = 0;
    const pageSize = 1000;
    let hasMore = true;
    
    while (hasMore) {
      const { data, error } = await supabase
        .from('heater_bom')
        .select('*')
        .range(from, from + pageSize - 1)
        .order('model');
      
      if (error) throw error;
      
      if (data && data.length > 0) {
        allBomData = [...allBomData, ...data];
        from += pageSize;
        hasMore = data.length === pageSize;
      } else {
        hasMore = false;
      }
    }
    
    const bomData = allBomData;
    
    const debugInfo = {
      totalFetched: bomData?.length,
      uniqueModels: [...new Set(bomData?.map(b => b.model) || [])].sort(),
      has600LT: bomData?.some(b => b.model === '600LT'),
      count600LT: bomData?.filter(b => b.model === '600LT').length
    };
    
    console.log('BOM Data Debug:', JSON.stringify(debugInfo, null, 2));

    const uniquePartKeys = [...new Set((bomData || []).map((item: any) => item.part_key).filter(Boolean))]
    const lineCostMap = await buildLinePartCostUnitMap(
      supabase,
      uniquePartKeys,
      partsFallbackMap
    )

    // BOMデータに部品情報と原価内訳を付与
    const enrichedData = (bomData || []).map((item) => {
      const partInfo = partsMap.get(item.part_key) || {
        product_code: null,
        part_name: null,
        spec: null,
        cost_price: 0,
        material_cost_total: null,
        indirect_cost_total: null,
      };

      const quantity = Number(item.quantity || 0);
      const costPrice = Number(partInfo.cost_price || 0);
      const lineCost = lineCostMap.get(String(item.part_key || ''))

      const materialUnit = lineCost ? Number(lineCost.material_unit || 0) : Number(partInfo.material_cost_total || 0)
      const laborUnit = lineCost ? Number(lineCost.labor_unit || 0) : 0
      const indirectUnit = lineCost ? Number(lineCost.indirect_unit || 0) : Number(partInfo.indirect_cost_total || 0)
      const totalUnit = lineCost
        ? Number(lineCost.total_unit || (materialUnit + laborUnit + indirectUnit))
        : costPrice

      const materialCost = Math.round(materialUnit * quantity)
      const laborCost = Math.round(laborUnit * quantity)
      const indirectCost = Math.round(indirectUnit * quantity)
      const totalCost = Math.round(totalUnit * quantity)

      return {
        ...item,
        product_code: partInfo.product_code,
        part_name: item.part_name || partInfo.part_name,
        spec: partInfo.spec,
        cost_price: costPrice,
        cost_amount: totalCost,
        material_cost: materialCost,
        labor_cost: laborCost,
        indirect_cost: indirectCost,
        total_cost: totalCost,
      };
    });

    // デバッグモードの場合は詳細情報を返す
    const debugMode = false; // 修正完了
    if (debugMode) {
      return NextResponse.json({
        debug: debugInfo,
        totalEnriched: enrichedData.length,
        count600LT_enriched: enrichedData.filter((d: any) => d.model === '600LT').length,
        sample600LT: enrichedData.filter((d: any) => d.model === '600LT').slice(0, 3)
      });
    }

    return NextResponse.json(enrichedData);
  } catch (err: any) {
    console.error('GET error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const supabase = createClient(supabaseUrl, supabaseAnonKey);
    const { data, error } = await supabase
      .from('heater_bom')
      .insert([body])
      .select();
    if (error) throw error;
    return NextResponse.json(data[0], { status: 201 });
  } catch (err: any) {
    console.error('POST error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const supabase = createClient(supabaseUrl, supabaseAnonKey);
    
    // BOM テーブルを更新
    const { error: bomError } = await supabase
      .from('heater_bom')
      .update({ quantity: body.quantity })
      .eq('model', body.model)
      .eq('part_key', body.part_key);
    
    if (bomError) throw bomError;

    // cost_price が指定されている場合は、パーツマスターを更新
    if (body.part_key && body.cost_price !== undefined) {
      const { error: partError } = await supabase
        .from('heater_parts_master')
        .update({ cost_price: body.cost_price })
        .eq('part_key', body.part_key);
      
      if (partError) throw partError;
    }

    // 更新後のデータを取得
    const { data, error } = await supabase
      .from('heater_bom')
      .select()
      .eq('model', body.model)
      .eq('part_key', body.part_key);
    
    if (error) throw error;
    return NextResponse.json(data[0]);
  } catch (err: any) {
    console.error('PUT error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl;
    const model = searchParams.get('model');
    const partKey = searchParams.get('part_key');
    if (!model || !partKey) throw new Error('model and part_key parameters required');
    
    const supabase = createClient(supabaseUrl, supabaseAnonKey);
    const { error } = await supabase
      .from('heater_bom')
      .delete()
      .eq('model', model)
      .eq('part_key', partKey);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('DELETE error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
