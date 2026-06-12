import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// 製造計画一覧取得
export async function GET(req: NextRequest) {
  try {
    const supabase = createClient(supabaseUrl, supabaseAnonKey);
    const { searchParams } = req.nextUrl;
    const planId = searchParams.get('id');

    if (planId) {
      // 特定の計画を取得（明細含む）
      const { data: plan, error: planError } = await supabase
        .from('heater_manufacturing_plans')
        .select('*')
        .eq('id', planId)
        .single();

      if (planError) throw planError;

      const { data: details, error: detailsError } = await supabase
        .from('heater_manufacturing_plan_details')
        .select('*')
        .eq('plan_id', planId);

      if (detailsError) throw detailsError;

      return NextResponse.json({ ...plan, details: details || [] });
    } else {
      // 全計画一覧を取得
      const { data, error } = await supabase
        .from('heater_manufacturing_plans')
        .select('id, plan_name, fiscal_year, plan_period, notes, created_at, updated_at')
        .order('created_at', { ascending: false });

      if (error) throw error;
      return NextResponse.json(data || []);
    }
  } catch (err: any) {
    console.error('GET error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// 製造計画保存（新規作成）
export async function POST(req: NextRequest) {
  try {
    const { plan_name, fiscal_year, plan_period, notes, details } = await req.json();

    if (!plan_name || !fiscal_year || !details || details.length === 0) {
      return NextResponse.json(
        { error: 'plan_name, fiscal_year, and details are required' },
        { status: 400 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey);

    // トランザクション的に処理（計画マスター→明細の順で保存）
    const { data: planData, error: planError } = await supabase
      .from('heater_manufacturing_plans')
      .insert([{ plan_name, fiscal_year, plan_period, notes }])
      .select()
      .single();

    if (planError) throw planError;

    // 明細を保存
    const detailsToInsert = details
      .filter((d: any) => d.quantity > 0)
      .map((d: any) => ({
        plan_id: planData.id,
        model: d.model,
        quantity: d.quantity,
      }));

    if (detailsToInsert.length > 0) {
      const { error: detailsError } = await supabase
        .from('heater_manufacturing_plan_details')
        .insert(detailsToInsert);

      if (detailsError) throw detailsError;
    }

    return NextResponse.json({ ...planData, details: detailsToInsert }, { status: 201 });
  } catch (err: any) {
    console.error('POST error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// 製造計画更新
export async function PUT(req: NextRequest) {
  try {
    const { id, plan_name, fiscal_year, plan_period, notes, details } = await req.json();

    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey);

    // 計画マスターを更新
    const { error: planError } = await supabase
      .from('heater_manufacturing_plans')
      .update({ plan_name, fiscal_year, plan_period, notes, updated_at: new Date().toISOString() })
      .eq('id', id);

    if (planError) throw planError;

    // 既存の明細を削除
    const { error: deleteError } = await supabase
      .from('heater_manufacturing_plan_details')
      .delete()
      .eq('plan_id', id);

    if (deleteError) throw deleteError;

    // 新しい明細を挿入
    if (details && details.length > 0) {
      const detailsToInsert = details
        .filter((d: any) => d.quantity > 0)
        .map((d: any) => ({
          plan_id: id,
          model: d.model,
          quantity: d.quantity,
        }));

      if (detailsToInsert.length > 0) {
        const { error: insertError } = await supabase
          .from('heater_manufacturing_plan_details')
          .insert(detailsToInsert);

        if (insertError) throw insertError;
      }
    }

    return NextResponse.json({ success: true, id });
  } catch (err: any) {
    console.error('PUT error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// 製造計画削除
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl;
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey);

    // CASCADE設定により明細も自動削除される
    const { error } = await supabase
      .from('heater_manufacturing_plans')
      .delete()
      .eq('id', id);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('DELETE error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
