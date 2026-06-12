import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl;
    let query = searchParams.get('q') || '';
    const page = Math.max(parseInt(searchParams.get('page') || '1', 10), 1);
    const pageSize = Math.min(Math.max(parseInt(searchParams.get('pageSize') || '10', 10), 1), 50);

    // クエリを正規化（全角を半角に、スペース削除）
    query = query
      .replace(/[０-９]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0)) // 全角数字
      .replace(/[Ａ-Ｚａ-ｚ]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0)) // 全角英数
      .replace(/[\s　]+/g, '') // スペース（全角・半角）を削除
      .trim();

    if (!query) {
      return NextResponse.json({ items: [], total: 0, page, pageSize });
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey);

    // 曖昧検索: 入力文字列を1文字ずつに分割して OR 検索
    // 例: "暖房機" → "%暖%" OR "%房%" OR "%機%"
    const chars = query.split('');
    let searchFilter = chars
      .map((char) => `name.ilike.%${char}%`)
      .join(',');

    // product_code も含める
    searchFilter = chars
      .map((char) => `name.ilike.%${char}%,product_code.ilike.%${char}%`)
      .join(',');

    const { data, error, count } = await supabase
      .from('products')
      .select('id, product_code, name', { count: 'exact' })
      .or(searchFilter);

    if (error) {
      console.error('DB Error:', error);
      throw error;
    }

    // クライアント側でページネーション
    const from = (page - 1) * pageSize;
    const to = from + pageSize;
    const paginatedData = (data || []).slice(from, to);

    return NextResponse.json({
      items: paginatedData,
      total: count || 0,
      page,
      pageSize,
    });
  } catch (err: any) {
    console.error('GET error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
