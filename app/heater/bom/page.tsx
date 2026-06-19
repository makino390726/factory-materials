'use client';

import { useState, useEffect, useMemo } from 'react';
import { flushSync } from 'react-dom';
import Link from 'next/link';

function formatCostAsOfJa(d: Date): string {
  const s = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
  return `${s} 時点の原価`;
}

interface BomItem {
  model: string;
  part_key: string;
  quantity: number;
  product_code?: string;
  part_name?: string;
  spec?: string;
  cost_price?: number;
  cost_amount?: number;
  material_cost?: number;
  labor_cost?: number;
  indirect_cost?: number;
  total_cost?: number;
}

interface HeaterModel {
  model: string;
  name: string | null;
}

interface PartsMaster {
  part_key: string;
  product_code: string | null;
  part_name: string;
  spec: string | null;
}

export default function BomPage() {
  const [bom, setBom] = useState<BomItem[]>([]);
  const [models, setModels] = useState<HeaterModel[]>([]);
  const [parts, setParts] = useState<PartsMaster[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [formData, setFormData] = useState<{
    model: string;
    part_key: string;
    quantity: number;
    product_code: string;
    cost_price: number;
  }>({
    model: '',
    part_key: '',
    quantity: 0,
    product_code: '',
    cost_price: 0,
  });
  const [filterModel, setFilterModel] = useState('');
  /** 機種構成一覧の印刷に印字する「時点原価」ラベル（印刷ボタン押下時に確定） */
  const [modelListCostAsOfLabel, setModelListCostAsOfLabel] = useState<string | null>(null);

  useEffect(() => {
    fetchBom();
    fetchModels();
    fetchParts();
  }, []);

  useEffect(() => {
    const onBeforePrint = () => {
      flushSync(() => {
        setModelListCostAsOfLabel(formatCostAsOfJa(new Date()));
      });
    };
    window.addEventListener('beforeprint', onBeforePrint);
    return () => window.removeEventListener('beforeprint', onBeforePrint);
  }, []);

  const fetchBom = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/heater/bom');
      if (!res.ok) throw new Error('Failed to fetch BOM');
      const data = await res.json();
      setBom(data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const fetchModels = async () => {
    try {
      const res = await fetch('/api/heater/models');
      if (!res.ok) throw new Error('Failed to fetch models');
      const data = await res.json();
      setModels(data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  };

  const fetchParts = async () => {
    try {
      const res = await fetch('/api/heater/parts-master');
      if (!res.ok) throw new Error('Failed to fetch parts');
      const data = await res.json();
      setParts(data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.model || !formData.part_key) {
      setError('機種と部品は必須です');
      return;
    }
    try {
      const res = await fetch('/api/heater/bom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      if (!res.ok) throw new Error('Failed to create BOM item');
      await fetchBom();
      setFormData({ model: '', part_key: '', quantity: 0, product_code: '', cost_price: 0 });
      setIsEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  };

  const handleEdit = (item: BomItem) => {
    console.log('Edit button clicked:', item);
    setEditingKey(`${item.model}-${item.part_key}`);
    setFormData({
      model: item.model,
      part_key: item.part_key,
      quantity: item.quantity,
      product_code: item.product_code || '',
      cost_price: item.cost_price || 0,
    });
    setIsEditing(true);
    // スクロールしてフォームに焦点を当てる
    setTimeout(() => {
      document.querySelector('form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingKey) return;
    try {
      const res = await fetch('/api/heater/bom', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      if (!res.ok) throw new Error('Failed to update BOM item');
      await fetchBom();
      setFormData({ model: '', part_key: '', quantity: 0, product_code: '', cost_price: 0 });
      setEditingKey(null);
      setIsEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  };

  const handleDelete = async (model: string, partKey: string) => {
    if (!confirm(`この BOM 行を削除しますか？`)) return;
    try {
      const res = await fetch(
        `/api/heater/bom?model=${encodeURIComponent(model)}&part_key=${encodeURIComponent(partKey)}`,
        { method: 'DELETE' }
      );
      if (!res.ok) throw new Error('Failed to delete BOM item');
      await fetchBom();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  };

  const filteredBom = filterModel ? bom.filter((item) => item.model === filterModel) : bom;

  const normalizedAllBom = useMemo(
    () =>
      bom.map((item) => {
        const materialCost = Number(item.material_cost ?? 0);
        const laborCost = Number(item.labor_cost ?? 0);
        const indirectCost = Number(item.indirect_cost ?? 0);
        const totalCost = Number(item.total_cost ?? materialCost + laborCost + indirectCost);
        return {
          ...item,
          material_cost: materialCost,
          labor_cost: laborCost,
          indirect_cost: indirectCost,
          total_cost: totalCost,
        };
      }),
    [bom]
  );

  const normalizedBom = useMemo(
    () =>
      filteredBom.map((item) => {
        const materialCost = Number(item.material_cost ?? 0);
        const laborCost = Number(item.labor_cost ?? 0);
        const indirectCost = Number(item.indirect_cost ?? 0);
        const totalCost = Number(item.total_cost ?? materialCost + laborCost + indirectCost);
        return {
          ...item,
          material_cost: materialCost,
          labor_cost: laborCost,
          indirect_cost: indirectCost,
          total_cost: totalCost,
        };
      }),
    [filteredBom]
  );

  const totalMaterial = normalizedBom.reduce((sum, item) => sum + item.material_cost, 0);
  const totalLabor = normalizedBom.reduce((sum, item) => sum + item.labor_cost, 0);
  const totalIndirect = normalizedBom.reduce((sum, item) => sum + item.indirect_cost, 0);
  const totalAmount = normalizedBom.reduce((sum, item) => sum + item.total_cost, 0);
  const uniqueParts = new Set(normalizedBom.map((item) => item.part_key)).size;

  const modelConfigList = useMemo(() => {
    const nameByModel = new Map(models.map((m) => [m.model, m.name?.trim() || '']));
    type Agg = {
      model: string;
      displayName: string;
      material: number;
      indirect: number;
      labor: number;
      total: number;
    };
    const map = new Map<string, Agg>();
    for (const item of normalizedAllBom) {
      let row = map.get(item.model);
      if (!row) {
        const dn = nameByModel.get(item.model);
        row = {
          model: item.model,
          displayName: dn && dn.length > 0 ? dn : item.model,
          material: 0,
          indirect: 0,
          labor: 0,
          total: 0,
        };
        map.set(item.model, row);
      }
      row.material += item.material_cost;
      row.indirect += item.indirect_cost;
      row.labor += item.labor_cost;
      row.total += item.total_cost;
    }
    for (const m of models) {
      const code = m.model;
      if (!map.has(code)) {
        const dn = m.name?.trim() || '';
        map.set(code, {
          model: code,
          displayName: dn.length > 0 ? dn : code,
          material: 0,
          indirect: 0,
          labor: 0,
          total: 0,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) =>
      a.model.localeCompare(b.model, 'ja', { numeric: true })
    );
  }, [normalizedAllBom, models]);

  const modelConfigTotals = useMemo(
    () =>
      modelConfigList.reduce(
        (acc, r) => ({
          material: acc.material + r.material,
          indirect: acc.indirect + r.indirect,
          labor: acc.labor + r.labor,
          total: acc.total + r.total,
        }),
        { material: 0, indirect: 0, labor: 0, total: 0 }
      ),
    [modelConfigList]
  );

  const handlePrintModelConfigList = () => {
    window.print();
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 text-white px-4 py-8 print:bg-white print:text-black print:min-h-0">
      <style>{`
        @media print {
          @page {
            size: A4 portrait;
            margin: 8mm 10mm;
          }
          #bom-model-config-print .bom-model-print-table {
            table-layout: fixed;
            width: 100%;
            font-size: 9px;
          }
          #bom-model-config-print .bom-model-print-table colgroup col:first-child {
            width: 12% !important;
          }
          #bom-model-config-print .bom-model-print-table colgroup col:not(:first-child) {
            width: 22% !important;
          }
          #bom-model-config-print .bom-model-print-table .bom-model-col-model {
            min-width: 0;
            overflow: hidden;
            word-break: break-word;
            padding-left: 3px;
            padding-right: 3px;
          }
          #bom-model-config-print .bom-model-print-table .bom-model-col-num {
            padding-left: 3px;
            padding-right: 3px;
          }
        }
      `}</style>
      <div className="max-w-screen-xl mx-auto space-y-6 print:max-w-none print:mx-0 print:space-y-0">
        <div className="print:hidden space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <span className="px-3 py-1 rounded-full bg-violet-500/20 border border-violet-400/40 text-violet-300 text-xs font-bold tracking-widest uppercase">
                BOM集計
              </span>
              <span className="text-slate-400 text-sm">構成部品マスタ</span>
            </div>
            <h1 className="text-3xl sm:text-4xl font-bold text-white">BOM（構成部品）</h1>
            <p className="mt-2 text-sm text-slate-400">機種別の構成部品と原価を管理します。D指令BOMと同じ表示トーンで確認できます。</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Link href="/masters/import#ec30-bom">
              <button className="px-5 py-2 rounded-full border border-emerald-500/50 text-emerald-200 hover:text-white hover:border-emerald-400 transition text-sm">
                EC30 図番取込（マスタCSV）
              </button>
            </Link>
            <Link href="/heater/models/dr8008">
              <button className="px-5 py-2 rounded-full border border-slate-500/60 text-slate-300 hover:text-white hover:border-slate-400 transition text-sm">
                ← D指令原価BOM
              </button>
            </Link>
            <Link href="/">
              <button className="px-5 py-2 rounded-full border border-rose-400/40 text-rose-200 hover:border-rose-300 hover:text-white transition text-sm">
                ← ホーム
              </button>
            </Link>
          </div>
        </div>

        {error && (
          <div className="bg-rose-900/40 border border-rose-500/50 rounded-2xl p-4 text-rose-300">
            {error}
          </div>
        )}

        <div className="bg-slate-800/70 border border-slate-600/50 rounded-2xl p-5">
          <p className="text-sm font-semibold text-slate-300 mb-3">① 機種で表示を絞り込み</p>
          <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3 items-end">
            <div>
              <label className="block text-xs text-slate-400 mb-1">機種フィルター</label>
              <select
                value={filterModel}
                onChange={(e) => setFilterModel(e.target.value)}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-violet-500"
              >
                <option value="">すべて表示</option>
                {models.map((m) => (
                  <option key={m.model} value={m.model}>
                    {m.model}
                  </option>
                ))}
              </select>
            </div>
            <button
              onClick={fetchBom}
              disabled={loading}
              className="px-6 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:bg-violet-800/50 disabled:cursor-not-allowed text-white font-semibold text-sm transition"
            >
              {loading ? '更新中…' : '更新'}
            </button>
          </div>
          <div className="mt-3 pt-3 border-t border-slate-700 flex flex-wrap gap-4 text-xs text-slate-400">
            <span>表示行: <span className="text-white font-semibold">{normalizedBom.length}</span></span>
            <span>部品種類: <span className="text-sky-300 font-semibold">{uniqueParts}</span></span>
            <span>合計原価: <span className="text-yellow-300 font-semibold">¥{totalAmount.toLocaleString('ja-JP')}</span></span>
          </div>
        </div>

        <div className="bg-slate-800/70 border border-slate-600/50 rounded-2xl p-5">
          <h2 className="text-lg font-semibold text-white mb-4">② {isEditing ? 'BOMを編集' : '新しいBOMを追加'}</h2>
          <form onSubmit={isEditing ? handleUpdate : handleCreate} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs text-slate-400 mb-1">機種 *</label>
                <select
                  value={formData.model}
                  onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                  disabled={isEditing}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-violet-500 disabled:opacity-60"
                >
                  <option value="">選択してください</option>
                  {models.map((m) => (
                    <option key={m.model} value={m.model}>
                      {m.model}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">部品 *</label>
                <select
                  value={formData.part_key}
                  onChange={(e) => setFormData({ ...formData, part_key: e.target.value })}
                  disabled={isEditing}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-violet-500 disabled:opacity-60"
                >
                  <option value="">選択してください</option>
                  {parts.map((p) => (
                    <option key={p.part_key} value={p.part_key}>
                      {p.part_name} ({p.product_code || p.part_key})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">1台当たり必要数</label>
                <input
                  type="number"
                  step="0.01"
                  value={formData.quantity}
                  onChange={(e) => setFormData({ ...formData, quantity: parseFloat(e.target.value) || 0 })}
                  disabled={isEditing}
                  min="0"
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-violet-500 disabled:opacity-60"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-slate-400 mb-1">部品キー</label>
                <input
                  type="text"
                  value={formData.part_key}
                  disabled={true}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-sm text-slate-300"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">原価単価 (¥)</label>
                <input
                  type="number"
                  step="0.01"
                  value={formData.cost_price}
                  onChange={(e) => setFormData({ ...formData, cost_price: parseFloat(e.target.value) || 0 })}
                  disabled={!isEditing}
                  min="0"
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-violet-500 disabled:opacity-60"
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-2 pt-2">
              <button
                type="submit"
                className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm transition"
              >
                {isEditing ? '更新' : '登録'}
              </button>
              {isEditing && (
                <button
                  type="button"
                  onClick={() => {
                    setIsEditing(false);
                    setEditingKey(null);
                    setFormData({ model: '', part_key: '', quantity: 0, product_code: '', cost_price: 0 });
                  }}
                  className="px-5 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-100 font-semibold text-sm transition"
                >
                  キャンセル
                </button>
              )}
            </div>
          </form>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="bg-slate-800/60 border border-slate-600/50 rounded-2xl p-4">
            <p className="text-xs text-slate-400 mb-1">表示中のBOM行数</p>
            <p className="text-xl font-bold text-sky-300">{normalizedBom.length}</p>
          </div>
          <div className="bg-slate-800/60 border border-slate-600/50 rounded-2xl p-4">
            <p className="text-xs text-slate-400 mb-1">部品種類</p>
            <p className="text-xl font-bold text-cyan-300">{uniqueParts}</p>
          </div>
          <div className="bg-slate-800/60 border border-slate-600/50 rounded-2xl p-4">
            <p className="text-xs text-slate-400 mb-1">フィルター機種</p>
            <p className="text-xl font-bold text-violet-300">{filterModel || '全機種'}</p>
          </div>
          <div className="bg-indigo-900/50 border-2 border-indigo-500/60 rounded-2xl p-4">
            <p className="text-xs text-indigo-300 mb-1 font-semibold">合計原価額</p>
            <p className="text-2xl font-extrabold text-yellow-300">¥{totalAmount.toLocaleString('ja-JP')}</p>
          </div>
        </div>
        </div>

        {!loading && bom.length > 0 && (
          <section
            id="bom-model-config-print"
            className="bg-slate-800/70 border border-slate-600/50 rounded-2xl p-5 print:rounded-none print:border-2 print:border-black print:bg-white print:text-black print:shadow-none print:break-inside-avoid print:p-3"
          >
            <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
              <div className="min-w-0 flex-1">
                <h2 className="text-lg font-semibold text-white print:text-black">機種構成一覧</h2>
                <p className="text-xs text-slate-400 mt-1 print:hidden">
                  全BOMを機種単位で集計（機種マスタの名称を表示。BOM未登録の機種は 0 円）
                </p>
                {modelListCostAsOfLabel ? (
                  <p className="mt-2 text-sm font-bold text-amber-200 border border-amber-500/40 rounded-lg px-3 py-2 bg-amber-950/40 print:text-black print:border-black print:bg-white print:mt-3">
                    {modelListCostAsOfLabel}
                  </p>
                ) : (
                  <p className="mt-2 text-xs text-slate-500 print:hidden">
                    「印刷」実行時に、押下した日時を「○○ 時点の原価」として印字します（単価更新後の再印刷の目安にしてください）。
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={handlePrintModelConfigList}
                className="shrink-0 px-4 py-2 rounded-lg bg-slate-600 hover:bg-slate-500 border border-slate-500 text-white text-sm font-semibold print:hidden transition"
              >
                印刷
              </button>
            </div>
            <div className="overflow-x-auto rounded-xl border border-slate-700/80 print:border-black print:rounded-md print:overflow-visible">
              <table className="bom-model-print-table min-w-full text-sm print:text-[10px] table-fixed w-full">
                <colgroup>
                  <col style={{ width: '17%' }} />
                  <col style={{ width: '20.75%' }} />
                  <col style={{ width: '20.75%' }} />
                  <col style={{ width: '20.75%' }} />
                  <col style={{ width: '20.75%' }} />
                </colgroup>
                <thead className="bg-slate-900/90 border-b border-slate-600 print:bg-slate-200 print:border-black">
                  <tr>
                    <th className="bom-model-col-model px-2 py-2 text-left font-bold text-slate-300 print:text-black">
                      機種名
                    </th>
                    <th className="bom-model-col-num px-2 py-2 text-right font-bold text-slate-300 print:text-black">
                      材料費
                    </th>
                    <th className="bom-model-col-num px-2 py-2 text-right font-bold text-slate-300 print:text-black">
                      間接費
                    </th>
                    <th className="bom-model-col-num px-2 py-2 text-right font-bold text-slate-300 print:text-black">
                      工賃
                    </th>
                    <th className="bom-model-col-num px-2 py-2 text-right font-bold text-slate-300 print:text-black">
                      合計
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700/80 print:divide-slate-400">
                  {modelConfigList.map((row, idx) => (
                    <tr
                      key={row.model}
                      className={
                        (idx % 2 === 0 ? 'bg-slate-900/50' : 'bg-slate-800/30') +
                        ' print:bg-white print:text-black'
                      }
                    >
                      <td className="bom-model-col-model px-2 py-2 align-top print:border-b print:border-slate-300">
                        <div
                          className="font-semibold text-white print:text-black line-clamp-2 break-words text-xs sm:text-sm leading-tight"
                          title={`${row.displayName}${row.displayName !== row.model ? ` (${row.model})` : ''}`}
                        >
                          {row.displayName}
                        </div>
                        {row.displayName !== row.model && (
                          <div className="text-[10px] text-slate-500 font-mono mt-0.5 print:text-slate-700 truncate" title={row.model}>
                            {row.model}
                          </div>
                        )}
                      </td>
                      <td className="bom-model-col-num px-2 py-2 text-right text-sky-300 tabular-nums print:text-black text-xs sm:text-sm">
                        ¥{Math.round(row.material).toLocaleString('ja-JP')}
                      </td>
                      <td className="bom-model-col-num px-2 py-2 text-right text-violet-300 tabular-nums print:text-black text-xs sm:text-sm">
                        ¥{Math.round(row.indirect).toLocaleString('ja-JP')}
                      </td>
                      <td className="bom-model-col-num px-2 py-2 text-right text-emerald-300 tabular-nums print:text-black text-xs sm:text-sm">
                        ¥{Math.round(row.labor).toLocaleString('ja-JP')}
                      </td>
                      <td className="bom-model-col-num px-2 py-2 text-right text-yellow-300 font-bold tabular-nums print:text-black print:font-bold text-xs sm:text-sm">
                        ¥{Math.round(row.total).toLocaleString('ja-JP')}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t-2 border-slate-600 bg-slate-900/80 print:bg-slate-100 print:border-black">
                  <tr>
                    <td className="bom-model-col-model px-2 py-2 font-bold text-slate-200 print:text-black text-xs sm:text-sm">
                      計（{modelConfigList.length} 機種）
                    </td>
                    <td className="bom-model-col-num px-2 py-2 text-right font-bold text-sky-300 tabular-nums print:text-black text-xs sm:text-sm">
                      ¥{Math.round(modelConfigTotals.material).toLocaleString('ja-JP')}
                    </td>
                    <td className="bom-model-col-num px-2 py-2 text-right font-bold text-violet-300 tabular-nums print:text-black text-xs sm:text-sm">
                      ¥{Math.round(modelConfigTotals.indirect).toLocaleString('ja-JP')}
                    </td>
                    <td className="bom-model-col-num px-2 py-2 text-right font-bold text-emerald-300 tabular-nums print:text-black text-xs sm:text-sm">
                      ¥{Math.round(modelConfigTotals.labor).toLocaleString('ja-JP')}
                    </td>
                    <td className="bom-model-col-num px-2 py-2 text-right font-extrabold text-yellow-300 tabular-nums print:text-black text-xs sm:text-sm">
                      ¥{Math.round(modelConfigTotals.total).toLocaleString('ja-JP')}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>
        )}

        <div className="bg-slate-900/80 border-2 border-slate-700 rounded-3xl overflow-hidden print:hidden">
          {loading ? (
            <div className="p-12 text-center text-slate-400">読み込み中…</div>
          ) : normalizedBom.length === 0 ? (
            <div className="p-12 text-center text-slate-500">
              <p className="text-lg font-medium">BOM がまだ登録されていません</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full table-fixed text-xs">
                <thead className="sticky top-0 z-10 bg-slate-800 border-b-2 border-slate-700">
                  <tr>
                    <th className="w-[72px] min-w-[72px] max-w-[72px] px-2 py-3 text-left font-bold text-slate-300">機種</th>
                    <th className="w-[140px] px-3 py-3 text-left font-bold text-slate-300">部品キー</th>
                    <th className="w-[260px] px-3 py-3 text-left font-bold text-slate-300">部品名</th>
                    <th className="w-[220px] px-3 py-3 text-left font-bold text-slate-300">規格</th>
                    <th className="w-[110px] px-2 py-3 text-right font-bold text-slate-300">数量</th>
                    <th className="w-[120px] px-2 py-3 text-right font-bold text-slate-300">単価</th>
                    <th className="w-[110px] px-2 py-3 text-right font-bold text-slate-300">材料費</th>
                    <th className="w-[110px] px-2 py-3 text-right font-bold text-slate-300">工賃</th>
                    <th className="w-[110px] px-2 py-3 text-right font-bold text-slate-300">間接費</th>
                    <th className="w-[120px] px-2 py-3 text-right font-bold text-slate-300">合計</th>
                    <th className="w-[120px] px-2 py-3 text-right font-bold text-slate-300">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {normalizedBom.map((item, idx) => (
                    <tr key={`${item.model}-${item.part_key}-${idx}`} className={idx % 2 === 0 ? 'bg-slate-900/40' : 'bg-slate-800/20'}>
                      <td className="w-[72px] min-w-[72px] max-w-[72px] px-2 py-2 text-cyan-300 font-semibold align-top">
                        <span className="block line-clamp-3 break-all text-[11px] leading-tight" title={item.model}>
                          {item.model}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-slate-300 font-mono">{item.part_key || '-'}</td>
                      <td className="px-3 py-2 text-slate-200">{item.part_name || '-'}</td>
                      <td className="px-3 py-2 text-slate-400">{item.spec || '-'}</td>
                      <td className="px-2 py-2 text-right text-slate-200">{item.quantity}</td>
                      <td className="px-2 py-2 text-right text-slate-200">¥{(item.cost_price || 0).toLocaleString('ja-JP')}</td>
                      <td className="px-2 py-2 text-right text-sky-300">¥{(item.material_cost || 0).toLocaleString('ja-JP')}</td>
                      <td className="px-2 py-2 text-right text-emerald-300">¥{(item.labor_cost || 0).toLocaleString('ja-JP')}</td>
                      <td className="px-2 py-2 text-right text-violet-300">¥{(item.indirect_cost || 0).toLocaleString('ja-JP')}</td>
                      <td className="px-2 py-2 text-right text-yellow-300 font-bold">¥{(item.total_cost || 0).toLocaleString('ja-JP')}</td>
                      <td className="px-2 py-2 text-right">
                        <div className="flex justify-end gap-1">
                          <button
                            onClick={() => handleEdit(item)}
                            className="px-2 py-1 rounded-md bg-emerald-600 text-white hover:bg-emerald-700 transition text-xs font-medium"
                          >
                            編集
                          </button>
                          <button
                            onClick={() => handleDelete(item.model, item.part_key)}
                            className="px-2 py-1 rounded-md bg-red-600 text-white hover:bg-red-700 transition text-xs font-medium"
                          >
                            削除
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t-4 border-yellow-500/50 bg-gradient-to-r from-yellow-900/30 to-amber-900/30">
                  <tr>
                    <td colSpan={6} className="px-3 py-4 text-right font-extrabold text-yellow-300 text-base tracking-widest uppercase">BOM 構成部品 原価総合計</td>
                    <td className="px-2 py-4 text-right font-bold text-sky-300">¥{totalMaterial.toLocaleString('ja-JP')}</td>
                    <td className="px-2 py-4 text-right font-bold text-emerald-300">¥{totalLabor.toLocaleString('ja-JP')}</td>
                    <td className="px-2 py-4 text-right font-bold text-violet-300">¥{totalIndirect.toLocaleString('ja-JP')}</td>
                    <td className="px-2 py-4 text-right font-extrabold text-2xl text-yellow-300 bg-yellow-900/40">¥{totalAmount.toLocaleString('ja-JP')}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
