'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

interface HeaterModel {
  model: string;
  name: string | null;
  product_code: string | null;
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
  const [formData, setFormData] = useState<HeaterModel>({
    model: '',
    name: null,
    product_code: null,
  });
  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [showProductList, setShowProductList] = useState(false);
  const [productSearchQuery, setProductSearchQuery] = useState('');
  const [productPage, setProductPage] = useState(1);
  const productsPerPage = 10;

  // 一覧取得
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
      setModels(data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  // 商品選択
  const handleSelectProduct = (product: Product) => {
    setFormData({
      ...formData,
      name: product.name,
      product_code: product.product_code,
    });
    setShowProductList(false);
    setProductSearchQuery('');
    setProductPage(1);
  };

  // フィルタリング済みの商品一覧
  const filteredProducts = allProducts.filter(
    (product) =>
      product.name.toLowerCase().includes(productSearchQuery.toLowerCase()) ||
      product.product_code.toLowerCase().includes(productSearchQuery.toLowerCase())
  );

  const totalPages = Math.ceil(filteredProducts.length / productsPerPage);
  const startIdx = (productPage - 1) * productsPerPage;
  const displayedProducts = filteredProducts.slice(
    startIdx,
    startIdx + productsPerPage
  );

  // 新規作成
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
      setFormData({ model: '', name: null, product_code: null });
      setIsEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  };

  // 編集開始
  const handleEdit = (model: HeaterModel) => {
    setEditingModel(model);
    setFormData(model);
    setProductSearchQuery(model.name || '');
    setIsEditing(true);
  };

