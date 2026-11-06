import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function GET() {
  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { data, error } = await supabase
      .from('heater_parts_master')
      .select('*')
      .order('part_key');
    if (error) throw error;
    return NextResponse.json(data);
  } catch (err: any) {
    console.error('GET error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    console.log('POST parts-master:', body);
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    // 重複チェック
    const { data: existing } = await supabase
      .from('heater_parts_master')
      .select('part_key')
      .eq('part_key', body.part_key)
      .single();
    
    if (existing) {
      return NextResponse.json(
        { error: `部品キー "${body.part_key}" は既に登録されています` },
        { status: 400 }
      );
    }
    
    const { data, error } = await supabase
      .from('heater_parts_master')
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
    const partKey = String(body?.part_key || '').trim();
    if (!partKey) {
      return NextResponse.json({ error: 'part_key required' }, { status: 400 });
    }
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { data: existing, error: lookupError } = await supabase
      .from('heater_parts_master')
      .select('part_key')
      .eq('part_key', partKey)
      .maybeSingle();
    if (lookupError) throw lookupError;

    if (!existing) {
      const partName = String(body.part_name || '').trim() || partKey;
      const costPrice = Number(body.cost_price);
      const { data, error } = await supabase
        .from('heater_parts_master')
        .insert([
          {
            part_key: partKey,
            part_name: partName,
            product_code: body.product_code ?? null,
            spec: body.spec ?? null,
            shelf_no: body.shelf_no ?? null,
            cost_price: Number.isFinite(costPrice) ? costPrice : 0,
          },
        ])
        .select();
      if (error) throw error;
      return NextResponse.json(data?.[0] ?? { part_key: partKey, part_name: partName });
    }

    const { data, error } = await supabase
      .from('heater_parts_master')
      .update(body)
      .eq('part_key', partKey)
      .select();
    if (error) throw error;
    return NextResponse.json(data?.[0] ?? { part_key: partKey });
  } catch (err: any) {
    console.error('PUT error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl;
    const partKey = searchParams.get('part_key');
    if (!partKey) throw new Error('part_key parameter required');
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { error } = await supabase
      .from('heater_parts_master')
      .delete()
      .eq('part_key', partKey);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('DELETE error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
