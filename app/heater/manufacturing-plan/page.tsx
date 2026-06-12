'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

interface ManufacturingPlanItem {
  model: string;
  modelName: string | null;
  quantity: number;
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
  notes: string | null;
  created_at: string;
  updated_at: string;
}

interface BomDetail {
  model: string;
  part_key: string;
  part_name: string;
  spec: string | null;
  product_code: string | null;
  quantity: number;
  cost_price: number;
  subtotal: number;
}

interface ManufacturingData {
  model: string;
  quantity: number;
  bomItems: BomDetail[];
  totalCost: number;
}

interface ManufacturingResponse {
  manufacturingData: ManufacturingData[];
  aggregatedItems: AggregatedItem[];
}

export default function ManufacturingPlanPage() {
  const [models, setModels] = useState<{ model: string; name: string | null }[]>([]);
  const [plans, setPlans] = useState<ManufacturingPlanItem[]>([]);
  const [response, setResponse] = useState<ManufacturingResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // 保存関連の状態
  const [savedPlans, setSavedPlans] = useState<SavedPlan[]>([]);
  const [currentPlanId, setCurrentPlanId] = useState<string | null>(null);
  const [planName, setPlanName] = useState('');
  const [fiscalYear, setFiscalYear] = useState(new Date().getFullYear().toString());
  const [planPeriod, setPlanPeriod] = useState('');
  const [notes, setNotes] = useState('');
  const [showSaveDialog, setShowSaveDialog] = useState(false);

  useEffect(() => {
    fetchModels();
    fetchSavedPlans();
  }, []);

  const fetchModels = async () => {
    try {
      const res = await fetch('/api/heater/models');
      if (!res.ok) throw new Error('Failed to fetch models');
      const data = await res.json();
      setModels(data || []);
      // 初期化：すべての機種を計画に追加（台数0）
      setPlans(
        (data || []).map((m: any) => ({
          model: m.model,
          modelName: m.name,
          quantity: 0,
        }))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  };

  const fetchManufacturingPlan = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/heater/manufacturing-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plans }),
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
      if (!res.ok) throw new Error('Failed to fetch saved plans');
      const data = await res.json();
      setSavedPlans(data || []);
    } catch (err) {
      console.error('Failed to fetch saved plans:', err);
    }
  };

  const loadPlan = async (planId: string) => {
    try {
      const res = await fetch(`/api/heater/manufacturing-plan/save?id=${planId}`);
      if (!res.ok) throw new Error('Failed to load plan');
      const data = await res.json();
      
      setCurrentPlanId(data.id);
      setPlanName(data.plan_name);
      setFiscalYear(data.fiscal_year);
      setPlanPeriod(data.plan_period || '');
      setNotes(data.notes || '');
      
      // 台数データを復元
      const detailsMap = new Map<string, number>(
        data.details.map((d: any) => [String(d.model), Number(d.quantity) || 0])
      );
      setPlans((prev) =>
        prev.map((p) => ({
          ...p,
          quantity: detailsMap.get(p.model) ?? 0,
        }))
      );
      
      // 自動で計算実行
      setTimeout(() => fetchManufacturingPlan(), 100);
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
      const details = plans.filter(p => p.quantity > 0).map(p => ({
        model: p.model,
        quantity: p.quantity
      }));

      const method = currentPlanId ? 'PUT' : 'POST';
      const body: any = {
        plan_name: planName,
        fiscal_year: fiscalYear,
        plan_period: planPeriod,
        notes,
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

      if (!res.ok) throw new Error('Failed to save plan');
      const data = await res.json();
      
      setCurrentPlanId(data.id || currentPlanId);
      setShowSaveDialog(false);
      await fetchSavedPlans();
      alert('保存しました');
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
        setPlans(plans.map(p => ({ ...p, quantity: 0 })));
        setResponse(null);
      }
      alert('削除しました');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  };

  const newPlan = () => {
    setCurrentPlanId(null);
    setPlanName('');
    setFiscalYear(new Date().getFullYear().toString());
    setPlanPeriod('');
    setNotes('');
    setPlans(plans.map(p => ({ ...p, quantity: 0 })));
    setResponse(null);
  };

  const handleQuantityChange = (model: string, quantity: number) => {
    setPlans(
      plans.map((p) => (p.model === model ? { ...p, quantity: Math.max(0, quantity) } : p))
    );
  };

  const calculateGrandTotal = () => {
    return response?.aggregatedItems.reduce((sum, item) => sum + item.total_cost, 0) || 0;
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
          <div className="flex items-center justify-between mb-4">
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
          {savedPlans.length === 0 ? (
            <p className="text-slate-600 text-sm">保存された計画はありません</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {savedPlans.map((plan) => (
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
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-semibold text-slate-900">
              📋 機種別製造台数入力
              {currentPlanId && <span className="text-sm text-blue-600 ml-2">（編集中: {planName}）</span>}
            </h2>
            <button
              onClick={() => setShowSaveDialog(true)}
              disabled={plans.every((p) => p.quantity === 0)}
              className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-slate-400 text-white font-medium rounded-lg transition-colors"
            >
              💾 保存
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
            {plans.map((plan) => (
              <div key={plan.model} className="border border-slate-300 rounded-lg p-4 bg-slate-50">
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  {plan.model} {plan.modelName && `(${plan.modelName})`}
                </label>
                <input
                  type="number"
                  min="0"
                  value={plan.quantity}
                  onChange={(e) => handleQuantityChange(plan.model, parseInt(e.target.value) || 0)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="台数を入力"
                />
                <span className="text-sm text-slate-600 mt-1 block">台</span>
              </div>
            ))}
          </div>
          <button
            onClick={fetchManufacturingPlan}
            disabled={loading || plans.every((p) => p.quantity === 0)}
            className="w-full px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white font-medium rounded-lg transition-colors text-lg"
          >
            {loading ? '計算中...' : '原価計画を計算'}
          </button>
        </div>

        {/* 計画結果 */}
        {response && response.aggregatedItems.length > 0 && (
          <div className="space-y-8">
            {/* 集約部品リスト */}
            <div className="bg-white rounded-lg shadow-lg overflow-hidden">
              <div className="bg-gradient-to-r from-blue-600 to-blue-700 text-white p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-xl font-semibold">
                      📦 全機種集約 - {response.aggregatedItems.length}種類の部品
                    </h3>
                    <p className="text-blue-100 mt-1">
                      すべての機種で必要な部品を合計表示
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
                    <div className="bg-gradient-to-r from-blue-600 to-blue-700 text-white p-3 rounded mb-4">
                      <h4 className="font-semibold">
                        {data.model} - {data.bomItems.length > 0 ? `${data.bomItems.length}種類の部品` : '部品なし'}
                      </h4>
                      <p className="text-blue-100 text-sm">
                        製造台数: {data.quantity} 台 | 原価合計: {formatCurrency(data.totalCost)}
                      </p>
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
                      <p className="text-center text-slate-600 text-sm">部品なし</p>
                    )}
                  </div>
                ))}
              </div>
            </details>

            {/* 全体合計 */}
            {calculateGrandTotal() > 0 && (
              <div className="no-print bg-gradient-to-r from-orange-500 to-amber-500 rounded-lg shadow-lg p-6 text-white">
                <div className="flex justify-between items-center">
                  <span className="text-2xl font-bold">総原価合計（仕入金額）：</span>
                  <span className="text-4xl font-bold font-mono">
                    {formatCurrency(calculateGrandTotal())}
                  </span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* 初期表示メッセージ */}
        {(!response || response.aggregatedItems.length === 0) && !loading && (
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
