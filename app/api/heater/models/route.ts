import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import {
  inferProductCategory,
  normalizeProductCategory,
} from '@/lib/product-category';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function sanitizeModelBody(body: Record<string, unknown>) {
  const model = typeof body.model === 'string' ? body.model.trim() : '';
  const name =
    body.name == null || body.name === ''
      ? null
      : typeof body.name === 'string'
        ? body.name.trim()
        : null;
  const product_code =
    body.product_code == null || body.product_code === ''
      ? null
      : typeof body.product_code === 'string'
        ? body.product_code.trim()
        : null;
  const product_category = body.product_category
    ? normalizeProductCategory(body.product_category)
    : inferProductCategory(model, name);

  return { model, name, product_code, product_category };
}

export async function GET(req: NextRequest) {
  try {
    const category = req.nextUrl.searchParams.get('category')?.trim() || '';
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    let query = supabase.from('heater_models').select('*').order('model');
    if (category && category !== 'すべて') {
      query = query.eq('product_category', normalizeProductCategory(category));
    }
    const { data, error } = await query;
    if (error) {
      // 列未追加環境でも動くようフォールバック
      if (
        error.code === 'PGRST204' ||
        (error.message || '').includes('product_category')
      ) {
        const fallback = await supabase.from('heater_models').select('*').order('model');
        if (fallback.error) throw fallback.error;
        const rows = (fallback.data || []).map((row) => ({
          ...row,
          product_category: inferProductCategory(String(row.model), row.name),
        }));
        const filtered =
          category && category !== 'すべて'
            ? rows.filter(
                (r) => r.product_category === normalizeProductCategory(category)
              )
            : rows;
        return NextResponse.json(filtered);
      }
      throw error;
    }
    return NextResponse.json(data);
  } catch (err: any) {
    console.error('GET error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const payload = sanitizeModelBody(body);
    if (!payload.model) {
      return NextResponse.json({ error: '機種コードは必須です' }, { status: 400 });
    }
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { data, error } = await supabase.from('heater_models').insert([payload]).select();
    if (error) {
      if (
        error.code === 'PGRST204' ||
        (error.message || '').includes('product_category')
      ) {
        const { product_category: _c, ...legacy } = payload;
        const legacyRes = await supabase.from('heater_models').insert([legacy]).select();
        if (legacyRes.error) throw legacyRes.error;
        return NextResponse.json(
          { ...legacyRes.data[0], product_category: payload.product_category },
          { status: 201 }
        );
      }
      throw error;
    }
    return NextResponse.json(data[0], { status: 201 });
  } catch (err: any) {
    console.error('POST error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const payload = sanitizeModelBody(body);
    if (!payload.model) {
      return NextResponse.json({ error: '機種コードは必須です' }, { status: 400 });
    }
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { data, error } = await supabase
      .from('heater_models')
      .update({
        name: payload.name,
        product_code: payload.product_code,
        product_category: payload.product_category,
      })
      .eq('model', payload.model)
      .select();
    if (error) {
      if (
        error.code === 'PGRST204' ||
        (error.message || '').includes('product_category')
      ) {
        const legacyRes = await supabase
          .from('heater_models')
          .update({ name: payload.name, product_code: payload.product_code })
          .eq('model', payload.model)
          .select();
        if (legacyRes.error) throw legacyRes.error;
        return NextResponse.json({
          ...legacyRes.data[0],
          product_category: payload.product_category,
        });
      }
      throw error;
    }
    return NextResponse.json(data[0]);
  } catch (err: any) {
    console.error('PUT error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl;
    const model = searchParams.get('model')?.trim();
    if (!model) {
      return NextResponse.json({ error: 'model parameter required' }, { status: 400 });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const CHUNK = 150;

    // 1) この機種の BOM 部品キー
    const { data: bomRows, error: bomFetchError } = await supabase
      .from('heater_bom')
      .select('part_key')
      .eq('model', model);
    if (bomFetchError) throw bomFetchError;

    const partKeys = [
      ...new Set(
        (bomRows || [])
          .map((r) => String(r.part_key || '').trim())
          .filter(Boolean)
      ),
    ];

    // 2) 他機種でも使っているか判定 → 専用パーツのみ後で削除
    const exclusivePartKeys: string[] = [];
    const sharedPartKeys: string[] = [];
    for (let i = 0; i < partKeys.length; i += CHUNK) {
      const chunk = partKeys.slice(i, i + CHUNK);
      const { data: usageRows, error: usageError } = await supabase
        .from('heater_bom')
        .select('model, part_key')
        .in('part_key', chunk);
      if (usageError) throw usageError;

      const modelsByPart = new Map<string, Set<string>>();
      for (const row of usageRows || []) {
        const pk = String(row.part_key || '').trim();
        const m = String(row.model || '').trim();
        if (!pk || !m) continue;
        const set = modelsByPart.get(pk) || new Set<string>();
        set.add(m);
        modelsByPart.set(pk, set);
      }
      for (const pk of chunk) {
        const used = modelsByPart.get(pk) || new Set<string>();
        // この機種のみ（またはBOMに無い＝実質専用）なら専用扱い
        if (used.size <= 1) exclusivePartKeys.push(pk);
        else sharedPartKeys.push(pk);
      }
    }

    // 3) BOM / グループ削除
    const { error: bomDeleteError } = await supabase
      .from('heater_bom')
      .delete()
      .eq('model', model);
    if (bomDeleteError) throw bomDeleteError;

    let groupsDeleted = 0;
    const { error: groupDeleteError, count: groupCount } = await supabase
      .from('heater_bom_groups')
      .delete({ count: 'exact' })
      .eq('model', model);
    if (groupDeleteError) {
      if (
        !String(groupDeleteError.message || '').includes('heater_bom_groups') &&
        groupDeleteError.code !== '42P01'
      ) {
        throw groupDeleteError;
      }
    } else {
      groupsDeleted = groupCount ?? 0;
    }

    // 4) 専用パーツの L指令原価 → パーツマスタ
    let costItemsDeleted = 0;
    let costHeadersDeleted = 0;
    let partsDeleted = 0;

    for (let i = 0; i < exclusivePartKeys.length; i += CHUNK) {
      const chunk = exclusivePartKeys.slice(i, i + CHUNK);

      const { data: costItems, error: costItemsError } = await supabase
        .from('work_order_cost_items')
        .select('id, work_order_cost_id')
        .eq('master_type', 'ライン原価')
        .in('master_id', chunk);
      if (costItemsError) throw costItemsError;

      const headerIds = [
        ...new Set(
          (costItems || [])
            .map((r) => String(r.work_order_cost_id || '').trim())
            .filter(Boolean)
        ),
      ];

      const { error: deleteItemsError, count: itemsCount } = await supabase
        .from('work_order_cost_items')
        .delete({ count: 'exact' })
        .eq('master_type', 'ライン原価')
        .in('master_id', chunk);
      if (deleteItemsError) throw deleteItemsError;
      costItemsDeleted += itemsCount ?? 0;

      for (let h = 0; h < headerIds.length; h += CHUNK) {
        const headerChunk = headerIds.slice(h, h + CHUNK);
        for (const headerId of headerChunk) {
          const { data: remaining, error: remainError } = await supabase
            .from('work_order_cost_items')
            .select('id')
            .eq('work_order_cost_id', headerId)
            .limit(1);
          if (remainError) throw remainError;
          if (remaining && remaining.length > 0) continue;

          const { error: headerDeleteError } = await supabase
            .from('work_order_costs')
            .delete()
            .eq('id', headerId);
          if (headerDeleteError) throw headerDeleteError;
          costHeadersDeleted += 1;
        }
      }

      const { error: partsDeleteError, count: partsCount } = await supabase
        .from('heater_parts_master')
        .delete({ count: 'exact' })
        .in('part_key', chunk);
      if (partsDeleteError) throw partsDeleteError;
      partsDeleted += partsCount ?? 0;
    }

    // 5) 機種マスタ
    const { error: modelDeleteError } = await supabase
      .from('heater_models')
      .delete()
      .eq('model', model);
    if (modelDeleteError) throw modelDeleteError;

    return NextResponse.json({
      success: true,
      model,
      bom_parts: partKeys.length,
      bom_deleted: true,
      groups_deleted: groupsDeleted,
      exclusive_parts: exclusivePartKeys.length,
      shared_parts_kept: sharedPartKeys.length,
      cost_items_deleted: costItemsDeleted,
      cost_headers_deleted: costHeadersDeleted,
      parts_deleted: partsDeleted,
    });
  } catch (err: any) {
    console.error('DELETE error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err?.message || err) },
      { status: 500 }
    );
  }
}
