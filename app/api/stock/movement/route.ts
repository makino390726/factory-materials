import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
})

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { product_code, type, quantity, actual_quantity, input_method = 'qr', note, login_id, staff_name } = body

    const normalizedType = type === 'count' ? 'ADJUST' : String(type || '').toUpperCase()
    const quantityValue = Number(quantity)
    const actualQuantityValue = actual_quantity === undefined ? undefined : Number(actual_quantity)

    console.log('📦 在庫移動リクエスト:', { product_code, type, quantity, actual_quantity, input_method, note, login_id, staff_name })

    if (!product_code || !type) {
      return NextResponse.json(
        { success: false, error: '必須パラメータが不足しています' },
        { status: 400 }
      )
    }

    if (!['IN', 'OUT', 'ADJUST'].includes(normalizedType)) {
      return NextResponse.json(
        { success: false, error: '操作種別が正しくありません' },
        { status: 400 }
      )
    }

    // 現在の在庫を取得
    const { data: currentStock, error: stockError } = await supabase
      .from('stocks')
      .select('*')
      .eq('product_code', product_code)
      .maybeSingle()

    console.log('📊 現在の在庫:', currentStock)
    
    let currentQuantity = currentStock?.stock_qty || 0

    // 新しい在庫数を計算
    let newQuantity = currentQuantity
    let movementQuantity = Math.abs(quantityValue)

    if (normalizedType === 'IN') {
      // 入庫
      newQuantity = currentQuantity + movementQuantity
    } else if (normalizedType === 'OUT') {
      // 出庫
      newQuantity = currentQuantity - movementQuantity
    } else if (normalizedType === 'ADJUST') {
      // 棚卸（実在庫数を設定）
      if (actualQuantityValue === undefined || Number.isNaN(actualQuantityValue)) {
        return NextResponse.json(
          { success: false, error: '実在庫数が正しくありません' },
          { status: 400 }
        )
      }
      newQuantity = actualQuantityValue
      movementQuantity = Math.abs(actualQuantityValue - currentQuantity)
    }

    // 在庫マイナスチェック（出庫時）
    if (normalizedType === 'OUT' && newQuantity < 0) {
      return NextResponse.json(
        { success: false, error: '在庫が不足しています' },
        { status: 400 }
      )
    }

    // 在庫テーブルを更新（upsert）
    const { error: updateError } = await supabase
      .from('stocks')
      .upsert({
        product_code: product_code,
        stock_qty: newQuantity,
        updated_at: new Date().toISOString(),
      })

    if (updateError) {
      console.error('在庫更新エラー:', updateError)
      console.error('詳細:', JSON.stringify(updateError, null, 2))
      return NextResponse.json(
        { success: false, error: `在庫の更新に失敗しました: ${updateError.message}` },
        { status: 500 }
      )
    }

    console.log('✅ 在庫更新成功:', { before: currentQuantity, after: newQuantity })

    // 在庫移動履歴を記録
    if (movementQuantity === 0) {
      return NextResponse.json({
        success: true,
        data: {
          product_code,
          before_stock: currentQuantity,
          after_stock: newQuantity,
          quantity: movementQuantity,
        },
      })
    }

    const { error: movementError } = await supabase
      .from('stock_movements')
      .insert({
        product_code: product_code,
        movement: normalizedType,
        qty: movementQuantity,
        input_method: input_method,
        note: note || null,
        login_id: login_id || null,
        staff_name: staff_name || null,
        created_at: new Date().toISOString(),
      })

    if (movementError) {
      console.error('履歴記録エラー:', movementError)
      console.error('詳細:', JSON.stringify(movementError, null, 2))
      return NextResponse.json(
        { success: false, error: `履歴の記録に失敗しました: ${movementError.message}` },
        { status: 500 }
      )
    }

    console.log('✅ 履歴記録成功')

    return NextResponse.json({
      success: true,
      data: {
        product_code,
        before_stock: currentQuantity,
        after_stock: newQuantity,
        quantity: movementQuantity,
      },
    })
  } catch (error) {
    console.error('在庫操作エラー:', error)
    return NextResponse.json(
      { success: false, error: 'サーバーエラーが発生しました' },
      { status: 500 }
    )
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json()
    const { product_code, movement_id, movement_type, quantity } = body

    if (!product_code || !movement_id) {
      return NextResponse.json(
        { error: '必須パラメータが不足しています' },
        { status: 400 }
      )
    }

    // 削除対象の履歴を取得
    const { data: movement, error: fetchError } = await supabase
      .from('stock_movements')
      .select('*')
      .eq('id', movement_id)
      .eq('product_code', product_code)
      .maybeSingle()

    if (fetchError || !movement) {
      return NextResponse.json(
        { error: '削除対象の履歴が見つかりません' },
        { status: 404 }
      )
    }

    // 削除する履歴の種類に応じて在庫を逆算
    const { data: currentStock, error: stockError } = await supabase
      .from('stocks')
      .select('stock_qty')
      .eq('product_code', product_code)
      .maybeSingle()

    if (stockError || !currentStock) {
      return NextResponse.json(
        { error: '在庫情報が見つかりません' },
        { status: 404 }
      )
    }

    const currentQty = currentStock.stock_qty || 0
    const movementType = String(movement_type || movement.movement).toUpperCase()
    const qty = Number(quantity || movement.qty)

    let newQty = currentQty

    // 削除する履歴の種類に応じて在庫を逆算
    if (movementType === 'IN') {
      // 入庫だった場合、その数量を減らす
      newQty = currentQty - qty
    } else if (movementType === 'OUT') {
      // 出庫だった場合、その数量を足す
      newQty = currentQty + qty
    } else if (movementType === 'ADJUST') {
      // 棚卸は差分を無視して復元不可（手動対応が必要）
      return NextResponse.json(
        { error: '棚卸の削除は実装されていません。管理者にご連絡ください。' },
        { status: 400 }
      )
    }

    // 在庫が負数にならないようチェック
    if (newQty < 0) {
      return NextResponse.json(
        { error: `在庫がマイナスになるため削除できません（現在庫: ${currentQty}個）` },
        { status: 400 }
      )
    }

    // 履歴を削除
    const { error: deleteError } = await supabase
      .from('stock_movements')
      .delete()
      .eq('id', movement_id)

    if (deleteError) {
      console.error('履歴削除エラー:', deleteError)
      return NextResponse.json(
        { error: `履歴削除に失敗しました: ${deleteError.message}` },
        { status: 500 }
      )
    }

    // 在庫を更新
    const { error: updateError } = await supabase
      .from('stocks')
      .update({
        stock_qty: newQty,
        updated_at: new Date().toISOString(),
      })
      .eq('product_code', product_code)

    if (updateError) {
      console.error('在庫更新エラー:', updateError)
      return NextResponse.json(
        { error: `在庫更新に失敗しました: ${updateError.message}` },
        { status: 500 }
      )
    }

    console.log(`✅ 履歴削除完了: ${product_code} (${movementType} ${qty}個) - 在庫: ${currentQty}個 → ${newQty}個`)

    return NextResponse.json({
      success: true,
      message: '履歴を削除し、在庫を調整しました',
      data: {
        product_code,
        before_stock: currentQty,
        after_stock: newQty,
      },
    })
  } catch (error) {
    console.error('削除エラー:', error)
    return NextResponse.json(
      { error: 'サーバーエラーが発生しました' },
      { status: 500 }
    )
  }
}
