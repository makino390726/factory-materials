import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { syncConfirmedLaborFromManufacturingPlan } from '@/lib/manufacturing-plan-labor-sync';

export const runtime = 'nodejs';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function isMissingProductCategoryError(error: { code?: string; message?: string } | null) {
  if (!error) return false;
  const message = error.message || '';
  return (
    error.code === 'PGRST204' ||
    message.includes('product_category') ||
    (message.includes('column') && message.includes('schema cache'))
  );
}

function formatSaveError(error: unknown): string {
  if (!error || typeof error !== 'object') {
    return '計画の保存に失敗しました';
  }
  const record = error as { code?: string; message?: string };
  const message = record.message || '';
  if (isMissingProductCategoryError(record)) {
    return 'heater_manufacturing_plans に product_category 列がありません。Supabaseで migrate-add-product-category.sql を実行してください。';
  }
  if (message.includes('heater_manufacturing_plans') && message.includes('does not exist')) {
    return 'heater_manufacturing_plans テーブルがありません。Supabaseで create-manufacturing-plans-tables.sql を実行してください。';
  }
  if (message.includes('duplicate key') || record.code === '23505') {
    return '同じ機種の明細が重複しています。ページを再読み込みしてから保存し直してください。';
  }
  return message || '計画の保存に失敗しました';
}

function normalizeDetails(
  details: Array<{ model?: string; quantity?: number }> | null | undefined
) {
  const map = new Map<string, number>();
  for (const row of details || []) {
    const model = String(row?.model || '').trim();
    const quantity = Number(row?.quantity);
    if (!model || !Number.isFinite(quantity) || quantity <= 0) continue;
    map.set(model, (map.get(model) || 0) + Math.floor(quantity));
  }
  return Array.from(map.entries()).map(([model, quantity]) => ({ model, quantity }));
}

async function runLaborSyncAfterPlanSave(planId: string) {
  try {
    return await syncConfirmedLaborFromManufacturingPlan(supabase, planId);
  } catch (err) {
    console.error('labor sync after manufacturing plan save failed:', err);
    return null;
  }
}

function summarizeLaborSync(labor_sync: Awaited<ReturnType<typeof runLaborSyncAfterPlanSave>>) {
  if (!labor_sync) return null;
  const failures = (labor_sync.results || [])
    .filter((row: { success?: boolean; skipped?: boolean }) => !row.success && !row.skipped)
    .slice(0, 5)
    .map(
      (row: {
        part_key?: string;
        line_code?: string;
        reason?: string;
      }) => `${row.part_key || '?'} / L${row.line_code || '?'}: ${row.reason || '不明なエラー'}`
    );
  return {
    total: labor_sync.total,
    success_count: labor_sync.success_count,
    skipped_count: labor_sync.skipped_count,
    failed_count: labor_sync.failed_count,
    failures,
  };
}