  // 編集保存
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
      setFormData({ model: '', name: null, product_code: null });
      setEditingModel(null);
      setIsEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  };

  // 削除
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
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-purple-950 to-slate-950 relative overflow-hidden p-8">
      {/* 背景の電子回路パターン */}
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
          <h1 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-blue-400 to-purple-400">機種マスタ</h1>
          <Link href="/">
            <button className="px-6 py-2 bg-gradient-to-r from-slate-700 to-slate-800 hover:from-slate-600 hover:to-slate-700 text-white font-medium rounded-lg transition-all duration-300 border border-slate-600 hover:border-slate-500">
              ← ホーム
            </button>
          </Link>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6 text-red-700">
            {error}
          </div>
        )}

        {/* フォーム */}
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6 mb-6">
          <h2 className="text-lg font-semibold text-slate-900 mb-4">
            {isEditing ? '機種を編集' : '新しい機種を追加'}
          </h2>
          <form onSubmit={isEditing ? handleUpdate : handleCreate} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                機種コード *
              </label>
              <input
                type="text"
                value={formData.model}
                onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                disabled={isEditing}
                placeholder="例: 110L-UF"
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-100"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                商品（任意）
              </label>
              <div className="relative">
                <input
                  type="text"
                  placeholder="商品名またはコードで検索..."
                  value={productSearchQuery}
                  onChange={(e) => {
                    const value = e.target.value;
                    setProductSearchQuery(value);
                    // 直接入力時は formData に反映
                    setFormData((prev) => ({
                      ...prev,
                      name: value || null,
                      product_code: null,
                    }));
                    setProductPage(1);
                    setShowProductList(value.length > 0);
                  }}
                  onFocus={() => setShowProductList(productSearchQuery.length > 0 || allProducts.length > 0)}
                  onBlur={() => setTimeout(() => setShowProductList(false), 200)}
                  autoComplete="off"
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                {showProductList && (
                  <div className="absolute top-full left-0 right-0 mt-1 border border-slate-300 rounded-lg bg-white shadow-lg z-50">
                    {filteredProducts.length === 0 ? (
                      <div className="px-4 py-3 text-sm text-slate-500">該当なし</div>
                    ) : (
                      <>
                        <div className="max-h-64 overflow-y-auto">
                          {displayedProducts.map((product) => (
                            <button
                              key={product.id}
                              type="button"
                              onClick={() => handleSelectProduct(product)}
                              className="w-full text-left px-4 py-3 hover:bg-blue-50 border-b border-slate-200 last:border-b-0 transition-colors"
                            >
                              <div className="font-medium text-slate-900">{product.name}</div>
                              <div className="text-xs text-slate-500">{product.product_code}</div>
                            </button>
                          ))}
                        </div>
                        {totalPages > 1 && (
                          <div className="flex items-center justify-between px-4 py-2 border-t border-slate-200 text-xs text-slate-600 bg-slate-50">
                            <span>
                              {filteredProducts.length} 件中 {startIdx + 1}-
                              {Math.min(startIdx + productsPerPage, filteredProducts.length)} 件
                            </span>
                            <div className="flex gap-2">
                              <button
                                type="button"
                                disabled={productPage <= 1}
                                onClick={() => setProductPage(productPage - 1)}
                                className="px-2 py-1 rounded border border-slate-300 disabled:opacity-40 hover:bg-slate-200"
                              >
                                前へ
                              </button>
                              <span className="px-2 py-1">
                                {productPage}/{totalPages}
                              </span>
                              <button
                                type="button"
                                disabled={productPage >= totalPages}
                                onClick={() => setProductPage(productPage + 1)}
                                className="px-2 py-1 rounded border border-slate-300 disabled:opacity-40 hover:bg-slate-200"
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
                <div className="mt-2 p-2 bg-blue-50 rounded text-sm">
                  <div className="text-slate-700">
                    選択: <span className="font-medium">{formData.name}</span>
                  </div>
                  <div className="text-slate-600">
                    コード: <span className="font-mono">{formData.product_code}</span>
                  </div>
                </div>
              )}
            </div>
            <div className="flex gap-2 pt-2">
              <button
                type="submit"
                className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
              >
                {isEditing ? '更新' : '追加'}
              </button>
              {isEditing && (
                <button
                  type="button"
                  onClick={() => {
                    setIsEditing(false);
                    setEditingModel(null);
                    setFormData({ model: '', name: null, product_code: null });
                  }}
                  className="px-6 py-2 bg-slate-300 hover:bg-slate-400 text-slate-900 font-medium rounded-lg transition-colors"
                >
                  キャンセル
                </button>
              )}
            </div>
          </form>
        </div>

        {/* テーブル */}
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
          {loading ? (
            <div className="p-12 text-center text-slate-500">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-slate-900 mb-3"></div>
              <p>読み込み中...</p>
            </div>
          ) : models.length === 0 ? (
            <div className="p-12 text-center text-slate-500">
              <p className="text-lg font-medium">機種がまだ登録されていません</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="px-6 py-3 text-left font-semibold text-slate-900">機種コード</th>
                    <th className="px-6 py-3 text-left font-semibold text-slate-900">機種名</th>
                    <th className="px-6 py-3 text-left font-semibold text-slate-900">商品コード</th>
                    <th className="px-6 py-3 text-right font-semibold text-slate-900">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {models.map((model) => (
                    <tr key={model.model} className="hover:bg-slate-50">
                      <td className="px-6 py-3 text-slate-900 font-medium">{model.model}</td>
                      <td className="px-6 py-3 text-slate-600">{model.name || '-'}</td>
                      <td className="px-6 py-3 text-slate-600 font-mono text-sm">
                        {model.product_code || '-'}
                      </td>
                      <td className="px-6 py-3 text-right space-x-2">
                        {model.model === 'DR8-008' && (
                          <Link href="/heater/models/dr8008">
                            <button
                              className="px-3 py-1 bg-amber-100 hover:bg-amber-200 text-amber-800 rounded text-xs font-bold transition-colors border border-amber-300"
                            >
                              原価計算
                            </button>
                          </Link>
                        )}
                        <button
                          onClick={() => handleEdit(model)}
                          className="px-3 py-1 bg-blue-100 hover:bg-blue-200 text-blue-700 rounded text-xs font-medium transition-colors"
                        >
                          編集
                        </button>
                        <button
                          onClick={() => handleDelete(model.model)}
                          className="px-3 py-1 bg-red-100 hover:bg-red-200 text-red-700 rounded text-xs font-medium transition-colors"
                        >
                          削除
                        </button>
                      </td>
                    </tr>
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
