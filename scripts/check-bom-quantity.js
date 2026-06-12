#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = "https://ovlyvrggxrunkkckoofi.supabase.co";
const supabaseAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im92bHl2cmdneHJ1bmtrY2tvb2ZpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk1NjE5MDksImV4cCI6MjA4NTEzNzkwOX0.AfGRacHNCozCVqvqyBE4gIobaXXPLHAclQClohDFhws";

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('❌ Supabase credentials not found in .env.local');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function checkBomQuantity() {
  try {
    console.log('🔍 Checking BOM data for DR8-0026...\n');

    // heater_bom テーブルから model=DR8-0026 のデータを取得
    const { data: bomData, error: bomError } = await supabase
      .from('heater_bom')
      .select('*')
      .eq('model', 'DR8-0026')
      .order('part_key');

    if (bomError) {
      console.error('❌ Error fetching from heater_bom:', bomError.message);
      process.exit(1);
    }

    console.log(`✅ Found ${bomData?.length || 0} parts in heater_bom for model=DR8-0026\n`);

    // DR8-0026-02を探す
    const targetPart = bomData?.find(item => item.part_key === 'DR8-0026-02');

    if (targetPart) {
      console.log('📊 DR8-0026-02 Data in heater_bom:');
      console.log('  - part_key:', targetPart.part_key);
      console.log('  - model:', targetPart.model);
      console.log('  - part_name:', targetPart.part_name);
      console.log('  - quantity:', targetPart.quantity);
      console.log('  - created_at:', targetPart.created_at);
      console.log('  - updated_at:', targetPart.updated_at);
    } else {
      console.log('❌ DR8-0026-02 not found in heater_bom');
    }

    // heater_parts_master で確認
    console.log('\n---\n');
    const { data: partsData, error: partsError } = await supabase
      .from('heater_parts_master')
      .select('*')
      .eq('part_key', 'DR8-0026-02');

    if (partsError) {
      console.error('❌ Error fetching from heater_parts_master:', partsError.message);
      process.exit(1);
    }

    if (partsData?.length > 0) {
      console.log('📊 DR8-0026-02 Data in heater_parts_master:');
      partsData.forEach(part => {
        console.log('  - part_key:', part.part_key);
        console.log('  - product_code:', part.product_code);
        console.log('  - part_name:', part.part_name);
        console.log('  - spec:', part.spec);
        console.log('  - cost_price:', part.cost_price);
      });
    } else {
      console.log('❌ DR8-0026-02 not found in heater_parts_master');
    }

    // 全パーツ一覧を表示
    console.log('\n---\n');
    console.log('📋 All parts for DR8-0026:');
    console.log('');
    bomData?.forEach((item, idx) => {
      console.log(
        `${idx + 1}. ${item.part_key} | ${item.part_name || '(no name)'} | qty: ${item.quantity}`
      );
    });

  } catch (error) {
    console.error('❌ Unexpected error:', error);
    process.exit(1);
  }
}

checkBomQuantity();
