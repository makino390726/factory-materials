import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export async function GET(req: NextRequest) {
  try {
    const searchParams = req.nextUrl.searchParams;
    const model = searchParams.get('model') || '600LT';

    const supabase = createClient(supabaseUrl, supabaseAnonKey);

    // 直接クエリを実行
    const { data, error, count } = await supabase
      .from('heater_bom')
      .select('*', { count: 'exact' })
      .eq('model', model);

    console.log('Debug BOM Query:');
    console.log('- Model:', model);
    console.log('- Count:', count);
    console.log('- Error:', error);
    console.log('- Data length:', data?.length);
    console.log('- First item:', data?.[0]);

    if (error) {
      return NextResponse.json({
        success: false,
        error: error.message,
        details: error,
        count: 0,
        data: null
      });
    }

    return NextResponse.json({
      success: true,
      model,
      count,
      dataLength: data?.length || 0,
      sampleData: data?.slice(0, 3) || [],
      allData: data
    });
  } catch (err: any) {
    console.error('Debug error:', err);
    return NextResponse.json({ 
      success: false,
      error: err.message,
      stack: err.stack 
    }, { status: 500 });
  }
}
