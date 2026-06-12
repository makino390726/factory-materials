import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export async function GET() {
  try {
    const supabase = createClient(supabaseUrl, supabaseAnonKey);
    
    // すべての部品マスタを取得
    const { data: partsData, error: partsError } = await supabase
      .from('heater_parts_master')
      .select('part_key, product_code, part_name, spec');
    
    if (partsError) throw partsError;

    // すべての商品データを取得（cost_price付き）
    const { data: productsData, error: productsError } = await supabase
      .from('products')
      .select('product_code, cost_price');
    
    if (productsError) throw productsError;

    // パーツマップを作成
    const partsMap = new Map(
      (partsData || []).map((part) => [
        part.part_key,
        { 
          product_code: part.product_code, 
          part_name: part.part_name, 
          spec: part.spec 
        }
      ])
    );

    // 商品マップを作成（product_code -> cost_price）
    const productsMap = new Map(
      (productsData || []).map((prod) => [prod.product_code, prod.cost_price || 0])
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

    // BOMデータに部品情報と単価を付与
    const enrichedData = (bomData || []).map((item) => {
      const partInfo = partsMap.get(item.part_key) || {
        product_code: null,
        part_name: null,
        spec: null,
      };
      
      const costPrice = partInfo.product_code 
        ? productsMap.get(partInfo.product_code) || 0 
        : 0;
      
      const costAmount = costPrice * item.qty_per_unit;

      return {
        ...item,
        ...partInfo,
        cost_price: costPrice,
        cost_amount: costAmount,
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
      .update({ qty_per_unit: body.qty_per_unit })
      .eq('model', body.model)
      .eq('part_key', body.part_key);
    
    if (bomError) throw bomError;

    // cost_price が指定されている場合は、対応する product を更新
    if (body.product_code && body.cost_price !== undefined) {
      const { error: productError } = await supabase
        .from('products')
        .update({ cost_price: body.cost_price })
        .eq('product_code', body.product_code);
      
      if (productError) throw productError;
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
