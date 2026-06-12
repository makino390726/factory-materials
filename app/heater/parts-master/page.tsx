'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

interface PartsMaster {
  part_key: string;
  product_code: string | null;
  shelf_no: string | null;
  part_name: string;
  spec: string | null;
  cost_price: number;
  material_cost_total?: number;
  indirect_cost_total?: number;
}

interface Product {
  id: string;
  product_code: string;
  name: string;
}

export default function PartsListPage() {
  const [parts, setParts] = useState<PartsMaster[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isRecalculating, setIsRecalculating] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editingPartKey, setEditingPartKey] = useState<string | null>(null);
  const [editingRowKey, setEditingRowKey] = useState<string | null>(null);
  const [editingRowData, setEditingRowData] = useState<PartsMaster | null>(null);
  const [formData, setFormData] = useState<PartsMaster>({
    part_key: '',
    product_code: '',
    shelf_no: '',
    part_name: '',
    spec: '',
    cost_price: 0,
  });
  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [showProductList, setShowProductList] = useState(false);
  const [productSearchQuery, setProductSearchQuery] = useState('');
  const [productPage, setProductPage] = useState(1);
  const productsPerPage = 10;

  useEffect(() => {
    fetchParts();
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

  const fetchParts = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/heater/parts-master');
      if (!res.ok) throw new Error('Failed to fetch parts');
      const data = await res.json();
      setParts(data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const handleRecalculate = async () => {
    if (!confirm('全パーツの原価（合計）を材料費+間接費で再計算しますか？')) {
      return;
    }
    
    setIsRecalculating(true);
    setError(null);
    
    try {
      const res = await fetch('/api/heater/parts-master/recalculate', {
        method: 'POST',
      });
      
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || '再計算に失敗しました');
      }
      
      const result = await res.json();
      
      let message = `原価再計算が完了しました。\n対象: ${result.totalParts}件\n更新: ${result.updatedCount}件`;
      
      if (result.skippedCount && result.skippedCount > 0) {
        message += `\n保持: ${result.skippedCount}件（ライン原価データなし）`;
      }
      
      alert(message);
      
      // 再読み込み
      await fetchParts();
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : '不明なエラー';
      setError(errorMsg);
      alert(`エラー: ${errorMsg}`);
    } finally {
      setIsRecalculating(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.part_key.trim() || !formData.part_name.trim()) {
      setError('部品キーと品名は必須です');
      return;
    }
    try {
      const payload = {
        ...formData,
        product_code: formData.product_code || null,
        shelf_no: formData.shelf_no || null,
        spec: formData.spec || null,
      };
      const res = await fetch('/api/heater/parts-master', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Failed to create part');
      }
      await fetchParts();
      setFormData({
        part_key: '',
        product_code: '',
        shelf_no: '',
        part_name: '',
        spec: '',
        cost_price: 0,
      });
      setIsEditing(false);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMsg);
      console.error('部品登録エラー:', errorMsg);
    }
  };

  const handleEdit = (part: PartsMaster) => {
    setEditingPartKey(part.part_key);
    setFormData({
      ...part,
      product_code: part.product_code || '',
      shelf_no: part.shelf_no || '',
      spec: part.spec || '',
    });
    setProductSearchQuery(part.product_code || '');
    setIsEditing(true);
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingPartKey) return;
    try {
      const payload = {
        ...formData,
        product_code: formData.product_code || null,
        shelf_no: formData.shelf_no || null,
        spec: formData.spec || null,
      };
      const res = await fetch('/api/heater/parts-master', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('Failed to update part');
      await fetchParts();
      setFormData({
        part_key: '',
        product_code: '',
        shelf_no: '',
        part_name: '',
        spec: '',
        cost_price: 0,
      });
      setEditingPartKey(null);
      setIsEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  };


  // 商品選択
  const handleSelectProduct = (product: Product) => {
    setFormData({
      ...formData,
      product_code: product.product_code,
    });
    setShowProductList(false);
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
  const handleDelete = async (partKey: string) => {
    if (!confirm(`部品 ${partKey} を削除しますか？`)) return;
    try {
      const res = await fetch(`/api/heater/parts-master?part_key=${encodeURIComponent(partKey)}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to delete part');
      await fetchParts();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  };

  // インライン編集の開始
  const handleStartRowEdit = (part: PartsMaster) => {
    setEditingRowKey(part.part_key);
    setEditingRowData({ ...part });
  };

  // インライン編集のキャンセル
  const handleCancelRowEdit = () => {
    setEditingRowKey(null);
    setEditingRowData(null);
  };

  // インライン編集の保存
  const handleSaveRowEdit = async () => {
    if (!editingRowData) return;
    try {
      const payload = {
        ...editingRowData,
        product_code: editingRowData.product_code || null,
        shelf_no: editingRowData.shelf_no || null,
        spec: editingRowData.spec || null,
      };
      const res = await fetch('/api/heater/parts-master', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('Failed to update part');
      await fetchParts();
      setEditingRowKey(null);
      setEditingRowData(null);
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

      <div className="relative z-10 max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-amber-400 via-yellow-400 to-orange-400">パーツリスト</h1>
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
            {isEditing ? '部品を編集' : '新しい部品を追加'}
          </h2>
          <form onSubmit={isEditing ? handleUpdate : handleCreate} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  部品キー *
                </label>
                <input
                  type="text"
                  value={formData.part_key}
                  onChange={(e) => setFormData({ ...formData, part_key: e.target.value })}
                  disabled={isEditing}
                  placeholder="例: part_001"
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-100"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  商品コード
                </label>
                <div className="relative">
                  <input
                    type="text"
                    placeholder="商品名またはコードで検索..."
                    value={formData.product_code || ''}
                    onChange={(e) => {
                      const value = e.target.value;
                      setProductSearchQuery(value);
                      // 直接入力時は formData に反映
                      setFormData((prev) => ({
                        ...prev,
                        product_code: value || null,
                      }));
                      setProductPage(1);
                      setShowProductList(value.length > 0);
                    }}
                    onFocus={() => setShowProductList((formData.product_code || '').length > 0 || allProducts.length > 0)}
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
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">品名 *</label>
                <input
                  type="text"
                  value={formData.part_name}
                  onChange={(e) => setFormData({ ...formData, part_name: e.target.value })}
                  placeholder="例: 取り扱い説明書"
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">棚番</label>
                <input
                  type="text"
                  value={formData.shelf_no || ''}
                  onChange={(e) => setFormData({ ...formData, shelf_no: e.target.value || null })}
                  placeholder="例: A-01"
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">規格</label>
              <textarea
                value={formData.spec || ''}
                onChange={(e) => setFormData({ ...formData, spec: e.target.value || null })}
                placeholder="例: 110K"
                rows={2}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">原価</label>
              <input
                type="number"
                step="0.01"
                value={formData.cost_price}
                onChange={(e) => setFormData({ ...formData, cost_price: parseFloat(e.target.value) || 0 })}
                placeholder="例: 1000.00"
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
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
                    setEditingPartKey(null);
                    setFormData({
                      part_key: '',
                      product_code: null,
                      shelf_no: null,
                      part_name: '',
                      spec: null,
                      cost_price: 0,
                    });
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
          <div className="flex justify-between items-center px-6 py-3 border-b border-slate-200 bg-slate-50">
            <h2 className="text-lg font-semibold text-slate-900">パーツ一覧</h2>
            <div className="flex gap-2">
              <button
                onClick={handleRecalculate}
                disabled={isRecalculating || loading}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-purple-300 text-white font-medium rounded-lg transition-colors text-sm print:hidden"
              >
                {isRecalculating ? '再計算中...' : '原価再計算'}
              </button>
              <button
                onClick={() => window.print()}
                className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white font-medium rounded-lg transition-colors text-sm print:hidden"
              >
                印刷
              </button>
            </div>
          </div>
          {loading ? (
            <div className="p-12 text-center text-slate-500">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-slate-900 mb-3"></div>
              <p>読み込み中...</p>
            </div>
          ) : parts.length === 0 ? (
            <div className="p-12 text-center text-slate-500">
              <p className="text-lg font-medium">部品がまだ登録されていません</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm print:text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 print:bg-gray-100">
                  <tr>
                    <th className="px-6 py-3 text-left font-semibold text-slate-900 print:px-2 print:py-2">部品キー</th>
                    <th className="px-6 py-3 text-left font-semibold text-slate-900 print:px-2 print:py-2">品名</th>
                    <th className="px-6 py-3 text-right font-semibold text-slate-900 print:px-2 print:py-2">材料費（集計）</th>
                    <th className="px-6 py-3 text-right font-semibold text-slate-900 print:px-2 print:py-2">間接費（集計）</th>
                    <th className="px-6 py-3 text-right font-semibold text-slate-900 print:px-2 print:py-2">原価（合計）</th>
                    <th className="px-6 py-3 text-right font-semibold text-slate-900 print:hidden">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {parts.map((part) => (
                    <tr key={part.part_key} className="hover:bg-slate-50 print:hover:bg-white">
                      {editingRowKey === part.part_key ? (
                        // 編集モード
                        <>
                          <td className="px-6 py-3 text-slate-900 font-medium text-xs print:px-2 print:py-2">
                            {part.part_key}
                          </td>
                          <td className="px-6 py-3 print:px-2 print:py-2">
                            <input
                              type="text"
                              value={editingRowData?.part_name || ''}
                              onChange={(e) => setEditingRowData({ ...editingRowData!, part_name: e.target.value })}
                              className="w-full px-2 py-1 border border-slate-300 rounded text-sm"
                            />
                          </td>
                          <td className="px-6 py-3 text-right print:px-2 print:py-2">
                            ¥{(part.material_cost_total || 0).toLocaleString()}
                          </td>
                          <td className="px-6 py-3 text-right print:px-2 print:py-2">
                            ¥{(part.indirect_cost_total || 0).toLocaleString()}
                          </td>
                          <td className="px-6 py-3 print:px-2 print:py-2">
                            <input
                              type="number"
                              step="0.01"
                              value={editingRowData?.cost_price || 0}
                              onChange={(e) => setEditingRowData({ ...editingRowData!, cost_price: parseFloat(e.target.value) || 0 })}
                              className="w-full px-2 py-1 border border-slate-300 rounded text-sm text-right"
                            />
                          </td>
                          <td className="px-6 py-3 text-right space-x-2 print:hidden">
                            <button
                              onClick={handleSaveRowEdit}
                              className="px-3 py-1 bg-green-100 hover:bg-green-200 text-green-700 rounded text-xs font-medium transition-colors"
                            >
                              保存
                            </button>
                            <button
                              onClick={handleCancelRowEdit}
                              className="px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-xs font-medium transition-colors"
                            >
                              キャンセル
                            </button>
                          </td>
                        </>
                      ) : (
                        // 通常表示モード
                        <>
                          <td className="px-6 py-3 text-slate-900 font-medium text-xs print:px-2 print:py-2">{part.part_key}</td>
                          <td className="px-6 py-3 text-slate-900 print:px-2 print:py-2">{part.part_name}</td>
                          <td className="px-6 py-3 text-right text-slate-900 print:px-2 print:py-2">¥{(part.material_cost_total || 0).toLocaleString()}</td>
                          <td className="px-6 py-3 text-right text-slate-900 print:px-2 print:py-2">¥{(part.indirect_cost_total || 0).toLocaleString()}</td>
                          <td className="px-6 py-3 text-right text-slate-900 font-medium print:px-2 print:py-2">¥{part.cost_price?.toLocaleString() || 0}</td>
                          <td className="px-6 py-3 text-right space-x-2 print:hidden">
                            <button
                              onClick={() => handleStartRowEdit(part)}
                              className="px-3 py-1 bg-blue-100 hover:bg-blue-200 text-blue-700 rounded text-xs font-medium transition-colors"
                            >
                              編集
                            </button>
                            <button
                              onClick={() => handleDelete(part.part_key)}
                              className="px-3 py-1 bg-red-100 hover:bg-red-200 text-red-700 rounded text-xs font-medium transition-colors"
                            >
                              削除
                            </button>
                          </td>
                        </>
                      )}
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
