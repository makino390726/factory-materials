'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

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
  cost_price?: number | null;
  shelf_no?: string | null;
}

type PartInputMode = 'existing' | 'new';

export default function BomPage() {
  const searchParams = useSearchParams();
  const initialModel = searchParams.get('model')?.trim() || '';
  const [bom, setBom] = useState<BomItem[]>([]);
  const [models, setModels] = useState<HeaterModel[]>([]);
  const [parts, setParts] = useState<PartsMaster[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [partInputMode, setPartInputMode] = useState<PartInputMode>('existing');
  const [formData, setFormData] = useState<{
    model: string;
    part_key: string;
    quantity: number;
    product_code: string;
    cost_price: number;
    part_name: string;
    spec: string;
  }>({
    model: initialModel,
    part_key: '',
    quantity: 0,
    product_code: '',
    cost_price: 0,
    part_name: '',
    spec: '',
  });
  const [filterModel, setFilterModel] = useState(initialModel);

  const emptyForm = (model = '') => ({
    model,
    part_key: '',
    quantity: 0,
    product_code: '',
    cost_price: 0,
    part_name: '',
    spec: '',
  });

  const resetCreateForm = () => {
    setFormData(emptyForm(filterModel || formData.model));
    setPartInputMode('existing');
    setIsEditing(false);
    setEditingKey(null);
  };

  useEffect(() => {
    fetchBom();
    fetchModels();
    fetchParts();
  }, []);

  useEffect(() => {
    const model = searchParams.get('model')?.trim() || '';
    if (!model) return;
    setFilterModel(model);
    setFormData((prev) => (prev.model ? prev : { ...prev, model }));
  }, [searchParams]);

  // 既存部品選択時は①の機種フィルターを登録先機種として使う
  useEffect(() => {
    if (isEditing) return;
    if (partInputMode !== 'existing') return;
    setFormData((prev) => ({ ...prev, model: filterModel }));
  }, [filterModel, partInputMode, isEditing]);

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
    const targetModel = partInputMode === 'existing' ? (filterModel || formData.model) : formData.model;
    if (!targetModel || !formData.part_key.trim()) {
      setError(
        partInputMode === 'existing'
          ? '①で機種を選択し、部品を選んでください'
          : '機種と部品は必須です'
      );
      return;
    }
    if (partInputMode === 'new' && !formData.part_name.trim()) {
      setError('新規部品の品名は必須です');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const partKey = formData.part_key.trim();

      if (partInputMode === 'new') {
        const partRes = await fetch('/api/heater/parts-master', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            part_key: partKey,
            part_name: formData.part_name.trim(),
            product_code: formData.product_code.trim() || null,
            spec: formData.spec.trim() || null,
            cost_price: Number(formData.cost_price) || 0,
            shelf_no: null,
          }),
        });
        if (!partRes.ok) {
          const errJson = await partRes.json().catch(() => ({}));
          throw new Error(errJson.error || '部品マスタの新規登録に失敗しました');
        }
      }

      const res = await fetch('/api/heater/bom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: targetModel,
          part_key: partKey,
          quantity: Number(formData.quantity) || 0,
        }),
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || 'BOM行の登録に失敗しました');
      }

      await Promise.all([fetchBom(), fetchParts()]);
      resetCreateForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (item: BomItem) => {
    setEditingKey(`${item.model}-${item.part_key}`);
    setPartInputMode('existing');
    setFormData({
      model: item.model,
      part_key: item.part_key,
      quantity: item.quantity,
      product_code: item.product_code || '',
      cost_price: item.cost_price || 0,
      part_name: item.part_name || '',
      spec: item.spec || '',
    });
    setIsEditing(true);
    setTimeout(() => {
      document.querySelector('form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingKey) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/heater/bom', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: formData.model,
          part_key: formData.part_key,
          quantity: Number(formData.quantity) || 0,
          cost_price: Number(formData.cost_price) || 0,
        }),
      });
      if (!res.ok) throw new Error('Failed to update BOM item');
      await fetchBom();
      resetCreateForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setSaving(false);
    }
  };

  const handleSelectExistingPart = (partKey: string) => {
    const selected = parts.find((p) => p.part_key === partKey);
    setFormData((prev) => ({
      ...prev,
      part_key: partKey,
      product_code: selected?.product_code || '',
      cost_price: Number(selected?.cost_price || 0),
      part_name: selected?.part_name || '',
      spec: selected?.spec || '',
    }));
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

  /** 部品キー → 使用機種一覧（既存部品プルダウン表示用） */
  const modelsByPartKey = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const item of bom) {
      const key = String(item.part_key || '').trim();
      const model = String(item.model || '').trim();
      if (!key || !model) continue;
      const list = map.get(key) || [];
      if (!list.includes(model)) list.push(model);
      map.set(key, list);
    }
    for (const [key, list] of map) {
      list.sort((a, b) => a.localeCompare(b, 'ja'));
      map.set(key, list);
    }
    return map;
  }, [bom]);

  /** 類似機種の部品が上に来るよう並べた選択用リスト */
  const partsForSelect = useMemo(() => {
    const filterPrefix = filterModel.includes('-')
      ? filterModel.split('-')[0]
      : filterModel.replace(/\d+$/, '') || filterModel;

    const score = (partKey: string) => {
      const used = modelsByPartKey.get(partKey) || [];
      if (filterModel && used.includes(filterModel)) return 0;
      if (filterPrefix && used.some((m) => m === filterPrefix || m.startsWith(filterPrefix))) return 1;
      if (used.length > 0) return 2;
      return 3;
    };

    return [...parts].sort((a, b) => {
      const sa = score(a.part_key);
      const sb = score(b.part_key);
      if (sa !== sb) return sa - sb;
      return String(a.part_name || a.part_key).localeCompare(String(b.part_name || b.part_key), 'ja');
    });
  }, [parts, modelsByPartKey, filterModel]);

  const formatPartOptionLabel = (p: PartsMaster) => {
    const code = p.product_code || p.part_key;
    const usedModels = modelsByPartKey.get(p.part_key) || [];
    const modelLabel =
      usedModels.length === 0
        ? '未使用'
        : usedModels.length <= 4
          ? usedModels.join(', ')
          : `${usedModels.slice(0, 3).join(', ')} 他${usedModels.length - 3}`;
    return `${p.part_name} (${code})（${modelLabel}）`;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 text-white px-4 py-8">
      <div className="max-w-screen-xl mx-auto space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <span className="px-3 py-1 rounded-full bg-violet-500/20 border border-violet-400/40 text-violet-300 text-xs font-bold tracking-widest uppercase">
                部品表
              </span>
              <span className="text-slate-400 text-sm">構成部品マスタ</span>
            </div>
            <h1 className="text-3xl sm:text-4xl font-bold text-white">部品表(BOM)</h1>
            <p className="mt-2 text-sm text-slate-400">機種別の構成部品を登録・編集します。部品キー／品名をクリックすると原価計算（L指令）へ移動します。</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Link href="/masters/import#ec30-bom">
              <button className="px-5 py-2 rounded-full border border-emerald-500/50 text-emerald-200 hover:text-white hover:border-emerald-400 transition text-sm">
                図番管理表（BOM）取込
              </button>
            </Link>
            <Link href="/heater/models/dr8008?source=heater_model">
              <button className="px-5 py-2 rounded-full border border-slate-500/60 text-slate-300 hover:text-white hover:border-slate-400 transition text-sm">
                ← 機種標準原価
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
            {!isEditing && (
              <div className="inline-flex rounded-full bg-slate-900 p-1 border border-slate-600">
                <button
                  type="button"
                  onClick={() => {
                    setPartInputMode('existing');
                    setFormData((prev) => ({
                      ...prev,
                      part_key: '',
                      product_code: '',
                      cost_price: 0,
                      part_name: '',
                      spec: '',
                    }));
                  }}
                  className={`px-4 py-1.5 rounded-full text-sm font-semibold transition ${
                    partInputMode === 'existing'
                      ? 'bg-violet-600 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  既存部品を選択
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPartInputMode('new');
                    setFormData((prev) => ({
                      ...prev,
                      part_key: '',
                      product_code: '',
                      cost_price: 0,
                      part_name: '',
                      spec: '',
                    }));
                  }}
                  className={`px-4 py-1.5 rounded-full text-sm font-semibold transition ${
                    partInputMode === 'new'
                      ? 'bg-emerald-600 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  新規部品を登録
                </button>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {(isEditing || partInputMode === 'new') && (
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
              )}

              {!isEditing && partInputMode === 'existing' && (
                <div>
                  <label className="block text-xs text-slate-400 mb-1">登録先機種</label>
                  <div className="w-full px-3 py-2 bg-slate-900/80 border border-slate-700 rounded-lg text-sm text-violet-200">
                    {filterModel || '①で機種を選択してください'}
                  </div>
                </div>
              )}

              {isEditing || partInputMode === 'existing' ? (
                <div>
                  <label className="block text-xs text-slate-400 mb-1">部品 *</label>
                  <select
                    value={formData.part_key}
                    onChange={(e) => handleSelectExistingPart(e.target.value)}
                    disabled={isEditing}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-violet-500 disabled:opacity-60"
                  >
                    <option value="">選択してください</option>
                    {partsForSelect.map((p) => (
                      <option key={p.part_key} value={p.part_key}>
                        {formatPartOptionLabel(p)}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div>
                  <label className="block text-xs text-slate-400 mb-1">部品キー *</label>
                  <input
                    type="text"
                    value={formData.part_key}
                    onChange={(e) => setFormData({ ...formData, part_key: e.target.value })}
                    placeholder="例: SGR300-PANEL"
                    className="w-full px-3 py-2 bg-slate-900 border border-emerald-600/60 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
              )}

              <div>
                <label className="block text-xs text-slate-400 mb-1">1台当たり必要数</label>
                <input
                  type="number"
                  step="0.01"
                  value={formData.quantity}
                  onChange={(e) => setFormData({ ...formData, quantity: parseFloat(e.target.value) || 0 })}
                  min="0"
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-violet-500"
                />
              </div>
            </div>

            {!isEditing && partInputMode === 'new' && (
              <div className="rounded-xl border border-emerald-600/40 bg-emerald-950/20 p-4 space-y-4">
                <p className="text-xs text-emerald-200">
                  パーツリストに未登録の部品を、BOM追加と同時に新規登録します。
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">品名 *</label>
                    <input
                      type="text"
                      value={formData.part_name}
                      onChange={(e) => setFormData({ ...formData, part_name: e.target.value })}
                      placeholder="部品名"
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">製品コード</label>
                    <input
                      type="text"
                      value={formData.product_code}
                      onChange={(e) => setFormData({ ...formData, product_code: e.target.value })}
                      placeholder="任意"
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">規格</label>
                    <input
                      type="text"
                      value={formData.spec}
                      onChange={(e) => setFormData({ ...formData, spec: e.target.value })}
                      placeholder="任意"
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">原価単価 (¥)</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={formData.cost_price}
                      onChange={(e) => setFormData({ ...formData, cost_price: parseFloat(e.target.value) || 0 })}
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>
                </div>
              </div>
            )}

            {(isEditing || partInputMode === 'existing') && (
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
            )}
            <div className="flex flex-wrap gap-2 pt-2">
              <button
                type="submit"
                disabled={saving}
                className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white font-semibold text-sm transition"
              >
                {saving ? '処理中…' : isEditing ? '更新' : partInputMode === 'new' ? '部品＋BOM登録' : '登録'}
              </button>
              {isEditing && (
                <button
                  type="button"
                  onClick={resetCreateForm}
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

        <div className="bg-slate-900/80 border-2 border-slate-700 rounded-3xl overflow-hidden">
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
                    {!filterModel && (
                      <th className="w-[72px] min-w-[72px] max-w-[72px] px-2 py-3 text-left font-bold text-slate-300">機種</th>
                    )}
                    <th className="w-[140px] px-3 py-3 text-left font-bold text-slate-300">部品キー</th>
                    <th className="w-[260px] px-3 py-3 text-left font-bold text-slate-300">部品名</th>
                    <th className="w-[220px] px-3 py-3 text-left font-bold text-slate-300">規格</th>
                    <th className="w-[110px] px-2 py-3 text-right font-bold text-slate-300">数量</th>
                    <th className="w-[120px] px-2 py-3 text-right font-bold text-slate-300">単価</th>
                    <th className="w-[110px] px-2 py-3 text-right font-bold text-slate-300">材料費</th>
                    <th className="w-[110px] px-2 py-3 text-right font-bold text-slate-300">工賃</th>
                    <th className="w-[110px] px-2 py-3 text-right font-bold text-slate-300">間接費</th>
                    <th className="w-[120px] px-2 py-3 text-right font-bold text-slate-300">合計</th>
                    <th className="w-[160px] px-2 py-3 text-right font-bold text-slate-300">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {normalizedBom.map((item, idx) => {
                    const costHref = `/work-orders/cost?mode=line&part_key=${encodeURIComponent(item.part_key)}&return_model=${encodeURIComponent(item.model)}&from=bom`
                    return (
                    <tr
                      key={`${item.model}-${item.part_key}-${idx}`}
                      className={(idx % 2 === 0 ? 'bg-slate-900/40' : 'bg-slate-800/20') + ' hover:bg-cyan-950/30'}
                    >
                      {!filterModel && (
                        <td className="w-[72px] min-w-[72px] max-w-[72px] px-2 py-2 text-cyan-300 font-semibold align-top">
                          <span className="block line-clamp-3 break-all text-[11px] leading-tight" title={item.model}>
                            {item.model}
                          </span>
                        </td>
                      )}
                      <td className="px-3 py-2 font-mono">
                        <Link href={costHref} className="text-cyan-300 hover:text-cyan-200 hover:underline">
                          {item.part_key || '-'}
                        </Link>
                      </td>
                      <td className="px-3 py-2">
                        <Link href={costHref} className="text-slate-200 hover:text-white hover:underline">
                          {item.part_name || '-'}
                        </Link>
                      </td>
                      <td className="px-3 py-2 text-slate-400">{item.spec || '-'}</td>
                      <td className="px-2 py-2 text-right text-slate-200">{item.quantity}</td>
                      <td className="px-2 py-2 text-right text-slate-200">¥{(item.cost_price || 0).toLocaleString('ja-JP')}</td>
                      <td className="px-2 py-2 text-right text-sky-300">¥{(item.material_cost || 0).toLocaleString('ja-JP')}</td>
                      <td className="px-2 py-2 text-right text-emerald-300">¥{(item.labor_cost || 0).toLocaleString('ja-JP')}</td>
                      <td className="px-2 py-2 text-right text-violet-300">¥{(item.indirect_cost || 0).toLocaleString('ja-JP')}</td>
                      <td className="px-2 py-2 text-right text-yellow-300 font-bold">¥{(item.total_cost || 0).toLocaleString('ja-JP')}</td>
                      <td className="px-2 py-2 text-right">
                        <div className="flex justify-end gap-1">
                          <Link
                            href={costHref}
                            className="px-2 py-1 rounded-md bg-cyan-600 text-white hover:bg-cyan-500 transition text-xs font-medium"
                          >
                            原価
                          </Link>
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
                    )
                  })}
                </tbody>
                <tfoot className="border-t-4 border-yellow-500/50 bg-gradient-to-r from-yellow-900/30 to-amber-900/30">
                  <tr>
                    <td colSpan={filterModel ? 5 : 6} className="px-3 py-4 text-right font-extrabold text-yellow-300 text-base tracking-widest uppercase">BOM 構成部品 原価総合計</td>
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
