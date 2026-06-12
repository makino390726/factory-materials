import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

interface ManufacturingPlan {
  model: string;
  quantity: number;
}

interface AggregatedItem {
  product_code: string | null;
  part_key: string;
  part_name: string;
  spec: string | null;
  cost_price: number;
  total_qty: number; // 全機種を合計した必要数
  total_cost: number; // 全機種を合計した原価
  stock_qty: number; // 現在の在庫数
  shortage_qty: number; // 不足数（必要数 - 在庫数）
}

export async function POST(req: NextRequest) {
  try {
    const { plans } = await req.json();
    const supabase = createClient(
      supabaseUrl,
      supabaseServiceRoleKey || supabaseAnonKey,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      }
    );

    // すべての部品マスタを取得（原価含む）
    const { data: partsData } = await supabase
      .from('heater_parts_master')
      .select('part_key, product_code, part_name, spec, cost_price');

    // すべてのBOMデータを取得（全件取得）
    let allBomData: any[] = [];
    let from = 0;
    const pageSize = 1000;
    let hasMore = true;
    
    while (hasMore) {
      const { data, error } = await supabase
        .from('heater_bom')
        .select('*')
        .range(from, from + pageSize - 1);
      
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

    // 在庫情報を取得（stocksテーブル）
    const { data: stocksData } = await supabase
      .from('stocks')
      .select('product_code, stock_qty');

    const stocksMap = new Map(
      (stocksData || []).map((stock) => [stock.product_code, stock.stock_qty || 0])
    );

    // パーツマップを作成（原価を含む）
    const partsMap = new Map(
      (partsData || []).map((part) => [
        part.part_key,
        {
          product_code: part.product_code,
          part_name: part.part_name,
          spec: part.spec,
          cost_price: part.cost_price || 0,
        },
      ])
    );

    // 機種ごとの詳細データを生成
    const manufacturingData = plans
      .filter((plan: ManufacturingPlan) => plan.quantity > 0)
      .map((plan: ManufacturingPlan) => {
        // この機種のBOM項目を取得
        const bomItems = (bomData || [])
          .filter((item) => item.model === plan.model)
          .map((item) => {
            const partInfo = partsMap.get(item.part_key) || {
              product_code: null,
              part_name: 'Unknown',
              spec: null,
              cost_price: 0,
            };

            const costPrice = partInfo.cost_price || 0;

            // subtotal = 原価単価 × 1台当たり必要数 × 製造台数
            const subtotal = costPrice * item.quantity * plan.quantity;

            return {
              model: plan.model,
              part_key: item.part_key,
              part_name: partInfo.part_name,
              spec: partInfo.spec,
              product_code: partInfo.product_code,
              quantity: item.quantity,
              cost_price: costPrice,
              subtotal,
            };
          });

        // 機種別の合計原価
        const totalCost = bomItems.reduce((sum, item) => sum + item.subtotal, 0);

        return {
          model: plan.model,
          quantity: plan.quantity,
          bomItems,
          totalCost,
        };
      });

    // 同一部品を集約（合計値を計算）
    const aggregatedMap = new Map<string, AggregatedItem>();

    // すべての機種のBOM項目をループして集約
    plans
      .filter((plan: ManufacturingPlan) => plan.quantity > 0)
      .forEach((plan: ManufacturingPlan) => {
        const bomItems = (bomData || []).filter((item) => item.model === plan.model);

        bomItems.forEach((item) => {
          const partInfo = partsMap.get(item.part_key) || {
            product_code: null,
            part_name: 'Unknown',
            spec: null,
            cost_price: 0,
          };

          const costPrice = partInfo.cost_price || 0;

          // キーは product_code（またはpart_key）
          const key = partInfo.product_code || item.part_key;

          if (aggregatedMap.has(key)) {
            const existing = aggregatedMap.get(key)!;
            existing.total_qty += item.quantity * plan.quantity;
            existing.total_cost += costPrice * item.quantity * plan.quantity;
          } else {
            const stockQty = partInfo.product_code 
              ? stocksMap.get(partInfo.product_code) || 0 
              : 0;
            const totalQty = item.quantity * plan.quantity;
            
            aggregatedMap.set(key, {
              product_code: partInfo.product_code,
              part_key: item.part_key,
              part_name: partInfo.part_name,
              spec: partInfo.spec,
              cost_price: costPrice,
              total_qty: totalQty,
              total_cost: costPrice * totalQty,
              stock_qty: stockQty,
              shortage_qty: Math.max(0, totalQty - stockQty),
            });
          }
        });
      });

    // 在庫数と不足数を再計算（集約後）
    aggregatedMap.forEach((item) => {
      if (item.stock_qty === undefined) {
        const stockQty = item.product_code 
          ? stocksMap.get(item.product_code) || 0 
          : 0;
        item.stock_qty = stockQty;
        item.shortage_qty = Math.max(0, item.total_qty - stockQty);
      }
    });

    const aggregatedItems = Array.from(aggregatedMap.values()).sort(
      (a, b) => b.total_cost - a.total_cost
    );

    return NextResponse.json({
      manufacturingData,
      aggregatedItems,
    });
  } catch (err: any) {
    console.error('POST error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
