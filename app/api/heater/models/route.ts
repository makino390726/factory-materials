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
    const model = searchParams.get('model');
    if (!model) throw new Error('model parameter required');

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { error } = await supabase.from('heater_models').delete().eq('model', model);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('DELETE error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
