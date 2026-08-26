'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import {
  DEFAULT_PRODUCT_CATEGORY,
  PRODUCT_CATEGORIES,
  inferProductCategory,
  normalizeProductCategory,
  type ProductCategory,
} from '@/lib/product-category';
import {
  formatFiscalYearLabel,
  getCurrentFiscalYear,
  getFiscalYearDateRange,
} from '@/lib/fiscal-year';

interface ManufacturingPlanItem {
  model: string;
  modelName: string | null;
  quantity: number;
  productCategory: ProductCategory;
  /** 見積・年度計画の営業計画台数（参考。製造台数とは独立） */
  salesQty: number | null;
}

interface AggregatedItem {
  product_code: string | null;
  part_key: string;
  part_name: string;
  spec: string | null;
  cost_price: number;
  total_qty: number;
  total_cost: number;
  stock_qty: number;
  shortage_qty: number;
  purchase_qty?: number; // フロントで計算: max(0, shortage_qty)
  purchase_amount?: number; // フロントで計算: purchase_qty × cost_price
}

interface SavedPlan {
  id: string;
  plan_name: string;
  fiscal_year: string;
  plan_period: string | null;
  product_category?: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

type CategoryFilter = 'すべて' | ProductCategory;
type SalesQtyMode = 'qty' | 'highQty';

const SKIP_SALES_MACHINE_CODES = new Set(['lump', 'other', 'その他']);

interface BomDetail {
  model: string;
  part_key: string;
  part_name: string;
  spec: string | null;
  product_code: string | null;
  quantity: number;
  cost_price: number;
  subtotal: number;
  branch_no?: string;
}

interface ManufacturingData {
  model: string;
  quantity: number;
  bomItems: BomDetail[];
  totalCost: number;
  product_category?: ProductCategory;
  cost_source?: 'heater_bom' | 'd_order';
  order_no?: string | null;
  work_order_id?: string | null;
  has_saved_cost?: boolean | null;
  material_total?: number | null;
  labor_total?: number | null;
  indirect_total?: number | null;
  unit_total_cost?: number | null;
  warning?: string | null;
}

interface InstructionSummary {
  model: string;
  quantity: number;
  product_category: ProductCategory;
  order_no: string | null;
  work_order_id: string | null;
  has_saved_cost: boolean;
  unit_total_cost: number;
  material_total: number;
  labor_total: number;
  indirect_total: number;
  total_cost: number;
  warning: string | null;
}

interface ManufacturingResponse {
  manufacturingData: ManufacturingData[];
  aggregatedItems: AggregatedItem[];
  instructionSummaries?: InstructionSummary[];
  warnings?: string[];
}

export default function ManufacturingPlanPage() {
  const [models, setModels] = useState<
    { model: string; name: string | null; product_category: ProductCategory }[]
  >([]);
  const [plans, setPlans] = useState<ManufacturingPlanItem[]>([]);
  const [response, setResponse] = useState<ManufacturingResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>(DEFAULT_PRODUCT_CATEGORY);
  const [planListFilter, setPlanListFilter] = useState<CategoryFilter>('すべて');

  // 保存関連の状態
  const [savedPlans, setSavedPlans] = useState<SavedPlan[]>([]);
  const [currentPlanId, setCurrentPlanId] = useState<string | null>(null);
  const [planName, setPlanName] = useState('');
  const [fiscalYear, setFiscalYear] = useState(() => String(getCurrentFiscalYear()));
  const [planPeriod, setPlanPeriod] = useState('');
  const [planCategory, setPlanCategory] = useState<ProductCategory>(DEFAULT_PRODUCT_CATEGORY);
  const [notes, setNotes] = useState('');
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [salesQtyMode, setSalesQtyMode] = useState<SalesQtyMode>('qty');
  const [importingSales, setImportingSales] = useState(false);
  const [salesImportInfo, setSalesImportInfo] = useState<string | null>(null);

  useEffect(() => {
    fetchModels();
    fetchSavedPlans();
  }, []);

  const normalizeModelList = (data: any[]) =>
    (data || []).map((m: any) => ({
      model: String(m.model),
      name: m.name ?? null,
      product_category: normalizeProductCategory(
        m.product_category || inferProductCategory(String(m.model), m.name)
      ),
    }));

  const fetchModels = async () => {
    try {
      const res = await fetch('/api/heater/models');
      if (!res.ok) throw new Error('Failed to fetch models');
      const data = normalizeModelList(await res.json());
      setModels(data);
      // 初期化：すべての機種を計画に追加（台数0）
      setPlans(
        data.map((m) => ({
          model: m.model,
          modelName: m.name,
          quantity: 0,
          productCategory: m.product_category,
          salesQty: null,
        }))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  };

  const fetchManufacturingPlan = async (plansOverride?: ManufacturingPlanItem[]) => {
    const targetPlans = plansOverride ?? plans;
    if (targetPlans.every((p) => p.quantity === 0)) {
      setResponse(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/heater/manufacturing-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plans: targetPlans }),
      });
      if (!res.ok) throw new Error('Failed to fetch manufacturing plan');
      const data = await res.json();
      setResponse(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const fetchSavedPlans = async () => {
    try {
      const res = await fetch('/api/heater/manufacturing-plan/save');
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to fetch saved plans');
      }
      if (data?.error) {
        throw new Error(data.error);
      }
      setSavedPlans(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Failed to fetch saved plans:', err);
      setError(err instanceof Error ? err.message : '保存済み計画の取得に失敗しました');
    }
  };

  const buildPlanItemsFromModels = (
    modelList: { model: string; name: string | null; product_category: ProductCategory }[],
    detailsMap?: Map<string, number>,
    salesMap?: Map<string, number>
  ): ManufacturingPlanItem[] =>
    modelList.map((m) => ({
      model: m.model,
      modelName: m.name,
      quantity: detailsMap?.get(m.model) ?? 0,
      productCategory: m.product_category,
      salesQty: salesMap?.has(m.model) ? (salesMap.get(m.model) ?? null) : null,
    }));

  const resolvePrimaryCategory = (items: ManufacturingPlanItem[]): ProductCategory => {
    const counts = new Map<ProductCategory, number>();
    for (const item of items) {
      if (item.quantity <= 0) continue;
      counts.set(item.productCategory, (counts.get(item.productCategory) || 0) + item.quantity);
    }
    let best: ProductCategory = planCategory || DEFAULT_PRODUCT_CATEGORY;
    let bestQty = -1;
    for (const [cat, qty] of counts) {
      if (qty > bestQty) {
        best = cat;
        bestQty = qty;
      }
    }
    return best;
  };

  const visiblePlans = useMemo(() => {
    if (categoryFilter === 'すべて') return plans;
    return plans.filter((p) => p.productCategory === categoryFilter);
  }, [plans, categoryFilter]);

  const filteredSavedPlans = useMemo(() => {
    if (planListFilter === 'すべて') return savedPlans;
    return savedPlans.filter(
      (p) => normalizeProductCategory(p.product_category || '暖房機') === planListFilter
    );
  }, [savedPlans, planListFilter]);

  const loadPlan = async (planId: string) => {
    try {
      setError(null);
      const res = await fetch(`/api/heater/manufacturing-plan/save?id=${encodeURIComponent(planId)}`);
      const data = await res.json();
      if (!res.ok || data?.error) {
        throw new Error(data?.error || 'Failed to load plan');
      }
      if (!Array.isArray(data.details)) {
        throw new Error('計画明細の取得に失敗しました');
      }

      setCurrentPlanId(data.id);
      setPlanName(data.plan_name);
      setFiscalYear(data.fiscal_year);
      setPlanPeriod(data.plan_period || '');
      setNotes(data.notes || '');
      const loadedCategory = normalizeProductCategory(data.product_category || '暖房機');
      setPlanCategory(loadedCategory);
      setCategoryFilter(loadedCategory);

      const detailsMap = new Map<string, number>(
        data.details.map((d: { model: string; quantity: number }) => [
          String(d.model),
          Number(d.quantity) || 0,
        ])
      );

      let modelList = models;
      if (modelList.length === 0) {
        const modelRes = await fetch('/api/heater/models');
        if (!modelRes.ok) throw new Error('機種マスタの取得に失敗しました');
        modelList = normalizeModelList(await modelRes.json());
        setModels(modelList || []);
      }

      // 計画明細にあり機種マスタに無い機種も表示できるよう補完
      const known = new Set(modelList.map((m) => m.model));
      for (const [model] of detailsMap) {
        if (!known.has(model)) {
          modelList = [
            ...modelList,
            {
              model,
              name: null,
              product_category: loadedCategory,
            },
          ];
        }
      }

      const prevSalesByModel = new Map(
        plans.filter((p) => p.salesQty != null).map((p) => [p.model, p.salesQty as number])
      );
      const nextPlans = buildPlanItemsFromModels(modelList, detailsMap).map((p) => ({
        ...p,
        salesQty: prevSalesByModel.has(p.model) ? prevSalesByModel.get(p.model)! : null,
      }));
      setPlans(nextPlans);
      await fetchManufacturingPlan(nextPlans);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  };

  const savePlan = async () => {
    if (!planName || !fiscalYear) {
      setError('計画名と年度は必須です');
      return;
    }

    try {
      setError(null);
      const detailsMap = new Map<string, number>();
      for (const p of plans) {
        if (p.quantity <= 0) continue;
        detailsMap.set(p.model, (detailsMap.get(p.model) || 0) + Number(p.quantity));
      }
      const details = Array.from(detailsMap.entries()).map(([model, quantity]) => ({
        model,
        quantity,
      }));
      if (details.length === 0) {
        setError('台数が1以上の機種がありません');
        return;
      }
      const product_category = planCategory || resolvePrimaryCategory(plans);

      const method = currentPlanId ? 'PUT' : 'POST';
      const body: any = {
        plan_name: planName,
        fiscal_year: fiscalYear,
        plan_period: planPeriod,
        notes,
        product_category,
        details
      };

      if (currentPlanId) {
        body.id = currentPlanId;
      }

      const res = await fetch('/api/heater/manufacturing-plan/save', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || `計画の保存に失敗しました（HTTP ${res.status}）`);
      }
      
      setCurrentPlanId(data.id || currentPlanId);
      setShowSaveDialog(false);
      await fetchSavedPlans();

      const sync = data.labor_sync;
      if (sync && typeof sync.success_count === 'number') {
        const failureLines =
          Array.isArray(sync.failures) && sync.failures.length > 0
            ? `\n失敗内容:\n- ${sync.failures.join('\n- ')}`
            : '';
        alert(
          `保存しました\n` +
            `共通按分の労賃再計算: 成功 ${sync.success_count}件` +
            (sync.skipped_count ? ` / スキップ ${sync.skipped_count}件` : '') +
            (sync.failed_count ? ` / 失敗 ${sync.failed_count}件` : '') +
            failureLines +
            (sync.failed_count || sync.skipped_count
              ? `\n\n※計画の保存自体は完了しています。労賃は L指令の共通部品設定・標準時間・計画台数を確認してください。`
              : '')
        );
      } else {
        alert('保存しました');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  };

  const deletePlan = async (planId: string) => {
    if (!confirm('この計画を削除しますか？')) return;

    try {
      const res = await fetch(`/api/heater/manufacturing-plan/save?id=${planId}`, {
        method: 'DELETE',
      });

      if (!res.ok) throw new Error('Failed to delete plan');
      
      await fetchSavedPlans();
      if (currentPlanId === planId) {
        setCurrentPlanId(null);
        setPlanName('');
        setPlans(plans.map((p) => ({ ...p, quantity: 0, salesQty: null })));
        setResponse(null);
        setSalesImportInfo(null);
      }
      alert('削除しました');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  };

  const newPlan = () => {
    setCurrentPlanId(null);
    setPlanName('');
    setFiscalYear(String(getCurrentFiscalYear()));
    setPlanPeriod('');
    setPlanCategory(
      categoryFilter === 'すべて' ? DEFAULT_PRODUCT_CATEGORY : categoryFilter
    );
    setNotes('');
    setPlans(plans.map((p) => ({ ...p, quantity: 0, salesQty: null })));
    setResponse(null);
    setSalesImportInfo(null);
  };

  const handleQuantityChange = (model: string, quantity: number) => {
    setPlans(
      plans.map((p) => (p.model === model ? { ...p, quantity: Math.max(0, quantity) } : p))
    );
  };

  const importSalesQuantities = async () => {
    const fy = Number(fiscalYear);
    if (!Number.isFinite(fy)) {
      setError('年度を正しく入力してください');
      return;
    }

    const hasExistingQty = plans.some((p) => p.quantity > 0);
    if (hasExistingQty) {
      const ok = confirm(
        '現在入力中の製造台数があります。営業計画台数で上書きしますか？\n（営業台数の参考表示も更新されます）'
      );
      if (!ok) return;
    }

    setImportingSales(true);
    setError(null);
    setSalesImportInfo(null);
    try {
      const res = await fetch(
        `/api/heater/manufacturing-plan/sales-qty?fiscalYear=${encodeURIComponent(String(fy))}`
      );
      const data = await res.json();
      if (!res.ok || data?.ok === false) {
        throw new Error(data?.error || '営業計画台数の取得に失敗しました');
      }

      const rows: Array<{
        machine_code: string;
        machine_name: string;
        qty: number;
        highQty: number;
      }> = Array.isArray(data.rows) ? data.rows : [];

      let modelList = [...models];
      const known = new Set(modelList.map((m) => m.model));
      const qtyByModel = new Map<string, number>();
      const skippedLabels: string[] = [];

      for (const row of rows) {
        const code = String(row.machine_code || '').trim();
        if (!code) continue;
        const value = salesQtyMode === 'highQty' ? Number(row.highQty) || 0 : Number(row.qty) || 0;
        if (value <= 0) continue;

        if (SKIP_SALES_MACHINE_CODES.has(code)) {
          skippedLabels.push(`${row.machine_name || code}（${value}台）`);
          continue;
        }

        if (!known.has(code)) {
          const inferred = normalizeProductCategory(
            inferProductCategory(code, row.machine_name)
          );
          modelList.push({
            model: code,
            name: row.machine_name || null,
            product_category: inferred,
          });
          known.add(code);
        }

        qtyByModel.set(code, (qtyByModel.get(code) || 0) + value);
      }

      if (modelList.length !== models.length) {
        setModels(modelList);
      }

      const nextPlans: ManufacturingPlanItem[] = modelList.map((m) => {
        const sales = qtyByModel.has(m.model) ? qtyByModel.get(m.model)! : null;
        return {
          model: m.model,
          modelName: m.name,
          productCategory: m.product_category,
          quantity: sales ?? 0,
          salesQty: sales,
        };
      });

      const counts = new Map<ProductCategory, number>();
      for (const item of nextPlans) {
        if ((item.salesQty || 0) <= 0) continue;
        counts.set(
          item.productCategory,
          (counts.get(item.productCategory) || 0) + (item.salesQty || 0)
        );
      }
      let best: ProductCategory | null = null;
      let bestQty = -1;
      for (const [cat, qty] of counts) {
        if (qty > bestQty) {
          best = cat;
          bestQty = qty;
        }
      }
      if (best) {
        setCategoryFilter(best);
        setPlanCategory(best);
      }

      setPlans(nextPlans);
      setResponse(null);

      const importedCount = nextPlans.filter((p) => (p.salesQty || 0) > 0).length;
      const totalSales = nextPlans.reduce((sum, p) => sum + (p.salesQty || 0), 0);
      const range = getFiscalYearDateRange(fy);
      const modeLabel = salesQtyMode === 'highQty' ? '●のみ' : '全確度';
      const skipNote =
        skippedLabels.length > 0
          ? ` ／ 「その他」等 ${skippedLabels.length}件は除外（${skippedLabels.slice(0, 3).join('、')}${skippedLabels.length > 3 ? '…' : ''}）`
          : '';
      setSalesImportInfo(
        `${formatFiscalYearLabel(fy)}（${range.start}〜${range.end}）の営業計画を取込ました（${modeLabel} / ${importedCount}機種 / 合計${totalSales}台）。製造台数は在庫を見ながら調整してください。${skipNote}`
      );

      if (importedCount === 0) {
        setError('該当年度の営業計画台数（工場機種）がありません');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '営業計画の取込に失敗しました');
    } finally {
      setImportingSales(false);
    }
  };

  const calculateGrandTotal = () => {
    if (!response) return 0
    return response.manufacturingData.reduce((sum, item) => sum + (item.totalCost || 0), 0)
  };

  const calculatePurchaseTotal = () => {
    return response?.aggregatedItems.reduce((sum, item) => {
      const purchaseQty = Math.max(0, item.total_qty - item.stock_qty);
      return sum + (purchaseQty * item.cost_price);
    }, 0) || 0;
  };

  const handlePrint = () => {
    window.print();
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY' }).format(value);
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-purple-950 to-slate-950 relative overflow-hidden p-8">
      {/* 背景の電子回路パターン */}
      <div className="absolute inset-0 opacity-10 no-print">
        <svg className="w-full h-full" viewBox="0 0 1200 800">
          <pattern id="circuit" x="0" y="0" width="200" height="200" patternUnits="userSpaceOnUse">
            <path d="M 0 50 L 50 50 L 50 0" stroke="currentColor" strokeWidth="2" fill="none" className="text-cyan-400" />
            <path d="M 150 150 L 100 150 L 100 200" stroke="currentColor" strokeWidth="2" fill="none" className="text-cyan-400" />
            <circle cx="50" cy="50" r="3" fill="currentColor" className="text-cyan-400" />
            <circle cx="100" cy="150" r="3" fill="currentColor" className="text-cyan-400" />
          </pattern>
          <rect width="1200" height="800" fill="url(#circuit)" />
        </svg>
      </div>

      <div className="relative z-10 max-w-7xl mx-auto">
        {/* ヘッダー */}
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-orange-400 via-yellow-400 to-amber-400">
            製造計画・原価管理
          </h1>
          <Link
            href="/"
            className="no-print px-6 py-2 bg-gradient-to-r from-slate-700 to-slate-800 hover:from-slate-600 hover:to-slate-700 text-white font-medium rounded-lg transition-all transform hover:scale-105 shadow-lg"
          >
            🏠 ホーム
          </Link>
        </div>

        {error && (
          <div className="no-print mb-4 p-4 bg-red-100 text-red-700 rounded-lg">
            {error}
          </div>
        )}

        {/* 保存済み計画一覧 */}
        <div className="no-print bg-white rounded-lg shadow-lg p-6 mb-8">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <h2 className="text-xl font-semibold text-slate-900">
              📚 保存済み計画
            </h2>
            <button
              onClick={newPlan}
              className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white font-medium rounded-lg transition-colors"
            >
              ➕ 新規作成
            </button>
          </div>
          <div className="mb-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setPlanListFilter('すべて')}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${
                planListFilter === 'すべて'
                  ? 'bg-slate-800 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              すべて
            </button>
            {PRODUCT_CATEGORIES.map((cat) => (
              <button
                key={`plan-filter-${cat}`}
                type="button"
                onClick={() => setPlanListFilter(cat)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${
                  planListFilter === cat
                    ? 'bg-slate-800 text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
          {filteredSavedPlans.length === 0 ? (
            <p className="text-slate-600 text-sm">保存された計画はありません</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {filteredSavedPlans.map((plan) => (
                <div
                  key={plan.id}
                  className={`border rounded-lg p-4 cursor-pointer transition-all ${
                    currentPlanId === plan.id
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-slate-300 hover:border-blue-300'
                  }`}
                >
                  <div className="flex justify-between items-start mb-2">
                    <button onClick={() => loadPlan(plan.id)} className="flex-1 text-left">
                      <h3 className="font-semibold text-slate-900">{plan.plan_name}</h3>
                      <p className="text-sm text-slate-600">
                        {plan.fiscal_year}年度 {plan.plan_period && `/ ${plan.plan_period}`}
                      </p>
                      <p className="mt-1 inline-block rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                        {normalizeProductCategory(plan.product_category || '暖房機')}
                      </p>
                    </button>
                    <button
                      onClick={() => deletePlan(plan.id)}
                      className="text-red-600 hover:text-red-800 text-sm ml-2"
                    >
                      🗑️
                    </button>
                  </div>
                  <p className="text-xs text-slate-500">
                    {new Date(plan.updated_at).toLocaleDateString('ja-JP')}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 台数入力エリア */}
        <div className="no-print bg-white rounded-lg shadow-lg p-6 mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-slate-900">
              📋 機種別製造台数入力
              {currentPlanId && <span className="text-sm text-blue-600 ml-2">（編集中: {planName}）</span>}
            </h2>
            <button
              onClick={() => {
                setPlanCategory(
                  categoryFilter === 'すべて'
                    ? resolvePrimaryCategory(plans)
                    : categoryFilter
                );
                setShowSaveDialog(true);
              }}
              disabled={plans.every((p) => p.quantity === 0)}
              className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-slate-400 text-white font-medium rounded-lg transition-colors"
            >
              💾 保存
            </button>
          </div>
          <p className="mb-3 text-sm text-slate-600">
            暖房機は部品BOM原価、それ以外（たばこ乾燥機・食品乾燥機・光合成促進装置など）は
            <span className="font-semibold text-rose-700"> D指令の原価計算結果</span>
            を参照します。同一計画に複数カテゴリを含められます。機種が無い場合は
            <Link href="/heater/models" className="mx-1 text-blue-600 underline">
              機種マスタ
            </Link>
            で登録してください。
          </p>
          <div className="mb-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setCategoryFilter('すべて')}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${
                categoryFilter === 'すべて'
                  ? 'bg-amber-600 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              すべて ({plans.length})
            </button>
            {PRODUCT_CATEGORIES.map((cat) => {
              const count = plans.filter((p) => p.productCategory === cat).length;
              return (
                <button
                  key={`input-filter-${cat}`}
                  type="button"
                  onClick={() => {
                    setCategoryFilter(cat);
                    setPlanCategory(cat);
                  }}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${
                    categoryFilter === cat
                      ? 'bg-amber-600 text-white'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  {cat} ({count})
                </button>
              );
            })}
          </div>

          <div className="mb-4 rounded-lg border border-indigo-200 bg-indigo-50 p-4">
            <div className="mb-2 flex flex-wrap items-end gap-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-indigo-800">取込年度</label>
                <input
                  type="number"
                  min="2000"
                  max="2100"
                  value={fiscalYear}
                  onChange={(e) => setFiscalYear(e.target.value)}
                  className="w-28 rounded-lg border border-indigo-300 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-indigo-800">台数の対象</label>
                <select
                  value={salesQtyMode}
                  onChange={(e) => setSalesQtyMode(e.target.value as SalesQtyMode)}
                  className="rounded-lg border border-indigo-300 bg-white px-3 py-2 text-sm text-slate-900"
                >
                  <option value="qty">全確度（●▲□）</option>
                  <option value="highQty">●のみ（確度高）</option>
                </select>
              </div>
              <button
                type="button"
                onClick={importSalesQuantities}
                disabled={importingSales}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:bg-slate-400"
              >
                {importingSales ? '取込中...' : '営業計画台数を取込'}
              </button>
            </div>
            <p className="text-xs text-indigo-900/80">
              見積システムの年度計画（個人シート）を機種別に集計し、製造台数の初期値にします。
              製造台数は工場側で在庫・能力を見て調整し、営業台数は参考表示のまま残ります。
            </p>
            {salesImportInfo && (
              <p className="mt-2 text-sm font-medium text-indigo-900">{salesImportInfo}</p>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
            {visiblePlans.length === 0 ? (
              <div className="col-span-full rounded-lg border border-dashed border-slate-300 p-6 text-center text-slate-500">
                このカテゴリの機種がありません。機種マスタで製品カテゴリを指定して登録してください。
              </div>
            ) : (
              visiblePlans.map((plan) => {
                const sales = plan.salesQty;
                const diff =
                  sales != null ? plan.quantity - sales : null;
                return (
                <div key={plan.model} className="border border-slate-300 rounded-lg p-4 bg-slate-50">
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    {plan.model} {plan.modelName && `(${plan.modelName})`}
                  </label>
                  <p className="mb-2 text-xs text-slate-500">{plan.productCategory}</p>
                  {sales != null && (
                    <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
                      <span className="rounded bg-indigo-100 px-2 py-0.5 font-semibold text-indigo-800">
                        営業 {sales}台
                      </span>
                      <span className="rounded bg-slate-200 px-2 py-0.5 font-semibold text-slate-800">
                        製造 {plan.quantity}台
                      </span>
                      {diff !== 0 && (
                        <span
                          className={`rounded px-2 py-0.5 font-semibold ${
                            (diff || 0) > 0
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-rose-100 text-rose-800'
                          }`}
                        >
                          差 {(diff || 0) > 0 ? '+' : ''}
                          {diff}台
                        </span>
                      )}
                    </div>
                  )}
                  <input
                    type="number"
                    min="0"
                    value={plan.quantity}
                    onChange={(e) => handleQuantityChange(plan.model, parseInt(e.target.value) || 0)}
                    className="w-full px-3 py-2 border-2 border-slate-400 rounded-lg bg-white text-black font-bold text-xl text-right focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    placeholder="0"
                  />
                  <span className="text-sm font-semibold text-slate-800 mt-1 block">製造台数（台）</span>
                </div>
                );
              })
            )}
          </div>
          <button
            onClick={() => fetchManufacturingPlan()}
            disabled={loading || plans.every((p) => p.quantity === 0)}
            className="w-full px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white font-medium rounded-lg transition-colors text-lg"
          >
            {loading ? '計算中...' : '原価計画を計算'}
          </button>
        </div>

        {/* 計画結果 */}
        {response &&
          (response.aggregatedItems.length > 0 ||
            (response.instructionSummaries || []).length > 0 ||
            response.manufacturingData.length > 0) && (
          <div className="space-y-8">
            {(response.warnings || []).length > 0 && (
              <div className="no-print rounded-lg border border-amber-400 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                {(response.warnings || []).map((w, i) => (
                  <p key={i}>{w}</p>
                ))}
              </div>
            )}

            {(response.instructionSummaries || []).length > 0 && (
              <div className="bg-white rounded-lg shadow-lg overflow-hidden">
                <div className="bg-gradient-to-r from-rose-600 to-rose-700 text-white p-4">
                  <h3 className="text-xl font-semibold">D指令原価（暖房機以外）</h3>
                  <p className="text-rose-100 mt-1 text-sm">
                    機種に対応するD指令の保存済み原価 × 製造台数で集計しています
                  </p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="bg-slate-100 border-b-2 border-slate-300">
                        <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">機種</th>
                        <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">カテゴリ</th>
                        <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">D指令</th>
                        <th className="px-4 py-3 text-right text-sm font-semibold text-slate-700">台数</th>
                        <th className="px-4 py-3 text-right text-sm font-semibold text-slate-700">1台原価</th>
                        <th className="px-4 py-3 text-right text-sm font-semibold text-slate-700">材料費</th>
                        <th className="px-4 py-3 text-right text-sm font-semibold text-slate-700">工賃</th>
                        <th className="px-4 py-3 text-right text-sm font-semibold text-slate-700">間接費</th>
                        <th className="px-4 py-3 text-right text-sm font-semibold text-slate-700">合計</th>
                        <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">状態</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(response.instructionSummaries || []).map((row) => (
                        <tr key={`${row.model}-${row.order_no || 'none'}`} className="border-b border-slate-200">
                          <td className="px-4 py-3 text-sm font-medium text-slate-900">{row.model}</td>
                          <td className="px-4 py-3 text-sm text-slate-700">{row.product_category}</td>
                          <td className="px-4 py-3 text-sm font-mono text-slate-900">
                            {row.order_no || '—'}
                            {row.work_order_id && (
                              <Link
                                href={`/heater/models/dr8008?work_order_id=${encodeURIComponent(row.work_order_id)}`}
                                className="ml-2 text-xs text-blue-600 underline no-print"
                              >
                                原価BOM
                              </Link>
                            )}
                          </td>
                          <td className="px-4 py-3 text-sm text-right text-slate-900">{row.quantity}</td>
                          <td className="px-4 py-3 text-sm text-right font-mono text-slate-900">
                            {formatCurrency(row.unit_total_cost || 0)}
                          </td>
                          <td className="px-4 py-3 text-sm text-right font-mono text-slate-900">
                            {formatCurrency(row.material_total || 0)}
                          </td>
                          <td className="px-4 py-3 text-sm text-right font-mono text-slate-900">
                            {formatCurrency(row.labor_total || 0)}
                          </td>
                          <td className="px-4 py-3 text-sm text-right font-mono text-slate-900">
                            {formatCurrency(row.indirect_total || 0)}
                          </td>
                          <td className="px-4 py-3 text-sm text-right font-bold font-mono text-rose-700">
                            {formatCurrency(row.total_cost || 0)}
                          </td>
                          <td className="px-4 py-3 text-sm">
                            {row.has_saved_cost ? (
                              <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
                                保存済
                              </span>
                            ) : (
                              <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                                未保存
                              </span>
                            )}
                            {row.warning && (
                              <p className="mt-1 text-xs text-amber-700">{row.warning}</p>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="bg-rose-50 border-t-2 border-rose-200">
                        <td className="px-4 py-3 text-sm font-semibold text-slate-900" colSpan={8}>
                          D指令原価 合計
                        </td>
                        <td className="px-4 py-3 text-right text-lg font-bold font-mono text-rose-700">
                          {formatCurrency(
                            (response.instructionSummaries || []).reduce(
                              (sum, row) => sum + (row.total_cost || 0),
                              0
                            )
                          )}
                        </td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            )}

            {response.aggregatedItems.length > 0 && (
            <div className="bg-white rounded-lg shadow-lg overflow-hidden">
              <div className="bg-gradient-to-r from-blue-600 to-blue-700 text-white p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-xl font-semibold">
                      📦 全機種集約 - {response.aggregatedItems.length}種類の部品
                    </h3>
                    <p className="text-blue-100 mt-1">
                      暖房機はBOM部品、D指令案件は指令原価明細を合計表示
                    </p>
                  </div>
                  <button
                    onClick={handlePrint}
                    className="no-print px-4 py-2 bg-white hover:bg-blue-50 text-blue-700 font-medium rounded-lg transition-colors flex items-center gap-2"
                  >
                    🖨️ 印刷
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-slate-100 border-b-2 border-slate-300">
                      <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">部品コード</th>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">部品名</th>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">規格</th>
                      <th className="px-4 py-3 text-right text-sm font-semibold text-slate-700">必要合計数</th>
                      <th className="px-4 py-3 text-right text-sm font-semibold text-slate-700 bg-blue-50">現在庫</th>
                      <th className="px-4 py-3 text-right text-sm font-semibold text-slate-700 bg-red-50">不足数</th>
                      <th className="px-4 py-3 text-right text-sm font-semibold text-slate-700 bg-yellow-50">購入必要数</th>
                      <th className="px-4 py-3 text-right text-sm font-semibold text-slate-700">原価単価</th>
                      <th className="px-4 py-3 text-right text-sm font-semibold text-slate-700">原価合計</th>
                      <th className="px-4 py-3 text-right text-sm font-semibold text-slate-700 bg-orange-50">購入額</th>
                    </tr>
                  </thead>
                  <tbody>
                    {response.aggregatedItems.map((item, idx) => {
                      const purchaseQty = Math.max(0, item.total_qty - item.stock_qty);
                      const purchaseAmount = purchaseQty * item.cost_price;
                      return (
                        <tr
                          key={idx}
                          className={idx % 2 === 0 ? 'bg-white' : 'bg-slate-50 hover:bg-slate-100'}
                        >
                          <td className="px-4 py-3 text-sm text-slate-900 font-mono">
                            {item.product_code || item.part_key}
                          </td>
                          <td className="px-4 py-3 text-sm font-medium text-slate-900">
                            {item.part_name}
                          </td>
                          <td className="px-4 py-3 text-sm text-slate-700">
                            {item.spec || '-'}
                          </td>
                          <td className="px-4 py-3 text-sm text-right text-slate-900 font-semibold">
                            {item.total_qty}
                          </td>
                          <td className="px-4 py-3 text-sm text-right text-blue-600 font-semibold bg-blue-50">
                            {item.stock_qty}
                          </td>
                          <td className={`px-4 py-3 text-sm text-right font-bold ${
                            item.shortage_qty > 0 ? 'text-red-600 bg-red-50' : 'text-green-600 bg-green-50'
                          }`}>
                            {item.shortage_qty > 0 ? item.shortage_qty : '✓'}
                          </td>
                          <td className="px-4 py-3 text-sm text-right text-orange-600 font-bold bg-yellow-50">
                            {purchaseQty > 0 ? purchaseQty : '-'}
                          </td>
                          <td className="px-4 py-3 text-sm text-right text-slate-900 font-mono">
                            {formatCurrency(item.cost_price)}
                          </td>
                          <td className="px-4 py-3 text-sm text-right text-blue-600 font-bold font-mono">
                            {formatCurrency(item.total_cost)}
                          </td>
                          <td className="px-4 py-3 text-sm text-right text-orange-600 font-bold font-mono bg-orange-50">
                            {purchaseQty > 0 ? formatCurrency(purchaseAmount) : '-'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="bg-blue-50 border-t-2 border-blue-200 px-4 py-4">
                <div className="space-y-2">
                  <div className="flex justify-end items-center space-x-4">
                    <span className="text-lg font-semibold text-slate-900">
                      部品原価合計：
                    </span>
                    <span className="text-2xl font-bold text-blue-600 font-mono">
                      {formatCurrency(calculateGrandTotal())}
                    </span>
                  </div>
                  <div className="flex justify-end items-center space-x-4 pt-2 border-t border-orange-200">
                    <span className="text-lg font-semibold text-orange-900">
                      購入必要額合計：
                    </span>
                    <span className="text-2xl font-bold text-orange-600 font-mono">
                      {formatCurrency(calculatePurchaseTotal())}
                    </span>
                  </div>
                </div>
              </div>
            </div>
            )}

            {/* 機種別詳細（折りたたみ可能） */}
            <details className="no-print bg-white rounded-lg shadow-lg overflow-hidden">
              <summary className="bg-gradient-to-r from-slate-600 to-slate-700 text-white p-4 cursor-pointer hover:from-slate-500 hover:to-slate-600 transition">
                <span className="text-lg font-semibold">
                  ▶ 機種別詳細（参考）
                </span>
              </summary>

              <div className="space-y-6 p-6">
                {response.manufacturingData.map((data) => (
                  <div key={data.model} className="border border-slate-300 rounded-lg p-4">
                    <div
                      className={`text-white p-3 rounded mb-4 ${
                        data.cost_source === 'd_order'
                          ? 'bg-gradient-to-r from-rose-600 to-rose-700'
                          : 'bg-gradient-to-r from-blue-600 to-blue-700'
                      }`}
                    >
                      <h4 className="font-semibold">
                        {data.model}
                        {data.cost_source === 'd_order'
                          ? ` / D指令 ${data.order_no || '未紐付'} - ${
                              data.bomItems.length > 0
                                ? `${data.bomItems.length}明細`
                                : '明細なし'
                            }`
                          : ` - ${
                              data.bomItems.length > 0
                                ? `${data.bomItems.length}種類の部品`
                                : '部品なし'
                            }`}
                      </h4>
                      <p className="text-sm opacity-90">
                        製造台数: {data.quantity} 台 | 原価合計: {formatCurrency(data.totalCost)}
                        {data.cost_source === 'd_order' && data.unit_total_cost != null
                          ? ` | 1台: ${formatCurrency(data.unit_total_cost)}`
                          : ''}
                      </p>
                      {data.cost_source === 'd_order' && (
                        <p className="text-sm opacity-90 mt-1">
                          材料 {formatCurrency(data.material_total || 0)} / 工賃{' '}
                          {formatCurrency(data.labor_total || 0)} / 間接{' '}
                          {formatCurrency(data.indirect_total || 0)}
                        </p>
                      )}
                      {data.warning && (
                        <p className="mt-1 text-xs text-amber-100">{data.warning}</p>
                      )}
                    </div>

                    {data.bomItems.length > 0 ? (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="bg-slate-100">
                              <th className="px-3 py-2 text-left">部品</th>
                              <th className="px-3 py-2 text-right">1台当たり</th>
                              <th className="px-3 py-2 text-right">単価</th>
                              <th className="px-3 py-2 text-right">小計</th>
                            </tr>
                          </thead>
                          <tbody>
                            {data.bomItems.map((item, idx) => (
                              <tr key={idx} className={idx % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                                <td className="px-3 py-2 text-slate-900">
                                  {item.part_name}
                                </td>
                                <td className="px-3 py-2 text-right">{item.quantity}</td>
                                <td className="px-3 py-2 text-right font-mono">
                                  {formatCurrency(item.cost_price)}
                                </td>
                                <td className="px-3 py-2 text-right font-bold">
                                  {formatCurrency(item.subtotal)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="text-center text-slate-600 text-sm">
                        {data.cost_source === 'd_order'
                          ? 'D指令原価明細がありません'
                          : '部品なし'}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </details>

            {/* 全体合計 */}
            {calculateGrandTotal() > 0 && (
              <div className="no-print bg-gradient-to-r from-orange-500 to-amber-500 rounded-lg shadow-lg p-6 text-white">
                <div className="flex justify-between items-center">
                  <span className="text-2xl font-bold">総原価合計：</span>
                  <span className="text-4xl font-bold font-mono">
                    {formatCurrency(calculateGrandTotal())}
                  </span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* 初期表示メッセージ */}
        {(!response ||
          (response.aggregatedItems.length === 0 &&
            (response.instructionSummaries || []).length === 0 &&
            response.manufacturingData.length === 0)) &&
          !loading && (
          <div className="no-print bg-white rounded-lg shadow-lg p-8 text-center">
            <p className="text-lg text-slate-600">
              上記で機種別の台数を入力してから「原価計画を計算」ボタンをクリックしてください
            </p>
          </div>
        )}

        {/* 保存ダイアログ */}
        {showSaveDialog && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-xl p-6 max-w-md w-full mx-4">
              <h3 className="text-xl font-bold text-slate-900 mb-4">
                {currentPlanId ? '計画を更新' : '計画を保存'}
              </h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    計画名 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={planName}
                    onChange={(e) => setPlanName(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="例: 2026年度上期生産計画"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    年度 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={fiscalYear}
                    onChange={(e) => setFiscalYear(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="例: 2026"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    製品カテゴリ <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={planCategory}
                    onChange={(e) => setPlanCategory(normalizeProductCategory(e.target.value))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {PRODUCT_CATEGORIES.map((cat) => (
                      <option key={`save-cat-${cat}`} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-slate-500">
                    計画の主分類です。台数入力では複数カテゴリを同一計画に含められます。
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    期間
                  </label>
                  <input
                    type="text"
                    value={planPeriod}
                    onChange={(e) => setPlanPeriod(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="例: 上期、1月、Q1など"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    備考
                  </label>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    rows={3}
                    placeholder="メモや特記事項"
                  />
                </div>
              </div>
              {error && (
                <div className="mt-4 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {error}
                </div>
              )}
              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => setShowSaveDialog(false)}
                  className="flex-1 px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 font-medium rounded-lg transition-colors"
                >
                  キャンセル
                </button>
                <button
                  onClick={savePlan}
                  className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
                >
                  {currentPlanId ? '更新' : '保存'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