// 製造計画一覧取得
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl;
    const planId = searchParams.get('id');

    if (planId) {
      // 特定の計画を取得（明細含む）
      const { data: plan, error: planError } = await supabase
        .from('heater_manufacturing_plans')
        .select('*')
        .eq('id', planId)
        .maybeSingle();

      if (planError) throw planError;
      if (!plan) {
        return NextResponse.json({ error: '計画が見つかりません' }, { status: 404 });
      }

      const { data: details, error: detailsError } = await supabase
        .from('heater_manufacturing_plan_details')
        .select('*')
        .eq('plan_id', planId);

      if (detailsError) throw detailsError;

      return NextResponse.json({ ...plan, details: details || [] });
    } else {
      const { data, error } = await supabase
        .from('heater_manufacturing_plans')
        .select('id, plan_name, fiscal_year, plan_period, product_category, notes, created_at, updated_at')
        .order('created_at', { ascending: false });

      if (error) {
        if (
          error.code === 'PGRST204' ||
          (error.message || '').includes('product_category')
        ) {
          const fallback = await supabase
            .from('heater_manufacturing_plans')
            .select('id, plan_name, fiscal_year, plan_period, notes, created_at, updated_at')
            .order('created_at', { ascending: false });
          if (fallback.error) throw fallback.error;
          return NextResponse.json(
            (fallback.data || []).map((row) => ({ ...row, product_category: '暖房機' }))
          );
        }
        throw error;
      }
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
    const { plan_name, fiscal_year, plan_period, notes, details, product_category } =
      await req.json();

    const detailsToInsert = normalizeDetails(details);

    if (!plan_name || !fiscal_year || detailsToInsert.length === 0) {
      return NextResponse.json(
        { error: '計画名、年度、台数1以上の明細が必要です' },
        { status: 400 }
      );
    }

    const category =
      typeof product_category === 'string' && product_category.trim()
        ? product_category.trim()
        : '暖房機';

    // トランザクション的に処理（計画マスター→明細の順で保存）
    let planData: any = null;
    let planError: any = null;
    {
      const inserted = await supabase
        .from('heater_manufacturing_plans')
        .insert([{ plan_name, fiscal_year, plan_period, notes, product_category: category }])
        .select()
        .single();
      planData = inserted.data;
      planError = inserted.error;
      if (isMissingProductCategoryError(planError)) {
        const legacy = await supabase
          .from('heater_manufacturing_plans')
          .insert([{ plan_name, fiscal_year, plan_period, notes }])
          .select()
          .single();
        planData = legacy.data;
        planError = legacy.error;
      }
    }

    if (planError) throw planError;

    const { error: detailsError } = await supabase
      .from('heater_manufacturing_plan_details')
      .insert(detailsToInsert.map((d) => ({ ...d, plan_id: planData.id })));

    if (detailsError) throw detailsError;

    const labor_sync = await runLaborSyncAfterPlanSave(planData.id);
    const labor_sync_summary = summarizeLaborSync(labor_sync);

    return NextResponse.json(
      { ...planData, details: detailsToInsert, labor_sync: labor_sync_summary },
      { status: 201 }
    );
  } catch (err: any) {
    console.error('POST error:', err);
    return NextResponse.json({ error: formatSaveError(err) }, { status: 500 });
  }
}

// 製造計画更新
export async function PUT(req: NextRequest) {
  try {
    const { id, plan_name, fiscal_year, plan_period, notes, details, product_category } =
      await req.json();

    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    const detailsToInsert = normalizeDetails(details);
    if (detailsToInsert.length === 0) {
      return NextResponse.json(
        { error: '台数が1以上の機種がありません' },
        { status: 400 }
      );
    }

    const category =
      typeof product_category === 'string' && product_category.trim()
        ? product_category.trim()
        : '暖房機';

    // 計画マスターを更新
    let planError: any = null;
    {
      const updated = await supabase
        .from('heater_manufacturing_plans')
        .update({
          plan_name,
          fiscal_year,
          plan_period,
          notes,
          product_category: category,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id);
      planError = updated.error;
      if (isMissingProductCategoryError(planError)) {
        const legacy = await supabase
          .from('heater_manufacturing_plans')
          .update({
            plan_name,
            fiscal_year,
            plan_period,
            notes,
            updated_at: new Date().toISOString(),
          })
          .eq('id', id);
        planError = legacy.error;
      }
    }

    if (planError) throw planError;

    // 既存の明細を削除
    const { error: deleteError } = await supabase
      .from('heater_manufacturing_plan_details')
      .delete()
      .eq('plan_id', id);

    if (deleteError) throw deleteError;

    const { error: insertError } = await supabase
      .from('heater_manufacturing_plan_details')
      .insert(detailsToInsert.map((d) => ({ ...d, plan_id: id })));

    if (insertError) throw insertError;

    const labor_sync = await runLaborSyncAfterPlanSave(id);
    const labor_sync_summary = summarizeLaborSync(labor_sync);

    return NextResponse.json({ success: true, id, labor_sync: labor_sync_summary });
  } catch (err: any) {
    console.error('PUT error:', err);
    return NextResponse.json({ error: formatSaveError(err) }, { status: 500 });
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
