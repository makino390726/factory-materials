'use client';

import { useState, useEffect, useMemo, Fragment } from 'react';
import Link from 'next/link';
import {
  DEFAULT_PRODUCT_CATEGORY,
  PRODUCT_CATEGORIES,
  inferProductCategory,
  normalizeProductCategory,
  type ProductCategory,
} from '@/lib/product-category';

interface HeaterModel {
  model: string;
  name: string | null;
  product_code: string | null;
  product_category?: string | null;
}

interface Product {
  id: string;
  product_code: string;
  name: string;
}

export default function HeaterModelsPage() {
  const [models, setModels] = useState<HeaterModel[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editingModel, setEditingModel] = useState<HeaterModel | null>(null);
  const [filterCategory, setFilterCategory] = useState<'すべて' | ProductCategory>('すべて');
  const [formData, setFormData] = useState<HeaterModel>({
    model: '',
    name: null,
    product_code: null,
    product_category: DEFAULT_PRODUCT_CATEGORY,
  });
  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [showProductList, setShowProductList] = useState(false);
  const [productSearchQuery, setProductSearchQuery] = useState('');
  const [productPage, setProductPage] = useState(1);
  const productsPerPage = 10;
  const [expandedModel, setExpandedModel] = useState<string | null>(null);
  const [childOrders, setChildOrders] = useState<
    Record<
      string,
      Array<{
        id: string;
        order_no: string;
        qty: number | null;
        standard_duration_minutes: number | null;
        assembly_labor_cost: number | null;
        current_period_minutes: number | null;
        labor_receipt_date: string | null;
      }>
    >
  >({});
  const [childLoading, setChildLoading] = useState<string | null>(null);

  useEffect(() => {
    fetchModels();
    fetchAllProducts();
  }, []);

  const fetchAllProducts = async () => {
    try {
      const res = await fetch('/api/products');
      if (!res.ok) throw new Error('Failed to fetch products');
      const data = await res.json();
      setAllProducts(data || []);
    } catch (err) {
      console.error('Error fetching products:', err);
    }
  };

  const fetchModels = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/heater/models');
      if (!res.ok) throw new Error('Failed to fetch models');
      const data = await res.json();
      setModels(
        (data || []).map((m: HeaterModel) => ({
          ...m,
          product_category: normalizeProductCategory(
            m.product_category || inferProductCategory(m.model, m.name)
          ),
        }))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };


  const toggleChildOrders = async (modelCode: string) => {
    if (expandedModel === modelCode) {
      setExpandedModel(null);
      return;
    }
    setExpandedModel(modelCode);
    if (childOrders[modelCode]) return;
    setChildLoading(modelCode);
    try {
      const res = await fetch(
        `/api/work-orders?heater_model=${encodeURIComponent(modelCode)}`
      );
      const data = await res.json();
      setChildOrders((prev) => ({
        ...prev,
        [modelCode]: Array.isArray(data) ? data : [],
      }));
    } catch {
      setChildOrders((prev) => ({ ...prev, [modelCode]: [] }));
    } finally {
      setChildLoading(null);
    }
  };

  const emptyForm = (): HeaterModel => ({
    model: '',
    name: null,
    product_code: null,
    product_category: DEFAULT_PRODUCT_CATEGORY,
  });

  const handleSelectProduct = (product: Product) => {
    setFormData({
      ...formData,
      name: product.name,
      product_code: product.product_code,
      product_category: inferProductCategory(formData.model, product.name),
    });
    setShowProductList(false);
    setProductSearchQuery('');
    setProductPage(1);
  };

  const filteredProducts = allProducts.filter(
    (product) =>
      product.name.toLowerCase().includes(productSearchQuery.toLowerCase()) ||
      product.product_code.toLowerCase().includes(productSearchQuery.toLowerCase())
  );

  const totalPages = Math.ceil(filteredProducts.length / productsPerPage);
  const startIdx = (productPage - 1) * productsPerPage;
  const displayedProducts = filteredProducts.slice(startIdx, startIdx + productsPerPage);

  const displayedModels = useMemo(() => {
    if (filterCategory === 'すべて') return models;
    return models.filter((m) => m.product_category === filterCategory);
  }, [models, filterCategory]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.model.trim()) {
      setError('機種コードは必須です');
      return;
    }
    try {
      const res = await fetch('/api/heater/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      if (!res.ok) throw new Error('Failed to create model');
      await fetchModels();
      setFormData(emptyForm());
      setIsEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  };

  const handleEdit = (model: HeaterModel) => {
    setEditingModel(model);
    setFormData({
      ...model,
      product_category: normalizeProductCategory(
        model.product_category || inferProductCategory(model.model, model.name)
      ),
    });
    setProductSearchQuery(model.name || '');
    setIsEditing(true);
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingModel) return;
    try {
      const res = await fetch('/api/heater/models', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      if (!res.ok) throw new Error('Failed to update model');
      await fetchModels();
      setFormData(emptyForm());
      setEditingModel(null);
      setIsEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  };

  const handleDelete = async (model: string) => {
    if (!confirm(`機種 ${model} を削除しますか？`)) return;
    try {
      const res = await fetch(`/api/heater/models?model=${encodeURIComponent(model)}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to delete model');
      await fetchModels();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-b from-slate-950 via-purple-950 to-slate-950 p-8 text-white">
      <div className="absolute inset-0 opacity-10">
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

      <div className="relative z-10 max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-blue-400 to-purple-400">
            機種マスタ
          </h1>
          <div className="flex flex-wrap gap-2">
            <Link href="/heater/model-orders">
              <button className="px-4 py-2 bg-cyan-700 hover:bg-cyan-600 text-white font-medium rounded-lg transition border border-cyan-500">
                機種別制作指令
              </button>
            </Link>
            <Link href="/">
              <button className="px-6 py-2 bg-gradient-to-r from-slate-700 to-slate-800 hover:from-slate-600 hover:to-slate-700 text-white font-medium rounded-lg transition-all duration-300 border border-slate-600 hover:border-slate-500">
                ← ホーム
              </button>
            </Link>
          </div>
        </div>

        {error && (
          <div className="mb-6 rounded-lg border border-rose-500/50 bg-rose-950/60 p-4 text-rose-100">
            {error}
          </div>
        )}

        <div className="mb-6 rounded-xl border border-slate-700 bg-slate-900/90 p-6 shadow-xl">
          <h2 className="mb-4 text-lg font-semibold text-white">
            {isEditing ? '機種を編集' : '新しい機種を追加'}
          </h2>
          <form onSubmit={isEditing ? handleUpdate : handleCreate} className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-200">機種コード *</label>
              <input
                type="text"
                value={formData.model}
                onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                disabled={isEditing}
                placeholder="例: 110L-UF / EC30"
                className="w-full rounded-lg border border-slate-600 bg-slate-950 px-4 py-2 text-white placeholder:text-slate-500 focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/40 disabled:bg-slate-800 disabled:text-slate-400"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-200">製品カテゴリ *</label>
              <select
                value={formData.product_category || DEFAULT_PRODUCT_CATEGORY}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    product_category: normalizeProductCategory(e.target.value),
                  })
                }
                className="w-full rounded-lg border border-slate-600 bg-slate-950 px-4 py-2 text-white focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/40 [color-scheme:dark]"
              >
                {PRODUCT_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-200">商品（任意）</label>
              <div className="relative">
                <input
                  type="text"
                  placeholder="商品名またはコードで検索..."
                  value={productSearchQuery}
                  onChange={(e) => {
                    const value = e.target.value;
                    setProductSearchQuery(value);
                    setFormData((prev) => ({
                      ...prev,
                      name: value || null,
                      product_code: null,
                      product_category: inferProductCategory(prev.model, value),
                    }));
                    setProductPage(1);
                    setShowProductList(value.length > 0);
                  }}
                  onFocus={() =>
                    setShowProductList(productSearchQuery.length > 0 || allProducts.length > 0)
                  }
                  onBlur={() => setTimeout(() => setShowProductList(false), 200)}
                  autoComplete="off"
                  className="w-full rounded-lg border border-slate-600 bg-slate-950 px-4 py-2 text-white placeholder:text-slate-500 focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
                />
                {showProductList && (
                  <div className="absolute top-full left-0 right-0 z-50 mt-1 rounded-lg border border-slate-600 bg-slate-900 shadow-xl">
                    {filteredProducts.length === 0 ? (
                      <div className="px-4 py-3 text-sm text-slate-400">該当なし</div>
                    ) : (
                      <>
                        <div className="max-h-64 overflow-y-auto">
                          {displayedProducts.map((product) => (
                            <button
                              key={product.id}
                              type="button"
                              onClick={() => handleSelectProduct(product)}
                              className="w-full border-b border-slate-700 px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-slate-800"
                            >
                              <div className="font-medium text-white">{product.name}</div>
                              <div className="text-xs text-slate-400">{product.product_code}</div>
                            </button>
                          ))}
                        </div>
                        {totalPages > 1 && (
                          <div className="flex items-center justify-between border-t border-slate-700 bg-slate-950/80 px-4 py-2 text-xs text-slate-300">
                            <span>
                              {filteredProducts.length} 件中 {startIdx + 1}-
                              {Math.min(startIdx + productsPerPage, filteredProducts.length)} 件
                            </span>
                            <div className="flex gap-2">
                              <button
                                type="button"
                                disabled={productPage <= 1}
                                onClick={() => setProductPage(productPage - 1)}
                                className="rounded border border-slate-600 px-2 py-1 text-white hover:bg-slate-800 disabled:opacity-40"
                              >
                                前へ
                              </button>
                              <span className="px-2 py-1 text-white">
                                {productPage}/{totalPages}
                              </span>
                              <button
                                type="button"
                                disabled={productPage >= totalPages}
                                onClick={() => setProductPage(productPage + 1)}
                                className="rounded border border-slate-600 px-2 py-1 text-white hover:bg-slate-800 disabled:opacity-40"
                              >
                                次へ
                              </button>
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
              {formData.product_code && (
                <div className="mt-2 rounded border border-cyan-500/30 bg-cyan-950/40 p-2 text-sm">
                  <div className="text-slate-200">
                    選択: <span className="font-medium text-white">{formData.name}</span>
                  </div>
                  <div className="text-slate-300">
                    コード: <span className="font-mono text-cyan-200">{formData.product_code}</span>
                  </div>
                </div>
              )}
            </div>
            <div className="flex gap-2 pt-2">
              <button
                type="submit"
                className="rounded-lg bg-cyan-600 px-6 py-2 font-medium text-white transition-colors hover:bg-cyan-500"
              >
                {isEditing ? '更新' : '追加'}
              </button>
              {isEditing && (
                <button
                  type="button"
                  onClick={() => {
                    setIsEditing(false);
                    setEditingModel(null);
                    setFormData(emptyForm());
                  }}
                  className="rounded-lg border border-slate-600 bg-slate-800 px-6 py-2 font-medium text-white transition-colors hover:bg-slate-700"
                >
                  キャンセル
                </button>
              )}
            </div>
          </form>
        </div>

        <div className="mb-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setFilterCategory('すべて')}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
              filterCategory === 'すべて'
                ? 'bg-cyan-600 text-white'
                : 'border border-slate-600 bg-slate-900 text-slate-200 hover:bg-slate-800'
            }`}
          >
            すべて ({models.length})
          </button>
          {PRODUCT_CATEGORIES.map((cat) => {
            const count = models.filter((m) => m.product_category === cat).length;
            return (
              <button
                key={cat}
                type="button"
                onClick={() => setFilterCategory(cat)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                  filterCategory === cat
                    ? 'bg-cyan-600 text-white'
                    : 'border border-slate-600 bg-slate-900 text-slate-200 hover:bg-slate-800'
                }`}
              >
                {cat} ({count})
              </button>
            );
          })}
        </div>

        <div className="overflow-hidden rounded-xl border border-slate-700 bg-slate-900/90 shadow-xl">
          {loading ? (
            <div className="p-12 text-center text-slate-300">
              <div className="mb-3 inline-block h-8 w-8 animate-spin rounded-full border-b-2 border-cyan-400"></div>
              <p className="text-white">読み込み中...</p>
            </div>
          ) : displayedModels.length === 0 ? (
            <div className="p-12 text-center text-slate-300">
              <p className="text-lg font-medium text-white">機種がまだ登録されていません</p>
              <p className="mt-2 text-sm text-slate-400">
                たばこ乾燥機・食品乾燥機・光合成促進装置もここに登録すると生産計画で使えます
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-white">
                <thead className="border-b border-slate-700 bg-slate-950/80">
                  <tr>
                    <th className="px-6 py-3 text-left font-semibold text-slate-200">機種コード</th>
                    <th className="px-6 py-3 text-left font-semibold text-slate-200">カテゴリ</th>
                    <th className="px-6 py-3 text-left font-semibold text-slate-200">制作指令</th>
                    <th className="px-6 py-3 text-left font-semibold text-slate-200">機種名</th>
                    <th className="px-6 py-3 text-left font-semibold text-slate-200">商品コード</th>
                    <th className="px-6 py-3 text-right font-semibold text-slate-200">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {displayedModels.map((model) => (
                    <Fragment key={model.model}>
                      <tr className="hover:bg-slate-800/60">
                      <td className="px-6 py-3 font-medium text-white">{model.model}</td>
                      <td className="px-6 py-3 text-slate-200">{model.product_category || '-'}</td>
                      <td className="px-6 py-3">
                        <button
                          type="button"
                          onClick={() => toggleChildOrders(model.model)}
                          className="rounded border border-violet-500/40 bg-violet-950/50 px-2 py-1 text-xs font-medium text-violet-100 hover:bg-violet-900/60"
                        >
                          {childLoading === model.model
                            ? '読込中…'
                            : expandedModel === model.model
                              ? '閉じる'
                              : '指令一覧'}
                        </button>
                      </td>
                      <td className="px-6 py-3 text-slate-200">{model.name || '-'}</td>
                      <td className="px-6 py-3 font-mono text-sm text-slate-300">
                        {model.product_code || '-'}
                      </td>
                      <td className="space-x-2 px-6 py-3 text-right">
                        <Link href={`/heater/models/dr8008?model=${encodeURIComponent(model.model)}`}>
                          <button className="rounded border border-amber-400/50 bg-amber-900/50 px-3 py-1 text-xs font-bold text-amber-100 transition-colors hover:bg-amber-800/60">
                            標準原価
                          </button>
                        </Link>
                        <button
                          onClick={() => handleEdit(model)}
                          className="rounded border border-cyan-500/40 bg-cyan-950/50 px-3 py-1 text-xs font-medium text-cyan-100 transition-colors hover:bg-cyan-900/60"
                        >
                          編集
                        </button>
                        <button
                          onClick={() => handleDelete(model.model)}
                          className="rounded border border-rose-500/40 bg-rose-950/50 px-3 py-1 text-xs font-medium text-rose-100 transition-colors hover:bg-rose-900/60"
                        >
                          削除
                        </button>
                      </td>
                    </tr>
                    {expandedModel === model.model && (
                      <tr key={`${model.model}-children`} className="bg-slate-950/70">
                        <td colSpan={6} className="px-6 py-4">
                          {childLoading === model.model ? (
                            <p className="text-xs text-slate-400">読み込み中…</p>
                          ) : (childOrders[model.model] || []).length === 0 ? (
                            <p className="text-xs text-slate-400">
                              この機種に紐づく制作指令はありません。D指令マスタで親機種を指定して登録してください。
                            </p>
                          ) : (
                            <div className="space-y-2">
                              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-300">
                                <span>
                                  指令台数合計:{' '}
                                  <strong className="text-yellow-300">
                                    {(childOrders[model.model] || []).reduce(
                                      (s, o) => s + (Number(o.qty) || 0),
                                      0
                                    )}
                                  </strong>{' '}
                                  台
                                </span>
                                <Link
                                  href={`/work-orders`}
                                  className="text-cyan-300 underline hover:text-cyan-200"
                                >
                                  D指令マスタで追加
                                </Link>
                              </div>
                              <table className="w-full text-xs border border-slate-700 rounded overflow-hidden">
                                <thead className="bg-slate-900 text-slate-400">
                                  <tr>
                                    <th className="px-3 py-2 text-left">指令番号</th>
                                    <th className="px-3 py-2 text-right">指令台数</th>
                                    <th className="px-3 py-2 text-right">時間(分)</th>
                                    <th className="px-3 py-2 text-right">制作工賃</th>
                                    <th className="px-3 py-2 text-left">入庫確定日</th>
                                    <th className="px-3 py-2 text-right">操作</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {(childOrders[model.model] || []).map((order) => (
                                    <tr key={order.id} className="border-t border-slate-800">
                                      <td className="px-3 py-2 font-mono text-cyan-300">
                                        {order.order_no}
                                      </td>
                                      <td className="px-3 py-2 text-right text-slate-200">
                                        {order.qty ?? '-'}
                                      </td>
                                      <td className="px-3 py-2 text-right text-slate-200">
                                        {order.standard_duration_minutes?.toLocaleString() ?? '-'}
                                        {(order.current_period_minutes ?? 0) === 0 &&
                                          order.labor_receipt_date && (
                                            <span className="ml-1 text-emerald-400">(リセット済)</span>
                                          )}
                                      </td>
                                      <td className="px-3 py-2 text-right text-amber-200">
                                        {(order.assembly_labor_cost ?? 0) > 0
                                          ? `¥${Number(order.assembly_labor_cost).toLocaleString()}`
                                          : '-'}
                                      </td>
                                      <td className="px-3 py-2 text-slate-400">
                                        {order.labor_receipt_date || '-'}
                                      </td>
                                      <td className="px-3 py-2 text-right">
                                        <Link
                                          href={`/heater/models/dr8008?work_order_id=${order.id}`}
                                          className="text-amber-300 underline hover:text-amber-200"
                                        >
                                          原価
                                        </Link>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
