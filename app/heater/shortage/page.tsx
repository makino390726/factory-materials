'use client';

import { useState, useEffect, useCallback } from 'react';
import { format, startOfMonth, endOfMonth, addMonths, subMonths } from 'date-fns';
import { ja } from 'date-fns/locale';

interface ShortageItem {
  product_code: string;
  part_name: string;
  spec: string;
  required_qty: number;
  stock_qty: number;
  shortage_qty: number;
}

export default function ShortagePage() {
  const [items, setItems] = useState<ShortageItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentMonth, setCurrentMonth] = useState(() => startOfMonth(new Date()));
  const [sortConfig, setSortConfig] = useState<{ key: keyof ShortageItem; direction: 'asc' | 'desc' }>({
    key: 'shortage_qty',
    direction: 'desc',
  });
  const [currentTime, setCurrentTime] = useState<string>('');

  const fetchShortageList = useCallback(async (fromDate: Date, toDate: Date) => {
    setLoading(true);
    setError(null);
    try {
      const fromStr = format(fromDate, 'yyyy-MM-dd');
      const toStr = format(toDate, 'yyyy-MM-dd');

      const response = await fetch(`/api/heater/shortage?from_date=${fromStr}&to_date=${toStr}`);
      if (!response.ok) throw new Error('Failed to fetch shortage list');

      const data = await response.json();
      setItems(data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const fromDate = startOfMonth(currentMonth);
    const toDate = endOfMonth(currentMonth);
    fetchShortageList(fromDate, toDate);
  }, [currentMonth, fetchShortageList]);

  useEffect(() => {
    setCurrentTime(format(new Date(), 'yyyy-MM-dd HH:mm:ss', { locale: ja }));
  }, []);

  const handleSort = (key: keyof ShortageItem) => {
    setSortConfig((prev) => ({
      key,
      direction: prev.key === key && prev.direction === 'desc' ? 'asc' : 'desc',
    }));
  };

  const sortedItems = [...items].sort((a, b) => {
    const aValue = a[sortConfig.key];
    const bValue = b[sortConfig.key];

    if (typeof aValue === 'number' && typeof bValue === 'number') {
      return sortConfig.direction === 'asc' ? aValue - bValue : bValue - aValue;
    }

    const aStr = String(aValue).toLowerCase();
    const bStr = String(bValue).toLowerCase();
    return sortConfig.direction === 'asc' ? aStr.localeCompare(bStr) : bStr.localeCompare(aStr);
  });

  const shortageItems = sortedItems.filter((item) => item.shortage_qty > 0);
  const shortageCount = shortageItems.length;
  const totalShortage = shortageItems.reduce((sum, item) => sum + item.shortage_qty, 0);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-8">
      <div className="max-w-7xl mx-auto">
        {/* ヘッダー */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-slate-900 mb-2">暖房機 部品不足一覧</h1>
          <p className="text-slate-600">必要部品数と現在庫から不足数を自動計算</p>
        </div>

        {/* 期間選択 */}
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6 mb-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-900">期間指定</h2>
            <div className="flex gap-2">
              <button
                onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-md transition-colors"
              >
                ← 前月
              </button>
              <span className="px-6 py-2 bg-slate-50 text-slate-900 font-semibold rounded-md border border-slate-200">
                {format(currentMonth, 'yyyy年MM月', { locale: ja })}
              </span>
              <button
                onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-md transition-colors"
              >
                次月 →
              </button>
            </div>
          </div>
        </div>

        {/* サマリーカード */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6">
            <div className="text-sm text-slate-600 mb-1">不足品目数</div>
            <div className="text-3xl font-bold text-red-600">{shortageCount}</div>
          </div>
          <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6">
            <div className="text-sm text-slate-600 mb-1">合計不足数量</div>
            <div className="text-3xl font-bold text-orange-600">{totalShortage}</div>
          </div>
        </div>

        {/* エラー表示 */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6 text-red-700">
            エラー: {error}
          </div>
        )}

        {/* テーブル */}
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
          {loading ? (
            <div className="p-12 text-center text-slate-500">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-slate-900 mb-3"></div>
              <p>データを読み込み中...</p>
            </div>
          ) : shortageItems.length === 0 ? (
            <div className="p-12 text-center text-slate-500">
              <svg className="mx-auto h-12 w-12 text-slate-400 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-lg font-medium">不足品目なし</p>
              <p className="text-sm">在庫が充足しています</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th
                      onClick={() => handleSort('product_code')}
                      className="px-6 py-3 text-left font-semibold text-slate-900 cursor-pointer hover:bg-slate-100 transition-colors"
                    >
                      商品コード
                      {sortConfig.key === 'product_code' && (
                        <span className="ml-2">{sortConfig.direction === 'asc' ? '↑' : '↓'}</span>
                      )}
                    </th>
                    <th
                      onClick={() => handleSort('part_name')}
                      className="px-6 py-3 text-left font-semibold text-slate-900 cursor-pointer hover:bg-slate-100 transition-colors"
                    >
                      品名
                      {sortConfig.key === 'part_name' && (
                        <span className="ml-2">{sortConfig.direction === 'asc' ? '↑' : '↓'}</span>
                      )}
                    </th>
                    <th
                      onClick={() => handleSort('spec')}
                      className="px-6 py-3 text-left font-semibold text-slate-900 cursor-pointer hover:bg-slate-100 transition-colors"
                    >
                      規格
                      {sortConfig.key === 'spec' && (
                        <span className="ml-2">{sortConfig.direction === 'asc' ? '↑' : '↓'}</span>
                      )}
                    </th>
                    <th
                      onClick={() => handleSort('required_qty')}
                      className="px-6 py-3 text-right font-semibold text-slate-900 cursor-pointer hover:bg-slate-100 transition-colors"
                    >
                      必要数
                      {sortConfig.key === 'required_qty' && (
                        <span className="ml-2">{sortConfig.direction === 'asc' ? '↑' : '↓'}</span>
                      )}
                    </th>
                    <th
                      onClick={() => handleSort('stock_qty')}
                      className="px-6 py-3 text-right font-semibold text-slate-900 cursor-pointer hover:bg-slate-100 transition-colors"
                    >
                      現在庫
                      {sortConfig.key === 'stock_qty' && (
                        <span className="ml-2">{sortConfig.direction === 'asc' ? '↑' : '↓'}</span>
                      )}
                    </th>
                    <th
                      onClick={() => handleSort('shortage_qty')}
                      className="px-6 py-3 text-right font-semibold text-slate-900 cursor-pointer hover:bg-slate-100 transition-colors bg-red-50"
                    >
                      不足数
                      {sortConfig.key === 'shortage_qty' && (
                        <span className="ml-2">{sortConfig.direction === 'asc' ? '↑' : '↓'}</span>
                      )}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {shortageItems.map((item, idx) => (
                    <tr key={idx} className="hover:bg-slate-50 transition-colors">
                      <td className="px-6 py-3 text-slate-900 font-medium">{item.product_code}</td>
                      <td className="px-6 py-3 text-slate-900">{item.part_name}</td>
                      <td className="px-6 py-3 text-slate-600 text-xs">{item.spec}</td>
                      <td className="px-6 py-3 text-right font-semibold text-slate-900">
                        {Math.round(item.required_qty)}
                      </td>
                      <td className="px-6 py-3 text-right font-semibold text-slate-900">
                        {Math.round(item.stock_qty)}
                      </td>
                      <td className="px-6 py-3 text-right font-bold text-red-600 bg-red-50">
                        {Math.round(item.shortage_qty)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* フッター */}
        <div className="mt-6 text-center text-sm text-slate-600">
          <p>生成日時: {currentTime || '-'}</p>
        </div>
      </div>
    </div>
  );
}
